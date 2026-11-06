package com.example.demo;

import static org.assertj.core.api.Assertions.*;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Regression tests: real services/H2/HTTP with an isolated Orthanc HTTP test double. */
@SpringBootTest(properties={"keycloak.client-secret=test", "app.datasets.seed-enabled=false",
        "spring.datasource.url=jdbc:h2:mem:seg-retention-concurrency-fixed;DB_CLOSE_DELAY=-1",
        "app.collaboration.scan-ms=3600000", "app.segmentation.cleanup-ms=3600000"})
class SegmentationRetentionConcurrencyTests {
    static final String OLD="22222222-22222222-22222222-22222222-22222222";
    static final String NEW="33333333-33333333-33333333-33333333-33333333";
    static final String SERIES="aaaaaaaa-aaaaaaaa-aaaaaaaa-aaaaaaaa-aaaaaaaa";
    static final DemoSession.Identity USER=new DemoSession.Identity("http://127.0.0.1:8081/realms/medical-demo","audit","audit");
    static final byte[] PIXELS="isolated-SEG-fixture".getBytes(StandardCharsets.UTF_8);
    static final Map<String,byte[]> objects=new ConcurrentHashMap<>();
    static final List<String> events=new CopyOnWriteArrayList<>();
    static volatile Gate replacementGate, importMetadataGate;
    static HttpServer server;
    static {
        try {
            server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
            server.createContext("/",SegmentationRetentionConcurrencyTests::handle);
            server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
            server.start();
        } catch(IOException error) {throw new ExceptionInInitializerError(error);}
    }
    static class Gate {
        final CountDownLatch reached, proceed=new CountDownLatch(1);
        Gate(){this(1);}
        Gate(int count){reached=new CountDownLatch(count);}
        void block() throws InterruptedException {reached.countDown();if(!proceed.await(10,TimeUnit.SECONDS))throw new AssertionError("Audit gate timed out");}
        void await() throws InterruptedException {assertThat(reached.await(10,TimeUnit.SECONDS)).isTrue();}
        void release(){proceed.countDown();}
    }
    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) {
        registry.add("orthanc.base-url",()->"http://127.0.0.1:"+server.getAddress().getPort());
    }
    static void handle(HttpExchange exchange) throws IOException {
        String path=exchange.getRequestURI().getPath(),method=exchange.getRequestMethod();
        events.add(method+" "+path);
        int status=200;byte[] body;
        try {
            if(method.equals("POST")&&path.equals("/instances")) {
                byte[] submitted=exchange.getRequestBody().readAllBytes();
                if(!java.util.Arrays.equals(submitted,PIXELS))throw new AssertionError("Wrong audit fixture");
                boolean exists=objects.putIfAbsent(OLD,submitted)!=null;
                body=("{\"Status\":\""+(exists?"AlreadyStored":"Success")+"\",\"ID\":\""+OLD+"\"}").getBytes(StandardCharsets.UTF_8);
            } else {
                String[] parts=path.split("/");String id=parts.length>2?parts[2]:"";
                byte[] stored=objects.get(id);
                if(stored==null){status=404;body="{}".getBytes();}
                else if(method.equals("DELETE")) {objects.remove(id);body="{}".getBytes();events.add("DELETED "+id);}
                else if(path.endsWith("/file")){body=stored;exchange.getResponseHeaders().set("Content-Type","application/dicom");}
                else if(path.endsWith("/simplified-tags"))body="{\"SOPClassUID\":\"1.2.840.10008.5.1.4.1.1.66.7\"}".getBytes();
                else {
                    // Metadata is already fetched; a gate controls when its HTTP response reaches Java.
                    if(id.equals(NEW)&&replacementGate!=null)replacementGate.block();
                    if(id.equals(OLD)&&importMetadataGate!=null)importMetadataGate.block();
                    body=("{\"ID\":\""+id+"\",\"MainDicomTags\":{\"InstanceNumber\":\"1\"}}").getBytes();
                }
            }
            if(!exchange.getResponseHeaders().containsKey("Content-Type"))exchange.getResponseHeaders().set("Content-Type","application/json");
            exchange.sendResponseHeaders(status,body.length);exchange.getResponseBody().write(body);
        } catch(InterruptedException error){Thread.currentThread().interrupt();throw new IOException(error);}
        finally {exchange.close();}
    }
    @Autowired DatasetService datasets;
    @Autowired SegmentationRetentionService retention;
    @Autowired JdbcTemplate db;
    @Autowired PlatformTransactionManager manager;
    String ownerDataset,importDataset;
    @BeforeEach void setup() {
        replacementGate=null;importMetadataGate=null;objects.clear();events.clear();
        for(String table:List.of("mask_snapshot_jobs","mask_slice_leases","mask_ops","mask_rooms",
                "segmentation_publications","segmentation_drafts","dataset_teams","dataset_grants","dataset_instances","datasets"))
            db.update("DELETE FROM "+table);
        ownerDataset=datasets.create("Audit snapshots",USER).id();importDataset=datasets.create("Audit reimport",USER).id();
        objects.put(OLD,PIXELS);objects.put(NEW,"new-SEG-fixture".getBytes());
        publication(1,OLD);publication(2,NEW);
    }
    @AfterEach void unblock(){if(replacementGate!=null)replacementGate.release();if(importMetadataGate!=null)importMetadataGate.release();}
    @AfterAll static void close(){server.stop(0);}
    void publication(int version,String id) {
        db.update("INSERT INTO segmentation_publications (dataset_id,series_id,version,author_issuer,author_subject,author_username,created_at,label,orthanc_id) VALUES (?,?,?,?,?,?,?,?,?)",
                ownerDataset,SERIES,version,USER.issuer(),USER.subject(),USER.username(),"2026-11-04T00:00:00Z","Audit",id);
    }
    OrthancService.ImportResult importOld(){return datasets.importDicomFile(importDataset,new MockMultipartFile("file","audit-seg.dcm","application/dicom",PIXELS),USER);}
    long references(){return db.queryForObject("SELECT COUNT(*) FROM dataset_instances WHERE instance_id=?",Long.class,OLD);}
    long deletedReceipts(){return db.queryForObject("SELECT COUNT(*) FROM segmentation_publications WHERE orthanc_id=? AND storage_deleted_at IS NOT NULL",Long.class,OLD);}
    @Test void controlUnreferencedOldSegIsDeletedWhileLatestIsRetained() {
        retention.cleanupSuperseded();
        assertThat(objects).doesNotContainKey(OLD).containsKey(NEW);
        assertThat(deletedReceipts()).isEqualTo(1);
    }
    @Test void controlReferenceCommittedBeforeCandidateSelectionProtectsOldSeg() {
        assertThat(importOld().status()).isEqualTo("AlreadyStored");
        retention.cleanupSuperseded();
        assertThat(references()).isEqualTo(1);assertThat(objects).containsKey(OLD);assertThat(deletedReceipts()).isZero();
    }
    @Test void importWaitsForAnAlreadyRunningDeleteThenReuploadsBeforeReturningSuccess() throws Exception {
        replacementGate=new Gate();
        try(var executor=Executors.newVirtualThreadPerTaskExecutor()) {
            Future<?> cleanup=executor.submit(retention::cleanupSuperseded);
            Future<OrthancService.ImportResult> importing;
            try {
                replacementGate.await();
                var started=new CountDownLatch(1);
                importing=executor.submit(()->{started.countDown();return importOld();});
                assertThat(started.await(5,TimeUnit.SECONDS)).isTrue();
                assertThatThrownBy(()->importing.get(200,TimeUnit.MILLISECONDS)).isInstanceOf(TimeoutException.class);
                assertThat(events).doesNotContain("POST /instances");
            } finally {replacementGate.release();}
            cleanup.get(10,TimeUnit.SECONDS);
            assertThat(importing.get(10,TimeUnit.SECONDS).status()).isEqualTo("Success");
        }
        assertThat(references()).isEqualTo(1);
        assertThat(objects).as("Committed dataset reference must keep its SEG readable").containsKey(OLD);
    }
    @Test void importInFlightBeforeCleanupMustNotCommitADanglingReference() throws Exception {
        importMetadataGate=new Gate();
        try(var executor=Executors.newVirtualThreadPerTaskExecutor()) {
            Future<OrthancService.ImportResult> importing=executor.submit(this::importOld);
            try {
                importMetadataGate.await();
                assertThat(references()).isZero();
                retention.cleanupSuperseded();
                assertThat(events).noneMatch(event->event.startsWith("DELETE "));
            } finally {importMetadataGate.release();}
            assertThat(importing.get(10,TimeUnit.SECONDS).status()).isEqualTo("AlreadyStored");
        }
        assertThat(references()).isEqualTo(1);
        assertThat(objects).as("Successful import must not point at a SEG deleted in flight").containsKey(OLD);
        retention.cleanupSuperseded();
        assertThat(objects).containsKey(OLD);assertThat(deletedReceipts()).isZero();
    }

    @Test void referenceRemainsProtectedUntilAnOuterTransactionActuallyCommits() throws Exception {
        Gate outerCommit=new Gate();
        try(var executor=Executors.newVirtualThreadPerTaskExecutor()) {
            Future<?> importing=executor.submit(()->new TransactionTemplate(manager).executeWithoutResult(tx->{
                assertThat(importOld().status()).isEqualTo("AlreadyStored");
                try{outerCommit.block();}catch(InterruptedException error){throw new AssertionError(error);}
            }));
            try {
                outerCommit.await();assertThat(references()).isZero();
                retention.cleanupSuperseded();
                assertThat(objects).containsKey(OLD);assertThat(deletedReceipts()).isZero();
            } finally {outerCommit.release();}
            importing.get(10,TimeUnit.SECONDS);
        }
        assertThat(references()).isEqualTo(1);retention.cleanupSuperseded();assertThat(objects).containsKey(OLD);
    }

    @Test void rollbackReleasesProtectionAndAllowsUnreferencedOldSegToBeCleaned() {
        new TransactionTemplate(manager).executeWithoutResult(tx->{importOld();tx.setRollbackOnly();});
        assertThat(references()).isZero();retention.cleanupSuperseded();assertThat(objects).doesNotContainKey(OLD);
    }

    @Test void independentUploadsCanRunInParallelWhileCleanupYields() throws Exception {
        String other=datasets.create("Parallel import",USER).id();importMetadataGate=new Gate(2);
        try(var executor=Executors.newVirtualThreadPerTaskExecutor()) {
            Future<?> one=executor.submit(this::importOld);
            Future<?> two=executor.submit(()->datasets.importDicom(other,PIXELS,USER));
            try {
                importMetadataGate.await();
                retention.cleanupSuperseded();assertThat(objects).containsKey(OLD);
            } finally {importMetadataGate.release();}
            one.get(10,TimeUnit.SECONDS);two.get(10,TimeUnit.SECONDS);
        }
        assertThat(references()).isEqualTo(2);retention.cleanupSuperseded();assertThat(objects).containsKey(OLD);
    }
}
