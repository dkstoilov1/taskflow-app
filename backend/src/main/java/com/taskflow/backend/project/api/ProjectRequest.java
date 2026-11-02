package com.taskflow.backend.project.api;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.taskflow.backend.shared.text.UnicodeText;
import com.taskflow.backend.shared.validation.CodePointLength;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;

/**
 * Validated project fields accepted by create and replace operations.
 *
 * @param name required trimmed name with a maximum of 100 Unicode code points
 */
@Schema(name = "ProjectRequest", description = "Project name; identity and version are server-controlled.")
public record ProjectRequest(
        @JsonProperty("name")
        @Schema(description = "Trimmed nonblank name, 1–100 Unicode code points.", example = "Release planning")
        @NotNull(message = "must not be null")
        @NotEmpty(message = "must not be blank")
        @CodePointLength(max = 100)
        String name) {

    /**
     * Trims the submitted name using the TaskFlow whitespace rules.
     *
     * @param name unnormalized project name
     */
    public ProjectRequest {
        name = UnicodeText.trim(name);
    }
}
