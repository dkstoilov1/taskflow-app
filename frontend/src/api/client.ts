import type {
  ListTasksParams,
  ProblemDetails,
  Task,
  TaskInput,
  TaskPage,
  Project,
  Statistics,
  TaskStatus,
} from './types';
import { isCalendarDate, shiftDate, weekStartFor } from './calendar';

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
    Number.isSafeInteger(task.version) &&
    Number(task.version) >= 0 &&
    (task.dueDate === null || isCalendarDate(task.dueDate)) &&
    typeof task.priority === 'string' && ['low', 'medium', 'high'].includes(task.priority) &&
    (task.projectId === null || (typeof task.projectId === 'string' && CANONICAL_UUID_PATTERN.test(task.projectId))) &&
    (task.status === 'active' ? task.completedAt === null :
      task.status === 'completed' && typeof task.completedAt === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(task.completedAt) &&
      isCalendarDate(task.completedAt.slice(0, 10)) &&
      Number(task.completedAt.slice(11, 13)) <= 23 &&
      Number(task.completedAt.slice(14, 16)) <= 59 &&
      Number(task.completedAt.slice(17, 19)) <= 59 &&
      Number.isFinite(Date.parse(task.completedAt)))
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

function hasMatchingStrongEtag(response: Response, task: {version: number}): boolean {
  return response.headers.get('ETag') === `"${task.version}"`;
}

function hasExpectedTaskLocation(
  response: Response,
  task: {id: string},
  resource = 'tasks',
): boolean {
  const location = response.headers.get('Location');
  if (!location) return false;
  try {
    const responseUrl = response.url
      ? new URL(response.url)
      : new URL(`${API_BASE_URL}/${resource}`, window.location.href);
    const actualLocation = new URL(location, responseUrl);
    const expectedLocation = new URL(
      `${API_BASE_URL}/${resource}/${encodeURIComponent(task.id)}`,
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
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  const { data } = await request<TaskPage>(
    `/tasks${suffix}`,
    { signal },
    { expectedStatus: 200, validateSuccess: isTaskPage,
      validateResponse: (page) => page.page === (params.page ?? 0) && page.size === (params.size ?? 20) &&
        page.totalPages === Math.ceil(page.totalElements / page.size) &&
        page.items.length === Math.max(0, Math.min(page.size, page.totalElements - page.page * page.size)) &&
        new Set(page.items.map((task) => task.id.toLowerCase())).size === page.items.length,
    },
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
        matchesTaskInput(task, input) &&
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
  previous?: Task,
): Promise<Task> {
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
        matchesTaskInput(task, input) &&
        (!previous || previous.status !== 'completed' || input.status !== 'completed' || task.completedAt === previous.completedAt) &&
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

export function matchesTaskInput(task: Task, input: TaskInput): boolean {
  return task.title === input.title.trim() &&
    task.description === (input.description ?? '') &&
    task.dueDate === (input.dueDate ?? null) &&
    task.priority === (input.priority ?? 'medium') &&
    (input.projectId ? task.projectId !== null && sameUuid(task.projectId, input.projectId) : task.projectId === null) &&
    task.status === (input.status ?? 'active');
}

export async function changeTaskStatus(task: Task, status: TaskStatus): Promise<Task> {
  const {data} = await request<Task>(`/tasks/${encodeURIComponent(task.id)}/status`, {
    method: 'PATCH',
    headers: {'Content-Type': 'application/json', 'If-Match': `"${task.version}"`},
    body: JSON.stringify({status}),
  }, {
    expectedStatus: 200, validateSuccess: isTask,
    validateResponse: (updated, response) => sameUuid(updated.id, task.id) &&
      matchesTaskInput(updated, {...task, status}) && updated.version > task.version &&
      (task.status !== 'completed' || status !== 'completed' || updated.completedAt === task.completedAt) &&
      hasMatchingStrongEtag(response, updated),
  });
  return data;
}

function isProject(value: unknown): value is Project {
  if (!value || typeof value !== 'object') return false;
  const project = value as Record<string, unknown>;
  return typeof project.id === 'string' && CANONICAL_UUID_PATTERN.test(project.id) &&
    typeof project.name === 'string' && project.name.trim() === project.name &&
    Array.from(project.name).length >= 1 && Array.from(project.name).length <= 100 &&
    Number.isSafeInteger(project.version) && Number(project.version) >= 0;
}

export async function listProjects(signal?: AbortSignal): Promise<Project[]> {
  return (await request<Project[]>('/projects', {signal}, {
    expectedStatus: 200, validateSuccess: (value): value is Project[] =>
      Array.isArray(value) && value.every(isProject) &&
      new Set(value.map((project) => project.id.toLowerCase())).size === value.length,
  })).data;
}

export async function getProject(id: string): Promise<Project> {
  return (await request<Project>(`/projects/${encodeURIComponent(id)}`, {}, {
    expectedStatus: 200, validateSuccess: isProject,
    validateResponse: (project, response) => sameUuid(project.id, id) && hasMatchingStrongEtag(response, project),
  })).data;
}

export async function saveProject(name: string, project?: Project): Promise<Project> {
  return (await request<Project>(`/projects${project ? `/${encodeURIComponent(project.id)}` : ''}`, {
    method: project ? 'PUT' : 'POST',
    headers: {'Content-Type': 'application/json', ...(project ? {'If-Match': `"${project.version}"`} : {})},
    body: JSON.stringify({name}),
  }, {
    expectedStatus: project ? 200 : 201, validateSuccess: isProject,
    validateResponse: (saved, response) => saved.name === name.trim() && hasMatchingStrongEtag(response, saved) &&
      (project ? sameUuid(saved.id, project.id) && saved.version > project.version :
        hasExpectedTaskLocation(response, saved, 'projects')),
  })).data;
}

export async function deleteProject(project: Project): Promise<void> {
  await request<void>(`/projects/${encodeURIComponent(project.id)}`, {
    method: 'DELETE', headers: {'If-Match': `"${project.version}"`},
  }, {expectedStatus: 204});
}

function isStatistics(value: unknown): value is Statistics {
  if (!value || typeof value !== 'object') return false;
  const stats = value as Statistics;
  const count = (n: unknown) => Number.isSafeInteger(n) && Number(n) >= 0;
  return isCalendarDate(stats.today) && stats.weekStart === weekStartFor(stats.today) &&
    stats.weekEnd === shiftDate(stats.weekStart, 6) &&
    count(stats.completedToday) && count(stats.completedThisWeek) &&
    Array.isArray(stats.dailyCompletions) && stats.dailyCompletions.length === 7 &&
    stats.dailyCompletions.every((day, index) => day && day.date === shiftDate(stats.today, index - 6) && count(day.count)) &&
    stats.dailyCompletions[6].count === stats.completedToday &&
    Array.isArray(stats.projects) && stats.projects.every((project) =>
      project && isProject({id: project.projectId, name: project.name, version: 0}) &&
      count(project.totalTasks) && count(project.completedTasks) && project.completedTasks <= project.totalTasks &&
      project.completionRate === (project.totalTasks === 0 ? 0 : Math.round(project.completedTasks / project.totalTasks * 1000) / 10)) &&
    new Set(stats.projects.map((project) => project.projectId.toLowerCase())).size === stats.projects.length;
}

export async function getStatistics(timeZone: string, signal?: AbortSignal): Promise<Statistics> {
  return (await request<Statistics>(`/statistics?${new URLSearchParams({timeZone})}`, {signal}, {
    expectedStatus: 200, validateSuccess: isStatistics,
  })).data;
}
