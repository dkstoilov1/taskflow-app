package com.taskflow.backend.task.persistence;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;

import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for PostgreSQL literal task search.
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
    void largeValidPageOffsetsRemainDatabaseLongs() {
        Pageable pageable = PageRequest.of(Integer.MAX_VALUE, 100);
        when(entityManager.createNativeQuery(anyString(), eq(TaskEntity.class))).thenReturn(contentQuery);
        when(entityManager.createNativeQuery(anyString())).thenReturn(countQuery);
        when(contentQuery.setParameter(eq("limit"), any())).thenReturn(contentQuery);
        when(contentQuery.setParameter(eq("offset"), any())).thenReturn(contentQuery);
        when(contentQuery.getResultList()).thenReturn(List.of());
        when(countQuery.getSingleResult()).thenReturn(0L);

        Page<TaskEntity> result = new TaskSearchRepositoryImpl(entityManager).listAllTasks(pageable);

        ArgumentCaptor<Object> offset = ArgumentCaptor.forClass(Object.class);
        verify(contentQuery).setParameter(eq("offset"), offset.capture());
        assertThat(offset.getValue()).isEqualTo(214_748_364_700L);
        assertThat(result.getContent()).isEmpty();
        assertThat(result.getTotalElements()).isZero();
    }

    @Test
    void escapesLikeWildcardsAndPaginatesNativeSearch() {
        TaskEntity task = new TaskEntity("literal", "");
        Pageable pageable = PageRequest.of(1, 5, Sort.by(Sort.Direction.DESC, "createdAt"));
        when(entityManager.createNativeQuery(any(String.class), eq(TaskEntity.class))).thenReturn(contentQuery);
        when(entityManager.createNativeQuery(any(String.class))).thenReturn(countQuery);
        when(contentQuery.setParameter(eq("pattern"), any())).thenReturn(contentQuery);
        when(contentQuery.setParameter(eq("limit"), any())).thenReturn(contentQuery);
        when(contentQuery.setParameter(eq("offset"), any())).thenReturn(contentQuery);
        when(contentQuery.getResultList()).thenReturn(List.of(task));
        when(countQuery.setParameter(eq("pattern"), any())).thenReturn(countQuery);
        when(countQuery.getSingleResult()).thenReturn(12L);

        Page<TaskEntity> result = new TaskSearchRepositoryImpl(entityManager)
                .searchLiteral("x%_\\y", pageable);

        ArgumentCaptor<Object> pattern = ArgumentCaptor.forClass(Object.class);
        verify(contentQuery).setParameter(eq("pattern"), pattern.capture());
        assertThat(pattern.getValue()).isEqualTo("%x\\%\\_\\\\y%");
        verify(contentQuery).setParameter("limit", 5);
        verify(contentQuery).setParameter("offset", 5L);
        assertThat(result.getContent()).containsExactly(task);
        assertThat(result.getTotalElements()).isEqualTo(12);
    }
}
