import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { deleteTask, listTasks, updateTask } from '../../api/client';
import type { Task } from '../../api/types';
import { server } from '../../mocks/server';
import {
  failNextMockRequest,
  removeMockTask,
  seedMockTasks,
} from '../../mocks/store';
import { renderWithQuery } from '../../test/render';
import { DeleteTaskDialog } from './DeleteTaskDialog';

const TASK: Task & { createdAt: number } = {
  id: 'a6fbc363-22a3-4f3c-9e0c-12bdb9394f7a',
  title: 'Review the launch plan',
  description: 'Check the final notes.',
  version: 0,
  createdAt: 1,
};

describe('DeleteTaskDialog', () => {
  it('requires an explicit accessible confirmation before permanent deletion', async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    const onOpenChange = vi.fn();
    seedMockTasks([TASK]);
    renderWithQuery(
      <DeleteTaskDialog
        task={TASK}
        onOpenChange={onOpenChange}
        onDeleted={onDeleted}
        onReloaded={vi.fn()}
        onRefreshList={async () => {
          await listTasks({ page: 0, size: 20, q: '' });
          return true;
        }}
      />,
    );

    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Delete this task?',
    );
    expect(screen.getByRole('button', { name: 'Keep task' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Delete permanently' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(TASK));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('protects against stale deletion and offers an explicit task reload', async () => {
    const user = userEvent.setup();
    const onReloaded = vi.fn();
    seedMockTasks([TASK]);
    renderWithQuery(
      <DeleteTaskDialog
        task={TASK}
        onOpenChange={vi.fn()}
        onDeleted={vi.fn()}
        onReloaded={onReloaded}
        onRefreshList={async () => {
          await listTasks({ page: 0, size: 20, q: '' });
          return true;
        }}
      />,
    );
    await updateTask(TASK.id, 0, {
      title: 'New version in another tab',
      description: 'Still here',
    });
    await user.click(screen.getByRole('button', { name: 'Delete permanently' }));

    expect(
      await screen.findByText(/has not been deleted/i),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Delete permanently' }),
    ).toBeDisabled();
    failNextMockRequest('503');
    await user.click(screen.getByRole('button', { name: 'Reload latest task' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not reload the latest task/i,
    );
    expect(
      screen.getByRole('button', { name: 'Reload latest task' }),
    ).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Delete permanently' }),
    ).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Reload latest task' }));
    await waitFor(() =>
      expect(onReloaded).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'New version in another tab',
          version: 1,
        }),
      ),
    );
  });

  it('switches stale-delete recovery to list refresh when reload finds 404', async () => {
    const user = userEvent.setup();
    seedMockTasks([TASK]);
    const onOpenChange = vi.fn();
    renderWithQuery(
      <DeleteTaskDialog
        task={TASK}
        onOpenChange={onOpenChange}
        onDeleted={vi.fn()}
        onReloaded={vi.fn()}
        onRefreshList={async () => {
          await listTasks({ page: 0, size: 20, q: '' });
          return true;
        }}
      />,
    );
    await updateTask(TASK.id, 0, {
      title: 'Updated in another tab',
      description: 'Latest notes',
    });
    await user.click(screen.getByRole('button', { name: 'Delete permanently' }));
    expect(await screen.findByText(/has not been deleted/i)).toBeVisible();
    await deleteTask(TASK.id, 1);

    await user.click(screen.getByRole('button', { name: 'Reload latest task' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This task no longer exists.',
    );
    expect(
      screen.getByRole('button', { name: 'Refresh task list' }),
    ).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Delete permanently' }),
    ).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Refresh task list' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(await listTasks({ page: 0, size: 20, q: '' })).toMatchObject({
      totalElements: 0,
    });
  });

  it('explains when the task was removed before this tab could delete it', async () => {
    const user = userEvent.setup();
    seedMockTasks([TASK]);
    renderWithQuery(
      <DeleteTaskDialog
        task={TASK}
        onOpenChange={vi.fn()}
        onDeleted={vi.fn()}
        onReloaded={vi.fn()}
        onRefreshList={async () => {
          await listTasks({ page: 0, size: 20, q: '' });
          return true;
        }}
      />,
    );
    await deleteTask(TASK.id, TASK.version);
    await user.click(screen.getByRole('button', { name: 'Delete permanently' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This task no longer exists.',
    );
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('offers a safe list refresh after an uncertain delete and keeps recovery actionable', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    seedMockTasks([TASK]);
    failNextMockRequest('network');
    renderWithQuery(
      <DeleteTaskDialog
        task={TASK}
        onOpenChange={onOpenChange}
        onDeleted={vi.fn()}
        onReloaded={vi.fn()}
        onRefreshList={async () => {
          await listTasks({ page: 0, size: 20, q: '' });
          return true;
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Delete permanently' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /delete outcome is uncertain/i,
    );
    expect(
      screen.getByRole('button', { name: 'Delete permanently' }),
    ).toBeDisabled();
    failNextMockRequest('503');
    await user.click(screen.getByRole('button', { name: 'Refresh task list' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not be refreshed/i,
    );
    expect(
      screen.getByRole('button', { name: 'Refresh task list' }),
    ).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Delete permanently' }),
    ).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Refresh task list' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(await listTasks({ page: 0, size: 20, q: '' })).toMatchObject({
      totalElements: 1,
    });
  });

  it('requires list review after a delete commits but returns 5xx', async () => {
    const user = userEvent.setup();
    seedMockTasks([TASK]);
    let deleteCount = 0;
    server.use(
      http.delete('/api/tasks/:id', ({ params }) => {
        deleteCount += 1;
        removeMockTask(String(params.id));
        return HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Service unavailable',
            status: 503,
            detail: 'The service is temporarily unavailable.',
            instance: `/api/tasks/${String(params.id)}`,
          },
          {
            status: 503,
            headers: { 'Content-Type': 'application/problem+json' },
          },
        );
      }),
    );
    const onOpenChange = vi.fn();
    renderWithQuery(
      <DeleteTaskDialog
        task={TASK}
        onOpenChange={onOpenChange}
        onDeleted={vi.fn()}
        onReloaded={vi.fn()}
        onRefreshList={async () => {
          await listTasks({ page: 0, size: 20, q: '' });
          return true;
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Delete permanently' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /delete outcome is uncertain/i,
    );
    expect(
      screen.getByRole('button', { name: 'Delete permanently' }),
    ).toBeDisabled();
    expect(deleteCount).toBe(1);

    await user.click(screen.getByRole('button', { name: 'Refresh task list' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(deleteCount).toBe(1);
    expect(await listTasks({ page: 0, size: 20, q: '' })).toMatchObject({
      totalElements: 0,
    });
  });

  it('does not announce success when DELETE returns an unexpected 200', async () => {
    const user = userEvent.setup();
    seedMockTasks([TASK]);
    let deleteCount = 0;
    server.use(
      http.delete('/api/tasks/:id', ({ params }) => {
        deleteCount += 1;
        removeMockTask(String(params.id));
        return HttpResponse.json({ deleted: true }, { status: 200 });
      }),
    );
    const onDeleted = vi.fn();
    const onOpenChange = vi.fn();
    renderWithQuery(
      <DeleteTaskDialog
        task={TASK}
        onOpenChange={onOpenChange}
        onDeleted={onDeleted}
        onReloaded={vi.fn()}
        onRefreshList={async () => {
          await listTasks({ page: 0, size: 20, q: '' });
          return true;
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Delete permanently' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /delete outcome is uncertain/i,
    );
    expect(onDeleted).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(
      screen.getByRole('button', { name: 'Delete permanently' }),
    ).toBeDisabled();
    expect(deleteCount).toBe(1);

    await user.click(screen.getByRole('button', { name: 'Refresh task list' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(deleteCount).toBe(1);
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
