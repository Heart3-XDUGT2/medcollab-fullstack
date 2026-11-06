package com.example.demo;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties={"keycloak.client-secret=test","app.datasets.seed-enabled=false",
        "spring.datasource.url=jdbc:h2:mem:forward-delete;DB_CLOSE_DELAY=-1",
        "app.collaboration.scan-ms=3600000","app.datasets.reclamation-ms=3600000","app.segmentation.cleanup-ms=3600000"})
@AutoConfigureMockMvc
class DatasetForwardingDeletionTests {
    static final String ISSUER="http://127.0.0.1:8081/realms/medical-demo";
    static final DemoSession.Identity A=new DemoSession.Identity(ISSUER,"alice-sub","alice"),
            B=new DemoSession.Identity(ISSUER,"bob-sub","bob"),C=new DemoSession.Identity(ISSUER,"carol-sub","carol");
    static final String CT="11111111-11111111-11111111-11111111-11111111",SEG="22222222-22222222-22222222-22222222-22222222",SERIES="source-series";
    @Autowired DatasetService datasets;
    @Autowired DatasetReclamationService reclamation;
    @Autowired SegmentationRetentionService retention;
    @Autowired CollaborationService collaboration;
    @Autowired AnnotationStatisticsService statistics;
    @Autowired HomeActivityService activity;
    @Autowired TeamService teams;
    @Autowired JdbcTemplate db;
    @Autowired MockMvc mvc;
    @MockitoBean OrthancService orthanc;
    @MockitoBean DicomSegCodec codec;
    @MockitoBean KeycloakDirectoryService directory;
    Set<String> physical;
    @BeforeEach void reset() {
        for(String table:List.of("dataset_deletion_objects","storage_reclamation","dataset_forwards","mask_snapshot_jobs","mask_slice_leases","mask_ops","mask_rooms",
                "segmentation_drafts","segmentation_publications","dataset_favorites","dataset_recent_opens","dataset_open_events","annotation_activity_ops","annotation_activity_slices",
                "dataset_teams","dataset_grants","dataset_instances","datasets","dataset_lineages","team_members","teams")) db.update("DELETE FROM "+table);
        physical=ConcurrentHashMap.newKeySet();physical.add(CT);physical.add(SEG);
        for(var user:List.of(A,B,C)) when(directory.requireUser(user.subject())).thenReturn(new KeycloakDirectoryService.DirectoryUser(user.subject(),user.username()));
        when(codec.sources(anyList())).thenReturn(List.of(new DicomSegCodec.SourceImage(CT,"1",SERIES,"CT",4,5,"1.2.3")));
        when(orthanc.instance(CT)).thenReturn(new OrthancService.InstanceItem(CT,"1"));
        when(orthanc.file(CT)).thenReturn(new byte[]{1});
        doAnswer(call->{physical.remove(call.getArgument(0));return null;}).when(orthanc).deleteUnreferencedInstance(anyString());
        clearInvocations(orthanc);
    }
    String create(DemoSession.Identity user) {var id=datasets.create("Synthetic CT",user).id();db.update("INSERT INTO dataset_instances VALUES (?,?,?)",id,CT,"1");return id;}
    void publication(String dataset,String id,int version) {
        db.update("INSERT INTO segmentation_publications (dataset_id,series_id,version,author_issuer,author_subject,author_username,created_at,label,orthanc_id) VALUES (?,?,?,?,?,?,?,?,?)",
                dataset,SERIES,version,ISSUER,A.subject(),A.username(),"2026-11-06T00:00:00Z","Synthetic",id);
    }
    void gone(String dataset,DemoSession.Identity user) {
        assertThatThrownBy(()->datasets.instances(dataset,user)).isInstanceOfSatisfying(ApiException.class,e->assertThat(e.status()).isEqualTo(HttpStatus.NOT_FOUND));
    }
    @Test void forwardingGivesAnIndependentOwnedSnapshotAndNoAccessToSendersId() {
        String source=create(A);publication(source,SEG,1);
        String copy=datasets.share(source,B.subject(),A).recipientDatasetId();
        assertThat(copy).isNotEqualTo(source);
        assertThat(datasets.list(B).items()).singleElement().satisfies(d->{assertThat(d.access()).isEqualTo("owner");assertThat(d.canDelete()).isTrue();assertThat(d.ownerUsername()).isEqualTo("bob");});
        gone(source,B);gone(copy,A);
        datasets.rename(copy,"Bob's name",B);
        assertThat(datasets.list(A).items().getFirst().name()).isEqualTo("Synthetic CT");
        assertThat(db.queryForObject("SELECT orthanc_id FROM segmentation_publications WHERE dataset_id=?",String.class,copy)).isEqualTo(SEG);
        verifyNoInteractions(orthanc);
    }
    @Test void repeatedForwardAndForwardBackDoNotDuplicateOrOverwriteAnExistingHolding() {
        String source=create(A),copy=datasets.share(source,B.subject(),A).recipientDatasetId();
        datasets.rename(copy,"Bob independent",B);
        var again=datasets.share(source,B.subject(),A);
        assertThat(again.recipientDatasetId()).isEqualTo(copy);assertThat(again.alreadyOwned()).isTrue();
        assertThat(datasets.list(B).total()).isEqualTo(1);
        assertThat(datasets.list(B).items().getFirst().name()).isEqualTo("Bob independent");
        assertThat(datasets.share(copy,A.subject(),B).recipientDatasetId()).isEqualTo(source);
    }
    @Test void senderDeletionKeepsRecipientAndRecipientCanSendItBackWithANewId() {
        String source=create(A);publication(source,SEG,1);
        String copy=datasets.share(source,B.subject(),A).recipientDatasetId();
        datasets.deletePersonal(source,A);reclamation.cleanup();
        gone(source,A);assertThat(datasets.instances(copy,B).total()).isEqualTo(1);
        assertThat(physical).contains(CT,SEG);verify(orthanc,never()).deleteUnreferencedInstance(anyString());
        String restored=datasets.share(copy,A.subject(),B).recipientDatasetId();
        assertThat(restored).isNotIn(source,copy);assertThat(datasets.list(A).items()).extracting(DatasetService.DatasetItem::id).containsExactly(restored);
        gone(source,A);
    }
    @Test void deletedRecipientCanReceiveAgainDespiteExistingForwardReceipt() {
        String source=create(A),old=datasets.share(source,B.subject(),A).recipientDatasetId();
        datasets.deletePersonal(old,B);reclamation.cleanup();
        String next=datasets.share(source,B.subject(),A).recipientDatasetId();
        assertThat(next).isNotEqualTo(old);gone(old,B);assertThat(datasets.instances(next,B).total()).isEqualTo(1);
    }
    @Test void independentUploadOfTheSameInstanceProtectsItUntilItsLastHolderDeletes() {
        String one=create(A),two=create(B);
        datasets.deletePersonal(one,A);reclamation.cleanup();assertThat(physical).contains(CT);
        datasets.deletePersonal(two,B);reclamation.cleanup();assertThat(physical).doesNotContain(CT);
        verify(orthanc,times(1)).deleteUnreferencedInstance(CT);
        datasets.deletePersonal(two,B);reclamation.cleanup();verify(orthanc,times(1)).deleteUnreferencedInstance(CT);
    }
    @Test void sameOwnerOtherDatasetPublicAndTeamMembershipAlsoProtectPhysicalData() {
        String one=create(A),two=create(A);
        db.update("UPDATE datasets SET is_public=TRUE WHERE id=?",two);
        var team=teams.create("Synthetic team",B).team().id();
        String teamData=datasets.createTeamDataset(team,"CT",B).id();db.update("INSERT INTO dataset_instances VALUES (?,?,?)",teamData,CT,"1");
        datasets.deletePersonal(one,A);reclamation.cleanup();
        assertThat(physical).contains(CT);verifyNoInteractions(orthanc);
    }
    @Test void lastHolderDeletionRemovesCTAndAllItsUnreferencedSegVersions() {
        String source=create(A);publication(source,"old-seg",1);publication(source,SEG,2);physical.add("old-seg");
        datasets.deletePersonal(source,A);reclamation.cleanup();
        assertThat(physical).doesNotContain(CT,SEG,"old-seg");
        assertThat(reclamation.result(source).deletedObjects()).isEqualTo(3);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM segmentation_publications WHERE dataset_id=? AND storage_deleted_at IS NULL",Long.class,source)).isZero();
    }
    @Test void currentSegHeldInAnotherDatasetsPublicationIsNotDeleted() {
        String source=create(A),other=create(B);publication(source,SEG,1);publication(other,SEG,1);
        datasets.deletePersonal(source,A);reclamation.cleanup();assertThat(physical).contains(SEG);
        datasets.deletePersonal(other,B);reclamation.cleanup();assertThat(physical).doesNotContain(SEG);
    }
    @Test void deletedSourceReceiptDoesNotPinAnOldSegAfterRecipientAdvances() {
        String source=create(A);publication(source,SEG,1);
        String copy=datasets.share(source,B.subject(),A).recipientDatasetId();
        datasets.deletePersonal(source,A);reclamation.cleanup();
        publication(copy,"replacement-seg",2);
        retention.cleanupSuperseded();
        verify(orthanc).deleteSegmentation(SEG);
    }
    @Test void activeSnapshotReferenceProtectsAnOtherwiseUnheldObject() {
        String source=create(A),other=datasets.create("Job",B).id();
        db.update("INSERT INTO mask_snapshot_jobs VALUES (?,?,1,'{}',?,FALSE)",other,SERIES,CT);
        datasets.deletePersonal(source,A);reclamation.cleanup();verifyNoInteractions(orthanc);
    }
    @Test void transientStorageFailureLeavesARestartSafeRetryReceipt() {
        String source=create(A);
        doThrow(new ApiException(HttpStatus.SERVICE_UNAVAILABLE,"fixture")).doAnswer(call->{physical.remove(CT);return null;}).when(orthanc).deleteUnreferencedInstance(CT);
        datasets.deletePersonal(source,A);reclamation.cleanup();
        assertThat(reclamation.result(source).pendingObjects()).isEqualTo(1);assertThat(physical).contains(CT);
        reclamation.cleanup();assertThat(reclamation.result(source).deletedObjects()).isEqualTo(1);assertThat(physical).doesNotContain(CT);
    }
    @Test void deletionEnforcesOwnershipPublicTeamAuthenticationAndCsrf() throws Exception {
        String source=create(A);
        var a=oidcLogin().idToken(t->t.subject(A.subject()).claim("iss",ISSUER));
        var b=oidcLogin().idToken(t->t.subject(B.subject()).claim("iss",ISSUER));
        mvc.perform(delete("/api/datasets/"+source).with(csrf())).andExpect(status().isUnauthorized());
        mvc.perform(delete("/api/datasets/"+source).with(a)).andExpect(status().isForbidden());
        mvc.perform(delete("/api/datasets/"+source).with(b).with(csrf())).andExpect(status().isNotFound());
        db.update("UPDATE datasets SET is_public=TRUE WHERE id=?",source);
        mvc.perform(delete("/api/datasets/"+source).with(a).with(csrf())).andExpect(status().isForbidden());
        var team=teams.create("Team",A).team().id();String id=datasets.createTeamDataset(team,"CT",A).id();
        mvc.perform(delete("/api/datasets/"+id).with(a).with(csrf())).andExpect(status().isBadRequest());
        verifyNoInteractions(orthanc);
    }
    @Test void deleteHidesAllEntriesAndRemovesFavoritesWithoutTouchingAnotherCopy() throws Exception {
        String source=create(A),copy=datasets.share(source,B.subject(),A).recipientDatasetId();activity.favorite(source,A);activity.favorite(copy,B);
        var a=oidcLogin().idToken(t->t.subject(A.subject()).claim("iss",ISSUER));
        mvc.perform(delete("/api/datasets/"+source).with(a).with(csrf())).andExpect(status().isOk()).andExpect(jsonPath("$.success").value(true));
        for(String suffix:List.of("/instances","/workspace","/dicomweb/studies","/segmentation/sources","/segmentations/x/labelmap","/annotation-stats","/segmentations/x/collaboration/state?clientId=client-test-001"))
            mvc.perform(get("/api/datasets/"+source+suffix).with(a)).andExpect(status().isNotFound());
        assertThat(activity.favorites(A,0,20).items()).isEmpty();assertThat(activity.favorites(B,0,20).items()).hasSize(1);
        assertThat(datasets.instances(copy,B).total()).isEqualTo(1);
    }
    @Test void activeLeaseDirtyCanvasAndUnfinishedJobBlockDeletion() {
        String source=create(A);
        collaboration.lease(source,SERIES,new CollaborationService.LeaseRequest("client-test-001",null,"acquire"),A);
        assertThatThrownBy(()->datasets.deletePersonal(source,A)).isInstanceOfSatisfying(ApiException.class,e->assertThat(e.status()).isEqualTo(HttpStatus.CONFLICT));
        db.update("UPDATE mask_rooms SET expires_at=0,seq=1 WHERE dataset_id=?",source);
        assertThatThrownBy(()->datasets.deletePersonal(source,A)).isInstanceOf(ApiException.class);
        db.update("UPDATE mask_rooms SET seq=0 WHERE dataset_id=?",source);
        db.update("INSERT INTO mask_snapshot_jobs VALUES (?,?,1,'{}',NULL,FALSE)",source,SERIES);
        assertThatThrownBy(()->datasets.deletePersonal(source,A)).isInstanceOf(ApiException.class);
        assertThat(datasets.instances(source,A).total()).isEqualTo(1);
    }
    @Test void deletionStatusIsPrivateAndReportsAsynchronousReclamation() throws Exception {
        String source=create(A);
        var a=oidcLogin().idToken(t->t.subject(A.subject()).claim("iss",ISSUER));
        var b=oidcLogin().idToken(t->t.subject(B.subject()).claim("iss",ISSUER));
        String statusPath="/api/datasets/"+source+"/deletion-status";
        mvc.perform(get(statusPath).with(a)).andExpect(status().isNotFound());
        mvc.perform(delete("/api/datasets/"+source).with(a).with(csrf()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.pendingObjects").value(1));
        verifyNoInteractions(orthanc);
        mvc.perform(get(statusPath)).andExpect(status().isUnauthorized());
        mvc.perform(get(statusPath).with(b)).andExpect(status().isNotFound());
        reclamation.cleanup();
        mvc.perform(get(statusPath).with(a)).andExpect(status().isOk())
                .andExpect(jsonPath("$.deletedObjects").value(1)).andExpect(jsonPath("$.pendingObjects").value(0));
    }
    @Test void forwardingSnapshotsAcceptedDirtyCanvasAndArchivesItWithoutInventingPersonalStrokes() {
        String source=create(A);
        String lease=collaboration.lease(source,SERIES,new CollaborationService.LeaseRequest("client-test-001",null,"acquire"),A).leaseId();
        var segments=List.of(new DicomSegCodec.Segment(1,"Synthetic",List.of(255,0,0)));
        var operation=new CollaborationService.Operation(UUID.randomUUID().toString(),0,segments,List.of(new DicomSegCodec.Mask(CT,List.of(0,2,1))));
        collaboration.commit(source,SERIES,new CollaborationService.Batch("client-test-001",lease,List.of(operation)),A);
        var before=statistics.personal(B).totalStrokes();
        String copy=datasets.share(source,B.subject(),A).recipientDatasetId();
        var state=collaboration.state(copy,SERIES,"client-bob-001",B);
        assertThat(state.data().masks()).isEqualTo(operation.masks());assertThat(state.lease().leaseId()).isNull();
        when(codec.encodeLabelmap(anyList(),anyString(),any())).thenReturn(new byte[]{9});
        when(codec.decodeLabelmap(any(),anyList())).thenReturn(state.data());
        when(orthanc.importDicom(any())).thenReturn(new OrthancService.ImportResult("Success",SEG));when(orthanc.file(SEG)).thenReturn(new byte[]{9});
        collaboration.archive(copy,SERIES);
        assertThat(collaboration.state(copy,SERIES,"client-bob-001",B).throughSeq()).isEqualTo(1);
        assertThat(statistics.personal(B).totalStrokes()).isEqualTo(before);
    }
    @Test void migrationConvertsOldGrantsAndMovesRecipientFavoritesIdempotently() {
        String source=create(A);publication(source,SEG,1);
        db.update("INSERT INTO dataset_grants VALUES (?,?,?,?)",source,ISSUER,B.subject(),B.username());
        db.update("INSERT INTO dataset_favorites VALUES (?,?,?,?)",ISSUER,B.subject(),source,1L);
        db.update("DELETE FROM dataset_migrations WHERE id='personal-forward-copy-v1'");
        datasets.migrateForwardingShares();String copy=datasets.list(B).items().getFirst().id();datasets.migrateForwardingShares();
        assertThat(datasets.list(B).items()).hasSize(1);assertThat(copy).isNotEqualTo(source);gone(source,B);
        assertThat(activity.favorites(B,0,20).items().getFirst().dataset().id()).isEqualTo(copy);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM dataset_grants",Long.class)).isZero();
    }
    @Test void niftiNamesAreRejectedBeforeOrthancForEveryCaseVariant() throws Exception {
        String source=create(A);var login=oidcLogin().idToken(t->t.subject(A.subject()).claim("iss",ISSUER));
        for(String name:List.of("ct.nii","ct.NII","ct.nii.gz","ct.NII.GZ"))
            mvc.perform(multipart("/api/import").file(new MockMultipartFile("file",name,"application/octet-stream",new byte[]{1})).param("datasetId",source).with(login).with(csrf()))
                    .andExpect(status().isUnsupportedMediaType()).andExpect(jsonPath("$.error").value(org.hamcrest.Matchers.containsString("NIfTI")));
        verifyNoInteractions(orthanc);
    }
    @Test void inFlightImportMakesCleanupYieldUntilItsNewReferenceCommits() throws Exception {
        String source=create(A),target=datasets.create("Incoming",B).id();var entered=new CountDownLatch(1);var release=new CountDownLatch(1);
        when(orthanc.importDicom(any())).thenAnswer(call->{entered.countDown();if(!release.await(5,TimeUnit.SECONDS))throw new AssertionError("timeout");return new OrthancService.ImportResult("AlreadyStored",CT);});
        try(var pool=Executors.newVirtualThreadPerTaskExecutor()) {
            var incoming=pool.submit(()->datasets.importDicom(target,new byte[]{1},B));
            assertThat(entered.await(5,TimeUnit.SECONDS)).isTrue();
            try { datasets.deletePersonal(source,A);reclamation.cleanup();verify(orthanc,never()).deleteUnreferencedInstance(CT); }
            finally {release.countDown();}
            incoming.get(5,TimeUnit.SECONDS);reclamation.cleanup();assertThat(physical).contains(CT);assertThat(datasets.instances(target,B).total()).isEqualTo(1);
        }
    }
    @Test void cleanupFirstBlocksUploadUntilDeletionFinishesThenTheUploadRestoresTheObject() throws Exception {
        String source=create(A),target=datasets.create("Incoming",B).id();datasets.deletePersonal(source,A);
        var entered=new CountDownLatch(1);var release=new CountDownLatch(1);
        doAnswer(call->{entered.countDown();if(!release.await(5,TimeUnit.SECONDS))throw new AssertionError("timeout");physical.remove(CT);return null;}).when(orthanc).deleteUnreferencedInstance(CT);
        when(orthanc.importDicom(any())).thenAnswer(call->{physical.add(CT);return new OrthancService.ImportResult("Success",CT);});
        try(var pool=Executors.newVirtualThreadPerTaskExecutor()) {
            var cleanup=pool.submit(reclamation::cleanup);assertThat(entered.await(5,TimeUnit.SECONDS)).isTrue();
            var incoming=pool.submit(()->datasets.importDicom(target,new byte[]{1},B));
            try { assertThatThrownBy(()->incoming.get(150,TimeUnit.MILLISECONDS)).isInstanceOf(TimeoutException.class);verify(orthanc,never()).importDicom(any()); }
            finally {release.countDown();}
            cleanup.get(5,TimeUnit.SECONDS);incoming.get(5,TimeUnit.SECONDS);
            assertThat(physical).contains(CT);assertThat(datasets.instances(target,B).total()).isEqualTo(1);
        }
    }
}
