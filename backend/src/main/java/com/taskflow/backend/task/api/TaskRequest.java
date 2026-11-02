package com.taskflow.backend.task.api;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.taskflow.backend.shared.text.UnicodeText;
import com.taskflow.backend.shared.validation.CodePointLength;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

/**
 * Validated task fields accepted by create and replace operations.
 *
 * <p>New scheduling fields retain defaults when omitted for compatibility with older clients.
 * Explicit null priority and status values are rejected by their JSON setters.</p>
 */
@Schema(name = "TaskRequest", description = "Editable task fields; ID, version, and completion time are server-controlled.")
public final class TaskRequest {

    @NotNull(message = "must not be null")
    @NotEmpty(message = "must not be blank")
    @CodePointLength(max = 200)
    private String title;

    @CodePointLength(max = 10_000)
    private String description = "";

    @Pattern(
            regexp = "^(?!0000)[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])$",
            message = "must be a date in YYYY-MM-DD format from year 0001 through 9999")
    private String dueDate;

    @Pattern(regexp = "low|medium|high", message = "must be low, medium, or high")
    private String priority = "medium";

    @Pattern(
            regexp = "(?i)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
            message = "must be a canonical UUID")
    private String projectId;

    @Pattern(regexp = "active|completed", message = "must be active or completed")
    private String status = "active";

    /**
     * Creates an empty request for JSON binding.
     */
    public TaskRequest() {
    }

    /**
     * Creates a legacy title-and-description request using contract defaults.
     *
     * @param title title before normalization
     * @param description optional description before normalization
     */
    public TaskRequest(String title, String description) {
        this(title, description, null, "medium", null, "active");
    }

    /**
     * Creates a fully populated request for application use and tests.
     *
     * @param title title before normalization
     * @param description optional description before normalization
     * @param dueDate optional calendar date
     * @param priority priority value
     * @param projectId optional project UUID
     * @param status task status
     */
    public TaskRequest(String title, String description, String dueDate, String priority, String projectId, String status) {
        setTitle(title);
        setDescription(description);
        this.dueDate = dueDate;
        this.priority = priority;
        this.projectId = projectId;
        this.status = status;
    }

    /**
     * Returns the title after TaskFlow whitespace normalization.
     *
     * @return normalized title, or null when omitted
     */
    @JsonProperty("title")
    @Schema(description = "Trimmed title, at most 200 Unicode code points.", example = "Plan the release")
    public String title() {
        return title;
    }

    /**
     * Sets and normalizes a submitted title.
     *
     * @param value incoming title
     */
    @JsonSetter("title")
    public void setTitle(String value) {
        title = UnicodeText.trim(value);
    }

    /**
     * Returns the description, which is always nonnull after binding.
     *
     * @return description text with original whitespace preserved
     */
    @JsonProperty("description")
    @Schema(description = "Optional description; whitespace is preserved.", example = "Review the open issues.")
    public String description() {
        return description;
    }

    /**
     * Sets the optional description, normalizing null to empty text.
     *
     * @param value incoming description
     */
    @JsonSetter("description")
    public void setDescription(String value) {
        description = value == null ? "" : value;
    }

    /**
     * Returns the optional calendar deadline.
     *
     * @return strict YYYY-MM-DD value, or null when undated
     */
    @JsonProperty("dueDate")
    @Schema(description = "Optional calendar date, never converted through UTC.", example = "2026-11-02", pattern = "^[0-9]{4}-[0-9]{2}-[0-9]{2}$")
    public String dueDate() {
        return dueDate;
    }

    /**
     * Sets the optional date without converting it through a timezone.
     *
     * @param value incoming YYYY-MM-DD date or null
     */
    @JsonSetter("dueDate")
    public void setDueDate(String value) {
        dueDate = value;
    }

    /**
     * Returns the priority with the omission default applied.
     *
     * @return low, medium, or high
     */
    @JsonProperty("priority")
    @Schema(description = "Priority; omission defaults to medium.", allowableValues = {"low", "medium", "high"}, example = "medium")
    public String priority() {
        return priority;
    }

    /**
     * Sets a nonnull priority value; omission leaves the medium default unchanged.
     *
     * @param value incoming priority
     * @throws IllegalArgumentException if the field is explicitly null
     */
    @JsonSetter("priority")
    public void setPriority(String value) {
        if (value == null) {
            throw new IllegalArgumentException("priority must not be null");
        }
        priority = value;
    }

    /**
     * Returns the optional assigned project identifier.
     *
     * @return UUID string, or null when unassigned
     */
    @JsonProperty("projectId")
    @Schema(description = "Optional project UUID; null means unassigned.", format = "uuid", nullable = true)
    public String projectId() {
        return projectId;
    }

    /**
     * Sets the optional project UUID.
     *
     * @param value incoming UUID or null
     */
    @JsonSetter("projectId")
    public void setProjectId(String value) {
        projectId = value;
    }

    /**
     * Returns the task status with the omission default applied.
     *
     * @return active or completed
     */
    @JsonProperty("status")
    @Schema(description = "Task status; omission defaults to active.", allowableValues = {"active", "completed"}, example = "active")
    public String status() {
        return status;
    }

    /**
     * Sets a nonnull status; omission leaves the active default unchanged.
     *
     * @param value incoming status
     * @throws IllegalArgumentException if the field is explicitly null
     */
    @JsonSetter("status")
    public void setStatus(String value) {
        if (value == null) {
            throw new IllegalArgumentException("status must not be null");
        }
        status = value;
    }
}
