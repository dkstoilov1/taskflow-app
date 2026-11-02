package com.taskflow.backend.statistics.service;

import com.taskflow.backend.project.persistence.ProjectRepository;
import com.taskflow.backend.shared.api.ApiException;
import com.taskflow.backend.statistics.api.StatisticsResponse;
import com.taskflow.backend.task.persistence.TaskRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.when;

/**
 * Unit tests for timezone-aware statistics and project completion rates.
 */
@ExtendWith(MockitoExtension.class)
class StatisticsServiceTest {

    @Mock
    private TaskRepository taskRepository;

    @Mock
    private ProjectRepository projectRepository;

    private StatisticsService statisticsService;

    @BeforeEach
    void setUp() {
        statisticsService = new StatisticsService(
                taskRepository,
                projectRepository,
                Clock.fixed(Instant.parse("2026-03-08T10:00:00Z"), ZoneOffset.UTC));
    }

    @Test
    void buildsSevenLocalDaysIncludesZeroProjectsAndRoundsProjectRates() {
        UUID projectId = UUID.randomUUID();
        when(taskRepository.countCompletedBetween(any(), any())).thenReturn(2L, 7L);
        when(taskRepository.dailyCompletions(any(), any(), anyString())).thenReturn(List.of(
                new Object[] {LocalDate.parse("2026-03-08"), 2L},
                new Object[] {java.sql.Date.valueOf("2026-03-07"), 1L}));
        when(projectRepository.projectTaskAggregates()).thenReturn(List.of(
                new Object[] {projectId, "Alpha", 3L, 2L},
                new Object[] {UUID.randomUUID(), "Empty", 0L, 0L}));

        StatisticsResponse result = statisticsService.getStatistics("America/Los_Angeles");

        assertThat(result.today()).isEqualTo(LocalDate.parse("2026-03-08"));
        assertThat(result.weekStart()).isEqualTo(LocalDate.parse("2026-03-02"));
        assertThat(result.weekEnd()).isEqualTo(LocalDate.parse("2026-03-08"));
        assertThat(result.completedToday()).isEqualTo(2);
        assertThat(result.completedThisWeek()).isEqualTo(7);
        assertThat(result.dailyCompletions()).hasSize(7);
        assertThat(result.dailyCompletions().get(0).date()).isEqualTo(LocalDate.parse("2026-03-02"));
        assertThat(result.dailyCompletions().get(5).count()).isEqualTo(1);
        assertThat(result.dailyCompletions().get(6).count()).isEqualTo(2);
        assertThat(result.projects().get(0).completionRate()).isEqualTo(66.7);
        assertThat(result.projects().get(1).completionRate()).isZero();
    }

    @Test
    void usesDstAwareLocalDayBoundariesAndRejectsNonIanaZones() {
        when(taskRepository.countCompletedBetween(any(), any())).thenReturn(0L);
        when(taskRepository.dailyCompletions(any(), any(), anyString())).thenReturn(List.of());
        when(projectRepository.projectTaskAggregates()).thenReturn(List.of());

        statisticsService.getStatistics("America/Los_Angeles");

        ArgumentCaptor<Instant> start = ArgumentCaptor.forClass(Instant.class);
        ArgumentCaptor<Instant> end = ArgumentCaptor.forClass(Instant.class);
        verify(taskRepository, times(2)).countCompletedBetween(start.capture(), end.capture());
        assertThat(Duration.between(start.getAllValues().get(0), end.getAllValues().get(0)).toHours()).isEqualTo(23);

        assertThatThrownBy(() -> statisticsService.getStatistics("+02:00"))
                .isInstanceOf(ApiException.class)
                .satisfies(exception -> {
                    ApiException apiException = (ApiException) exception;
                    assertThat(apiException.status()).isEqualTo(HttpStatus.BAD_REQUEST);
                    assertThat(apiException.fieldErrors()).containsKey("timeZone");
                });
    }
}
