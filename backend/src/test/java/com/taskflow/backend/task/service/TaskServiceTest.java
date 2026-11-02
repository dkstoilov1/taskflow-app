package com.taskflow.backend.task.service;

import com.taskflow.backend.project.persistence.ProjectRepository;
import com.taskflow.backend.shared.api.ApiException;
import com.taskflow.backend.task.api.TaskPageResponse;
import com.taskflow.backend.task.api.TaskRequest;
import com.taskflow.backend.task.api.TaskResponse;
import com.taskflow.backend.task.persistence.TaskEntity;
import com.taskflow.backend.task.persistence.TaskRepository;
import com.taskflow.backend.task.persistence.TaskSearchCriteria;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for task application behavior, filtering, and concurrency semantics.
 */
@ExtendWith(MockitoExtension.class)
class TaskServiceTest {

    private static final Instant NOW = Instant.parse("2026-11-02T12:30:00Z");

    @Mock
    private TaskRepository taskRepository;

    @Mock
    private ProjectRepository projectRepository;

    private TaskService taskService;
    private UUID taskId;
    private TaskEntity existingTask;

    @BeforeEach
    void setUp() {
        taskService = new TaskService(
                taskRepository,
                projectRepository,
                Clock.fixed(NOW, ZoneOffset.UTC));
        taskId = UUID.randomUUID();
        existingTask = entity(taskId, 3, "Existing", "Description", "active", null);
    }

    @Test
    void defaultListUsesDatabaseSearchAndCalendarDefaults() {
        stubSearchPage(existingTask);

        TaskPageResponse result = taskService.listTasks(0, 20, "   ");

        assertThat(result.items()).containsExactly(response(taskId, 3, "Existing", "Description"));
        assertThat(result.page()).isZero();
        assertThat(result.size()).isEqualTo(20);
        assertThat(result.totalElements()).isEqualTo(1);
        ArgumentCaptor<TaskSearchCriteria> criteria = ArgumentCaptor.forClass(TaskSearchCriteria.class);
        ArgumentCaptor<Pageable> pageable = ArgumentCaptor.forClass(Pageable.class);
        verify(taskRepository).searchTasks(criteria.capture(), pageable.capture());
        assertThat(criteria.getValue().query()).isNull();
        assertThat(criteria.getValue().view()).isEqualTo("all");
        assertThat(criteria.getValue().today()).isEqualTo(LocalDate.parse("2026-11-02"));
        assertThat(criteria.getValue().weekStart()).isEqualTo(LocalDate.parse("2026-11-02"));
        assertThat(criteria.getValue().weekEnd()).isEqualTo(LocalDate.parse("2026-11-08"));
        assertThat(pageable.getValue().getSort()).isEmpty();
    }

    @Test
    void listTrimsQueryAndUsesFiltersAndRequestedZone() {
        stubSearchPage(existingTask);

        TaskPageResponse result = taskService.listTasks(
                2, 5, "  percent%_  ", "upcoming", "active", "high", "this_week",
                "unassigned", "due_desc", "America/Los_Angeles");

        assertThat(result.page()).isEqualTo(2);
        assertThat(result.items()).hasSize(1);
        ArgumentCaptor<TaskSearchCriteria> criteria = ArgumentCaptor.forClass(TaskSearchCriteria.class);
        verify(taskRepository).searchTasks(criteria.capture(), any(Pageable.class));
        assertThat(criteria.getValue().query()).isEqualTo("percent%_");
        assertThat(criteria.getValue().view()).isEqualTo("upcoming");
        assertThat(criteria.getValue().status()).isEqualTo("active");
        assertThat(criteria.getValue().priority()).isEqualTo("high");
        assertThat(criteria.getValue().due()).isEqualTo("this_week");
        assertThat(criteria.getValue().unassigned()).isTrue();
        assertThat(criteria.getValue().sort()).isEqualTo("due_desc");
        assertThat(criteria.getValue().today()).isEqualTo(LocalDate.parse("2026-11-02"));
    }

    @Test
    void invalidFilterTimezoneProjectAndSearchAreRejected() {
        assertBadField(() -> taskService.listTasks(0, 20, "x".repeat(201)), "q");
        assertBadField(() -> taskService.listTasks(0, 20, null, "wrong", null, null, null, null, null, "UTC"), "view");
        assertBadField(() -> taskService.listTasks(0, 20, null, "all", null, null, null, null, null, "+02:00"), "timeZone");
        assertBadField(() -> taskService.listTasks(0, 20, null, "all", null, null, null, "not-a-uuid", null, "UTC"), "project");
        assertBadField(() -> taskService.listTasks(0, 20, null, "all", null, null, null, null, "unknown", "UTC"), "sort");
    }

    @Test
    void getReturnsTaskAndMissingTaskIsNotFound() {
        when(taskRepository.findById(taskId)).thenReturn(Optional.of(existingTask));
        assertThat(taskService.getTask(taskId)).isEqualTo(response(taskId, 3, "Existing", "Description"));

        when(taskRepository.findById(taskId)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> taskService.getTask(taskId))
                .isInstanceOf(ApiException.class)
                .extracting("status").isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    void createNormalizesLegacyRequestAndRecordsCompletionClock() {
        UUID createdId = UUID.randomUUID();
        when(taskRepository.saveAndFlush(any(TaskEntity.class))).thenAnswer(invocation -> {
            TaskEntity entity = invocation.getArgument(0);
            ReflectionTestUtils.setField(entity, "id", createdId);
            return entity;
        });

        TaskResponse created = taskService.createTask(new TaskRequest("  New task  ", null));
        TaskResponse completed = taskService.createTask(new TaskRequest(
                "Done", "", "2026-11-03", "high", null, "completed"));

        assertThat(created).isEqualTo(response(createdId, 0, "New task", ""));
        assertThat(completed.status()).isEqualTo("completed");
        assertThat(completed.dueDate()).isEqualTo(LocalDate.parse("2026-11-03"));
        assertThat(completed.completedAt()).isEqualTo(NOW);
        assertThat(completed.priority()).isEqualTo("high");
    }

    @Test
    void normalizesServerTimestampsToPostgresMicrosecondPrecision() {
        Instant clockInstant = Instant.parse("2026-11-02T12:30:00.123456789Z");
        Instant persistedInstant = Instant.parse("2026-11-02T12:30:00.123456Z");
        taskService = new TaskService(
                taskRepository,
                projectRepository,
                Clock.fixed(clockInstant, ZoneOffset.UTC));
        UUID createdId = UUID.randomUUID();
        when(taskRepository.saveAndFlush(any(TaskEntity.class))).thenAnswer(invocation -> {
            TaskEntity entity = invocation.getArgument(0);
            ReflectionTestUtils.setField(entity, "id", createdId);
            return entity;
        });

        TaskResponse created = taskService.createTask(
                new TaskRequest("Done", "", null, "medium", null, "completed"));

        ArgumentCaptor<TaskEntity> createdEntity = ArgumentCaptor.forClass(TaskEntity.class);
        verify(taskRepository).saveAndFlush(createdEntity.capture());
        assertThat(createdEntity.getValue().getCreatedAt()).isEqualTo(persistedInstant);
        assertThat(createdEntity.getValue().getCompletedAt()).isEqualTo(persistedInstant);
        assertThat(created.completedAt()).isEqualTo(persistedInstant);

        existingTask = entity(taskId, 3, "Ready", "Body", "active", null);
        when(taskRepository.findById(taskId)).thenReturn(Optional.of(existingTask));
        when(taskRepository.updateStatusIfVersionMatches(eq(taskId), eq(3), eq("completed"), any()))
                .thenReturn(1);

        TaskResponse completed = taskService.changeStatus(taskId, 3, "completed");

        ArgumentCaptor<Instant> mutationTimestamp = ArgumentCaptor.forClass(Instant.class);
        verify(taskRepository).updateStatusIfVersionMatches(
                eq(taskId), eq(3), eq("completed"), mutationTimestamp.capture());
        assertThat(mutationTimestamp.getValue()).isEqualTo(persistedInstant);
        assertThat(completed.completedAt()).isEqualTo(persistedInstant);
    }

    @Test
    void createRejectsMissingProjectAndImpossibleDate() {
        UUID projectId = UUID.randomUUID();
        when(projectRepository.findByIdForUpdate(projectId)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> taskService.createTask(
                new TaskRequest("Title", "", null, "medium", projectId.toString(), "active")))
                .isInstanceOf(ApiException.class)
                .extracting("status").isEqualTo(HttpStatus.BAD_REQUEST);

        assertBadField(() -> taskService.createTask(
                new TaskRequest("Title", "", "2026-02-30", "medium", null, "active")), "dueDate");
    }

    @Test
    void updateReplacesAllFieldsAndPreservesCompletedTimestamp() {
        Instant completedAt = Instant.parse("2026-11-01T10:00:00Z");
        existingTask = entity(taskId, 3, "Existing", "Description", "completed", completedAt);
        UUID projectId = UUID.randomUUID();
        when(taskRepository.findById(taskId)).thenReturn(Optional.of(existingTask));
        when(projectRepository.findByIdForUpdate(projectId)).thenReturn(Optional.of(new com.taskflow.backend.project.persistence.ProjectEntity("P")));
        when(taskRepository.replaceIfVersionMatches(eq(taskId), eq(3), anyString(), anyString(), any(),
                anyString(), eq(projectId), anyString(), any())).thenReturn(1);

        TaskResponse updated = taskService.updateTask(taskId, 3, new TaskRequest(
                " Revised ", " keep spaces ", "2026-12-01", "high", projectId.toString(), "completed"));

        assertThat(updated).isEqualTo(new TaskResponse(
                taskId, "Revised", " keep spaces ", 4, LocalDate.parse("2026-12-01"),
                "high", projectId, "completed", completedAt));
    }

    @Test
    void updateReopeningClearsCompletionTimeAndConcurrentWritesFail() {
        existingTask = entity(taskId, 3, "Done", "", "completed", NOW);
        when(taskRepository.findById(taskId)).thenReturn(Optional.of(existingTask));
        when(taskRepository.replaceIfVersionMatches(eq(taskId), eq(3), eq("Done"), eq(""), any(),
                eq("medium"), eq(null), eq("active"), any())).thenReturn(1);

        TaskResponse reopened = taskService.updateTask(taskId, 3, new TaskRequest("Done", ""));
        assertThat(reopened.status()).isEqualTo("active");
        assertThat(reopened.completedAt()).isNull();

        when(taskRepository.replaceIfVersionMatches(eq(taskId), eq(3), eq("Done"), eq(""), any(),
                eq("medium"), eq(null), eq("active"), any())).thenReturn(0);
        assertThatThrownBy(() -> taskService.updateTask(taskId, 3, new TaskRequest("Done", "")))
                .isInstanceOf(ApiException.class)
                .extracting("status").isEqualTo(HttpStatus.PRECONDITION_FAILED);
    }

    @Test
    void staleUpdateIsRejectedBeforeMutationAndMissingTaskIsNotFound() {
        when(taskRepository.findById(taskId)).thenReturn(Optional.of(existingTask));
        assertThatThrownBy(() -> taskService.updateTask(taskId, 2, new TaskRequest("Revised", "")))
                .isInstanceOf(ApiException.class)
                .extracting("status").isEqualTo(HttpStatus.PRECONDITION_FAILED);
        verify(taskRepository, never()).replaceIfVersionMatches(
                any(UUID.class), anyInt(), anyString(), anyString(), any(), anyString(), any(), anyString(), any());

        when(taskRepository.findById(taskId)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> taskService.updateTask(taskId, 3, new TaskRequest("Revised", "")))
                .isInstanceOf(ApiException.class)
                .extracting("status").isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    void statusMutationPreservesFieldsAndCompletionTimeOnRepeatedStatus() {
        existingTask = entity(taskId, 3, "Done", "Body", "completed", NOW);
        when(taskRepository.findById(taskId)).thenReturn(Optional.of(existingTask));
        when(taskRepository.updateStatusIfVersionMatches(taskId, 3, "completed", NOW)).thenReturn(1);

        TaskResponse repeated = taskService.changeStatus(taskId, 3, "completed");
        assertThat(repeated.completedAt()).isEqualTo(NOW);
        assertThat(repeated.title()).isEqualTo("Done");
        assertThat(repeated.version()).isEqualTo(4);
    }

    @Test
    void statusStaleAndDeleteConcurrencyAreMappedToPreconditionFailure() {
        when(taskRepository.findById(taskId)).thenReturn(Optional.of(existingTask));
        when(taskRepository.updateStatusIfVersionMatches(taskId, 3, "completed", NOW)).thenReturn(0);
        assertThatThrownBy(() -> taskService.changeStatus(taskId, 3, "completed"))
                .isInstanceOf(ApiException.class)
                .extracting("status").isEqualTo(HttpStatus.PRECONDITION_FAILED);

        when(taskRepository.deleteIfVersionMatches(taskId, 3)).thenReturn(0);
        assertThatThrownBy(() -> taskService.deleteTask(taskId, 3))
                .isInstanceOf(ApiException.class)
                .extracting("status").isEqualTo(HttpStatus.PRECONDITION_FAILED);
    }

    private void stubSearchPage(TaskEntity task) {
        when(taskRepository.searchTasks(any(TaskSearchCriteria.class), any(Pageable.class)))
                .thenAnswer(invocation -> new PageImpl<>(List.of(task), invocation.getArgument(1), 1));
    }

    private void assertBadField(Runnable action, String field) {
        assertThatThrownBy(action::run)
                .isInstanceOf(ApiException.class)
                .satisfies(exception -> {
                    ApiException apiException = (ApiException) exception;
                    assertThat(apiException.status()).isEqualTo(HttpStatus.BAD_REQUEST);
                    assertThat(apiException.fieldErrors()).containsKey(field);
                });
    }

    private TaskEntity entity(UUID id, int version, String title, String description, String status, Instant completedAt) {
        TaskEntity entity = new TaskEntity(title, description, null, "medium", null, status, completedAt, NOW);
        ReflectionTestUtils.setField(entity, "id", id);
        ReflectionTestUtils.setField(entity, "version", version);
        return entity;
    }

    private TaskResponse response(UUID id, int version, String title, String description) {
        return new TaskResponse(id, title, description, version);
    }
}
