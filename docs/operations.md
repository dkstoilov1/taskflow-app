# TaskFlow local database operations

TaskFlow is intended for local, single-user use. PostgreSQL is exposed only on the loopback interface; do not change the host binding or expose this unauthenticated application/database to a network.

## Start PostgreSQL

Prerequisites:

- Docker Engine or Docker Desktop with the Compose plugin.
- PostgreSQL client tools (`pg_dump`, `pg_restore`, and `createdb`) on `PATH` for the backup and restore helpers.

From the repository root in PowerShell:

```powershell
if (-not (Test-Path -LiteralPath .env)) {
    Copy-Item .env.example .env
    Write-Output 'Set POSTGRES_PASSWORD in .env to a strong local-only password before continuing.'
}
```

Never overwrite an existing `.env`; its password must match the existing
database. With Docker running and the password configured, start PostgreSQL:

```powershell
docker compose up -d
docker compose ps
```

Compose binds the database to `127.0.0.1:5432` by default, declares the persistent volume with the Compose key `taskflow-postgres-data`, and reports readiness using `pg_isready`. Docker Compose normally prefixes the actual Docker volume name with the project name; the key is not necessarily the final volume name. Change `POSTGRES_HOST_PORT` in `.env` if the local port is already in use; the service remains bound to loopback.

The committed `.env.example` contains placeholders only. `.env` is ignored by Git. Do not put credentials in scripts, command-line arguments, logs, or committed files. The helper scripts use PostgreSQL's standard password-file support and pass `--no-password` to prevent interactive prompts. On Windows, configure the password in the PostgreSQL password file (normally `%APPDATA%\postgresql\pgpass.conf`) or set `PGPASSFILE` to a suitably access-restricted file. A matching entry has the form:

```text
127.0.0.1:5432:*:taskflow:your-local-password
```

The database wildcard is needed because the restore helper connects to the
`postgres` maintenance database and then to a freshly generated restore
database. Escape `:` and `\` in password-file fields as required by PostgreSQL's
`pgpass` format. Do not print or commit the password file.

If PostgreSQL client tools were installed in
`%LOCALAPPDATA%\TaskFlow\PostgreSQL\17\bin`, a PowerShell session that predates
the PATH update can make them available without changing the saved PATH:

```powershell
$env:Path += ";$env:LOCALAPPDATA\TaskFlow\PostgreSQL\17\bin"
```

## Persistence across restart

Task metadata (due date, priority, status, project assignment, and completion
timestamp) and project names are stored in PostgreSQL alongside task text.
Statistics are calculated from that persisted data, so they survive restarts
without a separate statistics store. Reopening/deleting tasks intentionally
changes those statistics.

Flyway applies versioned schema migrations when the backend starts. Existing
title/description-only tasks receive active status, medium priority, and no
deadline, project, or completion timestamp. Do not edit an applied migration or
reset Flyway history to resolve a schema mismatch. Take a backup before
upgrading a database whose contents matter.

The current development database was explicitly identified as disposable test
data for this feature implementation. That permission is not a general
instruction to clear future data, remove volumes, or reset other databases.
Normal startup and migration do not require deleting task data.

The named volume stores the database data independently from the container. A normal stop/start or container recreation keeps the data:

```powershell
docker compose stop
docker compose up -d
```

After application data has been created, verify the task count and representative fields before and after a restart. A manual check with Docker Desktop, WSL 2, and PostgreSQL 17.11 in the Compose container recreated the database container while preserving its named volume. The same task ID, Unicode title, multiline description, creation timestamp, version, and ETag were present afterward, and the backend and frontend proxy reconnected.

Do not use `docker compose down --volumes`, `docker volume rm`, or another volume-deleting command as routine shutdown or troubleshooting instructions. A persistent volume is not a backup and does not protect against hardware failure, volume corruption, or an intentional permanent task deletion.

### Feature persistence smoke check

Use disposable records or a dedicated verification database, not important tasks:

1. Create a project and a task with a description, deadline, and high priority.
2. Complete the task. Record its ID, project assignment, version, completion
   timestamp, and the dashboard's completion counts.
3. Restart the backend with the same database configuration. Verify the task,
   project, and statistics still match; a date rollover can legitimately change
   today's/week's counts.
4. Stop/start PostgreSQL without removing its volume, restart the backend if
   needed, and repeat the checks.
5. Reopen the task and verify it leaves Completed and the completion counts.
   Delete the project and verify the task survives as unassigned.

The browser mock and mocked-repository backend tests cannot establish actual
database persistence or PostgreSQL transaction/concurrency behavior. Verify
those with the real local stack. Project deletion also changes affected task
versions, so another tab holding an older version must reload before editing.

## Create a backup

The helper asks `pg_dump --file` to write the custom-format binary archive to an exclusively created temporary file beside the requested destination; it does not pipe bytes through PowerShell text output. It then publishes that file with an atomic no-replacement move. Existing or concurrently created destination files are never overwritten, and failure cleanup removes only the helper's temporary file.

```powershell
.\docs\scripts\Backup-TaskFlowDatabase.ps1
```

If the current PowerShell execution policy blocks local scripts, run a helper in a child process with a process-only policy override (it does not change the machine or user policy):

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\docs\scripts\Backup-TaskFlowDatabase.ps1
```

Specify another archive path or connection settings when needed:

```powershell
.\docs\scripts\Backup-TaskFlowDatabase.ps1 `
  -ArchivePath .\backups\taskflow-2026-11-02.dump `
  -Server 127.0.0.1 -Port 5432 -Database taskflow -Username taskflow
```

Store backups somewhere protected and separate from the database volume. Keep multiple recovery points; a successful command is not a substitute for periodically testing a restore.

## Restore safely for verification

**The restore helper never accepts a target database name.** It validates the archive, creates a fresh database named `taskflow_restore_<timestamp>_<suffix>`, and restores only into that newly created database. It does not connect to `taskflow` as its restore target, overwrite an existing database, or delete any database or Docker volume. It requires permission to create a database.

```powershell
.\docs\scripts\Restore-TaskFlowBackup.ps1 -ArchivePath .\taskflow-20261102-120000.dump
```

If required by the local execution policy, use the same process-only invocation pattern with `Restore-TaskFlowBackup.ps1`.

The script prints the generated isolated database name after a successful restore. Compare row counts and representative field values there before considering recovery complete. If restore fails after target creation, the partial isolated database is deliberately retained for inspection; the error identifies its name. Do not point the application at that database as part of the restore test.

After verifying and recording the result, an operator may explicitly remove an
isolated test database with `psql`. Enter the exact generated name printed by
the helper; do not remove a database chosen for recovery:

```powershell
$testDatabase = Read-Host 'Generated taskflow_restore test database to remove'
if ($testDatabase -notmatch '^taskflow_restore_\d{8}_\d{6}_[0-9a-f]{8}$') {
    throw 'Enter the exact generated test database name.'
}
psql.exe -X --no-password -h 127.0.0.1 -p 5432 -U taskflow -d postgres `
    -v ON_ERROR_STOP=1 -c "DROP DATABASE `"$testDatabase`""
if ($LASTEXITCODE -ne 0) { throw 'The test database could not be removed.' }
```

Never substitute the live `taskflow` database name, and never remove the named
volume as restore cleanup.

Backups and restores are PostgreSQL-version/client compatibility dependent. Use `pg_dump`/`pg_restore` client tools compatible with the server major version, and retain the archive outside the volume. The no-Docker fake-client regressions verify helper safety. A manual run against the Docker Compose PostgreSQL 17.11 service created a real archive, restored it into a generated isolated database, and compared task counts, representative fields and creation timestamp, `pg_trgm`, and task indexes.

## Use a restored database for recovery

The restore helper leaves the verified database available in the same
PostgreSQL volume. To use it rather than the original `taskflow` database:

1. Keep the generated database and its backup; do not run the optional
   `dropdb` cleanup on the database you intend to use.
2. Stop the running backend, using Ctrl+C if it was started in a PowerShell
   window. If it was started in the background, use `netstat -ano -p tcp`
   to find the process listening on `127.0.0.1:8080`, verify in Task Manager
   that its command line belongs to the TaskFlow backend, and stop only that
   process by its verified PID. In the PowerShell window where you will
   restart it, set the exact database name printed by the restore helper:

   ```powershell
   $restoredDatabase = Read-Host 'Generated taskflow_restore database name'
   if ($restoredDatabase -notmatch '^taskflow_restore_\d{8}_\d{6}_[0-9a-f]{8}$') {
       throw 'Enter the generated database name printed by the restore helper.'
   }
   $env:TASKFLOW_DB_URL = "jdbc:postgresql://127.0.0.1:5432/$($restoredDatabase)?connectTimeout=3&socketTimeout=10&tcpKeepAlive=true"
   ```

3. In that same window, follow the backend startup steps in
   [`README.md`](../README.md#run-the-backend), including loading the
   database password. Reload the frontend and verify the recovered tasks.

Changes made while connected to the restored database are saved there, not
merged into the original database. Repeat the `TASKFLOW_DB_URL` setting in the
backend window after every Windows restart while using the restored database.
When creating subsequent backups, pass `-Database $restoredDatabase` to
`Backup-TaskFlowDatabase.ps1`; otherwise its default is the original
`taskflow` database.
To return to the original database, stop the backend, remove that environment
variable from its startup window, and start the backend again. Do not delete
either database until you have independently confirmed which data you need.
A separate backend was manually started against a generated restore database
and verified to read the restored task without changing the live database.

## No-Docker helper regression tests

The PowerShell helper regression suite substitutes temporary fake `pg_dump`,
`pg_restore`, and `createdb` executables. It checks binary archive fidelity,
relative-path resolution, first-executable PATH precedence, existing and
racing destination safety, dump and owned-temp cleanup failures, and restore's
generated isolated target and invalid-archive/no-create behavior. It uses no
database, Docker, credentials, or destructive database/volume cleanup. Its
generated test directory is unique and removed by exact path when the suite
exits.

Run it from the repository root in PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\docs\scripts\Test-DatabaseHelpers.ps1
```

## Search indexes and performance verification

The local Compose service supplies PostgreSQL 17. The backend's versioned Flyway migration enables `pg_trgm` and creates GIN trigram indexes for task title and description, plus the deterministic ordering index. Its literal substring search escapes backslash, `%`, and `_` before using `ILIKE`, so wildcard characters match literally while PostgreSQL can use the trigram indexes. A manual check against the Docker Compose database verified the extension and indexes, Unicode case-insensitive search, and literal `%` and `_` matching.

The performance acceptance check uses 10,000 representative tasks and at least 200 samples per list/search/create/update/delete operation at concurrency 5, with a p95 target below 500 ms per operation. Manual runs against isolated PostgreSQL 17.11 on Windows and a separate isolated database in the Docker Compose PostgreSQL 17 Alpine service met the p95 target for all five operations. The environments, query mixes, and actual measurements are recorded in [`performance/README.md`](performance/README.md).

An independent API benchmark helper and its safety requirements are documented in [`performance/README.md`](performance/README.md). It requires a loopback base URL and explicit confirmation of a dedicated empty test database. It cannot verify the database identity through the API; the operator must confirm backend configuration separately.
