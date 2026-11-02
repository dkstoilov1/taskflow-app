package com.taskflow.backend.project.api;

import com.fasterxml.jackson.annotation.JsonProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import java.util.UUID;

/**
 * Project representation returned by the REST API.
 *
 * @param id server-generated project identifier
 * @param name normalized project name
 * @param version current optimistic concurrency version
 */
@Schema(name = "Project", description = "Project data with server-generated identity and concurrency version.")
public record ProjectResponse(
        @JsonProperty("id") @Schema(format = "uuid", example = "8be3fd4f-634e-41df-a2bb-c7482ecee8e4") UUID id,
        @JsonProperty("name") @Schema(example = "Release planning") String name,
        @JsonProperty("version") @Schema(minimum = "0", example = "0") int version) {
}
