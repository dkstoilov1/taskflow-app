#!/usr/bin/env python3
"""Seed and benchmark TaskFlow through its HTTP API.

SAFETY: use only with an explicitly confirmed, isolated, empty test database.
The benchmark never deletes or updates records unless their IDs were returned
by its own seed/create requests. It leaves the 10,000-task fixture in place.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import ipaddress
import json
import math
import os
import platform
import random
import socket
import statistics
import sys
import threading
import time
import uuid
from concurrent.futures import FIRST_COMPLETED, wait
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener


API_PATH = "/api/tasks"
P95_TARGET_MS = 500.0
MAX_CONCURRENCY = 5
CONFIRMATION_TEXT = "I_CONFIRM_THIS_IS_AN_ISOLATED_EMPTY_TEST_DATABASE"
RANDOM_SEED = 20261102


class BenchmarkFailure(RuntimeError):
    """Raised when an API response or safety precondition is invalid."""


@dataclass(frozen=True)
class BenchmarkConfig:
    """Inputs controlling one explicitly authorized benchmark run."""

    base_url: str
    database_label: str
    confirmation: str
    fixture_count: int = 10_000
    samples: int = 200
    concurrency: int = 5
    timeout_seconds: float = 30.0
    backend_version: str | None = None
    postgres_version: str | None = None


class NoRedirectHandler(HTTPRedirectHandler):
    """Prevent requests from being redirected away from the verified loopback URL."""

    def redirect_request(self, request: Request, response: Any, code: int, message: str, headers: Any, new_url: str) -> None:
        return None


class TaskFlowApi:
    """Small standard-library HTTP client for the frozen TaskFlow contract."""

    def __init__(self, base_url: str, timeout_seconds: float) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        # Ignore environment and system proxy configuration, even for loopback URLs.
        self.opener = build_opener(ProxyHandler({}), NoRedirectHandler())

    def request(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[int, Any, dict[str, str]]:
        request_headers = {"Accept": "application/json"}
        request_headers.update(headers or {})
        encoded_body = None
        if body is not None:
            encoded_body = json.dumps(body, ensure_ascii=False).encode("utf-8")
            request_headers["Content-Type"] = "application/json"

        request = Request(
            self.base_url + path,
            data=encoded_body,
            headers=request_headers,
            method=method,
        )
        try:
            with self.opener.open(request, timeout=self.timeout_seconds) as response:
                status = response.status
                raw_body = response.read()
                response_headers = {key.lower(): value for key, value in response.headers.items()}
        except HTTPError as error:
            error.close()
            raise BenchmarkFailure(f"{method} request returned HTTP {error.code}.") from None
        except URLError as error:
            raise BenchmarkFailure(f"{method} request failed: {error.reason}.") from None
        except OSError as error:
            raise BenchmarkFailure(f"{method} request failed: {error}.") from None

        if status == 204:
            if raw_body:
                raise BenchmarkFailure(f"{method} returned 204 with a non-empty response body.")
            return status, None, response_headers
        if not raw_body:
            return status, None, response_headers
        try:
            return status, json.loads(raw_body.decode("utf-8")), response_headers
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise BenchmarkFailure(f"{method} returned a non-JSON response.") from None


def validate_loopback_base_url(base_url: str) -> str:
    """Validate an explicit HTTP origin that resolves only to loopback addresses."""

    try:
        parsed = urlsplit(base_url)
        hostname = parsed.hostname
        port = parsed.port
    except ValueError as error:
        raise BenchmarkFailure(f"Invalid base URL: {error}.") from None

    if parsed.scheme.lower() != "http" or not hostname or port is None:
        raise BenchmarkFailure("Base URL must be an explicit http:// loopback origin with a port.")
    if parsed.username is not None or parsed.password is not None:
        raise BenchmarkFailure("Credentials are not allowed in the base URL.")
    if parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        raise BenchmarkFailure("Base URL must contain only the server origin; the API path is added by the benchmark.")

    addresses: set[str]
    if hostname.lower() == "localhost":
        try:
            addresses = {item[4][0] for item in socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)}
        except OSError:
            raise BenchmarkFailure("Could not resolve localhost to a loopback address.") from None
        if not addresses:
            raise BenchmarkFailure("localhost did not resolve to an address.")
        if any(not ipaddress.ip_address(address.split("%", 1)[0]).is_loopback for address in addresses):
            raise BenchmarkFailure("Every resolved localhost address must be loopback.")
    else:
        try:
            address = ipaddress.ip_address(hostname)
        except ValueError:
            raise BenchmarkFailure("Use 127.0.0.1, ::1, or localhost; DNS aliases are not accepted.") from None
        if not address.is_loopback:
            raise BenchmarkFailure("Base URL must use a loopback address.")

    return f"http://{parsed.netloc}"


def validate_config(config: BenchmarkConfig) -> str:
    """Check all write-safety conditions before the benchmark makes a request."""

    if config.confirmation != CONFIRMATION_TEXT:
        raise BenchmarkFailure(
            "Explicit confirmation is required: pass --confirmation "
            f"{CONFIRMATION_TEXT} only for a dedicated isolated empty test database."
        )
    if not config.database_label.strip():
        raise BenchmarkFailure("An explicit isolated database label is required.")
    if config.fixture_count < 1:
        raise BenchmarkFailure("Fixture count must be at least 1.")
    if config.samples < 1:
        raise BenchmarkFailure("Sample count must be at least 1.")
    if not 1 <= config.concurrency <= MAX_CONCURRENCY:
        raise BenchmarkFailure(f"Concurrency must be between 1 and {MAX_CONCURRENCY}.")
    if config.timeout_seconds <= 0:
        raise BenchmarkFailure("Timeout must be greater than zero.")
    is_acceptance_candidate = (
        config.fixture_count == 10_000 and config.samples >= 200 and config.concurrency == MAX_CONCURRENCY
    )
    if is_acceptance_candidate and (
        not config.backend_version or not config.backend_version.strip()
        or not config.postgres_version or not config.postgres_version.strip()
    ):
        raise BenchmarkFailure(
            "Acceptance runs require explicit --backend-version and --postgres-version metadata."
        )
    return validate_loopback_base_url(config.base_url)


def environment_details(config: BenchmarkConfig) -> dict[str, Any]:
    """Return non-secret machine/runtime details for the benchmark report."""

    return {
        "python": platform.python_version(),
        "platform": platform.platform(),
        "machine": platform.machine(),
        "processor": platform.processor(),
        "logical_cpu_count": os.cpu_count(),
        "backend_version": config.backend_version,
        "postgresql_version": config.postgres_version,
    }


def parse_task(value: Any, operation: str) -> dict[str, Any]:
    """Validate a Task response before using its ID or version."""

    if not isinstance(value, dict):
        raise BenchmarkFailure(f"{operation} response was not a task object.")
    task_id = value.get("id")
    try:
        uuid.UUID(str(task_id))
    except (ValueError, TypeError, AttributeError):
        raise BenchmarkFailure(f"{operation} response contained an invalid task ID.") from None
    version = value.get("version")
    if isinstance(version, bool) or not isinstance(version, int) or version < 0:
        raise BenchmarkFailure(f"{operation} response contained an invalid task version.")
    if not isinstance(value.get("title"), str) or not isinstance(value.get("description"), str):
        raise BenchmarkFailure(f"{operation} response contained invalid task fields.")
    return value


def validate_etag(headers: dict[str, str], version: int, operation: str) -> str:
    """Require the contract's strong quoted decimal version ETag."""

    etag = headers.get("etag", "")
    if etag != f'"{version}"':
        raise BenchmarkFailure(f"{operation} response had an invalid or mismatched ETag.")
    return etag


def fixture_payload(index: int) -> dict[str, str]:
    """Build deterministic varied fixture text with common, rare, and literal markers."""

    bucket = index % 40
    title = f"Fixture task {index:05d} segment-{bucket:02d}"
    description = (
        f"Benchmark fixture record {index:05d}; category={bucket:02d}; "
        f"weekday={(index * 7) % 31:02d}; notes vary by record."
    )
    if index % 50 == 0:
        description += f" rare-token-{index:05d}"
    if index % 100 == 0:
        description += " literal%marker"
    if index % 125 == 0:
        description += " under_score_marker"
    if index % 17 == 0:
        description += "\nSecond line preserves description whitespace."
    return {"title": title, "description": description}


def query_for_sample(index: int, fixture_count: int) -> tuple[str, str]:
    """Return a deterministic query and its query-mix label."""

    choice = index % 4
    if choice == 0:
        return "fixture", "common"
    if choice == 1:
        return f"segment-{index % 40:02d}", "category"
    if choice == 2:
        rare_index = (index % max(1, (fixture_count + 49) // 50)) * 50
        if rare_index >= fixture_count:
            rare_index = ((fixture_count - 1) // 50) * 50
        return f"rare-token-{rare_index:05d}", "rare"
    if fixture_count > 1:
        if index % 8 == 3:
            return "literal%marker", "literal-wildcard"
        return "under_score_marker", "literal-wildcard"
    return "fixture", "common"


def page_for_sample(index: int, fixture_count: int) -> tuple[int, int]:
    """Return varied page/size values within the seeded fixture range."""

    size = (20, 50, 100)[index % 3]
    page_count = max(1, math.ceil(fixture_count / size))
    page = (index * 37) % page_count
    return page, size


def percentile(values: list[float], percentile_value: float) -> float | None:
    """Return the nearest-rank percentile in milliseconds, or None without samples."""

    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, math.ceil(percentile_value * len(ordered)))
    return ordered[rank - 1]


def summarize_timings(values: list[float]) -> dict[str, Any]:
    """Summarize successful request timings in milliseconds."""

    if not values:
        return {"successful_samples": 0, "p50_ms": None, "p95_ms": None, "p99_ms": None, "mean_ms": None}
    return {
        "successful_samples": len(values),
        "p50_ms": round(percentile(values, 0.50) or 0.0, 3),
        "p95_ms": round(percentile(values, 0.95) or 0.0, 3),
        "p99_ms": round(percentile(values, 0.99) or 0.0, 3),
        "mean_ms": round(statistics.fmean(values), 3),
        "min_ms": round(min(values), 3),
        "max_ms": round(max(values), 3),
    }


def execute_samples(
    operation: str,
    sample_count: int,
    concurrency: int,
    action: Callable[[int], Any],
    report: dict[str, Any],
) -> list[float]:
    """Run bounded samples and stop submitting work after the first fatal error."""

    timings: list[float] = []
    errors: list[str] = []
    submitted = 0
    cancelled = 0
    next_index = 0

    def timed_action(index: int) -> float:
        started = time.perf_counter()
        measured_latency = action(index)
        harness_elapsed = (time.perf_counter() - started) * 1000.0
        if isinstance(measured_latency, (int, float)) and not isinstance(measured_latency, bool):
            return float(measured_latency)
        return harness_elapsed

    executor = concurrent.futures.ThreadPoolExecutor(max_workers=concurrency)
    futures: dict[concurrent.futures.Future[float], int] = {}

    def submit_next() -> None:
        nonlocal next_index, submitted
        future = executor.submit(timed_action, next_index)
        futures[future] = next_index
        next_index += 1
        submitted += 1

    for _ in range(min(sample_count, concurrency)):
        submit_next()

    failed = False
    try:
        while futures and not failed:
            completed, _ = wait(futures, return_when=FIRST_COMPLETED)
            for future in completed:
                sample_index = futures.pop(future)
                try:
                    timings.append(future.result())
                except Exception as error:  # no response bodies are dumped
                    errors.append(f"sample {sample_index}: {error}")
                    failed = True

            if failed:
                for future in futures:
                    if future.cancel():
                        cancelled += 1
                executor.shutdown(wait=True, cancel_futures=True)
                for future, sample_index in list(futures.items()):
                    if future.cancelled():
                        continue
                    try:
                        timings.append(future.result())
                    except Exception as error:
                        errors.append(f"sample {sample_index}: {error}")
                futures.clear()
                break

            while len(futures) < concurrency and next_index < sample_count:
                submit_next()
    finally:
        executor.shutdown(wait=True, cancel_futures=failed)

    report["operations"][operation] = summarize_timings(timings)
    report["operations"][operation]["requested_samples"] = sample_count
    report["operations"][operation]["submitted_samples"] = submitted
    report["operations"][operation]["successful_samples"] = len(timings)
    report["operations"][operation]["failed_samples"] = len(errors)
    report["operations"][operation]["cancelled_samples"] = cancelled
    report["operations"][operation]["not_submitted_samples"] = sample_count - submitted
    report["operations"][operation]["max_concurrency"] = concurrency
    if errors:
        report["operations"][operation]["errors"] = errors[:10]
        raise BenchmarkFailure(f"{operation} had {len(errors)} failed sample(s); first: {errors[0]}")
    return timings


def fixture_matches(query: str, fixture_payloads: dict[int, dict[str, str]]) -> set[int]:
    """Return exact case-insensitive literal-substring matches in the generated fixture."""

    needle = query.strip().casefold()
    return {
        index
        for index, payload in fixture_payloads.items()
        if needle in payload["title"].casefold() or needle in payload["description"].casefold()
    }


def validate_fixture_page(
    body: dict[str, Any],
    operation: str,
    page: int,
    size: int,
    matching_indices: set[int],
    fixture_tasks: dict[int, dict[str, Any]],
    fixture_payloads: dict[int, dict[str, str]],
    fixture_index_by_id: dict[str, int],
    ordered_fixture_ids: list[str] | None,
) -> None:
    """Assert paginated results and totals are exactly consistent with owned fixture data."""

    expected_total = len(matching_indices)
    expected_items = max(0, min(size, expected_total - page * size))
    expected_pages = math.ceil(expected_total / size) if expected_total else 0
    if body["page"] != page or body["size"] != size:
        raise BenchmarkFailure(f"{operation} returned incorrect page metadata.")
    if body["totalElements"] != expected_total or body["totalPages"] != expected_pages:
        raise BenchmarkFailure(
            f"{operation} returned totalElements={body['totalElements']}; expected {expected_total}."
        )
    if len(body["items"]) != expected_items:
        raise BenchmarkFailure(f"{operation} returned {len(body['items'])} items; expected {expected_items}.")

    if ordered_fixture_ids is not None:
        expected_order = [
            task_id
            for task_id in ordered_fixture_ids
            if fixture_index_by_id[task_id] in matching_indices
        ]
        expected_page_ids = expected_order[page * size : page * size + size]
        actual_page_ids = [task["id"] for task in body["items"]]
        if actual_page_ids != expected_page_ids:
            raise BenchmarkFailure(f"{operation} returned an inconsistent page or ordering.")

    seen: set[str] = set()
    for task in body["items"]:
        fixture_index = fixture_index_by_id.get(task["id"])
        if fixture_index is None or fixture_index not in matching_indices:
            raise BenchmarkFailure(f"{operation} returned a task outside the expected fixture matches.")
        expected = fixture_payloads[fixture_index]
        if task["title"] != expected["title"] or task["description"] != expected["description"]:
            raise BenchmarkFailure(f"{operation} returned mismatched fixture fields.")
        if task["version"] != fixture_tasks[fixture_index]["version"]:
            raise BenchmarkFailure(f"{operation} returned an unexpected fixture version.")
        if task["id"] in seen:
            raise BenchmarkFailure(f"{operation} returned a duplicate task.")
        seen.add(task["id"])


def capture_fixture_order(
    api: TaskFlowApi,
    fixture_tasks: dict[int, dict[str, Any]],
    fixture_payloads: dict[int, dict[str, str]],
) -> tuple[list[str], dict[str, int]]:
    """Reconcile every fixture task through pages before timed list/search samples."""

    fixture_index_by_id = {task["id"]: index for index, task in fixture_tasks.items()}
    matching_indices = set(fixture_tasks)
    page_size = 100
    expected_page_count = math.ceil(len(fixture_tasks) / page_size)
    ordered_ids: list[str] = []
    for page in range(expected_page_count):
        path = f"{API_PATH}?{urlencode({'page': page, 'size': page_size})}"
        status, body, _ = api.request("GET", path)
        if status != 200:
            raise BenchmarkFailure(f"Fixture reconciliation expected HTTP 200 and received {status}.")
        list_body = validate_list_response(body, "fixture reconciliation")
        validate_fixture_page(
            list_body,
            "fixture reconciliation",
            page,
            page_size,
            matching_indices,
            fixture_tasks,
            fixture_payloads,
            fixture_index_by_id,
            None,
        )
        ordered_ids.extend(task["id"] for task in list_body["items"])

    if len(ordered_ids) != len(fixture_tasks) or len(set(ordered_ids)) != len(fixture_tasks):
        raise BenchmarkFailure("Fixture reconciliation found missing or duplicate tasks across pages.")
    if set(ordered_ids) != set(fixture_index_by_id):
        raise BenchmarkFailure("Fixture reconciliation found tasks outside the run-owned fixture.")
    return ordered_ids, fixture_index_by_id


def validate_location(location: str, expected_path: str, base_url: str, operation: str) -> None:
    """Accept relative or same-origin absolute Location references for the created task."""

    try:
        resolved = urlsplit(urljoin(base_url.rstrip("/") + "/", location))
        origin = urlsplit(base_url)
        is_same_origin = (
            resolved.scheme.lower() == origin.scheme.lower()
            and (resolved.hostname or "").lower() == (origin.hostname or "").lower()
            and resolved.port == origin.port
            and resolved.username is None
            and resolved.password is None
        )
    except ValueError:
        raise BenchmarkFailure(f"{operation} response had an invalid Location header.") from None
    if not is_same_origin or resolved.path.rstrip("/") != expected_path or resolved.query or resolved.fragment:
        raise BenchmarkFailure(f"{operation} response had an invalid Location header.")


def validate_list_response(body: Any, operation: str) -> dict[str, Any]:
    """Check the required paginated task-list response shape."""

    if not isinstance(body, dict) or not isinstance(body.get("items"), list):
        raise BenchmarkFailure(f"{operation} response did not contain an items array.")
    for field in ("page", "size", "totalElements", "totalPages"):
        value = body.get(field)
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise BenchmarkFailure(f"{operation} response contained an invalid {field} value.")
    if not 1 <= body["size"] <= 100:
        raise BenchmarkFailure(f"{operation} response contained an invalid page size.")
    for task in body["items"]:
        parse_task(task, operation)
    return body


def create_task(api: TaskFlowApi, payload: dict[str, str], operation: str) -> tuple[dict[str, Any], float]:
    """Create one task and validate its body, Location, and ETag."""

    request_started = time.perf_counter()
    status, body, headers = api.request("POST", API_PATH, payload)
    request_elapsed_ms = (time.perf_counter() - request_started) * 1000.0
    if status != 201:
        raise BenchmarkFailure(f"{operation} expected HTTP 201 and received {status}.")
    task = parse_task(body, operation)
    if task["title"] != payload["title"].strip() or task["description"] != (payload.get("description") or ""):
        raise BenchmarkFailure(f"{operation} response fields did not match the created task.")
    if task["version"] != 0:
        raise BenchmarkFailure(f"{operation} response did not start at version 0.")
    location = headers.get("location", "")
    expected_path = f"{API_PATH}/{task['id']}"
    validate_location(location, expected_path, api.base_url, operation)
    validate_etag(headers, task["version"], operation)
    return task, request_elapsed_ms


def make_report(config: BenchmarkConfig, normalized_base_url: str) -> dict[str, Any]:
    """Initialize the machine-readable report before making any API writes."""

    acceptance_candidate = config.fixture_count == 10_000 and config.samples >= 200 and config.concurrency == 5
    run_kind = "acceptance_candidate" if acceptance_candidate else "scaled_non_acceptance"
    return {
        "status": "running",
        "run_kind": run_kind,
        "acceptance_result": None,
        "started_at_utc": datetime.now(timezone.utc).isoformat(),
        "configuration": {
            "base_url": normalized_base_url,
            "database_label": config.database_label,
            "fixture_count_target": config.fixture_count,
            "samples_per_operation": config.samples,
            "concurrency": config.concurrency,
            "timeout_seconds": config.timeout_seconds,
            "p95_target_ms": P95_TARGET_MS,
        },
        "environment": environment_details(config),
        "confirmation": "User confirmed a dedicated isolated empty test database; API empty-list preflight is required.",
        "query_mix": {
            "list": "page=size 20, 50, 100; deterministic varied pages",
            "search": "common substring, category substring, rare-token substring, literal % and _ markers",
            "search_sample_counts": {},
            "mutations": "unique creates; updates only to fixture IDs created in this run; deletes only to benchmark-created disposable IDs",
        },
        "counts": {
            "empty_preflight_confirmed": False,
            "fixture_created": 0,
            "disposable_created": 0,
            "disposable_deleted": 0,
            "total_after_run": None,
        },
        "seed_elapsed_seconds": None,
        "operations": {},
        "errors": [],
    }


def run_benchmark(config: BenchmarkConfig, api: TaskFlowApi | Any | None = None) -> dict[str, Any]:
    """Run preflight, create the fixture, benchmark CRUD/list/search, and return a report."""

    started_at = time.perf_counter()
    acceptance_candidate = config.fixture_count == 10_000 and config.samples >= 200 and config.concurrency == 5
    report: dict[str, Any] = {
        "status": "failed",
        "run_kind": "acceptance_candidate" if acceptance_candidate else "scaled_non_acceptance",
        "acceptance_result": None,
        "started_at_utc": datetime.now(timezone.utc).isoformat(),
        "configuration": {
            "base_url": config.base_url,
            "database_label": config.database_label,
            "fixture_count_target": config.fixture_count,
            "samples_per_operation": config.samples,
            "concurrency": config.concurrency,
            "timeout_seconds": config.timeout_seconds,
            "p95_target_ms": P95_TARGET_MS,
        },
        "environment": environment_details(config),
        "counts": {
            "empty_preflight_confirmed": False,
            "fixture_created": 0,
            "disposable_created": 0,
            "disposable_deleted": 0,
            "total_after_run": None,
        },
        "seed_elapsed_seconds": None,
        "query_mix": {},
        "operations": {},
        "errors": [],
    }

    try:
        normalized_base_url = validate_config(config)
        report = make_report(config, normalized_base_url)
        client = api if api is not None else TaskFlowApi(normalized_base_url, config.timeout_seconds)

        preflight_path = f"{API_PATH}?{urlencode({'page': 0, 'size': 1})}"
        preflight_status, preflight_body, _ = client.request("GET", preflight_path)
        if preflight_status != 200:
            raise BenchmarkFailure(f"Empty-database preflight expected HTTP 200 and received {preflight_status}.")
        preflight = validate_list_response(preflight_body, "empty-database preflight")
        if preflight["items"] or preflight["totalElements"] != 0:
            raise BenchmarkFailure("Refusing to seed: the task list is not empty. No task was changed or deleted.")
        report["counts"]["empty_preflight_confirmed"] = True

        fixture_payloads = {
            index: fixture_payload(index)
            for index in range(config.fixture_count)
        }
        fixture_tasks: dict[int, dict[str, Any]] = {}
        fixture_lock = threading.Lock()

        def seed_one(index: int) -> None:
            created, _ = create_task(client, fixture_payloads[index], "fixture create")
            with fixture_lock:
                fixture_tasks[index] = created

        seed_started = time.perf_counter()
        try:
            execute_samples(
                "fixture_seed",
                config.fixture_count,
                config.concurrency,
                seed_one,
                report,
            )
        finally:
            report["seed_elapsed_seconds"] = round(time.perf_counter() - seed_started, 3)
            report["counts"]["fixture_created"] = len(fixture_tasks)
        if len(fixture_tasks) != config.fixture_count:
            raise BenchmarkFailure(f"Expected {config.fixture_count} fixture tasks, created {len(fixture_tasks)}.")

        snapshot_started = time.perf_counter()
        ordered_fixture_ids, fixture_index_by_id = capture_fixture_order(
            client,
            fixture_tasks,
            fixture_payloads,
        )
        report["counts"]["fixture_snapshot_reconciled"] = len(ordered_fixture_ids)
        report["fixture_snapshot_elapsed_seconds"] = round(time.perf_counter() - snapshot_started, 3)

        randomizer = random.Random(RANDOM_SEED)
        list_requests = [
            page_for_sample(randomizer.randrange(config.fixture_count), config.fixture_count)
            for _ in range(config.samples)
        ]
        search_requests: list[tuple[str, str, set[int]]] = []
        search_counts: dict[str, int] = {}
        expected_search_ids: dict[str, set[int]] = {}
        query_details: dict[str, dict[str, Any]] = {}
        for index in range(config.samples):
            query, label = query_for_sample(index, config.fixture_count)
            if query not in expected_search_ids:
                expected_search_ids[query] = fixture_matches(query, fixture_payloads)
                query_details[query] = {
                    "classification": label,
                    "expected_matches": len(expected_search_ids[query]),
                }
            search_requests.append((query, label, expected_search_ids[query]))
            search_counts[label] = search_counts.get(label, 0) + 1
        report["query_mix"] = {
            "list": "page=size 20, 50, 100; deterministic varied pages",
            "search": "common substring, category substring, rare-token substring, literal % and _ markers",
            "search_sample_counts": search_counts,
            "unique_search_queries": query_details,
            "list_page_sizes": {"20": 0, "50": 0, "100": 0},
            "mutation_ownership": "updates target only IDs returned by this run's fixture POSTs; deletes target only IDs returned by this run's disposable POSTs",
        }
        for _, size in list_requests:
            report["query_mix"]["list_page_sizes"][str(size)] += 1

        def list_action(index: int) -> float:
            page, size = list_requests[index]
            path = f"{API_PATH}?{urlencode({'page': page, 'size': size})}"
            request_started = time.perf_counter()
            status, body, _ = client.request("GET", path)
            request_elapsed_ms = (time.perf_counter() - request_started) * 1000.0
            if status != 200:
                raise BenchmarkFailure(f"List sample expected HTTP 200 and received {status}.")
            list_body = validate_list_response(body, "list sample")
            validate_fixture_page(
                list_body,
                "list sample",
                page,
                size,
                set(fixture_tasks),
                fixture_tasks,
                fixture_payloads,
                fixture_index_by_id,
                ordered_fixture_ids,
            )
            return request_elapsed_ms

        execute_samples("list", config.samples, config.concurrency, list_action, report)

        def search_action(index: int) -> float:
            query, _, matching_indices = search_requests[index]
            path = f"{API_PATH}?{urlencode({'page': 0, 'size': 20, 'q': query})}"
            request_started = time.perf_counter()
            status, body, _ = client.request("GET", path)
            request_elapsed_ms = (time.perf_counter() - request_started) * 1000.0
            if status != 200:
                raise BenchmarkFailure(f"Search sample expected HTTP 200 and received {status}.")
            list_body = validate_list_response(body, "search sample")
            validate_fixture_page(
                list_body,
                "search sample",
                0,
                20,
                matching_indices,
                fixture_tasks,
                fixture_payloads,
                fixture_index_by_id,
                ordered_fixture_ids,
            )
            return request_elapsed_ms

        execute_samples("search", config.samples, config.concurrency, search_action, report)

        disposable_tasks: dict[int, dict[str, Any]] = {}
        disposable_lock = threading.Lock()

        def create_disposable(index: int) -> float:
            payload = {
                "title": f"Benchmark disposable task {index:05d}",
                "description": f"Created by isolated TaskFlow API performance run {RANDOM_SEED}; not fixture data.",
            }
            task, request_elapsed_ms = create_task(client, payload, "benchmark create")
            with disposable_lock:
                disposable_tasks[index] = task
            return request_elapsed_ms

        try:
            execute_samples("create", config.samples, config.concurrency, create_disposable, report)
        finally:
            report["counts"]["disposable_created"] = len(disposable_tasks)

        update_locks = {index: threading.Lock() for index in range(config.fixture_count)}

        def update_fixture(index: int) -> float:
            fixture_index = index % config.fixture_count
            with update_locks[fixture_index]:
                current = fixture_tasks[fixture_index]
                payload = {
                    "title": f"Benchmark updated fixture {fixture_index:05d} sample {index:05d}",
                    "description": f"Updated only by this benchmark run; iteration {index:05d}.",
                }
                request_started = time.perf_counter()
                status, body, headers = client.request(
                    "PUT",
                    f"{API_PATH}/{current['id']}",
                    payload,
                    {"If-Match": f'"{current["version"]}"'},
                )
                request_elapsed_ms = (time.perf_counter() - request_started) * 1000.0
                if status != 200:
                    raise BenchmarkFailure(f"Update sample expected HTTP 200 and received {status}.")
                updated = parse_task(body, "benchmark update")
                if updated["id"] != current["id"]:
                    raise BenchmarkFailure("Update response returned a different task ID.")
                if updated["title"] != payload["title"] or updated["description"] != payload["description"]:
                    raise BenchmarkFailure("Update response fields did not match the replacement request.")
                if updated["version"] != current["version"] + 1:
                    raise BenchmarkFailure("Update response version did not advance by exactly one.")
                validate_etag(headers, updated["version"], "benchmark update")
                fixture_tasks[fixture_index] = updated
                return request_elapsed_ms

        execute_samples("update", config.samples, config.concurrency, update_fixture, report)

        deleted_disposable_count = [0]
        deleted_lock = threading.Lock()

        def delete_disposable(index: int) -> float:
            task = disposable_tasks[index]
            request_started = time.perf_counter()
            status, body, _ = client.request(
                "DELETE",
                f"{API_PATH}/{task['id']}",
                headers={"If-Match": f'"{task["version"]}"'},
            )
            request_elapsed_ms = (time.perf_counter() - request_started) * 1000.0
            if status != 204 or body is not None:
                raise BenchmarkFailure(f"Delete sample expected an empty HTTP 204 and received {status}.")
            with deleted_lock:
                deleted_disposable_count[0] += 1
            return request_elapsed_ms

        try:
            execute_samples("delete", config.samples, config.concurrency, delete_disposable, report)
        finally:
            report["counts"]["disposable_deleted"] = deleted_disposable_count[0]

        final_status, final_body, _ = client.request("GET", preflight_path)
        if final_status != 200:
            raise BenchmarkFailure(f"Final count check expected HTTP 200 and received {final_status}.")
        final_list = validate_list_response(final_body, "final count check")
        report["counts"]["total_after_run"] = final_list["totalElements"]
        if final_list["totalElements"] != config.fixture_count:
            raise BenchmarkFailure(
                "Final task count differs from the fixture target; possible concurrent database use detected. "
                "No pre-existing task was modified or deleted."
            )

        report["status"] = "completed"
        if report["run_kind"] == "acceptance_candidate":
            all_operations_met_target = all(
                report["operations"][name]["p95_ms"] is not None
                and report["operations"][name]["p95_ms"] < P95_TARGET_MS
                for name in ("list", "search", "create", "update", "delete")
            )
            report["acceptance_result"] = bool(all_operations_met_target)
        else:
            report["acceptance_result"] = None
    except Exception as error:
        report["status"] = "failed"
        report["errors"].append(str(error))
        report["acceptance_result"] = None

    report["finished_at_utc"] = datetime.now(timezone.utc).isoformat()
    report["elapsed_seconds"] = round(time.perf_counter() - started_at, 3)
    return report


def build_argument_parser() -> argparse.ArgumentParser:
    """Create the CLI parser with explicit database-safety confirmations."""

    parser = argparse.ArgumentParser(
        description="Seed and benchmark TaskFlow's HTTP API. Never run against live or valuable data."
    )
    parser.add_argument("--base-url", required=True, help="Explicit loopback origin, e.g. http://127.0.0.1:8080")
    parser.add_argument("--database-label", required=True, help="Human-readable label of the isolated empty test database")
    parser.add_argument(
        "--confirmation",
        required=True,
        help=f"Must exactly equal {CONFIRMATION_TEXT}",
    )
    parser.add_argument("--fixture-count", type=int, default=10_000, help="Task count; values below 10000 are non-acceptance runs")
    parser.add_argument("--samples", type=int, default=200, help="Samples per list/search/create/update/delete operation")
    parser.add_argument("--concurrency", type=int, default=5, help=f"Maximum workers (1-{MAX_CONCURRENCY})")
    parser.add_argument("--timeout-seconds", type=float, default=30.0)
    parser.add_argument("--backend-version", help="Operator-provided backend build/version; required for acceptance runs")
    parser.add_argument("--postgres-version", help="Operator-provided PostgreSQL server version; required for acceptance runs")
    parser.add_argument("--report", help="JSON report path; default is a timestamped file in the current directory")
    return parser


def reserve_report_path(requested_path: str | None) -> tuple[Path, Any]:
    """Reserve a report file before API writes so existing reports are never replaced."""
    if requested_path:
        report_path = Path(requested_path).resolve()
    else:
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        report_path = Path.cwd() / f"taskflow-api-benchmark-{timestamp}.json"
    if not report_path.parent.is_dir():
        raise BenchmarkFailure(f"Report directory does not exist: {report_path.parent}")
    try:
        output = report_path.open("x", encoding="utf-8", newline="\n")
    except FileExistsError:
        raise BenchmarkFailure(f"Refusing to overwrite an existing report: {report_path}") from None
    output.write(
        json.dumps(
            {"status": "running", "note": "Interrupted runs may leave partial fixture tasks."},
            ensure_ascii=False,
        )
        + "\n"
    )
    output.flush()
    return report_path, output


def write_report(report: dict[str, Any], output: Any) -> None:
    """Replace the content of this run's reserved report file with the final JSON."""

    output.seek(0)
    output.truncate()
    json.dump(report, output, ensure_ascii=False, indent=2)
    output.write("\n")
    output.flush()


def main(argv: list[str] | None = None) -> int:
    """Run the CLI benchmark and persist its result."""

    parser = build_argument_parser()
    arguments = parser.parse_args(argv)
    config = BenchmarkConfig(
        base_url=arguments.base_url,
        database_label=arguments.database_label,
        confirmation=arguments.confirmation,
        fixture_count=arguments.fixture_count,
        samples=arguments.samples,
        concurrency=arguments.concurrency,
        timeout_seconds=arguments.timeout_seconds,
        backend_version=arguments.backend_version,
        postgres_version=arguments.postgres_version,
    )
    try:
        report_path, report_output = reserve_report_path(arguments.report)
    except BenchmarkFailure as error:
        print(f"Could not reserve benchmark report: {error}", file=sys.stderr)
        return 1
    try:
        report = run_benchmark(config)
        report["report_path"] = str(report_path)
        write_report(report, report_output)
        print(f"Report: {report_path}")
    except Exception as error:
        print(f"Could not finish benchmark report: {error}", file=sys.stderr)
        return 1
    finally:
        report_output.close()

    print(f"Run status: {report['status']} ({report['run_kind']})")
    if report["status"] != "completed":
        for error in report["errors"]:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1
    if report["run_kind"] == "scaled_non_acceptance":
        print("Scaled run only: acceptance p95 threshold was not assessed.")
    elif report["acceptance_result"]:
        print(f"Acceptance candidate met p95 < {P95_TARGET_MS:.0f} ms for all five operations.")
    else:
        print(f"Acceptance candidate did not meet p95 < {P95_TARGET_MS:.0f} ms for every operation.")
        return 1
    print(
        "Completed samples: "
        + ", ".join(f"{name}={report['operations'][name]['successful_samples']}" for name in ("list", "search", "create", "update", "delete"))
    )
    print(f"Fixture tasks retained: {report['counts']['fixture_created']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
