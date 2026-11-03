# TaskFlow frontend

TaskFlow is a responsive, local-first task manager for one person. It supports
dashboard deadlines, task views, projects, completion/reopening, and productivity
summaries in addition to searchable, paginated CRUD. Editable task fields are
`title`, `description`, nullable date-only `dueDate`, `priority` (low/medium/high),
nullable `projectId`, and `status` (active/completed). The API owns UUID, version,
and completion timestamp. PostgreSQL, not the browser mock, is application storage.

The shared contract is documented in [`../docs/api.md`](../docs/api.md). The
frontend client, MSW mock, and tests implement that contract without changing
it.

## Architecture and data flow

- `src/api/` holds the typed task and Problem Details shapes and the sole HTTP
  client. It handles JSON requests, `If-Match`, non-success responses, and
  operation-specific success statuses (list/detail/update 200, create 201,
  delete 204), task identity/shape, matching strong ETags, and the create
  `Location` header. Create/update bodies must echo the normalized submitted
  editable fields; update versions must advance beyond the request's `If-Match`
  version.
  Unexpected 2xx statuses, unreadable/invalid mutation bodies, and 5xx write
  responses are not reported as success; they require the appropriate recovery
  review before another write.
- `src/features/tasks/` contains the task list, accessible create/edit and
  delete dialogs, and TanStack Query hooks. The UI requests a page of 20 tasks
  and sends search text to the server; it does not download and filter the
  full collection in the browser.
- `src/features/projects/` contains accessible project management and its query/
  mutation hooks. `src/features/dashboard/` composes three bounded server previews
  and the server statistics response. `src/api/calendar.ts` provides date-only
  validation/arithmetic and browser timezone identification; deadlines are never
  converted to UTC timestamps.
- A query key includes view, all filters, sorting, page, size, browser timezone,
  and debounced search value. Query signals are
  forwarded to `fetch`, so an outdated search can be cancelled. Successful
  mutations invalidate task, project, dashboard, and statistics caches. Writes are not automatically
  retried.
- Clearing search always returns to page zero. After a successful refresh, the
  view corrects a now-out-of-range page without reacting to placeholder data;
  cached empty results still show a retry action when their refresh fails.
- `src/mocks/store.ts` and `src/mocks/handlers.ts` implement one in-memory API
  store and shared MSW contract handlers. Vitest uses `setupServer`; mock
  development and Playwright use `setupWorker`.
- `src/App.tsx` provides the QueryClient. `src/main.tsx` starts the browser
  mock only in development when `VITE_API_MOCK=true`. The mock is not started
  by production builds.

## Views, organization, and statistics

Dashboard is home. Due-today, overdue, and upcoming sections each request at most
five tasks, ordered due-ascending, with exact counts from `totalElements` and
links to full lists. These previews do not truncate aggregate counts.

Today means **active due today or overdue**. Upcoming means active with a future
deadline; neither includes undated tasks. All Tasks includes both statuses and
undated tasks. Completed includes only completed tasks. All views support create,
edit, delete and complete/reopen.

Search, status, priority, deadline and project filters intersect the current view.
Incompatible choices remain selected and show an explanatory empty state.
Deadline filters are today, overdue and the inclusive Monday–Sunday week
(including earlier days of that week). Project filtering includes Unassigned.
Search/view/filter/sort changes reset pagination; Reset filters also clears search.
On narrow screens (640px and below), the filter and sort controls are collapsed
behind **Filters & sort**, which shows the number of active filters. Collapsing
the controls does not clear selections; wider screens always show the controls.
Sorting supports newest first, due in either direction (undated last), priority
high/low first, and status active/completed first. The server applies all search,
filters, ordering, tie-breakers, pagination and totals; the browser never downloads
the entire task collection to filter it.

Projects can be created, renamed and deleted. Names are trimmed, 1–100 Unicode
code points and unique ignoring case. Deletion requires confirmation and leaves
associated tasks unassigned, advancing their versions. Names are resolved through
the shared project query, not embedded in task responses.

Statistics cover all current stored tasks, not just loaded previews/pages:
completed today, completed this week, exactly seven daily counts ending today,
and every existing project's completed/total rate rounded to one decimal
(0.0% for empty projects). Unassigned tasks count globally but have no project
rate. Reopening/deleting removes completion counts; re-completing records a new
timestamp; editing an already completed task preserves its timestamp. This is
not an immutable event history.

Task cards use labeled priority/status badges and a muted, struck-through title
for completed tasks. Dashboard headings share a consistent hierarchy; the
seven-day completion strip stays on one row on mobile and desktop. Confirmation
dialogs show labeled metadata and resolve project names from the shared project
query; an unresolved reference is explicitly labeled **Project unavailable**
rather than displaying an internal UUID.

Relative-date reads send the browser's IANA timezone, refresh at the next local
midnight (DST-aware scheduling), and invalidate on focus. Invalid zones surface
the API error rather than silently falling back to UTC.

## Technology

Exact versions are pinned in `package.json` and `package-lock.json`. The
project uses React 19, TypeScript 5.9, Vite 8, TanStack Query 5, Tailwind CSS
3.4, Radix UI Dialog/AlertDialog, ESLint 10 with typescript-eslint 8, Vitest 5
with V8 coverage, React Testing Library, MSW 2, and Playwright 1.64.

## Configuration and commands

Use the Node.js LTS and npm. From this directory in Windows PowerShell:

```powershell
npm.cmd ci
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test:coverage
npm.cmd run build
npx.cmd playwright install chromium
npm.cmd run test:e2e
```

Run against the real backend with the same-origin Vite proxy. The default
proxy target is `http://localhost:8080`:

```powershell
npm.cmd run dev
```

Run with the in-browser stateful mock:

```powershell
npm.cmd run dev:mock
```

`dev:mock` loads `.env.mock`, which sets `VITE_API_MOCK=true`. For a real
deployment, build with `npm.cmd run build`; mock mode is development-only.
`VITE_API_BASE_URL` defaults to `/api`. `.env.example` documents the optional
setting; do not put credentials or secrets in frontend environment files.

## Stateful mock and test controls

The mock implements task list/detail/create/replace/delete and
`PATCH /api/tasks/{id}/status`, project list/detail/create/rename/delete, and
`GET /api/statistics`. It models all contract fields, strict calendar dates,
enum/UUID validation, unknown-field rejection, defaults, project existence,
Unicode code-point limits, timestamps, literal case-insensitive search,
intersection filters, all sorts, pagination, aggregates, strong ETags,
`If-Match`, 400/404/409/412/428 responses, and sanitized 500/503 Problem Details.
Creation, replacement, and deletion mutate the in-memory store; later requests
observe the changed data.

Tests can use the exports from `src/mocks/index.ts`:

- `resetMockStore()` empties tasks/projects and clears injected faults/latency. Browser
  resets publish a new monotonic revision so other tabs cannot mistake a
  reset-and-reseed cycle for an unchanged snapshot.
- `seedMockTasks(items)` loads records with `id`, `title`, `description`,
  `version`, internal `createdAt`, and optional metadata (legacy fixtures default
  to active/medium/undated/unassigned).
- `seedMockProjects(items)` loads project IDs/names/versions. Seed projects before
  task fixtures that reference them.
- `setMockLatency(milliseconds)` delays each subsequent request.
- `failNextMockRequest('network' | '500' | '503')` injects one failed request.
  It applies to the next API request, including background reads; tests targeting
  a particular operation can override one MSW handler with `{once: true}`.

Vitest resets handlers and store state between tests. In mock browser mode, the same controls are exposed as `window.taskflowMock`
for Playwright and are sent to the MSW handler. The handler keeps the
in-memory map synchronized with test-only `localStorage`, so multiple tabs and
reloads in the same browser context observe the same mock records. A small
revision key avoids reparsing the full task snapshot when it has not changed,
and an exclusive Web Lock protects reads, version checks, and writes across
tabs where the browser supports it. This is test persistence, not durable
application storage.

Browser control methods are async: `reset()`, `seed(tasks)`,
`seedProjects(projects)`, `setLatency(ms)`, `failNext(kind)`, and `count()` (tasks).
The controls are dev-mock-only and use `/__taskflow_mock__/control`, not real
application endpoints. Tests use the same handlers in Node and the browser.
Clock-sensitive tests seed completion instants or control `Date`; tests include
the 25-hour DST day, Monday/Sunday boundaries, local-midnight refresh and focus.

## Accessibility and responsive design

- Headings, search, form fields, task actions, pagination, status announcements,
  and dialogs have semantic roles and labels. Focus indicators remain visible.
- Radix dialogs trap and restore focus. The delete confirmation initially
  focuses the safe action. Escape, close, and cancel preserve a dirty form and
  present a discard confirmation instead of silently dropping input.
- A stale update never overwrites a draft on reload without confirmation. An
  uncertain update displays the latest server fields separately and blocks
  saving a newer version until the user explicitly confirms either discarding
  the draft or overwriting the displayed server values. An uncertain delete
  offers a real list refresh before the user acts again.
- Dirty detection, latest-server review, explicit overwrite/discard decisions,
  validation errors and exact uncertain-create duplicate comparison cover **all
  six editable fields**, not just text. Completion uses a status-only PATCH
  and never replaces unrelated fields. Project and status writes also gate
  retries after ambiguity/stale versions until fresh server values are displayed
  and the user explicitly acts again. Project-create recovery checks the fresh
  project list for an existing case-insensitive name before permitting retry.
- Completion state is shown in text with a check mark, never color alone.
  Native labeled selects/date inputs support keyboard use; pending controls
  disable repeated writes. Only confirmed writes produce success announcements.
- A dirty form also registers a browser `beforeunload` warning. Browsers decide
  the wording and may not show that warning in every navigation or shutdown
  scenario; it is not a draft-recovery guarantee.
- If a create request has an ambiguous network failure, the form preserves its
  input and disables resubmission until a successful, unfiltered first-page
  refresh. It displays the recent tasks for review inside the still-open form;
  a matching task can be selected instead of creating a duplicate. Creating
  another exact match requires a separate confirmation, followed by an
  intentional “Try create again” action. A failed refresh never resubmits the
  create, and an older in-flight first-page read is cancelled before recovery
  starts a fresh request.
- Task content is rendered as text, descriptions preserve whitespace, and
  previews are bounded. Layouts adapt from 375 px phones to desktop widths,
  and the Playwright suite checks for horizontal overflow at 375 px and
  1440 px.
- Search is debounced by 300 ms, and server pagination keeps rendered lists
  bounded to at most 100 records (20 by default). Both the current search input
  and debounced query are checked against the contract limit before a request
  can run.
- After an uncertain update or stale-version response, the draft remains safe
  and Save is gated until a fresh detail read succeeds. A newer server version
  still requires an explicit discard-or-overwrite decision. Uncertain delete
  responses similarly require a successful list refresh or explicit reload
  before another delete attempt.

## Coverage and limitations

Vitest uses V8 line coverage with an 80% line threshold. The only configured
coverage exclusions are test files (`src/**/*.test.{ts,tsx}`), mock
infrastructure (`src/mocks/**`), type declarations (`src/**/*.d.ts`), and the
entry point (`src/main.tsx`). Generated browser worker code is in `public/`,
outside the source coverage include.

Playwright tests run the Vite app with the same in-browser MSW handlers. They
verify frontend workflows and the mock contract; **they do not verify
integration with the real backend, database, or PostgreSQL concurrency
behavior**. Real-backend integration for these new features, migration,
durability and Compose verification belong to the separate stack-integration
step and have not been verified by this frontend work. There is no automated
full-stack test here. Playwright runs one worker to avoid simultaneous Chromium
CPU contention with the existing 50 ms main-thread performance assertion; all
tests remain enabled. RTL allows 3 seconds for async assertions and Vitest
15 seconds per workflow test; no coverage exclusions/thresholds were relaxed.
Mock data in browser
`localStorage` can survive reloads or restarts until cleared, but it is not
reliable durable storage. The backend is intended to provide durable storage.

New component coverage lives beside each component:
`Dashboard.test.tsx`, `ProjectManager.test.tsx`, and `StatusTaskDialog.test.tsx`.
Existing task component tests remain mock-backed, with expanded workflows in
`src/features/tasks/organization.test.tsx` and contract matrices in
`src/mocks/organization.contract.test.ts`. Browser organization workflows are
in `e2e/organization.spec.ts`; preserved recovery/pagination/performance workflows
are in `e2e/task-workflows.spec.ts`.

The uncertain task-create review intentionally fetches only the unfiltered first
20 recent tasks, not the whole collection. A match older than that preview may
not be shown; review the explicit warning before retrying. No idempotency key
is defined by the contract. Project lists are unpaginated as specified. Browser
mock atomicity across tabs depends on Web Locks; Chromium tests support them.
