package com.taskflow.backend.task.api;

import com.fasterxml.jackson.annotation.JsonProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

/**
 * Request body for changing only a task's status.
 *
 * @param status required status value, either active or completed
 */
@Schema(name = "TaskStatusRequest", description = "A status-only update; other task fields are unchanged.")
public record TaskStatusRequest(
        @JsonProperty("status")
        @Schema(allowableValues = {"active", "completed"}, example = "completed")
        @NotNull(message = "must not be null")
        @Pattern(regexp = "active|completed", message = "must be active or completed")
        String status) {
}
