package com.example.demo;

import java.io.IOException;
import java.util.Map;

import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.oauth2.client.oidc.web.logout.OidcClientInitiatedLogoutSuccessHandler;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.registration.InMemoryClientRegistrationRepository;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.savedrequest.NullRequestCache;
import tools.jackson.databind.json.JsonMapper;

@Configuration
public class SecurityConfiguration {
    private static final Logger log = LoggerFactory.getLogger(SecurityConfiguration.class);
    private static final JsonMapper json = JsonMapper.builder().build();

    @Bean
    ClientRegistrationRepository clientRegistrationRepository(
            @Value("${keycloak.issuer-uri}") String issuer,
            @Value("${keycloak.client-id}") String clientId,
            @Value("${keycloak.client-secret}") String secret,
            @Value("${app.base-url}") String appBaseUrl) {
        if (secret.isBlank()) {
            throw new IllegalStateException("KEYCLOAK_CLIENT_SECRET is missing. Start with the configured WSL environment.");
        }
        String oidc = issuer + "/protocol/openid-connect";
        ClientRegistration registration = ClientRegistration.withRegistrationId("keycloak")
                .clientId(clientId).clientSecret(secret)
                .clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_BASIC)
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .redirectUri(appBaseUrl + "/login/oauth2/code/keycloak")
                .scope("openid", "profile", "email")
                .issuerUri(issuer).authorizationUri(oidc + "/auth").tokenUri(oidc + "/token")
                .jwkSetUri(oidc + "/certs").userInfoUri(oidc + "/userinfo")
                .userNameAttributeName("sub").clientName("Keycloak")
                .providerConfigurationMetadata(Map.of("end_session_endpoint", oidc + "/logout"))
                .build();
        return new InMemoryClientRegistrationRepository(registration);
    }

    @Bean
    SecurityFilterChain applicationSecurity(HttpSecurity http, ClientRegistrationRepository registrations,
            @Value("${app.base-url}") String appBaseUrl) throws Exception {
        var logout = new OidcClientInitiatedLogoutSuccessHandler(registrations);
        logout.setPostLogoutRedirectUri(appBaseUrl + "/?logout=1");
        logout.setDefaultTargetUrl(appBaseUrl + "/?logout=1");
        logout.setRedirectStrategy((request, response, url) -> {
            log.info("退出登录：Java 会话已清除，正在结束 Keycloak 登录会话");
            writeJson(response, 200, Map.of("logoutUrl", url));
        });

        return http
                .authorizeHttpRequests(authorize -> authorize
                        .requestMatchers("/", "/index.html", "/teams.html", "/teams.js", "/segmentation.js", "/mask-drafts.js", "/favicon.ico", "/error", "/auth/**", "/oauth2/**",
                                "/login/oauth2/**", "/api/session", "/api/health").permitAll()
                        .requestMatchers("/api/**").authenticated()
                        .anyRequest().denyAll())
                .requestCache(cache -> cache.requestCache(new NullRequestCache()))
                .exceptionHandling(errors -> errors
                        .authenticationEntryPoint((request, response, exception) ->
                                writeJson(response, 401, Map.of("error", "请先登录")))
                        .accessDeniedHandler((request, response, exception) ->
                                writeJson(response, 403, Map.of("error", "请求校验失败，请刷新页面后重试"))))
                .oauth2Login(oauth -> oauth
                        .authorizationEndpoint(endpoint -> endpoint.authorizationRequestResolver(
                                new KeycloakAuthorizationRequestResolver(registrations)))
                        .successHandler((request, response, authentication) -> {
                            log.info("Keycloak 登录成功：用户={}", DemoSession.currentUser(request));
                            response.sendRedirect("/");
                        })
                        .failureHandler((request, response, exception) -> {
                            log.warn("Keycloak 登录未完成：{}", exception.getClass().getSimpleName());
                            response.sendRedirect("/?authError=1");
                        }))
                .logout(config -> config.logoutUrl("/api/logout")
                        .invalidateHttpSession(true).clearAuthentication(true)
                        .deleteCookies("MEDICAL_DEMO_SESSION")
                        .logoutSuccessHandler(logout))
                .build();
    }

    private static void writeJson(HttpServletResponse response, int status, Map<String, String> body)
            throws IOException {
        response.setStatus(status);
        response.setCharacterEncoding("UTF-8");
        response.setContentType("application/json");
        response.setHeader("Cache-Control", "no-store");
        response.getWriter().write(json.writeValueAsString(body));
    }
}
