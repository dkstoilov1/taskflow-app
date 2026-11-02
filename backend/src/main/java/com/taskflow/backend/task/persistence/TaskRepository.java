package com.taskflow.backend.task.persistence;

import java.util.UUID;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Spring Data persistence boundary for task aggregates.
 */
public interface TaskRepository extends JpaRepository<TaskEntity, UUID>, TaskSearchRepository {

    /**
     * Replaces the editable fields and advances the version only if the stored version still matches.
     *
     * @param id task UUID
     * @param expectedVersion version supplied by the caller
     * @param title normalized replacement title
     * @param description replacement description
     * @return one when updated, or zero when the version no longer matches
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = """
            UPDATE tasks
            SET title = :title,
                description = :description,
                version = version + 1
            WHERE id = :id
              AND version = :expectedVersion
            """, nativeQuery = true)
    int updateDetailsIfVersionMatches(
            @Param("id") UUID id,
            @Param("expectedVersion") int expectedVersion,
            @Param("title") String title,
            @Param("description") String description);

    /**
     * Deletes a task only when its stored version still matches the caller's version.
     *
     * @param id task UUID
     * @param expectedVersion version supplied by the caller
     * @return one when deleted, or zero when the version no longer matches
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = "DELETE FROM tasks WHERE id = :id AND version = :expectedVersion", nativeQuery = true)
    int deleteIfVersionMatches(@Param("id") UUID id, @Param("expectedVersion") int expectedVersion);
}
