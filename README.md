# TaskFlow

TaskFlow is a local, single-user task manager. The canonical API behavior is
defined in [`docs/api.md`](docs/api.md); the frontend implementation and its
mock are documented in [`frontend/README.md`](frontend/README.md).

## Project status

The React frontend and Spring Boot backend are implemented against the
canonical [API contract](docs/api.md). The frontend's stateful mock is for
development and tests only; its task data is not durable and is not stored in
PostgreSQL. The local backend persists tasks in PostgreSQL.

## Run the frontend with its mock

Prerequisites: Node.js LTS and npm. From the repository root in Windows
PowerShell:

```powershell
cd frontend
npm.cmd ci
npm.cmd run dev:mock
```

Open the Vite URL printed in the terminal. The `dev:mock` script loads
`frontend/.env.mock` and starts the in-browser stateful mock; changes are not
durable application storage.

## Start the local PostgreSQL container

Prerequisites: Docker Engine or Docker Desktop with the Compose plugin. From
the repository root, create the configuration only if it does not already
exist:

```powershell
if (-not (Test-Path -LiteralPath .env)) {
    Copy-Item .env.example .env
    Write-Output 'Set POSTGRES_PASSWORD in .env to a strong local-only password before continuing.'
}
```

Do not overwrite an existing `.env`: its password must continue to match the
existing database. Start Docker Desktop and complete its first-run prompts if
needed. Once the Docker engine is running, start the database:

```powershell
docker compose up -d
docker compose ps
```

This starts the database used by the backend. The database port is bound to
loopback only, and Compose stores its data in the named volume declared by the
`taskflow-postgres-data` volume key (the actual Docker volume name is normally
prefixed with the Compose project name). Wait for the database to report
healthy before starting the backend. Do not remove volumes as routine cleanup.

## Run the backend

Prerequisites: Java 21 and Docker Compose with PostgreSQL healthy. From the
repository root in Windows PowerShell, load the unquoted `POSTGRES_PASSWORD`
value from `.env` without printing it:

```powershell
$passwordEntry = @(Get-Content -LiteralPath .env | Where-Object { $_.StartsWith('POSTGRES_PASSWORD=') })
if ($passwordEntry.Count -ne 1) { throw 'Expected exactly one POSTGRES_PASSWORD entry in .env.' }
$env:TASKFLOW_DB_PASSWORD = $passwordEntry[0].Substring('POSTGRES_PASSWORD='.Length)
if ([string]::IsNullOrWhiteSpace($env:TASKFLOW_DB_PASSWORD)) { throw 'POSTGRES_PASSWORD in .env is empty.' }
Remove-Variable passwordEntry
cd backend
.\mvnw.cmd spring-boot:run
```

The password supplied to the backend must match `POSTGRES_PASSWORD` in `.env`;
Compose does not export that file into the backend's PowerShell process. The
command above assumes the unquoted format shown in `.env.example`; for a
quoted or otherwise customized value, set `TASKFLOW_DB_PASSWORD` securely to
the corresponding Compose password instead.
Set `TASKFLOW_DB_URL` and `TASKFLOW_DB_USERNAME` as well if the Compose port,
database, or username differs from the defaults. Do not commit credentials.
The generated `backend\run.bat` is an alternative launcher; it is not used
for verification. The unauthenticated API binds to `127.0.0.1` on port 8080
and rejects nonlocal HTTP `Host` values. It runs Flyway migrations on startup
and validates the schema with Hibernate. The OpenAPI
UI is configured at `http://localhost:8080/swagger-ui.html`.

## Run the frontend against the backend

With the backend running, open a second PowerShell window at the repository root:

```powershell
cd frontend
npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Run `npm.cmd ci` first if the frontend dependencies have not yet been
installed. Open [http://127.0.0.1:5173/](http://127.0.0.1:5173/). The
development proxy forwards `/api` requests to the local backend; this command
does not enable the mock.
TaskFlow has no login and is intended only for local, single-user use. Do not
expose the frontend, backend, or database to an untrusted network.

After a Windows restart, manually start Docker Desktop and repeat the database,
backend, and frontend steps above. Docker Desktop and TaskFlow have not been
configured to start automatically at Windows sign-in.

## Verify the backend

To run verification without Docker or a database:

```powershell
cd backend
.\mvnw.cmd clean verify
```

Tests replace the task repository with Mockito and verify a random-port HTTP
startup; they do not exercise PostgreSQL itself.

## Database operations and other checks

See [`backend/docs/README.md`](backend/docs/README.md) for backend architecture,
configuration, API, validation, concurrency, and test documentation.
[`docs/operations.md`](docs/operations.md) covers restart persistence, backup,
and isolated restore. The API-based performance fixture and its safety
requirements are described in [`docs/performance/README.md`](docs/performance/README.md).
Do not treat a volume as a backup.

## API collection and local mock

The collection at
[`backend/postman/taskflow.postman_collection.json`](backend/postman/taskflow.postman_collection.json)
covers the API methods and representative errors. Its scripts chain writes
only to a task created by the current collection run. Static collection
verification can be run without a server:

```powershell
python .\backend\postman\verify_collection.py
node .\backend\postman\test_collection_scripts.js
```

The Node test executes the collection's actual scripts in a mock Postman
environment; it makes no HTTP requests. To use the frontend's in-browser mock
instead of the backend, follow the instructions in
[`frontend/README.md`](frontend/README.md) and run `npm.cmd run dev:mock` from
`frontend\`. Mock data is ephemeral and not durable.
