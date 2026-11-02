import { useState } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { ApiError, reloadTask } from '../../api/client';
import type { Task } from '../../api/types';
import { useDeleteTask } from './useTasks';

type DeleteRecovery = 'reload' | 'refresh';

interface DeleteTaskDialogProps {
  task?: Task;
  onOpenChange: (open: boolean) => void;
  onDeleted: (task: Task) => void;
  onReloaded: (task: Task) => void;
  onRefreshList: () => Promise<boolean>;
}

export function DeleteTaskDialog({
  task,
  onOpenChange,
  onDeleted,
  onReloaded,
  onRefreshList,
}: DeleteTaskDialogProps) {
  const [error, setError] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [recovery, setRecovery] = useState<DeleteRecovery>();
  const deleteMutation = useDeleteTask();
  const open = Boolean(task);

  async function confirmDelete(): Promise<void> {
    if (!task || deleteMutation.isPending || recovery) return;
    setError('');
    try {
      await deleteMutation.mutateAsync({ id: task.id, version: task.version });
      onDeleted(task);
      onOpenChange(false);
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 412) {
        setRecovery('reload');
        setError(
          'This task changed in another tab. It has not been deleted. Reload the latest version before trying again.',
        );
      } else if (failure instanceof ApiError && failure.status === 404) {
        setRecovery('refresh');
        setError('This task no longer exists. Refresh the task list.');
      } else if (
        failure instanceof ApiError &&
        (failure.status === 0 || failure.outcomeUncertain)
      ) {
        setRecovery('refresh');
        setError(
          'The delete outcome is uncertain because the request or response could not be confirmed. Refresh the list before trying again.',
        );
      } else {
        setError(
          failure instanceof ApiError
            ? failure.message
            : 'The task could not be deleted. Try again.',
        );
      }
    }
  }

  async function reloadLatest(): Promise<void> {
    if (!task || isReloading) return;
    setIsReloading(true);
    try {
      const latest = await reloadTask(task.id);
      onReloaded(latest);
      deleteMutation.reset();
      setRecovery(undefined);
      setError('');
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 404) {
        setRecovery('refresh');
        setError('This task no longer exists. Refresh the task list.');
        return;
      }
      setError(
        'Could not reload the latest task. Please try again.',
      );
    } finally {
      setIsReloading(false);
    }
  }

  async function refreshTaskList(): Promise<void> {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      const refreshed = await onRefreshList();
      if (!refreshed) {
        setError(
          'The task list could not be refreshed. The delete outcome may still be uncertain; try again.',
        );
        return;
      }
      setError('');
      setRecovery(undefined);
      onOpenChange(false);
    } catch {
      setError(
        'The task list could not be refreshed. The delete outcome may still be uncertain; try again.',
      );
    } finally {
      setIsRefreshing(false);
    }
  }

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!deleteMutation.isPending) onOpenChange(nextOpen);
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="dialog-overlay" />
        <AlertDialog.Content className="confirm-content">
          <p className="eyebrow">PERMANENT ACTION</p>
          <AlertDialog.Title className="dialog-title">
            Delete this task?
          </AlertDialog.Title>
          <AlertDialog.Description className="dialog-intro">
            “{task?.title}” will be permanently removed. This can’t be undone.
            {' '}Deadline: {task?.dueDate ?? 'None'}; priority: {task?.priority};
            project: {task?.projectId ?? 'Unassigned'}; status: {task?.status}.
          </AlertDialog.Description>
          {error ? (
            <div className="form-error" role="alert">
              <p>{error}</p>
              {recovery === 'reload' ? (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void reloadLatest()}
                  disabled={isReloading}
                >
                  {isReloading ? 'Reloading…' : 'Reload latest task'}
                </button>
              ) : null}
              {recovery === 'refresh' ? (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void refreshTaskList()}
                  disabled={isRefreshing}
                >
                  {isRefreshing ? 'Refreshing…' : 'Refresh task list'}
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="form-actions">
            <AlertDialog.Cancel asChild>
              <button
                type="button"
                className="button button-secondary"
                disabled={deleteMutation.isPending}
              >
                Keep task
              </button>
            </AlertDialog.Cancel>
            <button
              type="button"
              className="button button-danger"
              onClick={() => void confirmDelete()}
              disabled={
                deleteMutation.isPending ||
                isReloading ||
                Boolean(recovery) ||
                !task
              }
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete permanently'}
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
