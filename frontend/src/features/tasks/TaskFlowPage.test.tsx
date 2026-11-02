import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { deleteTask, listTasks } from '../../api/client';
import type { Task } from '../../api/types';
import {
  failNextMockRequest,
  seedMockTasks,
  setMockLatency,
} from '../../mocks/store';
import { server } from '../../mocks/server';
import { renderWithQuery } from '../../test/render';
import { TaskFlowPage } from './TaskFlowPage';

function makeTask(index: number, createdAt = index): Task & { createdAt: number } {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    title: `Task ${index}`,
    description: `Description for task ${index}`,
    version: 0,
    createdAt,
  };
}

describe('TaskFlowPage', () => {
  it('creates, edits, searches, paginates, and permanently deletes through the API', async () => {
    const user = userEvent.setup();
    seedMockTasks([makeTask(1), makeTask(2)]);
    renderWithQuery(<TaskFlowPage />);
    expect(await screen.findByRole('heading', { name: 'Task 2' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'New task' }));
    await user.type(screen.getByLabelText('Title'), 'Collect project notes');
    await user.type(screen.getByLabelText('Description'), 'From the team');
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    expect(await screen.findByRole('heading', { name: 'Collect project notes' }))
      .toBeVisible();

    await user.click(
      screen.getByRole('button', { name: 'Edit Collect project notes' }),
    );
    const title = screen.getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Collect the final project notes');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByRole('heading', {
        name: 'Collect the final project notes',
      }),
    ).toBeVisible();

    await user.type(screen.getByRole('searchbox', { name: 'Search tasks' }), 'FINAL');
    expect(
      await screen.findByRole('heading', {
        name: 'Collect the final project notes',
      }),
    ).toBeVisible();
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Task 2' })).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    await user.click(
      screen.getByRole('button', {
        name: 'Delete Collect the final project notes',
      }),
    );
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      'Delete this task?',
    );
    await user.click(screen.getByRole('button', { name: 'Delete permanently' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', {
          name: 'Collect the final project notes',
        }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('status', { name: 'Task updates' })).toHaveTextContent(
      /deleted/i,
    );
  });

  it('indicates loading, offers a retry after a transient failure, and then shows no matches', async () => {
    const user = userEvent.setup();
    setMockLatency(80);
    failNextMockRequest('network');
    renderWithQuery(<TaskFlowPage />);
    expect(screen.getByText('Gathering your tasks…')).toBeVisible();
    expect(await screen.findByRole('heading', { name: /couldn’t load/i }))
      .toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'A fresh start.' }))
      .toBeVisible();

    await user.type(screen.getByRole('searchbox', { name: 'Search tasks' }), 'missing');
    expect(await screen.findByRole('heading', { name: 'Nothing found yet.' }))
      .toBeVisible();
    expect(screen.getByText(/Try another phrase/)).toBeVisible();
  });

  it('supports server pagination and resets to the first page for a new search', async () => {
    const user = userEvent.setup();
    seedMockTasks(Array.from({ length: 22 }, (_, index) => makeTask(index + 1)));
    renderWithQuery(<TaskFlowPage />);
    expect(await screen.findByRole('heading', { name: 'Task 22' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Task 2' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByRole('heading', { name: 'Task 2' })).toBeVisible();
    expect(screen.getByText('Page 2 of 2')).toBeVisible();
    await user.type(screen.getByRole('searchbox', { name: 'Search tasks' }), 'Task 1');
    expect(await screen.findByRole('heading', { name: 'Task 1' })).toBeVisible();
    await waitFor(() =>
      expect(screen.queryByText('Page 2 of 2')).not.toBeInTheDocument(),
    );
  });

  it('does not send an over-limit debounced query while an invalid search becomes valid', async () => {
    const user = userEvent.setup();
    const requestedQueries: string[] = [];
    const onRequestStart = ({ request }: { request: Request }) => {
      if (
        request.method === 'GET' &&
        new URL(request.url).pathname === '/api/tasks'
      ) {
        requestedQueries.push(new URL(request.url).searchParams.get('q') ?? '');
      }
    };
    server.events.on('request:start', onRequestStart);

    try {
      renderWithQuery(<TaskFlowPage />);
      const search = screen.getByRole('searchbox', { name: 'Search tasks' });
      await user.click(search);
      await user.paste('x'.repeat(201));
      expect(
        await screen.findByText('Search can contain at most 200 characters.'),
      ).toBeVisible();
      await user.keyboard('{End}{Backspace}');
      expect(search).toHaveValue('x'.repeat(200));

      await new Promise((resolve) => window.setTimeout(resolve, 50));
      expect(
        requestedQueries.every((query) => Array.from(query).length <= 200),
      ).toBe(true);
      await waitFor(() =>
        expect(requestedQueries).toContain('x'.repeat(200)),
      );
      expect(
        requestedQueries.every((query) => Array.from(query).length <= 200),
      ).toBe(true);
    } finally {
      server.events.removeListener('request:start', onRequestStart);
    }
  });

  it('resets to page one when the visible clear-search controls are used from page two', async () => {
    const user = userEvent.setup();
    seedMockTasks(Array.from({ length: 32 }, (_, index) => makeTask(index + 1)));
    renderWithQuery(<TaskFlowPage />);
    expect(await screen.findByRole('heading', { name: 'Task 32' })).toBeVisible();

    await user.type(screen.getByRole('searchbox', { name: 'Search tasks' }), 'Task');
    expect(await screen.findByText('32 tasks')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('Page 2 of 2')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(await screen.findByText('Page 1 of 2')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Task 32' })).toBeVisible();

    await user.type(screen.getByRole('searchbox', { name: 'Search tasks' }), 'no matches');
    expect(await screen.findByRole('heading', { name: 'Nothing found yet.' }))
      .toBeVisible();
    await user.click(
      screen.getAllByRole('button', { name: 'Clear search' })[1],
    );
    expect(await screen.findByText('Page 1 of 2')).toBeVisible();
  });

  it('returns to the last valid page after a refreshed response becomes out of range', async () => {
    const user = userEvent.setup();
    seedMockTasks(Array.from({ length: 21 }, (_, index) => makeTask(index + 1)));
    const { queryClient } = renderWithQuery(
      <TaskFlowPage />,
    );

    expect(await screen.findByRole('heading', { name: 'Task 21' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByRole('heading', { name: 'Task 1' })).toBeVisible();
    expect(screen.getByText('Page 2 of 2')).toBeVisible();

    await deleteTask(makeTask(1).id, 0);
    await queryClient.invalidateQueries({ queryKey: ['tasks'] });

    await waitFor(() =>
      expect(screen.queryByText('Page 2 of 2')).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('heading', { name: 'Task 21' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Task 1' })).not.toBeInTheDocument();
  });

  it('shows a retryable background-refresh error when cached results are empty', async () => {
    const user = userEvent.setup();
    const { queryClient } = renderWithQuery(<TaskFlowPage />);
    expect(await screen.findByRole('heading', { name: 'A fresh start.' }))
      .toBeVisible();

    failNextMockRequest('503');
    await queryClient.invalidateQueries({ queryKey: ['tasks'] });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /last refresh failed/i,
    );
    expect(screen.getByRole('heading', { name: 'A fresh start.' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Retry refresh' }));
    await waitFor(() =>
      expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('heading', { name: 'A fresh start.' })).toBeVisible();
  });

  it('reviews unfiltered recent tasks after uncertain create and blocks retry on refresh failure', async () => {
    const user = userEvent.setup();
    const candidate = {
      ...makeTask(99, 1_000),
      title: 'A task that may already exist',
      description: 'Preserve this new-task draft',
    };
    seedMockTasks([
      candidate,
      ...Array.from({ length: 32 }, (_, index) => ({
        ...makeTask(index + 1, index + 1),
        title: `Archive task ${index + 1}`,
      })),
    ]);
    renderWithQuery(<TaskFlowPage />);
    expect(await screen.findByRole('heading', { name: 'Archive task 32' }))
      .toBeVisible();
    await user.type(screen.getByRole('searchbox', { name: 'Search tasks' }), 'Archive');
    expect(await screen.findByText('32 tasks')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('Page 2 of 2')).toBeVisible();
    expect(screen.queryByRole('heading', { name: candidate.title }))
      .not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'New task' }));
    await user.type(screen.getByLabelText('Title'), candidate.title);
    await user.type(screen.getByLabelText('Description'), candidate.description);
    failNextMockRequest('network');
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /create outcome is uncertain/i,
    );
    expect(
      screen.getByRole('button', { name: 'Review recent tasks first' }),
    ).toBeDisabled();

    failNextMockRequest('503');
    await user.click(screen.getByRole('button', { name: 'Refresh recent tasks' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not refresh recent tasks/i,
    );
    expect(screen.getByLabelText('Title')).toHaveValue(candidate.title);
    expect(
      screen.getByRole('button', { name: 'Review recent tasks first' }),
    ).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Refresh recent tasks' }));
    expect(
      await screen.findByRole('heading', {
        name: 'Recent tasks · unfiltered first page',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('list', { name: 'Recent tasks to review' }),
    ).toHaveTextContent(candidate.title);
    expect(screen.getByLabelText('Title')).toHaveValue(candidate.title);
    expect(screen.getByLabelText('Description')).toHaveValue(candidate.description);
    expect(
      screen.getByRole('button', {
        name: 'Use this task; don’t create another',
      }),
    ).toBeVisible();

    await user.click(
      screen.getByRole('button', {
        name: 'Use this task; don’t create another',
      }),
    );
    expect(
      await screen.findByRole('status', { name: 'Task updates' }),
    ).toHaveTextContent(/no duplicate was created/i);
    expect(
      await listTasks({ page: 0, size: 20, q: '' }),
    ).toMatchObject({ totalElements: 33 });
  });

  it('starts a fresh recent-task request instead of reusing an in-flight first-page query', async () => {
    const user = userEvent.setup();
    seedMockTasks([makeTask(1)]);
    setMockLatency(1_200);
    let taskListRequests = 0;
    const onRequestStart = ({ request }: { request: Request }) => {
      if (
        request.method === 'GET' &&
        new URL(request.url).pathname === '/api/tasks'
      ) {
        taskListRequests += 1;
      }
    };
    server.events.on('request:start', onRequestStart);

    try {
      renderWithQuery(<TaskFlowPage />);
      expect(screen.getByText('Gathering your tasks…')).toBeVisible();
      await waitFor(() => expect(taskListRequests).toBe(1));
      setMockLatency(0);
      failNextMockRequest('network');

      await user.click(screen.getByRole('button', { name: 'New task' }));
      await user.type(screen.getByLabelText('Title'), 'Retry after checking');
      await user.click(screen.getByRole('button', { name: 'Add task' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        /create outcome is uncertain/i,
      );
      expect(taskListRequests).toBe(1);

      await user.click(screen.getByRole('button', { name: 'Refresh recent tasks' }));
      await waitFor(() => expect(taskListRequests).toBe(2));
      expect(
        await screen.findByRole('heading', {
          name: 'Recent tasks · unfiltered first page',
        }),
      ).toBeVisible();
      expect(screen.getByLabelText('Title')).toHaveValue('Retry after checking');
    } finally {
      server.events.removeListener('request:start', onRequestStart);
    }
  });

  it('announces an inline refresh failure while retaining the last successful results', async () => {
    const user = userEvent.setup();
    seedMockTasks([makeTask(4)]);
    renderWithQuery(<TaskFlowPage />);
    expect(await screen.findByRole('heading', { name: 'Task 4' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Delete Task 4' }));
    server.use(
      http.get(
        '/api/tasks',
        () =>
          HttpResponse.json(
            {
              type: 'about:blank',
              title: 'Service unavailable',
              status: 503,
              detail: 'The task service is temporarily unavailable.',
              instance: '/api/tasks',
            },
            {
              status: 503,
              headers: { 'Content-Type': 'application/problem+json' },
            },
          ),
        { once: true },
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Delete permanently' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/refresh failed/i);
    expect(screen.getByRole('heading', { name: 'Task 4' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Retry refresh' }));
    expect(await screen.findByRole('heading', { name: 'A fresh start.' })).toBeVisible();
  });
});
