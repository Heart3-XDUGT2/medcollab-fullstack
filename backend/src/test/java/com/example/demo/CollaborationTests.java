package com.example.demo;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties={"keycloak.client-secret=test", "app.datasets.seed-enabled=false",
        "spring.datasource.url=jdbc:h2:mem:collaboration-tests;DB_CLOSE_DELAY=-1", "app.collaboration.scan-ms=3600000"})
@AutoConfigureMockMvc
class CollaborationTests {
    static final String ISSUER="http://127.0.0.1:8081/realms/medical-demo";
    static final DemoSession.Identity ALICE=new DemoSession.Identity(ISSUER,"alice-sub","alice");
    static final DemoSession.Identity BOB=new DemoSession.Identity(ISSUER,"bob-sub","bob");
    static final String SERIES="aaaaaaaa-aaaaaaaa-aaaaaaaa-aaaaaaaa-aaaaaaaa";
    static final String ONE="11111111-11111111-11111111-11111111-11111111";
    static final String TWO="22222222-22222222-22222222-22222222-22222222";
    static final String CLIENT="client-alice-001";
    static final List<DicomSegCodec.SourceImage> SOURCES=List.of(new DicomSegCodec.SourceImage(ONE,"1",SERIES,"CT",4,5,"1.2.3.1"),
            new DicomSegCodec.SourceImage(TWO,"2",SERIES,"CT",4,5,"1.2.3.2"));
    static final List<DicomSegCodec.Segment> SEGMENTS=List.of(new DicomSegCodec.Segment(1,"心脏",List.of(255,80,80)));
    @Autowired CollaborationService collaboration;
    @Autowired SegmentationService segmentations;
    @Autowired DatasetService datasets;
    @Autowired TeamService teams;
    @Autowired JdbcTemplate db;
    @Autowired MockMvc mvc;
    @MockitoBean OrthancService orthanc;
    @MockitoBean DicomSegCodec codec;
    @MockitoBean KeycloakDirectoryService directory;
    String dataset,lease;
    @BeforeEach void setup() {
        dataset=datasets.create("CT",ALICE).id();
        db.update("INSERT INTO dataset_instances VALUES (?,?,?)",dataset,ONE,"1");
        db.update("INSERT INTO dataset_instances VALUES (?,?,?)",dataset,TWO,"2");
        when(codec.sources(anyList())).thenReturn(SOURCES);
        when(directory.requireUser(BOB.subject())).thenReturn(new KeycloakDirectoryService.DirectoryUser(BOB.subject(),BOB.username()));
        when(codec.encodeLabelmap(anyList(),anyString(),any())).thenReturn(new byte[]{1,2});
        when(orthanc.importDicom(any())).thenReturn(new OrthancService.ImportResult("Success","seg-id"));
        when(orthanc.file("seg-id")).thenReturn(new byte[]{1,2});
        lease=collaboration.lease(dataset,SERIES,new CollaborationService.LeaseRequest(CLIENT,null,"acquire"),ALICE).leaseId();
    }
    CollaborationService.Operation op(long base,Integer... runs) {
        return new CollaborationService.Operation(UUID.randomUUID().toString(),base,SEGMENTS,List.of(new DicomSegCodec.Mask(ONE,List.of(runs))));
    }
    List<CollaborationService.Committed> commit(CollaborationService.Operation... ops) {
        return collaboration.commit(dataset,SERIES,new CollaborationService.Batch(CLIENT,lease,List.of(ops)),ALICE);
    }
    @Test void commitsErasesAndReplaysIdenticalIdsOnlyOnce() {
        var first=op(0,1,3,1);var receipt=commit(first);
        assertThat(receipt.getFirst().seq()).isEqualTo(1);
        assertThat(commit(first)).isEqualTo(receipt);
        commit(op(1,2,1,0));
        var state=collaboration.state(dataset,SERIES,CLIENT,ALICE);
        assertThat(state.seq()).isEqualTo(2);
        assertThat(state.data().masks()).containsExactly(new DicomSegCodec.Mask(ONE,List.of(1,1,1,3,1,1)));
        assertThat(collaboration.operations(dataset,SERIES,CLIENT,0,ALICE).operations()).hasSize(2);
        verify(orthanc,never()).importDicom(any());
    }
    @Test void changedPayloadOrAnotherAuthorCannotReuseAnOperationId() {
        var original=op(0,0,2,1);commit(original);
        var changed=new CollaborationService.Operation(original.clientOpId(),0,SEGMENTS,List.of());
        assertStatus(409,()->commit(changed));
        datasets.share(dataset,BOB.subject(),ALICE);
        assertStatus(409,()->collaboration.commit(dataset,SERIES,new CollaborationService.Batch(CLIENT,lease,List.of(original)),BOB));
        assertThat(collaboration.state(dataset,SERIES,CLIENT,ALICE).seq()).isEqualTo(1);
    }
    @Test void leaseIsPerPageAndExpiredTokenCannotWriteAfterHandoff() {
        datasets.share(dataset,BOB.subject(),ALICE);
        assertStatus(423,()->collaboration.lease(dataset,SERIES,new CollaborationService.LeaseRequest("other-tab-001",null,"acquire"),ALICE));
        db.update("UPDATE mask_rooms SET expires_at=0 WHERE dataset_id=?",dataset);
        var other=collaboration.lease(dataset,SERIES,new CollaborationService.LeaseRequest("other-tab-001",null,"acquire"),BOB);
        assertThat(other.leaseId()).isNotEqualTo(lease);
        assertStatus(423,()->commit(op(0,0,1,1)));
        assertThat(collaboration.state(dataset,SERIES,CLIENT,ALICE).lease().leaseId()).isNull();
    }
    @Test void acknowledgedRetryWorksAfterLeaseExpiryButNewOperationsDoNot() {
        var first=op(0,0,2,1);commit(first);
        db.update("UPDATE mask_rooms SET expires_at=0 WHERE dataset_id=?",dataset);
        assertThat(commit(first).getFirst().seq()).isEqualTo(1);
        assertStatus(423,()->commit(op(1,4,1,1)));
    }
    @Test void invalidBatchRollsBackEarlierOperationsAndDoesNotLeaveSequenceGaps() {
        assertStatus(409,()->commit(op(0,0,1,1),op(50,1,1,1)));
        assertThat(collaboration.state(dataset,SERIES,CLIENT,ALICE).seq()).isZero();
        assertThat(commit(op(0,0,1,1)).getFirst().seq()).isEqualTo(1);
    }
    @Test void rejectsOutOfSeriesUnknownLabelsOverlapsAndOutOfBounds() {
        for(var operation:List.of(op(0,19,2,1),op(0,0,1,99),op(0,0,4,1,2,1,1),
                new CollaborationService.Operation(UUID.randomUUID().toString(),0,SEGMENTS,List.of(new DicomSegCodec.Mask("other",List.of(0,1,1))))))
            assertStatus(400,()->commit(operation));
        assertThat(collaboration.state(dataset,SERIES,CLIENT,ALICE).seq()).isZero();
    }
    @Test void legacyPublicationsCannotBypassCollaborativeOwnership() {
        assertStatus(409,()->segmentations.publishLabelmap(dataset,SERIES,new SegmentationService.LabelmapRequest(0,"Test",
                new DicomSegCodec.Labelmap(SEGMENTS,List.of()),UUID.randomUUID().toString()),ALICE));
        assertStatus(409,()->segmentations.publish(dataset,SERIES,new SegmentationService.PublishRequest(0,"Test",List.of(),UUID.randomUUID().toString()),ALICE));
    }
    @Test void snapshotHasFixedWatermarkAndAllowsNewCommitsDuringEncoding() {
        commit(op(0,0,2,1));
        var atOne=collaboration.state(dataset,SERIES,CLIENT,ALICE).data();
        when(codec.decodeLabelmap(any(),anyList())).thenReturn(atOne);
        when(codec.encodeLabelmap(anyList(),anyString(),any())).thenAnswer(call->{commit(op(1,4,2,1));return new byte[]{1,2};});
        collaboration.archive(dataset,SERIES);
        var state=collaboration.state(dataset,SERIES,CLIENT,ALICE);
        assertThat(state.seq()).isEqualTo(2);assertThat(state.throughSeq()).isEqualTo(1);assertThat(state.publishedVersion()).isEqualTo(1);
        assertThat(state.data().masks().getFirst().runs()).containsExactly(0,2,1,4,2,1);
        assertThat(db.queryForObject("SELECT through_seq FROM segmentation_publications WHERE dataset_id=?",Long.class,dataset)).isEqualTo(1);
    }
    @Test void failedArchiveKeepsOperationsAndRetriesTheSameFixedJob() {
        commit(op(0,0,1,1));var first=collaboration.state(dataset,SERIES,CLIENT,ALICE).data();
        when(orthanc.importDicom(any())).thenThrow(new ApiException(HttpStatus.BAD_GATEWAY,"test"));
        collaboration.archive(dataset,SERIES);
        assertThat(collaboration.state(dataset,SERIES,CLIENT,ALICE).throughSeq()).isZero();
        commit(op(1,2,1,1));
        doReturn(new OrthancService.ImportResult("Success","seg-id")).when(orthanc).importDicom(any());
        when(codec.decodeLabelmap(any(),anyList())).thenReturn(first);
        collaboration.archive(dataset,SERIES);
        var state=collaboration.state(dataset,SERIES,CLIENT,ALICE);
        assertThat(state.throughSeq()).isEqualTo(1);assertThat(state.seq()).isEqualTo(2);assertThat(state.archiveError()).isEmpty();
    }
    @Test void unauthorizedHttpAndMissingCsrfAreRejected() throws Exception {
        String path="/api/datasets/"+dataset+"/segmentations/"+SERIES+"/collaboration";
        mvc.perform(get(path+"/state?clientId="+CLIENT)).andExpect(status().isUnauthorized());
        mvc.perform(get(path+"/state?clientId="+CLIENT).with(oidcLogin().idToken(t->t.subject(BOB.subject()).claim("iss",ISSUER))))
                .andExpect(status().isNotFound());
        mvc.perform(post(path+"/lease").with(oidcLogin()).contentType("application/json").content("{}"))
                .andExpect(status().isForbidden());
        mvc.perform(post(path+"/ops/batch").with(oidcLogin().idToken(t->t.subject(ALICE.subject()).claim("iss",ISSUER)))
                .with(csrf()).header("X-Medcollab-Subject",BOB.subject()).header("X-Medcollab-Issuer",ISSUER)
                .contentType("application/json").content("{\"clientId\":\"client-alice-001\",\"operations\":[]}"))
                .andExpect(status().isConflict());
        mvc.perform(get("/ws/medcollab?datasetId="+dataset+"&seriesId="+SERIES)).andExpect(status().isUnauthorized());
    }
    @Test void teamMembershipIsCheckedAgainAfterTheRoomExists() {
        String team=teams.create("Team",ALICE).team().id();teams.addMember(team,BOB.subject(),ALICE);
        String teamDataset=datasets.createTeamDataset(team,"CT",ALICE).id();
        db.update("INSERT INTO dataset_instances VALUES (?,?,?)",teamDataset,ONE,"1");
        collaboration.state(teamDataset,SERIES,"client-bob-001",BOB);
        teams.removeMember(team,BOB.subject(),ALICE);
        assertStatus(404,()->collaboration.state(teamDataset,SERIES,"client-bob-001",BOB));
    }
    private static void assertStatus(int expected,Runnable action) {
        assertThatThrownBy(action::run).isInstanceOfSatisfying(ApiException.class,e->assertThat(e.status().value()).isEqualTo(expected));
    }
    String slice(String client,DemoSession.Identity user,String... ids) {
        return collaboration.sliceLease(dataset,SERIES,new CollaborationService.SliceRequest(client,null,"acquire",List.of(ids)),user)
                .stream().filter(CollaborationService.SliceLease::heldBySelf).findFirst().orElseThrow().leaseId();
    }
    void useSlices() {
        collaboration.lease(dataset,SERIES,new CollaborationService.LeaseRequest(CLIENT,lease,"release"),ALICE);
        datasets.share(dataset,BOB.subject(),ALICE);
        db.update("UPDATE mask_rooms SET data_json=? WHERE dataset_id=?",tools.jackson.databind.json.JsonMapper.builder().build()
                .writeValueAsString(new DicomSegCodec.Labelmap(SEGMENTS,List.of())),dataset);
    }
    @Test void differentSlicesAcceptConcurrentStaleGlobalSequencesAndKeepBothMasks() {
        useSlices();
        String alice=slice(CLIENT,ALICE,ONE),bob=slice("client-bob-001",BOB,TWO);
        var a=op(0,0,2,1);
        var b=new CollaborationService.Operation(UUID.randomUUID().toString(),0,SEGMENTS,List.of(new DicomSegCodec.Mask(TWO,List.of(4,2,1))));
        collaboration.commit(dataset,SERIES,new CollaborationService.Batch(CLIENT,alice,List.of(a),true),ALICE);
        var receipt=collaboration.commit(dataset,SERIES,new CollaborationService.Batch("client-bob-001",bob,List.of(b),true),BOB);
        assertThat(receipt.getFirst().seq()).isEqualTo(2);
        assertThat(collaboration.state(dataset,SERIES,CLIENT,ALICE).data().masks()).containsExactlyInAnyOrder(
                new DicomSegCodec.Mask(ONE,List.of(0,2,1)),new DicomSegCodec.Mask(TWO,List.of(4,2,1)));
        assertThat(collaboration.commit(dataset,SERIES,new CollaborationService.Batch("client-bob-001",bob,List.of(b),true),BOB)).isEqualTo(receipt);
    }
    @Test void sameSliceIsExclusiveAndMultiSliceAcquisitionRollsBackAtomically() {
        useSlices();slice(CLIENT,ALICE,ONE);
        assertStatus(423,()->slice("client-bob-001",BOB,TWO,ONE));
        assertThat(collaboration.state(dataset,SERIES,"client-bob-001",BOB).sliceLeases()).hasSize(1);
        assertStatus(423,()->collaboration.lease(dataset,SERIES,new CollaborationService.LeaseRequest("client-bob-001",null,"acquire"),BOB));
        assertThat(slice("client-bob-001",BOB,TWO)).isNotBlank();
    }
    @Test void sliceTokenCannotWriteAnotherSliceOrChangeGlobalLabels() {
        useSlices();String token=slice(CLIENT,ALICE,ONE);
        var two=new CollaborationService.Operation(UUID.randomUUID().toString(),0,SEGMENTS,List.of(new DicomSegCodec.Mask(TWO,List.of(0,1,1))));
        assertStatus(423,()->collaboration.commit(dataset,SERIES,new CollaborationService.Batch(CLIENT,token,List.of(two),true),ALICE));
        var metadata=new CollaborationService.Operation(UUID.randomUUID().toString(),0,List.of(new DicomSegCodec.Segment(1,"改名",List.of(255,80,80))),List.of());
        assertStatus(423,()->collaboration.commit(dataset,SERIES,new CollaborationService.Batch(CLIENT,token,List.of(metadata),true),ALICE));
        assertThat(collaboration.state(dataset,SERIES,CLIENT,ALICE).seq()).isZero();
    }
    @Test void expiredSliceTokenAndOldOfflineStrokeCannotOverwriteNewHolder() {
        useSlices();String alice=slice(CLIENT,ALICE,ONE);
        db.update("UPDATE mask_slice_leases SET expires_at=0 WHERE dataset_id=?",dataset);
        String bob=slice("client-bob-001",BOB,ONE);
        collaboration.commit(dataset,SERIES,new CollaborationService.Batch("client-bob-001",bob,List.of(op(0,0,1,1)),true),BOB);
        assertStatus(423,()->collaboration.commit(dataset,SERIES,new CollaborationService.Batch(CLIENT,alice,List.of(op(0,1,1,1)),true),ALICE));
        db.update("UPDATE mask_slice_leases SET expires_at=0 WHERE dataset_id=?",dataset);
        String next=slice(CLIENT,ALICE,ONE);
        assertStatus(409,()->collaboration.commit(dataset,SERIES,new CollaborationService.Batch(CLIENT,next,List.of(op(0,1,1,1)),true),ALICE));
    }
}
