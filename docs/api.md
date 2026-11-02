# TaskFlow API contract

This document is the shared API contract for the TaskFlow backend and frontend. The main agent maintains this canonical contract; the backend must implement it as written, and the frontend client and stateful API mock must match it. Any contract change goes through the main agent and is communicated to both implementation agents before either changes its implementation.

## Conventions

- Base path: `/api`; resources: `/tasks`, `/projects`, `/statistics`.
- JSON request and response bodies use UTF-8.
- There is no login or user identity in this local single-user version.
- Task editable fields are `title`, `description`, `dueDate`, `priority`, `projectId`, and `status`.
- IDs are UUID strings. `version` is an integer concurrency token; neither field is editable.
- User-controlled content is plain text and must never be rendered as injected HTML.
- The frontend uses a same-origin development proxy. Do not enable permissive CORS; reject unexpected browser origins for state-changing requests.

## Data shapes

### Task

```json
{
  "id": "8be3fd4f-634e-41df-a2bb-c7482ecee8e4",
  "title": "Plan the release",
  "description": "Review the open issues.",
  "version": 0,
  "dueDate": null,
  "priority": "medium",
  "projectId": null,
  "status": "active",
  "completedAt": null
}
```

`description` is always a string in responses. Creation timestamps may be stored internally for ordering but are not part of the user-facing response.

### Task request

```json
{
  "title": "Plan the release",
  "description": "Review the open issues."
}
```

- `title` is required, must be a string, is trimmed before validation and storage, must not be blank, and must contain at most 200 Unicode code points after trimming.
- `description` is optional. Omitted or `null` values are normalized to the empty string. Otherwise it must be a string of at most 10,000 Unicode code points. Preserve its whitespace.
- Reject malformed JSON, wrong field types, and fields that exceed the specified limits. Do not silently truncate.
- `dueDate`: optional/null strict calendar date `YYYY-MM-DD` (years 0001–9999); omitted means null. Never convert deadlines through UTC.
- `priority`: optional enum `low|medium|high`; omitted means `medium`; explicit null is invalid.
- `projectId`: optional/null canonical UUID; omitted means null. A nonexistent project is 400 with `fieldErrors.projectId`.
- `status`: optional enum `active|completed`; omitted means `active`; explicit null is invalid.
- Reject unknown fields. `completedAt` is server-controlled, a UTC ISO-8601 instant when completed and null when active.
- Creating completed or transitioning active to completed records the server clock. Reopening clears the timestamp. Editing an already completed task or repeating completed status preserves its completion timestamp.
- PUT replaces all editable fields; omitted new fields apply these defaults for compatibility with old title/description-only clients. The updated frontend sends all editable fields.

## Endpoints

### List and search tasks

`GET /api/tasks?page={page}&size={size}&q={query}`

All query parameters are optional:

| Parameter | Type | Default | Rules |
|-----------|------|---------|-------|
| `page` | integer | `0` | Zero-based; must be non-negative. |
| `size` | integer | `20` | Must be between 1 and 100 inclusive. |
| `q` | string | absent | Trim before use; at most 200 Unicode code points. Blank after trimming means no search. |
| `view` | enum | `all` | `all`, `today`, `upcoming`, `completed`. |
| `status` | enum | absent | `active`, `completed`. |
| `priority` | enum | absent | `low`, `medium`, `high`. |
| `due` | enum | absent | `today`, `this_week`, `overdue`. |
| `project` | string | absent | Canonical project UUID or `unassigned`; unknown valid UUID returns an empty page. |
| `sort` | enum | `created_desc` | `created_desc`, `due_asc`, `due_desc`, `priority_desc`, `priority_asc`, `status_asc`, `status_desc`. |
| `timeZone` | string | `UTC` | Valid IANA timezone; frontend supplies browser zone. Invalid zone is 400, not a fallback. |

Search is a case-insensitive literal substring match across title and description. Treat wildcard characters as literal text. All filters and views intersect before pagination/counting. `all` includes both statuses and undated tasks; `today` includes active tasks due today or overdue; `upcoming` includes active tasks due strictly after today; `completed` includes only completed tasks. Undated tasks fail date filters. `this_week` is inclusive Monday–Sunday, including earlier days of the week; overdue means strictly before today.

The backend clock in `timeZone` determines calendar boundaries, including DST. Sort priority descending high-to-low and status ascending active-first; reverse for opposite directions. Due-date sorts always place null dates last. Every sort uses creation timestamp descending then ID descending as stable tie-breakers. Default ordering remains newest-first.

Success: `200 OK`, JSON:

```json
{
  "items": [
    {
      "id": "8be3fd4f-634e-41df-a2bb-c7482ecee8e4",
      "title": "Plan the release",
      "description": "Review the open issues.",
      "version": 0,
      "dueDate": null,
      "priority": "medium",
      "projectId": null,
      "status": "active",
      "completedAt": null
    }
  ],
  "page": 0,
  "size": 20,
  "totalElements": 1,
  "totalPages": 1
}
```

When there are no matches, return an empty `items` array, `totalElements: 0`, and `totalPages: 0`. Do not silently clamp invalid pagination or search values.

### Read one task

`GET /api/tasks/{id}`

- `id` must be a UUID.
- Success: `200 OK`, a `Task` JSON body, and a strong `ETag` header whose quoted decimal value is the task version, for example `ETag: "0"`.
- Missing task: `404 Not Found`.
- Malformed UUID: `400 Bad Request`.

### Create a task

`POST /api/tasks`

- Content type: `application/json`.
- Body: `Task request`.
- Success: `201 Created`, a `Task` JSON body, a `Location` header pointing to `/api/tasks/{id}`, and a strong `ETag` header containing the quoted decimal version.
- Invalid body or fields: `400 Bad Request` with Problem Details; include `fieldErrors` for field validation failures.

### Replace a task's editable fields

`PUT /api/tasks/{id}`

- `id` must be a UUID.
- Content type: `application/json`.
- Body: `Task request`; this replaces all editable fields. Omitted values follow the defaults above.
- `If-Match` is required and must contain the quoted decimal version from the latest task `ETag`, for example `If-Match: "0"`.
- Success: `200 OK`, the updated `Task` JSON body, and a strong `ETag` header for the new version.
- Missing `If-Match`: `428 Precondition Required`.
- Malformed UUID, header, JSON, or invalid fields: `400 Bad Request`.
- Task does not exist: `404 Not Found`.
- Version no longer matches: `412 Precondition Failed`. Do not overwrite the newer task; the response must instruct the client to reload. Preserve the user's draft in the UI.

### Delete a task

`DELETE /api/tasks/{id}`

- `id` must be a UUID.
- `If-Match` is required and must contain the quoted decimal version from the latest task `ETag`.
- Success: `204 No Content` with no response body.
- Missing `If-Match`: `428 Precondition Required`.
- Malformed UUID or header: `400 Bad Request`.
- Task does not exist: `404 Not Found`.
- Version no longer matches: `412 Precondition Failed`. Do not delete the newer task.

Update and delete must check the version and mutate atomically; a check-then-write race must not permit a stale request to overwrite or delete a newer version.

### Complete or reopen a task

`PATCH /api/tasks/{id}/status`

- JSON body exactly `{ "status": "active" | "completed" }`; status is required and nonnull.
- Canonical UUID and required strong quoted-decimal `If-Match`, as for PUT.
- Success: 200 Task and matching new strong ETag. Accepted writes advance the version even when status already matches.
- Errors: 400 invalid UUID/header/body, 404 missing task, 412 stale, 428 missing If-Match.
- Do not replace unrelated fields. Preserve an existing completion timestamp when status remains completed.

### Projects

`Project` is `{ "id": UUID string, "name": string, "version": nonnegative integer }`.
`ProjectInput` is exactly `{ "name": string }`. Trim name, require 1–100 Unicode code points, enforce case-insensitive uniqueness; reject wrong types, nulls and unknown fields. Projects and categories are one concept; a task belongs to at most one project.

| Method and path | Success | Errors |
|-----------------|---------|--------|
| `GET /api/projects` | 200 `Project[]`, including empty projects, sorted case-insensitively by name then ID; no pagination. | Shared errors below. |
| `GET /api/projects/{id}` | 200 Project + strong ETag. | 400 invalid canonical UUID; 404 missing. |
| `POST /api/projects` | 201 Project + canonical Location + strong ETag. | 400 invalid input; 409 duplicate name with `fieldErrors.name`. |
| `PUT /api/projects/{id}` | 200 Project + new ETag; full ProjectInput, required If-Match. | 400 invalid input/header/ID; 404 missing; 409 duplicate name; 412 stale; 428 missing If-Match. |
| `DELETE /api/projects/{id}` | 204, no body; required If-Match. | 400 invalid header/ID; 404 missing; 412 stale; 428 missing If-Match. |

Project deletion atomically leaves its tasks unassigned and advances each affected task's version. Never delete tasks with their project. Protect concurrent assignment/deletion and stale edits; do not expose foreign-key/server errors for expected races. Names are resolved through the project list rather than embedded in Task responses.

### Productivity statistics

`GET /api/statistics?timeZone=<IANA zone>` (zone defaults to UTC; invalid is 400).
Success 200:

```json
{
  "today": "2026-11-02",
  "weekStart": "2026-11-02",
  "weekEnd": "2026-11-08",
  "completedToday": 0,
  "completedThisWeek": 0,
  "dailyCompletions": [
    { "date": "2026-10-27", "count": 0 },
    { "date": "2026-10-28", "count": 0 },
    { "date": "2026-10-29", "count": 0 },
    { "date": "2026-10-30", "count": 0 },
    { "date": "2026-10-31", "count": 0 },
    { "date": "2026-11-01", "count": 0 },
    { "date": "2026-11-02", "count": 0 }
  ],
  "projects": []
}
```

- Dates are local calendar dates; weekStart/weekEnd are inclusive Monday/Sunday.
- Exactly seven daily entries ascending, ending today, including zero days. Counts are nonnegative integers.
- Each project entry is `{ projectId: UUID string, name: string, totalTasks: integer, completedTasks: integer, completionRate: number }`; include empty projects and sort as project list.
- Rate is completed/total * 100 rounded to one decimal, zero for empty projects. Completed never exceeds total; rate is 0–100.
- Aggregate across all stored tasks, not just a page. Global counts include unassigned tasks; project rates omit unassigned tasks.
- Count currently completed tasks using their latest completion timestamp in the requested timezone. Reopening/deletion removes counts; re-completing counts on its new date. No historical event log.
- Use timezone-aware local midnight boundaries rather than assuming every day is 24 hours.

### Dashboard composition

No separate dashboard endpoint. Fetch three five-item previews, with exact counts from `totalElements`, all `sort=due_asc` and browser `timeZone`: active due=today, active due=overdue, and view=upcoming. Link to full filtered lists; fetch statistics separately. Dashboard is home; navigation also offers Today, Upcoming, All Tasks, Completed.

## Error format

Errors use `application/problem+json` and RFC 9457 Problem Details:

```json
{
  "type": "about:blank",
  "title": "Invalid request",
  "status": 400,
  "detail": "The request contains invalid values.",
  "instance": "/api/tasks",
  "fieldErrors": {
    "title": ["must not be blank"]
  }
}
```

`fieldErrors` is optional and, when present, maps field names to arrays of actionable messages.

| Status | Meaning |
|--------|---------|
| `400 Bad Request` | Invalid field or query value, malformed JSON, UUID, or `If-Match` header. |
| `403 Forbidden` | Disallowed Host or browser origin. |
| `404 Not Found` | No task exists for the requested ID. |
| `409 Conflict` | Duplicate case-insensitive project name, with name field error. |
| `412 Precondition Failed` | `If-Match` version is stale. Tell the client to reload; never silently overwrite. |
| `428 Precondition Required` | Update or delete omitted the required `If-Match` header. |
| `500 Internal Server Error` | Unexpected server failure. Do not expose stack traces or SQL. |
| `503 Service Unavailable` | Database unavailable. Do not expose credentials, SQL, or internal connection details. |

Unexpected errors must be logged server-side using the repository's Spring logging conventions. Error messages shown by the UI must be actionable and must not expose internal implementation details.

## Client behavior and concurrency

- Use the `version` in list items to construct the quoted `If-Match` value for update and delete. Detail, create, and update responses also provide the authoritative `ETag`.
- Never automatically retry a non-idempotent create after an ambiguous network failure. Tell the user the outcome is uncertain and refresh the list before resubmitting.
- On `412`, explain that another tab changed the task and offer an explicit reload. Do not discard the user's draft automatically.
- Show success only after a confirmed success response. Keep unsaved input on validation, network, and stale-version failures.
- Apply the same concurrency and uncertain-write recovery to completion and project mutations. No automatic write retries. Fresh reads and explicit decisions precede retrying ambiguous writes.
- Invalidate task, project, dashboard, and statistics caches affected by writes. Include all filters, sorting, page, and timezone in query keys; cancel outdated reads.
- Refresh relative-date reads at local midnight and on focus. Filters combine with the selected view; incompatible combinations show an explanatory empty state. Reset pagination on changed controls.
- Every endpoint retains local single-user Host/origin protection and sanitized logged 500/503 errors. Keep the existing same-origin proxy and configuration; no authentication, permissive CORS, or additional dependencies are introduced.
- Mock handlers/store must implement the same contract, including all new fields in draft recovery and duplicate detection. Mock storage remains test-only; PostgreSQL is durable application storage.
