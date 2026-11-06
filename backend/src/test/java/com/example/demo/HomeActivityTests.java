package com.example.demo;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.nio.file.Path;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.OidcLoginRequestPostProcessor;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;

@SpringBootTest(properties={"keycloak.client-secret=test-only","spring.datasource.url=jdbc:h2:mem:home-activity-tests;DB_CLOSE_DELAY=-1","app.datasets.seed-enabled=false"})
@AutoConfigureMockMvc
class HomeActivityTests {
    static final String ISSUER="http://127.0.0.1:8081/realms/medical-demo";
    static final DemoSession.Identity A=new DemoSession.Identity(ISSUER,"a-sub","alice");
    static final DemoSession.Identity B=new DemoSession.Identity(ISSUER,"b-sub","bob");
    @Autowired JdbcTemplate db;
    @Autowired PlatformTransactionManager manager;
    @Autowired DatasetService datasets;
    @Autowired TeamService teams;
    @Autowired MockMvc mvc;
    @MockitoBean OrthancService orthanc;
    @MockitoBean KeycloakDirectoryService directory;
    @MockitoBean DicomSegCodec codec;
    MutableClock clock;
    HomeActivityService service;
    String one,two;

    @BeforeEach void prepare() {
        for(String table:List.of("dataset_open_events","dataset_recent_opens","dataset_favorites","home_activity_accounts",
                "dataset_teams","dataset_grants","dataset_instances","datasets","team_members","teams")) db.update("DELETE FROM "+table);
        clock=new MutableClock();service=new HomeActivityService(db,manager,datasets,90,100,clock);
        one=datasets.create("第一份 CT",A).id();two=datasets.create("第二份 CT",A).id();
        when(directory.requireUser(B.subject())).thenReturn(new KeycloakDirectoryService.DirectoryUser(B.subject(),B.username()));
        clearInvocations(orthanc);
    }

    @Test void favoriteIsIdempotentAndUnfavoriteIsIndependent() {
        var first=service.favorite(one,A);clock.advance(Duration.ofHours(1));
        assertThat(service.favorite(one,A).favoritedAt()).isEqualTo(first.favoritedAt());
        assertThat(service.favorites(A,0,20).total()).isEqualTo(1);
        service.unfavorite(one,A);service.unfavorite(one,A);
        assertThat(service.favorites(A,0,20).items()).isEmpty();
        assertThat(service.favorite(one,A).favoritedAt()).isNotEqualTo(first.favoritedAt());
        assertThat(datasets.list(A).total()).isEqualTo(2);
        verifyNoInteractions(orthanc);
    }

    @Test void favoritesCoverOwnSharedPublicAndTeamWithCurrentMetadata() {
        String copy=datasets.share(one,B.subject(),A).recipientDatasetId();
        service.favorite(copy,B);
        String publicId="public-ct";
        db.update("INSERT INTO datasets (id,name,is_public,owner_username,created_at) VALUES (?,?,TRUE,?,?)",publicId,"公共 CT","公共影像",clock.instant().toString());
        service.favorite(publicId,B);
        var team=teams.create("心脏组",A);teams.join(team.team().id(),team.inviteCode(),B);
        var teamData=datasets.createTeamDataset(team.team().id(),"团队 CT",A);
        service.favorite(teamData.id(),B);
        db.update("INSERT INTO dataset_instances VALUES (?,?,?)",copy,"synthetic-instance","1");
        datasets.rename(copy,"更名后的 CT",B);
        var list=service.favorites(B,0,20);
        assertThat(list.total()).isEqualTo(3);
        var shared=list.items().stream().filter(i->i.dataset().id().equals(copy)).findFirst().orElseThrow().dataset();
        assertThat(shared.name()).isEqualTo("更名后的 CT");assertThat(shared.instanceCount()).isEqualTo(1);assertThat(shared.access()).isEqualTo("owner");
        var teamRow=list.items().stream().filter(i->i.dataset().id().equals(teamData.id())).findFirst().orElseThrow().dataset();
        assertThat(teamRow.scope()).isEqualTo("team");assertThat(teamRow.teamId()).isEqualTo(team.team().id());assertThat(teamRow.teamName()).isEqualTo("心脏组");
        assertThat(list.items()).anyMatch(i->i.dataset().access().equals("public"));
        verifyNoInteractions(orthanc);
    }

    @Test void accountReferencesUseIssuerAndSubjectRatherThanUsername() {
        service.favorite(one,A);open(one,A);
        var renamed=new DemoSession.Identity(ISSUER,A.subject(),"new-name");
        assertThat(service.favorites(renamed,0,20).total()).isEqualTo(1);assertThat(service.recent(renamed,0,20).total()).isEqualTo(1);
        assertThat(service.favorites(B,0,20).total()).isZero();assertThat(service.recent(B,0,20).total()).isZero();
        assertThatThrownBy(()->service.favorite(one,B)).isInstanceOf(ApiException.class);
        assertThatThrownBy(()->service.favorites(new DemoSession.Identity("https://other",A.subject(),A.username()),0,20)).isInstanceOf(ApiException.class);
    }

    @Test void accessLossIsFilteredBeforeCountsPaginationAndBatchState() {
        one=datasets.share(one,B.subject(),A).recipientDatasetId();two=datasets.share(two,B.subject(),A).recipientDatasetId();
        service.favorite(one,B);service.favorite(two,B);open(one,B);open(two,B);
        datasets.deletePersonal(one,B);
        var page=service.favorites(B,0,1);
        assertThat(page.total()).isEqualTo(1);assertThat(page.items()).extracting(i->i.dataset().id()).containsExactly(two);
        assertThat(service.favorites(B,1,1).items()).isEmpty();
        assertThat(service.recent(B,0,1).total()).isEqualTo(1);
        assertThat(service.favoriteStates(List.of(one,two,"unknown-id"),B).items()).extracting(HomeActivityService.FavoriteState::datasetId).containsExactly(two);
        service.unfavorite(one,B);service.clearRecent(one,B);
        assertThat(datasets.list(A).total()).isEqualTo(2);
    }

    @Test void teamRemovalAndLogicalDeletionHideBothKindsOfReferences() {
        var team=teams.create("测试队",A);teams.join(team.team().id(),team.inviteCode(),B);
        var teamData=datasets.createTeamDataset(team.team().id(),"团队资料",A);
        service.favorite(teamData.id(),B);open(teamData.id(),B);
        teams.removeMember(team.team().id(),B.subject(),A);
        assertThat(service.favorites(B,0,20).total()).isZero();assertThat(service.recent(B,0,20).total()).isZero();
        service.favorite(teamData.id(),A);open(teamData.id(),A);
        datasets.deleteTeamDataset(team.team().id(),teamData.id(),A);
        assertThat(service.favorites(A,0,20).total()).isZero();assertThat(service.recent(A,0,20).total()).isZero();
    }

    @Test void batchStateIncludesAccessibleUnfavoritedAndDeduplicatesInput() {
        service.favorite(one,A);
        var states=service.favoriteStates(List.of(one,two,one,"absent"),A);
        assertThat(states.total()).isEqualTo(2);
        assertThat(states.items()).anyMatch(i->i.datasetId().equals(two)&&!i.favorited()&&i.favoritedAt()==null);
    }

    @Test void duplicateEventsDoNotBumpTimeOrReorderAndUuidCaseIsCanonical() {
        String generation=service.recentContext(A).generation(),event=UUID.randomUUID().toString();
        var first=service.opened(one,event,generation,A);clock.advance(Duration.ofMinutes(1));
        service.opened(two,UUID.randomUUID().toString(),generation,A);clock.advance(Duration.ofMinutes(1));
        var retry=service.opened(one,event.toUpperCase(Locale.ROOT),generation.toUpperCase(Locale.ROOT),A);
        assertThat(retry.duplicate()).isTrue();assertThat(retry.lastOpenedAt()).isEqualTo(first.lastOpenedAt());
        assertThat(service.recent(A,0,20).items()).extracting(i->i.dataset().id()).containsExactly(two,one);
        assertThatThrownBy(()->service.opened(two,event,generation,A)).isInstanceOf(HomeActivityService.Failure.class).hasMessageContaining("eventId");
        assertThat(db.queryForObject("SELECT COUNT(*) FROM dataset_open_events",Integer.class)).isEqualTo(2);
    }

    @Test void clearInvalidatesPreviouslyUnreportedAndRetriedEvents() {
        String old=service.recentContext(A).generation(),event=UUID.randomUUID().toString();
        service.favorite(one,A);service.opened(one,event,old,A);
        var cleared=service.clearRecent(null,A);
        assertThat(cleared.generation()).isNotEqualTo(old);
        assertStale(()->service.opened(one,event,old,A));
        assertStale(()->service.opened(two,UUID.randomUUID().toString(),old,A));
        assertThat(service.recent(A,0,20).items()).isEmpty();assertThat(service.favorites(A,0,20).total()).isEqualTo(1);
        service.opened(two,UUID.randomUUID().toString(),cleared.generation(),A);
        assertThat(service.recent(A,0,20).total()).isEqualTo(1);
    }

    @Test void deletingOneRecentRecordKeepsOthersAndBlocksLateReappearance() {
        String epoch=service.recentContext(A).generation();
        service.opened(one,UUID.randomUUID().toString(),epoch,A);service.opened(two,UUID.randomUUID().toString(),epoch,A);
        service.clearRecent(one,A);assertStale(()->service.opened(one,UUID.randomUUID().toString(),epoch,A));
        assertThat(service.recent(A,0,20).items()).extracting(i->i.dataset().id()).containsExactly(two);
    }

    @Test void recentPolicyLimitsUniqueDatasetsToOneHundred() {
        String epoch=service.recentContext(A).generation();
        var ids=new ArrayList<String>();
        for(int n=0;n<105;n++) {String id=datasets.create("CT-"+n,A).id();ids.add(id);service.opened(id,UUID.randomUUID().toString(),epoch,A);}
        var result=service.recent(A,0,100);
        assertThat(result.total()).isEqualTo(100);assertThat(result.maxItems()).isEqualTo(100);assertThat(result.retentionDays()).isEqualTo(90);
        assertThat(result.items().getFirst().dataset().id()).isEqualTo(ids.getLast());
        assertThat(result.items()).noneMatch(i->ids.subList(0,5).contains(i.dataset().id()));
        service.opened(ids.getLast(),UUID.randomUUID().toString(),epoch,A);assertThat(service.recent(A,0,100).total()).isEqualTo(100);
    }

    @Test void expiredContextsRejectLateRequestsAndCleanupExpiresInactiveHistory() {
        String epoch=service.recentContext(A).generation();service.favorite(one,A);service.opened(one,UUID.randomUUID().toString(),epoch,A);
        clock.advance(Duration.ofDays(1));assertStale(()->service.opened(two,UUID.randomUUID().toString(),epoch,A));
        assertThat(service.recentContext(A).generation()).isNotEqualTo(epoch);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM dataset_open_events",Integer.class)).isZero();
        clock.advance(Duration.ofDays(89));service.cleanupExpired();
        assertThat(db.queryForObject("SELECT COUNT(*) FROM dataset_recent_opens",Integer.class)).isZero();
        assertThat(service.favorites(A,0,20).total()).isEqualTo(1);
    }

    @Test void concurrentFirstUseAndDuplicateWritesRemainSingleRecords() throws Exception {
        try(var pool=Executors.newFixedThreadPool(6)) {
            var jobs=new ArrayList<Callable<Void>>();
            for(int i=0;i<12;i++)jobs.add(()->{service.favorite(one,A);return null;});
            for(var task:pool.invokeAll(jobs))task.get(10,TimeUnit.SECONDS);
            String epoch=service.recentContext(A).generation(),event=UUID.randomUUID().toString();jobs.clear();
            for(int i=0;i<12;i++)jobs.add(()->{service.opened(one,event,epoch,A);return null;});
            for(var task:pool.invokeAll(jobs))task.get(10,TimeUnit.SECONDS);
        }
        assertThat(service.favorites(A,0,20).total()).isEqualTo(1);assertThat(service.recent(A,0,20).total()).isEqualTo(1);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM dataset_open_events",Integer.class)).isEqualTo(1);
    }

    @Test void httpSecurityCsrfResponseAndPaginationContracts() throws Exception {
        mvc.perform(get("/api/me/favorite-datasets")).andExpect(status().isUnauthorized());
        mvc.perform(put("/api/me/favorite-datasets/"+one).with(login(A))).andExpect(status().isForbidden());
        mvc.perform(put("/api/me/favorite-datasets/"+one).with(login(A)).with(csrf())).andExpect(status().isOk()).andExpect(jsonPath("$.favorited").value(true));
        mvc.perform(get("/api/me/favorite-datasets").with(login(A))).andExpect(status().isOk()).andExpect(header().string("Cache-Control","no-store"))
                .andExpect(jsonPath("$.items[0].dataset.id").value(one)).andExpect(jsonPath("$.total").value(1)).andExpect(jsonPath("$.page").value(0));
        mvc.perform(get("/api/me/favorite-datasets").param("page","abc").with(login(A))).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_ACTIVITY_REQUEST"));
        mvc.perform(get("/api/me/recent-datasets").param("size","101").with(login(A))).andExpect(status().isBadRequest());
        mvc.perform(get("/api/me/favorite-datasets/state").param("datasetId",one,two).with(login(A))).andExpect(status().isOk()).andExpect(jsonPath("$.total").value(2));
        mvc.perform(get("/api/health")).andExpect(status().isOk()).andExpect(jsonPath("$.homeActivityApi").value("v1"));
        mvc.perform(get("/api/me/recent-datasets/context").with(login(A))).andExpect(status().isOk()).andExpect(jsonPath("$.retentionDays").value(90)).andExpect(jsonPath("$.expiresAt").isString());
        mvc.perform(post("/api/me/recent-datasets/"+one).with(login(A)).contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isForbidden());
        mvc.perform(post("/api/me/recent-datasets/"+one).with(login(A)).with(csrf()).contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_ACTIVITY_REQUEST"));
        mvc.perform(delete("/api/me/recent-datasets").with(login(A))).andExpect(status().isForbidden());
        mvc.perform(delete("/api/me/recent-datasets").with(login(A)).with(csrf())).andExpect(status().isOk()).andExpect(jsonPath("$.generation").isString());
    }

    @Test void httpRecentPostDuplicateAndStaleContext() throws Exception {
        var mapper=tools.jackson.databind.json.JsonMapper.builder().build();
        var context=mvc.perform(get("/api/me/recent-datasets/context").with(login(A))).andReturn().getResponse().getContentAsString();
        String epoch=mapper.readTree(context).path("generation").asText();
        String body=mapper.writeValueAsString(Map.of("generation",epoch,"eventId",UUID.randomUUID().toString()));
        for(int i=0;i<2;i++)mvc.perform(post("/api/me/recent-datasets/"+one).with(login(A)).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk()).andExpect(jsonPath("$.duplicate").value(i==1));
        mvc.perform(delete("/api/me/recent-datasets/"+one).with(login(A)).with(csrf())).andExpect(status().isOk());
        mvc.perform(post("/api/me/recent-datasets/"+one).with(login(A)).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("RECENT_CONTEXT_STALE"));
        mvc.perform(get("/api/me/recent-datasets").with(login(A))).andExpect(status().isOk()).andExpect(jsonPath("$.total").value(0));
        mvc.perform(put("/api/me/favorite-datasets/"+one).with(login(B)).with(csrf())).andExpect(status().isNotFound());
    }

    @Test void referencesSurviveFileDatabaseCloseAndServiceReinitialization(@TempDir Path temp) {
        String url="jdbc:h2:file:"+temp.resolve("activity").toAbsolutePath()+";DB_CLOSE_ON_EXIT=FALSE";
        var ds=new DriverManagerDataSource(url,"sa","");var local=new JdbcTemplate(ds);var localTx=new DataSourceTransactionManager(ds);
        var team=new TeamService(local,localTx,directory,ISSUER);team.initialize();
        var data=new DatasetService(local,localTx,orthanc,directory,team,ISSUER,false,mock(ImportLimits.class),new SegmentationStorageGuard());data.initialize();
        var activity=new HomeActivityService(local,localTx,data,90,100,clock);activity.initialize();
        String id=data.create("persistent",A).id();activity.favorite(id,A);
        String generation=activity.recentContext(A).generation();activity.opened(id,UUID.randomUUID().toString(),generation,A);
        var reopened=new JdbcTemplate(new DriverManagerDataSource(url,"sa",""));
        var restored=new HomeActivityService(reopened,new DataSourceTransactionManager(reopened.getDataSource()),data,90,100,clock);restored.initialize();
        assertThat(restored.favorites(A,0,20).total()).isEqualTo(1);assertThat(restored.recent(A,0,20).total()).isEqualTo(1);
        assertThat(restored.recentContext(A).generation()).isEqualTo(generation);
    }

    private void open(String id,DemoSession.Identity user) {service.opened(id,UUID.randomUUID().toString(),service.recentContext(user).generation(),user);}
    private static void assertStale(Runnable action) {assertThatThrownBy(action::run).isInstanceOf(HomeActivityService.Failure.class).hasMessageContaining("上下文");}
    private static OidcLoginRequestPostProcessor login(DemoSession.Identity user) {return oidcLogin().idToken(t->t.issuer(user.issuer()).subject(user.subject()).claim("preferred_username",user.username()));}
    static class MutableClock extends Clock {
        private Instant current=Instant.parse("2026-11-04T00:00:00Z");
        void advance(Duration duration) {current=current.plus(duration);}
        @Override public ZoneId getZone(){return ZoneOffset.UTC;}
        @Override public Clock withZone(ZoneId zone){return this;}
        @Override public Instant instant(){return current;}
    }
}
