import { http, HttpResponse } from 'msw';
import { createTask, deleteTask, getTask, listTasks, updateTask } from '../api/client';
import type { Task, TaskInput } from '../api/types';
import { server } from './server';
import {
  createMockTask,
  replaceMockTask,
  seedMockTasks,
} from './store';

const ID_A = '00000000-0000-4000-8000-000000000001';
const ID_B = '00000000-0000-4000-8000-000000000002';
const ID_NIL = '00000000-0000-0000-0000-000000000000';
const ID_NONSTANDARD = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const TASK_A: Task = {
  id: ID_A,
  title: 'Contract response task',
  description: 'Details',
  version: 0,
};

describe('stateful mock contract', () => {
  it('normalizes create input, returns strong ETag and Location, and reflects update and delete', async () => {
    const response = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '  Plan release  ', description: ' Keep\nspaces ' }),
    });
    expect(response.status).toBe(201);
    const created = await response.json();
    expect(created).toMatchObject({
      title: 'Plan release',
      description: ' Keep\nspaces ',
      version: 0,
    });
    expect(response.headers.get('ETag')).toBe('"0"');
    expect(response.headers.get('Location')).toBe(`/api/tasks/${created.id}`);
    expect(await getTask(created.id)).toEqual(created);

    const updated = await updateTask(created.id, 0, {
      title: 'Release planned',
      description: '',
    });
    expect(updated).toMatchObject({ title: 'Release planned', version: 1 });
    expect(await deleteTask(created.id, 1)).toBeUndefined();
    const missing = await fetch(`/api/tasks/${created.id}`);
    expect(missing.status).toBe(404);
  });

  it('performs literal case-insensitive search and stable server-side pagination', async () => {
    seedMockTasks([
      {
        id: ID_A,
        title: 'Alpha 100% task',
        description: 'Contains WildCard text',
        version: 0,
        createdAt: 20,
      },
      {
        id: ID_B,
        title: 'alpha second',
        description: '',
        version: 0,
        createdAt: 10,
      },
    ]);

    expect((await listTasks({ q: ' WILDCARD ' })).totalElements).toBe(1);
    expect((await listTasks({ q: '%' })).items[0].id).toBe(ID_A);
    const first = await listTasks({ page: 0, size: 1 });
    const second = await listTasks({ page: 1, size: 1 });
    expect(first.items.map((task) => task.id)).toEqual([ID_A]);
    expect(second.items.map((task) => task.id)).toEqual([ID_B]);
    expect(second.totalPages).toBe(2);
  });

  it('accepts nil and other canonical UUIDs for list and detail responses', async () => {
    seedMockTasks([
      {
        id: ID_NIL,
        title: 'Nil UUID task',
        description: '',
        version: 0,
        createdAt: 20,
      },
      {
        id: ID_NONSTANDARD,
        title: 'Canonical UUID task',
        description: 'No selected version bits',
        version: 2,
        createdAt: 10,
      },
    ]);

    const listed = await listTasks({ page: 0, size: 10 });
    expect(listed.items.map((task) => task.id)).toEqual([
      ID_NIL,
      ID_NONSTANDARD,
    ]);
    expect(await getTask(ID_NIL)).toMatchObject({ id: ID_NIL });
    expect(await getTask(ID_NONSTANDARD)).toMatchObject({
      id: ID_NONSTANDARD,
      version: 2,
    });
  });

  it('treats mixed-case UUID spellings as the same stateful task identity', async () => {
    const lowerId = 'a1b2c3d4-e5f6-abcd-ef01-23456789abcd';
    const upperId = lowerId.toUpperCase();
    seedMockTasks([
      {
        id: lowerId,
        title: 'Mixed-case identity',
        description: '',
        version: 0,
        createdAt: 1,
      },
    ]);

    expect(await getTask(upperId)).toMatchObject({ id: lowerId, version: 0 });
    const updated = await updateTask(upperId, 0, {
      title: 'Updated by uppercase spelling',
    });
    expect(updated).toMatchObject({ id: lowerId, version: 1 });
    await deleteTask(upperId, 1);
    expect((await listTasks({ page: 0, size: 10 })).totalElements).toBe(0);
  });

  it('accepts a same-origin Location with a differently cased UUID path', async () => {
    const upperId = ID_A.toUpperCase();
    server.use(
      http.post('/api/tasks', async ({ request }) => {
        const input = (await request.json()) as TaskInput;
        const created = createMockTask(ID_A, input);
        const { createdAt, ...body } = created;
        void createdAt;
        const origin = new URL(request.url).origin;
        return HttpResponse.json(body, {
          status: 201,
          headers: {
            ETag: `"${created.version}"`,
            Location: `${origin}/api/tasks/${upperId}`,
          },
        });
      }),
    );

    await expect(createTask({ title: 'Mixed-case Location' })).resolves.toMatchObject({
      id: ID_A,
      version: 0,
    });
  });

  it('rejects a detail response whose ID differs from the requested task', async () => {
    server.use(
      http.get('/api/tasks/:id', () =>
        HttpResponse.json(
          { ...TASK_A, id: ID_B },
          { headers: { ETag: '"0"' } },
        ),
      ),
    );
    await expect(getTask(ID_A)).rejects.toMatchObject({
      status: 200,
      outcomeUncertain: false,
    });
    await expect(getTask(ID_A)).rejects.toThrow(
      'The service returned an invalid response. Refresh and try again.',
    );

  });

  it('rejects malformed detail bodies and weak or missing ETags', async () => {
    server.use(
      http.get('/api/tasks/:id', () =>
        HttpResponse.json(
          { ...TASK_A, description: undefined },
          { headers: { ETag: '"0"' } },
        ),
      ),
    );
    await expect(getTask(ID_A)).rejects.toMatchObject({
      status: 200,
      outcomeUncertain: false,
    });

    server.use(
      http.get('/api/tasks/:id', () =>
        HttpResponse.json(TASK_A, { headers: { ETag: 'W/"0"' } }),
      ),
    );
    await expect(getTask(ID_A)).rejects.toMatchObject({
      status: 200,
      outcomeUncertain: false,
    });

    server.use(
      http.get('/api/tasks/:id', () => HttpResponse.json(TASK_A)),
    );
    await expect(getTask(ID_A)).rejects.toMatchObject({
      status: 200,
      outcomeUncertain: false,
    });
  });

  it('marks a committed POST uncertain when its required ETag or Location is invalid', async () => {
    server.use(
      http.post('/api/tasks', async ({ request }) => {
        const input = (await request.json()) as TaskInput;
        const created = createMockTask(ID_A, input);
        const { createdAt, ...body } = created;
        void createdAt;
        return HttpResponse.json(body, {
          status: 201,
          headers: {
            ETag: `"${created.version}"`,
            Location: `/api/tasks/${ID_B}`,
          },
        });
      }),
    );
    await expect(createTask({ title: 'Wrong Location ID' })).rejects.toMatchObject({
      status: 201,
      outcomeUncertain: true,
    });

    server.use(
      http.post('/api/tasks', async ({ request }) => {
        const input = (await request.json()) as TaskInput;
        const created = createMockTask(ID_A, input);
        const { createdAt, ...body } = created;
        void createdAt;
        return HttpResponse.json(body, {
          status: 201,
          headers: {
            ETag: `"${created.version}"`,
            Location: `https://other.example/api/tasks/${ID_A}`,
          },
        });
      }),
    );
    await expect(createTask({ title: 'Wrong Location origin' })).rejects.toMatchObject({
      status: 201,
      outcomeUncertain: true,
    });

    server.use(
      http.post('/api/tasks', async ({ request }) => {
        const input = (await request.json()) as TaskInput;
        const created = createMockTask(ID_A, input);
        const { createdAt, ...body } = created;
        void createdAt;
        return HttpResponse.json(body, {
          status: 201,
          headers: { Location: `/api/tasks/${ID_A}` },
        });
      }),
    );
    await expect(createTask({ title: 'Missing ETag' })).rejects.toMatchObject({
      status: 201,
      outcomeUncertain: true,
    });
  });

  it('expects omitted and null create descriptions to return as empty strings', async () => {
    server.use(
      http.post('/api/tasks', async ({ request }) => {
        const input = (await request.json()) as TaskInput;
        const created = createMockTask(ID_A, input);
        const { createdAt, ...body } = created;
        void createdAt;
        return HttpResponse.json(
          { ...body, description: 'Unexpected non-empty description' },
          {
            status: 201,
            headers: {
              ETag: `"${created.version}"`,
              Location: `/api/tasks/${created.id}`,
            },
          },
        );
      }),
    );

    await expect(createTask({ title: 'Omitted description' })).rejects.toMatchObject({
      status: 201,
      outcomeUncertain: true,
    });
    await expect(
      createTask({ title: 'Null description', description: null }),
    ).rejects.toMatchObject({ status: 201, outcomeUncertain: true });
  });

  it('marks committed PUT responses uncertain when their identity or ETag is inconsistent', async () => {
    seedMockTasks([{ ...TASK_A, createdAt: 1 }]);
    server.use(
      http.put('/api/tasks/:id', async ({ params, request }) => {
        const input = (await request.json()) as TaskInput;
        const updated = replaceMockTask(String(params.id), input);
        if (!updated) throw new Error('Test fixture task was not found.');
        return HttpResponse.json(
          { ...updated, id: ID_B },
          { headers: { ETag: `"${updated.version}"` } },
        );
      }),
    );
    await expect(
      updateTask(ID_A, 0, { title: 'Identity mismatch' }),
    ).rejects.toMatchObject({ status: 200, outcomeUncertain: true });

    seedMockTasks([{ ...TASK_A, createdAt: 1 }]);
    server.use(
      http.put('/api/tasks/:id', async ({ params, request }) => {
        const input = (await request.json()) as TaskInput;
        const updated = replaceMockTask(String(params.id), input);
        if (!updated) throw new Error('Test fixture task was not found.');
        return HttpResponse.json(updated, {
          headers: { ETag: '"0"' },
        });
      }),
    );
    await expect(
      updateTask(ID_A, 0, { title: 'ETag mismatch' }),
    ).rejects.toMatchObject({ status: 200, outcomeUncertain: true });
  });

  it('matches ASCII I consistently when the browser default locale is simulated as Turkish', async () => {
    seedMockTasks([
      {
        id: ID_A,
        title: 'INFO',
        description: 'Initial notes',
        version: 0,
        createdAt: 20,
      },
    ]);
    const localeLowercase = vi
      .spyOn(String.prototype, 'toLocaleLowerCase')
      .mockReturnValue('ınfo');

    try {
      expect(await listTasks({ q: 'INFO' })).toMatchObject({
        totalElements: 1,
        items: [expect.objectContaining({ title: 'INFO' })],
      });
    } finally {
      localeLowercase.mockRestore();
    }
  });

  it('returns RFC 9457 errors for invalid bodies, malformed identifiers, and missing preconditions', async () => {
    const badBody = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '   ', description: 4 }),
    });
    expect(badBody.status).toBe(400);
    expect(badBody.headers.get('Content-Type')).toContain(
      'application/problem+json',
    );
    expect(await badBody.json()).toMatchObject({
      status: 400,
      fieldErrors: {
        title: ['must not be blank'],
        description: ['must be a string'],
      },
    });

    expect((await fetch('/api/tasks/not-a-uuid')).status).toBe(400);
    const noPrecondition = await fetch(`/api/tasks/${ID_A}`, {
      method: 'DELETE',
    });
    expect(noPrecondition.status).toBe(428);
    const malformedPrecondition = await fetch(`/api/tasks/${ID_A}`, {
      method: 'DELETE',
      headers: { 'If-Match': 'W/"0"' },
    });
    expect(malformedPrecondition.status).toBe(400);
  });

  it('rejects stale versions atomically and reports that the caller should reload', async () => {
    seedMockTasks([
      {
        id: ID_A,
        title: 'Original',
        description: '',
        version: 3,
        createdAt: 1,
      },
    ]);
    const updated = await updateTask(ID_A, 3, {
      title: 'Newest',
      description: '',
    });
    expect(updated.version).toBe(4);

    const response = await fetch(`/api/tasks/${ID_A}`, {
      method: 'DELETE',
      headers: { 'If-Match': '"3"' },
    });
    expect(response.status).toBe(412);
    expect((await response.json()).detail).toContain('Reload');
    expect((await getTask(ID_A)).title).toBe('Newest');
  });

  it('normalizes an omitted description and rejects Unicode code-point limit overflow', async () => {
    const noDescription = await createTask({ title: 'No description' });
    expect(noDescription.description).toBe('');

    const overLimit = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '🌿'.repeat(201) }),
    });
    expect(overLimit.status).toBe(400);
    expect((await overLimit.json()).fieldErrors.title).toBeDefined();
  });
});
