package com.example.demo;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class DatasetLibraryController {
    private final DatasetLibraryService library;
    public DatasetLibraryController(DatasetLibraryService library) { this.library=library; }

    @GetMapping("/api/me/datasets")
    public ResponseEntity<DatasetLibraryService.Page> list(@RequestParam(defaultValue="all") String source,
            @RequestParam(required=false) String teamId, @RequestParam(required=false) String q,
            @RequestParam(defaultValue="0") int page, @RequestParam(defaultValue="20") int size,
            @RequestParam(defaultValue="created-desc") String sort, HttpServletRequest request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(library.list(DemoSession.requireIdentity(request),source,teamId,q,page,size,sort));
    }
}
