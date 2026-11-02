import { useEffect, useState } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import * as Dialog from '@radix-ui/react-dialog';
import { ApiError, reloadTask, matchesTaskInput } from '../../api/client';
import { isCalendarDate } from '../../api/calendar';
import { useProjects } from '../projects/useProjects';
import type { Task, TaskInput, TaskPage } from '../../api/types';
import { useCreateTask, useUpdateTask } from './useTasks';

const TITLE_LIMIT = 200;
const DESCRIPTION_LIMIT = 10_000;

type ConflictDecision = 'discard-draft' | 'overwrite-latest';
type UpdateRecoveryReason = 'uncertain' | 'conflict';

interface TaskFormDialogProps {
  open: boolean;
  task?: Task;
  onOpenChange: (open: boolean) => void;
  onSaved: (task: Task) => void;
  onExistingTask: (task: Task) => void;
  onReloaded?: (task: Task) => void;
  onRefreshRecentTasks: () => Promise<TaskPage>;
}

function lengthInCodePoints(value: string): number {
  return Array.from(value).length;
}

export function TaskFormDialog({
  open,
  task,
  onOpenChange,
  onSaved,
  onExistingTask,
  onReloaded,
  onRefreshRecentTasks,
}: TaskFormDialogProps) {
  const [currentTask, setCurrentTask] = useState(task);
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [metadata, setMetadata] = useState({
    dueDate: task?.dueDate ?? null, priority: task?.priority ?? 'medium',
    projectId: task?.projectId ?? null, status: task?.status ?? 'active',
  });
  const projectsQuery = useProjects();
  const draft: TaskInput = {title, description, ...metadata};
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState('');
  const [discardOpen, setDiscardOpen] = useState(false);
  const [conflictDecision, setConflictDecision] =
    useState<ConflictDecision | null>(null);
  const [uncertainCreate, setUncertainCreate] = useState(false);
  const [recentTasks, setRecentTasks] = useState<Task[] | null>(null);
  const [latestTaskReview, setLatestTaskReview] = useState<Task>();
  const [updateRecoveryReason, setUpdateRecoveryReason] =
    useState<UpdateRecoveryReason>();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCheckingLatest, setIsCheckingLatest] = useState(false);
  const [duplicateConfirmOpen, setDuplicateConfirmOpen] = useState(false);
  const [allowDuplicateAfterReview, setAllowDuplicateAfterReview] =
    useState(false);
  const createMutation = useCreateTask();
  const updateMutation = useUpdateTask();
  const isPending = createMutation.isPending || updateMutation.isPending;
  const isDirty =
    title !== (currentTask?.title ?? '') ||
    description !== (currentTask?.description ?? '') ||
    metadata.dueDate !== (currentTask?.dueDate ?? null) ||
    metadata.priority !== (currentTask?.priority ?? 'medium') ||
    metadata.projectId !== (currentTask?.projectId ?? null) ||
    metadata.status !== (currentTask?.status ?? 'active');
  const matchingRecentTask = recentTasks?.find(
    (recentTask) =>
      matchesTaskInput(recentTask, draft),
  );
  const hasUnresolvedConflict = Boolean(
    currentTask &&
      latestTaskReview &&
      latestTaskReview.version !== currentTask.version,
  );
  const canRetryUncertainCreate = Boolean(
    recentTasks !== null &&
      (!matchingRecentTask || allowDuplicateAfterReview),
  );

  useEffect(() => {
    if (!open || !isDirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [isDirty, open]);

  function requestClose(nextOpen: boolean): void {
    if (nextOpen) {
      onOpenChange(true);
      return;
    }
    if (isPending) return;
    if (isDirty) {
      setDiscardOpen(true);
      return;
    }
    onOpenChange(false);
  }

  function closeAfterDiscard(): void {
    setDiscardOpen(false);
    onOpenChange(false);
  }

  function setInput(field: keyof TaskInput, value: string): void {
    if (field === 'title') setTitle(value);
    else if (field === 'description') setDescription(value);
    else setMetadata((previous) => ({...previous, [field]: value || null}));
    setFieldErrors((previous) => {
      if (!previous[field]) return previous;
      const next = { ...previous };
      delete next[field];
      return next;
    });
    if (uncertainCreate) {
      setRecentTasks(null);
      setAllowDuplicateAfterReview(false);
      setFormError(
        'Your draft changed. Refresh recent tasks again before trying to create it.',
      );
    } else if (!updateRecoveryReason) {
      setFormError('');
    }
  }

  async function reloadLatestForReview(): Promise<void> {
    if (!currentTask) return;
    setIsCheckingLatest(true);
    setLatestTaskReview(undefined);
    try {
      const latest = await reloadTask(currentTask.id);
      updateMutation.reset();
      setLatestTaskReview(latest);
      if (latest.version === currentTask.version) {
        setUpdateRecoveryReason(undefined);
        setFormError(
          'The server version has not changed. Your draft is safe; review the values below and choose Save changes to retry.',
        );
      } else {
        setUpdateRecoveryReason('conflict');
        setFormError(
          'A newer server version exists. Review its values below, then explicitly choose whether to discard your draft or overwrite that version.',
        );
      }
    } catch (error) {
      setFormError(
        error instanceof ApiError && error.status === 404
          ? 'This task no longer exists.'
          : 'Could not reload the latest task. Your draft is still here; try again.',
      );
    } finally {
      setIsCheckingLatest(false);
    }
  }

  function requestReloadLatest(): void {
    void reloadLatestForReview();
  }

  function resolveConflictDecision(): void {
    if (!currentTask || !latestTaskReview || !conflictDecision) return;
    const latest = latestTaskReview;
    const decision = conflictDecision;
    setConflictDecision(null);
    setCurrentTask(latest);
    setLatestTaskReview(undefined);
    setUpdateRecoveryReason(undefined);
    setFieldErrors({});
    if (decision === 'discard-draft') {
      setTitle(latest.title);
      setDescription(latest.description);
      setMetadata({dueDate: latest.dueDate, priority: latest.priority, projectId: latest.projectId, status: latest.status});
      setFormError('');
    } else {
      setFormError(
        'You confirmed using the latest version. Your draft remains unchanged; choose Save changes to overwrite it.',
      );
    }
    updateMutation.reset();
    onReloaded?.(latest);
  }

  function confirmDuplicateCreate(): void {
    setDuplicateConfirmOpen(false);
    setAllowDuplicateAfterReview(true);
    setFormError(
      'You confirmed creating another task with these values. Choose Try create again to send the request.',
    );
  }

  async function refreshBeforeRetry(): Promise<void> {
    setIsRefreshing(true);
    try {
      const refreshed = await onRefreshRecentTasks();
      setRecentTasks(refreshed.items);
      setAllowDuplicateAfterReview(false);
      setFormError(
        'The unfiltered first page of recent tasks is ready to review. Your draft is unchanged; no create was retried.',
      );
    } catch {
      setRecentTasks(null);
      setFormError(
        'Could not refresh recent tasks. Your draft is safe, and no create retry was sent. Try refreshing again.',
      );
    } finally {
      setIsRefreshing(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (
      currentTask &&
      (isCheckingLatest || (updateRecoveryReason && !latestTaskReview))
    ) {
      return;
    }
    if (hasUnresolvedConflict) return;
    if (
      uncertainCreate &&
      !canRetryUncertainCreate
    ) {
      return;
    }
    const normalizedTitle = title.trim();
    const errors: Record<string, string[]> = {};
    if (!normalizedTitle) errors.title = ['A title is required.'];
    else if (lengthInCodePoints(normalizedTitle) > TITLE_LIMIT) {
      errors.title = [`Use no more than ${TITLE_LIMIT} characters.`];
    }
    if (lengthInCodePoints(description) > DESCRIPTION_LIMIT) {
      errors.description = [
        `Use no more than ${DESCRIPTION_LIMIT} characters.`,
      ];
    }
    if (metadata.dueDate !== null && !isCalendarDate(metadata.dueDate)) errors.dueDate = ['Use a valid calendar date (YYYY-MM-DD).'];
    setFieldErrors(errors);
    setFormError('');
    if (Object.keys(errors).length > 0) return;

    const input: TaskInput = { title: normalizedTitle, description, ...metadata };
    try {
      const saved = currentTask
        ? await updateMutation.mutateAsync({
            id: currentTask.id,
            version: currentTask.version,
            input,
            previous: currentTask,
          })
        : await createMutation.mutateAsync(input);
      onSaved(saved);
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError && error.problem?.fieldErrors) {
        setFieldErrors(error.problem.fieldErrors);
      }
      if (error instanceof ApiError && error.status === 412) {
        setUpdateRecoveryReason('conflict');
        setLatestTaskReview(undefined);
        setFormError(
          'This task changed in another tab. Your draft is safe; review the latest server values before choosing how to continue.',
        );
      } else if (error instanceof ApiError && error.status === 404) {
        setFormError('This task no longer exists. Your draft is still here.');
      } else if (
        error instanceof ApiError &&
        (error.status === 0 || error.outcomeUncertain)
      ) {
        if (!currentTask) {
          setUncertainCreate(true);
          setRecentTasks(null);
          setAllowDuplicateAfterReview(false);
        } else {
          setUpdateRecoveryReason('uncertain');
          setLatestTaskReview(undefined);
        }
        setFormError(
          currentTask
            ? 'The save outcome is uncertain because the request or response could not be confirmed. Your draft is safe; check the latest task version before trying again.'
            : 'The create outcome is uncertain because the request or response could not be confirmed. Your draft is safe; review recent tasks before deciding whether to retry.',
        );
      } else {
        if (!currentTask) {
          setUncertainCreate(false);
          setRecentTasks(null);
          setAllowDuplicateAfterReview(false);
        }
        setFormError(
          error instanceof ApiError
            ? error.message
            : 'The task could not be saved. Your draft is still here.',
        );
      }
    }
  }

  return (
    <>
      <Dialog.Root open={open} onOpenChange={requestClose}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content
            className="dialog-content"
            onEscapeKeyDown={(event) => {
              if (isDirty || isPending) {
                event.preventDefault();
                if (isDirty && !isPending) requestClose(false);
              }
            }}
            onPointerDownOutside={(event) => {
              if (isDirty || isPending) event.preventDefault();
            }}
          >
            <div className="dialog-heading">
              <div>
                <p className="eyebrow">{currentTask ? 'EDIT TASK' : 'NEW TASK'}</p>
                <Dialog.Title className="dialog-title">
                  {currentTask ? 'Make it clearer' : 'Capture a thought'}
                </Dialog.Title>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Close task form"
                  disabled={isPending}
                  onClick={(event) => {
                    event.preventDefault();
                    requestClose(false);
                  }}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Description className="dialog-intro">
              Keep the next step simple. You can add detail whenever you need it.
            </Dialog.Description>
            <form className="task-form" onSubmit={(event) => void submit(event)}>
              <div className="field">
                <label htmlFor="task-title">Title</label>
                <input
                  autoFocus
                  id="task-title"
                  name="title"
                  value={title}
                  onChange={(event) => setInput('title', event.target.value)}
                  aria-invalid={Boolean(fieldErrors.title)}
                  aria-describedby={
                    fieldErrors.title ? 'task-title-error' : 'task-title-count'
                  }
                  placeholder="What needs your attention?"
                  disabled={isPending}
                />
                {fieldErrors.title ? (
                  <span className="field-error" id="task-title-error">
                    {fieldErrors.title.join(' ')}
                  </span>
                ) : (
                  <span className="field-hint" id="task-title-count">
                    {lengthInCodePoints(title.trim())}/{TITLE_LIMIT}
                  </span>
                )}
              </div>
              <div className="field">
                <label htmlFor="task-description">Description</label>
                <textarea
                  id="task-description"
                  name="description"
                  value={description}
                  onChange={(event) =>
                    setInput('description', event.target.value)
                  }
                  aria-invalid={Boolean(fieldErrors.description)}
                  aria-describedby={
                    fieldErrors.description
                      ? 'task-description-error'
                      : 'task-description-count'
                  }
                  placeholder="Add context, a checklist, or a helpful link…"
                  rows={5}
                  disabled={isPending}
                />
                {fieldErrors.description ? (
                  <span className="field-error" id="task-description-error">
                    {fieldErrors.description.join(' ')}
                  </span>
                ) : (
                  <span className="field-hint" id="task-description-count">
                    {lengthInCodePoints(description)}/{DESCRIPTION_LIMIT}
                  </span>
                )}
              </div>
              <div className="metadata-fields">
                <div className="field">
                  <label htmlFor="task-dueDate">Deadline</label>
                  <input id="task-dueDate" type="date" min="0001-01-01" max="9999-12-31" value={metadata.dueDate ?? ''} disabled={isPending}
                    onChange={(event) => setInput('dueDate', event.target.value)} aria-invalid={Boolean(fieldErrors.dueDate)} aria-describedby={fieldErrors.dueDate ? 'dueDate-error' : undefined} />
                </div>
                <div className="field">
                  <label htmlFor="task-priority">Priority</label>
                  <select id="task-priority" value={metadata.priority} disabled={isPending} onChange={(event) => setInput('priority', event.target.value)} aria-invalid={Boolean(fieldErrors.priority)} aria-describedby={fieldErrors.priority ? 'priority-error' : undefined}>
                    <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="task-project">Project</label>
                  <select id="task-project" value={metadata.projectId ?? ''} disabled={isPending || projectsQuery.isPending || projectsQuery.isError}
                    onChange={(event) => setInput('projectId', event.target.value)} aria-invalid={Boolean(fieldErrors.projectId)} aria-describedby={fieldErrors.projectId ? 'projectId-error' : undefined}>
                    <option value="">Unassigned</option>
                    {metadata.projectId && !projectsQuery.data?.some((project) => project.id === metadata.projectId) ? <option value={metadata.projectId}>Unavailable project — choose another</option> : null}
                    {projectsQuery.data?.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                  </select>
                  {projectsQuery.isPending ? <span role="status">Loading projects…</span> : null}
                  {projectsQuery.isError ? <p role="alert">Projects couldn’t load. <button type="button" onClick={() => void projectsQuery.refetch()}>Retry projects</button></p> : null}
                </div>
                <div className="field">
                  <label htmlFor="task-status">Status</label>
                  <select id="task-status" value={metadata.status} disabled={isPending} onChange={(event) => setInput('status', event.target.value)} aria-invalid={Boolean(fieldErrors.status)} aria-describedby={fieldErrors.status ? 'status-error' : undefined}>
                    <option value="active">Active</option><option value="completed">Completed</option>
                  </select>
                </div>
              </div>
              {['dueDate', 'priority', 'projectId', 'status'].map((field) => fieldErrors[field] ? <p className="field-error" id={`${field}-error`} key={field} role="alert">{field}: {fieldErrors[field].join(' ')}</p> : null)}
              {formError && !updateRecoveryReason ? (
                <div className="form-error" role="alert">
                  <p>{formError}</p>
                  {uncertainCreate ? (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => void refreshBeforeRetry()}
                      disabled={isRefreshing}
                    >
                      {isRefreshing ? 'Refreshing…' : 'Refresh recent tasks'}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {updateRecoveryReason ? (
                <div className="form-error" role="alert">
                  <p>
                    {formError ||
                      (updateRecoveryReason === 'conflict'
                        ? 'Review the latest task before trying to save again.'
                        : 'Check the latest task version before trying to save again.')}
                  </p>
                  <button
                    type="button"
                    className="text-button"
                    onClick={
                      updateRecoveryReason === 'conflict'
                        ? requestReloadLatest
                        : () => void reloadLatestForReview()
                    }
                    disabled={isCheckingLatest}
                  >
                    {isCheckingLatest
                      ? 'Checking latest…'
                      : updateRecoveryReason === 'conflict'
                        ? 'Review latest task'
                        : 'Check latest version'}
                  </button>
                </div>
              ) : null}
              {latestTaskReview ? (
                <section
                  className="latest-task-review"
                  aria-labelledby="latest-task-review-title"
                >
                  <h3 id="latest-task-review-title">
                    Latest task on server · version {latestTaskReview.version}
                  </h3>
                  <p>{latestTaskReview.dueDate ?? 'No deadline'} · {latestTaskReview.priority} priority · Project: {latestTaskReview.projectId ?? 'Unassigned'} · {latestTaskReview.status}</p>
                  <p>
                    <strong>Title:</strong> {latestTaskReview.title}
                  </p>
                  <p>
                    <strong>Description:</strong>{' '}
                    {latestTaskReview.description || 'No description'}
                  </p>
                  {hasUnresolvedConflict ? (
                    <>
                      <p>
                        Your draft remains in the form. Choose deliberately:
                        discard it, or confirm that it may overwrite these
                        newer server values.
                      </p>
                      <div className="review-actions">
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => setConflictDecision('discard-draft')}
                        >
                          Discard my draft and load latest
                        </button>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => setConflictDecision('overwrite-latest')}
                        >
                          Keep my draft and overwrite latest
                        </button>
                      </div>
                    </>
                  ) : (
                    <p>
                      This is still the version you loaded. Your draft is
                      preserved; Save changes will retry with that version.
                    </p>
                  )}
                </section>
              ) : null}
              {uncertainCreate && recentTasks !== null ? (
                <section
                  className="recent-task-review"
                  aria-labelledby="recent-task-review-title"
                >
                  <h3 id="recent-task-review-title">
                    Recent tasks · unfiltered first page
                  </h3>
                  <p>
                    Review these newest tasks before deciding whether to create
                    again. Your draft is still here.
                    Only the newest 20 tasks are checked; an older match may
                    not appear. Retrying can create a duplicate.
                  </p>
                  {recentTasks.length > 0 ? (
                    <ul aria-label="Recent tasks to review">
                      {recentTasks.map((recentTask) => {
                        const isDraftMatch =
                          recentTask.id === matchingRecentTask?.id;
                        return (
                          <li key={recentTask.id}>
                            <div>
                              <strong>{recentTask.title}</strong>
                              <p>
                                {recentTask.description || 'No description'}
                              </p>
                              <p>{recentTask.dueDate ?? 'No deadline'} · {recentTask.priority} · {recentTask.projectId ?? 'Unassigned'} · {recentTask.status}</p>
                            </div>
                            {isDraftMatch ? (
                              <button
                                type="button"
                                className="text-button"
                                onClick={() => {
                                  onExistingTask(recentTask);
                                  onOpenChange(false);
                                }}
                              >
                                Use this task; don’t create another
                              </button>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p>No recent tasks were returned.</p>
                  )}
                  {matchingRecentTask ? (
                    <div className="duplicate-review">
                      <p role="status">
                            A task exactly matches this draft. Choose it above or
                            explicitly confirm if you still want another copy.
                      </p>
                      {!allowDuplicateAfterReview ? (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => setDuplicateConfirmOpen(true)}
                        >
                          Create another anyway
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </section>
              ) : null}
              <div className="form-actions">
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => requestClose(false)}
                  disabled={isPending}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={
                    isPending ||
                    isCheckingLatest ||
                    Boolean(
                      currentTask &&
                        updateRecoveryReason &&
                        !latestTaskReview,
                    ) ||
                    hasUnresolvedConflict ||
                    (uncertainCreate && !canRetryUncertainCreate)
                  }
                >
                  {isPending
                    ? 'Saving…'
                    : hasUnresolvedConflict
                      ? 'Choose how to resolve conflict'
                      : uncertainCreate
                        ? recentTasks === null
                          ? 'Review recent tasks first'
                          : 'Try create again'
                      : currentTask
                        ? 'Save changes'
                        : 'Add task'}
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <AlertDialog.Root open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="dialog-overlay dialog-overlay-top" />
          <AlertDialog.Content className="confirm-content">
            <AlertDialog.Title className="dialog-title">
              Discard your changes?
            </AlertDialog.Title>
            <AlertDialog.Description className="dialog-intro">
              All your unsaved task fields will be lost.
            </AlertDialog.Description>
            <div className="form-actions">
              <AlertDialog.Cancel asChild>
                <button type="button" className="button button-secondary">
                  Keep editing
                </button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <button
                  type="button"
                  className="button button-danger"
                  onClick={closeAfterDiscard}
                >
                  Discard changes
                </button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>

      <AlertDialog.Root
        open={conflictDecision !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setConflictDecision(null);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="dialog-overlay dialog-overlay-top" />
          <AlertDialog.Content className="confirm-content">
            <AlertDialog.Title className="dialog-title">
              {conflictDecision === 'overwrite-latest'
                ? 'Confirm overwriting the newer task?'
                : 'Discard your draft and load the latest task?'}
            </AlertDialog.Title>
            <AlertDialog.Description className="dialog-intro">
              The server has version {latestTaskReview?.version}, titled “
              {latestTaskReview?.title}”, with description “
              {latestTaskReview?.description || 'No description'}”.{' '}
              Deadline: {latestTaskReview?.dueDate ?? 'None'}; priority: {latestTaskReview?.priority};
              project: {latestTaskReview?.projectId ?? 'Unassigned'}; status: {latestTaskReview?.status}.{' '}
              {conflictDecision === 'overwrite-latest'
                ? `Your draft (“${title.trim()}”; description: “${description || 'No description'}”; deadline: ${metadata.dueDate ?? 'None'}; priority: ${metadata.priority}; project: ${metadata.projectId ?? 'Unassigned'}; status: ${metadata.status}) will replace those newer values after you confirm and then save.`
                : 'Confirming will replace all your unsaved task fields with the server values above.'}
            </AlertDialog.Description>
            <div className="form-actions">
              <AlertDialog.Cancel asChild>
                <button type="button" className="button button-secondary">
                  Keep my draft
                </button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <button
                  type="button"
                  className="button button-danger"
                  onClick={resolveConflictDecision}
                >
                  {conflictDecision === 'overwrite-latest'
                    ? 'Confirm overwrite'
                    : 'Discard draft and load latest'}
                </button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>

      <AlertDialog.Root
        open={duplicateConfirmOpen}
        onOpenChange={setDuplicateConfirmOpen}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="dialog-overlay dialog-overlay-top" />
          <AlertDialog.Content className="confirm-content">
            <AlertDialog.Title className="dialog-title">
              Create another matching task?
            </AlertDialog.Title>
            <AlertDialog.Description className="dialog-intro">
              A recent task exactly matches this draft: “
              {matchingRecentTask?.title}”. Confirming allows another task with
              the same editable fields. No create request is sent until
              you separately choose “Try create again”.
            </AlertDialog.Description>
            <div className="form-actions">
              <AlertDialog.Cancel asChild>
                <button type="button" className="button button-secondary">
                  Keep existing task
                </button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <button
                  type="button"
                  className="button button-danger"
                  onClick={confirmDuplicateCreate}
                >
                  Confirm create another
                </button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}
