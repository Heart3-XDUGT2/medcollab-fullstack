package com.example.demo;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest(properties={"keycloak.client-secret=test", "app.datasets.seed-enabled=false",
        "spring.datasource.url=jdbc:h2:mem:seg-retention-tests;DB_CLOSE_DELAY=-1",
        "app.collaboration.scan-ms=3600000", "app.segmentation.cleanup-ms=3600000"})
class SegmentationRetentionTests {
    static final DemoSession.Identity USER = new DemoSession.Identity("http://127.0.0.1:8081/realms/medical-demo", "alice", "alice");
    static final String CT = "11111111-11111111-11111111-11111111-11111111";
    static final String SERIES = "aaaaaaaa-aaaaaaaa-aaaaaaaa-aaaaaaaa-aaaaaaaa";
    static final String OLD = "22222222-22222222-22222222-22222222-22222222";
    static final String NEW = "33333333-33333333-33333333-33333333-33333333";
    static final String THIRD = "44444444-44444444-44444444-44444444-44444444";
    static final List<DicomSegCodec.SourceImage> SOURCES = List.of(
            new DicomSegCodec.SourceImage(CT,"1",SERIES,"CT",4,5,"1.2.3.1"));
    static final List<DicomSegCodec.Segment> LABELS = List.of(new DicomSegCodec.Segment(1,"Heart",List.of(255,80,80)));
    static final DicomSegCodec.Labelmap DATA = new DicomSegCodec.Labelmap(LABELS,
            List.of(new DicomSegCodec.Mask(CT,List.of(0,2,1))));
    @Autowired SegmentationService segmentations;
    @Autowired SegmentationRetentionService retention;
    @Autowired CollaborationService collaboration;
    @Autowired DatasetService datasets;
    @Autowired JdbcTemplate db;
    @Autowired PlatformTransactionManager manager;
    @MockitoBean OrthancService orthanc;
    @MockitoBean DicomSegCodec codec;
    @MockitoBean KeycloakDirectoryService directory;
    String dataset;

    @BeforeEach void setup() {
        for (String table : List.of("mask_snapshot_jobs","mask_slice_leases","mask_ops","mask_rooms",
                "segmentation_publications","segmentation_drafts","dataset_teams","dataset_grants",
                "dataset_instances","datasets")) db.update("DELETE FROM " + table);
        dataset = datasets.create("CT",USER).id();
        db.update("INSERT INTO dataset_instances VALUES (?,?,?)",dataset,CT,"1");
        when(codec.sources(anyList())).thenReturn(SOURCES);
        when(codec.encodeLabelmap(anyList(),anyString(),any())).thenReturn(new byte[]{1,2});
        when(codec.decodeLabelmap(any(),anyList())).thenReturn(DATA);
        when(orthanc.file(anyString())).thenReturn(new byte[]{1,2});
        when(orthanc.importDicom(any())).thenReturn(new OrthancService.ImportResult("Success",OLD),
                new OrthancService.ImportResult("Success",NEW),new OrthancService.ImportResult("Success",THIRD));
    }

    SegmentationService.LabelmapRequest request(long base) {
        return new SegmentationService.LabelmapRequest(base,"Heart",DATA,UUID.randomUUID().toString());
    }
    void publish(long base) { segmentations.publishLabelmap(dataset,SERIES,request(base),USER); }
    long deleted() { return db.queryForObject("SELECT COUNT(*) FROM segmentation_publications WHERE storage_deleted_at IS NOT NULL",Long.class); }

    @Test void manualPublicationProtectsStorageThroughEncodingUploadAndCommit() throws Exception {
        publish(0);publish(1);
        assertCleanupDefersWhileEncoding(()->publish(2));
    }

    @Test void automaticArchiveProtectsTheGapBeforeTheUploadedJobIdIsRecorded() throws Exception {
        publish(0);publish(1);
        String client="guard-archive-client";
        String lease=collaboration.lease(dataset,SERIES,new CollaborationService.LeaseRequest(client,null,"acquire"),USER).leaseId();
        collaboration.commit(dataset,SERIES,new CollaborationService.Batch(client,lease,List.of(
                new CollaborationService.Operation(UUID.randomUUID().toString(),0,LABELS,DATA.masks()))),USER);
        assertCleanupDefersWhileEncoding(()->collaboration.archive(dataset,SERIES));
        assertThat(collaboration.state(dataset,SERIES,client,USER).throughSeq()).isEqualTo(1);
    }

    void assertCleanupDefersWhileEncoding(Runnable writer) throws Exception {
        var entered=new CountDownLatch(1);var finish=new CountDownLatch(1);
        when(codec.encodeLabelmap(anyList(),anyString(),any())).thenAnswer(call->{
            entered.countDown();
            if(!finish.await(10,TimeUnit.SECONDS))throw new AssertionError("Encoding gate timed out");
            return new byte[]{1,2};
        });
        try(var executor=Executors.newVirtualThreadPerTaskExecutor()) {
            Future<?> running=executor.submit(writer);
            try {
                assertThat(entered.await(10,TimeUnit.SECONDS)).isTrue();
                retention.cleanupSuperseded();
                verify(orthanc,never()).deleteSegmentation(anyString());
            } finally {finish.countDown();}
            running.get(10,TimeUnit.SECONDS);
        }
        assertThat(segmentations.status(dataset,SERIES,USER).publishedVersion()).isEqualTo(3);
        retention.cleanupSuperseded();
        verify(orthanc).deleteSegmentation(OLD);verify(orthanc).deleteSegmentation(NEW);
        verify(orthanc,never()).deleteSegmentation(THIRD);
    }

    @Test void latestOnlyRetainsCurrentPixelsAndIdempotentReceiptsAcrossSeveralReplacements() {
        var first = request(0);
        segmentations.publishLabelmap(dataset,SERIES,first,USER);
        retention.cleanupSuperseded();
        verify(orthanc,never()).deleteSegmentation(anyString());
        publish(1); publish(2);
        retention.cleanupSuperseded();
        verify(orthanc).deleteSegmentation(OLD);
        verify(orthanc).deleteSegmentation(NEW);
        verify(orthanc,never()).deleteSegmentation(THIRD);
        verify(orthanc,never()).deleteSegmentation(CT);
        assertThat(deleted()).isEqualTo(2);
        var latest = segmentations.labelmap(dataset,SERIES,USER);
        assertThat(latest.status().publishedVersion()).isEqualTo(3);
        assertThat(latest.status().orthancId()).isEqualTo(THIRD);
        assertThat(latest.data()).isEqualTo(DATA);
        clearInvocations(orthanc);
        assertThat(segmentations.publishLabelmap(dataset,SERIES,first,USER).publishedVersion()).isEqualTo(1);
        assertThat(segmentations.status(dataset,SERIES,USER).orthancId()).isEqualTo(THIRD);
        verify(orthanc,never()).importDicom(any());
        retention.cleanupSuperseded();
        verify(orthanc,never()).deleteSegmentation(anyString());
        assertThat(db.queryForObject("SELECT COUNT(*) FROM segmentation_publications",Integer.class)).isEqualTo(3);
    }

    @Test void failedUploadOrReadbackNeverMakesTheLastGoodFileEligibleForDeletion() {
        publish(0);
        doThrow(new ApiException(HttpStatus.SERVICE_UNAVAILABLE,"offline")).when(orthanc).importDicom(any());
        assertThatThrownBy(()->publish(1)).isInstanceOf(ApiException.class);
        retention.cleanupSuperseded();
        doReturn(new OrthancService.ImportResult("Success",NEW)).when(orthanc).importDicom(any());
        when(codec.decodeLabelmap(any(),anyList())).thenReturn(new DicomSegCodec.Labelmap(LABELS,List.of()));
        assertThatThrownBy(()->publish(1)).isInstanceOf(ApiException.class);
        retention.cleanupSuperseded();
        assertThat(segmentations.status(dataset,SERIES,USER).publishedVersion()).isEqualTo(1);
        verify(orthanc,never()).deleteSegmentation(anyString());
    }

    @Test void cleanupFailureDoesNotRollBackPublicationAndIsRetriedFromDurableMetadata() {
        publish(0); publish(1);
        doThrow(new ApiException(HttpStatus.SERVICE_UNAVAILABLE,"offline")).doNothing().when(orthanc).deleteSegmentation(OLD);
        retention.cleanupSuperseded();
        assertThat(deleted()).isZero();
        assertThat(segmentations.status(dataset,SERIES,USER).orthancId()).isEqualTo(NEW);
        retention.cleanupSuperseded();
        assertThat(deleted()).isEqualTo(1);
        verify(orthanc,times(2)).deleteSegmentation(OLD);
    }

    @Test void missingReplacementPreservesPreviousFileUntilReplacementIsReadable() {
        publish(0); publish(1);
        when(orthanc.instanceMetadata(NEW)).thenThrow(new ApiException(HttpStatus.NOT_FOUND,"missing"));
        retention.cleanupSuperseded();
        assertThat(deleted()).isZero();
        verify(orthanc,never()).deleteSegmentation(anyString());
        doReturn(null).when(orthanc).instanceMetadata(NEW);
        retention.cleanupSuperseded();
        verify(orthanc).deleteSegmentation(OLD);
    }

    @Test void rolledBackReplacementCannotDeletePreviousSnapshot() {
        publish(0);
        new TransactionTemplate(manager).executeWithoutResult(tx->{
            publish(1);
            retention.cleanupSuperseded();
            tx.setRollbackOnly();
        });
        retention.cleanupSuperseded();
        verify(orthanc,never()).deleteSegmentation(anyString());
        assertThat(segmentations.status(dataset,SERIES,USER).publishedVersion()).isEqualTo(1);
    }

    @Test void activeReferencesAndPendingJobsProtectAnOtherwiseSupersededFile() {
        publish(0); publish(1);
        // A second stream may still use the same physical object.
        String other = datasets.create("Other",USER).id();
        db.update("INSERT INTO segmentation_publications (dataset_id,series_id,version,author_issuer,author_subject,author_username,created_at,label,orthanc_id) "
                + "VALUES (?,?,1,'issuer','alice','alice','now','Heart',?)",other,SERIES,OLD);
        retention.cleanupSuperseded();
        verify(orthanc,never()).deleteSegmentation(anyString());
        db.update("DELETE FROM segmentation_publications WHERE dataset_id=?",other);
        db.update("INSERT INTO dataset_instances VALUES (?,?,?)",other,OLD,"1");
        retention.cleanupSuperseded();
        verify(orthanc,never()).deleteSegmentation(anyString());
        db.update("DELETE FROM dataset_instances WHERE dataset_id=?",other);
        db.update("INSERT INTO mask_snapshot_jobs VALUES (?,?,10,'{}',?,FALSE)",dataset,SERIES,OLD);
        retention.cleanupSuperseded();
        verify(orthanc,never()).deleteSegmentation(anyString());
        db.update("DELETE FROM mask_snapshot_jobs");
        retention.cleanupSuperseded();
        verify(orthanc).deleteSegmentation(OLD);
    }

    @Test void readerReloadsTheCurrentPublicationIfTheOldFileIsDeletedDuringDownload() {
        publish(0);
        when(orthanc.file(OLD)).thenAnswer(call->{
            publish(1);
            throw new ApiException(HttpStatus.NOT_FOUND,"replaced");
        });
        var current=segmentations.labelmap(dataset,SERIES,USER);
        assertThat(current.status().orthancId()).isEqualTo(NEW);
        assertThat(current.status().publishedVersion()).isEqualTo(2);
        assertThat(current.data()).isEqualTo(DATA);
    }

    @Test void automaticArchivesUseTheSameRetentionAndKeepEraseAsTheLatestState() {
        String client="client-alice-001";
        String lease=collaboration.lease(dataset,SERIES,new CollaborationService.LeaseRequest(client,null,"acquire"),USER).leaseId();
        collaboration.commit(dataset,SERIES,new CollaborationService.Batch(client,lease,List.of(
                new CollaborationService.Operation(UUID.randomUUID().toString(),0,LABELS,DATA.masks()))),USER);
        collaboration.archive(dataset,SERIES);
        assertThat(segmentations.status(dataset,SERIES,USER).publishedVersion()).isEqualTo(1);
        collaboration.commit(dataset,SERIES,new CollaborationService.Batch(client,lease,List.of(
                new CollaborationService.Operation(UUID.randomUUID().toString(),1,LABELS,List.of(new DicomSegCodec.Mask(CT,List.of(0,2,0)))))),USER);
        var empty=new DicomSegCodec.Labelmap(LABELS,List.of());
        when(codec.decodeLabelmap(any(),anyList())).thenReturn(empty);
        collaboration.archive(dataset,SERIES);
        retention.cleanupSuperseded();
        verify(orthanc).deleteSegmentation(OLD);
        verify(orthanc,never()).deleteSegmentation(NEW);
        assertThat(segmentations.labelmap(dataset,SERIES,USER).data().masks()).isEmpty();
        assertThat(collaboration.state(dataset,SERIES,client,USER).throughSeq()).isEqualTo(2);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM mask_ops",Integer.class)).isEqualTo(2);
        assertThat(db.queryForObject("SELECT plan_json FROM mask_snapshot_jobs WHERE orthanc_id=?",String.class,OLD)).isEqualTo("{}");
        assertThat(db.queryForObject("SELECT plan_json FROM mask_snapshot_jobs WHERE orthanc_id=?",String.class,NEW)).contains("Heart");
    }
}
