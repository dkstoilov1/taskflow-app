import type { Task, TaskInput } from '../api/types';

export interface StoredTask extends Task {
  createdAt: number;
}

interface MockControls {
  latencyMs: number;
  nextFailure: 'network' | '500' | '503' | undefined;
}

const tasks = new Map<string, StoredTask>();
const controls: MockControls = { latencyMs: 0, nextFailure: undefined };
const STORE_STORAGE_KEY = 'taskflow.mock.tasks';
const STORE_REVISION_KEY = 'taskflow.mock.tasks.revision';
const browserPersistenceEnabled =
  typeof window !== 'undefined' && import.meta.env.VITE_API_MOCK === 'true';
let lastSeenRevision: string | null = null;

function normalizeTaskId(id: string): string {
  return id.toLowerCase();
}

function syncFromBrowserStorage(): void {
  if (!browserPersistenceEnabled) return;
  // Avoid copying and parsing the full snapshot unless another tab changed it.
  const revision = window.localStorage.getItem(STORE_REVISION_KEY) ?? '0';
  if (revision === lastSeenRevision) return;

  const serialized = window.localStorage.getItem(STORE_STORAGE_KEY);
  if (serialized === null) {
    tasks.clear();
    lastSeenRevision = revision;
    return;
  }
  try {
    const records = JSON.parse(serialized) as StoredTask[];
    tasks.clear();
    for (const task of records) tasks.set(normalizeTaskId(task.id), task);
  } catch (error) {
    console.error('Could not restore the browser mock task store.', error);
    tasks.clear();
    window.localStorage.removeItem(STORE_STORAGE_KEY);
  }
  lastSeenRevision = revision;
}

function persistToBrowserStorage(): void {
  if (!browserPersistenceEnabled) return;
  window.localStorage.setItem(
    STORE_STORAGE_KEY,
    JSON.stringify([...tasks.values()]),
  );
  // Publish the revision last; readers share the store lock with writers.
  const currentRevision = Number(
    window.localStorage.getItem(STORE_REVISION_KEY) ?? '0',
  );
  const nextRevision = Number.isSafeInteger(currentRevision)
    ? String(currentRevision + 1)
    : String(Date.now());
  window.localStorage.setItem(STORE_REVISION_KEY, nextRevision);
  lastSeenRevision = nextRevision;
}

export async function withMockStoreLock<T>(
  action: () => T,
): Promise<T> {
  if (
    typeof navigator !== 'undefined' &&
    'locks' in navigator &&
    navigator.locks
  ) {
    return navigator.locks.request('taskflow-mock-store', action);
  }
  return action();
}

export function resetMockStore(): void {
  tasks.clear();
  controls.latencyMs = 0;
  controls.nextFailure = undefined;
  // Keep the revision monotonic so a reset followed by a seed cannot reuse
  // a revision already cached by another tab.
  persistToBrowserStorage();
}

export function seedMockTasks(items: StoredTask[]): void {
  tasks.clear();
  for (const task of items) {
    tasks.set(normalizeTaskId(task.id), { ...task });
  }
  persistToBrowserStorage();
}

export function setMockLatency(milliseconds: number): void {
  controls.latencyMs = Math.max(0, milliseconds);
}

export function failNextMockRequest(
  failure: MockControls['nextFailure'],
): void {
  controls.nextFailure = failure;
}

export async function beforeMockRequest(): Promise<
  MockControls['nextFailure']
> {
  if (controls.latencyMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, controls.latencyMs));
  }
  const failure = controls.nextFailure;
  controls.nextFailure = undefined;
  syncFromBrowserStorage();
  return failure;
}

export function findMockTask(id: string): StoredTask | undefined {
  syncFromBrowserStorage();
  return tasks.get(normalizeTaskId(id));
}

export function allMockTasks(): StoredTask[] {
  syncFromBrowserStorage();
  return [...tasks.values()];
}

export function createMockTask(id: string, input: TaskInput): StoredTask {
  syncFromBrowserStorage();
  const created: StoredTask = {
    title: input.title,
    description: input.description ?? '',
    id,
    version: 0,
    createdAt: Date.now(),
  };
  tasks.set(normalizeTaskId(id), created);
  persistToBrowserStorage();
  return created;
}

export function replaceMockTask(
  id: string,
  input: TaskInput,
): StoredTask | undefined {
  syncFromBrowserStorage();
  const normalizedId = normalizeTaskId(id);
  const current = tasks.get(normalizedId);
  if (!current) return undefined;
  const updated: StoredTask = {
    ...current,
    title: input.title,
    description: input.description ?? '',
    version: current.version + 1,
  };
  tasks.set(normalizedId, updated);
  persistToBrowserStorage();
  return updated;
}

export function removeMockTask(id: string): boolean {
  syncFromBrowserStorage();
  const removed = tasks.delete(normalizeTaskId(id));
  if (removed) persistToBrowserStorage();
  return removed;
}
