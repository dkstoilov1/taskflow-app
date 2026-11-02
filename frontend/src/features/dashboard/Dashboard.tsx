import type { ListTasksParams, Task } from '../../api/types';
import { useTasks } from '../tasks/useTasks';
import { TaskList } from '../tasks/TaskList';
import { useStatistics } from './useStatistics';
import { useProjects } from '../projects/useProjects';

interface DashboardProps {
  timeZone: string;
  onNavigate: (params: ListTasksParams) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onStatusChange: (task: Task) => void;
}

export function Dashboard({timeZone, onNavigate, onEdit, onDelete, onStatusChange}: DashboardProps) {
  const projects = useProjects();
  const todayParams = {view: 'all', status: 'active', due: 'today', sort: 'due_asc', timeZone, page: 0, size: 5} as const;
  const overdueParams = {...todayParams, due: 'overdue'} as const;
  const upcomingParams = {view: 'upcoming', sort: 'due_asc', timeZone, page: 0, size: 5} as const;
  const today = useTasks(todayParams);
  const overdue = useTasks(overdueParams);
  const upcoming = useTasks(upcomingParams);
  const statistics = useStatistics(timeZone);
  return <section aria-label="Dashboard" className="dashboard">
    <h2>Your focus, at a glance</h2>
    <div className="dashboard-grid">
      {[{label: 'Due today', query: today, params: todayParams}, {label: 'Overdue', query: overdue, params: overdueParams}, {label: 'Upcoming deadlines', query: upcoming, params: upcomingParams}].map(({label, query, params}) =>
        <section className="dashboard-card" key={label} aria-label={label}>
          <h3>{label}{query.data ? ` · ${query.data.totalElements}` : ''}</h3>
          {query.isPending ? <p role="status">Loading {label.toLowerCase()}…</p> : query.isError ?
            <p role="alert">{label} couldn’t load. <button type="button" onClick={() => void query.refetch()}>Retry {label.toLowerCase()}</button></p> :
            query.data.items.length ? <TaskList tasks={query.data.items} projects={projects.data} onEdit={onEdit} onDelete={onDelete} onStatusChange={onStatusChange} /> : <p>No {label.toLowerCase()} tasks.</p>}
          <button type="button" className="text-button" onClick={() => onNavigate(params)}>View all {label.toLowerCase()}</button>
        </section>)}
    </div>
    <section className="statistics-panel" aria-label="Productivity statistics">
      <h2>Small steps add up</h2>
      {statistics.isPending ? <p role="status">Loading statistics…</p> : statistics.isError ?
        <p role="alert">Statistics couldn’t load. <button type="button" onClick={() => void statistics.refetch()}>Retry statistics</button></p> :
        <>
          <div className="summary-grid"><p><strong>{statistics.data.completedToday}</strong> completed today</p><p><strong>{statistics.data.completedThisWeek}</strong> completed this week</p></div>
          <p>Week: {statistics.data.weekStart} – {statistics.data.weekEnd} · {timeZone}</p>
          <h3>Last seven days</h3>
          <ol className="daily-stats" aria-label="Daily completions">{statistics.data.dailyCompletions.map((day) => <li key={day.date}><time>{day.date}</time><strong>{day.count}</strong></li>)}</ol>
          <h3>Project completion</h3>
          {statistics.data.projects.length ? <ul className="project-rates">{statistics.data.projects.map((project) => <li key={project.projectId}>
            <span>{project.name}</span><span>{project.completedTasks}/{project.totalTasks} tasks · {project.completionRate.toFixed(1)}%</span>
            <progress aria-label={`${project.name} completion`} max={100} value={project.completionRate} />
          </li>)}</ul> : <p>No projects yet.</p>}
          <p className="field-hint">Current completed tasks, not historical events. Reopening or deleting a task removes its completion count.</p>
        </>}
    </section>
  </section>;
}
