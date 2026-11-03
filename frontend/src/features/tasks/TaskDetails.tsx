import type { Project, Task } from '../../api/types';

interface TaskDetailsProps {
  task: Task;
  projects?: Project[];
}

export function TaskDetails({ task, projects = [] }: TaskDetailsProps) {
  const projectName = task.projectId
    ? projects.find((project) => project.id === task.projectId)?.name ?? 'Project unavailable'
    : 'Unassigned';

  return (
    <dl className="task-details">
      <div><dt>Deadline</dt><dd>{task.dueDate ?? 'No deadline'}</dd></div>
      <div><dt>Priority</dt><dd className={`task-badge task-priority-${task.priority}`}>{task.priority} priority</dd></div>
      <div><dt>Project</dt><dd>{projectName}</dd></div>
      <div><dt>Status</dt><dd className={`task-badge task-status-${task.status}`}>{task.status === 'completed' ? 'Completed' : 'Active'}</dd></div>
    </dl>
  );
}
