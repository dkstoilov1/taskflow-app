package com.taskflow.backend.task.api;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.taskflow.backend.shared.text.UnicodeText;
import com.taskflow.backend.shared.validation.CodePointLength;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;

/**
 * The editable task fields accepted by create and replace operations.
 *
 * @param title required title trimmed using the TaskFlow client whitespace rules
 * @param description optional description normalized to an empty string when null
 */
@Schema(name = "TaskRequest", description = "Editable task fields; ID and version are server-controlled.")
public record TaskRequest(
        @JsonProperty("title")
        @Schema(description = "Trimmed title, at most 200 Unicode code points.", example = "Plan the release")
        @NotNull(message = "must not be null")
        @NotEmpty(message = "must not be blank")
        @CodePointLength(max = 200)
        String title,
        @JsonProperty("description")
        @Schema(description = "Optional description; whitespace is preserved.", example = "Review the open issues.")
        @CodePointLength(max = 10_000)
        String description) {

    /**
     * Normalizes title whitespace and converts a missing or null description to empty text.
     *
     * @param title required title before normalization
     * @param description optional description before normalization
     */
    public TaskRequest {
        title = UnicodeText.trim(title);
        description = description == null ? "" : description;
    }
}
