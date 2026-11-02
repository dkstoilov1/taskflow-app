package com.taskflow.backend.statistics.api;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.LocalDate;

/**
 * Completion count for one local calendar day.
 *
 * @param date local calendar date
 * @param count number of tasks currently completed on that date
 */
@Schema(name = "DailyCompletion", description = "Current completed-task count for one calendar day.")
public record DailyCompletionResponse(
        @Schema(format = "date", example = "2026-11-02") LocalDate date,
        @Schema(minimum = "0", example = "3") long count) {
}
