package com.example.demo;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import java.util.List;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties={"keycloak.client-secret=unused-test-secret","spring.datasource.url=jdbc:h2:mem:dicomweb-tests;DB_CLOSE_DELAY=-1","app.datasets.seed-enabled=false"})
@AutoConfigureMockMvc
class DicomWebScopeTests {
    static final String ISSUER="http://127.0.0.1:8081/realms/medical-demo", ID="11111111-11111111-11111111-11111111-11111111", SERIES="aaaaaaaa-aaaaaaaa-aaaaaaaa-aaaaaaaa-aaaaaaaa";
    @Autowired MockMvc mvc; @Autowired DatasetService datasets; @Autowired JdbcTemplate db;
    @MockitoBean OrthancService orthanc; @MockitoBean DicomSegCodec codec; @MockitoBean KeycloakDirectoryService directory;
    String dataset,root;
    @BeforeEach void setup() {
        db.update("DELETE FROM segmentation_publications"); db.update("DELETE FROM segmentation_drafts");
        db.update("DELETE FROM dataset_grants");db.update("DELETE FROM dataset_instances");db.update("DELETE FROM datasets");
        dataset=datasets.create("private",new DemoSession.Identity(ISSUER,"alice","alice")).id();
        db.update("INSERT INTO dataset_instances VALUES (?,?,?)",dataset,ID,"1");
        when(codec.sources(anyList())).thenReturn(List.of(new DicomSegCodec.SourceImage(ID,"1",SERIES,"CT",4,5,"1.2.3.1")));
        var mapper=tools.jackson.databind.json.JsonMapper.builder().build();
        when(orthanc.simplifiedTags(ID)).thenReturn(mapper.readTree("{\"StudyInstanceUID\":\"1.2.3\",\"SeriesInstanceUID\":\"1.2.4\"}"));
        String allowed="{\"0020000D\":{\"vr\":\"UI\",\"Value\":[\"1.2.3\"]},\"0020000E\":{\"vr\":\"UI\",\"Value\":[\"1.2.4\"]},\"00080018\":{\"vr\":\"UI\",\"Value\":[\"1.2.3.1\"]},\"00200052\":{\"vr\":\"UI\",\"Value\":[\"1.2.5\"]},\"7FE00010\":{\"vr\":\"OW\",\"BulkDataURI\":\"http://127.0.0.1:8042/dicom-web/studies/1.2.3/series/1.2.4/instances/1.2.3.1/bulk/7fe00010\"}}";
        String forbidden=allowed.replace("1.2.3.1","1.2.3.2");
        when(orthanc.dicomWeb("/studies/1.2.3/series/1.2.4/metadata",true)).thenReturn(new OrthancService.DicomWebResponse(("["+allowed+","+forbidden+"]").getBytes(),"application/dicom+json"));
        when(orthanc.dicomWeb(endsWith("/frames/1"),eq(false))).thenReturn(new OrthancService.DicomWebResponse(new byte[]{1,2,3},"multipart/related; boundary=abc; type=\"application/octet-stream\""));
        root="/api/datasets/"+dataset+"/dicomweb";
    }
    private org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.OidcLoginRequestPostProcessor alice() {return oidcLogin().idToken(t->t.subject("alice").claim("iss",ISSUER).claim("preferred_username","alice"));}
    @Test void partialSeriesMetadataAndCountsNeverExposeOtherInstances() throws Exception {
        mvc.perform(get(root+"/studies/1.2.3/series/1.2.4/metadata").with(alice())).andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0]['7FE00010'].BulkDataURI").value(root+"/studies/1.2.3/series/1.2.4/instances/1.2.3.1/bulk/7fe00010"));
        mvc.perform(get(root+"/studies/1.2.3/series").with(alice())).andExpect(status().isOk()).andExpect(jsonPath("$[0]['00201209'].Value[0]").value(1));
        mvc.perform(get(root+"/studies/1.2.3/series/1.2.4/instances/1.2.3.2/frames/1").with(alice())).andExpect(status().isNotFound());
        verify(orthanc,never()).dicomWeb(contains("1.2.3.2/frames"),eq(false));
    }
    @Test void scopedFramesPreserveMultipartAndRejectFrameForgery() throws Exception {
        var response=mvc.perform(get(root+"/studies/1.2.3/series/1.2.4/instances/1.2.3.1/frames/1").with(alice())).andExpect(status().isOk()).andReturn().getResponse();
        assertThat(response.getContentAsByteArray()).containsExactly(1,2,3);assertThat(response.getContentType()).contains("boundary=abc");
        mvc.perform(get(root+"/studies/1.2.3/series/1.2.4/instances/1.2.3.1/frames/2").with(alice())).andExpect(status().isNotFound());
        mvc.perform(get(root+"/studies/1.2.999/series/1.2.4/instances/1.2.3.1/frames/1").with(alice())).andExpect(status().isNotFound());
    }
    @Test void everyRouteChecksSessionAndMembershipBeforeTouchingOrthanc() throws Exception {
        mvc.perform(get(root+"/studies")).andExpect(status().isUnauthorized());
        mvc.perform(get(root+"/studies").with(oidcLogin().idToken(t->t.subject("bob").claim("iss",ISSUER)))).andExpect(status().isNotFound());
        verifyNoInteractions(orthanc);
    }
    @Test void launchHasRealUidsAndLabelmapWritesRequireCsrf() throws Exception {
        mvc.perform(get("/api/datasets/"+dataset+"/workspace").with(alice())).andExpect(status().isOk())
                .andExpect(jsonPath("$.series[0].id").value(SERIES)).andExpect(jsonPath("$.series[0].seriesInstanceUID").value("1.2.4"));
        mvc.perform(post("/api/datasets/"+dataset+"/segmentations/"+SERIES+"/publish-labelmap").with(alice()).contentType("application/json").content("{}")).andExpect(status().isForbidden());
    }
}
