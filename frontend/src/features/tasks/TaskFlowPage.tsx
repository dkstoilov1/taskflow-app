import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../api/client';
import type { Task, TaskView, ListTasksParams } from '../../api/types';
import { browserTimeZone } from '../../api/calendar';
import { Dashboard } from '../dashboard/Dashboard';
import { useRelativeDateRefresh } from '../dashboard/useStatistics';
import { ProjectManager } from '../projects/ProjectManager';
import { useProjects } from '../projects/useProjects';
import { StatusTaskDialog } from './StatusTaskDialog';
import { DeleteTaskDialog } from './DeleteTaskDialog';
import { TaskFormDialog } from './TaskFormDialog';
import { TaskList } from './TaskList';
import { useRecentTasks, useTasks } from './useTasks';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

function codePointLength(value: string): number {
  return Array.from(value).length;
}

export function TaskFlowPage({initialView = 'dashboard'}: {initialView?: TaskView | 'dashboard'}) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<TaskView | 'dashboard'>(initialView);
  const [filters, setFilters] = useState<ListTasksParams>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilterCount = [filters.status, filters.priority, filters.due, filters.project].filter(Boolean).length;
  const projectsQuery = useProjects();
  const timeZone = browserTimeZone();
  useRelativeDateRefresh();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task>();
  const [deletingTask, setDeletingTask] = useState<Task>();
  const [statusTask, setStatusTask] = useState<Task>();
  const [announcement, setAnnouncement] = useState('');
  const searchLength = codePointLength(search.trim());
  const normalizedSearch = debouncedSearch.trim();
  const debouncedSearchLength = codePointLength(normalizedSearch);
  const queryEnabled =
    searchLength <= 200 && debouncedSearchLength <= 200;
  const query = useTasks(
    { ...filters, view: view === 'dashboard' ? 'all' : view, timeZone, page, size: PAGE_SIZE, q: normalizedSearch },
    queryEnabled && view !== 'dashboard',
  );
  const fetchRecentTasks = useRecentTasks();
  const tasks = query.data?.items ?? [];
  const totalPages = query.data?.totalPages ?? 0;

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedSearch(search),
      SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (
      query.isPending ||
      query.isFetching ||
      query.isPlaceholderData ||
      query.isError ||
      !query.data
    ) {
      return;
    }
    const lastValidPage = Math.max(0, query.data.totalPages - 1);
    if (page > lastValidPage) {
      queueMicrotask(() => {
        setPage((current) =>
          current === page ? Math.min(current, lastValidPage) : current,
        );
      });
    }
  }, [
    page,
    query.data,
    query.isError,
    query.isFetching,
    query.isPending,
    query.isPlaceholderData,
  ]);

  function clearSearch(): void {
    setSearch('');
    setPage(0);
  }

  function startCreate(): void {
    setEditingTask(undefined);
    setFormOpen(true);
  }

  function startEdit(task: Task): void {
    setEditingTask(task);
    setFormOpen(true);
  }

  function finishSave(task: Task): void {
    setFormOpen(false);
    setEditingTask(undefined);
    setAnnouncement(`Saved “${task.title}”.`);
  }

  function finishUseExistingTask(task: Task): void {
    setFormOpen(false);
    setEditingTask(undefined);
    setSearch('');
    setDebouncedSearch('');
    setPage(0);
    setView('all');
    setFilters({});
    setAnnouncement(
      `Found “${task.title}” in recent tasks. No duplicate was created.`,
    );
  }

  function navigate(params: ListTasksParams) {
    setView(params.view ?? 'all');
    setFilters({status: params.status, due: params.due, sort: params.sort});
    setPage(0); setSearch(''); setDebouncedSearch('');
  }

  function finishDelete(task: Task): void {
    if (
      query.data &&
      page > 0 &&
      query.data.items.length === 1 &&
      query.data.totalElements <= page * PAGE_SIZE + 1
    ) {
      setPage((current) => Math.max(0, current - 1));
    }
    setDeletingTask(undefined);
    setAnnouncement(`Deleted “${task.title}”.`);
  }

  const readError =
    query.error instanceof ApiError && query.error.status === 0
      ? 'Could not reach the task service. Check your connection and try again.'
      : query.error instanceof ApiError
        ? query.error.message
        : 'Something went wrong while loading your tasks.';

  return (
    <main className="app-shell">
      <header className="topbar">
        <a href="/" className="brand" aria-label="TaskFlow home">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>taskflow</span>
        </a>
        <span className="topbar-note">
          <span className="status-dot" aria-hidden="true" />
          Your space, just for you
        </span>
      </header>

      <section className="workspace" aria-labelledby="page-title">
        <div className="hero">
          <div className="hero-copy">
            <p className="eyebrow">A LITTLE MORE FOCUS</p>
            <h1 id="page-title">Make room for what matters.</h1>
            <p className="hero-subtitle">
              One place for the things you want to move forward.
            </p>
          </div>
          <button
            type="button"
            className="button button-primary create-button"
            onClick={startCreate}
          >
            <span aria-hidden="true">＋</span> New task
          </button>
        </div>

        <nav className="view-navigation" aria-label="Task views">
          {([['dashboard', 'Dashboard'], ['today', 'Today'], ['upcoming', 'Upcoming'], ['all', 'All Tasks'], ['completed', 'Completed']] as const).map(([key, label]) =>
            <button type="button" className="button button-secondary" key={key} aria-current={view === key ? 'page' : undefined}
              onClick={() => {setView(key); setPage(0);}}>{label}</button>)}
        </nav>
        {view === 'dashboard' ? <Dashboard timeZone={timeZone} onNavigate={navigate} onEdit={startEdit} onDelete={setDeletingTask} onStatusChange={setStatusTask} /> :
        <section className="task-section" aria-label="Your task list">
          <button
            type="button"
            className="button button-secondary filter-toggle"
            aria-expanded={filtersOpen}
            aria-controls="task-filters"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            Filters &amp; sort
            {activeFilterCount ? <span className="task-count">{activeFilterCount} active</span> : null}
            <span aria-hidden="true">{filtersOpen ? '−' : '+'}</span>
          </button>
          <div id="task-filters" className={`filter-toolbar${filtersOpen ? ' filters-open' : ''}`}>
            <label>Status filter<select value={filters.status ?? ''} onChange={(event) => {setFilters({...filters, status: event.target.value as ListTasksParams['status'] || undefined}); setPage(0);}}>
              <option value="">All statuses</option><option value="active">Active</option><option value="completed">Completed</option>
            </select></label>
            <label>Priority filter<select value={filters.priority ?? ''} onChange={(event) => {setFilters({...filters, priority: event.target.value as ListTasksParams['priority'] || undefined}); setPage(0);}}>
              <option value="">All priorities</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
            </select></label>
            <label>Deadline filter<select value={filters.due ?? ''} onChange={(event) => {setFilters({...filters, due: event.target.value as ListTasksParams['due'] || undefined}); setPage(0);}}>
              <option value="">Any deadline</option><option value="today">Today</option><option value="this_week">This week (Mon–Sun)</option><option value="overdue">Overdue</option>
            </select></label>
            <label>Project filter<select value={filters.project ?? ''} onChange={(event) => {setFilters({...filters, project: event.target.value || undefined}); setPage(0);}}>
              <option value="">All projects</option><option value="unassigned">Unassigned</option>
              {filters.project && filters.project !== 'unassigned' && !projectsQuery.data?.some((project) => project.id === filters.project) ? <option value={filters.project}>Unavailable project</option> : null}
              {projectsQuery.data?.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
            </select></label>
            <label>Sort tasks<select value={filters.sort ?? 'created_desc'} onChange={(event) => {setFilters({...filters, sort: event.target.value as ListTasksParams['sort']}); setPage(0);}}>
              <option value="created_desc">Newest first</option><option value="due_asc">Deadline: soonest first</option><option value="due_desc">Deadline: latest first</option>
              <option value="priority_desc">Priority: high first</option><option value="priority_asc">Priority: low first</option>
              <option value="status_asc">Status: active first</option><option value="status_desc">Status: completed first</option>
            </select></label>
            <button type="button" className="button button-secondary" onClick={() => {setFilters({}); clearSearch();}}>Reset filters</button>
          </div>
          <div className="list-toolbar">
            <div className="list-heading">
              <h2>{view === 'today' ? 'Today and overdue' : view === 'upcoming' ? 'Upcoming tasks' : view === 'completed' ? 'Completed tasks' : 'Your tasks'}</h2>
              {query.data ? (
                <span className="task-count">
                  {query.data.totalElements}{' '}
                  {query.data.totalElements === 1 ? 'task' : 'tasks'}
                </span>
              ) : null}
            </div>
            <div className="search-wrap">
              <label className="sr-only" htmlFor="task-search">
                Search tasks
              </label>
              <span className="search-icon" aria-hidden="true">
                ⌕
              </span>
              <input
                id="task-search"
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
                placeholder="Search your tasks"
                aria-describedby={searchLength > 200 ? 'search-error' : undefined}
              />
              {search ? (
                <button
                  type="button"
                  className="search-clear"
                  onClick={clearSearch}
                  aria-label="Clear search"
                >
                  ×
                </button>
              ) : null}
            </div>
          </div>
          {searchLength > 200 ? (
            <p className="inline-error" id="search-error" role="alert">
              Search can contain at most 200 characters.
            </p>
          ) : null}
          {query.isFetching && query.data ? (
            <p className="refresh-indicator" role="status">
              Updating tasks…
            </p>
          ) : null}
          {query.isPending ? (
            <div className="loading-panel" role="status">
              <span className="spinner" aria-hidden="true" />
              <span>Gathering your tasks…</span>
            </div>
          ) : query.isError && !query.data ? (
            <div className="state-panel error-panel" role="alert">
              <span className="state-icon" aria-hidden="true">
                !
              </span>
              <h3>Your tasks couldn’t load.</h3>
              <p>{readError}</p>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => void query.refetch()}
              >
                Try again
              </button>
            </div>
          ) : (
            <>
              {query.isError && query.data ? (
                <p className="inline-error" role="alert">
                  Your last refresh failed. Showing the saved results. {readError}{' '}
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => void query.refetch()}
                  >
                    Retry refresh
                  </button>
                </p>
              ) : null}
              {tasks.length === 0 ? (
                <div className="state-panel empty-panel">
                  <span className="empty-illustration" aria-hidden="true">
                    <span>✓</span>
                  </span>
                  <h3>
                    {normalizedSearch ? 'Nothing found yet.' : 'A fresh start.'}
                  </h3>
                  <p>
                    {normalizedSearch
                      ? 'Try another phrase, or clear your search to see everything.'
                      : 'Add a task when something comes to mind.'}
                  </p>
                  {Object.values(filters).some(Boolean) || view !== 'all' ? <p>No tasks match this view and all selected filters. Filters intersect; reset filters or choose All Tasks to broaden the results.</p> : null}
                  {normalizedSearch ? (
                    <button
                      type="button"
                      className="text-button"
                      onClick={clearSearch}
                    >
                      Clear search
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="button button-primary"
                      onClick={startCreate}
                    >
                      Add your first task
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <TaskList
                    tasks={tasks}
                    onEdit={startEdit}
                    onDelete={setDeletingTask}
                    onStatusChange={setStatusTask}
                    projects={projectsQuery.data}
                  />
                  {totalPages > 1 ? (
                    <nav className="pagination" aria-label="Task pages">
                      <span className="page-summary">
                        Page {page + 1} of {totalPages}
                      </span>
                      <div className="pagination-actions">
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() =>
                            setPage((current) => Math.max(0, current - 1))
                          }
                          disabled={page === 0}
                          aria-label="Previous page"
                        >
                          ← <span>Previous</span>
                        </button>
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() => setPage((current) => current + 1)}
                          disabled={page >= totalPages - 1}
                          aria-label="Next page"
                        >
                          <span>Next</span> →
                        </button>
                      </div>
                    </nav>
                  ) : null}
                </>
              )}
            </>
          )}
        </section>}
        <ProjectManager />
      </section>

      <footer className="footer">
        <span>Small steps add up.</span>
        <span>TaskFlow · local and yours</span>
      </footer>

      <p
        className="sr-only"
        role="status"
        aria-label="Task updates"
        aria-live="polite"
      >
        {announcement}
      </p>

      {formOpen ? (
        <TaskFormDialog
          key={editingTask?.id ?? 'new-task'}
          open={formOpen}
          task={editingTask}
          onOpenChange={(open) => {
            setFormOpen(open);
            if (!open) setEditingTask(undefined);
          }}
          onSaved={finishSave}
          onExistingTask={finishUseExistingTask}
          onReloaded={setEditingTask}
          onRefreshRecentTasks={fetchRecentTasks}
        />
      ) : null}
      {deletingTask ? (
        <DeleteTaskDialog
          key={deletingTask.id}
          task={deletingTask}
          projects={projectsQuery.data}
          onOpenChange={(open) => {
            if (!open) setDeletingTask(undefined);
          }}
          onDeleted={finishDelete}
          onReloaded={setDeletingTask}
          onRefreshList={async () => {
            await queryClient.invalidateQueries();
            return !(await query.refetch()).isError;
          }}
        />
      ) : null}
      {statusTask ? <StatusTaskDialog task={statusTask} projects={projectsQuery.data} onClose={() => setStatusTask(undefined)} onSaved={(saved) => setAnnouncement(`${saved.status === 'completed' ? 'Completed' : 'Reopened'} “${saved.title}”.`)} /> : null}
    </main>
  );
}
