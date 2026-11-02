package com.taskflow.backend.task.api;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

/**
 * A bounded page of task results and its pagination metadata.
 *
 * @param items task representations on this page
 * @param page zero-based page index
 * @param size requested page size
 * @param totalElements number of matching tasks
 * @param totalPages number of pages, or zero when no tasks match
 */
@Schema(name = "TaskPage", description = "A page of tasks with total result and page counts.")
public record TaskPageResponse(
        List<TaskResponse> items,
        int page,
        int size,
        long totalElements,
        int totalPages) {
}
