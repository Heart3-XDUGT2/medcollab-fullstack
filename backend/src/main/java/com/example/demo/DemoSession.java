package com.example.demo;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;

final class DemoSession {
    record Identity(String issuer, String subject, String username) {
    }
    private DemoSession() {
    }

    static String currentUser(HttpServletRequest request) {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()
                || !(authentication.getPrincipal() instanceof OidcUser user)) {
            return null;
        }
        String username = user.getPreferredUsername();
        return username == null || username.isBlank() ? user.getSubject() : username;
    }

    static String requireUser(HttpServletRequest request) {
        String username = currentUser(request);
        if (username == null) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "请先登录");
        }
        return username;
    }

    static Identity requireIdentity(HttpServletRequest request) {
        requireUser(request);
        OidcUser user = (OidcUser) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
        if (user.getIssuer() == null || user.getSubject() == null || user.getSubject().isBlank()) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "登录身份缺少账户标识，请重新登录");
        }
        return new Identity(user.getIssuer().toString(), user.getSubject(), currentUser(request));
    }
}
