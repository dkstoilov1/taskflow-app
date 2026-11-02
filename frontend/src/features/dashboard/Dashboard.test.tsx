import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { dateInZone, shiftDate } from '../../api/calendar';
import { seedMockProjects, seedMockTasks, setMockLatency } from '../../mocks/store';
import { server } from '../../mocks/server';
import { renderWithQuery } from '../../test/render';
import { Dashboard } from './Dashboard';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const today = dateInZone('UTC');
const props = () => ({timeZone: 'UTC', onNavigate: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), onStatusChange: vi.fn()});

it('shows bounded deadline previews, aggregate counts, seven days and empty project rates', async () => {
  const user = userEvent.setup();
  seedMockProjects([{id: PROJECT_ID, name: 'Release', version: 0}]);
  seedMockTasks(Array.from({length: 8}, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
    title: `Deadline ${index}`, description: '', version: 0, createdAt: index,
    dueDate: index < 6 ? today : shiftDate(today, index === 6 ? -1 : 1),
  })));
  const callbacks = props();
  renderWithQuery(<Dashboard {...callbacks} />);
  const due = screen.getByRole('region', {name: 'Due today'});
  expect(await within(due).findByRole('heading', {name: 'Due today · 6'})).toBeVisible();
  expect(within(due).getAllByRole('listitem')).toHaveLength(5);
  expect(await screen.findByText('0/0 tasks · 0.0%')).toBeVisible();
  expect(within(screen.getByRole('list', {name: 'Daily completions'})).getAllByRole('listitem')).toHaveLength(7);
  await user.click(within(due).getByRole('button', {name: 'View all due today'}));
  expect(callbacks.onNavigate).toHaveBeenCalledWith(expect.objectContaining({due: 'today', sort: 'due_asc', status: 'active', size: 5}));
  await user.click(within(due).getByRole('button', {name: 'Complete Deadline 5'}));
  expect(callbacks.onStatusChange).toHaveBeenCalled();
});

it('handles loading, empty previews, no projects and independently retryable read errors', async () => {
  const user = userEvent.setup();
  setMockLatency(30);
  server.use(http.get('/api/statistics', () => HttpResponse.error(), {once: true}),
    http.get('/api/tasks', () => HttpResponse.error(), {once: true}));
  renderWithQuery(<Dashboard {...props()} />);
  expect(screen.getByText('Loading statistics…')).toBeVisible();
  expect(await screen.findByRole('button', {name: 'Retry statistics'})).toBeVisible();
  await user.click(screen.getByRole('button', {name: 'Retry statistics'}));
  expect(await screen.findByText('No projects yet.')).toBeVisible();
  const retry = await screen.findByRole('button', {name: /Retry (due today|overdue|upcoming deadlines)/});
  await user.click(retry);
  await waitFor(() => expect(screen.queryByRole('button', {name: /Retry (due today|overdue|upcoming deadlines)/})).not.toBeInTheDocument());
  expect(screen.getByText('No overdue tasks.')).toBeVisible();
});
