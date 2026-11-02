# TaskFlow API performance fixture

`taskflow_api_benchmark.py` requires Python 3.10+ and seeds/measures the frozen HTTP contract in
[`../api.md`](../api.md). It is independent of Java/JPA and uses only Python's
standard library. It is an operational write tool, **not safe for live,
valuable, shared, or otherwise non-disposable data**.

## Safety requirements

Before any API write, the tool requires:

1. An explicit `http://` base URL with a port and a loopback host (`127.0.0.1`,
   `::1`, or `localhost` resolving only to loopback).
2. A non-empty human-readable isolated database label.
3. The exact confirmation value shown in the command below.
4. A successful `GET /api/tasks?page=0&size=1` preflight with no items and
   `totalElements: 0`.

The API does not expose its database identity, so the script cannot establish
that the URL is connected to the database named by the label. The operator
must separately verify the backend's database configuration. Use a dedicated,
isolated test database with no valuable data. Do not run this tool against a
live or personal task database.

The script creates fixture tasks using POST. It updates only IDs returned by
its own fixture POSTs and deletes only IDs returned by its own disposable
benchmark POSTs. It never deletes or updates pre-existing tasks. On a
successful run it deletes the disposable create samples, retains the fixture
tasks, and verifies the final task count. If interrupted or if an operation
fails, some tasks created by the run may remain; discard/recreate only the
isolated test database before another run.

## Acceptance run

Default parameters are 10,000 varied fixture tasks, at least 200 samples for
each list/search/create/update/delete operation (the default is 200), maximum
concurrency 5, and a strict p95 target below 500 ms for each operation.
Acceptance runs also require operator-provided backend and PostgreSQL versions:

```powershell
python docs\performance\taskflow_api_benchmark.py `
  --base-url http://127.0.0.1:8080 `
  --database-label taskflow_perf_isolated `
  --confirmation I_CONFIRM_THIS_IS_AN_ISOLATED_EMPTY_TEST_DATABASE `
  --backend-version "TaskFlow backend build version" `
  --postgres-version "PostgreSQL server version"
```

The script records the environment, database label, query mix, fixture and
operation counts, elapsed seed/run times, and per-operation p50/p95/p99/mean
latencies, plus the supplied backend/PostgreSQL version metadata, in a
timestamped JSON report in the current directory. The operator must supply
accurate version values; they are not inferred from the API. Use
`--report <path>` to choose another report location; existing report files are
never overwritten. Search samples include common/category/rare queries and
literal `%`/`_` markers.

Runs with a fixture count other than 10,000, fewer than 200 samples, or
concurrency other than 5 are labeled `scaled_non_acceptance` and leave
`acceptance_result` unset; scaled runs never claim the 500 ms target. Supplying
more than 200 samples is valid for an acceptance run. Backend and PostgreSQL
version metadata are mandatory before an acceptance-shaped run can write any
tasks or produce an acceptance result. The worker limit cannot exceed five.

Example scaled test-only run:

```powershell
python docs\performance\taskflow_api_benchmark.py `
  --base-url http://127.0.0.1:8080 `
  --database-label taskflow_perf_isolated `
  --confirmation I_CONFIRM_THIS_IS_AN_ISOLATED_EMPTY_TEST_DATABASE `
  --fixture-count 20 --samples 5 --concurrency 2
```

## Current verification status

The no-Docker fake HTTP API tests run with:

```powershell
python -m unittest discover -s docs\performance -p "test_*.py" -v
```

They exercise the safety gates, proxy disabling, empty/non-empty preflight,
bounded failure handling, fixture/search/update validation, Location handling,
a scaled CRUD/search run, and preservation of seeded task ownership. They do
not measure PostgreSQL or backend performance.

## Measured local run

On 2026-11-02, the real HTTP API benchmark completed against an isolated,
initially empty PostgreSQL database on the same Windows machine:

- Windows 11 Pro 10.0.26300; Intel Core i5-1145G7, 4 cores / 8 logical
  processors; approximately 15.7 GiB RAM.
- TaskFlow backend `0.1.0-SNAPSHOT`, Spring Boot 4.1.2, OpenJDK 21.0.13;
  PostgreSQL 17.11 for Windows with ICU `en-US` collation; Python 3.14.8.
- 10,000 seeded tasks; 200 successful warm samples per operation, with at
  most five concurrent requests. Seeding took 24.563 seconds; the complete
  run took 33.38 seconds.
- List samples used page sizes 20, 50, and 100 (60, 69, and 71 samples).
  Search used 50 samples each of common, category, rare-token, and literal
  wildcard queries. Create/delete used run-owned disposable tasks; update
  used run-owned fixture tasks.

| API operation | p50 (ms) | p95 (ms) | p99 (ms) |
|---|---:|---:|---:|
| List | 19.235 | 38.673 | 51.860 |
| Search | 68.670 | 139.076 | 199.823 |
| Create | 8.846 | 15.039 | 18.604 |
| Update | 15.103 | 30.259 | 42.754 |
| Delete | 11.411 | 21.867 | 31.546 |

Every p95 met the strict `< 500 ms` target in this run. These loopback HTTP
measurements describe this machine and host PostgreSQL configuration; they
are not a general performance guarantee. Docker was unavailable during this
host PostgreSQL benchmark. The mocked-database Spring integration test is not
a substitute for a real-database benchmark.

## Measured Docker Compose run

On the same Windows machine, a subsequent run used Docker Desktop 4.97 with
WSL 2 and PostgreSQL 17.11 from `postgres:17-alpine`. A temporary backend used a
new, isolated database in the Compose PostgreSQL service; the live `taskflow`
database was not used for fixture data. The run used 10,000 tasks, 200
successful samples per operation, and concurrency 5. Seeding took 34.092
seconds; the complete run took 42.956 seconds.

| API operation | p50 (ms) | p95 (ms) | p99 (ms) |
|---|---:|---:|---:|
| List | 29.700 | 44.853 | 50.767 |
| Search | 28.139 | 67.542 | 131.987 |
| Create | 13.332 | 23.164 | 27.745 |
| Update | 21.801 | 35.841 | 50.155 |
| Delete | 18.825 | 30.190 | 34.545 |

Every p95 met the strict `< 500 ms` target in this run. The temporary backend
and test database were removed afterward without deleting the persistent
volume. These measurements describe this machine and workload, not a general
performance guarantee.
