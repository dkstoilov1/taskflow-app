package com.taskflow.backend.task.persistence;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;

import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for PostgreSQL task filters and completion queries.
 */
@ExtendWith(MockitoExtension.class)
class TaskSearchRepositoryImplTest {
    @Mock
    private EntityManager entityManager;

    @Mock
    private Query contentQuery;

    @Mock
    private Query countQuery;

    @Test
    void buildsBoundedFilteredSqlWithAllowlistedDueOrder() {
        when(entityManager.createNativeQuery(anyString(), eq(TaskEntity.class))).thenReturn(contentQuery);
        when(entityManager.createNativeQuery(anyString())).thenReturn(countQuery);
        when(contentQuery.setParameter(anyString(), any())).thenReturn(contentQuery);
        when(contentQuery.getResultList()).thenReturn(List.of());
        when(countQuery.getSingleResult()).thenReturn(0L);
        UUID projectId = UUID.randomUUID();
        TaskSearchCriteria criteria = new TaskSearchCriteria(
                "release%_", "today", "active", "high", "this_week", projectId, false, "due_asc",
                LocalDate.parse("2026-11-02"), LocalDate.parse("2026-11-02"), LocalDate.parse("2026-11-08"));

        new TaskSearchRepositoryImpl(entityManager).searchTasks(criteria, PageRequest.of(0, 20));

        ArgumentCaptor<String> contentSql = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> countSql = ArgumentCaptor.forClass(String.class);
        verify(entityManager).createNativeQuery(contentSql.capture(), eq(TaskEntity.class));
        verify(entityManager).createNativeQuery(countSql.capture());
        assertThat(contentSql.getValue())
                .contains("status = 'active' AND due_date <= :today")
                .contains("due_date BETWEEN :weekStart AND :weekEnd")
                .contains("project_id = :projectId")
                .contains("due_date ASC NULLS LAST, created_at DESC, id DESC");
        assertThat(countSql.getValue()).contains("COUNT(*)").contains("priority = :priority");
        verify(contentQuery).setParameter("pattern", "%release\\%\\_%");
        verify(contentQuery).setParameter("projectId", projectId);
        verify(countQuery).setParameter("weekStart", LocalDate.parse("2026-11-02"));
    }

    @Test
    void dateViewAndUnassignedFiltersBindOnlyRequiredCalendarParameters() {
        when(entityManager.createNativeQuery(anyString(), eq(TaskEntity.class))).thenReturn(contentQuery);
        when(entityManager.createNativeQuery(anyString())).thenReturn(countQuery);
        when(contentQuery.setParameter(anyString(), any())).thenReturn(contentQuery);
        when(contentQuery.getResultList()).thenReturn(List.of());
        when(countQuery.getSingleResult()).thenReturn(0L);
        TaskSearchCriteria criteria = new TaskSearchCriteria(
                null, "completed", null, null, null, null, true, "priority_desc",
                LocalDate.parse("2026-11-02"), LocalDate.parse("2026-11-02"), LocalDate.parse("2026-11-08"));

        new TaskSearchRepositoryImpl(entityManager).searchTasks(criteria, PageRequest.of(0, 10));

        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(entityManager).createNativeQuery(sql.capture(), eq(TaskEntity.class));
        assertThat(sql.getValue())
                .contains("status = 'completed'")
                .contains("project_id IS NULL")
                .contains("CASE priority WHEN 'high' THEN 0");
        verify(contentQuery).setParameter("limit", 10);
        verify(contentQuery).setParameter("offset", 0L);
    }

    @Test
    void largeValidPageIndexUsesLongDatabaseOffset() {
        when(entityManager.createNativeQuery(anyString(), eq(TaskEntity.class))).thenReturn(contentQuery);
        when(entityManager.createNativeQuery(anyString())).thenReturn(countQuery);
        when(contentQuery.setParameter(anyString(), any())).thenReturn(contentQuery);
        when(contentQuery.getResultList()).thenReturn(List.of());
        when(countQuery.getSingleResult()).thenReturn(0L);
        TaskSearchCriteria criteria = new TaskSearchCriteria(
                null, "all", null, null, null, null, false, "created_desc",
                LocalDate.parse("2026-11-02"), LocalDate.parse("2026-11-02"), LocalDate.parse("2026-11-08"));

        new TaskSearchRepositoryImpl(entityManager).searchTasks(
                criteria, PageRequest.of(Integer.MAX_VALUE, 100));

        ArgumentCaptor<Object> offset = ArgumentCaptor.forClass(Object.class);
        verify(contentQuery).setParameter(eq("offset"), offset.capture());
        assertThat(offset.getValue()).isEqualTo(214_748_364_700L);
    }

    @Test
    void completionQueriesUseHalfOpenInstantsAndRequestedLocalTimezone() {
        when(entityManager.createNativeQuery(anyString())).thenReturn(countQuery);
        when(countQuery.setParameter(anyString(), any())).thenReturn(countQuery);
        when(countQuery.getSingleResult()).thenReturn(4L);
        Instant start = Instant.parse("2026-03-08T08:00:00Z");
        Instant end = Instant.parse("2026-03-09T07:00:00Z");
        TaskSearchRepositoryImpl repository = new TaskSearchRepositoryImpl(entityManager);

        assertThat(repository.countCompletedBetween(start, end)).isEqualTo(4);
        repository.dailyCompletions(start, end, "America/Los_Angeles");

        ArgumentCaptor<String> dailySql = ArgumentCaptor.forClass(String.class);
        verify(entityManager, org.mockito.Mockito.times(2)).createNativeQuery(dailySql.capture());
        assertThat(dailySql.getAllValues().get(1))
                .contains("SELECT DATE(completed_at AT TIME ZONE :timeZone), COUNT(*)")
                .contains("GROUP BY 1")
                .doesNotContain("GROUP BY DATE(completed_at AT TIME ZONE :timeZone)");
        verify(countQuery).setParameter("timeZone", "America/Los_Angeles");
        org.mockito.Mockito.verify(countQuery, org.mockito.Mockito.times(2)).setParameter("start", start);
        org.mockito.Mockito.verify(countQuery, org.mockito.Mockito.times(2)).setParameter("end", end);
    }
}
