package com.taskflow.backend.task.api;

import com.fasterxml.jackson.annotation.JsonProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import java.util.UUID;

/**
 * A task representation returned by the REST API.
 *
 * @param id server-generated task identifier
 * @param title normalized task title
 * @param description task description, always a string
 * @param version current optimistic concurrency version
 */
@Schema(name = "Task", description = "Task data with server-generated identity and concurrency version.")
public record TaskResponse(
        @JsonProperty("id") @Schema(example = "8be3fd4f-634e-41df-a2bb-c7482ecee8e4") UUID id,
        @JsonProperty("title") @Schema(example = "Plan the release") String title,
        @JsonProperty("description") @Schema(example = "Review the open issues.") String description,
        @JsonProperty("version") @Schema(example = "0", minimum = "0") int version) {
}
