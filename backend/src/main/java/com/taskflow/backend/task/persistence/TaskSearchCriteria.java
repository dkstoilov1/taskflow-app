package com.taskflow.backend.task.persistence;

import java.time.LocalDate;
import java.util.UUID;

/**
 * Allowlisted task filters with calendar boundaries already resolved for the requested timezone.
 *
 * @param query trimmed literal text search, or null
 * @param view task view filter
 * @param status optional explicit task status
 * @param priority optional priority filter
 * @param due optional due-date filter
 * @param projectId project filter UUID, or null
 * @param unassigned whether to filter for tasks without a project
 * @param sort allowlisted public sort key
 * @param today local current date
 * @param weekStart local Monday of the current week
 * @param weekEnd local Sunday of the current week
 */
public record TaskSearchCriteria(
        String query,
        String view,
        String status,
        String priority,
        String due,
        UUID projectId,
        boolean unassigned,
        String sort,
        LocalDate today,
        LocalDate weekStart,
        LocalDate weekEnd) {
}
