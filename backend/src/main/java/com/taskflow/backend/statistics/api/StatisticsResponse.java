package com.taskflow.backend.statistics.api;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.LocalDate;
import java.util.List;

/**
 * Timezone-aware current productivity aggregates across all tasks and projects.
 *
 * @param today local current date
 * @param weekStart Monday of the current local week
 * @param weekEnd Sunday of the current local week
 * @param completedToday completed tasks whose current completion date is today
 * @param completedThisWeek completed tasks whose current completion date is this week
 * @param dailyCompletions seven ascending local-day completion counts
 * @param projects completion totals for every existing project
 */
@Schema(name = "Statistics", description = "Current completion statistics using the requested timezone.")
public record StatisticsResponse(
        @Schema(format = "date") LocalDate today,
        @Schema(format = "date") LocalDate weekStart,
        @Schema(format = "date") LocalDate weekEnd,
        @Schema(minimum = "0") long completedToday,
        @Schema(minimum = "0") long completedThisWeek,
        List<DailyCompletionResponse> dailyCompletions,
        List<ProjectCompletionResponse> projects) {
}
