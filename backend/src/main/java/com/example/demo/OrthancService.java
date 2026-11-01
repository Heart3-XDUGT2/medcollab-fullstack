package com.example.demo;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.regex.Pattern;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Service
public class OrthancService {
    private static final Logger log = LoggerFactory.getLogger(OrthancService.class);
    private static final Pattern RESOURCE_ID = Pattern.compile("[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{8}){4}");
    private static final byte[] PNG_SIGNATURE = {(byte) 137, 80, 78, 71, 13, 10, 26, 10};
    private final HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(3)).followRedirects(HttpClient.Redirect.NEVER)
            .version(HttpClient.Version.HTTP_1_1).build();
    private final JsonMapper json = JsonMapper.builder().build();
    private final String baseUrl;

    public record Status(boolean connected, String name, String version, long instanceCount) {
    }

    public record SeriesItem(String id, String description, String modality, int instanceCount) {
    }

    public record InstanceItem(String id, String instanceNumber) {
    }

    public record Items<T>(List<T> items, int total) {
    }

    public record ImportResult(String status, String id) {
    }

    public record DicomWebResponse(byte[] body, String contentType) { }

    /** Only the scoped DICOMweb service constructs these validated paths. */
    public DicomWebResponse dicomWeb(String path, boolean metadata) {
        if (!path.matches("/studies/[0-9.]+/series/[0-9.]+(?:/metadata|/instances/[0-9.]+(?:/metadata|/frames/[0-9,]+|/bulk/[0-9A-Fa-f/]+)?)"))
            throw new IllegalArgumentException("Invalid internal DICOMweb path");
        try {
            var request = HttpRequest.newBuilder(URI.create(baseUrl + "/dicom-web" + path))
                    .timeout(Duration.ofSeconds(60)).header("Accept", metadata ? "application/dicom+json" : "*/*").GET().build();
            var response = client.send(request, HttpResponse.BodyHandlers.ofByteArray());
            if (response.statusCode() == 404) throw new ApiException(HttpStatus.NOT_FOUND,"未找到 DICOMweb 影像");
            if (response.statusCode() != 200) throw invalidResponse();
            return new DicomWebResponse(response.body(),response.headers().firstValue("Content-Type").orElse("application/octet-stream"));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE,"影像读取已中断");
        } catch (IOException e) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE,"DICOMweb 服务暂不可用");
        }
    }

    public OrthancService(@Value("${orthanc.base-url:http://127.0.0.1:8042}") String configuredUrl) {
        URI address = URI.create(configuredUrl.strip());
        if (!("http".equals(address.getScheme()) || "https".equals(address.getScheme()))
                || address.getHost() == null || address.getRawQuery() != null
                || address.getRawFragment() != null || address.getRawUserInfo() != null) {
            throw new IllegalArgumentException("orthanc.base-url must be an HTTP(S) server address");
        }
        this.baseUrl = address.toString().replaceAll("/+$", "");
    }

    public Status status() {
        JsonNode system = readJson("GET", "/system", null);
        return new Status(true, text(system, "Name", "Orthanc"), text(system, "Version", "未知"),
                0);
    }

    public InstanceItem instance(String instanceId) {
        JsonNode item = readJson("GET", "/instances/" + checkedId(instanceId), null);
        return new InstanceItem(checkedId(text(item, "ID", "")), text(item.path("MainDicomTags"), "InstanceNumber", ""));
    }

    public JsonNode instanceMetadata(String instanceId) {
        return readJson("GET", "/instances/" + checkedId(instanceId), null);
    }

    public JsonNode simplifiedTags(String instanceId) {
        return readJson("GET", "/instances/" + checkedId(instanceId) + "/simplified-tags", null);
    }

    public byte[] file(String instanceId) {
        return exchange("GET", "/instances/" + checkedId(instanceId) + "/file", null, false);
    }

    public Items<SeriesItem> series() {
        JsonNode data = readJson("GET", "/series?expand", null);
        requireArray(data);
        List<SeriesItem> result = new ArrayList<>();
        for (JsonNode item : data) {
            JsonNode tags = item.path("MainDicomTags");
            String description = text(tags, "SeriesDescription", "未命名序列");
            result.add(new SeriesItem(checkedId(text(item, "ID", "")), description,
                    text(tags, "Modality", "未知"), item.path("Instances").size()));
        }
        result.sort(Comparator.comparing(SeriesItem::description).thenComparing(SeriesItem::id));
        return new Items<>(List.copyOf(result), result.size());
    }

    public Items<InstanceItem> instances(String seriesId) {
        JsonNode data = readJson("GET", "/series/" + checkedId(seriesId) + "/instances", null);
        requireArray(data);
        List<InstanceItem> result = new ArrayList<>();
        for (JsonNode item : data) {
            result.add(new InstanceItem(checkedId(text(item, "ID", "")),
                    text(item.path("MainDicomTags"), "InstanceNumber", "")));
        }
        result.sort(Comparator.comparingLong((InstanceItem item) -> numericOrder(item.instanceNumber()))
                .thenComparing(InstanceItem::id));
        return new Items<>(List.copyOf(result), result.size());
    }

    public byte[] preview(String instanceId) {
        byte[] image = exchange("GET", "/instances/" + checkedId(instanceId) + "/preview", null, true);
        if (image.length < PNG_SIGNATURE.length) {
            throw invalidResponse();
        }
        for (int i = 0; i < PNG_SIGNATURE.length; i++) {
            if (image[i] != PNG_SIGNATURE[i]) {
                throw invalidResponse();
            }
        }
        return image;
    }

    public ImportResult importDicom(byte[] bytes) {
        JsonNode result = readJson("POST", "/instances", bytes);
        String status = text(result, "Status", "");
        if (!("Success".equals(status) || "AlreadyStored".equals(status))) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "Orthanc 未确认影像导入成功，请查看服务日志");
        }
        return new ImportResult(status, checkedId(text(result, "ID", "")));
    }

    private JsonNode readJson(String method, String path, byte[] body) {
        byte[] response = exchange(method, path, body, false);
        try {
            JsonNode node = json.readTree(response);
            if (node == null) {
                throw invalidResponse();
            }
            return node;
        } catch (ApiException exception) {
            throw exception;
        } catch (Exception exception) {
            log.warn("Orthanc 响应无法解析：类型={}", exception.getClass().getSimpleName());
            throw invalidResponse();
        }
    }

    private byte[] exchange(String method, String path, byte[] body, boolean image) {
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(baseUrl + path))
                .timeout(Duration.ofSeconds(30)).header("Accept", image ? "image/png" : "application/json");
        if (body == null) {
            builder.GET();
        } else {
            builder.header("Content-Type", "application/dicom")
                    .method(method, HttpRequest.BodyPublishers.ofByteArray(body));
        }
        long started = System.nanoTime();
        final HttpResponse<byte[]> response;
        try {
            response = client.send(builder.build(), HttpResponse.BodyHandlers.ofByteArray());
        } catch (HttpTimeoutException exception) {
            log.warn("Orthanc 请求超时：{} {}", method, path);
            throw new ApiException(HttpStatus.GATEWAY_TIMEOUT, "Orthanc 响应超时，请稍后重试");
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            log.warn("Orthanc 请求已中断：{} {}", method, path);
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "影像请求已中断，请重试");
        } catch (IOException exception) {
            log.warn("无法连接 Orthanc：{} {}，类型={}", method, path, exception.getClass().getSimpleName());
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "无法连接 Orthanc，请确认影像服务已启动");
        }
        int status = response.statusCode();
        log.info("Orthanc 请求：{} {} -> {}，耗时={}ms", method, path, status,
                (System.nanoTime() - started) / 1_000_000);
        if (status >= 200 && status < 300) {
            return response.body();
        }
        if (status == 404) {
            throw new ApiException(HttpStatus.NOT_FOUND, "未找到对应的影像或序列，请重新浏览");
        }
        if (status == 413) {
            throw new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "影像文件过大，Orthanc 拒绝接收");
        }
        if ("POST".equals(method) && "/instances".equals(path)
                && (status == 400 || status == 415 || status == 422)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "文件不是有效的 DICOM 影像，或 Orthanc 无法导入");
        }
        throw new ApiException(HttpStatus.BAD_GATEWAY, "Orthanc 处理请求失败，请查看 Orthanc 日志（HTTP " + status + "）");
    }

    private static String text(JsonNode node, String key, String fallback) {
        String value = node.path(key).asText("");
        return value.isBlank() ? fallback : value;
    }

    private static long numericOrder(String value) {
        try {
            return Long.parseLong(value.strip());
        } catch (NumberFormatException exception) {
            return Long.MAX_VALUE;
        }
    }

    private static String checkedId(String id) {
        if (id == null || !RESOURCE_ID.matcher(id).matches()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "影像或序列编号格式不正确");
        }
        return id;
    }

    private static void requireArray(JsonNode node) {
        if (!node.isArray()) {
            throw invalidResponse();
        }
    }

    private static ApiException invalidResponse() {
        return new ApiException(HttpStatus.BAD_GATEWAY, "Orthanc 返回了无法识别的数据，请查看服务日志");
    }
}
