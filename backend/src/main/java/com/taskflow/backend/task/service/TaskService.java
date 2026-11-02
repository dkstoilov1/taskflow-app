package com.taskflow.backend.task.service;

import com.taskflow.backend.shared.api.ApiException;
import com.taskflow.backend.shared.text.UnicodeText;
import com.taskflow.backend.task.api.TaskPageResponse;
import com.taskflow.backend.task.api.TaskRequest;
import com.taskflow.backend.task.api.TaskResponse;
import com.taskflow.backend.task.persistence.TaskEntity;
import com.taskflow.backend.task.persistence.TaskRepository;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Transactional task use cases for the REST boundary.
 */
@Service
public class TaskService {

    private static final Sort TASK_ORDER = Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id"));

    private final TaskRepository taskRepository;

    /**
     * Creates the service using the task repository boundary.
     *
     * @param taskRepository repository for task data
     */
    public TaskService(TaskRepository taskRepository) {
        this.taskRepository = taskRepository;
    }

    /**
     * Lists a bounded page in newest-first order and optionally searches task text literally.
     *
     * @param page zero-based page index
     * @param size page size from 1 through 100
     * @param query optional search text, trimmed before use
     * @return page items and pagination metadata
     */
    @Transactional(readOnly = true)
    public TaskPageResponse listTasks(int page, int size, String query) {
        Pageable pageable = PageRequest.of(page, size, TASK_ORDER);
        String normalizedQuery = UnicodeText.trim(query);
        Page<TaskEntity> result = normalizedQuery == null || normalizedQuery.isEmpty()
                ? taskRepository.listAllTasks(pageable)
                : taskRepository.searchLiteral(normalizedQuery, pageable);
        List<TaskResponse> items = result.getContent().stream().map(TaskService::toResponse).toList();
        return new TaskPageResponse(items, page, size, result.getTotalElements(), result.getTotalPages());
    }

    /**
     * Retrieves one task or reports that it does not exist.
     *
     * @param id task UUID
     * @return current task representation
     * @throws ApiException with 404 when no task has this identifier
     */
    @Transactional(readOnly = true)
    public TaskResponse getTask(UUID id) {
        return toResponse(findTask(id));
    }

    /**
     * Persists a new task and returns its generated identity and initial version.
     *
     * @param request validated task fields
     * @return created task representation
     */
    @Transactional
    public TaskResponse createTask(TaskRequest request) {
        TaskEntity entity = new TaskEntity(request.title(), request.description());
        return toResponse(taskRepository.saveAndFlush(entity));
    }

    /**
     * Replaces editable fields only when the supplied version is still current.
     *
     * @param id task UUID
     * @param expectedVersion version supplied by the client's strong ETag
     * @param request validated replacement fields
     * @return updated task with its incremented version
     * @throws ApiException with 404 for a missing task or 412 for a stale version
     */
    @Transactional
    public TaskResponse updateTask(UUID id, int expectedVersion, TaskRequest request) {
        TaskEntity entity = findTask(id);
        ensureCurrentVersion(entity, expectedVersion);
        int updated = taskRepository.updateDetailsIfVersionMatches(
                id, expectedVersion, request.title(), request.description());
        if (updated != 1) {
            throw ApiException.staleTaskVersion();
        }
        return new TaskResponse(id, request.title(), request.description(), expectedVersion + 1);
    }

    /**
     * Permanently deletes a task only when its current version matches the supplied ETag.
     *
     * @param id task UUID
     * @param expectedVersion version supplied by the client's strong ETag
     * @throws ApiException with 404 for a missing task or 412 for a stale version
     */
    @Transactional
    public void deleteTask(UUID id, int expectedVersion) {
        TaskEntity entity = findTask(id);
        ensureCurrentVersion(entity, expectedVersion);
        int deleted = taskRepository.deleteIfVersionMatches(id, expectedVersion);
        if (deleted != 1) {
            throw ApiException.staleTaskVersion();
        }
    }

    private TaskEntity findTask(UUID id) {
        return taskRepository.findById(id).orElseThrow(ApiException::taskNotFound);
    }

    private static void ensureCurrentVersion(TaskEntity entity, int expectedVersion) {
        if (entity.getVersion() != expectedVersion) {
            throw ApiException.staleTaskVersion();
        }
    }

    private static TaskResponse toResponse(TaskEntity entity) {
        return new TaskResponse(entity.getId(), entity.getTitle(), entity.getDescription(), entity.getVersion());
    }
}
