"""No-Docker HTTP contract tests for the TaskFlow API benchmark helper."""

from __future__ import annotations

import importlib.util
import json
import os
import socket
import sys
import threading
import time
import unittest
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit


SCRIPT_PATH = Path(__file__).with_name("taskflow_api_benchmark.py")
SPEC = importlib.util.spec_from_file_location("taskflow_api_benchmark", SCRIPT_PATH)
benchmark = importlib.util.module_from_spec(SPEC)
assert SPEC is not None and SPEC.loader is not None
sys.modules[SPEC.name] = benchmark
SPEC.loader.exec_module(benchmark)


class FakeTaskApiState:
    """In-memory fake implementing the TaskFlow contract used by the benchmark."""

    def __init__(self) -> None:
        self.tasks: dict[str, dict[str, Any]] = {}
        self.next_order = 0
        self.lock = threading.Lock()
        self.ignore_search = False
        self.ignore_update = False
        self.mangle_create_response = False
        self.location_mode = "relative"
        self.fail_posts = False
        self.fail_after_posts: int | None = None
        self.post_count = 0
        self.first_post_delay = 0.0
        self.version_step = 1

    def add_existing_task(self, title: str, description: str) -> dict[str, Any]:
        with self.lock:
            task = self._new_task(title, description)
            self.tasks[task["id"]] = task
            return dict(task)

    def _new_task(self, title: str, description: str) -> dict[str, Any]:
        self.next_order += 1
        return {
            "id": str(uuid.uuid4()),
            "title": title,
            "description": description,
            "version": 0,
            "_order": self.next_order,
        }


class FakeTaskApiServer:
    """Context-managed HTTP server bound to an ephemeral loopback port."""

    def __init__(self) -> None:
        self.state = FakeTaskApiState()
        state = self.state

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format_string: str, *args: Any) -> None:
                return

            def send_json(self, status: int, body: Any, headers: dict[str, str] | None = None) -> None:
                encoded = json.dumps(body).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(encoded)))
                for key, value in (headers or {}).items():
                    self.send_header(key, value)
                self.end_headers()
                self.wfile.write(encoded)

            def send_empty(self, status: int) -> None:
                self.send_response(status)
                self.send_header("Content-Length", "0")
                self.end_headers()

            def read_body(self) -> dict[str, Any]:
                length = int(self.headers.get("Content-Length", "0"))
                if length == 0:
                    return {}
                return json.loads(self.rfile.read(length).decode("utf-8"))

            def do_GET(self) -> None:
                parsed = urlsplit(self.path)
                if parsed.path != "/api/tasks":
                    self.send_json(404, {"title": "Not found"})
                    return
                query = parse_qs(parsed.query)
                page = int(query.get("page", ["0"])[0])
                size = int(query.get("size", ["20"])[0])
                search = query.get("q", [""])[0].strip().casefold()
                with state.lock:
                    values = list(state.tasks.values())
                if search and not state.ignore_search:
                    values = [
                        task
                        for task in values
                        if search in task["title"].casefold() or search in task["description"].casefold()
                    ]
                values.sort(key=lambda task: (task["_order"], task["id"]), reverse=True)
                total = len(values)
                visible = values[page * size : page * size + size]
                items = [{key: value for key, value in task.items() if not key.startswith("_")} for task in visible]
                self.send_json(
                    200,
                    {
                        "items": items,
                        "page": page,
                        "size": size,
                        "totalElements": total,
                        "totalPages": (total + size - 1) // size,
                    },
                )

            def do_POST(self) -> None:
                if self.path != "/api/tasks":
                    self.send_json(404, {"title": "Not found"})
                    return
                payload = self.read_body()
                with state.lock:
                    state.post_count += 1
                    post_number = state.post_count
                    should_fail = state.fail_posts or (
                        state.fail_after_posts is not None and post_number > state.fail_after_posts
                    )
                if should_fail:
                    self.send_json(503, {"title": "Test failure"})
                    return
                with state.lock:
                    task = state._new_task(payload["title"].strip(), payload.get("description") or "")
                    state.tasks[task["id"]] = task
                if post_number == 1 and state.first_post_delay > 0:
                    time.sleep(state.first_post_delay)
                public_task = {key: value for key, value in task.items() if not key.startswith("_")}
                location = f"/api/tasks/{task['id']}"
                if state.location_mode == "absolute":
                    location = f"http://{self.headers['Host']}{location}"
                elif state.location_mode == "foreign":
                    location = f"http://foreign.invalid{location}"
                if state.mangle_create_response:
                    public_task["title"] = "Incorrect create response"
                self.send_json(201, public_task, {"Location": location, "ETag": '"0"'})

            def do_PUT(self) -> None:
                task_id = self.path.rsplit("/", 1)[-1]
                payload = self.read_body()
                with state.lock:
                    task = state.tasks.get(task_id)
                    if task is None:
                        self.send_json(404, {"title": "Not found"})
                        return
                    if self.headers.get("If-Match") != f'"{task["version"]}"':
                        self.send_json(412, {"title": "Stale version"})
                        return
                    if not state.ignore_update:
                        task["title"] = payload["title"].strip()
                        task["description"] = payload.get("description") or ""
                        task["version"] += state.version_step
                    result = {key: value for key, value in task.items() if not key.startswith("_")}
                self.send_json(200, result, {"ETag": f'"{result["version"]}"'})

            def do_DELETE(self) -> None:
                task_id = self.path.rsplit("/", 1)[-1]
                with state.lock:
                    task = state.tasks.get(task_id)
                    if task is None:
                        self.send_json(404, {"title": "Not found"})
                        return
                    if self.headers.get("If-Match") != f'"{task["version"]}"':
                        self.send_json(412, {"title": "Stale version"})
                        return
                    del state.tasks[task_id]
                self.send_empty(204)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.server.server_port}"

    def __enter__(self) -> "FakeTaskApiServer":
        self.thread.start()
        return self

    def __exit__(self, exception_type: Any, exception: Any, traceback: Any) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)


class CountingProxyServer:
    """Local-only HTTP proxy fixture recording any request it receives."""

    def __init__(self) -> None:
        self.requests: list[str] = []
        requests = self.requests

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format_string: str, *args: Any) -> None:
                return

            def do_GET(self) -> None:
                requests.append(self.path)
                self.send_response(502)
                self.send_header("Content-Length", "0")
                self.end_headers()

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.server.server_port}"

    def __enter__(self) -> "CountingProxyServer":
        self.thread.start()
        return self

    def __exit__(self, exception_type: Any, exception: Any, traceback: Any) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)


class TaskFlowBenchmarkSafetyTest(unittest.TestCase):
    """Exercise safety gates and a small explicitly non-acceptance run."""

    def config(self, base_url: str, **overrides: Any) -> Any:
        values = {
            "base_url": base_url,
            "database_label": "fake-isolated-test-db",
            "confirmation": benchmark.CONFIRMATION_TEXT,
            "fixture_count": 8,
            "samples": 3,
            "concurrency": 2,
            "timeout_seconds": 5.0,
        }
        values.update(overrides)
        return benchmark.BenchmarkConfig(**values)

    def test_scaled_run_measures_operations_and_keeps_only_its_fixture(self) -> None:
        with FakeTaskApiServer() as server:
            report = benchmark.run_benchmark(self.config(server.base_url))
            self.assertEqual("completed", report["status"])
            self.assertEqual("scaled_non_acceptance", report["run_kind"])
            self.assertIsNone(report["acceptance_result"])
            self.assertEqual(8, report["counts"]["fixture_created"])
            self.assertEqual(8, report["counts"]["total_after_run"])
            for operation in ("list", "search", "create", "update", "delete"):
                self.assertEqual(3, report["operations"][operation]["requested_samples"])
                self.assertEqual(3, report["operations"][operation]["successful_samples"])
                self.assertEqual(2, report["operations"][operation]["max_concurrency"])
            self.assertEqual(8, len(server.state.tasks))

    def test_nonempty_preflight_aborts_before_any_write(self) -> None:
        with FakeTaskApiServer() as server:
            existing = server.state.add_existing_task("Do not touch", "Pre-existing task")
            report = benchmark.run_benchmark(self.config(server.base_url))
            self.assertEqual("failed", report["status"])
            self.assertIn("task list is not empty", report["errors"][0])
            self.assertEqual(1, len(server.state.tasks))
            self.assertEqual("Do not touch", server.state.tasks[existing["id"]]["title"])
            self.assertEqual(0, report["counts"]["fixture_created"])

    def test_non_loopback_url_rejected_before_request(self) -> None:
        report = benchmark.run_benchmark(self.config("http://192.0.2.10:8080"))
        self.assertEqual("failed", report["status"])
        self.assertIn("loopback", report["errors"][0])
        self.assertEqual(0, report["counts"]["fixture_created"])

    def test_missing_explicit_database_confirmation_rejected(self) -> None:
        with FakeTaskApiServer() as server:
            report = benchmark.run_benchmark(self.config(server.base_url, confirmation=""))
            self.assertEqual("failed", report["status"])
            self.assertIn("Explicit confirmation is required", report["errors"][0])
            self.assertEqual(0, len(server.state.tasks))

    def test_api_client_ignores_environment_proxy_for_loopback_requests(self) -> None:
        with FakeTaskApiServer() as api_server, CountingProxyServer() as proxy:
            target_host = "taskflow-proxy-test.invalid"
            original_getaddrinfo = socket.getaddrinfo

            def resolve_target(host: str, port: Any, *args: Any, **kwargs: Any) -> Any:
                if host == target_host:
                    return original_getaddrinfo("127.0.0.1", api_server.server.server_port, *args, **kwargs)
                return original_getaddrinfo(host, port, *args, **kwargs)

            proxy_env = {
                "http_proxy": proxy.base_url,
                "HTTP_PROXY": proxy.base_url,
                "no_proxy": "",
                "NO_PROXY": "",
            }
            with patch.dict(os.environ, proxy_env):
                with patch("socket.getaddrinfo", side_effect=resolve_target):
                    client = benchmark.TaskFlowApi(f"http://{target_host}:8123", 5.0)
                    status, _, _ = client.request("GET", "/api/tasks?page=0&size=1")

            self.assertEqual(200, status)
            self.assertEqual([], proxy.requests)

    def test_accepts_same_origin_absolute_location(self) -> None:
        with FakeTaskApiServer() as server:
            server.state.location_mode = "absolute"
            report = benchmark.run_benchmark(self.config(server.base_url, fixture_count=4, samples=2))
            self.assertEqual("completed", report["status"])
            self.assertEqual(4, report["counts"]["fixture_created"])
            self.assertEqual(4, report["counts"]["total_after_run"])

    def test_rejects_foreign_location_origin(self) -> None:
        with FakeTaskApiServer() as server:
            server.state.location_mode = "foreign"
            report = benchmark.run_benchmark(self.config(server.base_url))
            self.assertEqual("failed", report["status"])
            self.assertIn("invalid Location", report["errors"][0])

    def test_literal_search_queries_have_expected_fixture_counts(self) -> None:
        with FakeTaskApiServer() as server:
            report = benchmark.run_benchmark(
                self.config(server.base_url, fixture_count=260, samples=8)
            )
            self.assertEqual("completed", report["status"])
            query_details = report["query_mix"]["unique_search_queries"]
            self.assertEqual(3, query_details["literal%marker"]["expected_matches"])
            self.assertEqual(3, query_details["under_score_marker"]["expected_matches"])

    def test_search_ignoring_query_is_rejected(self) -> None:
        with FakeTaskApiServer() as server:
            server.state.ignore_search = True
            report = benchmark.run_benchmark(
                self.config(server.base_url, fixture_count=80, samples=8)
            )
            self.assertEqual("failed", report["status"])
            self.assertTrue(report["operations"]["search"]["failed_samples"] > 0)
            self.assertIn("expected", report["operations"]["search"]["errors"][0])

    def test_create_response_fields_are_checked(self) -> None:
        with FakeTaskApiServer() as server:
            server.state.mangle_create_response = True
            report = benchmark.run_benchmark(self.config(server.base_url))
            self.assertEqual("failed", report["status"])
            self.assertIn("fields did not match", report["operations"]["fixture_seed"]["errors"][0])

    def test_update_response_fields_and_version_progression_are_checked(self) -> None:
        with FakeTaskApiServer() as server:
            server.state.ignore_update = True
            report = benchmark.run_benchmark(self.config(server.base_url))
            self.assertEqual("failed", report["status"])
            self.assertIn("fields did not match", report["operations"]["update"]["errors"][0])

        with FakeTaskApiServer() as server:
            server.state.version_step = 2
            report = benchmark.run_benchmark(self.config(server.base_url))
            self.assertEqual("failed", report["status"])
            self.assertIn("version did not advance by exactly one", report["operations"]["update"]["errors"][0])

    def test_fatal_seed_failure_is_bounded_and_reports_partial_work(self) -> None:
        with FakeTaskApiServer() as server:
            server.state.fail_after_posts = 1
            server.state.first_post_delay = 0.1
            report = benchmark.run_benchmark(
                self.config(server.base_url, fixture_count=8, samples=4, concurrency=2)
            )
            seed_report = report["operations"]["fixture_seed"]
            self.assertEqual("failed", report["status"])
            self.assertEqual(2, seed_report["submitted_samples"])
            self.assertEqual(6, seed_report["not_submitted_samples"])
            self.assertGreaterEqual(seed_report["failed_samples"], 1)
            self.assertEqual(1, report["counts"]["fixture_created"])
            self.assertEqual(1, len(server.state.tasks))

    def test_acceptance_run_requires_backend_and_postgres_version_metadata(self) -> None:
        with FakeTaskApiServer() as server:
            config = self.config(
                server.base_url,
                fixture_count=10_000,
                samples=200,
                concurrency=5,
            )
            report = benchmark.run_benchmark(config)
            self.assertEqual("failed", report["status"])
            self.assertIn("backend-version", report["errors"][0])
            self.assertEqual(0, len(server.state.tasks))


if __name__ == "__main__":
    unittest.main()
