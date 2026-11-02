package com.taskflow.backend.statistics.api;

import com.taskflow.backend.statistics.service.StatisticsService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.Size;
import com.taskflow.backend.shared.api.ProblemDetailsResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * HTTP endpoint for timezone-aware productivity statistics.
 */
@RestController
@RequestMapping("/api/statistics")
@Tag(name = "Statistics", description = "Current task completion totals and per-project rates.")
public class StatisticsController {

    private final StatisticsService statisticsService;

    /**
     * Creates the statistics HTTP controller.
     *
     * @param statisticsService aggregate use cases
     */
    public StatisticsController(StatisticsService statisticsService) {
        this.statisticsService = statisticsService;
    }

    /**
     * Reads current completion statistics for a timezone.
     *
     * @param timeZone valid IANA timezone, defaulting to UTC
     * @return database-wide completion totals and project rates
     */
    @Operation(summary = "Get productivity statistics", description = "Aggregates current completions using local day and week boundaries.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Statistics returned.", content = @Content(
                mediaType = "application/json", schema = @Schema(implementation = StatisticsResponse.class))),
        @ApiResponse(responseCode = "400", description = "Invalid timezone.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "403", description = "Request Host is not local.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "500", description = "Unexpected server failure.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "503", description = "Statistics storage unavailable.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class)))
    })
    @GetMapping
    public StatisticsResponse getStatistics(
            @Parameter(description = "Valid IANA timezone; local midnight defines date boundaries.", example = "Europe/Paris")
            @RequestParam(name = "timeZone", defaultValue = "UTC") @Size(max = 100) String timeZone) {
        return statisticsService.getStatistics(timeZone);
    }
}
