package com.taskflow.backend.shared.web;

import com.taskflow.backend.shared.api.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.Arrays;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * Rejects nonlocal HTTP hosts and unexpected browser origins on mutations.
 */
@Component
public final class OriginProtectionInterceptor implements HandlerInterceptor {

    private final Set<String> allowedOrigins;

    /**
     * Creates the origin guard from explicit local UI origins.
     *
     * @param configuredOrigins comma-separated allowed origins, without paths or credentials
     */
    public OriginProtectionInterceptor(@Value("${taskflow.allowed-origins}") String configuredOrigins) {
        allowedOrigins = Arrays.stream(configuredOrigins.split(","))
                .map(String::trim)
                .filter(value -> !value.isEmpty())
                .map(OriginProtectionInterceptor::normalizeOrigin)
                .collect(Collectors.toUnmodifiableSet());
    }

    /**
     * Allows local-host requests without browser origins and rejects nonlocal hosts or untrusted mutation origins.
     *
     * @param request current HTTP request
     * @param response current HTTP response
     * @param handler selected MVC handler
     * @return true when request processing may continue
     */
    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if (!isLocalHost(request.getServerName())) {
            throw ApiException.forbiddenOrigin();
        }
        if (!isStateChanging(request.getMethod())) {
            return true;
        }
        String origin = request.getHeader("Origin");
        if (origin == null) {
            return true;
        }
        String normalizedOrigin = normalizeOriginOrReject(origin);
        if (allowedOrigins.contains(normalizedOrigin) || sameAsRequestOrigin(normalizedOrigin, request)) {
            return true;
        }
        throw ApiException.forbiddenOrigin();
    }

    private static boolean isStateChanging(String method) {
        return "POST".equalsIgnoreCase(method)
                || "PUT".equalsIgnoreCase(method)
                || "PATCH".equalsIgnoreCase(method)
                || "DELETE".equalsIgnoreCase(method);
    }

    private static boolean sameAsRequestOrigin(String origin, HttpServletRequest request) {
        String requestHost = request.getServerName();
        if (requestHost.contains(":") && !requestHost.startsWith("[")) {
            requestHost = "[" + requestHost + "]";
        }
        String requestOrigin = request.getScheme() + "://" + requestHost + ":" + request.getServerPort();
        return origin.equals(normalizeOrigin(requestOrigin));
    }

    private static boolean isLocalHost(String host) {
        if (host == null) {
            return false;
        }
        String normalizedHost = host.toLowerCase(Locale.ROOT);
        if (normalizedHost.startsWith("[") && normalizedHost.endsWith("]")) {
            normalizedHost = normalizedHost.substring(1, normalizedHost.length() - 1);
        }
        return "localhost".equals(normalizedHost)
                || "127.0.0.1".equals(normalizedHost)
                || "::1".equals(normalizedHost);
    }

    private static String normalizeOriginOrReject(String origin) {
        try {
            return normalizeOrigin(origin);
        } catch (IllegalArgumentException exception) {
            throw ApiException.forbiddenOrigin();
        }
    }

    private static String normalizeOrigin(String origin) {
        try {
            URI uri = new URI(origin);
            String scheme = uri.getScheme();
            String host = uri.getHost();
            if (scheme == null || host == null || uri.getRawUserInfo() != null
                    || (uri.getRawPath() != null && !uri.getRawPath().isEmpty() && !"/".equals(uri.getRawPath()))
                    || uri.getRawQuery() != null || uri.getRawFragment() != null
                    || (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme))) {
                throw new IllegalArgumentException("Origin must contain only scheme, host, and optional port.");
            }
            int port = uri.getPort();
            if (port == -1) {
                port = "https".equalsIgnoreCase(scheme) ? 443 : 80;
            }
            String normalizedHost = host.toLowerCase(Locale.ROOT);
            if (normalizedHost.contains(":") && !normalizedHost.startsWith("[")) {
                normalizedHost = "[" + normalizedHost + "]";
            }
            return scheme.toLowerCase(Locale.ROOT) + "://" + normalizedHost + ":" + port;
        } catch (URISyntaxException exception) {
            throw new IllegalArgumentException("Origin is malformed.", exception);
        }
    }
}
