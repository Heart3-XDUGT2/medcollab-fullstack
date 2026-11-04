package com.example.demo;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Properties;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.HttpStatus;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.core.oidc.OidcIdToken;
import org.springframework.security.oauth2.core.oidc.user.DefaultOidcUser;
import org.springframework.util.unit.DataSize;
import org.springframework.web.multipart.MultipartFile;

class ImportStreamingTests {
    @TempDir Path directory;
    @AfterEach void clearIdentity() { SecurityContextHolder.clearContext(); }

    static MultipartFile file(byte[] contents, long reportedSize) throws IOException {
        MultipartFile file = mock(MultipartFile.class);
        when(file.getSize()).thenReturn(reportedSize);
        when(file.isEmpty()).thenReturn(reportedSize == 0);
        when(file.getInputStream()).thenAnswer(ignored -> new ByteArrayInputStream(contents));
        when(file.getBytes()).thenThrow(new AssertionError("HTTP import must not call getBytes"));
        when(file.getOriginalFilename()).thenReturn("../../not-a-server-path.dcm");
        return file;
    }

    static void signedIn() {
        var token = OidcIdToken.withTokenValue("test-fixture-only").subject("stream-test-user")
                .issuedAt(Instant.now()).expiresAt(Instant.now().plusSeconds(60))
                .claim("iss", "http://identity.example.test/realm").claim("preferred_username", "fixture-user").build();
        var user = new DefaultOidcUser(List.of(new SimpleGrantedAuthority("ROLE_USER")), token);
        SecurityContextHolder.getContext().setAuthentication(new TestingAuthenticationToken(user, null, "ROLE_USER"));
    }

    @Test void stagingUsesBoundedStreamsAndDeletesOnlyItsOwnFile() throws Exception {
        Path unrelated = Files.writeString(directory.resolve("keep.txt"), "not owned by the upload");
        MultipartFile file = file(new byte[]{1,2,3,4,5,6,7,8}, 8);
        Path temporary;
        try (StagedDicom staged = StagedDicom.copy(file, new ImportLimits(8), directory)) {
            temporary = staged.path();
            assertThat(temporary.getParent()).isEqualTo(directory);
            assertThat(temporary.getFileName().toString()).startsWith("medcollab-import-");
            assertThat(Files.readAllBytes(temporary)).containsExactly(1,2,3,4,5,6,7,8);
            verify(file, never()).getBytes();
        }
        assertThat(Files.exists(temporary)).isFalse();
        assertThat(Files.readString(unrelated)).isEqualTo("not owned by the upload");
    }

    @Test void actualStreamCannotExceedConfiguredLimitEvenWithIncorrectSizeMetadata() throws Exception {
        MultipartFile file = file(new byte[9], 1);
        assertThatThrownBy(() -> StagedDicom.copy(file, new ImportLimits(8), directory))
                .isInstanceOfSatisfying(ApiException.class, error -> assertThat(error.status()).isEqualTo(HttpStatus.PAYLOAD_TOO_LARGE));
        try (var paths = Files.list(directory)) { assertThat(paths.count()).isZero(); }
        verify(file, never()).getBytes();
    }

    @Test void incompleteOrUnreadableUploadsLeaveNoStagingFile() throws Exception {
        MultipartFile truncated = file(new byte[]{1}, 2);
        assertThatThrownBy(() -> StagedDicom.copy(truncated, new ImportLimits(8), directory))
                .isInstanceOfSatisfying(ApiException.class, error -> assertThat(error.status()).isEqualTo(HttpStatus.BAD_REQUEST));
        MultipartFile broken = file(new byte[]{1}, 1);
        when(broken.getInputStream()).thenThrow(new IOException("fixture read failure"));
        assertThatThrownBy(() -> StagedDicom.copy(broken, new ImportLimits(8), directory)).isInstanceOf(IOException.class);
        try (var paths = Files.list(directory)) { assertThat(paths.count()).isZero(); }
    }

    @Test void defaultOneGiBBoundaryNeedsNoOneGiBHeapAllocation() throws Exception {
        signedIn();
        OrthancService orthanc = mock(OrthancService.class);
        DatasetService datasets = mock(DatasetService.class);
        var controller = new ImagingController(orthanc, datasets, new ImportLimits(ImportLimits.DEFAULT_MAX_FILE_BYTES));
        MultipartFile accepted = file(new byte[]{1}, ImportLimits.DEFAULT_MAX_FILE_BYTES);
        var result = new OrthancService.ImportResult("Success", "fixture-id");
        when(datasets.importDicomFile(eq("target"), same(accepted), any())).thenReturn(result);
        assertThat(controller.importDicom(accepted, "target", new MockHttpServletRequest()).getBody()).isEqualTo(result);
        MultipartFile rejected = file(new byte[]{1}, ImportLimits.DEFAULT_MAX_FILE_BYTES + 1);
        assertThatThrownBy(() -> controller.importDicom(rejected, "target", new MockHttpServletRequest()))
                .isInstanceOfSatisfying(ApiException.class, error -> assertThat(error.status()).isEqualTo(HttpStatus.PAYLOAD_TOO_LARGE));
        verify(datasets, times(1)).importDicomFile(anyString(), any(), any());
        verify(accepted, never()).getBytes();
        verify(rejected, never()).getInputStream();
        verifyNoInteractions(orthanc);
    }

    @Test void missingIdentityCannotReadOrForwardMultipartData() throws Exception {
        DatasetService datasets = mock(DatasetService.class);
        var controller = new ImagingController(mock(OrthancService.class), datasets, new ImportLimits(8));
        MultipartFile file = file(new byte[]{1}, 1);
        assertThatThrownBy(() -> controller.importDicom(file, "target", new MockHttpServletRequest()))
                .isInstanceOfSatisfying(ApiException.class, error -> assertThat(error.status()).isEqualTo(HttpStatus.UNAUTHORIZED));
        verifyNoInteractions(datasets);
        verify(file, never()).getInputStream();
        verify(file, never()).getBytes();
    }

    @Test void multipartDefaultsAndContainerExceptionUseTheSameLimitPolicy() throws Exception {
        Properties properties = new Properties();
        try (var stream = getClass().getResourceAsStream("/application.properties")) { properties.load(stream); }
        MockEnvironment environment = new MockEnvironment();
        properties.forEach((name, value) -> environment.setProperty(name.toString(), value.toString()));
        long maximum = Long.parseLong(environment.resolveRequiredPlaceholders(properties.getProperty("app.import.max-file-bytes")));
        assertThat(maximum).isEqualTo(ImportLimits.DEFAULT_MAX_FILE_BYTES);
        assertThat(DataSize.parse(environment.resolveRequiredPlaceholders(properties.getProperty("spring.servlet.multipart.max-file-size"))).toBytes()).isEqualTo(maximum);
        assertThat(DataSize.parse(environment.resolveRequiredPlaceholders(properties.getProperty("spring.servlet.multipart.max-request-size"))).toBytes()).isEqualTo(maximum + 1024 * 1024);
        assertThat(DataSize.parse(properties.getProperty("spring.servlet.multipart.file-size-threshold")).toBytes()).isZero();
        var response = new ApiErrorHandler().tooLarge();
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.PAYLOAD_TOO_LARGE);
        assertThat(response.getHeaders().getCacheControl()).isEqualTo("no-store");
        assertThat(response.getBody().get("error")).contains("单文件或整请求").doesNotContain("64 MB");
    }

    @org.springframework.web.bind.annotation.RestController
    @org.springframework.context.annotation.Profile("multipart-size-handler-fixture")
    static class SizeFailureController {
        @org.springframework.web.bind.annotation.PostMapping("/size-failure")
        void upload() { throw new org.springframework.web.multipart.MaxUploadSizeExceededException(8); }
    }

    @Test void multipartResolverSizeFailureIsMappedToJson413() throws Exception {
        var mvc = org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup(new SizeFailureController())
                .setControllerAdvice(new ApiErrorHandler()).build();
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/size-failure"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isPayloadTooLarge())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.header().string("Cache-Control", "no-store"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.error").value(
                        "上传超过当前服务的单文件或整请求大小上限，请拆分后重试"));
    }
}
