import type { Task } from '../../api/types';

interface TaskListProps {
  tasks: Task[];
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  pendingTaskIds?: Set<string>;
}

export function TaskList({
  tasks,
  onEdit,
  onDelete,
  pendingTaskIds = new Set(),
}: TaskListProps) {
  return (
    <ul className="task-list" aria-label="Tasks">
      {tasks.map((task) => {
        const pending = pendingTaskIds.has(task.id);
        return (
          <li className="task-card" key={task.id}>
            <div className="task-copy">
              <h2>{task.title}</h2>
              {task.description ? (
                <p className="task-description">{task.description}</p>
              ) : (
                <p className="task-description task-description-empty">
                  No description
                </p>
              )}
            </div>
            <div className="task-actions" aria-label={`Actions for ${task.title}`}>
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
