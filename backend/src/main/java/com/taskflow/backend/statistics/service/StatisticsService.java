package com.taskflow.backend.statistics.service;

import com.taskflow.backend.project.persistence.ProjectRepository;
import com.taskflow.backend.shared.api.ApiException;
import com.taskflow.backend.statistics.api.DailyCompletionResponse;
import com.taskflow.backend.statistics.api.ProjectCompletionResponse;
import com.taskflow.backend.statistics.api.StatisticsResponse;
import com.taskflow.backend.task.persistence.TaskRepository;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.DateTimeException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;
import java.time.DayOfWeek;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Computes database-wide completion totals using local calendar boundaries.
 */
@Service
public class StatisticsService {

    private final TaskRepository taskRepository;
    private final ProjectRepository projectRepository;
    private final Clock clock;

    /**
     * Creates statistics use cases with task/project queries and the server clock.
     *
     * @param taskRepository completion aggregate persistence boundary
     * @param projectRepository project aggregate persistence boundary
     * @param clock server clock used to determine local dates
     */
    public StatisticsService(TaskRepository taskRepository, ProjectRepository projectRepository, Clock clock) {
        this.taskRepository = taskRepository;
        this.projectRepository = projectRepository;
        this.clock = clock;
    }

    /**
     * Returns current completion counts for the requested timezone.
     *
     * @param timeZone valid IANA timezone, defaulted by the caller to UTC
     * @return all-time current project totals, this-week/today counts, and seven daily counts
     * @throws ApiException with 400 when the timezone is invalid
     */
    @Transactional(readOnly = true)
    public StatisticsResponse getStatistics(String timeZone) {
        ZoneId zone = parseZone(timeZone);
        LocalDate today = LocalDate.now(clock.withZone(zone));
        LocalDate weekStart = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        LocalDate weekEnd = weekStart.plusDays(6);
        Instant todayStart = today.atStartOfDay(zone).toInstant();
        Instant tomorrowStart = today.plusDays(1).atStartOfDay(zone).toInstant();
        Instant weekStartInstant = weekStart.atStartOfDay(zone).toInstant();
        Instant nextWeekStart = weekStart.plusDays(7).atStartOfDay(zone).toInstant();
        LocalDate firstDailyDate = today.minusDays(6);
        Instant dailyStart = firstDailyDate.atStartOfDay(zone).toInstant();
        Map<LocalDate, Long> countsByDate = dailyCounts(dailyStart, tomorrowStart, zone);
        List<DailyCompletionResponse> daily = new ArrayList<>(7);
        for (int day = 0; day < 7; day++) {
            LocalDate date = firstDailyDate.plusDays(day);
            daily.add(new DailyCompletionResponse(date, countsByDate.getOrDefault(date, 0L)));
        }
        return new StatisticsResponse(
                today,
                weekStart,
                weekEnd,
                taskRepository.countCompletedBetween(todayStart, tomorrowStart),
                taskRepository.countCompletedBetween(weekStartInstant, nextWeekStart),
                List.copyOf(daily),
                projectStatistics());
    }

    private Map<LocalDate, Long> dailyCounts(Instant start, Instant end, ZoneId zone) {
        Map<LocalDate, Long> result = new HashMap<>();
        for (Object[] row : taskRepository.dailyCompletions(start, end, zone.getId())) {
            result.put(toLocalDate(row[0]), ((Number) row[1]).longValue());
        }
        return result;
    }

    private List<ProjectCompletionResponse> projectStatistics() {
        List<ProjectCompletionResponse> result = new ArrayList<>();
        for (Object[] row : projectRepository.projectTaskAggregates()) {
            UUID id = (UUID) row[0];
            String name = (String) row[1];
            long total = ((Number) row[2]).longValue();
            long completed = ((Number) row[3]).longValue();
            double rate = total == 0
                    ? 0.0
                    : BigDecimal.valueOf(completed * 100.0 / total).setScale(1, RoundingMode.HALF_UP).doubleValue();
            result.add(new ProjectCompletionResponse(id, name, total, completed, rate));
        }
        return List.copyOf(result);
    }

    private static LocalDate toLocalDate(Object databaseValue) {
        if (databaseValue instanceof LocalDate localDate) {
            return localDate;
        }
        if (databaseValue instanceof java.sql.Date sqlDate) {
            return sqlDate.toLocalDate();
        }
        return LocalDate.parse(databaseValue.toString());
    }

    private static ZoneId parseZone(String timeZone) {
        try {
            String value = timeZone == null ? "UTC" : timeZone;
            if (!ZoneId.getAvailableZoneIds().contains(value)) {
                throw invalidTimeZone();
            }
            return ZoneId.of(value);
        } catch (DateTimeException exception) {
            throw invalidTimeZone();
        }
    }

    private static ApiException invalidTimeZone() {
        return new ApiException(
                HttpStatus.BAD_REQUEST,
                "Invalid request",
                "The request contains invalid values.",
                Map.of("timeZone", List.of("must be a valid IANA timezone")));
    }
}
