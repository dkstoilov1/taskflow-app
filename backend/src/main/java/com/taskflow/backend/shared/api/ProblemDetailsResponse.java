package com.taskflow.backend.shared.api;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;
import java.util.Map;

/**
 * OpenAPI representation of RFC 9457 errors with optional validation details.
 *
 * @param type URI identifying the problem type
 * @param title short public-facing problem title
 * @param status HTTP status code
 * @param detail safe public-facing explanation
 * @param instance request path where the problem occurred
 * @param fieldErrors optional field-to-message-array validation map
 */
@Schema(name = "ProblemDetails", description = "Sanitized RFC 9457 error response with optional field validation messages.")
public record ProblemDetailsResponse(
        @Schema(example = "about:blank") String type,
        @Schema(example = "Invalid request") String title,
        @Schema(minimum = "400", maximum = "599", example = "400") int status,
        @Schema(example = "The request contains invalid values.") String detail,
        @Schema(example = "/api/tasks") String instance,
        @Schema(nullable = true, description = "Optional validation errors, keyed by field name.")
        Map<String, List<String>> fieldErrors) {
}
