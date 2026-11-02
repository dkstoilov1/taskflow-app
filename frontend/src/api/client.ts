import type {
  ListTasksParams,
  ProblemDetails,
  Task,
  TaskInput,
  TaskPage,
} from './types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';
const INVALID_RESPONSE_MESSAGE =
  'The service returned an invalid response. Refresh and try again.';

export class ApiError extends Error {
  readonly status: number;
  readonly problem: ProblemDetails | undefined;
  readonly outcomeUncertain: boolean;

  constructor(
    status: number,
    problem?: ProblemDetails,
    outcomeUncertain = false,
    fallbackMessage?: string,
  ) {
    super(
      problem?.detail ||
        fallbackMessage ||
        (status > 0
          ? `Request failed with status ${status}. Review the input and try again.`
          : 'The request could not be completed.'),
    );
    this.name = 'ApiError';
    this.status = status;
    this.problem = problem;
    this.outcomeUncertain = outcomeUncertain;
  }
}

interface RequestOptions<T> {
  expectedStatus: number;
  validateSuccess?: (value: unknown) => value is T;
  validateResponse?: (data: T, response: Response) => boolean;
}

const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sameUuid(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function isTask(value: unknown): value is Task {
  if (typeof value !== 'object' || value === null) return false;
  const task = value as Record<string, unknown>;
  return (
    typeof task.id === 'string' &&
    CANONICAL_UUID_PATTERN.test(task.id) &&
    typeof task.title === 'string' &&
    task.title.trim().length > 0 &&
    task.title.trim() === task.title &&
    Array.from(task.title).length <= 200 &&
    typeof task.description === 'string' &&
    Array.from(task.description).length <= 10_000 &&
    Number.isInteger(task.version) &&
    Number(task.version) >= 0
  );
}

function isTaskPage(value: unknown): value is TaskPage {
  if (typeof value !== 'object' || value === null) return false;
  const page = value as Record<string, unknown>;
  return (
    Array.isArray(page.items) &&
    page.items.every(isTask) &&
    Number.isInteger(page.page) &&
    Number(page.page) >= 0 &&
    Number.isInteger(page.size) &&
    Number(page.size) >= 1 &&
    Number(page.size) <= 100 &&
    Number.isInteger(page.totalElements) &&
    Number(page.totalElements) >= 0 &&
    Number.isInteger(page.totalPages) &&
    Number(page.totalPages) >= 0
  );
}

function isProblemDetails(value: unknown): value is ProblemDetails {
  if (typeof value !== 'object' || value === null) return false;
  const problem = value as Record<string, unknown>;
  if (
    typeof problem.type !== 'string' ||
    typeof problem.title !== 'string' ||
    !Number.isInteger(problem.status) ||
    typeof problem.detail !== 'string' ||
    typeof problem.instance !== 'string'
  ) {
    return false;
  }
  if (problem.fieldErrors === undefined) return true;
  if (
    typeof problem.fieldErrors !== 'object' ||
    problem.fieldErrors === null ||
    Array.isArray(problem.fieldErrors)
  ) {
    return false;
  }
  return Object.values(problem.fieldErrors).every(
    (messages) =>
      Array.isArray(messages) &&
      messages.every((message) => typeof message === 'string'),
  );
}

function hasMatchingStrongEtag(response: Response, task: Task): boolean {
  return response.headers.get('ETag') === `"${task.version}"`;
}

function hasExpectedTaskLocation(
  response: Response,
  task: Task,
): boolean {
  const location = response.headers.get('Location');
  if (!location) return false;
  try {
    const responseUrl = response.url
      ? new URL(response.url)
      : new URL(`${API_BASE_URL}/tasks`, window.location.href);
    const actualLocation = new URL(location, responseUrl);
    const expectedLocation = new URL(
      `${API_BASE_URL}/tasks/${encodeURIComponent(task.id)}`,
      responseUrl,
    );
    const expectedIdPrefix = expectedLocation.pathname.slice(
      0,
      expectedLocation.pathname.lastIndexOf('/') + 1,
    );
    const actualLocationId = actualLocation.pathname.slice(
      expectedIdPrefix.length,
    );
    return (
      actualLocation.origin === responseUrl.origin &&
      actualLocation.pathname.startsWith(expectedIdPrefix) &&
      CANONICAL_UUID_PATTERN.test(actualLocationId) &&
      sameUuid(actualLocationId, task.id) &&
      !actualLocation.search &&
      !actualLocation.hash
    );
  } catch {
    return false;
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  options: RequestOptions<T> = { expectedStatus: 200 },
): Promise<{ data: T; response: Response }> {
  const isWrite = Boolean(init.method && init.method.toUpperCase() !== 'GET');
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json, application/problem+json',
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(0, undefined, isWrite);
  }

  if (!response.ok) {
    let problem: ProblemDetails | undefined;
    try {
      const body: unknown = await response.json();
      if (isProblemDetails(body) && body.status === response.status) {
        problem = body;
      }
    } catch {
      problem = undefined;
    }
    throw new ApiError(
      response.status,
      problem,
      isWrite && response.status >= 500,
    );
  }

  if (response.status !== options.expectedStatus) {
    throw new ApiError(
      response.status,
      undefined,
      isWrite,
      isWrite ? undefined : INVALID_RESPONSE_MESSAGE,
    );
  }
  if (response.status === 204) {
    return { data: undefined as T, response };
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(
      response.status,
      undefined,
      isWrite,
      isWrite ? undefined : INVALID_RESPONSE_MESSAGE,
    );
  }
  if (options.validateSuccess && !options.validateSuccess(data)) {
    throw new ApiError(
      response.status,
      undefined,
      isWrite,
      isWrite ? undefined : INVALID_RESPONSE_MESSAGE,
    );
  }
  if (
    options.validateResponse &&
    !options.validateResponse(data as T, response)
  ) {
    throw new ApiError(
      response.status,
      undefined,
      isWrite,
      isWrite ? undefined : INVALID_RESPONSE_MESSAGE,
    );
  }
  return { data: data as T, response };
}

export async function listTasks(
  params: ListTasksParams,
  signal?: AbortSignal,
): Promise<TaskPage> {
  const query = new URLSearchParams();
  if (params.page !== undefined) query.set('page', String(params.page));
  if (params.size !== undefined) query.set('size', String(params.size));
  if (params.q !== undefined) query.set('q', params.q);
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  const { data } = await request<TaskPage>(
    `/tasks${suffix}`,
    { signal },
    { expectedStatus: 200, validateSuccess: isTaskPage },
  );
  return data;
}

export async function getTask(
  id: string,
  signal?: AbortSignal,
): Promise<Task> {
  const { data } = await request<Task>(
    `/tasks/${encodeURIComponent(id)}`,
    { signal },
    {
      expectedStatus: 200,
      validateSuccess: isTask,
      validateResponse: (task, response) =>
        sameUuid(task.id, id) && hasMatchingStrongEtag(response, task),
    },
  );
  return data;
}

export async function createTask(input: TaskInput): Promise<Task> {
  const expectedTitle = input.title.trim();
  const expectedDescription = input.description ?? '';
  const { data } = await request<Task>(
    '/tasks',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    {
      expectedStatus: 201,
      validateSuccess: isTask,
      validateResponse: (task, response) =>
        task.title === expectedTitle &&
        task.description === expectedDescription &&
        hasMatchingStrongEtag(response, task) &&
        hasExpectedTaskLocation(response, task),
    },
  );
  return data;
}

export async function updateTask(
  id: string,
  version: number,
  input: TaskInput,
): Promise<Task> {
  const expectedTitle = input.title.trim();
  const expectedDescription = input.description ?? '';
  const { data } = await request<Task>(
    `/tasks/${encodeURIComponent(id)}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': `"${version}"`,
      },
      body: JSON.stringify(input),
    },
    {
      expectedStatus: 200,
      validateSuccess: isTask,
      validateResponse: (task, response) =>
        sameUuid(task.id, id) &&
        task.title === expectedTitle &&
        task.description === expectedDescription &&
        task.version > version &&
        hasMatchingStrongEtag(response, task),
    },
  );
  return data;
}

export async function deleteTask(id: string, version: number): Promise<void> {
  await request<void>(
    `/tasks/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      headers: { 'If-Match': `"${version}"` },
    },
    { expectedStatus: 204 },
  );
}

export async function reloadTask(id: string): Promise<Task> {
  return getTask(id);
}
