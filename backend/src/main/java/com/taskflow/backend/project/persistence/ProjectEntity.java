package com.taskflow.backend.project.persistence;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.util.UUID;

/**
 * Persisted project used to group tasks without owning their lifecycle.
 */
@Entity
@Table(name = "projects")
public class ProjectEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "name", nullable = false, length = 100)
    private String name;

    @Version
    @Column(name = "version", nullable = false)
    private int version;

    protected ProjectEntity() {
    }

    /**
     * Creates a new project with a normalized unique name.
     *
     * @param name trimmed project name
     */
    public ProjectEntity(String name) {
        this.name = name;
    }

    /**
     * Returns the generated project identifier.
     *
     * @return project UUID, or null until persistence assigns it
     */
    public UUID getId() {
        return id;
    }

    /**
     * Returns the normalized project name.
     *
     * @return project name
     */
    public String getName() {
        return name;
    }

    /**
     * Returns the current optimistic concurrency version.
     *
     * @return non-negative version value
     */
    public int getVersion() {
        return version;
    }
}
