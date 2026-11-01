package com.example.demo;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oidcLogin;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.redirectedUrl;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest(properties = "keycloak.client-secret=unused-test-secret")
@AutoConfigureMockMvc
class AuthenticationSecurityTests {
    @Autowired MockMvc mvc;
    @Autowired ClientRegistrationRepository registrations;
    private final JsonMapper json = JsonMapper.builder().build();

    @Test
    void browserCanLoadEditorScriptWithoutExposingAuthenticatedData() throws Exception {
        mvc.perform(get("/segmentation.js"))
                .andExpect(status().isOk())
                .andExpect(content().string(org.hamcrest.Matchers.containsString("window.maskEditor")));
        mvc.perform(get("/api/datasets/public-ctchest/segmentation/sources"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void anonymousSessionHasCsrfTokenButNoIdentity() throws Exception {
        mvc.perform(get("/api/session"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.loggedIn").value(false))
                .andExpect(jsonPath("$.csrfToken").isNotEmpty())
                .andExpect(jsonPath("$.csrfHeaderName").value("X-CSRF-TOKEN"));
    }

    @Test
    void anonymousImagingRequestsGetJsonInsteadOfLoginHtml() throws Exception {
        mvc.perform(get("/api/series"))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentTypeCompatibleWith("application/json"))
                .andExpect(jsonPath("$.error").value("请先登录"));
    }

    @Test
    void oldFakeSessionAttributeCannotAuthenticate() throws Exception {
        MockHttpSession session = new MockHttpSession();
        session.setAttribute("demo.username", "pretend-admin");
        mvc.perform(get("/api/series").session(session)).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/session").session(session)).andExpect(jsonPath("$.loggedIn").value(false));
    }

    @Test
    void oldFakeLoginEndpointCannotCreateSession() throws Exception {
        mvc.perform(post("/api/login").with(csrf()).contentType("application/json")
                        .content("{\"username\":\"pretend-admin\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void verifiedOidcIdentitySuppliesTheUsername() throws Exception {
        mvc.perform(get("/api/session").with(oidcLogin()
                        .idToken(token -> token.claim("preferred_username", "real-keycloak-user"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.loggedIn").value(true))
                .andExpect(jsonPath("$.username").value("real-keycloak-user"));
    }

    @Test
    void uploadWithoutCsrfIsRejectedEvenWithAuthenticatedSession() throws Exception {
        mvc.perform(multipart("/api/import").file(new MockMultipartFile("file", "empty.dcm", "application/dicom", new byte[0]))
                        .with(oidcLogin()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error").value("请求校验失败，请刷新页面后重试"));
    }

    @Test
    void csrfReturnedToBrowserCanBeUsedForMultipartUpload() throws Exception {
        var initial = mvc.perform(get("/api/session").with(oidcLogin().idToken(token ->
                token.claim("iss", "http://127.0.0.1:8081/realms/medical-demo")))).andReturn();
        JsonNode sessionInfo = json.readTree(initial.getResponse().getContentAsString());
        MockHttpSession session = (MockHttpSession) initial.getRequest().getSession(false);
        mvc.perform(multipart("/api/import").file(new MockMultipartFile("file", "empty.dcm", "application/dicom", new byte[0]))
                        .session(session).with(oidcLogin().idToken(token ->
                                token.claim("iss", "http://127.0.0.1:8081/realms/medical-demo")))
                        .header(sessionInfo.path("csrfHeaderName").asText(), sessionInfo.path("csrfToken").asText()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("请选择非空的 DICOM 文件"));
    }

    @Test
    void callbackWithMissingAuthorizationStateCannotLogin() throws Exception {
        mvc.perform(get("/login/oauth2/code/keycloak").param("state", "forged-state").param("code", "unused-code"))
                .andExpect(status().isFound())
                .andExpect(redirectedUrl("/?authError=1"));
    }

    @Test
    void logoutClearsJavaSessionAndReturnsKeycloakLogoutDestination() throws Exception {
        MockHttpSession session = new MockHttpSession();
        var result = mvc.perform(post("/api/logout").session(session).with(csrf())
                        .with(oidcLogin().clientRegistration(registrations.findByRegistrationId("keycloak"))))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith("application/json"))
                .andReturn();
        String logoutUrl = json.readTree(result.getResponse().getContentAsString()).path("logoutUrl").asText();
        assertThat(logoutUrl).startsWith("http://127.0.0.1:8081/realms/medical-demo/protocol/openid-connect/logout?");
        assertThat(logoutUrl).contains("post_logout_redirect_uri=");
        assertThat(session.isInvalid()).isTrue();
    }
}
