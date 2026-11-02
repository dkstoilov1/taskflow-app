package com.taskflow.backend.task.persistence;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

/**
 * PostgreSQL-backed literal substring search for task text.
 */
public interface TaskSearchRepository {

    /**
     * Reads an ordered task page using a database-native offset that supports large page indexes.
     *
     * @param pageable bounded page size and deterministic ordering request
     * @return all tasks for the requested page and total count
     */
    Page<TaskEntity> listAllTasks(Pageable pageable);

    /**
     * Finds tasks containing a literal, case-insensitive query in either editable field.
     *
     * @param query trimmed search text without SQL wildcard interpretation
     * @param pageable bounded page and deterministic ordering request
     * @return matching tasks and total count
     */
    Page<TaskEntity> searchLiteral(String query, Pageable pageable);
}
