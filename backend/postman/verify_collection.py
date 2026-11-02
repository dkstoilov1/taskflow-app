"""Static, no-server verification for the TaskFlow Postman collection."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from urllib.parse import urlsplit


COLLECTION_PATH = Path(__file__).with_name("taskflow.postman_collection.json")
COLLECTION_SCHEMA = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
OWN_TASK_PATH = "/api/tasks/{{taskflowCreatedTaskId}}"
EXPECTED_CORE = {
    "Create task owned by this collection": ("POST", "/api/tasks"),
    "List and search tasks": ("GET", "/api/tasks"),
    "Read collection-owned task": ("GET", OWN_TASK_PATH),
    "Replace collection-owned task": ("PUT", OWN_TASK_PATH),
    "Delete collection-owned task": ("DELETE", OWN_TASK_PATH),
}
EXPECTED_ERRORS = {
    "Error: invalid task UUID (400)": ("GET", "/api/tasks/not-a-uuid", 400),
    "Error: invalid pagination (400)": ("GET", "/api/tasks", 400),
    "Error: missing task (404)": ("GET", "/api/tasks/00000000-0000-4000-8000-000000000001", 404),
    "Error: missing If-Match (428)": ("PUT", OWN_TASK_PATH, 428),
    "Error: stale If-Match (412)": ("PUT", OWN_TASK_PATH, 412),
    "Error: duplicate project name (409)": ("POST", "/api/projects", 409),
    "Error: invalid timezone (400)": ("GET", "/api/statistics", 400),
    "Error: invalid task status (400)": ("PATCH", OWN_TASK_PATH + "/status", 400),
    "Error: missing project If-Match (428)": ("PUT", "/api/projects/{{taskflowProjectId}}", 428),
}
EXPECTED_ROUTES = {
    ("GET", "/api/tasks"),
    ("GET", "/api/tasks/{{taskflowCreatedTaskId}}"),
    ("POST", "/api/tasks"),
    ("PUT", "/api/tasks/{{taskflowCreatedTaskId}}"),
    ("PATCH", "/api/tasks/{{taskflowCreatedTaskId}}/status"),
    ("DELETE", "/api/tasks/{{taskflowCreatedTaskId}}"),
    ("GET", "/api/projects"),
    ("GET", "/api/projects/{{taskflowProjectId}}"),
    ("POST", "/api/projects"),
    ("PUT", "/api/projects/{{taskflowProjectId}}"),
    ("DELETE", "/api/projects/{{taskflowProjectId}}"),
    ("GET", "/api/statistics"),
}


def fail(message: str) -> None:
    """Stop verification with an actionable diagnostic."""

    raise SystemExit(f"FAIL: {message}")


def collect_requests(items: list[dict]) -> list[dict]:
    """Flatten collection items and folders into request-bearing records."""

    requests: list[dict] = []
    for item in items:
        if not isinstance(item, dict):
            fail("Every collection item must be an object.")
        if isinstance(item.get("request"), dict):
            requests.append(item)
        children = item.get("item", [])
        if not isinstance(children, list):
            fail(f"Nested items for {item.get('name')!r} must be an array.")
        if children:
            requests.extend(collect_requests(children))
    return requests


def script_text(item: dict, listen: str) -> str:
    """Return all JavaScript source for one request event type."""

    chunks = []
    for event in item.get("event", []):
        if event.get("listen") == listen:
            chunks.extend(event.get("script", {}).get("exec", []))
    return "\n".join(chunks)


def request_path(request: dict) -> str:
    """Extract a collection request path after substituting its local base URL."""

    raw_url = request.get("url")
    if isinstance(raw_url, dict):
        raw_url = raw_url.get("raw", "")
    if not isinstance(raw_url, str):
        fail(f"Request {request.get('name')!r} has no URL string.")
    resolved = raw_url.replace("{{baseUrl}}", "http://127.0.0.1:8080")
    return urlsplit(resolved).path


def headers_by_name(request: dict) -> dict[str, str]:
    """Return enabled headers by lowercase name."""

    return {
        header.get("key", "").lower(): header.get("value", "")
        for header in request.get("header", [])
        if not header.get("disabled", False)
    }


def main() -> int:
    """Verify JSON structure, contract routes, headers, safety scripts, and error samples."""

    try:
        collection = json.loads(COLLECTION_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        fail(f"Could not load valid collection JSON: {error}")

    if not isinstance(collection, dict):
        fail("Collection root must be a JSON object.")
    info = collection.get("info", {})
    if not isinstance(info, dict) or not isinstance(info.get("name"), str):
        fail("Collection must contain an info object with a name.")
    if info.get("schema") != COLLECTION_SCHEMA:
        fail("Collection must declare the Postman Collection v2.1 schema.")

    items = collection.get("item")
    variable_entries = collection.get("variable")
    if not isinstance(items, list) or not isinstance(variable_entries, list):
        fail("Collection must contain item and variable arrays.")
    variables = {
        entry.get("key"): entry.get("value")
        for entry in variable_entries
        if isinstance(entry, dict)
    }
    if variables.get("baseUrl") != "http://127.0.0.1:8080":
        fail("Collection must define the baseUrl variable with a loopback default.")
    for key in (
        "taskflowCreatedTaskId",
        "taskflowOwnedTaskId",
        "taskflowTaskVersion",
        "taskflowTaskEtag",
        "taskflowPreviousEtag",
        "taskflowProjectId",
        "taskflowProjectName",
        "taskflowProjectEtag",
        "taskflowProjectPreviousEtag",
    ):
        if key not in variables:
            fail(f"Missing collection variable {key!r}.")

    requests = collect_requests(items)
    by_name = {item.get("name"): item for item in requests}
    if len(by_name) != len(requests):
        fail("Request names must be unique.")

    for item in requests:
        request = item["request"]
        if not isinstance(request.get("method"), str):
            fail(f"Request {item['name']!r} must have an HTTP method.")
        if not isinstance(request.get("header", []), list):
            fail(f"Request {item['name']!r} headers must be an array.")
        method = request.get("method", "").upper()
        headers = headers_by_name(request)
        path = request_path(request)
        if method in ("POST", "PUT", "PATCH"):
            if headers.get("content-type") != "application/json":
                fail(f"{item['name']!r} must send Content-Type: application/json.")
            body = request.get("body", {})
            if not isinstance(body, dict) or not isinstance(body.get("raw"), str):
                fail(f"{item['name']!r} must have a raw JSON request body.")
            try:
                body_value = json.loads(body.get("raw", ""))
            except json.JSONDecodeError:
                fail(f"{item['name']!r} must include a valid JSON example body.")
            if not isinstance(body_value, dict):
                fail(f"{item['name']!r} must contain a JSON object body.")
            if path.startswith("/api/projects"):
                if method in ("POST", "PUT") and not isinstance(body_value.get("name"), str):
                    fail(f"{item['name']!r} must include a project name.")
            elif method == "PATCH":
                if body_value.get("status") not in ("active", "completed", "paused"):
                    fail(f"{item['name']!r} must include a representative task status.")
            else:
                if not isinstance(body_value.get("title"), str) or "description" not in body_value:
                    fail(f"{item['name']!r} must include task title and description fields.")
        if method in ("PUT", "DELETE", "PATCH") and not headers.get("if-match") \
                and "missing" not in item.get("name", "").lower():
            fail(f"{item['name']!r} must send the required If-Match header.")

    for name, (method, path) in EXPECTED_CORE.items():
        item = by_name.get(name)
        if item is None:
            fail(f"Missing required CRUD request {name!r}.")
        actual_method = item["request"].get("method", "").upper()
        actual_path = request_path(item["request"])
        if (actual_method, actual_path) != (method, path):
            fail(f"{name!r} must use {method} {path}; got {actual_method} {actual_path}.")

    for name, (method, path, status) in EXPECTED_ERRORS.items():
        item = by_name.get(name)
        if item is None:
            fail(f"Missing representative error request {name!r}.")
        if item["request"].get("method", "").upper() != method or request_path(item["request"]) != path:
            fail(f"Error request {name!r} has an unexpected method or path.")
        if f"pm.response.to.have.status({status})" not in script_text(item, "test"):
            fail(f"Error request {name!r} does not assert HTTP {status}.")

    actual_routes = {
        (item["request"]["method"].upper(), request_path(item["request"]))
        for item in requests
        if request_path(item["request"]).startswith(("/api/tasks", "/api/projects", "/api/statistics"))
    }
    if not EXPECTED_ROUTES.issubset(actual_routes):
        fail(f"Missing controller route/method pairs: {sorted(EXPECTED_ROUTES - actual_routes)}")

    for item in requests:
        path = request_path(item["request"]).lower()
        if "swagger-ui" in path or "v3/api-docs" in path or "openapi" in path:
            fail(f"Documentation endpoint must not be requested: {item['name']!r}.")

    create = by_name["Create task owned by this collection"]
    create_headers = headers_by_name(create["request"])
    if create_headers.get("content-type") != "application/json":
        fail("Create request must send Content-Type: application/json.")
    create_pre_request = script_text(create, "prerequest")
    for key in (
        "taskflowCreatedTaskId",
        "taskflowOwnedTaskId",
        "taskflowTaskVersion",
        "taskflowTaskEtag",
        "taskflowPreviousEtag",
    ):
        if key not in create_pre_request:
            fail(f"Every create attempt must clear prior collection variable {key}.")
    if "pm.collectionVariables.set(key, '')" not in create_pre_request:
        fail("Create pre-request script must clear ownership/version state before POST.")
    create_tests = script_text(create, "test")
    status_check = create_tests.find("pm.response.to.have.status(201)")
    first_variable_write = create_tests.find("pm.collectionVariables.set(")
    if create_tests.count("pm.test(") != 1 or status_check < 0 or first_variable_write < 0 or status_check > first_variable_write:
        fail("The create capture test itself must assert HTTP 201 before setting any variables.")
    for required in (
        "taskflowCreatedTaskId",
        "taskflowOwnedTaskId",
        "taskflowTaskVersion",
        "taskflowTaskEtag",
        "Location",
        "ETag",
    ):
        if required not in create_tests:
            fail(f"Create test script must capture and validate {required}.")

    read = by_name["Read collection-owned task"]
    read_tests = script_text(read, "test")
    if "taskflowTaskEtag" not in read_tests or "taskflowTaskVersion" not in read_tests:
        fail("Read request must refresh the collection task's latest version and ETag.")

    update = by_name["Replace collection-owned task"]
    update_headers = headers_by_name(update["request"])
    if update_headers.get("if-match") != "{{taskflowTaskEtag}}":
        fail("Update request must send the latest collection ETag in If-Match.")
    update_tests = script_text(update, "test")
    if "taskflowPreviousEtag" not in update_tests or "taskflowTaskEtag" not in update_tests:
        fail("Update test must retain the previous ETag for a stale-version example and store the latest ETag.")

    delete = by_name["Delete collection-owned task"]
    delete_headers = headers_by_name(delete["request"])
    if delete_headers.get("if-match") != "{{taskflowTaskEtag}}":
        fail("Delete request must send the latest collection ETag in If-Match.")

    write_requests = [
        item for item in requests
        if item["request"].get("method", "").upper() in ("PUT", "DELETE", "PATCH")
    ]
    for item in write_requests:
        path = request_path(item["request"])
        if path not in (
            OWN_TASK_PATH,
            OWN_TASK_PATH + "/status",
            "/api/projects/{{taskflowProjectId}}",
        ) and "invalid" not in item["name"].lower() and "missing" not in item["name"].lower() and "stale" not in item["name"].lower():
            fail(f"Write request {item['name']!r} must target a collection-owned task or project.")
        pre_request = script_text(item, "prerequest")
        is_project_write = "/api/projects/" in path
        owner_key = "taskflowProjectId" if is_project_write else "taskflowOwnedTaskId"
        if owner_key not in pre_request or "pm.execution.skipRequest()" not in pre_request:
            fail(f"Write request {item['name']!r} must guard collection ownership before sending.")

    missing_match = by_name["Error: missing If-Match (428)"]
    if "if-match" in headers_by_name(missing_match["request"]):
        fail("The missing If-Match example must intentionally omit that header.")
    stale_match = by_name["Error: stale If-Match (412)"]
    if headers_by_name(stale_match["request"]).get("if-match") != "{{taskflowPreviousEtag}}":
        fail("The stale-version example must use the previous ETag from this collection's update.")

    status_update = by_name["Complete collection-owned task"]
    if headers_by_name(status_update["request"]).get("if-match") != "{{taskflowTaskEtag}}":
        fail("Status PATCH must use the current chained task ETag.")
    project_update = by_name["Rename collection-owned project"]
    if headers_by_name(project_update["request"]).get("if-match") != "{{taskflowProjectEtag}}":
        fail("Project rename must use the current chained project ETag.")
    project_delete = by_name["Delete collection-owned project"]
    if headers_by_name(project_delete["request"]).get("if-match") != "{{taskflowProjectEtag}}":
        fail("Project deletion must use the current chained project ETag.")

    collection_script = "\n".join(
        line
        for event in collection.get("event", [])
        if event.get("listen") == "prerequest"
        for line in event.get("script", {}).get("exec", [])
    )
    if (
        "127.0.0.1" not in collection_script
        or "localhost" not in collection_script
        or "skipRequest" not in collection_script
        or "parsedBaseUrl.search" not in collection_script
        or "parsedBaseUrl.hash" not in collection_script
    ):
        fail("Collection pre-request guard must restrict requests to query/fragment-free loopback URLs.")

    print(
        "PASS: valid Postman v2.1 JSON; 12/12 controller method/path pairs; "
        f"{len(EXPECTED_ERRORS)}/{len(EXPECTED_ERRORS)} representative error requests; "
        "required headers, chained owned-task/version guards, and no documentation endpoints."
    )
    print("No server or network request was used.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
