import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { getTask } from '../../api/client';
import { createMockTask, replaceMockTask, removeMockTask } from '../../mocks/store';
import { server } from '../../mocks/server';
import { renderWithQuery } from '../../test/render';
import { StatusTaskDialog } from './StatusTaskDialog';

const ID = '00000000-0000-4000-8000-000000000001';

it.each(['active', 'completed'] as const)('confirms %s transition via keyboard, pending and confirmed success', async (status) => {
  const user = userEvent.setup();
  const task = createMockTask(ID, {title: 'Read brief', status, priority: 'high', dueDate: '2026-11-03'});
  const saved = vi.fn();
  const close = vi.fn();
  renderWithQuery(<StatusTaskDialog task={task} onClose={close} onSaved={saved} />);
  const action = screen.getByRole('button', {name: status === 'active' ? 'Complete task' : 'Reopen task'});
  action.focus();
  await user.keyboard('{Enter}');
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(close).toHaveBeenCalled();
  expect((await getTask(ID)).status).toBe(status === 'active' ? 'completed' : 'active');
});

it('blocks stale and uncertain writes until fresh state is reviewed and explicitly resubmitted', async () => {
  const user = userEvent.setup();
  const task = createMockTask(ID, {title: 'Original'});
  replaceMockTask(ID, {title: 'Newer', priority: 'high'});
  const saved = vi.fn();
  renderWithQuery(<StatusTaskDialog task={task} onClose={vi.fn()} onSaved={saved} />);
  await user.click(screen.getByRole('button', {name: 'Complete task'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('outcome is uncertain');
  expect(screen.getByRole('button', {name: 'Complete task'})).toBeDisabled();
  server.use(http.get('/api/tasks/:id', () => HttpResponse.error(), {once: true}));
  await user.click(screen.getByRole('button', {name: 'Review latest status'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not reload');
  await user.click(screen.getByRole('button', {name: 'Review latest status'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Latest version 1');
  expect(screen.getByText(/Newer/)).toBeVisible();
  expect(saved).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', {name: 'Complete task'}));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect((await getTask(ID)).title).toBe('Newer');
});

it('recovers a committed PATCH with a lost response without automatic retries', async () => {
  const user = userEvent.setup();
  const task = createMockTask(ID, {title: 'Uncertain'});
  server.use(http.patch('/api/tasks/:id/status', () => {
    replaceMockTask(ID, {title: task.title, status: 'completed'});
    return HttpResponse.error();
  }, {once: true}));
  renderWithQuery(<StatusTaskDialog task={task} onClose={vi.fn()} onSaved={vi.fn()} />);
  await user.click(screen.getByRole('button', {name: 'Complete task'}));
  expect(await screen.findByRole('button', {name: 'Review latest status'})).toBeVisible();
  await user.click(screen.getByRole('button', {name: 'Review latest status'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Latest version 1 is completed');
  expect((await getTask(ID)).version).toBe(1);
});

it('handles missing tasks and keeps cancel available', async () => {
  const user = userEvent.setup();
  const task = createMockTask(ID, {title: 'Gone'});
  removeMockTask(ID);
  const close = vi.fn();
  renderWithQuery(<StatusTaskDialog task={task} onClose={close} onSaved={vi.fn()} />);
  await user.click(screen.getByRole('button', {name: 'Complete task'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('no longer exists');
  expect(screen.queryByRole('button', {name: 'Review latest status'})).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', {name: 'Cancel'}));
  expect(close).toHaveBeenCalled();
});
