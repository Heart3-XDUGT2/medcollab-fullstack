package com.example.demo;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oidcLogin;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.OidcLoginRequestPostProcessor;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = {"keycloak.client-secret=unused-test-secret",
        "spring.datasource.url=jdbc:h2:mem:dataset-access-tests;DB_CLOSE_DELAY=-1", "app.datasets.seed-enabled=false"})
@AutoConfigureMockMvc
class DatasetAccessTests {
    private static final String ISSUER = "http://127.0.0.1:8081/realms/medical-demo";
    private static final String ONE = "11111111-11111111-11111111-11111111-11111111";
    private static final String TWO = "22222222-22222222-22222222-22222222-22222222";
    private static final DemoSession.Identity ALICE = new DemoSession.Identity(ISSUER, "alice-sub", "alice");
    private static final DemoSession.Identity BOB = new DemoSession.Identity(ISSUER, "bob-sub", "bob");
    private static final DemoSession.Identity CAROL = new DemoSession.Identity(ISSUER, "carol-sub", "carol");
    @Autowired DatasetService datasets;
    @Autowired JdbcTemplate db;
    @Autowired MockMvc mvc;
    @MockitoBean OrthancService orthanc;
    @MockitoBean KeycloakDirectoryService directory;

    @BeforeEach
    void resetDatabase() {
        db.update("DELETE FROM dataset_grants");
        db.update("DELETE FROM dataset_instances");
        db.update("DELETE FROM datasets");
        db.update("DELETE FROM dataset_migrations");
        when(directory.requireUser("bob-sub")).thenReturn(new KeycloakDirectoryService.DirectoryUser("bob-sub", "bob"));
        when(directory.requireUser("carol-sub")).thenReturn(new KeycloakDirectoryService.DirectoryUser("carol-sub", "carol"));
        when(directory.requireUser("alice-sub")).thenReturn(new KeycloakDirectoryService.DirectoryUser("alice-sub", "alice"));
        when(orthanc.instance(ONE)).thenReturn(new OrthancService.InstanceItem(ONE, "1"));
        when(orthanc.instance(TWO)).thenReturn(new OrthancService.InstanceItem(TWO, "2"));
        when(orthanc.preview(ONE)).thenReturn(new byte[]{1,2,3});
        when(orthanc.file(ONE)).thenReturn(new byte[]{4,5,6});
        when(orthanc.status()).thenReturn(new OrthancService.Status(true, "test", "1", 999_999));
    }

    @Test
    void privateDatasetsUseStableSubjectNotUsernameAndRejectOtherIssuers() {
        var mine = datasets.create("Alice CT", ALICE);
        assertThat(datasets.list(BOB).items()).isEmpty();
        assertThat(datasets.list(new DemoSession.Identity(ISSUER, "different-sub", "alice")).items()).isEmpty();
        assertThat(datasets.list(new DemoSession.Identity(ISSUER, "alice-sub", "renamed-alice")).items())
                .extracting(DatasetService.DatasetItem::id).containsExactly(mine.id());
        assertThatThrownBy(() -> datasets.list(new DemoSession.Identity("https://other-issuer", "alice-sub", "alice")))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(HttpStatus.UNAUTHORIZED));
    }

    @Test
    void uploadAssociatesOnlyReturnedInstanceEvenWhenOrthancDeduplicatesSameSeries() {
        var alice = datasets.create("Alice subset", ALICE);
        var bob = datasets.create("Bob subset", BOB);
        when(orthanc.file(ONE)).thenReturn(new byte[]{1});
        when(orthanc.file(TWO)).thenReturn(new byte[]{2});
        when(orthanc.importDicom(any())).thenReturn(new OrthancService.ImportResult("AlreadyStored", ONE),
                new OrthancService.ImportResult("AlreadyStored", TWO), new OrthancService.ImportResult("AlreadyStored", ONE));
        datasets.importDicom(alice.id(), new byte[]{1}, ALICE);
        datasets.importDicom(bob.id(), new byte[]{2}, BOB);
        datasets.importDicom(bob.id(), new byte[]{1}, BOB);
        assertThat(datasets.instances(alice.id(), ALICE).items()).extracting(OrthancService.InstanceItem::id).containsExactly(ONE);
        assertThat(datasets.instances(bob.id(), BOB).items()).extracting(OrthancService.InstanceItem::id).containsExactly(ONE,TWO);
        assertThat(datasets.list(ALICE).items()).extracting(DatasetService.DatasetItem::id).containsExactly(alice.id());
        assertThat(datasets.list(BOB).items()).extracting(DatasetService.DatasetItem::id).containsExactly(bob.id());
        assertThatThrownBy(() -> datasets.requireInstance(alice.id(), TWO, ALICE)).isInstanceOf(ApiException.class);
        verify(orthanc, never()).series();
        verify(orthanc, never()).instances(any());
    }

    @Test
    void guessedDicomUidsCannotClaimAnotherUsersStoredPixels() {
        var mine = datasets.create("Incoming", ALICE);
        when(orthanc.importDicom(any())).thenReturn(new OrthancService.ImportResult("AlreadyStored", ONE));
        when(orthanc.file(ONE)).thenReturn(new byte[]{9,9,9});
        assertThatThrownBy(() -> datasets.importDicom(mine.id(),new byte[]{1,2,3},ALICE))
                .isInstanceOfSatisfying(ApiException.class,e -> assertThat(e.status()).isEqualTo(HttpStatus.CONFLICT));
        assertThat(datasets.instances(mine.id(),ALICE).items()).isEmpty();
    }

    @Test
    void deniedUploadNeverCallsOrthancAndCannotChangePublicOrOtherOwnersMembership() throws Exception {
        var mine = datasets.create("Alice", ALICE);
        clearInvocations(orthanc);
        mvc.perform(multipart("/api/import").file(file()).param("datasetId", mine.id()).with(login(BOB)).with(csrf()))
                .andExpect(status().isNotFound());
        verify(orthanc, never()).importDicom(any());
        verify(orthanc, never()).importDicomFile(any());
        assertThat(datasets.instances(mine.id(), ALICE).total()).isZero();
    }

    @Test
    void inaccessibleDatasetAndMixedDatasetInstanceIdsDenyAllReads() throws Exception {
        var mine = datasets.create("Private", ALICE);
        db.update("INSERT INTO dataset_instances VALUES (?,?,?)", mine.id(), ONE, "1");
        db.update("INSERT INTO datasets (id,name,is_public,owner_issuer,owner_subject,owner_username,created_at) VALUES ('public-test','Public',TRUE,NULL,NULL,'公共影像','2026-10-31T00:00:00Z')");
        for (String path : List.of("/instances", "/shares", "/instances/"+ONE+"/preview", "/instances/"+ONE+"/file")) {
            mvc.perform(get("/api/datasets/"+mine.id()+path).with(login(BOB))).andExpect(status().isNotFound());
        }
        mvc.perform(get("/api/datasets/public-test/instances/"+ONE+"/preview").with(login(BOB))).andExpect(status().isNotFound());
        mvc.perform(get("/api/datasets/public-test/instances/"+ONE+"/file").with(login(BOB))).andExpect(status().isNotFound());
        verify(orthanc, never()).preview(any());
        verify(orthanc, never()).file(any());
    }

    @Test
    void sharedUserCanUploadRenameReshareButCannotRevoke() throws Exception {
        var mine = datasets.create("Private", ALICE);
        String copy=datasets.share(mine.id(), BOB.subject(), ALICE).recipientDatasetId();
        assertThat(datasets.list(BOB).items().getFirst().access()).isEqualTo("owner");
        when(orthanc.importDicom(any())).thenReturn(new OrthancService.ImportResult("AlreadyStored", ONE));
        when(orthanc.file(ONE)).thenReturn(new byte[]{1,2,3});
        when(orthanc.importDicomFile(any())).thenReturn(new OrthancService.ImportResult("AlreadyStored", ONE));
        when(orthanc.matchesDicomFile(org.mockito.ArgumentMatchers.eq(ONE), any())).thenReturn(true);
        mvc.perform(patch("/api/datasets/"+copy).with(login(BOB)).with(csrf())
                        .contentType("application/json").content("{\"name\":\"Shared edit\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.name").value("Shared edit"));
        mvc.perform(multipart("/api/import").file(file()).param("datasetId",copy).with(login(BOB)).with(csrf()))
                .andExpect(status().isOk());
        mvc.perform(get("/api/datasets/"+copy+"/instances/"+ONE+"/preview").with(login(BOB))).andExpect(status().isOk());
        mvc.perform(get("/api/datasets/"+copy+"/instances/"+ONE+"/file").with(login(BOB))).andExpect(status().isOk());
        mvc.perform(put("/api/datasets/"+copy+"/shares").with(login(BOB)).with(csrf())
                        .contentType("application/json").content("{\"subject\":\"carol-sub\"}"))
                .andExpect(status().isOk());
        String carolCopy=datasets.list(CAROL).items().getFirst().id();
        assertThat(datasets.instances(carolCopy,CAROL).total()).isEqualTo(1);
        assertThat(datasets.instances(mine.id(),ALICE).total()).isZero();
        mvc.perform(delete("/api/datasets/"+copy+"/shares/carol-sub").with(login(BOB)).with(csrf())).andExpect(status().isConflict());
        assertThat(datasets.list(CAROL).items()).hasSize(1);
        assertThatThrownBy(() -> datasets.revoke(mine.id(), ALICE.subject(), BOB)).isInstanceOf(ApiException.class);
    }

    @Test
    void diskImportChecksMembershipBeforeOpeningMultipartStream() throws Exception {
        var mine = datasets.create("Private", ALICE);
        var incoming = ImportStreamingTests.file(new byte[]{1,2,3}, 3);
        assertThatThrownBy(() -> datasets.importDicomFile(mine.id(), incoming, BOB))
                .isInstanceOfSatisfying(ApiException.class, error -> assertThat(error.status()).isEqualTo(HttpStatus.NOT_FOUND));
        verify(incoming, never()).getInputStream();
        verify(incoming, never()).getBytes();
        verify(orthanc, never()).importDicomFile(any());
        verify(orthanc, never()).importDicom(any());
    }

    @Test
    void diskDedupMismatchDoesNotGrantPixelsAndAlwaysRemovesStagingFile() throws Exception {
        var mine = datasets.create("Incoming", ALICE);
        Path[] captured = new Path[1];
        when(orthanc.importDicomFile(any())).thenAnswer(call -> {
            captured[0] = call.getArgument(0);
            assertThat(Files.exists(captured[0])).isTrue();
            return new OrthancService.ImportResult("AlreadyStored", ONE);
        });
        when(orthanc.matchesDicomFile(org.mockito.ArgumentMatchers.eq(ONE), any())).thenReturn(false);
        var incoming = ImportStreamingTests.file(new byte[]{1,2,3}, 3);
        assertThatThrownBy(() -> datasets.importDicomFile(mine.id(), incoming, ALICE))
                .isInstanceOfSatisfying(ApiException.class, error -> assertThat(error.status()).isEqualTo(HttpStatus.CONFLICT));
        assertThat(Files.exists(captured[0])).isFalse();
        assertThat(datasets.instances(mine.id(), ALICE).items()).isEmpty();
        verify(orthanc, never()).file(any());
        verify(orthanc, never()).importDicom(any());
        verify(incoming, never()).getBytes();
    }

    @Test
    void verifiedDiskDedupAssociatesOnlyItsInstanceAndCleansUp() throws Exception {
        var mine = datasets.create("Incoming", ALICE);
        Path[] captured = new Path[1];
        when(orthanc.importDicomFile(any())).thenAnswer(call -> {
            captured[0] = call.getArgument(0);
            return new OrthancService.ImportResult("AlreadyStored", ONE);
        });
        when(orthanc.matchesDicomFile(org.mockito.ArgumentMatchers.eq(ONE), any())).thenReturn(true);
        datasets.importDicomFile(mine.id(), ImportStreamingTests.file(new byte[]{1,2,3}, 3), ALICE);
        assertThat(Files.exists(captured[0])).isFalse();
        assertThat(datasets.instances(mine.id(), ALICE).items()).extracting(OrthancService.InstanceItem::id).containsExactly(ONE);
        verify(orthanc, never()).file(any());
        verify(orthanc, never()).importDicom(any());
    }

    @Test
    void diskForwardingFailureIsNotReplayedAndLeavesNoMembershipOrTemporaryFile() throws Exception {
        var mine = datasets.create("Incoming", ALICE);
        Path[] captured = new Path[1];
        when(orthanc.importDicomFile(any())).thenAnswer(call -> {
            captured[0] = call.getArgument(0);
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "fixture transport failed");
        });
        assertThatThrownBy(() -> datasets.importDicomFile(mine.id(), ImportStreamingTests.file(new byte[]{1}, 1), ALICE))
                .isInstanceOfSatisfying(ApiException.class, error -> assertThat(error.status()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE));
        assertThat(Files.exists(captured[0])).isFalse();
        assertThat(datasets.instances(mine.id(), ALICE).items()).isEmpty();
        verify(orthanc, org.mockito.Mockito.times(1)).importDicomFile(any());
        verify(orthanc, never()).importDicom(any());
    }

    @Test
    void ownerCannotRevokeConfirmedSharingAndRecipientRetainsAccess() throws Exception {
        var mine = datasets.create("Private", ALICE);
        db.update("INSERT INTO dataset_instances VALUES (?,?,?)", mine.id(), ONE, "1");
        String copy=datasets.share(mine.id(),BOB.subject(),ALICE).recipientDatasetId();
        assertThatThrownBy(() -> datasets.revoke(mine.id(),BOB.subject(),ALICE)).isInstanceOfSatisfying(ApiException.class,
                e -> assertThat(e.status()).isEqualTo(HttpStatus.CONFLICT));
        clearInvocations(orthanc,directory);
        mvc.perform(get("/api/datasets/"+copy+"/instances").with(login(BOB))).andExpect(status().isOk());
        mvc.perform(get("/api/datasets/"+copy+"/instances/"+ONE+"/preview").with(login(BOB))).andExpect(status().isOk());
        mvc.perform(get("/api/datasets/"+copy+"/instances/"+ONE+"/file").with(login(BOB))).andExpect(status().isOk());
        mvc.perform(patch("/api/datasets/"+copy).with(login(BOB)).with(csrf()).contentType("application/json")
                .content("{\"name\":\"still editable\"}")).andExpect(status().isOk());
        mvc.perform(put("/api/datasets/"+copy+"/shares").with(login(BOB)).with(csrf()).contentType("application/json")
                .content("{\"subject\":\"carol-sub\"}")).andExpect(status().isOk());
        verify(orthanc, never()).importDicom(any());
        assertThat(datasets.shares(mine.id(),ALICE).items()).hasSize(1);
        assertThat(datasets.shares(copy,BOB).items()).hasSize(1);
    }

    @Test
    void statusCountsOnlyDistinctVisibleInstancesAndDoesNotLeakWarehouseTotals() throws Exception {
        var mine = datasets.create("Private", ALICE);
        var other = datasets.create("Other private", BOB);
        var duplicate = datasets.create("Same physical instance", ALICE);
        db.update("INSERT INTO dataset_instances VALUES (?,?,?)", mine.id(), ONE, "1");
        db.update("INSERT INTO dataset_instances VALUES (?,?,?)", duplicate.id(), ONE, "1");
        db.update("INSERT INTO dataset_instances VALUES (?,?,?)", other.id(), TWO, "2");
        mvc.perform(get("/api/orthanc/status").with(login(ALICE))).andExpect(status().isOk())
                .andExpect(jsonPath("$.instanceCount").value(1));
    }

    @Test
    void fixedPublicMigrationIsIdempotentAndDoesNotEnumerateFutureOrthancImports() {
        datasets.seedPublicDatasets();
        assertThat(datasets.list(BOB).items()).hasSize(2).allMatch(d -> d.access().equals("public"));
        assertThat(datasets.visibleInstanceCount(BOB)).isEqualTo(199);
        var first = datasets.list(BOB).items().getFirst();
        datasets.rename(first.id(),"Public renamed",BOB);
        datasets.seedPublicDatasets();
        assertThat(datasets.list(ALICE).items()).hasSize(2).anyMatch(d -> d.name().equals("Public renamed"));
        assertThat(datasets.visibleInstanceCount(ALICE)).isEqualTo(199);
        verify(orthanc, never()).series();
        verify(orthanc, never()).instances(any());
    }

    @Test
    void databaseReinitializationKeepsPrivateMembershipsGrantsAndPublicNames() {
        datasets.seedPublicDatasets();
        var mine = datasets.create("Persist me",ALICE);
        db.update("INSERT INTO dataset_instances VALUES (?,?,?)",mine.id(),ONE,"1");
        String copy=datasets.share(mine.id(),BOB.subject(),ALICE).recipientDatasetId();
        datasets.initialize();
        assertThat(datasets.list(BOB).items()).hasSize(3);
        assertThat(datasets.instances(copy,BOB).items()).extracting(OrthancService.InstanceItem::id).containsExactly(ONE);
        assertThat(datasets.shares(mine.id(),ALICE).items()).extracting(DatasetService.ShareItem::subject).containsExactly("bob-sub");
    }

    @Test
    void legacyGlobalRoutesCannotBypassDatasetPermissions() throws Exception {
        for (String path : List.of("/api/series", "/api/series/"+ONE+"/instances", "/api/instances/"+ONE+"/preview"))
            mvc.perform(get(path).with(login(ALICE))).andExpect(status().isNotFound());
    }

    private static OidcLoginRequestPostProcessor login(DemoSession.Identity user) {
        return oidcLogin().idToken(t -> t.subject(user.subject()).claim("iss",user.issuer()).claim("preferred_username",user.username()));
    }
    private static MockMultipartFile file() { return new MockMultipartFile("file","slice.dcm","application/dicom",new byte[]{1,2,3}); }
}
