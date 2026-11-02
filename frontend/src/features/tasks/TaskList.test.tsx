import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Task } from '../../api/types';
import { seedMockTasks } from '../../mocks/store';
import { renderWithQuery } from '../../test/render';
import { TaskList } from './TaskList';
import { useTasks } from './useTasks';

const TASK: Task = {
  id: 'a6fbc363-22a3-4f3c-9e0c-12bdb9394f7a',
  title: 'Review the launch plan',
  description: 'Check the final notes.',
  version: 0,
};

function ApiBackedTaskListHarness() {
  const [selectedTitle, setSelectedTitle] = useState('');
  const query = useTasks({ page: 0, size: 20, q: '' });
  if (query.isPending) return <p role="status">Loading tasks</p>;
  if (query.isError) return <p role="alert">Could not load tasks</p>;
  if (query.data.items.length === 0) return <p>No tasks found</p>;

  return (
    <>
      <TaskList
        tasks={query.data.items}
        onEdit={(task) => setSelectedTitle(task.title)}
        onDelete={(task) => setSelectedTitle(task.title)}
      />
      {selectedTitle ? <p role="status">Selected {selectedTitle}</p> : null}
    </>
  );
}

describe('TaskList', () => {
  it('renders API-backed tasks from the stateful contract mock', async () => {
    const user = userEvent.setup();
    seedMockTasks([{ ...TASK, createdAt: 1 }]);
    renderWithQuery(<ApiBackedTaskListHarness />);

    expect(await screen.findByRole('heading', { name: TASK.title })).toBeVisible();
    expect(screen.getByText(TASK.description)).toBeVisible();
    await user.click(screen.getByRole('button', { name: `Edit ${TASK.title}` }));
    expect(screen.getByRole('status')).toHaveTextContent(
      `Selected ${TASK.title}`,
    );
  });

  it('shows task details as plain text and exposes accessible edit and delete actions', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(
      <TaskList tasks={[TASK]} onEdit={onEdit} onDelete={onDelete} />,
    );

    expect(screen.getByRole('list', { name: 'Tasks' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: TASK.title })).toBeVisible();
    expect(screen.getByText(TASK.description)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Edit Review the launch plan' }));
    await user.click(
      screen.getByRole('button', { name: 'Delete Review the launch plan' }),
    );
    expect(onEdit).toHaveBeenCalledWith(TASK);
    expect(onDelete).toHaveBeenCalledWith(TASK);
  });

  it('shows a useful empty description label and disables affected task controls', () => {
    render(
      <TaskList
        tasks={[{ ...TASK, description: '' }]}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        pendingTaskIds={new Set([TASK.id])}
      />,
    );

    expect(screen.getByText('No description')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Edit Review the launch plan' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Delete Review the launch plan' }),
    ).toBeDisabled();
  });
});
