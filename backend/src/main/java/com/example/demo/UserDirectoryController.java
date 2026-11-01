package com.example.demo;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class UserDirectoryController {
    private final KeycloakDirectoryService directory;
    public UserDirectoryController(KeycloakDirectoryService directory) { this.directory = directory; }

    @GetMapping("/api/users")
    public ResponseEntity<OrthancService.Items<KeycloakDirectoryService.DirectoryUser>> users(
            @RequestParam(defaultValue = "") String q, HttpServletRequest request) {
        DemoSession.requireUser(request);
        var users = directory.search(q);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(new OrthancService.Items<>(users, users.size()));
    }
}
