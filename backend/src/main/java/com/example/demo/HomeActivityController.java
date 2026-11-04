package com.example.demo;

import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestController
@RequestMapping("/api/me")
public class HomeActivityController {
    public record OpenRequest(String eventId, String generation) { }
    private final HomeActivityService service;
    public HomeActivityController(HomeActivityService service) { this.service=service; }

    @GetMapping("/favorite-datasets")
    public ResponseEntity<?> favorites(@RequestParam(defaultValue="0") int page,@RequestParam(defaultValue="20") int size,HttpServletRequest r) {
        return ok(service.favorites(DemoSession.requireIdentity(r),page,size));
    }
    @GetMapping("/favorite-datasets/state")
    public ResponseEntity<?> states(@RequestParam List<String> datasetId,HttpServletRequest r) {
        return ok(service.favoriteStates(datasetId,DemoSession.requireIdentity(r)));
    }
    @PutMapping("/favorite-datasets/{id}")
    public ResponseEntity<?> favorite(@PathVariable String id,HttpServletRequest r) { return ok(service.favorite(id,DemoSession.requireIdentity(r))); }
    @DeleteMapping("/favorite-datasets/{id}")
    public ResponseEntity<?> unfavorite(@PathVariable String id,HttpServletRequest r) { return ok(service.unfavorite(id,DemoSession.requireIdentity(r))); }
    @GetMapping("/recent-datasets/context")
    public ResponseEntity<?> context(HttpServletRequest r) { return ok(service.recentContext(DemoSession.requireIdentity(r))); }
    @GetMapping("/recent-datasets")
    public ResponseEntity<?> recent(@RequestParam(defaultValue="0") int page,@RequestParam(defaultValue="20") int size,HttpServletRequest r) {
        return ok(service.recent(DemoSession.requireIdentity(r),page,size));
    }
    @PostMapping("/recent-datasets/{id}")
    public ResponseEntity<?> opened(@PathVariable String id,@RequestBody OpenRequest body,HttpServletRequest r) {
        return ok(service.opened(id,body.eventId(),body.generation(),DemoSession.requireIdentity(r)));
    }
    @DeleteMapping("/recent-datasets/{id}")
    public ResponseEntity<?> removeRecent(@PathVariable String id,HttpServletRequest r) { return ok(service.clearRecent(id,DemoSession.requireIdentity(r))); }
    @DeleteMapping("/recent-datasets")
    public ResponseEntity<?> clearRecent(HttpServletRequest r) { return ok(service.clearRecent(null,DemoSession.requireIdentity(r))); }
    @ExceptionHandler(HomeActivityService.Failure.class)
    public ResponseEntity<?> failure(HomeActivityService.Failure failure) {
        return ResponseEntity.status(failure.status).cacheControl(CacheControl.noStore()).body(Map.of("error",failure.getMessage(),"code",failure.code));
    }
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<?> badParameter() {
        return ResponseEntity.badRequest().cacheControl(CacheControl.noStore()).body(Map.of("error","分页参数必须为整数","code","INVALID_ACTIVITY_REQUEST"));
    }
    private static ResponseEntity<?> ok(Object value) { return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(value); }
}
