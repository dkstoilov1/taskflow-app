package com.taskflow.backend.task.api;

import com.fasterxml.jackson.annotation.JsonProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/**
 * A task representation returned by the REST API.
 *
 * @param id server-generated task identifier
 * @param title normalized task title
 * @param description task description, always a string
 * @param version current optimistic concurrency version
 * @param dueDate optional calendar deadline
 * @param priority task priority
 * @param projectId optional assigned project
 * @param status task status
 * @param completedAt server-controlled completion timestamp
 */
@Schema(name = "Task", description = "Task data with server-generated identity and concurrency version.")
public record TaskResponse(
        @JsonProperty("id") @Schema(example = "8be3fd4f-634e-41df-a2bb-c7482ecee8e4") UUID id,
        @JsonProperty("title") @Schema(example = "Plan the release") String title,
        @JsonProperty("description") @Schema(example = "Review the open issues.") String description,
        @JsonProperty("version") @Schema(example = "0", minimum = "0") int version,
        @JsonProperty("dueDate") @Schema(nullable = true, example = "2026-11-02", format = "date") LocalDate dueDate,
        @JsonProperty("priority") @Schema(allowableValues = {"low", "medium", "high"}, example = "medium") String priority,
        @JsonProperty("projectId") @Schema(nullable = true, format = "uuid") UUID projectId,
        @JsonProperty("status") @Schema(allowableValues = {"active", "completed"}, example = "active") String status,
        @JsonProperty("completedAt") @Schema(nullable = true, format = "date-time") Instant completedAt) {

    /**
     * Creates a legacy representation with scheduling fields at their initial defaults.
     *
     * @param id server-generated task identifier
     * @param title normalized task title
     * @param description task description
     * @param version current optimistic concurrency version
     */
    public TaskResponse(UUID id, String title, String description, int version) {
        this(id, title, description, version, null, "medium", null, "active", null);
    }
}
