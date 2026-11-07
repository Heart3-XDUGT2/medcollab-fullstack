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
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.OidcLoginRequestPostProcessor;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest(properties={"keycloak.client-secret=test","app.datasets.seed-enabled=false",
        "spring.datasource.url=jdbc:h2:mem:team-dissolution;DB_CLOSE_DELAY=-1",
        "app.collaboration.scan-ms=3600000","app.datasets.reclamation-ms=3600000","app.segmentation.cleanup-ms=3600000"})
@AutoConfigureMockMvc
class TeamDissolutionTests {
    static final String ISSUER=DatasetLibraryTests.ISSUER;
    static final DemoSession.Identity A=DatasetLibraryTests.A,B=DatasetLibraryTests.B,C=DatasetLibraryTests.C;
    static final String CT="11111111-11111111-11111111-11111111-11111111",UNIQUE="team-only-ct",SEG="team-seg",SERIES="series";
    @Autowired DatasetService datasets;
    @Autowired TeamService teams;
    @Autowired DatasetReclamationService reclamation;
    @Autowired HomeActivityService activity;
    @Autowired CollaborationService collaboration;
    @Autowired SegmentationStorageGuard guard;
    @Autowired JdbcTemplate db;
    @Autowired MockMvc mvc;
    @Autowired PlatformTransactionManager manager;
    @MockitoBean OrthancService orthanc;
    @MockitoBean KeycloakDirectoryService directory;
    @MockitoBean DicomSegCodec codec;
    String team,code,one,two,personal;

    @BeforeEach void prepare() {
        for(String table:List.of("dataset_deletion_objects","storage_reclamation","dataset_forwards","mask_snapshot_jobs","mask_slice_leases","mask_ops","mask_rooms",
                "segmentation_drafts","segmentation_publications","dataset_favorites","dataset_recent_opens","dataset_open_events","annotation_activity_ops","annotation_activity_slices",
                "dataset_teams","dataset_grants","dataset_instances","datasets","dataset_lineages","team_members","teams")) db.update("DELETE FROM "+table);
        for(var u:List.of(A,B,C)) when(directory.requireUser(u.subject())).thenReturn(new KeycloakDirectoryService.DirectoryUser(u.subject(),u.username()));
        var created=teams.create("要解散的组",A);team=created.team().id();code=created.inviteCode();teams.addMember(team,B.subject(),A);
        one=datasets.createTeamDataset(team,"Alice CT",A).id();two=datasets.createTeamDataset(team,"Bob CT",B).id();personal=datasets.create("其他人的独立持有",C).id();
        for(String id:List.of(one,two,personal))db.update("INSERT INTO dataset_instances VALUES (?,?,'1')",id,CT);
        db.update("INSERT INTO dataset_instances VALUES (?,?,'2')",two,UNIQUE);
        db.update("INSERT INTO segmentation_publications (dataset_id,series_id,version,author_issuer,author_subject,author_username,created_at,label,orthanc_id) VALUES (?,?,1,?,?,?,'2026-01-01T00:00:00Z','test',?)",two,SERIES,ISSUER,B.subject(),B.username(),SEG);
        activity.favorite(one,A);activity.favorite(two,B);
        clearInvocations(orthanc,codec);
    }
    OidcLoginRequestPostProcessor login(DemoSession.Identity u) {return oidcLogin().idToken(t->t.subject(u.subject()).claim("iss",u.issuer()).claim("preferred_username",u.username()));}
    void error(Runnable action,HttpStatus status) {assertThatThrownBy(action::run).isInstanceOfSatisfying(ApiException.class,e->assertThat(e.status()).isEqualTo(status));}
    @Test void leaderClearsAllUploadersAndReclaimsOnlyObjectsWithoutOtherHolders() {
        var result=datasets.dissolveTeam(team,A);
        assertThat(result.deletedDatasets()).isEqualTo(2);assertThat(result.pendingObjects()).isEqualTo(3);
        assertThat(teams.mine(A).items()).isEmpty();assertThat(teams.mine(B).items()).isEmpty();
        assertThat(activity.favorites(A,0,20).items()).isEmpty();assertThat(activity.favorites(B,0,20).items()).isEmpty();
        verifyNoInteractions(orthanc);
        reclamation.cleanup();
        verify(orthanc).deleteUnreferencedInstance(UNIQUE);verify(orthanc).deleteUnreferencedInstance(SEG);
        verify(orthanc,never()).deleteUnreferencedInstance(CT);
        var state=datasets.dissolutionStatus(team,A);
        assertThat(state.deletedObjects()).isEqualTo(2);assertThat(state.retainedObjects()).isEqualTo(1);assertThat(state.pendingObjects()).isZero();
        assertThat(datasets.instances(personal,C).total()).isEqualTo(1);
        // Keeping the team association prevents former uploaders falling back to personal ownership.
        assertThat(datasets.list(B).items()).isEmpty();error(()->datasets.requireDatasetAccess(two,B,false),HttpStatus.NOT_FOUND);
    }
    @Test void authenticationCsrfAndCurrentLeadershipAreRequired() throws Exception {
        mvc.perform(delete("/api/teams/"+team).with(csrf())).andExpect(status().isUnauthorized());
        mvc.perform(delete("/api/teams/"+team).with(login(A))).andExpect(status().isForbidden());
        mvc.perform(delete("/api/teams/"+team).with(login(B)).with(csrf())).andExpect(status().isForbidden());
        mvc.perform(delete("/api/teams/"+team).with(login(C)).with(csrf())).andExpect(status().isNotFound());
        assertThat(datasets.teamDatasets(team,A).total()).isEqualTo(2);verifyNoInteractions(orthanc);
        teams.transfer(team,B.subject(),A);error(()->datasets.dissolveTeam(team,A),HttpStatus.FORBIDDEN);
        datasets.dissolveTeam(team,B);
        error(()->datasets.dissolutionStatus(team,A),HttpStatus.NOT_FOUND);
    }
    @Test void originalLeaderCanRetryAndQueryCleanupWithoutReenqueuingDeletedFiles() throws Exception {
        mvc.perform(get("/api/teams/"+team+"/dissolution-status").with(login(A))).andExpect(status().isNotFound());
        mvc.perform(delete("/api/teams/"+team).with(login(A)).with(csrf())).andExpect(status().isOk())
                .andExpect(header().string("Cache-Control","no-store")).andExpect(jsonPath("$.deletedDatasets").value(2));
        reclamation.cleanup();
        var repeated=datasets.dissolveTeam(team,A);assertThat(repeated.pendingObjects()).isZero();assertThat(repeated.deletedDatasets()).isEqualTo(2);
        reclamation.cleanup();verify(orthanc,times(1)).deleteUnreferencedInstance(UNIQUE);
        mvc.perform(get("/api/teams/"+team+"/dissolution-status").with(login(A))).andExpect(status().isOk()).andExpect(jsonPath("$.retainedObjects").value(1));
        mvc.perform(get("/api/teams/"+team+"/dissolution-status").with(login(B))).andExpect(status().isNotFound());
    }
    @Test void dissolvedTeamInviteSearchAndAllDatasetEntrypointsAreUnavailable() throws Exception {
        datasets.dissolveTeam(team,A);
        assertThat(teams.search(team,A).items()).isEmpty();
        error(()->teams.join(team,code,C),HttpStatus.NOT_FOUND);
        error(()->teams.addMember(team,C.subject(),A),HttpStatus.NOT_FOUND);
        error(()->datasets.createTeamDataset(team,"New",A),HttpStatus.NOT_FOUND);
        for(var user:List.of(A,B)) {
            mvc.perform(get("/api/teams/"+team).with(login(user))).andExpect(status().isNotFound());
            for(String suffix:List.of("/instances","/workspace","/dicomweb/studies","/segmentations/series/labelmap","/annotation-stats","/segmentations/series/collaboration/state?clientId=client-test-001"))
                mvc.perform(get("/api/datasets/"+two+suffix).with(login(user))).andExpect(status().isNotFound());
        }
        verifyNoInteractions(orthanc,codec);
    }
    @Test void activeDraftsLeasesAndQueuedSnapshotsAreExplicitlyClearedAndQueuedObjectsReclaimed() {
        db.update("INSERT INTO mask_rooms (dataset_id,series_id,seq,through_seq,published_version,data_json,sources_json,expires_at,archived_at,archive_error) VALUES (?,?,2,0,0,'{}','[]',?,0,'')",one,SERIES,System.currentTimeMillis()+60000);
        db.update("INSERT INTO mask_snapshot_jobs VALUES (?,?,1,'{}','pending-snapshot-object',FALSE)",one,SERIES);
        var result=datasets.dissolveTeam(team,A);assertThat(result.pendingObjects()).isEqualTo(4);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM mask_rooms",Long.class)).isZero();
        assertThat(db.queryForObject("SELECT COUNT(*) FROM mask_snapshot_jobs",Long.class)).isZero();
        reclamation.cleanup();verify(orthanc).deleteUnreferencedInstance("pending-snapshot-object");
    }
    @Test void previouslyDeletedTeamDatasetsAreAlsoIncludedInReclamation() {
        datasets.deleteTeamDataset(team,two,B);
        var result=datasets.dissolveTeam(team,A);assertThat(result.deletedDatasets()).isEqualTo(1);assertThat(result.pendingObjects()).isEqualTo(3);
        reclamation.cleanup();verify(orthanc).deleteUnreferencedInstance(SEG);
    }
    @Test void emptyTeamDissolvesAndKeepsAnIdempotentReceipt() {
        String empty=teams.create("Empty",A).team().id();
        var result=datasets.dissolveTeam(empty,A);assertThat(result.deletedDatasets()).isZero();assertThat(result.pendingObjects()).isZero();
        assertThat(datasets.dissolveTeam(empty,A)).isEqualTo(result);
    }
    @Test void databaseFailureRollsBackAllDeletionAndMembershipChanges() {
        db.execute("ALTER TABLE teams ADD CONSTRAINT fixture_no_dissolution CHECK (dissolved_at IS NULL)");
        try {assertThatThrownBy(()->datasets.dissolveTeam(team,A)).isInstanceOf(org.springframework.dao.DataAccessException.class);}
        finally {db.execute("ALTER TABLE teams DROP CONSTRAINT fixture_no_dissolution");}
        assertThat(datasets.teamDatasets(team,A).total()).isEqualTo(2);assertThat(teams.members(team,A).total()).isEqualTo(2);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM storage_reclamation",Long.class)).isZero();
        assertThat(activity.favorites(A,0,20).total()).isEqualTo(1);
        assertThat(guard.cleanupIfIdle(()->{})).isTrue();verifyNoInteractions(orthanc);
    }
    @Test void dissolutionWaitsForInFlightSnapshotAndRegistersItsUploadedObject() throws Exception {
        var entered=new CountDownLatch(1);var release=new CountDownLatch(1);var requested=new CountDownLatch(1);
        try(var executor=Executors.newVirtualThreadPerTaskExecutor()) {
            var uploading=executor.submit(()->guard.reference(()->{
                entered.countDown();
                try {if(!release.await(5,TimeUnit.SECONDS)) throw new AssertionError("upload timed out");}catch(InterruptedException e){throw new AssertionError(e);}
                db.update("INSERT INTO mask_snapshot_jobs VALUES (?,?,1,'{}','in-flight-object',FALSE)",one,SERIES);
                return null;
            }));
            assertThat(entered.await(2,TimeUnit.SECONDS)).isTrue();
            var deleting=executor.submit(()->{requested.countDown();return datasets.dissolveTeam(team,A);});
            try {assertThat(requested.await(2,TimeUnit.SECONDS)).isTrue();assertThatThrownBy(()->deleting.get(150,TimeUnit.MILLISECONDS)).isInstanceOf(TimeoutException.class);}
            finally {release.countDown();}
            uploading.get(3,TimeUnit.SECONDS);assertThat(deleting.get(3,TimeUnit.SECONDS).pendingObjects()).isEqualTo(4);
        }
        reclamation.cleanup();verify(orthanc).deleteUnreferencedInstance("in-flight-object");
    }
    @Test void exclusiveBarrierStaysHeldThroughAnOuterTransactionCommit() throws Exception {
        var deleted=new CountDownLatch(1);var finish=new CountDownLatch(1);
        try(var executor=Executors.newVirtualThreadPerTaskExecutor()) {
            var transaction=executor.submit(()->new TransactionTemplate(manager).execute(ignored->{
                datasets.dissolveTeam(team,A);deleted.countDown();
                try {if(!finish.await(5,TimeUnit.SECONDS)) throw new AssertionError("commit timed out");}catch(InterruptedException e){throw new AssertionError(e);}
                return null;
            }));
            try {assertThat(deleted.await(3,TimeUnit.SECONDS)).isTrue();assertThat(guard.cleanupIfIdle(()->fail("cleanup before commit"))).isFalse();}
            finally {finish.countDown();}
            transaction.get(3,TimeUnit.SECONDS);
        }
        assertThat(guard.cleanupIfIdle(()->{})).isTrue();
    }
    @Test void reclamationFailureIsRetryableWithoutRestoringTheTeam() {
        datasets.dissolveTeam(team,A);
        doThrow(new ApiException(HttpStatus.SERVICE_UNAVAILABLE,"fixture")).doNothing().when(orthanc).deleteUnreferencedInstance(UNIQUE);
        reclamation.cleanup();assertThat(datasets.dissolutionStatus(team,A).pendingObjects()).isEqualTo(1);
        assertThat(teams.mine(A).items()).isEmpty();reclamation.cleanup();assertThat(datasets.dissolutionStatus(team,A).pendingObjects()).isZero();
    }

    @Test void httpRejectsKnownBadFormatsAndDisguisedTextCannotCreateAnInstanceAssociation() throws Exception {
        for(String name:List.of("notes.txt","image.jpg","volume.nii.gz","archive.zip"))
            mvc.perform(multipart("/api/import").file(new org.springframework.mock.web.MockMultipartFile("file",name,"application/octet-stream",new byte[]{1}))
                    .param("datasetId",one).with(login(A)).with(csrf())).andExpect(status().isUnsupportedMediaType()).andExpect(jsonPath("$.error").isString());
        verifyNoInteractions(orthanc);
        when(orthanc.importDicomFile(any())).thenThrow(new ApiException(HttpStatus.BAD_REQUEST,"文件不是有效的 DICOM 影像，或 Orthanc 无法导入"));
        mvc.perform(multipart("/api/import").file(new org.springframework.mock.web.MockMultipartFile("file","renamed.dcm","application/dicom","plain text".getBytes()))
                .param("datasetId",one).with(login(A)).with(csrf())).andExpect(status().isBadRequest());
        assertThat(datasets.instances(one,A).total()).isEqualTo(1);
    }

    @Test void actualCollaborativeArchiveCanFinishBeforeDissolutionWithoutLeavingAnUnregisteredObject() throws Exception {
        when(codec.sources(anyList())).thenReturn(List.of(new DicomSegCodec.SourceImage(CT,"1",SERIES,"CT",4,5,"1.2.3")));
        var segments=List.of(new DicomSegCodec.Segment(1,"Synthetic",List.of(255,0,0)));
        var data=new DicomSegCodec.Labelmap(segments,List.of(new DicomSegCodec.Mask(CT,List.of(0,2,1))));
        String client="client-test-001";
        String lease=collaboration.lease(one,SERIES,new CollaborationService.LeaseRequest(client,null,"acquire"),A).leaseId();
        collaboration.commit(one,SERIES,new CollaborationService.Batch(client,lease,List.of(new CollaborationService.Operation(UUID.randomUUID().toString(),0,segments,data.masks()))),A);
        when(codec.encodeLabelmap(anyList(),anyString(),any())).thenReturn(new byte[]{9});
        when(codec.decodeLabelmap(any(),anyList())).thenReturn(data);when(orthanc.file("archive-result")).thenReturn(new byte[]{9});
        var uploading=new CountDownLatch(1);var release=new CountDownLatch(1);
        when(orthanc.importDicom(any())).thenAnswer(call->{
            uploading.countDown();if(!release.await(5,TimeUnit.SECONDS)) throw new AssertionError("archive timed out");
            return new OrthancService.ImportResult("Success","archive-result");
        });
        try(var executor=Executors.newVirtualThreadPerTaskExecutor()) {
            var archive=executor.submit(()->collaboration.archive(one,SERIES));
            assertThat(uploading.await(3,TimeUnit.SECONDS)).isTrue();
            var deletion=executor.submit(()->datasets.dissolveTeam(team,A));
            try {assertThatThrownBy(()->deletion.get(150,TimeUnit.MILLISECONDS)).isInstanceOf(TimeoutException.class);}
            finally {release.countDown();}
            archive.get(3,TimeUnit.SECONDS);assertThat(deletion.get(3,TimeUnit.SECONDS).pendingObjects()).isEqualTo(4);
        }
        reclamation.cleanup();verify(orthanc).deleteUnreferencedInstance("archive-result");
        assertThat(db.queryForObject("SELECT COUNT(*) FROM mask_snapshot_jobs",Long.class)).isZero();
    }
}
