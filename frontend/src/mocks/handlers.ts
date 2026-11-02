import { http, HttpResponse } from 'msw';
import type { TaskInput } from '../api/types';
import { dateInZone, isCalendarDate, shiftDate, weekStartFor } from '../api/calendar';
import {
  allMockTasks,
  beforeMockRequest,
  createMockTask,
  failNextMockRequest,
  findMockTask,
  removeMockTask,
  resetMockStore,
  replaceMockTask,
  seedMockTasks,
  setMockLatency,
  type StoredTask,
  withMockStoreLock,
  allMockProjects, findMockProject, writeMockProject, removeMockProject, seedMockProjects,
} from './store';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ETAG_PATTERN = /^"(0|[1-9]\d*)"$/;

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function problem(
  status: number,
  title: string,
  detail: string,
  instance: string,
  fieldErrors?: Record<string, string[]>,
): Response {
  return HttpResponse.json(
    {
      type: 'about:blank',
      title,
      status,
      detail,
      instance,
      ...(fieldErrors ? { fieldErrors } : {}),
    },
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  );
}

function simulateFailure(
  failure: Awaited<ReturnType<typeof beforeMockRequest>>,
): Response | undefined {
  if (failure === 'network') return HttpResponse.error();
  if (failure === '500') {
    return problem(
      500,
      'Internal server error',
      'An unexpected error occurred. Please try again.',
      '/api/tasks',
    );
  }
  if (failure === '503') {
    return problem(
      503,
      'Service unavailable',
      'The task service is temporarily unavailable. Please try again.',
      '/api/tasks',
    );
  }
  return undefined;
}

async function beforeRequest(): Promise<Response | undefined> {
  return simulateFailure(await beforeMockRequest());
}

async function parseInput(
  request: Request,
  instance: string,
): Promise<TaskInput | Response> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) {
    return problem(
      400,
      'Invalid request',
      'The request content type must be application/json.',
      instance,
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problem(
      400,
      'Invalid request',
      'The request body must contain valid JSON.',
      instance,
    );
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return problem(
      400,
      'Invalid request',
      'The request body must be a JSON object.',
      instance,
    );
  }
  const payload = body as Record<string, unknown>;
  const fieldErrors: Record<string, string[]> = {};
  for (const key of Object.keys(payload)) {
    if (!['title', 'description', 'dueDate', 'priority', 'projectId', 'status'].includes(key)) fieldErrors[key] = ['unknown field'];
  }
  if (payload.dueDate != null && !isCalendarDate(payload.dueDate)) fieldErrors.dueDate = ['must be a valid YYYY-MM-DD calendar date'];
  if (payload.priority !== undefined && (typeof payload.priority !== 'string' || !['low', 'medium', 'high'].includes(payload.priority))) fieldErrors.priority = ['must be low, medium or high'];
  if (payload.status !== undefined && (typeof payload.status !== 'string' || !['active', 'completed'].includes(payload.status))) fieldErrors.status = ['must be active or completed'];
  if (payload.projectId != null && (typeof payload.projectId !== 'string' || !UUID_PATTERN.test(payload.projectId) || !findMockProject(payload.projectId))) fieldErrors.projectId = ['must reference an existing project'];
  if (typeof payload.title !== 'string') {
    fieldErrors.title = ['must be a string'];
  } else {
    const title = payload.title.trim();
    if (title.length === 0) fieldErrors.title = ['must not be blank'];
    else if (codePointLength(title) > 200) {
      fieldErrors.title = ['must contain at most 200 Unicode code points'];
    }
  }
  let description = '';
  if (payload.description !== undefined && payload.description !== null) {
    if (typeof payload.description !== 'string') {
      fieldErrors.description = ['must be a string'];
    } else {
      description = payload.description;
      if (codePointLength(description) > 10_000) {
        fieldErrors.description = [
          'must contain at most 10000 Unicode code points',
        ];
      }
    }
  }
  if (Object.keys(fieldErrors).length > 0) {
    return problem(
      400,
      'Invalid request',
      'The request contains invalid values.',
      instance,
      fieldErrors,
    );
  }
  return { ...payload, title: (payload.title as string).trim(), description } as TaskInput;
}

function isResponse(
  value: TaskInput | Response,
): value is Response {
  return value instanceof HttpResponse;
}

function validateId(id: string): Response | undefined {
  if (!UUID_PATTERN.test(id)) {
    return problem(
      400,
      'Invalid request',
      'The task ID must be a valid UUID.',
      `/api/tasks/${id}`,
    );
  }
  return undefined;
}

function readVersion(
  request: Request,
  instance: string,
): number | Response {
  const value = request.headers.get('If-Match');
  if (value === null) {
    return problem(
      428,
      'Precondition required',
      'Send the latest task ETag in the If-Match header.',
      instance,
    );
  }
  const match = ETAG_PATTERN.exec(value);
  const parsed = match ? Number(match[1]) : Number.NaN;
  if (!match || !Number.isSafeInteger(parsed)) {
    return problem(
      400,
      'Invalid request',
      'If-Match must contain a quoted decimal task version.',
      instance,
    );
  }
  return parsed;
}

function isHttpResponse(
  value: number | Response,
): value is Response {
  return value instanceof HttpResponse;
}

export const handlers = [
  http.post('/__taskflow_mock__/control', async ({ request }) => {
    let command: unknown;
    try {
      command = await request.json();
    } catch {
      return problem(
        400,
        'Invalid mock control',
        'Mock controls require a JSON command.',
        '/__taskflow_mock__/control',
      );
    }
    if (!command || typeof command !== 'object' || Array.isArray(command)) {
      return problem(
        400,
        'Invalid mock control',
        'Mock controls require a JSON object.',
        '/__taskflow_mock__/control',
      );
    }
    const body = command as Record<string, unknown>;
    if (body.operation === 'count') {
      const count = await withMockStoreLock(() => allMockTasks().length);
      return HttpResponse.json({ count });
    } else if (body.operation === 'reset') {
      await withMockStoreLock(() => resetMockStore());
    } else if (body.operation === 'seed' && Array.isArray(body.tasks)) {
      await withMockStoreLock(() =>
        seedMockTasks(body.tasks as StoredTask[]),
      );
    } else if (body.operation === 'seedProjects' && Array.isArray(body.projects)) {
      await withMockStoreLock(() => seedMockProjects(body.projects as Parameters<typeof seedMockProjects>[0]));
    } else if (
      body.operation === 'latency' &&
      typeof body.milliseconds === 'number' &&
      Number.isFinite(body.milliseconds)
    ) {
      setMockLatency(body.milliseconds);
    } else if (
      body.operation === 'failure' &&
      (body.failure === 'network' ||
        body.failure === '500' ||
        body.failure === '503')
    ) {
      failNextMockRequest(body.failure);
    } else {
      return problem(
        400,
        'Invalid mock control',
        'The requested mock control is not supported.',
        '/__taskflow_mock__/control',
      );
    }
    return new HttpResponse(null, { status: 204 });
  }),

  http.get('/api/tasks', async ({ request }) => {
    const failure = await beforeRequest();
    if (failure) return failure;
    const url = new URL(request.url);
    const rawPage = url.searchParams.get('page') ?? '0';
    const rawSize = url.searchParams.get('size') ?? '20';
    const query = (url.searchParams.get('q') ?? '').trim();
    const page = /^\d+$/.test(rawPage) ? Number(rawPage) : Number.NaN;
    const size = /^\d+$/.test(rawSize) ? Number(rawSize) : Number.NaN;
    const fieldErrors: Record<string, string[]> = {};
    if (!Number.isSafeInteger(page) || page < 0) {
      fieldErrors.page = ['must be a non-negative integer'];
    }
    if (!Number.isSafeInteger(size) || size < 1 || size > 100) {
      fieldErrors.size = ['must be between 1 and 100'];
    }
    if (codePointLength(query) > 200) {
      fieldErrors.q = ['must contain at most 200 Unicode code points'];
    }
    const options: Record<string, string[]> = {
      view: ['all', 'today', 'upcoming', 'completed'], status: ['active', 'completed'],
      priority: ['low', 'medium', 'high'], due: ['today', 'this_week', 'overdue'],
      sort: ['created_desc', 'due_asc', 'due_desc', 'priority_desc', 'priority_asc', 'status_asc', 'status_desc'],
    };
    for (const [key, values] of Object.entries(options)) {
      const value = url.searchParams.get(key);
      if (value !== null && !values.includes(value)) fieldErrors[key] = ['invalid value'];
    }
    const project = url.searchParams.get('project');
    if (project !== null && project !== 'unassigned' && !UUID_PATTERN.test(project)) fieldErrors.project = ['must be a UUID or unassigned'];
    const zone = url.searchParams.get('timeZone') ?? 'UTC';
    let today = '';
    try { today = dateInZone(zone); } catch { fieldErrors.timeZone = ['must be a valid IANA timezone']; }
    if (Object.keys(fieldErrors).length > 0) {
      return problem(
        400,
        'Invalid request',
        'The request contains invalid query values.',
        '/api/tasks',
        fieldErrors,
      );
    }
    const result = await withMockStoreLock(() => {
      const normalizedQuery = query.toLowerCase();
      const view = url.searchParams.get('view') ?? 'all';
      const due = url.searchParams.get('due');
      const status = url.searchParams.get('status');
      const priority = url.searchParams.get('priority');
      const sort = url.searchParams.get('sort') ?? 'created_desc';
      const weekStart = weekStartFor(today);
      const matching = allMockTasks()
        .filter(
          (task) =>
            !normalizedQuery ||
            task.title.toLowerCase().includes(normalizedQuery) ||
            task.description.toLowerCase().includes(normalizedQuery),
        )
        .filter((task) =>
          (view === 'all' || (view === 'completed' ? task.status === 'completed' :
            task.status === 'active' && task.dueDate !== null && (view === 'today' ? task.dueDate <= today : task.dueDate > today))) &&
          (!status || task.status === status) && (!priority || task.priority === priority) &&
          (!project || (project === 'unassigned' ? task.projectId === null : task.projectId?.toLowerCase() === project.toLowerCase())) &&
          (!due || (task.dueDate !== null && (due === 'today' ? task.dueDate === today :
            due === 'overdue' ? task.dueDate < today : task.dueDate >= weekStart && task.dueDate <= shiftDate(weekStart, 6)))),
        )
        .sort(
          (left, right) => {
            let order = 0;
            if (sort.startsWith('due_')) {
              if (left.dueDate === null && right.dueDate !== null) return 1;
              if (right.dueDate === null && left.dueDate !== null) return -1;
              order = (left.dueDate ?? '').localeCompare(right.dueDate ?? '') * (sort === 'due_asc' ? 1 : -1);
            } else if (sort.startsWith('priority_')) {
              const priorities = {low: 0, medium: 1, high: 2};
              order = (priorities[left.priority] - priorities[right.priority]) * (sort === 'priority_asc' ? 1 : -1);
            } else if (sort.startsWith('status_')) order = left.status.localeCompare(right.status) * (sort === 'status_asc' ? 1 : -1);
            return order || right.createdAt - left.createdAt || right.id.localeCompare(left.id);
          },
        );
      const totalElements = matching.length;
      const start = page * size;
      return {
        items: matching
          .slice(start, start + size)
          .map(({ createdAt, ...task }) => {
            void createdAt;
            return task;
          }),
        totalElements,
        totalPages:
          totalElements === 0 ? 0 : Math.ceil(totalElements / size),
      };
    });
    return HttpResponse.json({
      items: result.items,
      page,
      size,
      totalElements: result.totalElements,
      totalPages: result.totalPages,
    });
  }),

  http.get('/api/tasks/:id', async ({ params, request }) => {
    const failure = await beforeRequest();
    if (failure) return failure;
    const id = String(params.id);
    const invalidId = validateId(id);
    if (invalidId) return invalidId;
    const task = await withMockStoreLock(() => findMockTask(id));
    if (!task) {
      return problem(
        404,
        'Task not found',
        'The requested task no longer exists.',
        `/api/tasks/${id}`,
      );
    }
    const { createdAt, ...body } = task;
    void createdAt;
    void request;
    return HttpResponse.json(body, {
      headers: { ETag: `"${task.version}"` },
    });
  }),

  http.post('/api/tasks', async ({ request }) => {
    const failure = await beforeRequest();
    if (failure) return failure;
    const input = await parseInput(request, '/api/tasks');
    if (isResponse(input)) return input;
    const id = crypto.randomUUID();
    const created = await withMockStoreLock(() => {
      if (input.projectId && !findMockProject(input.projectId)) return null;
      return createMockTask(id, input);
    });
    if (!created) return problem(400, 'Invalid request', 'Project no longer exists.', '/api/tasks', {projectId: ['Select an existing project.']});
    const { createdAt, ...body } = created;
    void createdAt;
    return HttpResponse.json(body, {
      status: 201,
      headers: {
        Location: `/api/tasks/${id}`,
        ETag: `"${created.version}"`,
      },
    });
  }),

  http.put('/api/tasks/:id', async ({ params, request }) => {
    const failure = await beforeRequest();
    if (failure) return failure;
    const id = String(params.id);
    const invalidId = validateId(id);
    if (invalidId) return invalidId;
    const version = readVersion(request, `/api/tasks/${id}`);
    if (isHttpResponse(version)) return version;
    const input = await parseInput(request, `/api/tasks/${id}`);
    if (isResponse(input)) return input;
    const outcome = await withMockStoreLock(() => {
      const current = findMockTask(id);
      if (!current) return { kind: 'missing' as const };
      if (current.version !== version) return { kind: 'stale' as const };
      if (input.projectId && !findMockProject(input.projectId)) return {kind: 'invalid-project' as const};
      const updated = replaceMockTask(id, input);
      return updated
        ? { kind: 'updated' as const, task: updated }
        : { kind: 'missing' as const };
    });
    if (outcome.kind === 'missing') {
      return problem(
        404,
        'Task not found',
        'The requested task no longer exists.',
        `/api/tasks/${id}`,
      );
    }
    if (outcome.kind === 'stale') {
      return problem(
        412,
        'Task changed',
        'This task was changed elsewhere. Reload the latest task before saving.',
        `/api/tasks/${id}`,
      );
    }
    if (outcome.kind === 'invalid-project') return problem(400, 'Invalid request', 'Project no longer exists.', `/api/tasks/${id}`, {projectId: ['Select an existing project.']});
    const updated = outcome.task;
    const { createdAt, ...body } = updated;
    void createdAt;
    return HttpResponse.json(body, {
      headers: { ETag: `"${updated.version}"` },
    });
  }),

  http.delete('/api/tasks/:id', async ({ params, request }) => {
    const failure = await beforeRequest();
    if (failure) return failure;
    const id = String(params.id);
    const invalidId = validateId(id);
    if (invalidId) return invalidId;
    const version = readVersion(request, `/api/tasks/${id}`);
    if (isHttpResponse(version)) return version;
    const outcome = await withMockStoreLock(() => {
      const current = findMockTask(id);
      if (!current) return 'missing' as const;
      if (current.version !== version) return 'stale' as const;
      removeMockTask(id);
      return 'deleted' as const;
    });
    if (outcome === 'missing') {
      return problem(
        404,
        'Task not found',
        'The requested task no longer exists.',
        `/api/tasks/${id}`,
      );
    }
    if (outcome === 'stale') {
      return problem(
        412,
        'Task changed',
        'This task was changed elsewhere. Reload the latest task before deleting.',
        `/api/tasks/${id}`,
      );
    }
    return new HttpResponse(null, { status: 204 });
  }),
  http.patch('/api/tasks/:id/status', async ({params, request}) => {
    const failure = await beforeRequest();
    if (failure) return failure;
    const id = String(params.id);
    const invalid = validateId(id);
    if (invalid) return invalid;
    const version = readVersion(request, `/api/tasks/${id}/status`);
    if (isHttpResponse(version)) return version;
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; } catch { return problem(400, 'Invalid request', 'Invalid JSON.', request.url); }
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '') ||
      !body || typeof body !== 'object' || Object.keys(body).length !== 1 || typeof body.status !== 'string' || !['active', 'completed'].includes(body.status)) {
      return problem(400, 'Invalid request', 'Supply exactly one valid status.', request.url, {status: ['must be active or completed']});
    }
    return withMockStoreLock(() => {
      const current = findMockTask(id);
      if (!current) return problem(404, 'Not found', 'Task no longer exists.', request.url);
      if (current.version !== version) return problem(412, 'Task changed', 'Reload the latest task before retrying.', request.url);
      const updated = replaceMockTask(id, {...current, status: body.status as 'active' | 'completed'})!;
      const {createdAt, ...task} = updated;
      void createdAt;
      return HttpResponse.json(task, {headers: {ETag: `"${task.version}"`}});
    });
  }),
  http.get('/api/projects', async () => {
    const failure = await beforeRequest();
    if (failure) return failure;
    return withMockStoreLock(() => HttpResponse.json(allMockProjects()));
  }),
  http.get('/api/projects/:id', async ({params, request}) => {
    const failure = await beforeRequest();
    if (failure) return failure;
    const id = String(params.id);
    const invalid = validateId(id);
    if (invalid) return invalid;
    return withMockStoreLock(() => {
      const project = findMockProject(id);
      return project ? HttpResponse.json(project, {headers: {ETag: `"${project.version}"`}}) :
        problem(404, 'Not found', 'Project no longer exists.', request.url);
    });
  }),
  http.post('/api/projects', ({request}) => mutateProject(request)),
  http.put('/api/projects/:id', ({request, params}) => mutateProject(request, String(params.id))),
  http.delete('/api/projects/:id', async ({request, params}) => {
    const failure = await beforeRequest();
    if (failure) return failure;
    const id = String(params.id);
    const invalid = validateId(id);
    if (invalid) return invalid;
    const version = readVersion(request, request.url);
    if (isHttpResponse(version)) return version;
    return withMockStoreLock(() => {
      const project = findMockProject(id);
      if (!project) return problem(404, 'Not found', 'Project no longer exists.', request.url);
      if (project.version !== version) return problem(412, 'Project changed', 'Reload the latest project before retrying.', request.url);
      removeMockProject(id);
      return new HttpResponse(null, {status: 204});
    });
  }),
  http.get('/api/statistics', async ({request}) => {
    const failure = await beforeRequest();
    if (failure) return failure;
    const zone = new URL(request.url).searchParams.get('timeZone') ?? 'UTC';
    let today: string;
    try { today = dateInZone(zone); } catch { return problem(400, 'Invalid request', 'Invalid IANA timezone.', request.url, {timeZone: ['must be a valid IANA timezone']}); }
    return withMockStoreLock(() => {
      const tasks = allMockTasks();
      const completed = tasks.filter((task) => task.status === 'completed' && task.completedAt);
      const weekStart = weekStartFor(today);
      const weekEnd = shiftDate(weekStart, 6);
      const dates = completed.map((task) => dateInZone(zone, new Date(task.completedAt!)));
      return HttpResponse.json({
        today, weekStart, weekEnd, completedToday: dates.filter((date) => date === today).length,
        completedThisWeek: dates.filter((date) => date >= weekStart && date <= weekEnd).length,
        dailyCompletions: Array.from({length: 7}, (_, index) => {
          const date = shiftDate(today, index - 6);
          return {date, count: dates.filter((entry) => entry === date).length};
        }),
        projects: allMockProjects().map((project) => {
          const assigned = tasks.filter((task) => task.projectId === project.id);
          const completedTasks = assigned.filter((task) => task.status === 'completed').length;
          return {projectId: project.id, name: project.name, totalTasks: assigned.length, completedTasks,
            completionRate: assigned.length ? Math.round(completedTasks / assigned.length * 1000) / 10 : 0};
        }),
      });
    });
  }),
];

async function mutateProject(request: Request, id?: string): Promise<Response> {
  const failure = await beforeRequest();
  if (failure) return failure;
  if (id) {
    const invalid = validateId(id);
    if (invalid) return invalid;
  }
  const version = id ? readVersion(request, request.url) : 0;
  if (isHttpResponse(version)) return version;
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return problem(400, 'Invalid request', 'Invalid JSON.', request.url); }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '') ||
    !body || typeof body !== 'object' || Object.keys(body).length !== 1 ||
    typeof body.name !== 'string' || !body.name.trim() || codePointLength(body.name.trim()) > 100) {
    return problem(400, 'Invalid request', 'Invalid project name.', request.url, {name: ['Use 1–100 Unicode code points.']});
  }
  const name = body.name.trim();
  return withMockStoreLock(() => {
    const current = id ? findMockProject(id) : undefined;
    if (id && !current) return problem(404, 'Not found', 'Project no longer exists.', request.url);
    if (current && current.version !== version) return problem(412, 'Project changed', 'Reload the latest project before retrying.', request.url);
    if (allMockProjects().some((project) => project.id !== current?.id && project.name.toLowerCase() === name.toLowerCase())) {
      return problem(409, 'Duplicate name', 'Choose a different project name.', request.url, {name: ['A project with this name already exists.']});
    }
    const project = {id: current?.id ?? crypto.randomUUID(), name, version: current ? current.version + 1 : 0};
    writeMockProject(project);
    return HttpResponse.json(project, {status: id ? 200 : 201, headers: {ETag: `"${project.version}"`, ...(!id ? {Location: `/api/projects/${project.id}`} : {})}});
  });
}
