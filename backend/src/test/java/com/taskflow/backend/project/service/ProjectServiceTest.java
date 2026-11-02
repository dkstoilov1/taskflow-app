package com.taskflow.backend.project.service;

import com.taskflow.backend.project.api.ProjectRequest;
import com.taskflow.backend.project.api.ProjectResponse;
import com.taskflow.backend.project.persistence.ProjectEntity;
import com.taskflow.backend.project.persistence.ProjectRepository;
import com.taskflow.backend.shared.api.ApiException;
import com.taskflow.backend.task.persistence.TaskRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for project validation and atomic lifecycle operations.
 */
@ExtendWith(MockitoExtension.class)
class ProjectServiceTest {

    @Mock
    private ProjectRepository projectRepository;

    @Mock
    private TaskRepository taskRepository;

    @InjectMocks
    private ProjectService projectService;

    private UUID id;
    private ProjectEntity project;

    @BeforeEach
    void setUp() {
        id = UUID.randomUUID();
        project = new ProjectEntity("Planning");
        ReflectionTestUtils.setField(project, "id", id);
        ReflectionTestUtils.setField(project, "version", 4);
    }

    @Test
    void listsAndReadsProjects() {
        when(projectRepository.findAllInDisplayOrder()).thenReturn(List.of(project));
        when(projectRepository.findById(id)).thenReturn(Optional.of(project));

        assertThat(projectService.listProjects()).containsExactly(new ProjectResponse(id, "Planning", 4));
        assertThat(projectService.getProject(id)).isEqualTo(new ProjectResponse(id, "Planning", 4));
    }

    @Test
    void missingProjectReadsAndStaleWritesReturnNotFoundOrPreconditionFailure() {
        when(projectRepository.findById(id)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> projectService.getProject(id))
                .isInstanceOf(ApiException.class)
                .extracting("status").isEqualTo(HttpStatus.NOT_FOUND);

        when(projectRepository.findByIdForUpdate(id)).thenReturn(Optional.of(project));
        assertThatThrownBy(() -> projectService.updateProject(id, 3, new ProjectRequest("Changed")))
                .isInstanceOf(ApiException.class)
                .extracting("status").isEqualTo(HttpStatus.PRECONDITION_FAILED);
        assertThatThrownBy(() -> projectService.deleteProject(id, 3))
                .isInstanceOf(ApiException.class)
                .extracting("status").isEqualTo(HttpStatus.PRECONDITION_FAILED);
    }

    @Test
    void createsNormalizedProjectAndMapsNameConflicts() {
        when(projectRepository.countByNameIgnoreCase("Planning")).thenReturn(0L);
        when(projectRepository.saveAndFlush(any(ProjectEntity.class))).thenAnswer(invocation -> {
            ProjectEntity saved = invocation.getArgument(0);
            ReflectionTestUtils.setField(saved, "id", id);
            return saved;
        });
        assertThat(projectService.createProject(new ProjectRequest(" Planning ")))
                .isEqualTo(new ProjectResponse(id, "Planning", 0));

        when(projectRepository.countByNameIgnoreCase("planning")).thenReturn(1L);
        assertConflict(() -> projectService.createProject(new ProjectRequest("planning")));

        when(projectRepository.countByNameIgnoreCase("Race")).thenReturn(0L);
        when(projectRepository.saveAndFlush(any(ProjectEntity.class))).thenThrow(new DataIntegrityViolationException("duplicate"));
        assertConflict(() -> projectService.createProject(new ProjectRequest("Race")));
    }

    @Test
    void renamesWithVersionAndRejectsDuplicateOrConcurrentNameConflict() {
        when(projectRepository.findByIdForUpdate(id)).thenReturn(Optional.of(project));
        when(projectRepository.countByNameIgnoreCaseAndIdNot("New name", id)).thenReturn(0L);
        when(projectRepository.renameIfVersionMatches(id, 4, "New name")).thenReturn(1);
        assertThat(projectService.updateProject(id, 4, new ProjectRequest("New name")))
                .isEqualTo(new ProjectResponse(id, "New name", 5));

        when(projectRepository.countByNameIgnoreCaseAndIdNot("Taken", id)).thenReturn(1L);
        assertConflict(() -> projectService.updateProject(id, 4, new ProjectRequest("Taken")));

        when(projectRepository.countByNameIgnoreCaseAndIdNot("Collision", id)).thenReturn(0L);
        when(projectRepository.renameIfVersionMatches(id, 4, "Collision"))
                .thenThrow(new DataIntegrityViolationException("unique name"));
        assertConflict(() -> projectService.updateProject(id, 4, new ProjectRequest("Collision")));
    }

    @Test
    void deletionUnassignsTasksBeforeDeletingProject() {
        when(projectRepository.findByIdForUpdate(id)).thenReturn(Optional.of(project));
        when(taskRepository.unassignTasksFromProject(id)).thenReturn(2);
        when(projectRepository.deleteIfVersionMatches(id, 4)).thenReturn(1);

        projectService.deleteProject(id, 4);

        verify(taskRepository).unassignTasksFromProject(id);
        verify(projectRepository).deleteIfVersionMatches(id, 4);
    }

    @Test
    void deletionFailureStillMapsToStaleVersion() {
        when(projectRepository.findByIdForUpdate(id)).thenReturn(Optional.of(project));
        when(projectRepository.deleteIfVersionMatches(id, 4)).thenReturn(0);
        assertThatThrownBy(() -> projectService.deleteProject(id, 4))
                .isInstanceOf(ApiException.class)
                .extracting("status").isEqualTo(HttpStatus.PRECONDITION_FAILED);
    }

    private void assertConflict(Runnable action) {
        assertThatThrownBy(action::run)
                .isInstanceOf(ApiException.class)
                .satisfies(exception -> {
                    ApiException apiException = (ApiException) exception;
                    assertThat(apiException.status()).isEqualTo(HttpStatus.CONFLICT);
                    assertThat(apiException.fieldErrors()).containsKey("name");
                });
    }
}
