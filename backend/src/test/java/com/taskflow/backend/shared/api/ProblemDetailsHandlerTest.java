package com.taskflow.backend.shared.api;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.Path;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.validation.BeanPropertyBindingResult;
import org.springframework.validation.BindingResult;
import org.springframework.validation.FieldError;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.HttpMediaTypeNotSupportedException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Unit tests for RFC 9457 error mapping and sanitization.
 */
class ProblemDetailsHandlerTest {
    private ProblemDetailsHandler handler;
    private MockHttpServletRequest request;

    @BeforeEach
    void setUp() {
        handler = new ProblemDetailsHandler();
        request = new MockHttpServletRequest("GET", "/api/tasks");
    }

    @Test
    void mapsApplicationAndBodyValidationErrors() {
        var applicationError = handler.handleApiException(ApiException.taskNotFound(), request);
        assertProblem(applicationError.getBody(), HttpStatus.NOT_FOUND, "Task not found");

        BindingResult bindingResult = new BeanPropertyBindingResult(new Object(), "request");
        bindingResult.addError(new FieldError("request", "title", "must not be blank"));
        bindingResult.addError(new FieldError("request", "description", null));
        MethodArgumentNotValidException validation = mock(MethodArgumentNotValidException.class);
        when(validation.getBindingResult()).thenReturn(bindingResult);

        var invalidBody = handler.handleBodyValidation(validation, request);
        assertProblem(invalidBody.getBody(), HttpStatus.BAD_REQUEST, "Invalid request");
        assertThat(invalidBody.getBody().getProperties()).containsKey("fieldErrors");
        assertThat(invalidBody.getBody().getProperties().get("fieldErrors").toString())
                .contains("title", "description", "is invalid");
    }

    @Test
    void mapsParameterAndUnreadableBodyErrors() {
        HandlerMethodValidationException parameterValidation = mock(HandlerMethodValidationException.class);
        when(parameterValidation.getParameterValidationResults()).thenReturn(List.of());
        var invalidParameter = handler.handleParameterValidation(parameterValidation, request);
        assertProblem(invalidParameter.getBody(), HttpStatus.BAD_REQUEST, "Invalid request");

        var invalidJson = handler.handleUnreadableBody(
                new org.springframework.http.converter.HttpMessageNotReadableException(
                        "internal parser details", mock(org.springframework.http.HttpInputMessage.class)),
                request);
        assertProblem(invalidJson.getBody(), HttpStatus.BAD_REQUEST, "Invalid request");
        assertThat(invalidJson.getBody().getDetail()).doesNotContain("internal parser details");
    }

    @Test
    void mapsConstraintViolationsToTheFinalPropertyName() {
        ConstraintViolation<?> violation = mock(ConstraintViolation.class);
        Path propertyPath = mock(Path.class);
        when(propertyPath.toString()).thenReturn("taskController.listTasks.size");
        when(violation.getPropertyPath()).thenReturn(propertyPath);
        when(violation.getMessage()).thenReturn("must be valid");

        var response = handler.handleConstraintViolation(
                new ConstraintViolationException("internal", Set.of(violation)), request);

        assertProblem(response.getBody(), HttpStatus.BAD_REQUEST, "Invalid request");
        assertThat(response.getBody().getProperties().get("fieldErrors").toString()).contains("size");
    }

    @Test
    void mapsMediaParameterAndConcurrencyErrors() {
        var media = handler.handleUnsupportedMedia(mock(HttpMediaTypeNotSupportedException.class), request);
        assertProblem(media.getBody(), HttpStatus.UNSUPPORTED_MEDIA_TYPE, "Unsupported media type");

        var missing = handler.handleMissingParameter(
                new MissingServletRequestParameterException("page", "int"), request);
        assertProblem(missing.getBody(), HttpStatus.BAD_REQUEST, "Invalid request");
        assertThat(missing.getBody().getProperties().get("fieldErrors").toString()).contains("page");

        var optimistic = handler.handleOptimisticLock(
                new org.springframework.dao.OptimisticLockingFailureException("provider details"), request);
        assertProblem(optimistic.getBody(), HttpStatus.PRECONDITION_FAILED, "Task changed");
    }

    @Test
    void mapsUnavailableUnknownAndUnexpectedFailuresWithoutLeaks() {
        var database = handler.handleDatabaseUnavailable(
                new DataAccessResourceFailureException("password=secret; sql=select"), request);
        assertProblem(database.getBody(), HttpStatus.SERVICE_UNAVAILABLE, "Service unavailable");
        assertThat(database.getBody().getDetail()).doesNotContain("secret", "select");

        var unknown = handler.handleUnknownPath(new Exception("internal path"), request);
        assertProblem(unknown.getBody(), HttpStatus.NOT_FOUND, "Not found");

        var unexpected = handler.handleUnexpected(new RuntimeException("sensitive exception"), request);
        assertProblem(unexpected.getBody(), HttpStatus.INTERNAL_SERVER_ERROR, "Internal server error");
        assertThat(unexpected.getBody().getDetail()).doesNotContain("sensitive exception");
    }

    @Test
    void responseUsesProblemMediaAndRequestInstance() {
        var response = handler.handleApiException(ApiException.missingPrecondition(), request);

        assertThat(response.getHeaders().getContentType()).isEqualTo(MediaType.APPLICATION_PROBLEM_JSON);
        assertThat(response.getBody().getInstance()).hasToString("/api/tasks");
        assertThat(response.getBody().getProperties()).isNull();
    }

    private void assertProblem(ProblemDetail problem, HttpStatus status, String title) {
        assertThat(problem.getStatus()).isEqualTo(status.value());
        assertThat(problem.getTitle()).isEqualTo(title);
        assertThat(problem.getType()).hasToString("about:blank");
    }
}
