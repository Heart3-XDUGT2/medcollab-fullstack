package com.example.demo;

import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.time.Duration;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.regex.Pattern;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
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
    private final Duration importTimeout;
    private static final int STREAM_BUFFER_BYTES = 64 * 1024;
    private static final int MAX_IMPORT_RESPONSE_BYTES = 64 * 1024;
    private static final ScheduledThreadPoolExecutor STREAM_DEADLINES = deadlines();

    private static ScheduledThreadPoolExecutor deadlines() {
        var executor = new ScheduledThreadPoolExecutor(1, task -> {
            Thread thread = new Thread(task, "orthanc-import-deadline");
            thread.setDaemon(true);
            return thread;
        });
        executor.setRemoveOnCancelPolicy(true);
        return executor;
    }

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

    public OrthancService(String configuredUrl) { this(configuredUrl, 1800); }

    @Autowired
    public OrthancService(@Value("${orthanc.base-url:http://127.0.0.1:8042}") String configuredUrl,
            @Value("${orthanc.import-timeout-seconds:1800}") long importTimeoutSeconds) {
        URI address = URI.create(configuredUrl.strip());
        if (!("http".equals(address.getScheme()) || "https".equals(address.getScheme()))
                || address.getHost() == null || address.getRawQuery() != null
                || address.getRawFragment() != null || address.getRawUserInfo() != null) {
            throw new IllegalArgumentException("orthanc.base-url must be an HTTP(S) server address");
        }
        this.baseUrl = address.toString().replaceAll("/+$", "");
        if (importTimeoutSeconds <= 0) throw new IllegalArgumentException("orthanc.import-timeout-seconds must be positive");
        this.importTimeout = Duration.ofSeconds(importTimeoutSeconds);
        this.importTimeout.toNanos();
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

    /** Only generated SEG instances may be removed by the retention worker. Missing files are already cleaned. */
    public void deleteSegmentation(String instanceId) {
        String id = checkedId(instanceId);
        final JsonNode tags;
        try { tags = simplifiedTags(id); }
        catch (ApiException exception) {
            if (exception.status() == HttpStatus.NOT_FOUND) return;
            throw exception;
        }
        String sopClass = text(tags, "SOPClassUID", "");
        if (!List.of("1.2.840.10008.5.1.4.1.1.66.4", "1.2.840.10008.5.1.4.1.1.66.7").contains(sopClass))
            throw new ApiException(HttpStatus.CONFLICT, "清理目标不是 DICOM SEG，已保留该文件");
        exchange("DELETE", "/instances/" + id, null, false);
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
        return imported(readJson("POST", "/instances", bytes));
    }

    private static ImportResult imported(JsonNode result) {
        if (result == null) throw invalidResponse();
        String status = text(result, "Status", "");
        if (!("Success".equals(status) || "AlreadyStored".equals(status))) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "Orthanc 未确认影像导入成功，请查看服务日志");
        }
        return new ImportResult(status, checkedId(text(result, "ID", "")));
    }

    /** A repeatable file publisher stays valid until send and response consumption finish. */
    public ImportResult importDicomFile(Path file) {
        final HttpRequest request;
        try {
            request = HttpRequest.newBuilder(URI.create(baseUrl + "/instances"))
                    .timeout(importTimeout).header("Accept", "application/json")
                    .header("Content-Type", "application/dicom")
                    .POST(HttpRequest.BodyPublishers.ofFile(file)).build();
        } catch (IOException exception) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "无法读取导入暂存文件");
        }
        long started = System.nanoTime();
        var response = sendImportStream(request);
        return consumeImport(response, started, input -> {
            requireSuccess(response.statusCode(), "POST", "/instances");
            byte[] reply = input.readNBytes(MAX_IMPORT_RESPONSE_BYTES + 1);
            if (reply.length > MAX_IMPORT_RESPONSE_BYTES) throw invalidResponse();
            try { return imported(json.readTree(reply)); }
            catch (ApiException exception) { throw exception; }
            catch (Exception exception) { throw invalidResponse(); }
        });
    }

    /** Physical deduplication is accepted only after length and SHA-256 agree. */
    public boolean matchesDicomFile(String instanceId, Path incoming) {
        final FileDigest expected;
        try (InputStream input = Files.newInputStream(incoming)) {
            expected = digest(input, Files.size(incoming));
        } catch (IOException exception) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "无法核对导入暂存文件");
        }
        if (expected == null) throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "导入暂存文件已变化");
        String path = "/instances/" + checkedId(instanceId) + "/file";
        var request = HttpRequest.newBuilder(URI.create(baseUrl + path)).timeout(importTimeout)
                .header("Accept", "application/dicom").GET().build();
        long started = System.nanoTime();
        var response = sendImportStream(request);
        return consumeImport(response, started, input -> {
            requireSuccess(response.statusCode(), "GET", path);
            final long declaredLength;
            try {
                var length = response.headers().firstValueAsLong("Content-Length");
                if (length.isPresent() && length.getAsLong() < 0) throw incompleteComparison();
                declaredLength = length.orElse(-1);
            } catch (NumberFormatException exception) {
                throw incompleteComparison();
            }
            // A declared size mismatch already prevents association; do not download
            // another object's entire contents just to establish that mismatch.
            if (declaredLength >= 0 && declaredLength != expected.length()) return false;
            FileDigest stored = digest(input, expected.length());
            if (declaredLength >= 0 && (stored == null || stored.length() != declaredLength))
                throw incompleteComparison();
            return stored != null && stored.length() == expected.length()
                    && MessageDigest.isEqual(expected.sha256(), stored.sha256());
        });
    }

    private static ApiException incompleteComparison() {
        return new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "影像核对响应不完整，本次结果尚未确认，请先核对资料库");
    }

    record FileDigest(long length, byte[] sha256) { }

    static FileDigest digest(InputStream input, long maximum) throws IOException {
        final MessageDigest digest;
        try { digest = MessageDigest.getInstance("SHA-256"); }
        catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
        byte[] buffer = new byte[STREAM_BUFFER_BYTES];
        long length = 0;
        while (true) {
            int requested = length < maximum ? (int) Math.min(buffer.length, maximum - length) : 1;
            int read = input.read(buffer, 0, requested);
            if (read == -1) break;
            if (Thread.currentThread().isInterrupted()) throw new InterruptedIOException("Import comparison interrupted");
            if (read > maximum - length) return null;
            digest.update(buffer, 0, read);
            length += read;
        }
        return new FileDigest(length, digest.digest());
    }

    private HttpResponse<InputStream> sendImportStream(HttpRequest request) {
        try {
            // A failed POST is never replayed here, including unknown timeout/network results.
            return client.send(request, HttpResponse.BodyHandlers.ofInputStream());
        } catch (HttpTimeoutException exception) {
            throw importTimedOut();
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "导入已中断，请先核对资料库，勿重复上传");
        } catch (IOException exception) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "导入传输未完成，请先核对资料库，勿重复上传");
        }
    }

    @FunctionalInterface private interface StreamReader<T> { T read(InputStream stream) throws IOException; }

    private <T> T consumeImport(HttpResponse<InputStream> response, long started, StreamReader<T> reader) {
        InputStream body = response.body();
        AtomicBoolean expired = new AtomicBoolean();
        long remaining = importTimeout.toNanos() - (System.nanoTime() - started);
        var deadline = STREAM_DEADLINES.schedule(() -> {
            expired.set(true);
            try { body.close(); } catch (IOException ignored) { }
        }, Math.max(0, remaining), TimeUnit.NANOSECONDS);
        try (body) {
            if (remaining <= 0) throw importTimedOut();
            T result = reader.read(body);
            if (expired.get()) throw importTimedOut();
            return result;
        } catch (IOException exception) {
            if (expired.get()) throw importTimedOut();
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "导入内容核对未完成，请先核对资料库，勿重复上传");
        } finally {
            deadline.cancel(false);
        }
    }

    private static ApiException importTimedOut() {
        return new ApiException(HttpStatus.GATEWAY_TIMEOUT, "导入响应超时，本次结果可能尚未确认，请先核对资料库");
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
            builder.method(method, HttpRequest.BodyPublishers.noBody());
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
        requireSuccess(status, method, path);
        return response.body();
    }

    private static void requireSuccess(int status, String method, String path) {
        if (status >= 200 && status < 300) return;
        if (status == 404) {
            if ("DELETE".equals(method)) return;
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
