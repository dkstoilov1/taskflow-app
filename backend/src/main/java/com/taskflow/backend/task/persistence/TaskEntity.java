package com.taskflow.backend.task.persistence;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
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

    protected TaskEntity() {
    }

    /**
     * Creates a new task aggregate with an internal creation timestamp.
     *
     * @param title normalized nonblank title
     * @param description description text, never null
     */
    public TaskEntity(String title, String description) {
        this.title = title;
        this.description = description;
        this.createdAt = Instant.now();
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
}
