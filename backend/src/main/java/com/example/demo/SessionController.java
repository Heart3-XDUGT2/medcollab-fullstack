package com.example.demo;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class SessionController {
    record SessionResponse(boolean loggedIn, String username, String csrfToken, String csrfHeaderName,
                           String issuer, String subject) {
    }

    @GetMapping("/api/session")
    public ResponseEntity<SessionResponse> session(HttpServletRequest request, CsrfToken csrfToken) {
        String username = DemoSession.currentUser(request);
        String issuer = null;
        String subject = null;
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (username != null && authentication != null && authentication.getPrincipal() instanceof OidcUser user) {
            issuer = user.getIssuer() == null ? null : user.getIssuer().toString();
            subject = user.getSubject();
        }
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(new SessionResponse(username != null, username, csrfToken.getToken(), csrfToken.getHeaderName(), issuer, subject));
    }
}
