package com.taskflow.backend.shared.web;

import com.taskflow.backend.shared.api.ApiException;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Tests the local-only browser-origin guard.
 */
class OriginProtectionInterceptorTest {
    private OriginProtectionInterceptor interceptor;

    @BeforeEach
    void setUp() {
        interceptor = new OriginProtectionInterceptor("http://localhost:5173, http://127.0.0.1:5173");
    }

    @Test
    void permitsReadRequestsAndMutationsWithoutBrowserOrigin() throws Exception {
        assertAllowed(request("GET", null));
        assertAllowed(request("POST", null));
    }

    @Test
    void permitsConfiguredAndSameRequestOrigins() throws Exception {
        assertAllowed(request("PUT", "http://localhost:5173"));
        assertAllowed(request("DELETE", "http://localhost:8080"));
        MockHttpServletRequest ipv6Request = new MockHttpServletRequest("POST", "/api/tasks");
        ipv6Request.setScheme("http");
        ipv6Request.setServerName("::1");
        ipv6Request.setServerPort(8080);
        ipv6Request.addHeader("Origin", "http://[::1]:8080");
        assertAllowed(ipv6Request);
    }

    @Test
    void rejectsUntrustedAndMalformedMutationOrigins() {
        assertForbidden(request("POST", "https://attacker.example"));
        assertForbidden(request("DELETE", "http://localhost:5173/path"));
        assertForbidden(request("PUT", "http://localhost:5173?debug=true"));
    }

    @Test
    void rejectsSpoofedHostEvenWhenOriginMatchesAndRejectsRemoteHostOnReads() {
        MockHttpServletRequest spoofedHost = request("POST", "http://evil.example:8080");
        spoofedHost.setServerName("evil.example");
        assertForbidden(spoofedHost);

        MockHttpServletRequest remoteReadHost = request("GET", null);
        remoteReadHost.setServerName("evil.example");
        assertForbidden(remoteReadHost);
    }

    private MockHttpServletRequest request(String method, String origin) {
        MockHttpServletRequest request = new MockHttpServletRequest(method, "/api/tasks");
        request.setScheme("http");
        request.setServerName("localhost");
        request.setServerPort(8080);
        if (origin != null) {
            request.addHeader("Origin", origin);
        }
        return request;
    }

    private void assertAllowed(MockHttpServletRequest request) throws Exception {
        HttpServletResponse response = new MockHttpServletResponse();
        assertThat(interceptor.preHandle(request, response, new Object())).isTrue();
    }

    private void assertForbidden(MockHttpServletRequest request) {
        assertThatThrownBy(() -> interceptor.preHandle(request, new MockHttpServletResponse(), new Object()))
                .isInstanceOf(ApiException.class)
                .extracting("status").isEqualTo(HttpStatus.FORBIDDEN);
    }
}
