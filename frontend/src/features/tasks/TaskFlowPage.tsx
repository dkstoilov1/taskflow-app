import { useEffect, useState } from 'react';
import { ApiError } from '../../api/client';
import type { Task } from '../../api/types';
import { DeleteTaskDialog } from './DeleteTaskDialog';
import { TaskFormDialog } from './TaskFormDialog';
import { TaskList } from './TaskList';
import { useRecentTasks, useTasks } from './useTasks';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

function codePointLength(value: string): number {
  return Array.from(value).length;
}

export function TaskFlowPage() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task>();
  const [deletingTask, setDeletingTask] = useState<Task>();
  const [announcement, setAnnouncement] = useState('');
  const searchLength = codePointLength(search.trim());
  const normalizedSearch = debouncedSearch.trim();
  const debouncedSearchLength = codePointLength(normalizedSearch);
  const queryEnabled =
    searchLength <= 200 && debouncedSearchLength <= 200;
  const query = useTasks(
    { page, size: PAGE_SIZE, q: normalizedSearch },
    queryEnabled,
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
    setAnnouncement(
      `Found “${task.title}” in recent tasks. No duplicate was created.`,
    );
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

        <section className="task-section" aria-label="Your task list">
          <div className="list-toolbar">
            <div className="list-heading">
              <h2>Your tasks</h2>
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
        </section>
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
          onOpenChange={(open) => {
            if (!open) setDeletingTask(undefined);
          }}
          onDeleted={finishDelete}
          onReloaded={setDeletingTask}
          onRefreshList={async () => !(await query.refetch()).isError}
        />
      ) : null}
    </main>
  );
}
