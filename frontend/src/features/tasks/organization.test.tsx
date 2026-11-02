import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { browserTimeZone, dateInZone, shiftDate } from '../../api/calendar';
import { getTask } from '../../api/client';
import { seedMockProjects, seedMockTasks, replaceMockTask, createMockTask } from '../../mocks/store';
import { server } from '../../mocks/server';
import { renderWithQuery } from '../../test/render';
import { TaskFlowPage } from './TaskFlowPage';
import { TaskFormDialog } from './TaskFormDialog';
import { listTasks } from '../../api/client';

const ID = '00000000-0000-4000-8000-000000000001';
const PROJECT = {id: '00000000-0000-4000-8000-000000000010', name: 'Work', version: 0};
const today = dateInZone(browserTimeZone());

it('navigates dashboard previews and intersects filters, sorting and search without dropping view constraints', async () => {
  const user = userEvent.setup();
  seedMockProjects([PROJECT]);
  seedMockTasks([
    {id: ID, title: 'Overdue work', description: '', version: 0, createdAt: 1, dueDate: shiftDate(today, -1), priority: 'high', projectId: PROJECT.id},
    {id: '00000000-0000-4000-8000-000000000002', title: 'Future work', description: '', version: 0, createdAt: 2, dueDate: shiftDate(today, 1)},
  ]);
  renderWithQuery(<TaskFlowPage />);
  expect(await screen.findByRole('heading', {name: 'Overdue work'})).toBeVisible();
  await user.click(screen.getByRole('button', {name: 'View all overdue'}));
  expect(await screen.findByRole('heading', {name: 'Your tasks'})).toBeVisible();
  expect(screen.getByLabelText('Deadline filter')).toHaveValue('overdue');
  await user.click(screen.getByRole('button', {name: 'Reset filters'}));
  await user.click(screen.getByRole('button', {name: 'Today'}));
  expect(await screen.findByRole('heading', {name: 'Today and overdue'})).toBeVisible();
  expect(await screen.findByRole('heading', {name: 'Overdue work'})).toBeVisible();
  await user.selectOptions(screen.getByLabelText('Status filter'), 'completed');
  expect(await screen.findByText(/Filters intersect/)).toBeVisible();
  expect(screen.getByLabelText('Status filter')).toHaveValue('completed');
  await user.click(screen.getByRole('button', {name: 'Reset filters'}));
  await user.selectOptions(screen.getByLabelText('Priority filter'), 'high');
  await user.selectOptions(screen.getByLabelText('Project filter'), PROJECT.id);
  await user.selectOptions(screen.getByLabelText('Sort tasks'), 'priority_desc');
  expect(await screen.findByRole('heading', {name: 'Overdue work'})).toBeVisible();
  await user.click(screen.getByRole('button', {name: 'Complete Overdue work'}));
  await user.click(screen.getByRole('button', {name: 'Complete task'}));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByRole('status', {name: 'Task updates'})).toHaveTextContent('Completed');
  await user.click(screen.getByRole('button', {name: 'Completed'}));
  expect(await screen.findByRole('heading', {name: 'Overdue work'})).toBeVisible();
  await user.click(screen.getByRole('button', {name: 'Reset filters'}));
  await user.click(screen.getByRole('button', {name: 'Upcoming'}));
  expect(await screen.findByRole('heading', {name: 'Future work'})).toBeVisible();
  await user.click(screen.getByRole('button', {name: 'All Tasks'}));
  await user.selectOptions(screen.getByLabelText('Sort tasks'), 'status_desc');
  await user.selectOptions(screen.getByLabelText('Project filter'), 'unassigned');
  await waitFor(() => expect(screen.queryByRole('heading', {name: 'Overdue work'})).not.toBeInTheDocument());
});

it('sends and preserves every metadata field and guards dirty metadata-only close', async () => {
  const user = userEvent.setup();
  seedMockProjects([PROJECT]);
  renderWithQuery(<TaskFlowPage initialView="all" />);
  await screen.findByRole('heading', {name: 'A fresh start.'});
  await user.click(screen.getByRole('button', {name: 'New task'}));
  await user.type(screen.getByLabelText('Title'), 'All fields');
  fireEvent.change(screen.getByLabelText('Deadline'), {target: {value: today}});
  await user.selectOptions(screen.getByLabelText('Priority'), 'high');
  await user.selectOptions(screen.getByLabelText('Project'), PROJECT.id);
  await user.selectOptions(screen.getByLabelText('Status'), 'completed');
  await user.click(screen.getByRole('button', {name: 'Add task'}));
  expect(await screen.findByRole('heading', {name: 'All fields'})).toBeVisible();
  const task = (await listTasks({q: 'All fields'})).items[0];
  expect(task).toMatchObject({dueDate: today, priority: 'high', projectId: PROJECT.id, status: 'completed'});
  await user.click(screen.getByRole('button', {name: 'Edit All fields'}));
  await user.selectOptions(screen.getByLabelText('Priority'), 'low');
  await user.keyboard('{Escape}');
  expect(screen.getByRole('alertdialog')).toHaveTextContent('Discard your changes?');
  await user.click(screen.getByRole('button', {name: 'Keep editing'}));
  expect(screen.getByLabelText('Priority')).toHaveValue('low');
  await user.click(screen.getByRole('button', {name: 'Save changes'}));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect((await getTask(task.id)).completedAt).toBe(task.completedAt);
});

it('conflict review includes metadata, preserves draft on overwrite and replaces ALL fields on explicit discard', async () => {
  const user = userEvent.setup();
  seedMockProjects([PROJECT]);
  const task = createMockTask(ID, {title: 'Conflict', dueDate: today, priority: 'high', projectId: PROJECT.id});
  renderWithQuery(<TaskFormDialog open task={task} onOpenChange={vi.fn()} onSaved={vi.fn()} onExistingTask={vi.fn()} onRefreshRecentTasks={() => listTasks({})} />);
  await user.selectOptions(screen.getByLabelText('Priority'), 'low');
  replaceMockTask(ID, {title: 'Remote', dueDate: shiftDate(today, 1), status: 'completed', priority: 'medium'});
  await user.click(screen.getByRole('button', {name: 'Save changes'}));
  await user.click(await screen.findByRole('button', {name: 'Review latest task'}));
  expect(await screen.findByRole('heading', {name: 'Latest task on server · version 1'})).toBeVisible();
  await user.click(screen.getByRole('button', {name: 'Discard my draft and load latest'}));
  await user.click(screen.getByRole('button', {name: 'Discard draft and load latest'}));
  expect(screen.getByLabelText('Priority')).toHaveValue('medium');
  expect(screen.getByLabelText('Deadline')).toHaveValue(shiftDate(today, 1));
  expect(screen.getByLabelText('Project')).toHaveValue('');
  expect(screen.getByLabelText('Status')).toHaveValue('completed');
});

it('uncertain-create duplicate detection compares all fields and metadata changes require another fresh review', async () => {
  const user = userEvent.setup();
  createMockTask(ID, {title: 'Same title', priority: 'low'});
  server.use(http.post('/api/tasks', () => HttpResponse.error(), {once: true}));
  renderWithQuery(<TaskFormDialog open onOpenChange={vi.fn()} onSaved={vi.fn()} onExistingTask={vi.fn()} onRefreshRecentTasks={() => listTasks({})} />);
  await user.type(screen.getByLabelText('Title'), 'Same title');
  await user.click(screen.getByRole('button', {name: 'Add task'}));
  await user.click(await screen.findByRole('button', {name: 'Refresh recent tasks'}));
  expect(await screen.findByRole('button', {name: 'Try create again'})).toBeEnabled();
  expect(screen.queryByRole('button', {name: 'Use this task; don’t create another'})).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText('Priority'), 'low');
  expect(screen.getByRole('button', {name: 'Review recent tasks first'})).toBeDisabled();
  await user.click(screen.getByRole('button', {name: 'Refresh recent tasks'}));
  expect(await screen.findByRole('button', {name: 'Use this task; don’t create another'})).toBeVisible();
});

it('refreshes relative date reads on focus', async () => {
  const {queryClient} = renderWithQuery(<TaskFlowPage />);
  await screen.findByText('No due today tasks.');
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({queryKey: ['statistics']}));
  expect(invalidate).toHaveBeenCalledWith({queryKey: ['tasks']});
});
