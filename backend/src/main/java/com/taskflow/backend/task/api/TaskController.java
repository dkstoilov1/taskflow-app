package com.taskflow.backend.task.api;

import com.taskflow.backend.shared.api.ApiException;
import com.taskflow.backend.shared.validation.CodePointLength;
import com.taskflow.backend.task.service.IfMatchVersion;
import com.taskflow.backend.task.service.TaskService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.enums.ParameterIn;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.headers.Header;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.net.URI;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import com.taskflow.backend.shared.api.ProblemDetailsResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * HTTP endpoints for paginated task management.
 */
@RestController
@RequestMapping("/api/tasks")
@Tag(name = "Tasks", description = "Create, search, read, replace, and delete TaskFlow tasks.")
public class TaskController {

    private static final java.util.regex.Pattern CANONICAL_UUID = java.util.regex.Pattern.compile(
            "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");

    private final TaskService taskService;

    /**
     * Creates the task API controller.
     *
     * @param taskService transactional task use cases
     */
    public TaskController(TaskService taskService) {
        this.taskService = taskService;
    }

    /**
     * Lists tasks in deterministic newest-first pages, optionally matching literal text.
     *
     * @param page zero-based page index
     * @param size page size from 1 through 100
     * @param q optional search text, trimmed before matching
     * @param view task view
     * @param status optional status filter
     * @param priority optional priority filter
     * @param due optional date filter
     * @param project optional project UUID or unassigned selector
     * @param sort allowlisted sort key
     * @param timeZone calendar timezone for relative dates
     * @return requested page and total counts
     */
    @Operation(summary = "List and search tasks", description = "Returns a bounded newest-first page; q is a case-insensitive literal substring.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Task page returned.", content = @Content(
                mediaType = "application/json", schema = @Schema(implementation = TaskPageResponse.class))),
        @ApiResponse(responseCode = "400", description = "Invalid page, size, or search text.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "403", description = "Request Host is not local.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "500", description = "Unexpected server failure.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "503", description = "Task storage unavailable.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class)))
    })
    @GetMapping
    public TaskPageResponse listTasks(
            @Parameter(description = "Zero-based page index.", example = "0")
            @RequestParam(name = "page", defaultValue = "0") @Min(0) int page,
            @Parameter(description = "Page size, from 1 through 100.", example = "20")
            @RequestParam(name = "size", defaultValue = "20") @Min(1) @Max(100) int size,
            @Parameter(description = "Optional trimmed literal search, at most 200 Unicode code points.", example = "release")
            @RequestParam(name = "q", required = false) @CodePointLength(max = 200, trim = true) String q,
            @Parameter(description = "View filter.", example = "all")
            @RequestParam(name = "view", defaultValue = "all") @Pattern(regexp = "all|today|upcoming|completed") String view,
            @Parameter(description = "Optional status filter.", example = "active")
            @RequestParam(name = "status", required = false) @Pattern(regexp = "active|completed") String status,
            @Parameter(description = "Optional priority filter.", example = "high")
            @RequestParam(name = "priority", required = false) @Pattern(regexp = "low|medium|high") String priority,
            @Parameter(description = "Optional due-date filter.", example = "this_week")
            @RequestParam(name = "due", required = false) @Pattern(regexp = "today|this_week|overdue") String due,
            @Parameter(description = "Optional canonical project UUID or unassigned.", example = "unassigned")
            @RequestParam(name = "project", required = false) @Size(max = 45)
            @Pattern(regexp = "(?i)(unassigned|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})")
            String project,
            @Parameter(description = "Allowlisted ordering.", example = "created_desc")
            @RequestParam(name = "sort", defaultValue = "created_desc")
            @Pattern(regexp = "created_desc|due_asc|due_desc|priority_desc|priority_asc|status_asc|status_desc")
            String sort,
            @Parameter(description = "IANA timezone for calendar calculations.", example = "Europe/Paris")
            @RequestParam(name = "timeZone", defaultValue = "UTC") @Size(max = 100) String timeZone) {
        return taskService.listTasks(page, size, q, view, status, priority, due, project, sort, timeZone);
    }

    /**
     * Reads a task and returns its current strong version ETag.
     *
     * @param id canonical task UUID path text
     * @return task body and quoted version ETag
     */
    @Operation(summary = "Read a task", description = "Returns the task and its authoritative strong version ETag.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Task returned.", headers = @Header(
                name = "ETag", description = "Strong quoted decimal version.", schema = @Schema(type = "string", example = "\"0\"")),
                content = @Content(mediaType = "application/json", schema = @Schema(implementation = TaskResponse.class))),
        @ApiResponse(responseCode = "400", description = "Malformed or noncanonical UUID.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "403", description = "Request Host is not local.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "404", description = "Task does not exist.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "500", description = "Unexpected server failure.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "503", description = "Task storage unavailable.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class)))
    })
    @GetMapping("/{id}")
    public ResponseEntity<TaskResponse> getTask(
            @Parameter(in = ParameterIn.PATH, description = "Canonical 8-4-4-4-12 UUID.", schema = @Schema(type = "string", format = "uuid"))
            @PathVariable("id") String id) {
        TaskResponse task = taskService.getTask(parseTaskId(id));
        return ResponseEntity.ok().eTag(etag(task.version())).body(task);
    }

    /**
     * Creates a task with normalized editable fields.
     *
     * @param request validated task title and description
     * @return created task with Location and strong ETag headers
     */
    @Operation(summary = "Create a task", description = "Stores a task, applying documented defaults to omitted optional fields.")
    @ApiResponses({
        @ApiResponse(responseCode = "201", description = "Task created.", headers = {
            @Header(name = "Location", description = "Canonical path of the new task.", schema = @Schema(type = "string")),
            @Header(name = "ETag", description = "Strong quoted decimal version.", schema = @Schema(type = "string", example = "\"0\""))
        }, content = @Content(mediaType = "application/json", schema = @Schema(implementation = TaskResponse.class))),
        @ApiResponse(responseCode = "400", description = "Invalid JSON or task fields.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "403", description = "Browser origin or request Host is not allowed.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "500", description = "Unexpected server failure.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "503", description = "Task storage unavailable.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class)))
    })
    @PostMapping
    public ResponseEntity<TaskResponse> createTask(@Valid @RequestBody TaskRequest request) {
        TaskResponse created = taskService.createTask(request);
        return ResponseEntity.created(URI.create("/api/tasks/" + created.id()))
                .eTag(etag(created.version()))
                .body(created);
    }

    /**
     * Replaces all editable fields using the supplied current strong ETag.
     *
     * @param id canonical task UUID path text
     * @param ifMatch optional raw If-Match header parsed as a required precondition
     * @param request validated replacement task fields
     * @return updated task and its new strong ETag
     */
    @Operation(summary = "Replace task fields", description = "Atomically replaces editable fields only when If-Match is current.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Task replaced.", headers = @Header(
                name = "ETag", description = "Strong quoted decimal version after replacement.", schema = @Schema(type = "string")),
                content = @Content(mediaType = "application/json", schema = @Schema(implementation = TaskResponse.class))),
        @ApiResponse(responseCode = "400", description = "Malformed or noncanonical UUID, If-Match, JSON, or task fields.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "403", description = "Browser origin or request Host is not allowed.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "404", description = "Task does not exist.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "412", description = "Version is stale; reload the task before retrying.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "428", description = "If-Match is required.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "500", description = "Unexpected server failure.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "503", description = "Task storage unavailable.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class)))
    })
    @PutMapping("/{id}")
    public ResponseEntity<TaskResponse> updateTask(
            @Parameter(in = ParameterIn.PATH, description = "Canonical 8-4-4-4-12 UUID.", schema = @Schema(type = "string", format = "uuid"))
            @PathVariable("id") String id,
            @Parameter(in = ParameterIn.HEADER, name = "If-Match", description = "Latest strong task ETag, for example \"0\".")
            @RequestHeader(name = "If-Match", required = false) String ifMatch,
            @Valid @RequestBody TaskRequest request) {
        TaskResponse updated = taskService.updateTask(parseTaskId(id), IfMatchVersion.parse(ifMatch), request);
        return ResponseEntity.ok().eTag(etag(updated.version())).body(updated);
    }

    /**
     * Changes only task status using the supplied current strong ETag.
     *
     * @param id canonical task UUID path text
     * @param ifMatch optional raw If-Match header parsed as a required precondition
     * @param request validated status value
     * @return updated task and its new strong ETag
     */
    @Operation(summary = "Complete or reopen a task", description = "Changes status only and preserves unrelated fields.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Status changed.", headers = @Header(
                name = "ETag", description = "Strong quoted decimal version.", schema = @Schema(type = "string")),
                content = @Content(mediaType = "application/json", schema = @Schema(implementation = TaskResponse.class))),
        @ApiResponse(responseCode = "400", description = "Malformed ID, header, JSON, or status.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "403", description = "Browser origin or Host is not allowed.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "404", description = "Task does not exist.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "412", description = "Version is stale; reload the task.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "428", description = "If-Match is required.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "500", description = "Unexpected server failure.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "503", description = "Task storage unavailable.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class)))
    })
    @org.springframework.web.bind.annotation.PatchMapping("/{id}/status")
    public ResponseEntity<TaskResponse> changeStatus(
            @Parameter(in = ParameterIn.PATH, description = "Canonical task UUID.", schema = @Schema(type = "string", format = "uuid"))
            @PathVariable("id") String id,
            @Parameter(in = ParameterIn.HEADER, name = "If-Match", description = "Latest strong task ETag.")
            @RequestHeader(name = "If-Match", required = false) String ifMatch,
            @Valid @RequestBody TaskStatusRequest request) {
        TaskResponse updated = taskService.changeStatus(
                parseTaskId(id), IfMatchVersion.parse(ifMatch), request.status());
        return ResponseEntity.ok().eTag(etag(updated.version())).body(updated);
    }

    /**
     * Permanently deletes a task only when its supplied strong ETag is current.
     *
     * @param id canonical task UUID path text
     * @param ifMatch optional raw If-Match header parsed as a required precondition
     * @return empty 204 response after deletion
     */
    @Operation(summary = "Delete a task", description = "Permanently deletes a task only when If-Match is current.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "Task deleted; response has no body."),
        @ApiResponse(responseCode = "400", description = "Malformed or noncanonical UUID or If-Match.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "403", description = "Browser origin or request Host is not allowed.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "404", description = "Task does not exist.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "412", description = "Version is stale; task was not deleted.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "428", description = "If-Match is required.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "500", description = "Unexpected server failure.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "503", description = "Task storage unavailable.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class)))
    })
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteTask(
            @Parameter(in = ParameterIn.PATH, description = "Canonical 8-4-4-4-12 UUID.", schema = @Schema(type = "string", format = "uuid"))
            @PathVariable("id") String id,
            @Parameter(in = ParameterIn.HEADER, name = "If-Match", description = "Latest strong task ETag.")
            @RequestHeader(name = "If-Match", required = false) String ifMatch) {
        taskService.deleteTask(parseTaskId(id), IfMatchVersion.parse(ifMatch));
        return ResponseEntity.noContent().build();
    }

    private static UUID parseTaskId(String id) {
        if (!CANONICAL_UUID.matcher(id).matches()) {
            throw ApiException.invalidTaskId();
        }
        return UUID.fromString(id);
    }

    private static String etag(int version) {
        return "\"" + version + "\"";
    }
}
