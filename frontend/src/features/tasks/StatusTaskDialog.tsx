import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import { ApiError, getTask } from '../../api/client';
import type { Task } from '../../api/types';
import { useChangeTaskStatus } from './useTasks';

interface StatusTaskDialogProps {
  task: Task;
  onClose: () => void;
  onSaved: (task: Task) => void;
}

export function StatusTaskDialog({task, onClose, onSaved}: StatusTaskDialogProps) {
  const client = useQueryClient();
  const [current, setCurrent] = useState(task);
  const [error, setError] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [checking, setChecking] = useState(false);
  const [missing, setMissing] = useState(false);
  const mutation = useChangeTaskStatus();
  const desired = task.status === 'completed' ? 'active' : 'completed';
  const action = desired === 'completed' ? 'Complete' : 'Reopen';

  async function submit() {
    try {
      const saved = await mutation.mutateAsync({task: current, status: desired});
      onSaved(saved);
      onClose();
    } catch (failure) {
      setBlocked(true);
      setMissing(failure instanceof ApiError && failure.status === 404);
      setError(failure instanceof ApiError && failure.status === 404 ? 'This task no longer exists.' :
        'The task changed or the outcome is uncertain. Check fresh server values before deciding whether to retry.');
      if (failure instanceof ApiError && failure.status === 404) await client.invalidateQueries();
    }
  }

  async function review() {
    setChecking(true);
    try {
      const latest = await getTask(task.id);
      setCurrent(latest);
      setBlocked(false);
      setError(`Latest version ${latest.version} is ${latest.status}. Review all values below. No retry was sent.`);
      await client.invalidateQueries();
    } catch (failure) {
      setMissing(failure instanceof ApiError && failure.status === 404);
      setError(failure instanceof ApiError && failure.status === 404 ? 'This task no longer exists.' : 'Could not reload. Try checking again.');
      if (failure instanceof ApiError && failure.status === 404) await client.invalidateQueries();
    } finally { setChecking(false); }
  }

  return <Dialog.Root open onOpenChange={(open) => {if (!open && !mutation.isPending && !checking) onClose();}}>
    <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="confirm-content">
      <Dialog.Title className="dialog-title">{action} this task?</Dialog.Title>
      <Dialog.Description className="dialog-intro">Only status changes. Other fields stay as stored on the server.</Dialog.Description>
      <p>{current.title} · {current.description || 'No description'}</p>
      <p>{current.dueDate ?? 'No deadline'} · {current.priority} · {current.projectId ?? 'Unassigned'} · {current.status}</p>
      {error ? <p role="alert">{error}</p> : null}
      {blocked && !missing ? <button type="button" onClick={() => void review()} disabled={checking}>{checking ? 'Checking…' : 'Review latest status'}</button> : null}
      <div className="form-actions">
        <button type="button" className="button button-secondary" onClick={onClose} disabled={mutation.isPending || checking}>Cancel</button>
        <button type="button" className="button button-primary" disabled={blocked || checking || mutation.isPending} onClick={() => void submit()}>
          {mutation.isPending ? 'Saving…' : `${action} task`}
        </button>
      </div>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
