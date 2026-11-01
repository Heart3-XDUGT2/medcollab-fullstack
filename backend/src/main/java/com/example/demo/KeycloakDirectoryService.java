package com.example.demo;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Read-only realm user lookup using a dedicated service account, never an administrator password. */
@Service
public class KeycloakDirectoryService {
    public record DirectoryUser(String subject, String username) {}
    private static final Pattern SUBJECT = Pattern.compile("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3))
            .followRedirects(HttpClient.Redirect.NEVER).build();
    private final JsonMapper json = JsonMapper.builder().build();
    private final String issuer;
    private final String adminUrl;
    private final String clientId;
    private final String secret;
    private String token;
    private long expiresAt;

    public KeycloakDirectoryService(@Value("${keycloak.issuer-uri}") String issuer,
            @Value("${keycloak.directory-client-id:medical-demo-directory}") String clientId,
            @Value("${keycloak.directory-client-secret:}") String secret) {
        this.issuer = issuer.replaceAll("/+$", "");
        URI uri = URI.create(this.issuer);
        String path = uri.getPath();
        int realms = path.lastIndexOf("/realms/");
        if (realms < 0 || uri.getRawQuery() != null || uri.getRawFragment() != null) {
            throw new IllegalArgumentException("Invalid Keycloak issuer for directory");
        }
        this.adminUrl = this.issuer.substring(0, this.issuer.length() - path.length())
                + path.substring(0, realms) + "/admin" + path.substring(realms);
        this.clientId = clientId;
        this.secret = secret;
    }

    public List<DirectoryUser> search(String query) {
        String q = query == null ? "" : query.strip();
        if (q.length() < 2 || q.length() > 100) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "请输入 2 至 100 个字符的用户名进行搜索");
        }
        JsonNode data = readUsers("/users?username=" + encode(q) + "&exact=false&enabled=true&max=20");
        if (!data.isArray()) throw unavailable();
        List<DirectoryUser> result = new ArrayList<>();
        for (JsonNode user : data) {
            if (human(user)) result.add(new DirectoryUser(user.path("id").asText(), user.path("username").asText()));
        }
        return List.copyOf(result);
    }

    public DirectoryUser requireUser(String subject) {
        if (subject == null || !SUBJECT.matcher(subject).matches()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "共享用户编号格式不正确");
        }
        JsonNode user = readUsers("/users/" + subject);
        if (!human(user)) throw new ApiException(HttpStatus.NOT_FOUND, "共享用户不存在或已停用");
        return new DirectoryUser(user.path("id").asText(), user.path("username").asText());
    }

    private static boolean human(JsonNode user) {
        return user.path("enabled").asBoolean(false)
                && SUBJECT.matcher(user.path("id").asText("")).matches()
                && !user.path("username").asText("").isBlank()
                && !user.path("username").asText("").startsWith("service-account-")
                && user.path("serviceAccountClientId").asText("").isBlank();
    }

    private JsonNode readUsers(String path) {
        for (int attempt = 0; attempt < 2; attempt++) {
            String bearer = accessToken(attempt > 0);
            HttpRequest request = HttpRequest.newBuilder(URI.create(adminUrl + path))
                    .timeout(Duration.ofSeconds(5)).header("Accept", "application/json")
                    .header("Authorization", "Bearer " + bearer).GET().build();
            HttpResponse<String> response = send(request);
            if (response.statusCode() == 401 && attempt == 0) continue;
            if (response.statusCode() == 404) throw new ApiException(HttpStatus.NOT_FOUND, "共享用户不存在");
            if (response.statusCode() != 200) throw unavailable();
            try { return json.readTree(response.body()); }
            catch (Exception exception) { throw unavailable(); }
        }
        throw unavailable();
    }

    private synchronized String accessToken(boolean refresh) {
        if (!refresh && token != null && System.currentTimeMillis() < expiresAt) return token;
        if (secret.isBlank()) throw unavailable();
        String form = "grant_type=client_credentials&client_id=" + encode(clientId) + "&client_secret=" + encode(secret);
        HttpRequest request = HttpRequest.newBuilder(URI.create(issuer + "/protocol/openid-connect/token"))
                .timeout(Duration.ofSeconds(5)).header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(form)).build();
        HttpResponse<String> response = send(request);
        if (response.statusCode() != 200) throw unavailable();
        try {
            JsonNode data = json.readTree(response.body());
            String value = data.path("access_token").asText("");
            if (value.isBlank()) throw unavailable();
            token = value;
            expiresAt = System.currentTimeMillis() + Math.max(1, data.path("expires_in").asLong(60) - 15) * 1000;
            return token;
        } catch (Exception exception) { throw unavailable(); }
    }

    private HttpResponse<String> send(HttpRequest request) {
        try { return client.send(request, HttpResponse.BodyHandlers.ofString()); }
        catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw unavailable();
        } catch (Exception exception) { throw unavailable(); }
    }

    private static String encode(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8); }
    private static ApiException unavailable() {
        return new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "无法查询 Keycloak 用户，请确认账户服务已启动后重试");
    }
}
