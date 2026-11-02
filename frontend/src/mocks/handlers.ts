import { http, HttpResponse } from 'msw';
import type { TaskInput } from '../api/types';
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
  return { title: (payload.title as string).trim(), description };
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
      const matching = allMockTasks()
        .filter(
          (task) =>
            !normalizedQuery ||
            task.title.toLowerCase().includes(normalizedQuery) ||
            task.description.toLowerCase().includes(normalizedQuery),
        )
        .sort(
          (left, right) =>
            right.createdAt - left.createdAt ||
            right.id.localeCompare(left.id),
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
    const created = await withMockStoreLock(() => createMockTask(id, input));
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
];
