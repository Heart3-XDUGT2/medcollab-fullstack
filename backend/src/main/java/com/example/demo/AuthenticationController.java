package com.example.demo;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class AuthenticationController {
    private static final Logger log = LoggerFactory.getLogger(AuthenticationController.class);
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
    private final URI discovery;

    public AuthenticationController(@Value("${keycloak.issuer-uri}") String issuer) {
        discovery = URI.create(issuer + "/.well-known/openid-configuration");
    }

    @GetMapping("/auth/login")
    public void login(HttpServletResponse response) throws IOException {
        begin(response, false);
    }

    @GetMapping("/auth/register")
    public void register(HttpServletResponse response) throws IOException {
        begin(response, true);
    }

    private void begin(HttpServletResponse response, boolean register) throws IOException {
        response.setHeader("Cache-Control", "no-store");
        try {
            HttpResponse<Void> status = client.send(HttpRequest.newBuilder(discovery)
                    .timeout(Duration.ofSeconds(3)).GET().build(), HttpResponse.BodyHandlers.discarding());
            if (status.statusCode() != 200) {
                log.warn("Keycloak 暂不可用：HTTP {}", status.statusCode());
                response.sendRedirect("/?authError=unavailable");
                return;
            }
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            response.sendRedirect("/?authError=unavailable");
            return;
        } catch (IOException exception) {
            log.warn("Keycloak 暂不可用：{}", exception.getClass().getSimpleName());
            response.sendRedirect("/?authError=unavailable");
            return;
        }
        response.sendRedirect("/oauth2/authorization/keycloak" + (register ? "?register=true" : ""));
    }
}
