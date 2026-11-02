package com.example.demo;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.util.List;
import java.util.concurrent.CompletableFuture;
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

@SpringBootTest(properties={"keycloak.client-secret=unused-test-secret", "app.datasets.seed-enabled=false",
        "spring.datasource.url=jdbc:h2:mem:team-system-tests;DB_CLOSE_DELAY=-1"})
@AutoConfigureMockMvc
class TeamSystemTests {
    static final String ISSUER="http://127.0.0.1:8081/realms/medical-demo";
    static final DemoSession.Identity ALICE=new DemoSession.Identity(ISSUER,"alice-sub","alice");
    static final DemoSession.Identity BOB=new DemoSession.Identity(ISSUER,"bob-sub","bob");
    static final DemoSession.Identity CAROL=new DemoSession.Identity(ISSUER,"carol-sub","carol");
    static final String INSTANCE="11111111-11111111-11111111-11111111";
    @Autowired TeamService teams;
    @Autowired DatasetService datasets;
    @Autowired JdbcTemplate db;
    @Autowired MockMvc mvc;
    @MockitoBean KeycloakDirectoryService directory;
    @MockitoBean OrthancService orthanc;
    @MockitoBean DicomSegCodec codec;

    @BeforeEach void reset() {
        for(String table:List.of("segmentation_drafts","segmentation_publications","dataset_teams","dataset_grants","dataset_instances","datasets","team_members","teams")) db.update("DELETE FROM "+table);
        for(var u:List.of(ALICE,BOB,CAROL)) when(directory.requireUser(u.subject())).thenReturn(new KeycloakDirectoryService.DirectoryUser(u.subject(),u.username()));
    }

    @Test void createJoinSearchAndStableIdentity() {
        var first=teams.create("心脏标注组",ALICE);
        var second=teams.create("心脏标注组",CAROL);
        assertThat(first.team().role()).isEqualTo("leader");
        assertThat(first.team().id()).startsWith("TM-").isNotEqualTo(second.team().id());
        assertThat(teams.search("心脏",BOB).items()).hasSize(2).allMatch(t->t.role().equals("none"));
        assertThat(teams.search(first.team().id().toLowerCase(),BOB).items()).extracting(TeamService.TeamItem::id).containsExactly(first.team().id());
        assertThat(teams.mine(BOB).items()).isEmpty();
        teams.join(first.team().id(),first.inviteCode(),BOB);
        assertThat(teams.get(first.team().id(),new DemoSession.Identity(ISSUER,BOB.subject(),"renamed" )).role()).isEqualTo("member");
        assertThat(teams.mine(new DemoSession.Identity(ISSUER,"other-sub","bob")).items()).isEmpty();
        error(()->teams.mine(new DemoSession.Identity("https://other",BOB.subject(),"bob")),HttpStatus.UNAUTHORIZED);
    }

    @Test void invitationsAreHashedRotatableAndNeverReturnedByReadApis() throws Exception {
        var t=teams.create("Invite",ALICE);String id=t.team().id();
        assertThat(db.queryForObject("SELECT invite_hash FROM teams WHERE id=?",String.class,id)).hasSize(64).doesNotContain(t.inviteCode());
        error(()->teams.join(id,"",BOB),HttpStatus.NOT_FOUND);
        error(()->teams.join(id,"wrong",BOB),HttpStatus.NOT_FOUND);
        var fresh=teams.rotateCode(id,ALICE);
        error(()->teams.join(id,t.inviteCode(),BOB),HttpStatus.NOT_FOUND);
        teams.join(id,fresh.inviteCode(),BOB);teams.join(id,fresh.inviteCode(),BOB);
        assertThat(teams.members(id,ALICE).total()).isEqualTo(2);
        mvc.perform(get("/api/teams/"+id).with(login(BOB))).andExpect(status().isOk()).andExpect(jsonPath("$.inviteCode").doesNotExist()).andExpect(jsonPath("$.inviteHash").doesNotExist());
        error(()->teams.rotateCode(id,BOB),HttpStatus.FORBIDDEN);
    }

    @Test void onlyLeaderCanManageMembersAndTransferPreservesOneLeader() {
        var t=teams.create("Manage",ALICE);String id=t.team().id();
        teams.addMember(id,BOB.subject(),ALICE);
        error(()->teams.addMember(id,CAROL.subject(),BOB),HttpStatus.FORBIDDEN);
        error(()->teams.rename(id,"Hijack",BOB),HttpStatus.FORBIDDEN);
        error(()->teams.members(id,CAROL),HttpStatus.NOT_FOUND);
        error(()->teams.removeMember(id,ALICE.subject(),ALICE),HttpStatus.CONFLICT);
        error(()->teams.leave(id,ALICE),HttpStatus.CONFLICT);
        error(()->teams.transfer(id,CAROL.subject(),ALICE),HttpStatus.BAD_REQUEST);
        teams.transfer(id,BOB.subject(),ALICE);
        assertThat(teams.get(id,ALICE).role()).isEqualTo("member");
        assertThat(teams.members(id,BOB).items()).filteredOn(m->m.role().equals("leader")).hasSize(1);
        teams.leave(id,ALICE);
        error(()->teams.get(id,ALICE),HttpStatus.NOT_FOUND);
    }

    @Test void memberUploadsAreTeamOwnedAndNotListedAsPersonalOrShareable() {
        var t=teams.create("Library",ALICE);String id=t.team().id();teams.addMember(id,BOB.subject(),ALICE);
        var d=datasets.createTeamDataset(id,"Bob upload",BOB);
        assertThat(d.scope()).isEqualTo("team");assertThat(d.uploaderSubject()).isEqualTo(BOB.subject());assertThat(d.canDelete()).isTrue();
        assertThat(datasets.teamDatasets(id,ALICE).items()).hasSize(1).allMatch(x->!x.canDelete());
        assertThat(datasets.list(BOB).items()).isEmpty();assertThat(datasets.list(ALICE).items()).isEmpty();
        error(()->datasets.teamDatasets(id,CAROL),HttpStatus.NOT_FOUND);
        clearInvocations(directory);
        error(()->datasets.share(d.id(),CAROL.subject(),BOB),HttpStatus.BAD_REQUEST);
        verify(directory,never()).requireUser(any());
        error(()->datasets.shares(d.id(),ALICE),HttpStatus.BAD_REQUEST);
        error(()->datasets.createTeamDataset(id,"no",CAROL),HttpStatus.NOT_FOUND);
    }

    @Test void removedUploaderLosesTeamAccessButFilesRemainAndPersonalSharesStay() {
        var t=teams.create("Keep",ALICE);String id=t.team().id();teams.addMember(id,BOB.subject(),ALICE);
        var d=datasets.createTeamDataset(id,"Bob CT",BOB);
        var personal=datasets.create("Alice personal",ALICE);datasets.share(personal.id(),BOB.subject(),ALICE);
        db.update("INSERT INTO dataset_instances VALUES (?,?,?)",d.id(),INSTANCE,"1");
        assertThat(datasets.visibleInstanceCount(BOB)).isEqualTo(1);
        teams.removeMember(id,BOB.subject(),ALICE);
        error(()->datasets.requireDatasetAccess(d.id(),BOB,false),HttpStatus.NOT_FOUND);
        assertThat(datasets.visibleInstanceCount(BOB)).isZero();
        assertThat(datasets.teamDatasets(id,ALICE).items()).extracting(DatasetService.TeamDatasetItem::id).containsExactly(d.id());
        assertThat(datasets.list(BOB).items()).extracting(DatasetService.DatasetItem::id).containsExactly(personal.id());
        teams.join(id,t.inviteCode(),BOB);
        assertThat(datasets.teamDatasets(id,BOB).items().getFirst().canDelete()).isTrue();
    }

    @Test void currentMembersCanImportBrowseAndRenameWithoutChangingUploader() throws Exception {
        var t=teams.create("Import",ALICE);teams.addMember(t.team().id(),BOB.subject(),ALICE);
        var d=datasets.createTeamDataset(t.team().id(),"Uploaded",BOB);
        when(orthanc.importDicom(any())).thenReturn(new OrthancService.ImportResult("Success",INSTANCE));
        when(orthanc.instance(INSTANCE)).thenReturn(new OrthancService.InstanceItem(INSTANCE,"1"));
        when(orthanc.file(INSTANCE)).thenReturn(new byte[]{1,2,3});
        datasets.importDicom(d.id(),new byte[]{1,2,3},BOB);
        assertThat(datasets.instances(d.id(),ALICE).total()).isEqualTo(1);
        assertThat(datasets.visibleInstanceCount(ALICE)).isEqualTo(1);
        assertThat(datasets.rename(d.id(),"Team edit",ALICE).name()).isEqualTo("Team edit");
        assertThat(datasets.teamDatasets(t.team().id(),ALICE).items().getFirst().uploaderSubject()).isEqualTo(BOB.subject());
        mvc.perform(get("/api/datasets/"+d.id()+"/instances/"+INSTANCE+"/file").with(login(ALICE))).andExpect(status().isOk());
    }

    @Test void onlyUploaderCanDeleteAndPhysicalDicomSharedElsewhereIsUntouched() throws Exception {
        var t=teams.create("Delete",ALICE);String id=t.team().id();teams.addMember(id,BOB.subject(),ALICE);
        var d=datasets.createTeamDataset(id,"Bob CT",BOB);var personal=datasets.create("Same physical CT",ALICE);
        for(String dataset:List.of(d.id(),personal.id())) db.update("INSERT INTO dataset_instances VALUES (?,?,?)",dataset,INSTANCE,"1");
        mvc.perform(delete("/api/teams/"+id+"/datasets/"+d.id()).with(login(ALICE)).with(csrf())).andExpect(status().isForbidden());
        error(()->datasets.deleteTeamDataset(id,personal.id(),ALICE),HttpStatus.NOT_FOUND);
        datasets.deleteTeamDataset(id,d.id(),BOB);datasets.deleteTeamDataset(id,d.id(),BOB);
        assertThat(datasets.teamDatasets(id,ALICE).items()).isEmpty();
        assertThat(datasets.instances(personal.id(),ALICE).total()).isEqualTo(1);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM dataset_instances WHERE instance_id=?",Integer.class,INSTANCE)).isEqualTo(2);
        error(()->datasets.requireInstance(d.id(),INSTANCE,BOB),HttpStatus.NOT_FOUND);
        error(()->datasets.importDicom(d.id(),new byte[]{1},BOB),HttpStatus.NOT_FOUND);
        verifyNoInteractions(orthanc);
    }

    @Test void removedMemberCannotUseAnyExistingImagingOrSegmentationEntry() throws Exception {
        var t=teams.create("Scope",ALICE);String id=t.team().id();teams.addMember(id,BOB.subject(),ALICE);
        var d=datasets.createTeamDataset(id,"CT",BOB);db.update("INSERT INTO dataset_instances VALUES (?,?,?)",d.id(),INSTANCE,"1");
        teams.removeMember(id,BOB.subject(),ALICE);
        for(String suffix:List.of("/instances","/instances/"+INSTANCE+"/preview","/instances/"+INSTANCE+"/file","/workspace","/dicomweb/studies","/segmentation/sources","/segmentations/series/labelmap","/segmentations/series/status","/segmentations/series/file"))
            mvc.perform(get("/api/datasets/"+d.id()+suffix).with(login(BOB))).andExpect(status().isNotFound());
        mvc.perform(post("/api/datasets/"+d.id()+"/segmentations/series/publish-labelmap").with(login(BOB)).with(csrf()).contentType("application/json").content("{\"expectedPublishedVersion\":0,\"publicationId\":\"test\",\"label\":\"test\",\"data\":{\"segments\":[],\"masks\":[]}}"))
                .andExpect(status().isNotFound());
        verifyNoInteractions(orthanc,codec);
    }

    @Test void deletedDatasetCannotBeOpenedByAnyTeamMember() throws Exception {
        var t=teams.create("Gone",ALICE);teams.addMember(t.team().id(),BOB.subject(),ALICE);
        var d=datasets.createTeamDataset(t.team().id(),"CT",BOB);datasets.deleteTeamDataset(t.team().id(),d.id(),BOB);
        for(var user:List.of(ALICE,BOB)) for(String suffix:List.of("/workspace","/dicomweb/studies","/segmentation/sources","/segmentations/series/labelmap"))
            mvc.perform(get("/api/datasets/"+d.id()+suffix).with(login(user))).andExpect(status().isNotFound());
        verifyNoInteractions(orthanc,codec);
    }

    @Test void personalSharingIsIrrevocableForOwnerAndRecipientsAndIdempotent() throws Exception {
        var d=datasets.create("Personal",ALICE);datasets.share(d.id(),BOB.subject(),ALICE);datasets.share(d.id(),BOB.subject(),ALICE);
        datasets.share(d.id(),CAROL.subject(),BOB);
        for(var u:List.of(ALICE,BOB,CAROL)) mvc.perform(delete("/api/datasets/"+d.id()+"/shares/bob-sub").with(login(u)).with(csrf())).andExpect(status().isConflict());
        assertThat(datasets.shares(d.id(),ALICE).items()).hasSize(2);
        assertThat(datasets.list(BOB).total()).isEqualTo(1);
    }

    @Test void csrfAndAuthenticationCannotBeBypassedWithClientRoleFlags() throws Exception {
        mvc.perform(get("/api/teams")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/teams").with(login(ALICE)).contentType("application/json").content("{\"name\":\"No CSRF\"}")).andExpect(status().isForbidden());
        var t=teams.create("API",ALICE);teams.addMember(t.team().id(),BOB.subject(),ALICE);
        mvc.perform(post("/api/teams/"+t.team().id()+"/invite-code").with(login(BOB)).with(csrf())).andExpect(status().isForbidden());
        mvc.perform(put("/api/teams/"+t.team().id()+"/members").with(login(CAROL)).with(csrf()).contentType("application/json").content("{\"subject\":\"carol-sub\",\"role\":\"leader\"}")).andExpect(status().isNotFound());
    }

    @Test void concurrentDuplicateJoinsDoNotDuplicateMembershipOrReplaceLeader() {
        var t=teams.create("Concurrent",ALICE);
        CompletableFuture.allOf(java.util.stream.IntStream.range(0,8).mapToObj(i->CompletableFuture.runAsync(()->teams.join(t.team().id(),t.inviteCode(),BOB))).toArray(CompletableFuture[]::new)).join();
        assertThat(teams.members(t.team().id(),ALICE).total()).isEqualTo(2);
        assertThat(teams.get(t.team().id(),ALICE).role()).isEqualTo("leader");
    }

    @Test void schemaReinitializationPreservesTeamsInvitesAndDeletedState() {
        var t=teams.create("Persistent",ALICE);teams.addMember(t.team().id(),BOB.subject(),ALICE);
        var d=datasets.createTeamDataset(t.team().id(),"Deleted",BOB);datasets.deleteTeamDataset(t.team().id(),d.id(),BOB);
        teams.initialize();datasets.initialize();
        assertThat(teams.members(t.team().id(),ALICE).total()).isEqualTo(2);
        teams.join(t.team().id(),t.inviteCode(),CAROL);
        assertThat(datasets.teamDatasets(t.team().id(),CAROL).items()).isEmpty();
        assertThat(db.queryForObject("SELECT deleted_at FROM datasets WHERE id=?",String.class,d.id())).isNotBlank();
    }

    static void error(Runnable r,HttpStatus status){assertThatThrownBy(r::run).isInstanceOfSatisfying(ApiException.class,e->assertThat(e.status()).isEqualTo(status));}
    static OidcLoginRequestPostProcessor login(DemoSession.Identity u){return oidcLogin().idToken(t->t.subject(u.subject()).claim("iss",u.issuer()).claim("preferred_username",u.username()));}
}
