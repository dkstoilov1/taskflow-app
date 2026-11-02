import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { getTask, listTasks, updateTask } from '../../api/client';
import type { Task, TaskInput, TaskPage } from '../../api/types';
import { server } from '../../mocks/server';
import {
  createMockTask,
  failNextMockRequest,
  replaceMockTask,
  seedMockTasks,
} from '../../mocks/store';
import { renderWithQuery } from '../../test/render';
import { TaskFormDialog } from './TaskFormDialog';

const fetchRecentTasks = (): Promise<TaskPage> =>
  listTasks({ page: 0, size: 20, q: '' });

const TASK: Task & { createdAt: number } = {
  id: 'a6fbc363-22a3-4f3c-9e0c-12bdb9394f7a',
  title: 'Review the launch plan',
  description: 'Keep the spacing\nexactly as entered.',
  version: 0,
  dueDate: null, priority: 'medium', projectId: null, status: 'active', completedAt: null,
  createdAt: 1,
};

async function verifyCommittedCreateRecovery(
  createResponse: () => Response,
): Promise<void> {
  const user = userEvent.setup();
  let postCount = 0;
  const onSaved = vi.fn();
  server.use(
    http.post('/api/tasks', async ({ request }) => {
      postCount += 1;
      const input = (await request.json()) as TaskInput;
      createMockTask(TASK.id, input);
      return createResponse();
    }),
  );
  renderWithQuery(
    <TaskFormDialog
      open
      onOpenChange={vi.fn()}
      onSaved={onSaved}
      onExistingTask={vi.fn()}
      onRefreshRecentTasks={fetchRecentTasks}
    />,
  );

  await user.type(screen.getByLabelText('Title'), 'Possibly committed task');
  await user.type(screen.getByLabelText('Description'), 'Committed details');
  await user.click(screen.getByRole('button', { name: 'Add task' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    /create outcome is uncertain/i,
  );
  expect(
    screen.getByRole('button', { name: 'Review recent tasks first' }),
  ).toBeDisabled();
  expect(postCount).toBe(1);

  await user.click(screen.getByRole('button', { name: 'Refresh recent tasks' }));
  expect(
    await screen.findByRole('heading', {
      name: 'Recent tasks · unfiltered first page',
    }),
  ).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Use this task; don’t create another' }),
  ).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Try create again' }),
  ).toBeDisabled();
  expect(postCount).toBe(1);
  expect(onSaved).not.toHaveBeenCalled();
  expect(await listTasks({ page: 0, size: 20, q: '' })).toMatchObject({
    totalElements: 1,
  });
}

describe('TaskFormDialog', () => {
  it('creates a task through the API and restores focus after the dialog closes', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const onOpenChange = vi.fn();
    renderWithQuery(
      <TaskFormDialog
        open
        onOpenChange={onOpenChange}
        onSaved={onSaved}
        onExistingTask={vi.fn()}
        onRefreshRecentTasks={fetchRecentTasks}
      />,
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveFocus();
    await user.type(screen.getByLabelText('Title'), '  Read the brief  ');
    await user.type(screen.getByLabelText('Description'), ' Keep whitespace ');
    await user.click(screen.getByRole('button', { name: 'Add task' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onSaved.mock.calls[0][0]).toMatchObject({
      title: 'Read the brief',
      description: ' Keep whitespace ',
      version: 0,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('validates title and Unicode code-point limits without losing the draft', async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <TaskFormDialog
        open
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
        onExistingTask={vi.fn()}
        onRefreshRecentTasks={fetchRecentTasks}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Add task' }));
    expect(await screen.findByText('A title is required.')).toBeVisible();

    const title = screen.getByLabelText('Title');
    await user.click(title);
    await user.paste('🌿'.repeat(201));
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    expect(
      await screen.findByText('Use no more than 200 characters.'),
    ).toBeVisible();
    expect(title).toHaveValue('🌿'.repeat(201));
  });

  it('preserves a dirty draft until the user explicitly confirms discard', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderWithQuery(
      <TaskFormDialog
        open
        onOpenChange={onOpenChange}
        onSaved={vi.fn()}
        onExistingTask={vi.fn()}
        onRefreshRecentTasks={fetchRecentTasks}
      />,
    );
    const title = screen.getByLabelText('Title');
    await user.type(title, 'Draft title');
    const unloadEvent = new Event('beforeunload', {
      cancelable: true,
    }) as BeforeUnloadEvent;
    window.dispatchEvent(unloadEvent);
    expect(unloadEvent.defaultPrevented).toBe(true);
    await user.keyboard('{Escape}');

    const discardDialog = await screen.findByRole('alertdialog');
    expect(discardDialog).toHaveTextContent('Discard your changes?');
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText('Title')).toHaveValue('Draft title');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    await user.click(screen.getByRole('button', { name: 'Close task form' }));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows server field errors and keeps user input intact', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('/api/tasks', () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Invalid request',
            status: 400,
            detail: 'The request contains invalid values.',
            instance: '/api/tasks',
            fieldErrors: { title: ['must contain at most 200 Unicode code points'] },
          },
          {
            status: 400,
            headers: { 'Content-Type': 'application/problem+json' },
          },
        ),
      ),
    );
    renderWithQuery(
      <TaskFormDialog
        open
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
        onExistingTask={vi.fn()}
        onRefreshRecentTasks={fetchRecentTasks}
      />,
    );
    await user.type(screen.getByLabelText('Title'), 'A retained draft');
    await user.click(screen.getByRole('button', { name: 'Add task' }));

    expect(
      await screen.findByText('must contain at most 200 Unicode code points'),
    ).toBeVisible();
    expect(screen.getByLabelText('Title')).toHaveValue('A retained draft');
  });

  it('handles malformed Problem Details without crashing or losing the draft', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('/api/tasks', () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Invalid request',
            status: 400,
            detail: 'The request contains invalid values.',
            instance: '/api/tasks',
            fieldErrors: { title: 'bad' },
          },
          {
            status: 400,
            headers: { 'Content-Type': 'application/problem+json' },
          },
        ),
      ),
    );
    renderWithQuery(
      <TaskFormDialog
        open
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
        onExistingTask={vi.fn()}
        onRefreshRecentTasks={fetchRecentTasks}
      />,
    );
    const title = screen.getByLabelText('Title');
    await user.type(title, 'Preserved draft');
    await user.click(screen.getByRole('button', { name: 'Add task' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Request failed with status 400. Review the input and try again.',
    );
    expect(title).toHaveValue('Preserved draft');
    expect(title).toHaveAttribute('aria-invalid', 'false');
  });

  it('shows server values and requires an explicit confirmation before discarding a stale draft', async () => {
    const user = userEvent.setup();
    seedMockTasks([TASK]);
    const onReloaded = vi.fn();
    renderWithQuery(
      <TaskFormDialog
        open
        task={TASK}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
        onExistingTask={vi.fn()}
        onReloaded={onReloaded}
        onRefreshRecentTasks={fetchRecentTasks}
      />,
    );

    const title = screen.getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'My unsaved draft');
    await updateTask(TASK.id, 0, {
      title: 'Changed in another tab',
      description: 'Current server description',
    });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(
      await screen.findByText(/changed in another tab/i),
    ).toBeVisible();
    expect(title).toHaveValue('My unsaved draft');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await user.clear(title);
    await user.type(title, 'Edited again after the conflict');
    expect(
      screen.getByRole('button', { name: 'Review latest task' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    failNextMockRequest('503');
    await user.click(screen.getByRole('button', { name: 'Review latest task' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not reload the latest task/i,
    );
    expect(
      screen.getByRole('button', { name: 'Review latest task' }),
    ).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await user.clear(title);
    await user.type(title, 'My final preserved draft');
    expect(title).toHaveValue('My final preserved draft');
    expect(
      screen.getByRole('button', { name: 'Review latest task' }),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Review latest task' }));
    expect(
      await screen.findByRole('heading', {
        name: 'Latest task on server · version 1',
      }),
    ).toBeVisible();
    expect(screen.getByText('Changed in another tab')).toBeVisible();
    expect(screen.getByText('Current server description')).toBeVisible();
    expect(title).toHaveValue('My final preserved draft');
    expect(screen.getByRole('button', { name: 'Choose how to resolve conflict' }))
      .toBeDisabled();

    await user.click(
      screen.getByRole('button', { name: 'Discard my draft and load latest' }),
    );
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      'Discard your draft and load the latest task?',
    );
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Current server description',
    );
    expect(title).toHaveValue('My final preserved draft');
    await user.click(screen.getByRole('button', { name: 'Keep my draft' }));
    expect(title).toHaveValue('My final preserved draft');
    expect(onReloaded).not.toHaveBeenCalled();
    expect(await getTask(TASK.id)).toMatchObject({
      title: 'Changed in another tab',
      description: 'Current server description',
      version: 1,
    });

    await user.click(
      screen.getByRole('button', { name: 'Discard my draft and load latest' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Discard draft and load latest' }),
    );
    await waitFor(() =>
      expect(title).toHaveValue('Changed in another tab'),
    );
    expect(await getTask(TASK.id)).toMatchObject({
      title: 'Changed in another tab',
      description: 'Current server description',
      version: 1,
    });
    expect(onReloaded).toHaveBeenCalledWith(
      expect.objectContaining({ version: 1 }),
    );
  });

  it('retains the draft when the task has been deleted', async () => {
    const user = userEvent.setup();
    seedMockTasks([TASK]);
    server.use(
      http.put('/api/tasks/:id', () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Task not found',
            status: 404,
            detail: 'The requested task no longer exists.',
            instance: `/api/tasks/${TASK.id}`,
          },
          {
            status: 404,
            headers: { 'Content-Type': 'application/problem+json' },
          },
        ),
      ),
    );
    renderWithQuery(
      <TaskFormDialog
        open
        task={TASK}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
        onExistingTask={vi.fn()}
        onRefreshRecentTasks={fetchRecentTasks}
      />,
    );
    await user.clear(screen.getByLabelText('Title'));
    await user.type(screen.getByLabelText('Title'), 'Keep this draft');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This task no longer exists.',
    );
    expect(screen.getByLabelText('Title')).toHaveValue('Keep this draft');
  });

  it('requires a successful recent-task refresh and an explicit choice before retrying create', async () => {
    const user = userEvent.setup();
    let refreshes = 0;
    const onSaved = vi.fn();
    renderWithQuery(
      <TaskFormDialog
        open
        onOpenChange={vi.fn()}
        onSaved={onSaved}
        onExistingTask={vi.fn()}
        onRefreshRecentTasks={async () => {
          refreshes += 1;
          return listTasks({ page: 0, size: 20, q: '' });
        }}
      />,
    );
    await user.type(screen.getByLabelText('Title'), 'Possibly created');
    failNextMockRequest('network');
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'outcome is uncertain',
    );
    expect(
      screen.getByRole('button', { name: 'Review recent tasks first' }),
    ).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Refresh recent tasks' }));
    await waitFor(() => expect(refreshes).toBe(1));
    expect(
      await screen.findByRole('heading', {
        name: 'Recent tasks · unfiltered first page',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Try create again' }),
    ).toBeEnabled();
    expect(screen.getByLabelText('Title')).toHaveValue('Possibly created');
    await user.click(screen.getByRole('button', { name: 'Try create again' }));
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Possibly created' }),
      ),
    );
  });

  it('requires a second explicit confirmation to create another exact match', async () => {
    const user = userEvent.setup();
    const existing = {
      ...TASK,
      title: 'Matching pending task',
      description: 'Same draft details',
      createdAt: 5,
    };
    seedMockTasks([existing]);
    const onSaved = vi.fn();
    renderWithQuery(
      <TaskFormDialog
        open
        onOpenChange={vi.fn()}
        onSaved={onSaved}
        onExistingTask={vi.fn()}
        onRefreshRecentTasks={fetchRecentTasks}
      />,
    );

    await user.type(screen.getByLabelText('Title'), existing.title);
    await user.type(screen.getByLabelText('Description'), existing.description);
    failNextMockRequest('network');
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /create outcome is uncertain/i,
    );
    await user.click(screen.getByRole('button', { name: 'Refresh recent tasks' }));
    expect(
      await screen.findByRole('button', {
        name: 'Use this task; don’t create another',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Try create again' }),
    ).toBeDisabled();

    await user.click(
      screen.getByRole('button', { name: 'Create another anyway' }),
    );
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      'Create another matching task?',
    );
    await user.click(screen.getByRole('button', { name: 'Keep existing task' }));
    expect(await listTasks({ page: 0, size: 20, q: '' })).toMatchObject({
      totalElements: 1,
    });

    await user.click(
      screen.getByRole('button', { name: 'Create another anyway' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Confirm create another' }),
    );
    expect(
      screen.getByRole('button', { name: 'Try create again' }),
    ).toBeEnabled();
    expect(await listTasks({ page: 0, size: 20, q: '' })).toMatchObject({
      totalElements: 1,
    });

    await user.click(screen.getByRole('button', { name: 'Try create again' }));
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith(
        expect.objectContaining({ title: existing.title }),
      ),
    );
    expect(await listTasks({ page: 0, size: 20, q: '' })).toMatchObject({
      totalElements: 2,
    });
  });

  it('requires a fresh successful review after an uncertain update before retrying', async () => {
    const user = userEvent.setup();
    seedMockTasks([TASK]);
    const onSaved = vi.fn();
    let putCount = 0;
    const onRequestStart = ({ request }: { request: Request }) => {
      if (request.method === 'PUT') putCount += 1;
    };
    server.events.on('request:start', onRequestStart);

    try {
      renderWithQuery(
        <TaskFormDialog
          open
          task={TASK}
          onOpenChange={vi.fn()}
          onSaved={onSaved}
          onExistingTask={vi.fn()}
          onRefreshRecentTasks={fetchRecentTasks}
        />,
      );
      const title = screen.getByLabelText('Title');
      await user.clear(title);
      await user.type(title, 'Safe draft after uncertain save');
      failNextMockRequest('network');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        /save outcome is uncertain/i,
      );
      expect(putCount).toBe(1);

      await user.clear(title);
      await user.type(title, 'Edited while awaiting review');
      expect(
        screen.getByRole('button', { name: 'Check latest version' }),
      ).toBeVisible();
      expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();

      failNextMockRequest('503');
      await user.click(
        screen.getByRole('button', { name: 'Check latest version' }),
      );
      expect(await screen.findByRole('alert')).toHaveTextContent(
        /could not reload the latest task/i,
      );
      expect(
        screen.getByRole('button', { name: 'Check latest version' }),
      ).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
      expect(putCount).toBe(1);

      await user.clear(title);
      await user.type(title, 'Final draft after failed review');
      expect(
        screen.getByRole('button', { name: 'Check latest version' }),
      ).toBeVisible();
      await user.click(
        screen.getByRole('button', { name: 'Check latest version' }),
      );
      expect(
        await screen.findByRole('heading', {
          name: 'Latest task on server · version 0',
        }),
      ).toBeVisible();
      expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
      expect(title).toHaveValue('Final draft after failed review');
      expect(putCount).toBe(1);
      expect(onSaved).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await waitFor(() =>
        expect(onSaved).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Final draft after failed review',
            version: 1,
          }),
        ),
      );
      expect(putCount).toBe(2);
    } finally {
      server.events.removeListener('request:start', onRequestStart);
    }
  });

  it('requires review after a committed POST returns malformed success JSON', async () => {
    await verifyCommittedCreateRecovery(() =>
      HttpResponse.text('{"truncated":', { status: 201 }),
    );
  });

  it('requires review after a committed POST returns an invalid Task shape', async () => {
    await verifyCommittedCreateRecovery(() =>
      HttpResponse.json(
        {
          id: TASK.id,
          title: 'Possibly committed task',
          version: 0,
        },
        { status: 201 },
      ),
    );
  });

  it('keeps the create draft and blocks an unchecked retry when the committed POST body has wrong fields', async () => {
    const user = userEvent.setup();
    let postCount = 0;
    const onSaved = vi.fn();
    server.use(
      http.post('/api/tasks', async ({ request }) => {
        postCount += 1;
        const input = (await request.json()) as TaskInput;
        const created = createMockTask(TASK.id, input);
        const { createdAt, ...body } = created;
        void createdAt;
        return HttpResponse.json(
          { ...body, title: 'Incorrect response title' },
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
    renderWithQuery(
      <TaskFormDialog
        open
        onOpenChange={vi.fn()}
        onSaved={onSaved}
        onExistingTask={vi.fn()}
        onRefreshRecentTasks={fetchRecentTasks}
      />,
    );
    const title = screen.getByLabelText('Title');
    const description = screen.getByLabelText('Description');
    await user.type(title, 'Committed create draft');
    await user.type(description, 'Keep these details');
    await user.click(screen.getByRole('button', { name: 'Add task' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /create outcome is uncertain/i,
    );
    expect(title).toHaveValue('Committed create draft');
    expect(description).toHaveValue('Keep these details');
    expect(onSaved).not.toHaveBeenCalled();
    expect(postCount).toBe(1);
    await user.click(screen.getByRole('button', { name: 'Refresh recent tasks' }));
    expect(
      await screen.findByRole('button', {
        name: 'Use this task; don’t create another',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Try create again' }),
    ).toBeDisabled();
    expect(postCount).toBe(1);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('does not treat a bodyless mutation success as a confirmed create', async () => {
    await verifyCommittedCreateRecovery(
      () => new Response(null, { status: 204 }),
    );
  });

  it('requires review after a PUT commits but returns an unexpected 204', async () => {
    const user = userEvent.setup();
    seedMockTasks([TASK]);
    server.use(
      http.put('/api/tasks/:id', async ({ params, request }) => {
        const input = (await request.json()) as TaskInput;
        replaceMockTask(String(params.id), input);
        return new Response(null, { status: 204 });
      }),
    );
    const onSaved = vi.fn();
    renderWithQuery(
      <TaskFormDialog
        open
        task={TASK}
        onOpenChange={vi.fn()}
        onSaved={onSaved}
        onExistingTask={vi.fn()}
        onRefreshRecentTasks={fetchRecentTasks}
      />,
    );

    await user.clear(screen.getByLabelText('Title'));
    await user.type(screen.getByLabelText('Title'), 'Possibly updated task');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /save outcome is uncertain/i,
    );
    expect(
      screen.getByRole('button', { name: 'Save changes' }),
    ).toBeDisabled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(await getTask(TASK.id)).toMatchObject({
      title: 'Possibly updated task',
      version: 1,
    });

    await user.click(screen.getByRole('button', { name: 'Check latest version' }));
    expect(
      await screen.findByRole('heading', {
        name: 'Latest task on server · version 1',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Choose how to resolve conflict' }),
    ).toBeDisabled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('keeps the update draft and blocks retry when a committed PUT body has wrong editable fields', async () => {
    const user = userEvent.setup();
    seedMockTasks([TASK]);
    let putCount = 0;
    server.use(
      http.put('/api/tasks/:id', async ({ params, request }) => {
        putCount += 1;
        const input = (await request.json()) as TaskInput;
        const updated = replaceMockTask(String(params.id), input);
        if (!updated) throw new Error('Test fixture task was not found.');
        return HttpResponse.json(
          { ...updated, description: 'Incorrect response description' },
          { headers: { ETag: `"${updated.version}"` } },
        );
      }),
    );
    const onSaved = vi.fn();
    renderWithQuery(
      <TaskFormDialog
        open
        task={TASK}
        onOpenChange={vi.fn()}
        onSaved={onSaved}
        onExistingTask={vi.fn()}
        onRefreshRecentTasks={fetchRecentTasks}
      />,
    );
    const title = screen.getByLabelText('Title');
    const description = screen.getByLabelText('Description');
    await user.clear(title);
    await user.type(title, 'Committed update draft');
    await user.clear(description);
    await user.type(description, 'Draft description');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /save outcome is uncertain/i,
    );
    expect(title).toHaveValue('Committed update draft');
    expect(description).toHaveValue('Draft description');
    expect(onSaved).not.toHaveBeenCalled();
    expect(putCount).toBe(1);
    expect(
      screen.getByRole('button', { name: 'Check latest version' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Check latest version' }));
    expect(
      await screen.findByRole('heading', {
        name: 'Latest task on server · version 1',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('region', {
        name: 'Latest task on server · version 1',
      }),
    ).toHaveTextContent('Draft description');
    expect(
      screen.getByRole('button', { name: 'Choose how to resolve conflict' }),
    ).toBeDisabled();
    expect(putCount).toBe(1);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('treats a committed PUT response that does not advance version as uncertain', async () => {
    const user = userEvent.setup();
    seedMockTasks([TASK]);
    let putCount = 0;
    server.use(
      http.put('/api/tasks/:id', async ({ params, request }) => {
        putCount += 1;
        const input = (await request.json()) as TaskInput;
        const updated = replaceMockTask(String(params.id), input);
        if (!updated) throw new Error('Test fixture task was not found.');
        return HttpResponse.json(
          { ...updated, version: 0 },
          { headers: { ETag: '"0"' } },
        );
      }),
    );
    const onSaved = vi.fn();
    renderWithQuery(
      <TaskFormDialog
        open
        task={TASK}
        onOpenChange={vi.fn()}
        onSaved={onSaved}
        onExistingTask={vi.fn()}
        onRefreshRecentTasks={fetchRecentTasks}
      />,
    );
    await user.clear(screen.getByLabelText('Title'));
    await user.type(screen.getByLabelText('Title'), 'Version must advance');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /save outcome is uncertain/i,
    );
    expect(onSaved).not.toHaveBeenCalled();
    expect(putCount).toBe(1);
    expect(
      screen.getByRole('button', { name: 'Check latest version' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(await getTask(TASK.id)).toMatchObject({
      title: 'Version must advance',
      version: 1,
    });

    await user.click(screen.getByRole('button', { name: 'Check latest version' }));
    expect(
      await screen.findByRole('heading', {
        name: 'Latest task on server · version 1',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Choose how to resolve conflict' }),
    ).toBeDisabled();
    expect(putCount).toBe(1);
  });

  it('requires review after a committed POST returns a 5xx response', async () => {
    await verifyCommittedCreateRecovery(() =>
      HttpResponse.json(
        {
          type: 'about:blank',
          title: 'Service unavailable',
          status: 503,
          detail: 'The service is temporarily unavailable.',
          instance: '/api/tasks',
        },
        {
          status: 503,
          headers: { 'Content-Type': 'application/problem+json' },
        },
      ),
    );
  });

  it('does not advance an uncertain update version until the user confirms an overwrite', async () => {
    const user = userEvent.setup();
    seedMockTasks([TASK]);
    const onSaved = vi.fn();
    const onReloaded = vi.fn();
    renderWithQuery(
      <TaskFormDialog
        open
        task={TASK}
        onOpenChange={vi.fn()}
        onSaved={onSaved}
        onExistingTask={vi.fn()}
        onReloaded={onReloaded}
        onRefreshRecentTasks={fetchRecentTasks}
      />,
    );

    const title = screen.getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'My safe retry draft');
    failNextMockRequest('network');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /save outcome is uncertain/i,
    );
    await updateTask(TASK.id, 0, {
      title: 'Changed by another tab while offline',
      description: 'Latest remote notes',
    });

    await user.click(
      screen.getByRole('button', { name: 'Check latest version' }),
    );
    expect(
      await screen.findByRole('heading', {
        name: 'Latest task on server · version 1',
      }),
    ).toBeVisible();
    expect(screen.getByText('Changed by another tab while offline')).toBeVisible();
    expect(screen.getByText('Latest remote notes')).toBeVisible();
    expect(title).toHaveValue('My safe retry draft');
    expect(screen.getByLabelText('Description')).toHaveValue(
      TASK.description,
    );
    expect(
      screen.getByRole('button', { name: 'Choose how to resolve conflict' }),
    ).toBeDisabled();
    expect(onReloaded).not.toHaveBeenCalled();
    expect(await getTask(TASK.id)).toMatchObject({
      title: 'Changed by another tab while offline',
      description: 'Latest remote notes',
      version: 1,
    });

    await user.click(
      screen.getByRole('button', { name: 'Keep my draft and overwrite latest' }),
    );
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      'Confirm overwriting the newer task?',
    );
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Changed by another tab while offline',
    );
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'My safe retry draft',
    );
    await user.click(screen.getByRole('button', { name: 'Keep my draft' }));
    expect(title).toHaveValue('My safe retry draft');
    expect(onReloaded).not.toHaveBeenCalled();
    expect(await getTask(TASK.id)).toMatchObject({
      title: 'Changed by another tab while offline',
      version: 1,
    });

    await user.click(
      screen.getByRole('button', { name: 'Keep my draft and overwrite latest' }),
    );
    await user.click(screen.getByRole('button', { name: 'Confirm overwrite' }));
    expect(title).toHaveValue('My safe retry draft');
    expect(
      screen.getByRole('button', { name: 'Save changes' }),
    ).toBeEnabled();
    expect(onReloaded).toHaveBeenCalledWith(
      expect.objectContaining({ version: 1 }),
    );
    expect(await getTask(TASK.id)).toMatchObject({
      title: 'Changed by another tab while offline',
      description: 'Latest remote notes',
      version: 1,
    });

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'My safe retry draft', version: 2 }),
      ),
    );
    expect(await getTask(TASK.id)).toMatchObject({
      title: 'My safe retry draft',
      version: 2,
    });
  });
});
