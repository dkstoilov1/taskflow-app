package com.taskflow.backend.task.api;

import com.taskflow.backend.task.persistence.TaskEntity;
import com.taskflow.backend.task.persistence.TaskRepository;
import com.taskflow.backend.task.persistence.TaskSearchCriteria;
import com.taskflow.backend.project.persistence.ProjectRepository;
import com.taskflow.backend.project.persistence.ProjectEntity;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.URI;
import java.net.Socket;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Full HTTP integration coverage with persistence replaced by Mockito.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class TaskApiIntegrationTest {
    private final HttpClient httpClient = HttpClient.newHttpClient();

    @LocalServerPort
    private int port;

    @Value("${server.address}")
    private String serverAddress;

    @MockitoBean
    private TaskRepository taskRepository;

    @MockitoBean
    private ProjectRepository projectRepository;

    @Test
    void randomPortServerStartsAndServesTaskPages() throws Exception {
        assertThat(serverAddress).isEqualTo("127.0.0.1");
        UUID id = UUID.randomUUID();
        TaskEntity entity = entity(id, 0, "Startup check", "HTTP request reached the application");
        when(taskRepository.searchTasks(any(TaskSearchCriteria.class), any(Pageable.class)))
                .thenAnswer(invocation -> new PageImpl<>(List.of(entity), invocation.getArgument(1), 1));

        HttpResponse<String> response = send("GET", "/api/tasks?page=0&size=20", null, Map.of());

        assertThat(response.statusCode()).isEqualTo(HttpStatus.OK.value());
        assertThat(response.body()).contains("\"title\":\"Startup check\"", "\"version\":0", "\"totalElements\":1");
    }

    @Test
    void largeNonnegativePageReturnsAnEmptyPageInsteadOfFailing() throws Exception {
        when(taskRepository.searchTasks(any(TaskSearchCriteria.class), any(Pageable.class)))
                .thenAnswer(invocation -> new PageImpl<>(List.of(), invocation.getArgument(1), 0));

        HttpResponse<String> response = send("GET", "/api/tasks?page=2147483647&size=100", null, Map.of());

        assertThat(response.statusCode()).isEqualTo(HttpStatus.OK.value());
        assertThat(response.body()).contains("\"items\":[]", "\"totalElements\":0", "\"totalPages\":0");
    }

    @Test
    void spoofedHostAndMatchingOriginAreRejectedByTheRealHttpLayer() throws Exception {
        String body = "{\"title\":\"must not be created\"}";
        byte[] bodyBytes = body.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        String request = "POST /api/tasks HTTP/1.1\r\n"
                + "Host: evil.example:" + port + "\r\n"
                + "Origin: http://evil.example:" + port + "\r\n"
                + "Content-Type: application/json\r\n"
                + "Content-Length: " + bodyBytes.length + "\r\n"
                + "Connection: close\r\n\r\n"
                + body;
        try (Socket socket = new Socket(InetAddress.getByName("127.0.0.1"), port)) {
            socket.setSoTimeout(3_000);
            OutputStream output = socket.getOutputStream();
            output.write(request.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            output.flush();
            String response = new String(
                    socket.getInputStream().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
            assertThat(response).startsWith("HTTP/1.1 403");
            assertThat(response.toLowerCase()).contains("application/problem+json");
        }
        verifyNoInteractions(taskRepository);
    }

    @Test
    void createReadUpdateAndDeleteUseStrongVersionEtags() throws Exception {
        UUID id = UUID.randomUUID();
        AtomicReference<TaskEntity> persisted = new AtomicReference<>();
        when(taskRepository.saveAndFlush(any(TaskEntity.class))).thenAnswer(invocation -> {
            TaskEntity task = invocation.getArgument(0);
            if (task.getId() == null) {
                ReflectionTestUtils.setField(task, "id", id);
            } else {
                ReflectionTestUtils.setField(task, "version", task.getVersion() + 1);
            }
            persisted.set(task);
            return task;
        });
        when(taskRepository.findById(id)).thenAnswer(invocation -> Optional.ofNullable(persisted.get()));
        when(taskRepository.replaceIfVersionMatches(
                eq(id), anyInt(), anyString(), anyString(), any(), anyString(), any(), anyString(), any()))
                .thenAnswer(invocation -> {
                    TaskEntity task = persisted.get();
                    task.replaceFields(
                            invocation.getArgument(2),
                            invocation.getArgument(3),
                            invocation.getArgument(4),
                            invocation.getArgument(5),
                            invocation.getArgument(6),
                            invocation.getArgument(7),
                            task.getCompletedAt());
                    ReflectionTestUtils.setField(task, "version", invocation.<Integer>getArgument(1) + 1);
                    return 1;
                });
        when(taskRepository.updateStatusIfVersionMatches(eq(id), anyInt(), anyString(), any()))
                .thenAnswer(invocation -> {
                    TaskEntity task = persisted.get();
                    String status = invocation.getArgument(2);
                    java.time.Instant completedAt = "completed".equals(status)
                            ? task.getStatus().equals("completed") ? task.getCompletedAt() : invocation.getArgument(3)
                            : null;
                    task.replaceFields(
                            task.getTitle(),
                            task.getDescription(),
                            task.getDueDate(),
                            task.getPriority(),
                            task.getProjectId(),
                            status,
                            completedAt);
                    ReflectionTestUtils.setField(task, "version", invocation.<Integer>getArgument(1) + 1);
                    return 1;
                });
        when(taskRepository.deleteIfVersionMatches(eq(id), anyInt())).thenAnswer(invocation -> {
            persisted.set(null);
            return 1;
        });

        HttpResponse<String> created = send(
                "POST",
                "/api/tasks",
                "{\"title\":\"  First task  \",\"description\":null}",
                Map.of("Content-Type", "application/json"));

        assertThat(created.statusCode()).isEqualTo(HttpStatus.CREATED.value());
        assertThat(created.headers().firstValue("Location").orElseThrow()).isEqualTo("/api/tasks/" + id);
        assertThat(created.headers().firstValue("ETag").orElseThrow()).isEqualTo("\"0\"");
        assertThat(created.body()).contains(
                "\"id\":\"" + id + "\"",
                "\"title\":\"First task\"",
                "\"description\":\"\"",
                "\"dueDate\":null",
                "\"priority\":\"medium\"",
                "\"projectId\":null",
                "\"status\":\"active\"",
                "\"completedAt\":null");

        HttpResponse<String> read = send("GET", "/api/tasks/" + id, null, Map.of());
        assertThat(read.statusCode()).isEqualTo(HttpStatus.OK.value());
        assertThat(read.headers().firstValue("ETag").orElseThrow()).isEqualTo("\"0\"");

        HttpResponse<String> updated = send(
                "PUT",
                "/api/tasks/" + id,
                "{\"title\":\"Second task\",\"description\":\"preserved\"}",
                Map.of("Content-Type", "application/json", "If-Match", "\"0\""));
        assertThat(updated.statusCode()).isEqualTo(HttpStatus.OK.value());
        assertThat(updated.headers().firstValue("ETag").orElseThrow()).isEqualTo("\"1\"");
        assertThat(updated.body()).contains("\"title\":\"Second task\"", "\"description\":\"preserved\"", "\"version\":1");

        HttpResponse<String> noOpUpdate = send(
                "PUT",
                "/api/tasks/" + id,
                "{\"title\":\"Second task\",\"description\":\"preserved\"}",
                Map.of("Content-Type", "application/json", "If-Match", "\"1\""));
        assertThat(noOpUpdate.statusCode()).isEqualTo(HttpStatus.OK.value());
        assertThat(noOpUpdate.headers().firstValue("ETag").orElseThrow()).isEqualTo("\"2\"");
        assertThat(noOpUpdate.body()).contains("\"version\":2");

        HttpResponse<String> deleted = send(
                "DELETE", "/api/tasks/" + id, null, Map.of("If-Match", "\"2\""));
        assertThat(deleted.statusCode()).isEqualTo(HttpStatus.NO_CONTENT.value());
        assertThat(deleted.body()).isEmpty();
        verify(taskRepository).replaceIfVersionMatches(
                eq(id), eq(0), eq("Second task"), eq("preserved"), eq(null), eq("medium"),
                eq(null), eq("active"), any());
        verify(taskRepository).replaceIfVersionMatches(
                eq(id), eq(1), eq("Second task"), eq("preserved"), eq(null), eq("medium"),
                eq(null), eq("active"), any());
        verify(taskRepository).deleteIfVersionMatches(id, 2);
    }

    @Test
    void statusPatchChangesOnlyStatusAndReturnsNewVersion() throws Exception {
        UUID id = UUID.randomUUID();
        TaskEntity task = entity(id, 4, "Keep title", "Keep description");
        when(taskRepository.findById(id)).thenReturn(Optional.of(task));
        when(taskRepository.updateStatusIfVersionMatches(eq(id), eq(4), eq("completed"), any())).thenAnswer(invocation -> {
            task.replaceFields(
                    task.getTitle(), task.getDescription(), task.getDueDate(), task.getPriority(),
                    task.getProjectId(), "completed", invocation.getArgument(3));
            ReflectionTestUtils.setField(task, "version", 5);
            return 1;
        });

        HttpResponse<String> response = send(
                "PATCH",
                "/api/tasks/" + id + "/status",
                "{\"status\":\"completed\"}",
                Map.of("Content-Type", "application/json", "If-Match", "\"4\""));

        assertThat(response.statusCode()).isEqualTo(HttpStatus.OK.value());
        assertThat(response.headers().firstValue("ETag").orElseThrow()).isEqualTo("\"5\"");
        assertThat(response.body()).contains(
                "\"title\":\"Keep title\"",
                "\"description\":\"Keep description\"",
                "\"status\":\"completed\"",
                "\"version\":5",
                "\"completedAt\":");
    }

    @Test
    void projectCrudAndStatisticsUseRealHttpLayer() throws Exception {
        UUID projectId = UUID.randomUUID();
        ProjectEntity project = new ProjectEntity("Release planning");
        ReflectionTestUtils.setField(project, "id", projectId);
        when(projectRepository.findAllInDisplayOrder()).thenReturn(List.of(project));
        when(projectRepository.findById(projectId)).thenReturn(Optional.of(project));
        when(projectRepository.saveAndFlush(any(ProjectEntity.class))).thenAnswer(invocation -> {
            ProjectEntity saved = invocation.getArgument(0);
            ReflectionTestUtils.setField(saved, "id", projectId);
            return saved;
        });
        when(projectRepository.findByIdForUpdate(projectId)).thenReturn(Optional.of(project));
        when(projectRepository.renameIfVersionMatches(eq(projectId), eq(0), eq("Planning"))).thenAnswer(invocation -> {
            ReflectionTestUtils.setField(project, "version", 1);
            return 1;
        });
        when(projectRepository.countByNameIgnoreCase("Release planning")).thenReturn(0L);
        when(projectRepository.countByNameIgnoreCaseAndIdNot("Planning", projectId)).thenReturn(0L);
        when(projectRepository.deleteIfVersionMatches(projectId, 1)).thenReturn(1);
        when(taskRepository.unassignTasksFromProject(projectId)).thenReturn(2);
        when(taskRepository.countCompletedBetween(any(), any())).thenReturn(2L);
        when(taskRepository.dailyCompletions(any(), any(), anyString())).thenReturn(List.of());
        when(projectRepository.projectTaskAggregates()).thenReturn(List.of());

        HttpResponse<String> list = send("GET", "/api/projects", null, Map.of());
        assertThat(list.statusCode()).isEqualTo(HttpStatus.OK.value());
        assertThat(list.body()).contains("Release planning", projectId.toString());

        HttpResponse<String> read = send("GET", "/api/projects/" + projectId, null, Map.of());
        assertThat(read.statusCode()).isEqualTo(HttpStatus.OK.value());
        assertThat(read.headers().firstValue("ETag").orElseThrow()).isEqualTo("\"0\"");

        HttpResponse<String> created = send(
                "POST", "/api/projects", "{\"name\":\"  Release planning  \"}",
                Map.of("Content-Type", "application/json"));
        assertThat(created.statusCode()).isEqualTo(HttpStatus.CREATED.value());
        assertThat(created.headers().firstValue("Location").orElseThrow()).isEqualTo("/api/projects/" + projectId);

        when(projectRepository.countByNameIgnoreCase(anyString())).thenReturn(1L);
        HttpResponse<String> duplicate = send(
                "POST", "/api/projects", "{\"name\":\"release planning\"}",
                Map.of("Content-Type", "application/json"));
        assertProblem(duplicate, HttpStatus.CONFLICT);
        assertThat(duplicate.body()).contains("fieldErrors", "name");

        HttpResponse<String> renamed = send(
                "PUT", "/api/projects/" + projectId, "{\"name\":\"Planning\"}",
                Map.of("Content-Type", "application/json", "If-Match", "\"0\""));
        assertThat(renamed.statusCode()).isEqualTo(HttpStatus.OK.value());
        assertThat(renamed.headers().firstValue("ETag").orElseThrow()).isEqualTo("\"1\"");

        HttpResponse<String> deleted = send(
                "DELETE", "/api/projects/" + projectId, null, Map.of("If-Match", "\"1\""));
        assertThat(deleted.statusCode()).isEqualTo(HttpStatus.NO_CONTENT.value());
        verify(taskRepository).unassignTasksFromProject(projectId);

        HttpResponse<String> statistics = send("GET", "/api/statistics?timeZone=Europe%2FParis", null, Map.of());
        assertThat(statistics.statusCode()).isEqualTo(HttpStatus.OK.value());
        assertThat(statistics.body()).contains(
                "\"completedToday\":2",
                "\"completedThisWeek\":2",
                "\"dailyCompletions\":[",
                "\"projects\":[]");
    }

    @Test
    void invalidFilterAndInvalidTimezoneReturnFieldErrors() throws Exception {
        HttpResponse<String> filter = send("GET", "/api/tasks?sort=created;drop", null, Map.of());
        assertProblem(filter, HttpStatus.BAD_REQUEST);
        assertThat(filter.body()).contains("sort");

        HttpResponse<String> zone = send("GET", "/api/statistics?timeZone=NotAZone", null, Map.of());
        assertProblem(zone, HttpStatus.BAD_REQUEST);
        assertThat(zone.body()).contains("timeZone");

        for (String body : List.of(
                "{\"title\":\"Good\",\"priority\":null}",
                "{\"title\":\"Good\",\"status\":null}",
                "{\"title\":\"Good\",\"extra\":true}",
                "{\"title\":\"Good\",\"dueDate\":\"2026-02-30\"}")) {
            HttpResponse<String> invalid = send(
                    "POST", "/api/tasks", body, Map.of("Content-Type", "application/json"));
            assertProblem(invalid, HttpStatus.BAD_REQUEST);
        }

        UUID missingProject = UUID.randomUUID();
        when(projectRepository.findByIdForUpdate(missingProject)).thenReturn(Optional.empty());
        HttpResponse<String> taskWithMissingProject = send(
                "POST",
                "/api/tasks",
                "{\"title\":\"Good\",\"projectId\":\"" + missingProject + "\"}",
                Map.of("Content-Type", "application/json"));
        assertProblem(taskWithMissingProject, HttpStatus.BAD_REQUEST);
        assertThat(taskWithMissingProject.body()).contains("projectId");
    }

    @Test
    void validationPreconditionsAndOriginFailuresAreProblemDetails() throws Exception {
        HttpResponse<String> invalid = send(
                "POST", "/api/tasks", "{\"title\":\"   \",\"description\":\"\"}",
                Map.of("Content-Type", "application/json"));
        assertProblem(invalid, HttpStatus.BAD_REQUEST);
        assertThat(invalid.body()).contains("fieldErrors", "title");

        HttpResponse<String> missingMatch = send(
                "PUT", "/api/tasks/" + UUID.randomUUID(), "{\"title\":\"Good\",\"description\":\"\"}",
                Map.of("Content-Type", "application/json"));
        assertProblem(missingMatch, HttpStatus.PRECONDITION_REQUIRED);

        HttpResponse<String> untrustedOrigin = send(
                "POST", "/api/tasks", "{\"title\":\"Good\"}",
                Map.of("Content-Type", "application/json", "Origin", "https://untrusted.example"));
        assertProblem(untrustedOrigin, HttpStatus.FORBIDDEN);

        HttpResponse<String> invalidPage = send("GET", "/api/tasks?size=101", null, Map.of());
        assertProblem(invalidPage, HttpStatus.BAD_REQUEST);

        HttpResponse<String> malformedUuid = send("GET", "/api/tasks/not-a-uuid", null, Map.of());
        assertProblem(malformedUuid, HttpStatus.BAD_REQUEST);

        HttpResponse<String> malformedJson = send(
                "POST", "/api/tasks", "{not-json", Map.of("Content-Type", "application/json"));
        assertProblem(malformedJson, HttpStatus.BAD_REQUEST);

        HttpResponse<String> unsupportedMethod = send("PATCH", "/api/tasks", null, Map.of());
        assertProblem(unsupportedMethod, HttpStatus.METHOD_NOT_ALLOWED);

        HttpResponse<String> unknownPath = send("GET", "/api/not-a-task-route", null, Map.of());
        assertProblem(unknownPath, HttpStatus.NOT_FOUND);
    }

    @Test
    void taskTextFieldsRejectNumbersAndBooleansForCreateAndUpdate() throws Exception {
        List<String> invalidBodies = List.of(
                "{\"title\":123}",
                "{\"title\":true}",
                "{\"title\":\"valid\",\"description\":123}");
        for (String body : invalidBodies) {
            HttpResponse<String> response = send(
                    "POST", "/api/tasks", body, Map.of("Content-Type", "application/json"));
            assertProblem(response, HttpStatus.BAD_REQUEST);
        }

        UUID id = UUID.randomUUID();
        for (String body : invalidBodies) {
            HttpResponse<String> response = send(
                    "PUT",
                    "/api/tasks/" + id,
                    body,
                    Map.of("Content-Type", "application/json", "If-Match", "\"0\""));
            assertProblem(response, HttpStatus.BAD_REQUEST);
        }
    }

    @Test
    void uuidPathParametersRequireCanonicalFormatButAcceptUppercaseAndNil() throws Exception {
        UUID uppercaseId = UUID.fromString("aabbccdd-eeff-0011-2233-445566778899");
        UUID nilId = new UUID(0L, 0L);
        when(taskRepository.findById(uppercaseId))
                .thenReturn(Optional.of(entity(uppercaseId, 0, "Uppercase", "")));
        when(taskRepository.findById(nilId)).thenReturn(Optional.empty());

        HttpResponse<String> uppercaseRead = send(
                "GET", "/api/tasks/AABBCCDD-EEFF-0011-2233-445566778899", null, Map.of());
        assertThat(uppercaseRead.statusCode()).isEqualTo(HttpStatus.OK.value());
        assertThat(uppercaseRead.headers().firstValue("ETag").orElseThrow()).isEqualTo("\"0\"");

        HttpResponse<String> nilRead = send("GET", "/api/tasks/00000000-0000-0000-0000-000000000000", null, Map.of());
        assertProblem(nilRead, HttpStatus.NOT_FOUND);

        HttpResponse<String> malformedRead = send("GET", "/api/tasks/1-1-1-1-1", null, Map.of());
        assertProblem(malformedRead, HttpStatus.BAD_REQUEST);

        HttpResponse<String> malformedUpdate = send(
                "PUT", "/api/tasks/1-1-1-1-1", "{\"title\":\"valid\"}",
                Map.of("Content-Type", "application/json", "If-Match", "\"0\""));
        assertProblem(malformedUpdate, HttpStatus.BAD_REQUEST);

        HttpResponse<String> malformedDelete = send(
                "DELETE", "/api/tasks/1-1-1-1-1", null, Map.of("If-Match", "\"0\""));
        assertProblem(malformedDelete, HttpStatus.BAD_REQUEST);
    }

    @Test
    void missingAndStaleTasksMapToContractStatuses() throws Exception {
        UUID id = UUID.randomUUID();
        when(taskRepository.findById(id)).thenReturn(Optional.empty());

        HttpResponse<String> missing = send("GET", "/api/tasks/" + id, null, Map.of());
        assertProblem(missing, HttpStatus.NOT_FOUND);

        TaskEntity current = entity(id, 4, "Current", "");
        when(taskRepository.findById(id)).thenReturn(Optional.of(current));
        HttpResponse<String> stale = send(
                "PUT", "/api/tasks/" + id, "{\"title\":\"Replacement\",\"description\":\"\"}",
                Map.of("Content-Type", "application/json", "If-Match", "\"3\""));
        assertProblem(stale, HttpStatus.PRECONDITION_FAILED);
    }

    private TaskEntity entity(UUID id, int version, String title, String description) {
        TaskEntity entity = new TaskEntity(title, description);
        ReflectionTestUtils.setField(entity, "id", id);
        ReflectionTestUtils.setField(entity, "version", version);
        return entity;
    }

    private HttpResponse<String> send(String method, String path, String body, Map<String, String> headers)
            throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(url(path)));
        headers.forEach(request::header);
        HttpRequest.BodyPublisher publisher = body == null
                ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(body);
        return httpClient.send(request.method(method, publisher).build(), HttpResponse.BodyHandlers.ofString());
    }

    private String url(String path) {
        return "http://127.0.0.1:" + port + path;
    }

    private void assertProblem(HttpResponse<String> response, HttpStatus expectedStatus) {
        assertThat(response.statusCode()).isEqualTo(expectedStatus.value());
        assertThat(response.headers().firstValue("Content-Type").orElse(""))
                .startsWith("application/problem+json");
    }
}
