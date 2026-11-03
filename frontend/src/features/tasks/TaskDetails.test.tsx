import { screen } from '@testing-library/react';
import { seedMockProjects, seedMockTasks } from '../../mocks/store';
import { renderWithQuery } from '../../test/render';
import { useProjects } from '../projects/useProjects';
import { TaskDetails } from './TaskDetails';
import { useTasks } from './useTasks';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';

function DetailsHarness() {
  const tasks = useTasks({ page: 0, size: 20 });
  const projects = useProjects();
  if (tasks.isError || projects.isError) return <p role="alert">Could not load details</p>;
  if (!tasks.data || !projects.data) return <p role="status">Loading details</p>;
  return <TaskDetails task={tasks.data.items[0]} projects={projects.data} />;
}

it.each([
  { projectId: PROJECT_ID, projects: [{ id: PROJECT_ID, name: 'Release notes', version: 0 }], expected: 'Release notes', status: 'active' as const, dueDate: '2026-11-06' },
  { projectId: PROJECT_ID, projects: [], expected: 'Project unavailable', status: 'completed' as const, dueDate: null },
  { projectId: null, projects: [], expected: 'Unassigned', status: 'active' as const, dueDate: null },
])('shows labeled metadata with $expected from the contract mock', async ({ projectId, projects, expected, status, dueDate }) => {
  seedMockProjects(projects);
  seedMockTasks([{
    id: '00000000-0000-4000-8000-000000000002', title: 'Review notes',
    description: '', version: 0, createdAt: 1, projectId, status, dueDate,
    priority: 'high', completedAt: status === 'completed' ? '2026-11-03T10:00:00Z' : null,
  }]);
  renderWithQuery(<DetailsHarness />);

  expect(await screen.findByText(expected)).toBeVisible();
  for (const label of ['Deadline', 'Priority', 'Project', 'Status']) {
    expect(screen.getByText(label, { selector: 'dt' })).toBeVisible();
  }
  expect(screen.getByText(dueDate ?? 'No deadline')).toBeVisible();
  expect(screen.getByText('high priority')).toHaveClass('task-priority-high');
  expect(screen.getByText(status === 'completed' ? 'Completed' : 'Active')).toHaveClass(`task-status-${status}`);
  expect(screen.queryByText(PROJECT_ID)).not.toBeInTheDocument();
});
