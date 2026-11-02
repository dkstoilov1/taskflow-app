# TaskFlow frontend

TaskFlow is a responsive, local-first task manager for one person. It supports
creating, searching, editing, and permanently deleting tasks. A task exposes
only `title` and `description` as editable fields; the API owns its UUID and
integer version.

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
- A query key includes the page and debounced search value. Query signals are
  forwarded to `fetch`, so an outdated search can be cancelled. Successful
  mutations invalidate the task-list cache. Writes are not automatically
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

The mock implements `GET /api/tasks`, `GET /api/tasks/{id}`,
`POST /api/tasks`, `PUT /api/tasks/{id}`, and `DELETE /api/tasks/{id}`. It
models title trimming, Unicode code-point limits, optional/null descriptions,
literal case-insensitive search, pagination, deterministic ordering, ETags,
`If-Match`, 400/404/412/428 responses, and sanitized 500/503 Problem Details.
Creation, replacement, and deletion mutate the in-memory store; later requests
observe the changed data.

Tests can use the exports from `src/mocks/index.ts`:

- `resetMockStore()` empties tasks and clears injected faults/latency. Browser
  resets publish a new monotonic revision so other tabs cannot mistake a
  reset-and-reseed cycle for an unchanged snapshot.
- `seedMockTasks(items)` loads records with `id`, `title`, `description`,
  `version`, and internal `createdAt`.
- `setMockLatency(milliseconds)` delays each subsequent request.
- `failNextMockRequest('network' | '500' | '503')` injects one failed request.

Vitest resets handlers and store state between tests. In mock browser mode, the same controls are exposed as `window.taskflowMock`
for Playwright and are sent to the MSW handler. The handler keeps the
in-memory map synchronized with test-only `localStorage`, so multiple tabs and
reloads in the same browser context observe the same mock records. A small
revision key avoids reparsing the full task snapshot when it has not changed,
and an exclusive Web Lock protects reads, version checks, and writes across
tabs where the browser supports it. This is test persistence, not durable
application storage.

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
behavior**. A separate manual browser smoke check exercised create, edit,
search, and delete against the real backend and an isolated PostgreSQL 17.11
instance. There is no automated full-stack test, and the smoke check does not
verify Docker Compose. Mock data in browser
`localStorage` can survive reloads or restarts until cleared, but it is not
reliable durable storage. The backend is intended to provide durable storage.
