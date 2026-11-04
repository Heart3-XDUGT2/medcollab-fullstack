package com.example.demo;

import static org.assertj.core.api.Assertions.*;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.HttpStatus;

/** Loopback HTTP protocol fixtures only; never connect to the real Orthanc. */
class OrthancStreamingTests {
    private static final String ID = "11111111-11111111-11111111-11111111-11111111";
    @TempDir Path directory;
    HttpServer server;
    ExecutorService executor;

    OrthancService serve(HttpHandler handler, long timeoutSeconds) throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        executor = Executors.newVirtualThreadPerTaskExecutor();
        server.setExecutor(executor);
        server.createContext("/", handler);
        server.start();
        return new OrthancService("http://127.0.0.1:" + server.getAddress().getPort(), timeoutSeconds);
    }

    @AfterEach void shutdown() {
        if (server != null) server.stop(0);
        if (executor != null) executor.shutdownNow();
    }

    @Test void fileLargerThan64MiBIsPublishedAndDeduplicatedWithBoundedBuffers() throws Exception {
        long size = 80L * 1024 * 1024;
        Path file = directory.resolve("sparse-source.dcm");
        try (RandomAccessFile sparse = new RandomAccessFile(file.toFile(), "rw")) {
            sparse.setLength(size);
            sparse.seek(size - 1);
            sparse.write(7);
        }
        AtomicLong received = new AtomicLong();
        AtomicReference<String> contentLength = new AtomicReference<>();
        AtomicInteger posts = new AtomicInteger();
        AtomicInteger tail = new AtomicInteger();
        OrthancService orthanc = serve(exchange -> {
            try (exchange) {
                if ("POST".equals(exchange.getRequestMethod())) {
                    posts.incrementAndGet();
                    contentLength.set(exchange.getRequestHeaders().getFirst("Content-Length"));
                    byte[] buffer = new byte[64 * 1024];
                    int read;
                    try (var input = exchange.getRequestBody()) {
                        while ((read = input.read(buffer)) != -1) {
                            received.addAndGet(read);
                            if (read > 0) tail.set(buffer[read - 1]);
                        }
                    }
                    byte[] reply = ("{\"Status\":\"AlreadyStored\",\"ID\":\"" + ID + "\"}").getBytes(StandardCharsets.UTF_8);
                    exchange.sendResponseHeaders(200, reply.length);
                    exchange.getResponseBody().write(reply);
                } else {
                    exchange.sendResponseHeaders(200, size);
                    try (var input = Files.newInputStream(file); var output = exchange.getResponseBody()) { input.transferTo(output); }
                }
            }
        }, 30);
        var result = orthanc.importDicomFile(file);
        assertThat(result.status()).isEqualTo("AlreadyStored");
        assertThat(result.id()).isEqualTo(ID);
        assertThat(received.get()).isEqualTo(size);
        assertThat(contentLength.get()).isEqualTo(Long.toString(size));
        assertThat(tail.get()).isEqualTo(7);
        assertThat(posts.get()).isEqualTo(1);
        assertThat(orthanc.matchesDicomFile(ID, file)).isTrue();
        assertThat(Files.exists(file)).isTrue();
    }

    @Test void duplicateRequiresIdenticalLengthAndDigest() throws Exception {
        Path source = Files.write(directory.resolve("incoming.dcm"), new byte[]{1,2,3});
        AtomicReference<byte[]> stored = new AtomicReference<>(new byte[]{1,2,4});
        var orthanc = serve(exchange -> {
            try (exchange) {
                byte[] contents = stored.get();
                exchange.sendResponseHeaders(200, contents.length);
                exchange.getResponseBody().write(contents);
            }
        }, 10);
        assertThat(orthanc.matchesDicomFile(ID, source)).isFalse();
        stored.set(new byte[]{1,2});
        assertThat(orthanc.matchesDicomFile(ID, source)).isFalse();
        stored.set(new byte[]{1,2,3,4});
        assertThat(orthanc.matchesDicomFile(ID, source)).isFalse();
        stored.set(new byte[]{1,2,3});
        assertThat(orthanc.matchesDicomFile(ID, source)).isTrue();
    }

    @Test void digestNeverConsumesMoreThanExpectedLengthPlusOneByte() throws Exception {
        AtomicLong consumed = new AtomicLong();
        var endless = new java.io.InputStream() {
            @Override public int read() { consumed.incrementAndGet(); return 0; }
            @Override public int read(byte[] buffer, int offset, int length) {
                java.util.Arrays.fill(buffer, offset, offset + length, (byte) 0);
                consumed.addAndGet(length);
                return length;
            }
        };
        assertThat(OrthancService.digest(endless, 3)).isNull();
        assertThat(consumed.get()).isEqualTo(4);
    }

    @Test void upstream413IsNotRetriedOrConvertedToSuccess() throws Exception {
        Path source = Files.write(directory.resolve("incoming.dcm"), new byte[]{1});
        AtomicInteger posts = new AtomicInteger();
        var orthanc = serve(exchange -> {
            try (exchange) {
                posts.incrementAndGet();
                exchange.getRequestBody().transferTo(java.io.OutputStream.nullOutputStream());
                exchange.sendResponseHeaders(413, -1);
            }
        }, 10);
        assertThatThrownBy(() -> orthanc.importDicomFile(source))
                .isInstanceOfSatisfying(ApiException.class, error -> assertThat(error.status()).isEqualTo(HttpStatus.PAYLOAD_TOO_LARGE));
        assertThat(posts.get()).isEqualTo(1);
        assertThat(Files.exists(source)).isTrue();
    }

    @Test void stalledDuplicateResponseBodyHasAnImportDeadlineAndIsClosed() throws Exception {
        Path source = Files.write(directory.resolve("incoming.dcm"), new byte[]{1,2,3});
        AtomicInteger gets = new AtomicInteger();
        var orthanc = serve(exchange -> {
            try (exchange) {
                gets.incrementAndGet();
                exchange.sendResponseHeaders(200, 3);
                exchange.getResponseBody().write(1);
                exchange.getResponseBody().flush();
                try { Thread.sleep(2500); }
                catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
            }
        }, 1);
        assertThatThrownBy(() -> orthanc.matchesDicomFile(ID, source))
                .isInstanceOfSatisfying(ApiException.class, error -> assertThat(error.status()).isEqualTo(HttpStatus.GATEWAY_TIMEOUT));
        assertThat(gets.get()).isEqualTo(1);
    }

    @Test void unknownPostTimeoutIsNotAutomaticallyReplayed() throws Exception {
        Path source = Files.write(directory.resolve("incoming.dcm"), new byte[]{1});
        AtomicInteger posts = new AtomicInteger();
        var orthanc = serve(exchange -> {
            try (exchange) {
                posts.incrementAndGet();
                exchange.getRequestBody().transferTo(java.io.OutputStream.nullOutputStream());
                try { Thread.sleep(2500); }
                catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
                exchange.sendResponseHeaders(503, -1);
            }
        }, 1);
        assertThatThrownBy(() -> orthanc.importDicomFile(source))
                .isInstanceOfSatisfying(ApiException.class, error -> assertThat(error.status()).isEqualTo(HttpStatus.GATEWAY_TIMEOUT));
        assertThat(posts.get()).isEqualTo(1);
        assertThat(Files.exists(source)).isTrue();
    }

    @Test void interruptedResponseAndOversizedImportJsonAreNotAccepted() throws Exception {
        Path source = Files.write(directory.resolve("incoming.dcm"), new byte[]{1,2,3});
        String longerId = "22222222-22222222-22222222-22222222-22222222";
        String truncatedPath = "/instances/" + ID + "/file";
        String differentLengthPath = "/instances/" + longerId + "/file";
        var requests = new java.util.concurrent.CopyOnWriteArrayList<String>();
        AtomicInteger gets = new AtomicInteger();
        AtomicInteger posts = new AtomicInteger();
        AtomicInteger commits = new AtomicInteger();
        var orthanc = serve(exchange -> {
            try (exchange) {
                String method = exchange.getRequestMethod();
                String path = exchange.getRequestURI().getPath();
                requests.add(method + " " + path);
                if ("GET".equals(method)) gets.incrementAndGet();
                if ("GET".equals(method) && truncatedPath.equals(path)) {
                    exchange.sendResponseHeaders(200, 3);
                    exchange.getResponseBody().write(1);
                } else if ("GET".equals(method) && differentLengthPath.equals(path)) {
                    exchange.sendResponseHeaders(200, 8);
                    exchange.getResponseBody().write(new byte[]{1,2,3,4,5,6,7,8});
                } else if ("POST".equals(method) && "/instances".equals(path)) {
                    posts.incrementAndGet();
                    exchange.getRequestBody().transferTo(java.io.OutputStream.nullOutputStream());
                    commits.incrementAndGet(); // Model a server-side commit before an invalid reply.
                    byte[] oversized = new byte[64 * 1024 + 1];
                    exchange.sendResponseHeaders(200, oversized.length);
                    exchange.getResponseBody().write(oversized);
                } else {
                    exchange.sendResponseHeaders(404, -1);
                }
            }
        }, 2);
        try {
            assertThatThrownBy(() -> orthanc.matchesDicomFile(ID, source))
                    .isInstanceOfSatisfying(ApiException.class, error -> assertThat(error.status()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE));
            // A declared size mismatch is rejected without downloading the other object.
            assertThat(orthanc.matchesDicomFile(longerId, source)).isFalse();
            assertThatThrownBy(() -> orthanc.importDicomFile(source))
                    .isInstanceOfSatisfying(ApiException.class, error -> assertThat(error.status()).isEqualTo(HttpStatus.BAD_GATEWAY));
            assertThat(requests).contains("GET " + truncatedPath, "GET " + differentLengthPath, "POST /instances")
                    .allMatch(request -> request.equals("GET " + truncatedPath)
                            || request.equals("GET " + differentLengthPath) || request.equals("POST /instances"));
            // A JDK may retry safe GETs on a connection broken by this fixture.
            // A mutation and its modeled side effect must still occur exactly once.
            assertThat(gets.get()).isGreaterThanOrEqualTo(2);
            assertThat(posts.get()).as("observed requests: %s", requests).isEqualTo(1);
            assertThat(commits.get()).as("observed requests: %s", requests).isEqualTo(1);
        } finally {
            System.out.println("Orthanc streaming fixture observed requests: " + requests
                    + "; GET=" + gets.get() + "; POST=" + posts.get() + "; commits=" + commits.get());
        }
    }
}
