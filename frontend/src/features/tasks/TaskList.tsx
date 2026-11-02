import type { Task, Project } from '../../api/types';

interface TaskListProps {
  tasks: Task[];
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  pendingTaskIds?: Set<string>;
  onStatusChange?: (task: Task) => void;
  projects?: Project[];
}

export function TaskList({
  tasks,
  onEdit,
  onDelete,
  pendingTaskIds = new Set(),
  onStatusChange,
  projects = [],
}: TaskListProps) {
  return (
    <ul className="task-list" aria-label="Tasks">
      {tasks.map((task) => {
        const pending = pendingTaskIds.has(task.id);
        return (
          <li className="task-card" key={task.id}>
            <div className="task-copy">
              <h2>{task.title}</h2>
              <p className="task-metadata">
                <span>{task.status === 'completed' ? '✓ Completed' : '○ Active'}</span>
                <span>{task.priority} priority</span>
                <span>{task.dueDate ? `Due ${task.dueDate}` : 'No deadline'}</span>
                <span>{task.projectId ? projects.find((project) => project.id === task.projectId)?.name ?? 'Project unavailable' : 'Unassigned'}</span>
              </p>
              {task.description ? (
                <p className="task-description">{task.description}</p>
              ) : (
                <p className="task-description task-description-empty">
                  No description
                </p>
              )}
            </div>
            <div className="task-actions" aria-label={`Actions for ${task.title}`}>
              {onStatusChange ? <button type="button" className="button button-quiet" onClick={() => onStatusChange(task)} disabled={pending}
                aria-label={`${task.status === 'completed' ? 'Reopen' : 'Complete'} ${task.title}`}>
                {task.status === 'completed' ? 'Reopen' : 'Complete'}
              </button> : null}
              <button
                type="button"
                className="button button-quiet"
                onClick={() => onEdit(task)}
                disabled={pending}
                aria-label={`Edit ${task.title}`}
              >
                Edit
              </button>
              <button
                type="button"
                className="button button-danger-quiet"
                onClick={() => onDelete(task)}
                disabled={pending}
                aria-label={`Delete ${task.title}`}
              >
                Delete
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
