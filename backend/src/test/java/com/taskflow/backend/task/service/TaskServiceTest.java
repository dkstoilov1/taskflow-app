package com.taskflow.backend.task.service;

import com.taskflow.backend.shared.api.ApiException;
import com.taskflow.backend.task.api.TaskPageResponse;
import com.taskflow.backend.task.api.TaskRequest;
import com.taskflow.backend.task.api.TaskResponse;
import com.taskflow.backend.task.persistence.TaskEntity;
import com.taskflow.backend.task.persistence.TaskRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.dao.OptimisticLockingFailureException;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for task application behavior.
 */
@ExtendWith(MockitoExtension.class)
class TaskServiceTest {
    @Mock
    private TaskRepository taskRepository;

    @InjectMocks
    private TaskService taskService;

    private UUID taskId;
    private TaskEntity existingTask;

    @BeforeEach
    void setUp() {
        taskId = UUID.randomUUID();
        existingTask = entity(taskId, 3, "Existing", "Description");
    }

    @Test
    void listUsesDefaultSortAndMapsPageMetadata() {
        when(taskRepository.listAllTasks(any(Pageable.class)))
                .thenAnswer(invocation -> new PageImpl<>(List.of(existingTask), invocation.getArgument(0), 1));

        TaskPageResponse result = taskService.listTasks(0, 20, "   ");

        assertThat(result.items()).containsExactly(response(taskId, 3, "Existing", "Description"));
        assertThat(result.page()).isZero();
        assertThat(result.size()).isEqualTo(20);
        assertThat(result.totalElements()).isEqualTo(1);
        ArgumentCaptor<Pageable> pageable = ArgumentCaptor.forClass(Pageable.class);
        verify(taskRepository).listAllTasks(pageable.capture());
        assertThat(pageable.getValue().getSort().getOrderFor("createdAt").getDirection())
                .isEqualTo(Sort.Direction.DESC);
        assertThat(pageable.getValue().getSort().getOrderFor("id").getDirection())
                .isEqualTo(Sort.Direction.DESC);
    }

    @Test
    void listTrimsQueryAndUsesLiteralSearchRepository() {
        when(taskRepository.searchLiteral(anyString(), any(Pageable.class)))
                .thenAnswer(invocation -> new PageImpl<>(List.of(existingTask), invocation.getArgument(1), 1));

        TaskPageResponse result = taskService.listTasks(2, 5, "  percent%_  ");

        assertThat(result.page()).isEqualTo(2);
        assertThat(result.items()).hasSize(1);
        verify(taskRepository).searchLiteral(org.mockito.ArgumentMatchers.eq("percent%_"), any(Pageable.class));
        verify(taskRepository, never()).listAllTasks(any(Pageable.class));
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
    void createNormalizesTitleAndReturnsGeneratedIdentity() {
        UUID createdId = UUID.randomUUID();
        when(taskRepository.saveAndFlush(any(TaskEntity.class))).thenAnswer(invocation -> {
            TaskEntity entity = invocation.getArgument(0);
            ReflectionTestUtils.setField(entity, "id", createdId);
            return entity;
        });

        TaskResponse result = taskService.createTask(new TaskRequest("  New task  ", null));

        assertThat(result).isEqualTo(response(createdId, 0, "New task", ""));
    }

    @Test
    void updateChangesEditableFieldsAndIncrementsVersion() {
        when(taskRepository.findById(taskId)).thenReturn(Optional.of(existingTask));
        when(taskRepository.updateDetailsIfVersionMatches(taskId, 3, "Revised", "  keep spaces  "))
                .thenReturn(1);

        TaskResponse result = taskService.updateTask(taskId, 3, new TaskRequest("  Revised ", "  keep spaces  "));

        assertThat(result).isEqualTo(response(taskId, 4, "Revised", "  keep spaces  "));
    }

    @Test
    void noOpUpdateStillAdvancesVersion() {
        when(taskRepository.findById(taskId)).thenReturn(Optional.of(existingTask));
        when(taskRepository.updateDetailsIfVersionMatches(taskId, 3, "Existing", "Description"))
                .thenReturn(1);

        TaskResponse result = taskService.updateTask(
                taskId, 3, new TaskRequest("Existing", "Description"));

        assertThat(result).isEqualTo(response(taskId, 4, "Existing", "Description"));
        verify(taskRepository).updateDetailsIfVersionMatches(
                taskId, 3, "Existing", "Description");
    }

    @Test
    void updateRejectsStaleVersionBeforeSaving() {
        when(taskRepository.findById(taskId)).thenReturn(Optional.of(existingTask));

        assertThatThrownBy(() -> taskService.updateTask(taskId, 2, new TaskRequest("Revised", "")))
                .isInstanceOf(ApiException.class)
                .extracting("status").isEqualTo(HttpStatus.PRECONDITION_FAILED);

        verify(taskRepository, never()).updateDetailsIfVersionMatches(
                org.mockito.ArgumentMatchers.eq(taskId),
                org.mockito.ArgumentMatchers.anyInt(),
                org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.anyString());
    }

    @Test
    void updateMapsConcurrentVersionChangeAndMissingTask() {
        when(taskRepository.findById(taskId)).thenReturn(Optional.of(existingTask));
        when(taskRepository.updateDetailsIfVersionMatches(taskId, 3, "Revised", ""))
                .thenReturn(0);

        assertThatThrownBy(() -> taskService.updateTask(taskId, 3, new TaskRequest("Revised", "")))
                .isInstanceOf(ApiException.class)
                .extracting("status").isEqualTo(HttpStatus.PRECONDITION_FAILED);

        when(taskRepository.findById(taskId)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> taskService.updateTask(taskId, 3, new TaskRequest("Revised", "")))
                .isInstanceOf(ApiException.class)
                .extracting("status").isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    void deleteFlushesVersionedEntityAndHandlesMissingOrStaleTasks() {
        when(taskRepository.findById(taskId)).thenReturn(Optional.of(existingTask));
        when(taskRepository.deleteIfVersionMatches(taskId, 3)).thenReturn(1);
        taskService.deleteTask(taskId, 3);
        verify(taskRepository).deleteIfVersionMatches(taskId, 3);

        assertThatThrownBy(() -> taskService.deleteTask(taskId, 1))
                .isInstanceOf(ApiException.class)
                .extracting("status").isEqualTo(HttpStatus.PRECONDITION_FAILED);

        when(taskRepository.findById(taskId)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> taskService.deleteTask(taskId, 3))
                .isInstanceOf(ApiException.class)
                .extracting("status").isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    void deleteMapsConcurrentVersionChange() {
        when(taskRepository.findById(taskId)).thenReturn(Optional.of(existingTask));
        when(taskRepository.deleteIfVersionMatches(taskId, 3)).thenReturn(0);

        assertThatThrownBy(() -> taskService.deleteTask(taskId, 3))
                .isInstanceOf(ApiException.class)
                .extracting("status").isEqualTo(HttpStatus.PRECONDITION_FAILED);
    }

    private TaskEntity entity(UUID id, int version, String title, String description) {
        TaskEntity entity = new TaskEntity(title, description);
        ReflectionTestUtils.setField(entity, "id", id);
        ReflectionTestUtils.setField(entity, "version", version);
        return entity;
    }

    private TaskResponse response(UUID id, int version, String title, String description) {
        return new TaskResponse(id, title, description, version);
    }
}
