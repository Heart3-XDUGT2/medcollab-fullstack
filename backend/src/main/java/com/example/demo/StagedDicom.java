package com.example.demo;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import org.springframework.http.HttpStatus;
import org.springframework.web.multipart.MultipartFile;

/** Owns only a server-created file; never moves or deletes a caller's file. */
final class StagedDicom implements AutoCloseable {
    private static final int BUFFER_BYTES = 64 * 1024;
    private final Path path;
    private StagedDicom(Path path) { this.path = path; }
    Path path() { return path; }

    static StagedDicom copy(MultipartFile source, ImportLimits limits) throws IOException {
        return copy(source, limits, null);
    }

    static StagedDicom copy(MultipartFile source, ImportLimits limits, Path directory) throws IOException {
        limits.validate(source);
        Path temporary = directory == null
                ? Files.createTempFile("medcollab-import-", ".dcm")
                : Files.createTempFile(directory, "medcollab-import-", ".dcm");
        try {
            long copied = 0;
            try (InputStream input = source.getInputStream(); OutputStream output = Files.newOutputStream(temporary)) {
                byte[] buffer = new byte[BUFFER_BYTES];
                int length;
                while ((length = input.read(buffer)) != -1) {
                    if (Thread.currentThread().isInterrupted()) throw new java.io.InterruptedIOException("Import interrupted");
                    if (length > limits.maxFileBytes() - copied) throw limits.tooLarge();
                    output.write(buffer, 0, length);
                    copied += length;
                }
            }
            if (copied == 0 || copied != source.getSize())
                throw new ApiException(HttpStatus.BAD_REQUEST, "上传文件不完整，请重新选择后核对");
            return new StagedDicom(temporary);
        } catch (IOException | RuntimeException failure) {
            try { Files.deleteIfExists(temporary); }
            catch (IOException cleanup) { failure.addSuppressed(cleanup); }
            throw failure;
        }
    }

    @Override public void close() throws IOException { Files.deleteIfExists(path); }
}
