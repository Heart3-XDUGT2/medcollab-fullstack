package com.example.demo;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
public class AnnotationStatisticsController {
    private final AnnotationStatisticsService service;
    public AnnotationStatisticsController(AnnotationStatisticsService service) {this.service=service;}

    @GetMapping("/api/me/annotation-stats")
    public ResponseEntity<AnnotationStatisticsService.PersonalStats> personal(HttpServletRequest request) {
        return noStore(service.personal(DemoSession.requireIdentity(request)));
    }
    @GetMapping("/api/datasets/{datasetId}/annotation-stats")
    public ResponseEntity<AnnotationStatisticsService.DatasetStats> dataset(@PathVariable String datasetId,HttpServletRequest request) {
        return noStore(service.dataset(datasetId,DemoSession.requireIdentity(request)));
    }
    @GetMapping("/api/datasets/{datasetId}/segmentations/{seriesId}/stats")
    public ResponseEntity<AnnotationStatisticsService.SeriesStats> series(@PathVariable String datasetId,@PathVariable String seriesId,HttpServletRequest request) {
        return noStore(service.series(datasetId,seriesId,DemoSession.requireIdentity(request)));
    }
    private static <T> ResponseEntity<T> noStore(T body) {return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body);}
}
