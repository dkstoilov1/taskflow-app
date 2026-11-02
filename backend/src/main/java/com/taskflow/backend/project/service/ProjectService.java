package com.taskflow.backend.project.service;

import com.taskflow.backend.project.api.ProjectRequest;
import com.taskflow.backend.project.api.ProjectResponse;
import com.taskflow.backend.project.persistence.ProjectEntity;
import com.taskflow.backend.project.persistence.ProjectRepository;
import com.taskflow.backend.shared.api.ApiException;
import com.taskflow.backend.task.persistence.TaskRepository;
import java.util.List;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Transactional project operations with optimistic concurrency and atomic task unassignment.
 */
@Service
public class ProjectService {

    private final ProjectRepository projectRepository;
    private final TaskRepository taskRepository;

    /**
     * Creates project use cases with both sides of the assignment relationship.
     *
     * @param projectRepository project persistence boundary
     * @param taskRepository task persistence boundary used for atomic unassignment
     */
    public ProjectService(ProjectRepository projectRepository, TaskRepository taskRepository) {
        this.projectRepository = projectRepository;
        this.taskRepository = taskRepository;
    }

    /**
     * Returns all projects, including empty ones, in case-insensitive name order.
     *
     * @return ordered project representations
     */
    @Transactional(readOnly = true)
    public List<ProjectResponse> listProjects() {
        return projectRepository.findAllInDisplayOrder().stream().map(ProjectService::toResponse).toList();
    }

    /**
     * Retrieves a project or reports that it does not exist.
     *
     * @param id project UUID
     * @return current project representation
     * @throws ApiException with 404 when no project exists
     */
    @Transactional(readOnly = true)
    public ProjectResponse getProject(UUID id) {
        return toResponse(findProject(id));
    }

    /**
     * Creates a project with a case-insensitively unique normalized name.
     *
     * @param request validated project fields
     * @return created project
     * @throws ApiException with 409 when the name is already in use
     */
    @Transactional
    public ProjectResponse createProject(ProjectRequest request) {
        ensureUniqueName(request.name(), null);
        try {
            return toResponse(projectRepository.saveAndFlush(new ProjectEntity(request.name())));
        } catch (DataIntegrityViolationException exception) {
            throw ApiException.duplicateProjectName();
        }
    }

    /**
     * Replaces a project name only when its strong ETag version remains current.
     *
     * @param id project UUID
     * @param expectedVersion version supplied by If-Match
     * @param request validated project fields
     * @return project with incremented version
     * @throws ApiException with 404, 409, or 412 for missing, duplicate, or stale data
     */
    @Transactional
    public ProjectResponse updateProject(UUID id, int expectedVersion, ProjectRequest request) {
        ProjectEntity project = findLockedProject(id);
        ensureCurrentVersion(project, expectedVersion);
        ensureUniqueName(request.name(), id);
        try {
            int updated = projectRepository.renameIfVersionMatches(id, expectedVersion, request.name());
            if (updated != 1) {
                throw ApiException.staleTaskVersion();
            }
        } catch (DataIntegrityViolationException exception) {
            throw ApiException.duplicateProjectName();
        }
        return new ProjectResponse(id, request.name(), expectedVersion + 1);
    }

    /**
     * Atomically detaches tasks, advances their versions, and deletes the current project.
     *
     * @param id project UUID
     * @param expectedVersion version supplied by If-Match
     * @throws ApiException with 404 for a missing project or 412 for a stale version
     */
    @Transactional
    public void deleteProject(UUID id, int expectedVersion) {
        ProjectEntity project = findLockedProject(id);
        ensureCurrentVersion(project, expectedVersion);
        taskRepository.unassignTasksFromProject(id);
        int deleted = projectRepository.deleteIfVersionMatches(id, expectedVersion);
        if (deleted != 1) {
            throw ApiException.staleTaskVersion();
        }
    }

    private ProjectEntity findProject(UUID id) {
        return projectRepository.findById(id).orElseThrow(ApiException::projectNotFound);
    }

    private ProjectEntity findLockedProject(UUID id) {
        return projectRepository.findByIdForUpdate(id).orElseThrow(ApiException::projectNotFound);
    }

    private void ensureUniqueName(String name, UUID excludedId) {
        long matches = excludedId == null
                ? projectRepository.countByNameIgnoreCase(name)
                : projectRepository.countByNameIgnoreCaseAndIdNot(name, excludedId);
        if (matches > 0) {
            throw ApiException.duplicateProjectName();
        }
    }

    private static void ensureCurrentVersion(ProjectEntity project, int expectedVersion) {
        if (project.getVersion() != expectedVersion) {
            throw ApiException.staleTaskVersion();
        }
    }

    private static ProjectResponse toResponse(ProjectEntity project) {
        return new ProjectResponse(project.getId(), project.getName(), project.getVersion());
    }
}
