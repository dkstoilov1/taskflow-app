package com.taskflow.backend.shared.api;

import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;

/**
 * Sanitized application exception with an explicit HTTP problem response.
 */
public final class ApiException extends RuntimeException {

    private final HttpStatus status;
    private final String title;
    private final Map<String, List<String>> fieldErrors;

    /**
     * Creates an API exception that can be serialized as RFC 9457 Problem Details.
     *
     * @param status HTTP status for the response
     * @param title short public-facing problem title
     * @param detail safe public-facing problem detail
     * @param fieldErrors optional field-to-messages map
     */
    public ApiException(
            HttpStatus status,
            String title,
            String detail,
            Map<String, List<String>> fieldErrors) {
        super(detail);
        this.status = status;
        this.title = title;
        this.fieldErrors = fieldErrors == null ? Map.of() : Map.copyOf(fieldErrors);
    }

    /**
     * Creates a sanitized not-found problem for an absent task.
     *
     * @return an HTTP 404 API exception
     */
    public static ApiException taskNotFound() {
        return new ApiException(HttpStatus.NOT_FOUND, "Task not found", "The requested task was not found.", Map.of());
    }

    /**
     * Creates a sanitized not-found problem for an absent project.
     *
     * @return an HTTP 404 API exception
     */
    public static ApiException projectNotFound() {
        return new ApiException(HttpStatus.NOT_FOUND, "Project not found", "The requested project was not found.", Map.of());
    }

    /**
     * Creates a field-specific invalid-project reference problem.
     *
     * @return an HTTP 400 API exception
     */
    public static ApiException invalidProjectReference() {
        return new ApiException(
                HttpStatus.BAD_REQUEST,
                "Invalid request",
                "The task references a project that does not exist.",
                Map.of("projectId", List.of("must identify an existing project")));
    }

    /**
     * Creates a case-insensitive duplicate project name conflict.
     *
     * @return an HTTP 409 API exception
     */
    public static ApiException duplicateProjectName() {
        return new ApiException(
                HttpStatus.CONFLICT,
                "Project name already exists",
                "Choose a project name that is not already in use.",
                Map.of("name", List.of("must be unique ignoring case")));
    }

    /**
     * Creates the malformed or noncanonical project identifier problem.
     *
     * @return an HTTP 400 API exception
     */
    public static ApiException invalidProjectId() {
        return new ApiException(
                HttpStatus.BAD_REQUEST,
                "Invalid request",
                "Project ID must use the canonical 8-4-4-4-12 UUID format.",
                Map.of("id", List.of("must be a canonical UUID")));
    }

    /**
     * Creates the required-precondition problem for a missing If-Match header.
     *
     * @return an HTTP 428 API exception
     */
    public static ApiException missingPrecondition() {
        return new ApiException(
                HttpStatus.PRECONDITION_REQUIRED,
                "Precondition required",
                "Send the latest resource ETag in the If-Match header.",
                Map.of());
    }

    /**
     * Creates the stale-version problem used by atomic task mutations.
     *
     * @return an HTTP 412 API exception
     */
    public static ApiException staleTaskVersion() {
        return new ApiException(
                HttpStatus.PRECONDITION_FAILED,
                "Resource changed",
                "The resource changed since it was loaded. Reload it before trying again.",
                Map.of());
    }

    /**
     * Creates the malformed If-Match problem.
     *
     * @return an HTTP 400 API exception
     */
    public static ApiException invalidIfMatch() {
        return new ApiException(
                HttpStatus.BAD_REQUEST,
                "Invalid request",
                "If-Match must contain a quoted decimal task version.",
                Map.of("If-Match", List.of("must contain a quoted decimal task version")));
    }

    /**
     * Creates the local-origin rejection problem.
     *
     * @return an HTTP 403 API exception
     */
    public static ApiException forbiddenOrigin() {
        return new ApiException(
                HttpStatus.FORBIDDEN,
                "Local request required",
                "This request used a nonlocal host or an untrusted browser origin.",
                Map.of());
    }

    /**
     * Creates the malformed or noncanonical task identifier problem.
     *
     * @return an HTTP 400 API exception
     */
    public static ApiException invalidTaskId() {
        return new ApiException(
                HttpStatus.BAD_REQUEST,
                "Invalid request",
                "Task ID must use the canonical 8-4-4-4-12 UUID format.",
                Map.of("id", List.of("must be a canonical UUID")));
    }

    /**
     * Returns the HTTP status used for the API problem.
     *
     * @return the response status
     */
    public HttpStatus status() {
        return status;
    }

    /**
     * Returns the safe problem title.
     *
     * @return the public title
     */
    public String title() {
        return title;
    }

    /**
     * Returns optional validation errors keyed by field name.
     *
     * @return immutable field errors, or an empty map
     */
    public Map<String, List<String>> fieldErrors() {
        return fieldErrors;
    }
}
