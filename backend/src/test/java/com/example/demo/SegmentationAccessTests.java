package com.example.demo;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oidcLogin;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.OidcLoginRequestPostProcessor;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = {"keycloak.client-secret=unused-test-secret",
        "spring.datasource.url=jdbc:h2:mem:segmentation-tests;DB_CLOSE_DELAY=-1", "app.datasets.seed-enabled=false"})
@AutoConfigureMockMvc
class SegmentationAccessTests {
    private static final String ISSUER = "http://127.0.0.1:8081/realms/medical-demo";
    private static final DemoSession.Identity ALICE = new DemoSession.Identity(ISSUER,"alice-sub","alice");
    private static final DemoSession.Identity BOB = new DemoSession.Identity(ISSUER,"bob-sub","bob");
    private static final String ONE = "11111111-11111111-11111111-11111111-11111111";
    private static final String TWO = "22222222-22222222-22222222-22222222-22222222";
    private static final String OTHER = "33333333-33333333-33333333-33333333-33333333";
    private static final String SEG = "44444444-44444444-44444444-44444444-44444444";
    private static final String SERIES = "aaaaaaaa-aaaaaaaa-aaaaaaaa-aaaaaaaa-aaaaaaaa";
    private static final List<DicomSegCodec.SourceImage> SOURCES = List.of(
            new DicomSegCodec.SourceImage(ONE,"1",SERIES,"Test CT",4,5,"1.2.3.1"),
            new DicomSegCodec.SourceImage(TWO,"2",SERIES,"Test CT",4,5,"1.2.3.2"));
    private static final List<DicomSegCodec.Mask> MASKS = List.of(new DicomSegCodec.Mask(ONE,List.of(1,3,9,2)));
    @Autowired SegmentationService segmentations;
    @Autowired DatasetService datasets;
    @Autowired TeamService teams;
    @Autowired JdbcTemplate db;
    @Autowired MockMvc mvc;
    @MockitoBean OrthancService orthanc;
    @MockitoBean KeycloakDirectoryService directory;
    @MockitoBean DicomSegCodec codec;
    private String dataset;

    @BeforeEach
    void reset() {
        db.update("DELETE FROM segmentation_drafts");
        db.update("DELETE FROM segmentation_publications");
        db.update("DELETE FROM dataset_teams");
        db.update("DELETE FROM dataset_grants");
        db.update("DELETE FROM dataset_instances");
        db.update("DELETE FROM datasets");
        db.update("DELETE FROM dataset_migrations");
        dataset = datasets.create("CT",ALICE).id();
        db.update("INSERT INTO dataset_instances VALUES (?,?,?)",dataset,ONE,"1");
        db.update("INSERT INTO dataset_instances VALUES (?,?,?)",dataset,TWO,"2");
        when(codec.sources(anyList())).thenAnswer(call -> {
            List<OrthancService.InstanceItem> items = call.getArgument(0);
            return SOURCES.stream().filter(s -> items.stream().anyMatch(i -> i.id().equals(s.id()))).toList();
        });
        when(directory.requireUser(BOB.subject())).thenReturn(new KeycloakDirectoryService.DirectoryUser(BOB.subject(),BOB.username()));
        when(codec.encode(anyList(),anyString(),anyList())).thenReturn(new byte[]{4,5,6});
        doReturn(new OrthancService.ImportResult("Success",SEG)).when(orthanc).importDicom(any());
        when(orthanc.file(SEG)).thenReturn(new byte[]{4,5,6});
        when(codec.decode(any(),anyList())).thenReturn(MASKS);
    }


    @Test
    void publicationNeedsNoServerDraftAndReadersGetActualOrthancPixels() {
        enableTeamCoediting();
        var published = segmentations.publish(dataset,SERIES,request(0,MASKS),ALICE);
        assertThat(published.publishedVersion()).isEqualTo(1);
        assertThat(published.orthancId()).isEqualTo(SEG);
        assertThat(db.queryForObject("SELECT annotated_slice_count FROM segmentation_publications WHERE dataset_id=?",Integer.class,dataset)).isEqualTo(1);
        assertThat(published.masks()).isEqualTo(MASKS);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM segmentation_drafts",Integer.class)).isZero();
        assertThat(datasets.instances(dataset,ALICE).total()).isEqualTo(2);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM dataset_instances WHERE instance_id=?",Integer.class,SEG)).isZero();
        clearInvocations(orthanc,codec);
        assertThat(segmentations.workspace(dataset,SERIES,BOB).masks()).isEqualTo(MASKS);
        verify(orthanc).file(SEG);
        verify(codec).decode(any(),anyList());
        assertThat(segmentations.file(dataset,SERIES,BOB)).containsExactly(4,5,6);
    }

    @Test
    void teamMemberCanPublishAndReadUntilRemovedWhilePublicationRemainsInTeam() {
        var team=teams.create("Annotation team",ALICE);
        teams.addMember(team.team().id(),BOB.subject(),ALICE);
        db.update("INSERT INTO dataset_teams VALUES (?,?)",dataset,team.team().id());
        assertThat(segmentations.publish(dataset,SERIES,request(0,MASKS),BOB).publishedVersion()).isEqualTo(1);
        assertThat(segmentations.workspace(dataset,SERIES,ALICE).masks()).isEqualTo(MASKS);
        teams.removeMember(team.team().id(),BOB.subject(),ALICE);
        assertThatThrownBy(()->segmentations.workspace(dataset,SERIES,BOB)).isInstanceOfSatisfying(ApiException.class,
                e->assertThat(e.status()).isEqualTo(HttpStatus.NOT_FOUND));
        assertThat(segmentations.workspace(dataset,SERIES,ALICE).publishedVersion()).isEqualTo(1);
    }

    @Test
    void uploadRetriesAreIdempotentButCannotReuseAnIdForDifferentPixelsOrAccount() {
        enableTeamCoediting();
        var request = request(0,MASKS);
        segmentations.publish(dataset,SERIES,request,ALICE);
        clearInvocations(orthanc);
        assertThat(segmentations.publish(dataset,SERIES,request,ALICE).publishedVersion()).isEqualTo(1);
        assertConflict(() -> segmentations.publish(dataset,SERIES,request,BOB));
        var changed = new SegmentationService.PublishRequest(0,"Changed",MASKS,request.publicationId());
        assertConflict(() -> segmentations.publish(dataset,SERIES,changed,ALICE));
        verify(orthanc,never()).importDicom(any());
        assertThat(db.queryForObject("SELECT COUNT(*) FROM segmentation_publications",Integer.class)).isEqualTo(1);
    }

    @Test
    void sharedAndPublicUsersCanPublishButStaleBaseCannotOverwriteAnotherVersion() {
        enableTeamCoediting();
        segmentations.publish(dataset,SERIES,request(0,MASKS),ALICE);
        clearInvocations(orthanc);
        assertConflict(() -> segmentations.publish(dataset,SERIES,request(0,MASKS),BOB));
        verify(orthanc,never()).importDicom(any());
        assertThat(segmentations.publish(dataset,SERIES,request(1,MASKS),BOB).publishedVersion()).isEqualTo(2);
        db.update("UPDATE datasets SET is_public=TRUE WHERE id=?",dataset);
        assertThat(segmentations.publish(dataset,SERIES,request(2,MASKS),ALICE).publishedVersion()).isEqualTo(3);
        assertThat(segmentations.status(dataset,SERIES,BOB).publishedBy()).isEqualTo("alice");
    }

    @Test
    void legacyDraftsArePrivateReadDeleteOnlyAndNeverMixedIntoPublishedWorkspace() {
        enableTeamCoediting();
        seedLegacy(BOB,7);
        assertThat(segmentations.legacyDraft(dataset,SERIES,BOB).masks()).isEqualTo(MASKS);
        assertThat(segmentations.legacyDraft(dataset,SERIES,ALICE)).isNull();
        assertThat(segmentations.workspace(dataset,SERIES,BOB).masks()).isEmpty();
        assertConflict(() -> segmentations.acknowledgeLegacyDraft(dataset,SERIES,6,BOB));
        assertThat(segmentations.legacyDraft(dataset,SERIES,BOB).revision()).isEqualTo(7);
        segmentations.acknowledgeLegacyDraft(dataset,SERIES,7,ALICE);
        assertThat(segmentations.legacyDraft(dataset,SERIES,BOB)).isNotNull();
        segmentations.acknowledgeLegacyDraft(dataset,SERIES,7,BOB);
        assertThat(segmentations.legacyDraft(dataset,SERIES,BOB)).isNull();
        verify(orthanc,never()).importDicom(any());
    }

    @Test
    void invalidRunsUnknownInstancesAndCrossSeriesTargetsAreRejected() {
        List<List<DicomSegCodec.Mask>> badMasks = List.of(
                List.of(new DicomSegCodec.Mask(ONE,List.of(-1,1))),
                List.of(new DicomSegCodec.Mask(ONE,List.of(0,0))),
                List.of(new DicomSegCodec.Mask(ONE,List.of(19,2))),
                List.of(new DicomSegCodec.Mask(ONE,List.of(1,3,2,2))),
                List.of(new DicomSegCodec.Mask(ONE,List.of(1))),
                List.of(new DicomSegCodec.Mask(OTHER,List.of(0,1))),
                List.of(new DicomSegCodec.Mask(ONE,List.of(0,1)),new DicomSegCodec.Mask(ONE,List.of(2,1))));
        for (var masks : badMasks) assertBadRequest(() -> segmentations.publish(dataset,SERIES,request(0,masks),ALICE));
        assertBadRequest(() -> segmentations.publish(dataset,SERIES,new SegmentationService.PublishRequest(0,"Mask",null,"invalid"),ALICE));
        assertThatThrownBy(() -> segmentations.workspace(dataset,"different-series",ALICE))
                .isInstanceOfSatisfying(ApiException.class,e -> assertThat(e.status()).isEqualTo(HttpStatus.NOT_FOUND));
        verify(orthanc,never()).importDicom(any());
    }

    @Test
    void canonicalRunsMergeAndEntirePublishedMaskCanBeErased() {
        assertBadRequest(() -> segmentations.publish(dataset,SERIES,request(0,List.of()),ALICE));
        var canonical = request(0,List.of(new DicomSegCodec.Mask(TWO,List.of()),
                new DicomSegCodec.Mask(ONE,List.of(1,2,3,1,9,2))));
        assertThat(segmentations.publish(dataset,SERIES,canonical,ALICE).masks()).isEqualTo(MASKS);
        when(codec.decode(any(),anyList())).thenReturn(List.of());
        var cleared = segmentations.publish(dataset,SERIES,request(1,List.of()),ALICE);
        assertThat(cleared.publishedVersion()).isEqualTo(2);
        assertThat(cleared.masks()).isEmpty();
    }

    @Test
    void failedUploadOrRoundTripDoesNotAdvancePublishedVersionOrPersistAnyDraft() {
        when(orthanc.importDicom(any())).thenThrow(new ApiException(HttpStatus.SERVICE_UNAVAILABLE,"test unavailable"));
        assertThatThrownBy(() -> segmentations.publish(dataset,SERIES,request(0,MASKS),ALICE)).isInstanceOf(ApiException.class);
        assertThat(segmentations.status(dataset,SERIES,ALICE).publishedVersion()).isZero();
        doReturn(new OrthancService.ImportResult("Success",SEG)).when(orthanc).importDicom(any());
        when(codec.decode(any(),anyList())).thenReturn(List.of(new DicomSegCodec.Mask(TWO,List.of(0,1))));
        assertThatThrownBy(() -> segmentations.publish(dataset,SERIES,request(0,MASKS),ALICE))
                .isInstanceOfSatisfying(ApiException.class,e -> assertThat(e.status()).isEqualTo(HttpStatus.BAD_GATEWAY));
        assertThat(segmentations.status(dataset,SERIES,ALICE).publishedVersion()).isZero();
        assertThat(db.queryForObject("SELECT COUNT(*) FROM segmentation_drafts",Integer.class)).isZero();
    }

    @Test
    void unsharedAndAnonymousUsersCannotReadOrPublishAndWritesRequireCsrf() throws Exception {
        clearInvocations(codec,orthanc);
        mvc.perform(get("/api/datasets/"+dataset+"/segmentation/sources").with(login(BOB))).andExpect(status().isNotFound());
        for (String suffix : List.of("","/status","/file","/legacy-draft"))
            mvc.perform(get(path()+suffix).with(login(BOB))).andExpect(status().isNotFound());
        mvc.perform(post(path()+"/publish").with(login(BOB)).with(csrf()).contentType("application/json").content(body()))
                .andExpect(status().isNotFound());
        mvc.perform(get(path())).andExpect(status().isUnauthorized());
        mvc.perform(post(path()+"/publish").with(login(ALICE)).contentType("application/json").content(body()))
                .andExpect(status().isForbidden());
        mvc.perform(delete(path()+"/legacy-draft").param("revision","1").with(login(ALICE)))
                .andExpect(status().isForbidden());
        verify(codec,never()).sources(anyList());
        verify(orthanc,never()).importDicom(any());
    }

    @Test
    void retiredDraftEndpointReturnsGoneAndStatusContainsOnlyPublicationMetadata() throws Exception {
        mvc.perform(put(path()+"/draft").with(login(ALICE)).with(csrf()).contentType("application/json").content("{}"))
                .andExpect(status().isGone());
        mvc.perform(get(path()+"/status").with(login(ALICE))).andExpect(status().isOk())
                .andExpect(jsonPath("$.hasDraft").doesNotExist()).andExpect(jsonPath("$.masks").doesNotExist());
        assertThat(db.queryForObject("SELECT COUNT(*) FROM segmentation_drafts",Integer.class)).isZero();
    }

    @Test
    void busyDatasetLockReturnsRetryable423WithoutPublishingAnything() throws Exception {
        try (var holding = db.getDataSource().getConnection()) {
            holding.setAutoCommit(false);
            try (var statement = holding.prepareStatement("SELECT id FROM datasets WHERE id=? FOR UPDATE")) {
                statement.setString(1,dataset);
                try (var rows = statement.executeQuery()) { assertThat(rows.next()).isTrue(); }
            }
            mvc.perform(post(path()+"/publish").with(login(ALICE)).with(csrf()).contentType("application/json").content(body()))
                    .andExpect(status().isLocked());
            assertThat(segmentations.status(dataset,SERIES,ALICE).publishedVersion()).isZero();
            holding.rollback();
        }
        mvc.perform(post(path()+"/publish").with(login(ALICE)).with(csrf()).contentType("application/json").content(body()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.publishedVersion").value(1));
    }

    private void seedLegacy(DemoSession.Identity user, long revision) {
        String masks = tools.jackson.databind.json.JsonMapper.builder().build().writeValueAsString(MASKS);
        db.update("INSERT INTO segmentation_drafts VALUES (?,?,?,?,?,?,?,?,?)",dataset,SERIES,user.issuer(),user.subject(),
                revision,0,"Mask",masks,java.time.Instant.now().toString());
    }

    private DicomSegCodec.Labelmap multi() {
        return new DicomSegCodec.Labelmap(List.of(new DicomSegCodec.Segment(1,"Heart",List.of(255,80,80)),
                new DicomSegCodec.Segment(3,"Lung",List.of(50,220,80))),List.of(new DicomSegCodec.Mask(ONE,List.of(1,3,1,10,2,3))));
    }
    @Test void labelmapPublishUsesOrthancAndIsIdempotentAcrossRetries() {
        when(codec.encodeLabelmap(anyList(),anyString(),any())).thenReturn(new byte[]{4,5,6});
        when(codec.decodeLabelmap(any(),anyList())).thenReturn(multi());
        enableTeamCoediting();
        var request=new SegmentationService.LabelmapRequest(0,"Multi",multi(),java.util.UUID.randomUUID().toString());
        assertThat(segmentations.publishLabelmap(dataset,SERIES,request,ALICE).publishedVersion()).isEqualTo(1);
        clearInvocations(orthanc);
        assertThat(segmentations.publishLabelmap(dataset,SERIES,request,ALICE).publishedVersion()).isEqualTo(1);
        verify(orthanc,never()).importDicom(any());
        assertThat(segmentations.labelmap(dataset,SERIES,BOB).data()).isEqualTo(multi());
        assertConflict(()->segmentations.publishLabelmap(dataset,SERIES,request,BOB));
        assertConflict(()->segmentations.publishLabelmap(dataset,SERIES,new SegmentationService.LabelmapRequest(0,"Multi",multi(),java.util.UUID.randomUUID().toString()),BOB));
        segmentations.publishLabelmap(dataset,SERIES,new SegmentationService.LabelmapRequest(1,"Multi",multi(),java.util.UUID.randomUUID().toString()),BOB);
        assertThat(segmentations.publishLabelmap(dataset,SERIES,request,ALICE).publishedVersion()).isEqualTo(1);
        assertThat(segmentations.status(dataset,SERIES,ALICE).publishedVersion()).isEqualTo(2);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM segmentation_drafts",Integer.class)).isZero();
    }
    @Test void labelmapRejectsOutOfMembershipOverlapsAndUnknownLabelsBeforeOrthanc() {
        for(var masks:List.of(List.of(new DicomSegCodec.Mask(OTHER,List.of(0,1,1))),
                List.of(new DicomSegCodec.Mask(ONE,List.of(0,4,1,2,1,3))),
                List.of(new DicomSegCodec.Mask(ONE,List.of(0,1,99))),
                List.of(new DicomSegCodec.Mask(ONE,List.of(19,2,1))))) {
            assertBadRequest(()->segmentations.publishLabelmap(dataset,SERIES,new SegmentationService.LabelmapRequest(0,"Multi",new DicomSegCodec.Labelmap(multi().segments(),masks),java.util.UUID.randomUUID().toString()),ALICE));
        }
        verify(orthanc,never()).importDicom(any());
    }
    @Test void labelmapExportIsTransientAndPrivateRoutesStayPrivate() throws Exception {
        when(codec.encodeLabelmap(anyList(),anyString(),any())).thenReturn(new byte[]{4,5,6});
        assertThat(segmentations.exportLabelmap(dataset,SERIES,new SegmentationService.LabelmapRequest(0,"Multi",multi(),java.util.UUID.randomUUID().toString()),ALICE)).containsExactly(4,5,6);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM segmentation_drafts",Integer.class)).isZero();
        assertThat(db.queryForObject("SELECT COUNT(*) FROM segmentation_publications",Integer.class)).isZero();
        verify(orthanc,never()).importDicom(any());
        mvc.perform(get(path()+"/labelmap").with(login(BOB))).andExpect(status().isNotFound());
        mvc.perform(post(path()+"/export-labelmap").with(login(BOB)).with(csrf()).contentType("application/json").content("{\"expectedPublishedVersion\":0,\"label\":\"Multi\"}")).andExpect(status().isNotFound());
    }
    private String path() { return "/api/datasets/"+dataset+"/segmentations/"+SERIES; }
    private String body() { return tools.jackson.databind.json.JsonMapper.builder().build().writeValueAsString(request(0,MASKS)); }
    private static SegmentationService.PublishRequest request(long base,List<DicomSegCodec.Mask> masks) {
        return new SegmentationService.PublishRequest(base,"Mask",masks,java.util.UUID.randomUUID().toString());
    }
    private static OidcLoginRequestPostProcessor login(DemoSession.Identity user) {
        return oidcLogin().idToken(t -> t.subject(user.subject()).claim("iss",user.issuer()).claim("preferred_username",user.username()));
    }
    private static void assertBadRequest(Runnable action) {
        assertThatThrownBy(action::run).isInstanceOfSatisfying(ApiException.class,e -> assertThat(e.status()).isEqualTo(HttpStatus.BAD_REQUEST));
    }
    private static void assertConflict(Runnable action) {
        assertThatThrownBy(action::run).isInstanceOfSatisfying(ApiException.class,e -> assertThat(e.status()).isEqualTo(HttpStatus.CONFLICT));
    }
    // Coediting now belongs to a team; personal forwards have independent IDs.
    private void enableTeamCoediting() {
        if(db.queryForObject("SELECT COUNT(*) FROM dataset_teams WHERE dataset_id=?",Integer.class,dataset)>0) return;
        var team=teams.create("Coediting fixture",ALICE).team().id();
        teams.addMember(team,BOB.subject(),ALICE);
        db.update("INSERT INTO dataset_teams VALUES (?,?)",dataset,team);
    }
}
