package com.example.demo;

import java.io.IOException;
import java.util.Map;

import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
public class ImagingController {
    private static final Logger log = LoggerFactory.getLogger(ImagingController.class);
    private final OrthancService orthanc;
    private final DatasetService datasets;
    private final ImportLimits importLimits;
    record NameRequest(String name) { }
    record ShareRequest(String subject) { }

    public ImagingController(OrthancService orthanc, DatasetService datasets, ImportLimits importLimits) {
        this.orthanc = orthanc;
        this.datasets = datasets;
        this.importLimits = importLimits;
    }

    @GetMapping("/api/orthanc/status")
    public ResponseEntity<OrthancService.Status> status(HttpServletRequest request) {
        var user = DemoSession.requireIdentity(request);
        var connection = orthanc.status();
        long count = datasets.visibleInstanceCount(user);
        log.info("连接检查成功：用户={}，可见影像数量={}", user.username(), count);
        return uncached(new OrthancService.Status(connection.connected(), connection.name(), connection.version(), count));
    }

    @GetMapping("/api/datasets")
    public ResponseEntity<OrthancService.Items<DatasetService.DatasetItem>> list(HttpServletRequest request) {
        return uncached(datasets.list(DemoSession.requireIdentity(request)));
    }

    @PostMapping("/api/datasets")
    public ResponseEntity<DatasetService.DatasetItem> create(@RequestBody NameRequest body, HttpServletRequest request) {
        var user = DemoSession.requireIdentity(request);
        var created = datasets.create(body.name(), user);
        log.info("创建私有影像集：用户={}，影像集={}", user.username(), created.id());
        return uncached(created);
    }

    @PatchMapping("/api/datasets/{id}")
    public ResponseEntity<DatasetService.DatasetItem> rename(@PathVariable String id, @RequestBody NameRequest body, HttpServletRequest request) {
        var user = DemoSession.requireIdentity(request);
        var changed = datasets.rename(id, body.name(), user);
        log.info("重命名影像集：用户={}，影像集={}", user.username(), id);
        return uncached(changed);
    }

    @GetMapping("/api/datasets/{id}/instances")
    public ResponseEntity<OrthancService.Items<OrthancService.InstanceItem>> instances(@PathVariable String id, HttpServletRequest request) {
        return uncached(datasets.instances(id, DemoSession.requireIdentity(request)));
    }

    @GetMapping("/api/datasets/{id}/instances/{instanceId}/preview")
    public ResponseEntity<byte[]> preview(@PathVariable String id, @PathVariable String instanceId, HttpServletRequest request) {
        var user = DemoSession.requireIdentity(request);
        datasets.requireInstance(id, instanceId, user);
        byte[] bytes = orthanc.preview(instanceId);
        log.info("读取 CT 预览成功：用户={}，影像集={}，影像={}", user.username(), id, instanceId);
        return ResponseEntity.ok().contentType(MediaType.IMAGE_PNG).cacheControl(CacheControl.noStore())
                .header("X-Content-Type-Options", "nosniff").body(bytes);
    }

    @GetMapping("/api/datasets/{id}/instances/{instanceId}/file")
    public ResponseEntity<byte[]> file(@PathVariable String id, @PathVariable String instanceId, HttpServletRequest request) {
        var user = DemoSession.requireIdentity(request);
        datasets.requireInstance(id, instanceId, user);
        return ResponseEntity.ok().contentType(MediaType.parseMediaType("application/dicom"))
                .cacheControl(CacheControl.noStore()).header("X-Content-Type-Options", "nosniff")
                .header("Content-Disposition", "attachment; filename=\"" + instanceId + ".dcm\"").body(orthanc.file(instanceId));
    }

    @PostMapping(value = "/api/import", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<OrthancService.ImportResult> importDicom(@RequestParam("file") MultipartFile file,
            @RequestParam(value = "datasetId", required = false) String datasetId, HttpServletRequest request) {
        var user = DemoSession.requireIdentity(request);
        importLimits.validate(file);
        if (datasetId == null || datasetId.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "请先创建或选择一个影像集再导入");
        var result = datasets.importDicomFile(datasetId, file, user);
        log.info("DICOM 导入完成：用户={}，影像集={}，结果={}，影像={}", user.username(), datasetId, result.status(), result.id());
        return uncached(result);
    }

    @GetMapping("/api/datasets/{id}/shares")
    public ResponseEntity<OrthancService.Items<DatasetService.ShareItem>> shares(@PathVariable String id, HttpServletRequest request) {
        return uncached(datasets.shares(id, DemoSession.requireIdentity(request)));
    }

    @PutMapping("/api/datasets/{id}/shares")
    public ResponseEntity<Map<String,Boolean>> share(@PathVariable String id, @RequestBody ShareRequest body, HttpServletRequest request) {
        var user = DemoSession.requireIdentity(request);
        datasets.share(id, body.subject(), user);
        log.info("共享影像集：用户={}，影像集={}，接收账户={}", user.username(), id, body.subject());
        return uncached(Map.of("success", true));
    }

    @DeleteMapping("/api/datasets/{id}/shares/{subject}")
    public ResponseEntity<Map<String,Boolean>> revoke(@PathVariable String id, @PathVariable String subject, HttpServletRequest request) {
        var user = DemoSession.requireIdentity(request);
        datasets.revoke(id, subject, user);
        log.info("撤销影像共享：用户={}，影像集={}，接收账户={}", user.username(), id, subject);
        return uncached(Map.of("success", true));
    }

    private static <T> ResponseEntity<T> uncached(T body) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body);
    }
}
