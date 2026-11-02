package com.taskflow.backend.shared.api;

import jakarta.persistence.OptimisticLockException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import java.net.URI;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.validation.FieldError;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/**
 * Converts application, validation, and infrastructure failures to sanitized Problem Details.
 */
@RestControllerAdvice
public class ProblemDetailsHandler {

    private static final Logger LOGGER = LoggerFactory.getLogger(ProblemDetailsHandler.class);

    /**
     * Builds the standard problem body for an API-specific failure.
     *
     * @param exception failure with a public status and detail
     * @param request current HTTP request
     * @return RFC 9457 response with any field errors
     */
    @ExceptionHandler(ApiException.class)
    public ResponseEntity<ProblemDetail> handleApiException(ApiException exception, HttpServletRequest request) {
        return response(
                exception.status(),
                exception.title(),
                exception.getMessage(),
                request,
                exception.fieldErrors());
    }

    /**
     * Maps bean validation failures to field-keyed message arrays.
     *
     * @param exception request DTO validation failure
     * @param request current HTTP request
     * @return a 400 Problem Details response
     */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ProblemDetail> handleBodyValidation(
            MethodArgumentNotValidException exception,
            HttpServletRequest request) {
        Map<String, List<String>> errors = new LinkedHashMap<>();
        for (FieldError fieldError : exception.getBindingResult().getFieldErrors()) {
            addError(errors, fieldError.getField(), fieldError.getDefaultMessage());
        }
        return response(HttpStatus.BAD_REQUEST, "Invalid request", "The request contains invalid values.", request, errors);
    }

    /**
     * Maps method-parameter constraints to field-keyed messages.
     *
     * @param exception path or query parameter validation failure
     * @param request current HTTP request
     * @return a 400 Problem Details response
     */
    @ExceptionHandler(HandlerMethodValidationException.class)
    public ResponseEntity<ProblemDetail> handleParameterValidation(
            HandlerMethodValidationException exception,
            HttpServletRequest request) {
        Map<String, List<String>> errors = new LinkedHashMap<>();
        exception.getParameterValidationResults().forEach(result -> {
            String field = result.getMethodParameter().getParameterName();
            result.getResolvableErrors().forEach(error ->
                    addError(errors, field == null ? "parameter" : field, error.getDefaultMessage()));
        });
        return response(HttpStatus.BAD_REQUEST, "Invalid request", "The request contains invalid values.", request, errors);
    }

    /**
     * Sanitizes malformed JSON and JSON field-type failures.
     *
     * @param exception unreadable request body
     * @param request current HTTP request
     * @return a 400 Problem Details response
     */
    @ExceptionHandler(org.springframework.http.converter.HttpMessageNotReadableException.class)
    public ResponseEntity<ProblemDetail> handleUnreadableBody(
            org.springframework.http.converter.HttpMessageNotReadableException exception,
            HttpServletRequest request) {
        return response(
                HttpStatus.BAD_REQUEST,
                "Invalid request",
                "The request body must be valid JSON with the documented field types.",
                request,
                Map.of());
    }

    /**
     * Maps malformed UUIDs, numeric query values, and other conversion errors to 400.
     *
     * @param exception failed request-value conversion
     * @param request current HTTP request
     * @return a 400 Problem Details response with the parameter name
     */
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ProblemDetail> handleTypeMismatch(
            MethodArgumentTypeMismatchException exception,
            HttpServletRequest request) {
        Map<String, List<String>> errors = Map.of(exception.getName(), List.of("must have a valid format"));
        return response(HttpStatus.BAD_REQUEST, "Invalid request", "A request value has an invalid format.", request, errors);
    }

    /**
     * Maps Bean Validation constraint failures to a safe 400 response.
     *
     * @param exception constraint violations raised during request handling
     * @param request current HTTP request
     * @return a 400 Problem Details response
     */
    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<ProblemDetail> handleConstraintViolation(
            ConstraintViolationException exception,
            HttpServletRequest request) {
        Map<String, List<String>> errors = new LinkedHashMap<>();
        exception.getConstraintViolations().forEach(violation ->
                addError(errors, lastPathSegment(violation.getPropertyPath().toString()), violation.getMessage()));
        return response(HttpStatus.BAD_REQUEST, "Invalid request", "The request contains invalid values.", request, errors);
    }

    /**
     * Maps unsupported request media types to a documented client error.
     *
     * @param exception unsupported content type
     * @param request current HTTP request
     * @return a 415 Problem Details response
     */
    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    public ResponseEntity<ProblemDetail> handleUnsupportedMedia(
            HttpMediaTypeNotSupportedException exception,
            HttpServletRequest request) {
        return response(
                HttpStatus.UNSUPPORTED_MEDIA_TYPE,
                "Unsupported media type",
                "Send the request body as application/json.",
                request,
                Map.of());
    }

    /**
     * Maps a missing required HTTP query parameter to a client error.
     *
     * @param exception missing parameter metadata
     * @param request current HTTP request
     * @return a 400 Problem Details response
     */
    @ExceptionHandler(MissingServletRequestParameterException.class)
    public ResponseEntity<ProblemDetail> handleMissingParameter(
            MissingServletRequestParameterException exception,
            HttpServletRequest request) {
        Map<String, List<String>> errors = Map.of(exception.getParameterName(), List.of("is required"));
        return response(HttpStatus.BAD_REQUEST, "Invalid request", "A required request parameter is missing.", request, errors);
    }

    /**
     * Maps stale persistence versions to HTTP 412 without leaking provider details.
     *
     * @param exception optimistic locking failure
     * @param request current HTTP request
     * @return a 412 Problem Details response
     */
    @ExceptionHandler({OptimisticLockingFailureException.class, OptimisticLockException.class})
    public ResponseEntity<ProblemDetail> handleOptimisticLock(
            RuntimeException exception,
            HttpServletRequest request) {
        return response(
                HttpStatus.PRECONDITION_FAILED,
                "Task changed",
                "The task changed since it was loaded. Reload it before trying again.",
                request,
                Map.of());
    }

    /**
     * Maps database connectivity or persistence availability failures to a sanitized 503.
     *
     * @param exception database or transaction infrastructure failure
     * @param request current HTTP request
     * @return a 503 Problem Details response
     */
    @ExceptionHandler({DataAccessException.class, CannotCreateTransactionException.class})
    public ResponseEntity<ProblemDetail> handleDatabaseUnavailable(
            RuntimeException exception,
            HttpServletRequest request) {
        LOGGER.error("Database request failed; returning sanitized service-unavailable response (type={}).",
                exception.getClass().getName());
        return response(
                HttpStatus.SERVICE_UNAVAILABLE,
                "Service unavailable",
                "Task storage is temporarily unavailable. Try again later.",
                request,
                Map.of());
    }

    /**
     * Maps unsupported methods to an RFC 9457 response.
     *
     * @param exception unsupported method metadata
     * @param request current HTTP request
     * @return a 405 Problem Details response
     */
    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<ProblemDetail> handleMethodNotAllowed(
            HttpRequestMethodNotSupportedException exception,
            HttpServletRequest request) {
        return response(
                HttpStatus.METHOD_NOT_ALLOWED,
                "Method not allowed",
                "The HTTP method is not supported for this resource.",
                request,
                Map.of());
    }

    /**
     * Maps unknown resource paths to a safe 404 response.
     *
     * @param exception missing resource metadata
     * @param request current HTTP request
     * @return a 404 Problem Details response
     */
    @ExceptionHandler({NoResourceFoundException.class, NoHandlerFoundException.class})
    public ResponseEntity<ProblemDetail> handleUnknownPath(Exception exception, HttpServletRequest request) {
        return response(HttpStatus.NOT_FOUND, "Not found", "The requested resource was not found.", request, Map.of());
    }

    /**
     * Logs an unexpected server failure and returns no internal details to the client.
     *
     * @param exception unexpected failure
     * @param request current HTTP request
     * @return a sanitized 500 Problem Details response
     */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ProblemDetail> handleUnexpected(Exception exception, HttpServletRequest request) {
        LOGGER.error("Unexpected request failure; returning sanitized internal-server-error response (type={}).",
                exception.getClass().getName());
        return response(
                HttpStatus.INTERNAL_SERVER_ERROR,
                "Internal server error",
                "An unexpected error occurred. Please try again.",
                request,
                Map.of());
    }

    private ResponseEntity<ProblemDetail> response(
            HttpStatusCode status,
            String title,
            String detail,
            HttpServletRequest request,
            Map<String, List<String>> fieldErrors) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, detail);
        problem.setType(URI.create("about:blank"));
        problem.setTitle(title);
        problem.setInstance(URI.create(request.getRequestURI()));
        if (!fieldErrors.isEmpty()) {
            problem.setProperty("fieldErrors", fieldErrors);
        }
        return ResponseEntity.status(status)
                .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .body(problem);
    }

    private static void addError(Map<String, List<String>> errors, String field, String message) {
        List<String> messages = errors.computeIfAbsent(field, ignored -> new ArrayList<>());
        messages.add(message == null ? "is invalid" : message);
    }

    private static String lastPathSegment(String path) {
        int separator = path.lastIndexOf('.');
        return separator < 0 ? path : path.substring(separator + 1);
    }
}
