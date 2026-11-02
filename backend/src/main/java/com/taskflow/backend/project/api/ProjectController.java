package com.taskflow.backend.project.api;

import com.taskflow.backend.shared.api.ApiException;
import com.taskflow.backend.project.service.ProjectService;
import com.taskflow.backend.task.service.IfMatchVersion;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.enums.ParameterIn;
import io.swagger.v3.oas.annotations.headers.Header;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.net.URI;
import java.util.UUID;
import java.util.regex.Pattern;
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
import org.springframework.web.bind.annotation.RestController;

/**
 * HTTP endpoints for project lifecycle and task grouping.
 */
@RestController
@RequestMapping("/api/projects")
@Tag(name = "Projects", description = "Create, list, rename, read, and delete task projects.")
public class ProjectController {

    private static final Pattern CANONICAL_UUID = Pattern.compile(
            "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");

    private final ProjectService projectService;

    /**
     * Creates the project HTTP controller.
     *
     * @param projectService transactional project use cases
     */
    public ProjectController(ProjectService projectService) {
        this.projectService = projectService;
    }

    /**
     * Lists every project in case-insensitive name order.
     *
     * @return all projects, including projects without tasks
     */
    @Operation(summary = "List projects", description = "Returns all projects in case-insensitive name and ID order.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Projects returned.", content = @Content(
                mediaType = "application/json", array = @io.swagger.v3.oas.annotations.media.ArraySchema(
                        schema = @Schema(implementation = ProjectResponse.class)))),
        @ApiResponse(responseCode = "403", description = "Request Host is not local.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "500", description = "Unexpected server failure.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "503", description = "Project storage unavailable.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class)))
    })
    @GetMapping
    public java.util.List<ProjectResponse> listProjects() {
        return projectService.listProjects();
    }

    /**
     * Reads one project and returns its strong version ETag.
     *
     * @param id canonical UUID path text
     * @return project body and ETag
     */
    @Operation(summary = "Read a project", description = "Returns the project and its authoritative strong ETag.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Project returned.", headers = @Header(
                name = "ETag", description = "Strong quoted decimal version.", schema = @Schema(type = "string", example = "\"0\"")),
                content = @Content(mediaType = "application/json", schema = @Schema(implementation = ProjectResponse.class))),
        @ApiResponse(responseCode = "400", description = "Malformed project UUID.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "403", description = "Request Host is not local.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "404", description = "Project does not exist.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "500", description = "Unexpected server failure.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "503", description = "Project storage unavailable.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class)))
    })
    @GetMapping("/{id}")
    public ResponseEntity<ProjectResponse> getProject(
            @Parameter(in = ParameterIn.PATH, description = "Canonical 8-4-4-4-12 UUID.")
            @PathVariable("id") String id) {
        ProjectResponse project = projectService.getProject(parseProjectId(id));
        return ResponseEntity.ok().eTag(etag(project.version())).body(project);
    }

    /**
     * Creates a project with an exclusive normalized name.
     *
     * @param request validated project name
     * @return created project with Location and ETag
     */
    @Operation(summary = "Create a project", description = "Creates a project with a case-insensitively unique name.")
    @ApiResponses({
        @ApiResponse(responseCode = "201", description = "Project created.", headers = {
            @Header(name = "Location", description = "Canonical path of the new project.", schema = @Schema(type = "string")),
            @Header(name = "ETag", description = "Strong quoted decimal version.", schema = @Schema(type = "string", example = "\"0\""))
        }, content = @Content(mediaType = "application/json", schema = @Schema(implementation = ProjectResponse.class))),
        @ApiResponse(responseCode = "400", description = "Invalid project name or JSON.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "403", description = "Browser origin or Host is not allowed.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "409", description = "Case-insensitive duplicate project name.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "500", description = "Unexpected server failure.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "503", description = "Project storage unavailable.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class)))
    })
    @PostMapping
    public ResponseEntity<ProjectResponse> createProject(@Valid @RequestBody ProjectRequest request) {
        ProjectResponse created = projectService.createProject(request);
        return ResponseEntity.created(URI.create("/api/projects/" + created.id()))
                .eTag(etag(created.version()))
                .body(created);
    }

    /**
     * Replaces a project name only when If-Match contains the latest ETag.
     *
     * @param id canonical UUID path text
     * @param ifMatch optional raw If-Match header
     * @param request validated replacement project name
     * @return updated project with a new ETag
     */
    @Operation(summary = "Rename a project", description = "Replaces the name when the strong If-Match version is current.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Project renamed.", headers = @Header(
                name = "ETag", description = "New strong quoted decimal version.", schema = @Schema(type = "string")),
                content = @Content(mediaType = "application/json", schema = @Schema(implementation = ProjectResponse.class))),
        @ApiResponse(responseCode = "400", description = "Malformed UUID, If-Match, JSON, or name.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "403", description = "Browser origin or Host is not allowed.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "404", description = "Project does not exist.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "409", description = "Case-insensitive duplicate project name.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "412", description = "Project version is stale; reload it.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "428", description = "If-Match is required.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "500", description = "Unexpected server failure.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "503", description = "Project storage unavailable.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class)))
    })
    @PutMapping("/{id}")
    public ResponseEntity<ProjectResponse> updateProject(
            @Parameter(in = ParameterIn.PATH, description = "Canonical 8-4-4-4-12 UUID.")
            @PathVariable("id") String id,
            @Parameter(in = ParameterIn.HEADER, name = "If-Match", description = "Latest strong project ETag.")
            @RequestHeader(name = "If-Match", required = false) String ifMatch,
            @Valid @RequestBody ProjectRequest request) {
        ProjectResponse updated = projectService.updateProject(
                parseProjectId(id), IfMatchVersion.parse(ifMatch), request);
        return ResponseEntity.ok().eTag(etag(updated.version())).body(updated);
    }

    /**
     * Deletes a project and atomically unassigns its tasks.
     *
     * @param id canonical UUID path text
     * @param ifMatch optional raw If-Match header
     * @return empty 204 response after deletion
     */
    @Operation(summary = "Delete a project", description = "Atomically unassigns tasks and advances their versions before deletion.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "Project deleted; tasks remain unassigned."),
        @ApiResponse(responseCode = "400", description = "Malformed UUID or If-Match.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "403", description = "Browser origin or Host is not allowed.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "404", description = "Project does not exist.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "412", description = "Project version is stale; nothing was deleted.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "428", description = "If-Match is required.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "500", description = "Unexpected server failure.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class))),
        @ApiResponse(responseCode = "503", description = "Project storage unavailable.", content = @Content(
                mediaType = "application/problem+json", schema = @Schema(implementation = ProblemDetailsResponse.class)))
    })
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteProject(
            @Parameter(in = ParameterIn.PATH, description = "Canonical 8-4-4-4-12 UUID.")
            @PathVariable("id") String id,
            @Parameter(in = ParameterIn.HEADER, name = "If-Match", description = "Latest strong project ETag.")
            @RequestHeader(name = "If-Match", required = false) String ifMatch) {
        projectService.deleteProject(parseProjectId(id), IfMatchVersion.parse(ifMatch));
        return ResponseEntity.noContent().build();
    }

    private static UUID parseProjectId(String id) {
        if (!CANONICAL_UUID.matcher(id).matches()) {
            throw ApiException.invalidProjectId();
        }
        return UUID.fromString(id);
    }

    private static String etag(int version) {
        return "\"" + version + "\"";
    }
}
