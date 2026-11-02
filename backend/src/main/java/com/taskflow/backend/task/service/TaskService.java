package com.taskflow.backend.task.service;

import com.taskflow.backend.shared.api.ApiException;
import com.taskflow.backend.shared.text.UnicodeText;
import com.taskflow.backend.task.api.TaskPageResponse;
import com.taskflow.backend.task.api.TaskRequest;
import com.taskflow.backend.task.api.TaskResponse;
import com.taskflow.backend.task.persistence.TaskEntity;
import com.taskflow.backend.task.persistence.TaskRepository;
import com.taskflow.backend.task.persistence.TaskSearchCriteria;
import com.taskflow.backend.project.persistence.ProjectRepository;
import java.time.Clock;
import java.time.DateTimeException;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Transactional task use cases for filtering, scheduling, and safe concurrent mutation.
 */
@Service
public class TaskService {

    private static final Set<String> VIEWS = Set.of("all", "today", "upcoming", "completed");
    private static final Set<String> STATUSES = Set.of("active", "completed");
    private static final Set<String> PRIORITIES = Set.of("low", "medium", "high");
    private static final Set<String> DUE_FILTERS = Set.of("today", "this_week", "overdue");
    private static final Set<String> SORTS = Set.of(
            "created_desc", "due_asc", "due_desc", "priority_desc", "priority_asc", "status_asc", "status_desc");

    private final TaskRepository taskRepository;
    private final ProjectRepository projectRepository;
    private final Clock clock;

    /**
     * Creates the task service with repositories and the server clock.
     *
     * @param taskRepository repository for task data and database-side queries
     * @param projectRepository repository for project locking and assignment validation
     * @param clock server clock used for status timestamps and calendar boundaries
     */
    public TaskService(TaskRepository taskRepository, ProjectRepository projectRepository, Clock clock) {
        this.taskRepository = taskRepository;
        this.projectRepository = projectRepository;
        this.clock = clock;
    }

    /**
     * Lists a bounded page after applying validated search, view, filters, and sorting.
     *
     * @param page zero-based page index
     * @param size page size from 1 through 100
     * @param query optional trimmed literal search
     * @param view task view name
     * @param status optional status filter
     * @param priority optional priority filter
     * @param due optional due-date filter
     * @param project optional UUID or unassigned selector
     * @param sort allowlisted sort key
     * @param timeZone calendar timezone for relative filters
     * @return matching task page and total counts
     */
    @Transactional(readOnly = true)
    public TaskPageResponse listTasks(
            int page,
            int size,
            String query,
            String view,
            String status,
            String priority,
            String due,
            String project,
            String sort,
            String timeZone) {
        String normalizedQuery = normalizeQuery(query);
        String selectedView = validateChoice("view", defaultValue(view, "all"), VIEWS);
        String selectedStatus = validateOptionalChoice("status", status, STATUSES);
        String selectedPriority = validateOptionalChoice("priority", priority, PRIORITIES);
        String selectedDue = validateOptionalChoice("due", due, DUE_FILTERS);
        String selectedSort = validateChoice("sort", defaultValue(sort, "created_desc"), SORTS);
        ZoneId zone = parseZone(timeZone);
        LocalDate today = LocalDate.now(clock.withZone(zone));
        LocalDate weekStart = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        LocalDate weekEnd = weekStart.plusDays(6);
        ProjectFilter projectFilter = parseProjectFilter(project);
        TaskSearchCriteria criteria = new TaskSearchCriteria(
                normalizedQuery,
                selectedView,
                selectedStatus,
                selectedPriority,
                selectedDue,
                projectFilter.projectId(),
                projectFilter.unassigned(),
                selectedSort,
                today,
                weekStart,
                weekEnd);
        Pageable pageable = PageRequest.of(page, size);
        Page<TaskEntity> result = taskRepository.searchTasks(criteria, pageable);
        List<TaskResponse> items = result.getContent().stream().map(TaskService::toResponse).toList();
        return new TaskPageResponse(items, page, size, result.getTotalElements(), result.getTotalPages());
    }

    /**
     * Preserves the original title-and-description listing call with contract defaults.
     *
     * @param page zero-based page index
     * @param size page size
     * @param query optional search text
     * @return matching task page
     */
    @Transactional(readOnly = true)
    public TaskPageResponse listTasks(int page, int size, String query) {
        return listTasks(page, size, query, "all", null, null, null, null, "created_desc", "UTC");
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
     * Creates a task and validates any requested project assignment under a row lock.
     *
     * @param request validated task fields
     * @return created task representation
     * @throws ApiException with 400 when the requested project does not exist
     */
    @Transactional
    public TaskResponse createTask(TaskRequest request) {
        UUID projectId = resolveProjectId(request.projectId());
        Instant now = currentTimestamp();
        Instant completedAt = "completed".equals(request.status()) ? now : null;
        TaskEntity entity = new TaskEntity(
                request.title(),
                request.description(),
                parseDueDate(request.dueDate()),
                request.priority(),
                projectId,
                request.status(),
                completedAt,
                now);
        return toResponse(taskRepository.saveAndFlush(entity));
    }

    /**
     * Replaces editable fields only when the supplied version is still current.
     *
     * @param id task UUID
     * @param expectedVersion version supplied by the client's strong ETag
     * @param request validated replacement fields
     * @return updated task with its incremented version
     * @throws ApiException with 404 for a missing task, 400 for an invalid project, or 412 for a stale version
     */
    @Transactional
    public TaskResponse updateTask(UUID id, int expectedVersion, TaskRequest request) {
        TaskEntity entity = findTask(id);
        ensureCurrentVersion(entity, expectedVersion);
        UUID projectId = resolveProjectId(request.projectId());
        Instant now = currentTimestamp();
        String status = request.status();
        Instant completedAt = completionInstant(entity, status, now);
        var dueDate = parseDueDate(request.dueDate());
        int updated = taskRepository.replaceIfVersionMatches(
                id,
                expectedVersion,
                request.title(),
                request.description(),
                dueDate,
                request.priority(),
                projectId,
                status,
                now);
        if (updated != 1) {
            throw ApiException.staleTaskVersion();
        }
        return new TaskResponse(
                id, request.title(), request.description(), expectedVersion + 1, dueDate,
                request.priority(), projectId, status, completedAt);
    }

    /**
     * Changes only status and preserves the task's unrelated editable fields.
     *
     * @param id task UUID
     * @param expectedVersion version supplied by the client's strong ETag
     * @param status requested active or completed status
     * @return updated task with its incremented version
     * @throws ApiException with 404 for a missing task or 412 for a stale version
     */
    @Transactional
    public TaskResponse changeStatus(UUID id, int expectedVersion, String status) {
        TaskEntity entity = findTask(id);
        ensureCurrentVersion(entity, expectedVersion);
        Instant now = currentTimestamp();
        Instant completedAt = completionInstant(entity, status, now);
        int updated = taskRepository.updateStatusIfVersionMatches(id, expectedVersion, status, now);
        if (updated != 1) {
            throw ApiException.staleTaskVersion();
        }
        return new TaskResponse(
                id,
                entity.getTitle(),
                entity.getDescription(),
                expectedVersion + 1,
                entity.getDueDate(),
                entity.getPriority(),
                entity.getProjectId(),
                status,
                completedAt);
    }

    /**
     * Deletes a task only when its current version matches the supplied ETag.
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

    private UUID resolveProjectId(String projectIdText) {
        if (projectIdText == null) {
            return null;
        }
        UUID projectId = UUID.fromString(projectIdText);
        Optional<?> project = projectRepository.findByIdForUpdate(projectId);
        if (project.isEmpty()) {
            throw ApiException.invalidProjectReference();
        }
        return projectId;
    }

    private static Instant completionInstant(TaskEntity existing, String requestedStatus, Instant now) {
        if (!"completed".equals(requestedStatus)) {
            return null;
        }
        if ("completed".equals(existing.getStatus())) {
            return existing.getCompletedAt();
        }
        return now;
    }

    private Instant currentTimestamp() {
        return clock.instant().truncatedTo(ChronoUnit.MICROS);
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
        return new TaskResponse(
                entity.getId(),
                entity.getTitle(),
                entity.getDescription(),
                entity.getVersion(),
                entity.getDueDate(),
                entity.getPriority(),
                entity.getProjectId(),
                entity.getStatus(),
                entity.getCompletedAt());
    }

    private static String normalizeQuery(String query) {
        String normalized = UnicodeText.trim(query);
        if (normalized != null && UnicodeText.codePointLength(normalized) > 200) {
            throw invalidField("q", "must contain at most 200 Unicode code points");
        }
        return normalized == null || normalized.isEmpty() ? null : normalized;
    }

    private static String defaultValue(String value, String defaultValue) {
        return value == null ? defaultValue : value;
    }

    private static String validateChoice(String field, String value, Set<String> choices) {
        if (!choices.contains(value)) {
            throw invalidField(field, "must be one of the documented values");
        }
        return value;
    }

    private static String validateOptionalChoice(String field, String value, Set<String> choices) {
        return value == null ? null : validateChoice(field, value, choices);
    }

    private static ZoneId parseZone(String timeZone) {
        String value = defaultValue(timeZone, "UTC");
        try {
            if (!ZoneId.getAvailableZoneIds().contains(value)) {
                throw invalidField("timeZone", "must be a valid IANA timezone");
            }
            return ZoneId.of(value);
        } catch (DateTimeException exception) {
            throw invalidField("timeZone", "must be a valid IANA timezone");
        }
    }

    private static ProjectFilter parseProjectFilter(String project) {
        if (project == null) {
            return new ProjectFilter(null, false);
        }
        if ("unassigned".equals(project)) {
            return new ProjectFilter(null, true);
        }
        try {
            UUID projectId = UUID.fromString(project);
            if (!projectId.toString().equalsIgnoreCase(project)) {
                throw invalidField("project", "must be a canonical UUID or unassigned");
            }
            return new ProjectFilter(projectId, false);
        } catch (IllegalArgumentException exception) {
            throw invalidField("project", "must be a canonical UUID or unassigned");
        }
    }

    private static LocalDate parseDueDate(String dueDate) {
        if (dueDate == null) {
            return null;
        }
        try {
            LocalDate parsed = LocalDate.parse(dueDate, DateTimeFormatter.ISO_LOCAL_DATE);
            if (parsed.getYear() < 1 || parsed.getYear() > 9999) {
                throw invalidField("dueDate", "year must be between 0001 and 9999");
            }
            return parsed;
        } catch (DateTimeParseException exception) {
            throw invalidField("dueDate", "must be a valid calendar date in YYYY-MM-DD format");
        }
    }

    private static ApiException invalidField(String field, String message) {
        return new ApiException(
                org.springframework.http.HttpStatus.BAD_REQUEST,
                "Invalid request",
                "The request contains invalid values.",
                Map.of(field, List.of(message)));
    }

    private record ProjectFilter(UUID projectId, boolean unassigned) {
    }
}
