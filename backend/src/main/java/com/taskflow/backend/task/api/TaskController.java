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
import java.net.URI;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
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

    private static final Pattern CANONICAL_UUID = Pattern.compile(
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
     * @return requested page and total counts
     */
    @Operation(summary = "List and search tasks", description = "Returns a bounded newest-first page; q is a case-insensitive literal substring.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Task page returned.", content = @Content(
                mediaType = "application/json", schema = @Schema(implementation = TaskPageResponse.class))),
        @ApiResponse(responseCode = "400", description = "Invalid page, size, or search text.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetail.class))),
        @ApiResponse(responseCode = "403", description = "Request Host is not local.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetail.class))),
        @ApiResponse(responseCode = "500", description = "Unexpected server failure.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetail.class))),
        @ApiResponse(responseCode = "503", description = "Task storage unavailable.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetail.class)))
    })
    @GetMapping
    public TaskPageResponse listTasks(
            @Parameter(description = "Zero-based page index.", example = "0")
            @RequestParam(name = "page", defaultValue = "0") @Min(0) int page,
            @Parameter(description = "Page size, from 1 through 100.", example = "20")
            @RequestParam(name = "size", defaultValue = "20") @Min(1) @Max(100) int size,
            @Parameter(description = "Optional trimmed literal search, at most 200 Unicode code points.", example = "release")
            @RequestParam(name = "q", required = false) @CodePointLength(max = 200, trim = true) String q) {
        return taskService.listTasks(page, size, q);
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
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetail.class))),
        @ApiResponse(responseCode = "403", description = "Request Host is not local.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetail.class))),
        @ApiResponse(responseCode = "404", description = "Task does not exist.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetail.class))),
        @ApiResponse(responseCode = "500", description = "Unexpected server failure.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetail.class))),
        @ApiResponse(responseCode = "503", description = "Task storage unavailable.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetail.class)))
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
    @Operation(summary = "Create a task", description = "Stores a new task after title and description validation.")
    @ApiResponses({
        @ApiResponse(responseCode = "201", description = "Task created.", headers = {
            @Header(name = "Location", description = "Canonical path of the new task.", schema = @Schema(type = "string")),
            @Header(name = "ETag", description = "Strong quoted decimal version.", schema = @Schema(type = "string", example = "\"0\""))
        }, content = @Content(mediaType = "application/json", schema = @Schema(implementation = TaskResponse.class))),
        @ApiResponse(responseCode = "400", description = "Invalid JSON or task fields.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetail.class))),
        @ApiResponse(responseCode = "403", description = "Browser origin or request Host is not allowed.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetail.class))),
        @ApiResponse(responseCode = "500", description = "Unexpected server failure.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetail.class))),
        @ApiResponse(responseCode = "503", description = "Task storage unavailable.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetail.class)))
    })
    @PostMapping
    public ResponseEntity<TaskResponse> createTask(@Valid @RequestBody TaskRequest request) {
        TaskResponse created = taskService.createTask(request);
        return ResponseEntity.created(URI.create("/api/tasks/" + created.id()))
                .eTag(etag(created.version()))
                .body(created);
    }

    /**
     * Replaces both editable fields using the supplied current strong ETag.
     *
     * @param id canonical task UUID path text
     * @param ifMatch optional raw If-Match header parsed as a required precondition
     * @param request validated replacement title and description
     * @return updated task and its new strong ETag
     */
    @Operation(summary = "Replace task fields", description = "Atomically replaces title and description only when If-Match is current.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Task replaced.", headers = @Header(
                name = "ETag", description = "Strong quoted decimal version after replacement.", schema = @Schema(type = "string")),
                content = @Content(mediaType = "application/json", schema = @Schema(implementation = TaskResponse.class))),
        @ApiResponse(responseCode = "400", description = "Malformed or noncanonical UUID, If-Match, JSON, or task fields.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetail.class))),
        @ApiResponse(responseCode = "403", description = "Browser origin or request Host is not allowed.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetail.class))),
        @ApiResponse(responseCode = "404", description = "Task does not exist.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetail.class))),
        @ApiResponse(responseCode = "412", description = "Version is stale; reload the task before retrying.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetail.class))),
        @ApiResponse(responseCode = "428", description = "If-Match is required.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetail.class))),
        @ApiResponse(responseCode = "500", description = "Unexpected server failure.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetail.class))),
        @ApiResponse(responseCode = "503", description = "Task storage unavailable.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetail.class)))
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
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetail.class))),
        @ApiResponse(responseCode = "403", description = "Browser origin or request Host is not allowed.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetail.class))),
        @ApiResponse(responseCode = "404", description = "Task does not exist.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetail.class))),
        @ApiResponse(responseCode = "412", description = "Version is stale; task was not deleted.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetail.class))),
        @ApiResponse(responseCode = "428", description = "If-Match is required.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetail.class))),
        @ApiResponse(responseCode = "500", description = "Unexpected server failure.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetail.class))),
        @ApiResponse(responseCode = "503", description = "Task storage unavailable.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetail.class)))
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
