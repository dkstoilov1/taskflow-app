package com.taskflow.backend.statistics.api;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.UUID;

/**
 * Current task completion aggregate for one existing project.
 *
 * @param projectId project UUID
 * @param name project name
 * @param totalTasks number of tasks assigned to the project
 * @param completedTasks currently completed project tasks
 * @param completionRate percentage rounded to one decimal place
 */
@Schema(name = "ProjectCompletion", description = "Project task totals and one-decimal completion percentage.")
public record ProjectCompletionResponse(
        @Schema(format = "uuid") UUID projectId,
        @Schema(example = "Release planning") String name,
        @Schema(minimum = "0") long totalTasks,
        @Schema(minimum = "0") long completedTasks,
        @Schema(minimum = "0", maximum = "100") double completionRate) {
}
