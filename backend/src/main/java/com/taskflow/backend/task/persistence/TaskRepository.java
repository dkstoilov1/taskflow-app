package com.taskflow.backend.task.persistence;

import java.util.UUID;
import java.time.Instant;
import java.time.LocalDate;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Spring Data persistence boundary for task aggregates.
 */
public interface TaskRepository extends JpaRepository<TaskEntity, UUID>, TaskSearchRepository {

    /**
     * Replaces all editable fields and advances the version only if it still matches.
     *
     * @param id task UUID
     * @param expectedVersion current client version
     * @param title normalized replacement title
     * @param description replacement description
     * @param dueDate optional calendar deadline
     * @param priority priority value
     * @param projectId optional project UUID
     * @param status status value
     * @param completedAt current server time used for a new completion
     * @return one if changed, or zero when another write won the race
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = """
            UPDATE tasks
            SET title = :title,
                description = :description,
                due_date = CAST(:dueDate AS DATE),
                priority = :priority,
                project_id = CAST(:projectId AS UUID),
                completed_at = CASE
                    WHEN :status = 'completed' AND status = 'completed' THEN completed_at
                    WHEN :status = 'completed' THEN :completedAt
                    ELSE NULL
                END,
                status = :status,
                version = version + 1
            WHERE id = :id
              AND version = :expectedVersion
            """, nativeQuery = true)
    int replaceIfVersionMatches(
            @Param("id") UUID id,
            @Param("expectedVersion") int expectedVersion,
            @Param("title") String title,
            @Param("description") String description,
            @Param("dueDate") LocalDate dueDate,
            @Param("priority") String priority,
            @Param("projectId") UUID projectId,
            @Param("status") String status,
            @Param("completedAt") Instant completedAt);

    /**
     * Changes only status and its completion timestamp while advancing the version atomically.
     *
     * @param id task UUID
     * @param expectedVersion current client version
     * @param status requested status
     * @param completedAt current server instant
     * @return one if changed, or zero when another write won the race
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = """
            UPDATE tasks
            SET completed_at = CASE
                    WHEN :status = 'completed' AND status = 'completed' THEN completed_at
                    WHEN :status = 'completed' THEN :completedAt
                    ELSE NULL
                END,
                status = :status,
                version = version + 1
            WHERE id = :id
              AND version = :expectedVersion
            """, nativeQuery = true)
    int updateStatusIfVersionMatches(
            @Param("id") UUID id,
            @Param("expectedVersion") int expectedVersion,
            @Param("status") String status,
            @Param("completedAt") Instant completedAt);

    /**
     * Detaches all tasks from a locked project and advances each affected task version.
     *
     * @param projectId project being deleted
     * @return number of tasks detached
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = """
            UPDATE tasks
            SET project_id = NULL, version = version + 1
            WHERE project_id = :projectId
            """, nativeQuery = true)
    int unassignTasksFromProject(@Param("projectId") UUID projectId);

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
