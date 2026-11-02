# TaskFlow API contract

This document is the shared API contract for the TaskFlow backend and frontend. The main agent maintains this canonical contract; the backend must implement it as written, and the frontend client and stateful API mock must match it. Any contract change goes through the main agent and is communicated to both implementation agents before either changes its implementation.

## Conventions

- Base path: `/api/tasks`.
- JSON request and response bodies use UTF-8.
- There is no login or user identity in this local single-user version.
- A task's only user-editable fields are `title` and `description`.
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
  "version": 0
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

## Endpoints

### List and search tasks

`GET /api/tasks?page={page}&size={size}&q={query}`

All query parameters are optional:

| Parameter | Type | Default | Rules |
|-----------|------|---------|-------|
| `page` | integer | `0` | Zero-based; must be non-negative. |
| `size` | integer | `20` | Must be between 1 and 100 inclusive. |
| `q` | string | absent | Trim before use; at most 200 Unicode code points. Blank after trimming means no search. |

Search is a case-insensitive literal substring match across title and description. Treat wildcard characters as literal text. Sort by creation timestamp descending, then ID descending for deterministic ordering.

Success: `200 OK`, JSON:

```json
{
  "items": [
    {
      "id": "8be3fd4f-634e-41df-a2bb-c7482ecee8e4",
      "title": "Plan the release",
      "description": "Review the open issues.",
      "version": 0
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
- Body: `Task request`; this replaces both editable fields. An omitted or null description becomes the empty string.
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
| `404 Not Found` | No task exists for the requested ID. |
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
