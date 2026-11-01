package com.example.demo;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.InMemoryClientRegistrationRepository;
import org.springframework.security.oauth2.core.AuthorizationGrantType;

class KeycloakAuthorizationRequestResolverTests {
    private final KeycloakAuthorizationRequestResolver resolver = new KeycloakAuthorizationRequestResolver(
            new InMemoryClientRegistrationRepository(ClientRegistration.withRegistrationId("keycloak")
                    .clientId("medical-demo-web").clientSecret("unused-test-secret")
                    .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                    .redirectUri("http://127.0.0.1:8080/login/oauth2/code/keycloak")
                    .scope("openid", "profile")
                    .authorizationUri("http://127.0.0.1:8081/realms/medical-demo/protocol/openid-connect/auth")
                    .tokenUri("http://127.0.0.1:8081/realms/medical-demo/protocol/openid-connect/token")
                    .build()));

    private MockHttpServletRequest request(boolean register) {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/oauth2/authorization/keycloak");
        request.setServletPath("/oauth2/authorization/keycloak");
        if (register) request.setParameter("register", "true");
        return request;
    }

    @Test
    void loginUsesPkceStateAndNonce() {
        var authorization = resolver.resolve(request(false));
        assertThat(authorization.getAuthorizationUri()).endsWith("/openid-connect/auth");
        assertThat(authorization.getState()).isNotBlank();
        assertThat(authorization.getAdditionalParameters()).containsEntry("code_challenge_method", "S256");
        assertThat(authorization.getAdditionalParameters()).containsKey("nonce");
        assertThat(authorization.getAttributes()).containsKey("code_verifier");
    }

    @Test
    void registrationUsesRealEndpointAndPreservesAllOidcChecks() {
        var authorization = resolver.resolve(request(true));
        assertThat(authorization.getAuthorizationUri()).endsWith("/openid-connect/registrations");
        assertThat(URI.create(authorization.getAuthorizationRequestUri()).getPath())
                .endsWith("/openid-connect/registrations");
        assertThat(authorization.getAuthorizationRequestUri()).contains("state=", "nonce=", "code_challenge=", "code_challenge_method=S256");
        assertThat(authorization.getAttributes()).containsKey("code_verifier");
        assertThat(authorization.getState()).isNotBlank();
    }
}
