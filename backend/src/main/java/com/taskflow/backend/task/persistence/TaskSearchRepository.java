package com.taskflow.backend.task.persistence;

import java.time.Instant;
import java.util.List;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

/**
 * PostgreSQL-backed literal substring search for task text.
 */
public interface TaskSearchRepository {

    /**
     * Applies all allowlisted filters, sorting, and server-side pagination in PostgreSQL.
     *
     * @param criteria filters and calendar boundaries resolved by the application service
     * @param pageable requested page and size
     * @return matching tasks and the total matching count
     */
    Page<TaskEntity> searchTasks(TaskSearchCriteria criteria, Pageable pageable);

    /**
     * Counts tasks currently completed within a half-open instant range.
     *
     * @param start inclusive range start
     * @param end exclusive range end
     * @return number of matching completed tasks
     */
    long countCompletedBetween(Instant start, Instant end);

    /**
     * Groups current completions by local date in the supplied IANA timezone.
     *
     * @param start inclusive instant range start
     * @param end exclusive instant range end
     * @param timeZone valid IANA timezone ID
     * @return rows containing local date and completion count
     */
    List<Object[]> dailyCompletions(Instant start, Instant end, String timeZone);
}
