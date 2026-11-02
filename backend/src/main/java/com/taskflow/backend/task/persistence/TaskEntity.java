package com.taskflow.backend.task.persistence;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/**
 * Persistence aggregate for a TaskFlow task.
 */
@Entity
@Table(name = "tasks")
public class TaskEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "title", nullable = false, length = 200)
    private String title;

    @Column(name = "description", nullable = false, length = 10_000)
    private String description;

    @Version
    @Column(name = "version", nullable = false)
    private int version;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "due_date")
    private LocalDate dueDate;

    @Column(name = "priority", nullable = false, length = 10)
    private String priority;

    @Column(name = "project_id")
    private UUID projectId;

    @Column(name = "status", nullable = false, length = 10)
    private String status;

    @Column(name = "completed_at")
    private Instant completedAt;

    protected TaskEntity() {
    }

    /**
     * Creates a new task aggregate with an internal creation timestamp.
     *
     * @param title normalized nonblank title
     * @param description description text, never null
     */
    public TaskEntity(String title, String description) {
        this(title, description, null, "medium", null, "active", null, Instant.now());
    }

    /**
     * Creates a task with all editable and server-owned state initialized.
     *
     * @param title normalized nonblank title
     * @param description description text, never null
     * @param dueDate optional calendar deadline
     * @param priority task priority value
     * @param projectId optional project identifier
     * @param status task status value
     * @param completedAt completion instant, if completed
     * @param createdAt internal creation instant used for ordering
     */
    public TaskEntity(
            String title,
            String description,
            LocalDate dueDate,
            String priority,
            UUID projectId,
            String status,
            Instant completedAt,
            Instant createdAt) {
        this.title = title;
        this.description = description;
        this.dueDate = dueDate;
        this.priority = priority;
        this.projectId = projectId;
        this.status = status;
        this.completedAt = completedAt;
        this.createdAt = createdAt;
    }

    /**
     * Replaces the two user-editable task fields.
     *
     * @param replacementTitle normalized nonblank replacement title
     * @param replacementDescription replacement description, never null
     */
    public void replaceDetails(String replacementTitle, String replacementDescription) {
        title = replacementTitle;
        description = replacementDescription;
    }

    /**
     * Replaces the user-editable task fields and the server-computed status timestamp.
     *
     * @param replacementTitle normalized title
     * @param replacementDescription replacement description
     * @param replacementDueDate optional calendar deadline
     * @param replacementPriority priority value
     * @param replacementProjectId optional project identifier
     * @param replacementStatus status value
     * @param replacementCompletedAt completion timestamp or null
     */
    public void replaceFields(
            String replacementTitle,
            String replacementDescription,
            LocalDate replacementDueDate,
            String replacementPriority,
            UUID replacementProjectId,
            String replacementStatus,
            Instant replacementCompletedAt) {
        title = replacementTitle;
        description = replacementDescription;
        dueDate = replacementDueDate;
        priority = replacementPriority;
        projectId = replacementProjectId;
        status = replacementStatus;
        completedAt = replacementCompletedAt;
    }

    /**
     * Returns the generated task identifier.
     *
     * @return task UUID, or null until persistence assigns it
     */
    public UUID getId() {
        return id;
    }

    /**
     * Returns the normalized task title.
     *
     * @return task title
     */
    public String getTitle() {
        return title;
    }

    /**
     * Returns the task description.
     *
     * @return task description
     */
    public String getDescription() {
        return description;
    }

    /**
     * Returns the current optimistic-lock version.
     *
     * @return non-negative version value
     */
    public int getVersion() {
        return version;
    }

    /**
     * Returns the internal creation time used for stable list ordering.
     *
     * @return task creation instant
     */
    public Instant getCreatedAt() {
        return createdAt;
    }

    /**
     * Returns the optional calendar deadline without timezone conversion.
     *
     * @return deadline, or null when the task is undated
     */
    public LocalDate getDueDate() {
        return dueDate;
    }

    /**
     * Returns the priority value stored for this task.
     *
     * @return one of low, medium, or high
     */
    public String getPriority() {
        return priority;
    }

    /**
     * Returns the optional assigned project identifier.
     *
     * @return project UUID, or null when unassigned
     */
    public UUID getProjectId() {
        return projectId;
    }

    /**
     * Returns the current task status value.
     *
     * @return active or completed
     */
    public String getStatus() {
        return status;
    }

    /**
     * Returns the server-controlled completion instant.
     *
     * @return completion instant, or null for an active task
     */
    public Instant getCompletedAt() {
        return completedAt;
    }
}
