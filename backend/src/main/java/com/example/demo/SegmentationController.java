package com.example.demo;

import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class SegmentationController {
    private static final Logger log = LoggerFactory.getLogger(SegmentationController.class);
    private final SegmentationService segmentations;
    public SegmentationController(SegmentationService segmentations) { this.segmentations = segmentations; }

    @GetMapping("/api/datasets/{datasetId}/segmentation/sources")
    public ResponseEntity<OrthancService.Items<DicomSegCodec.SourceImage>> sources(
            @PathVariable String datasetId, HttpServletRequest request) {
        return uncached(segmentations.sources(datasetId,DemoSession.requireIdentity(request)));
    }

    @GetMapping("/api/datasets/{datasetId}/segmentations/{seriesId}")
    public ResponseEntity<SegmentationService.Workspace> workspace(@PathVariable String datasetId,
            @PathVariable String seriesId,HttpServletRequest request) {
        return uncached(segmentations.workspace(datasetId,seriesId,DemoSession.requireIdentity(request)));
    }

    @GetMapping("/api/datasets/{datasetId}/segmentations/{seriesId}/status")
    public ResponseEntity<SegmentationService.Status> status(@PathVariable String datasetId,
            @PathVariable String seriesId,HttpServletRequest request) {
        return uncached(segmentations.status(datasetId,seriesId,DemoSession.requireIdentity(request)));
    }

    @PutMapping("/api/datasets/{datasetId}/segmentations/{seriesId}/draft")
    public void retiredDraft(@PathVariable String datasetId, HttpServletRequest request) {
        segmentations.rejectServerDraft(datasetId,DemoSession.requireIdentity(request));
    }

    @GetMapping("/api/datasets/{datasetId}/segmentations/{seriesId}/legacy-draft")
    public ResponseEntity<SegmentationService.LegacyDraft> legacy(@PathVariable String datasetId,
            @PathVariable String seriesId,HttpServletRequest request) {
        return uncached(segmentations.legacyDraft(datasetId,seriesId,DemoSession.requireIdentity(request)));
    }

    @DeleteMapping("/api/datasets/{datasetId}/segmentations/{seriesId}/legacy-draft")
    public ResponseEntity<Void> migrated(@PathVariable String datasetId, @PathVariable String seriesId,
            @RequestParam long revision,HttpServletRequest request) {
        segmentations.acknowledgeLegacyDraft(datasetId,seriesId,revision,DemoSession.requireIdentity(request));
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    @PostMapping("/api/datasets/{datasetId}/segmentations/{seriesId}/publish")
    public ResponseEntity<SegmentationService.Workspace> publish(@PathVariable String datasetId,
            @PathVariable String seriesId,@RequestBody SegmentationService.PublishRequest body,HttpServletRequest request) {
        var user = DemoSession.requireIdentity(request);
        var published = segmentations.publish(datasetId,seriesId,body,user);
        log.info("DICOM SEG 已上传并同步：用户={}，影像集={}，序列={}，共享版本={}，Orthanc={}",
                user.username(),datasetId,seriesId,published.publishedVersion(),published.orthancId());
        return uncached(published);
    }

    @GetMapping("/api/datasets/{datasetId}/segmentations/{seriesId}/file")
    public ResponseEntity<byte[]> file(@PathVariable String datasetId,@PathVariable String seriesId,HttpServletRequest request) {
        return ResponseEntity.ok().contentType(MediaType.parseMediaType("application/dicom"))
                .cacheControl(CacheControl.noStore()).header("X-Content-Type-Options","nosniff")
                .header("Content-Disposition","attachment; filename=\"segmentation.dcm\"")
                .body(segmentations.file(datasetId,seriesId,DemoSession.requireIdentity(request)));
    }

    @GetMapping("/api/datasets/{datasetId}/segmentations/{seriesId}/labelmap")
    public ResponseEntity<SegmentationService.LabelmapWorkspace> labelmap(@PathVariable String datasetId,@PathVariable String seriesId,HttpServletRequest request) {
        return uncached(segmentations.labelmap(datasetId,seriesId,DemoSession.requireIdentity(request)));
    }

    @PostMapping("/api/datasets/{datasetId}/segmentations/{seriesId}/publish-labelmap")
    public ResponseEntity<SegmentationService.Status> publishLabelmap(@PathVariable String datasetId,@PathVariable String seriesId,
            @RequestBody SegmentationService.LabelmapRequest body,HttpServletRequest request) {
        var user=consistentIdentity(request);
        var result=segmentations.publishLabelmap(datasetId,seriesId,body,user);
        log.info("Labelmap SEG 已发布：用户={}，影像集={}，序列={}，版本={}，Orthanc={}",user.username(),datasetId,seriesId,result.publishedVersion(),result.orthancId());
        return uncached(result);
    }

    @PostMapping("/api/datasets/{datasetId}/segmentations/{seriesId}/export-labelmap")
    public ResponseEntity<byte[]> exportLabelmap(@PathVariable String datasetId,@PathVariable String seriesId,
            @RequestBody SegmentationService.LabelmapRequest body,HttpServletRequest request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(MediaType.parseMediaType("application/dicom"))
                .header("Content-Disposition","attachment; filename=\"labelmap-seg.dcm\"")
                .body(segmentations.exportLabelmap(datasetId,seriesId,body,consistentIdentity(request)));
    }

    private static DemoSession.Identity consistentIdentity(HttpServletRequest request) {
        var user=DemoSession.requireIdentity(request);
        String issuer=request.getHeader("X-Medcollab-Issuer"),subject=request.getHeader("X-Medcollab-Subject");
        if((issuer!=null||subject!=null)&&(!user.issuer().equals(issuer)||!user.subject().equals(subject)))
            throw new ApiException(org.springframework.http.HttpStatus.CONFLICT,"账户已切换，请重新打开工作台；未发布原账户的草稿");
        return user;
    }

    private static <T> ResponseEntity<T> uncached(T value) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(value);
    }
}
