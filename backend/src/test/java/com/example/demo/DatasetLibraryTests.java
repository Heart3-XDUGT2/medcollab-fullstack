package com.example.demo;

import static org.assertj.core.api.Assertions.*;
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
import org.springframework.jdbc.core.RowMapper;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.OidcLoginRequestPostProcessor;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;

@SpringBootTest(properties={"keycloak.client-secret=test","app.datasets.seed-enabled=false",
        "spring.datasource.url=jdbc:h2:mem:library-tests;DB_CLOSE_DELAY=-1",
        "app.collaboration.scan-ms=3600000","app.datasets.reclamation-ms=3600000","app.segmentation.cleanup-ms=3600000"})
@AutoConfigureMockMvc
class DatasetLibraryTests {
    static final String ISSUER="http://127.0.0.1:8081/realms/medical-demo";
    static final DemoSession.Identity A=new DemoSession.Identity(ISSUER,"alice-sub","alice"),
            B=new DemoSession.Identity(ISSUER,"bob-sub","bob"),C=new DemoSession.Identity(ISSUER,"carol-sub","carol");
    @Autowired DatasetLibraryService library;
    @Autowired DatasetService datasets;
    @Autowired TeamService teams;
    @Autowired JdbcTemplate db;
    @Autowired MockMvc mvc;
    @Autowired PlatformTransactionManager manager;
    @MockitoBean OrthancService orthanc;
    @MockitoBean KeycloakDirectoryService directory;
    @MockitoBean DicomSegCodec codec;
    String personal,other,publicId,team,teamData,hiddenTeam,hiddenData;

    @BeforeEach void prepare() {
        for(String table:List.of("dataset_deletion_objects","storage_reclamation","dataset_forwards","mask_snapshot_jobs","mask_slice_leases","mask_ops","mask_rooms",
                "segmentation_drafts","segmentation_publications","dataset_favorites","dataset_recent_opens","dataset_open_events","annotation_activity_ops","annotation_activity_slices",
                "dataset_teams","dataset_grants","dataset_instances","datasets","dataset_lineages","team_members","teams")) db.update("DELETE FROM "+table);
        for(var u:List.of(A,B,C)) when(directory.requireUser(u.subject())).thenReturn(new KeycloakDirectoryService.DirectoryUser(u.subject(),u.username()));
        personal=datasets.create("胸部 CT_100%",A).id(); other=datasets.create("不可见个人",B).id();
        publicId=datasets.create("公共 CT",C).id();db.update("UPDATE datasets SET is_public=TRUE WHERE id=?",publicId);
        team=teams.create("心脏团队",A).team().id();teams.addMember(team,B.subject(),A);
        teamData=datasets.createTeamDataset(team,"Team CT",B).id();
        hiddenTeam=teams.create("不可见团队",C).team().id();hiddenData=datasets.createTeamDataset(hiddenTeam,"Secret",C).id();
        db.update("INSERT INTO dataset_instances VALUES (?,?,'1')",personal,"same-physical-id");
        db.update("INSERT INTO dataset_instances VALUES (?,?,'1')",teamData,"same-physical-id");
        clearInvocations(orthanc,codec);
    }
    DatasetLibraryService.Page list(String source,String teamId,String q,int page,int size) {return library.list(A,source,teamId,q,page,size,"created-desc");}
    OidcLoginRequestPostProcessor login(DemoSession.Identity u) {return oidcLogin().idToken(t->t.subject(u.subject()).claim("iss",u.issuer()).claim("preferred_username",u.username()));}
    void error(Runnable action,HttpStatus status) {assertThatThrownBy(action::run).isInstanceOfSatisfying(ApiException.class,e->assertThat(e.status()).isEqualTo(status));}

    @Test void allSourcesAreAuthorizedAndPhysicalReuseDoesNotMergeBusinessIds() {
        var result=list("all",null,null,0,20);
        assertThat(result.total()).isEqualTo(3);
        assertThat(result.items()).extracting(DatasetLibraryService.Item::id).containsExactlyInAnyOrder(personal,publicId,teamData);
        assertThat(result.sourceCounts()).isEqualTo(new DatasetLibraryService.SourceCounts(1,1,1));
        var own=result.items().stream().filter(i->i.id().equals(personal)).findFirst().orElseThrow();
        assertThat(own.scope()).isEqualTo("personal");assertThat(own.teamId()).isNull();assertThat(own.uploaderSubject()).isNull();assertThat(own.canDelete()).isTrue();
        var t=result.items().stream().filter(i->i.id().equals(teamData)).findFirst().orElseThrow();
        assertThat(t.teamName()).isEqualTo("心脏团队");assertThat(t.access()).isEqualTo("shared");assertThat(t.canDelete()).isFalse();assertThat(t.uploaderSubject()).isEqualTo(B.subject());
        assertThat(t.instanceCount()).isEqualTo(1);
        assertThat(result.items().stream().filter(i->i.id().equals(publicId)).findFirst().orElseThrow().canDelete()).isFalse();
        verifyNoInteractions(orthanc,codec);
    }
    @Test void sourceSelectionDoesNotFilterTheSourceCounts() {
        for(var e:Map.of("personal",personal,"team",teamData,"public",publicId).entrySet()) {
            var p=list(e.getKey(),null,null,0,20);
            assertThat(p.total()).isEqualTo(1);assertThat(p.items()).extracting(DatasetLibraryService.Item::id).containsExactly(e.getValue());
            assertThat(p.sourceCounts()).isEqualTo(new DatasetLibraryService.SourceCounts(1,1,1));
        }
        assertThat(datasets.list(A).items()).extracting(DatasetService.DatasetItem::id).containsExactlyInAnyOrder(personal,publicId);
    }
    @Test void selectedTeamUsesRealMembershipAndMetadataAndFiltersCountsBeforeSource() {
        var p=list("all",team,null,0,20);
        assertThat(p.sourceCounts()).isEqualTo(new DatasetLibraryService.SourceCounts(0,1,0));assertThat(p.total()).isEqualTo(1);
        teams.rename(team,"更新后的队名",A);assertThat(list("team",team,null,0,20).items().getFirst().teamName()).isEqualTo("更新后的队名");
        error(()->list("team",hiddenTeam,null,0,20),HttpStatus.NOT_FOUND);
        error(()->list("all","TM-0000000000000000",null,0,20),HttpStatus.NOT_FOUND);
    }
    @Test void searchIsTrimmedCaseInsensitiveLiteralSubstringAcrossNameIdAndCreator() {
        for(String q:List.of("%","_"," 胸部 ","100%","ALICE",personal.substring(0,12)))
            assertThat(list("all",null,q,0,20).items()).extracting(DatasetLibraryService.Item::id).containsExactly(personal);
        assertThat(list("all",null,"tEaM",0,20).items()).extracting(DatasetLibraryService.Item::id).containsExactly(teamData);
        assertThat(list("all",null,"不存在",0,20).sourceCounts()).isEqualTo(new DatasetLibraryService.SourceCounts(0,0,0));
        assertThat(list("all",null,"  ",0,20).total()).isEqualTo(3);
    }
    @Test void stablePaginationAndForwardedCopiesHaveIndependentIds() {
        String copy=datasets.share(other,A.subject(),B).recipientDatasetId();
        db.update("UPDATE datasets SET created_at='2026-01-01T00:00:00Z'");
        var expected=new ArrayList<>(List.of(personal,publicId,teamData,copy));Collections.sort(expected);
        var combined=new ArrayList<String>();
        for(int page=0;page<4;page++) {
            var p=list("all",null,null,page,1);assertThat(p.total()).isEqualTo(4);assertThat(p.page()).isEqualTo(page);
            combined.add(p.items().getFirst().id());
        }
        assertThat(combined).containsExactlyElementsOf(expected);
        assertThat(list("all",null,null,Integer.MAX_VALUE,100).items()).isEmpty();
        assertThat(copy).isNotEqualTo(other);
    }
    @Test void revokedMembershipAndDeletedDatasetsDisappearFromItemsAndCounts() {
        teams.leave(team,B);
        var b=library.list(B,"all",null,null,0,20,"created-desc");
        assertThat(b.items()).extracting(DatasetLibraryService.Item::id).doesNotContain(teamData);
        assertThat(b.sourceCounts().team()).isZero();
        datasets.deletePersonal(personal,A);datasets.dissolveTeam(team,A);
        var a=list("all",null,null,0,20);assertThat(a.items()).extracting(DatasetLibraryService.Item::id).containsExactly(publicId);
        assertThat(a.sourceCounts()).isEqualTo(new DatasetLibraryService.SourceCounts(0,0,1));
    }
    @Test void issuerAndSubjectAreAuthoritativeEvenWhenUsernameMatches() {
        var sameName=new DemoSession.Identity(ISSUER,"not-alice",A.username());
        assertThat(library.list(sameName,"all",null,null,0,20,"created-desc").items()).extracting(DatasetLibraryService.Item::id).containsExactly(publicId);
        error(()->library.list(new DemoSession.Identity("https://elsewhere",A.subject(),A.username()),"all",null,null,0,20,"created-desc"),HttpStatus.UNAUTHORIZED);
    }
    @Test void invalidParametersAndUnauthenticatedRequestsReturnJsonErrors() throws Exception {
        mvc.perform(get("/api/me/datasets")).andExpect(status().isUnauthorized());
        for(String query:List.of("source=bad","source=personal&teamId="+team,"q="+"a".repeat(101),"size=101","size=0","page=-1","page=bad","page=2147483648","sort=name","teamId=bad!"))
            mvc.perform(get("/api/me/datasets?"+query).with(login(A))).andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").isString());
        mvc.perform(get("/api/me/datasets?source=team&teamId="+hiddenTeam).with(login(A))).andExpect(status().isNotFound());
    }
    @Test void httpContractHasPublicCountAndExplicitCapabilitiesWithoutChangingOldLists() throws Exception {
        mvc.perform(get("/api/me/datasets?source=public").with(login(A))).andExpect(status().isOk()).andExpect(header().string("Cache-Control","no-store"))
                .andExpect(jsonPath("$.sourceCounts.public").value(1)).andExpect(jsonPath("$.sourceCounts.publicCount").doesNotExist())
                .andExpect(jsonPath("$.items[0].scope").value("personal")).andExpect(jsonPath("$.items[0].canDelete").value(false));
        mvc.perform(get("/api/health")).andExpect(jsonPath("$.datasetLibraryApi").value("v1")).andExpect(jsonPath("$.teamDissolutionApi").value("clear-library-v1"));
        mvc.perform(get("/api/datasets").with(login(A))).andExpect(status().isOk()).andExpect(jsonPath("$.total").value(2));
    }
    @Test void countAndPageUseTheSameSnapshotDuringMembershipRevocation() throws Exception {
        var counted=new CountDownLatch(1);var continueRead=new CountDownLatch(1);
        JdbcTemplate intercepted=new JdbcTemplate() {
            @Override public <T> T queryForObject(String sql,RowMapper<T> mapper,Object... args) {
                T result=db.queryForObject(sql,mapper,args);
                counted.countDown();
                try {if(!continueRead.await(5,TimeUnit.SECONDS)) throw new AssertionError("reader timed out");}
                catch(InterruptedException e) {throw new AssertionError(e);}
                return result;
            }
            @Override public <T> List<T> query(String sql,RowMapper<T> mapper,Object... args) {return db.query(sql,mapper,args);}
        };
        var instance=new DatasetLibraryService(intercepted,datasets,teams,manager);
        try(var executor=Executors.newVirtualThreadPerTaskExecutor()) {
            var reading=executor.submit(()->instance.list(B,"all",null,null,0,20,"created-desc"));
            try {
                assertThat(counted.await(3,TimeUnit.SECONDS)).isTrue();
                teams.removeMember(team,B.subject(),A);
            } finally {continueRead.countDown();}
            var p=reading.get(5,TimeUnit.SECONDS);
            assertThat(p.total()).isEqualTo(p.items().size());assertThat(p.sourceCounts().team()).isEqualTo(1);
            assertThat(library.list(B,"all",null,null,0,20,"created-desc").sourceCounts().team()).isZero();
        }
    }
}
