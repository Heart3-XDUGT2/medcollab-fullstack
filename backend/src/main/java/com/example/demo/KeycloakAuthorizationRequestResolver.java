package com.example.demo;

import java.net.URI;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.web.DefaultOAuth2AuthorizationRequestResolver;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizationRequestCustomizers;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizationRequestResolver;
import org.springframework.security.oauth2.core.endpoint.OAuth2AuthorizationRequest;

/** Uses the same state, nonce and PKCE validation for login and self-registration. */
final class KeycloakAuthorizationRequestResolver implements OAuth2AuthorizationRequestResolver {
    private final DefaultOAuth2AuthorizationRequestResolver delegate;

    KeycloakAuthorizationRequestResolver(ClientRegistrationRepository registrations) {
        delegate = new DefaultOAuth2AuthorizationRequestResolver(registrations, "/oauth2/authorization");
        delegate.setAuthorizationRequestCustomizer(OAuth2AuthorizationRequestCustomizers.withPkce());
    }

    @Override
    public OAuth2AuthorizationRequest resolve(HttpServletRequest request) {
        return registrationRequest(request, delegate.resolve(request));
    }

    @Override
    public OAuth2AuthorizationRequest resolve(HttpServletRequest request, String registrationId) {
        return registrationRequest(request, delegate.resolve(request, registrationId));
    }

    private static OAuth2AuthorizationRequest registrationRequest(HttpServletRequest request,
            OAuth2AuthorizationRequest authorization) {
        if (authorization == null || !"true".equals(request.getParameter("register"))) {
            return authorization;
        }
        String loginEndpoint = authorization.getAuthorizationUri();
        if (!loginEndpoint.endsWith("/protocol/openid-connect/auth")) {
            throw new IllegalStateException("Unexpected Keycloak authorization endpoint");
        }
        String registrationEndpoint = loginEndpoint.substring(0, loginEndpoint.length() - 4) + "registrations";
        String rawQuery = URI.create(authorization.getAuthorizationRequestUri()).getRawQuery();
        return OAuth2AuthorizationRequest.from(authorization)
                .authorizationUri(registrationEndpoint)
                .authorizationRequestUri(registrationEndpoint + "?" + rawQuery)
                .build();
    }
}
