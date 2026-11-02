import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import { ApiError, getProject, listProjects } from '../../api/client';
import type { Project } from '../../api/types';
import { useDeleteProject, useProjects, useSaveProject } from './useProjects';

export function ProjectManager() {
  const client = useQueryClient();
  const query = useProjects();
  const save = useSaveProject();
  const remove = useDeleteProject();
  const [editing, setEditing] = useState<Project>();
  const [mode, setMode] = useState<'create' | 'rename' | 'delete'>();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState('');
  const [missing, setMissing] = useState(false);
  const pending = save.isPending || remove.isPending || checking;

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(''), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  function start(nextMode: 'create' | 'rename' | 'delete', project?: Project) {
    setMode(nextMode); setEditing(project); setName(project?.name ?? '');
    setError(''); setBlocked(false); setMissing(false); setNotice('');
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (blocked || pending) return;
    if (mode !== 'delete' && (!name.trim() || Array.from(name.trim()).length > 100)) {
      setError('Use 1–100 Unicode code points for the name.'); return;
    }
    try {
      if (mode === 'delete' && editing) await remove.mutateAsync(editing);
      else await save.mutateAsync({name, project: editing});
      setNotice(mode === 'delete' ? 'Project deleted. Its tasks are now unassigned.' : 'Project saved.');
      setMode(undefined);
    } catch (failure) {
      const api = failure instanceof ApiError ? failure : undefined;
      // A create has no existing project, so 404 means the endpoint is missing (e.g. an outdated backend).
      if (mode === 'create' && api?.status === 404) {
        setError('The project service is unavailable. Make sure the TaskFlow backend is up to date and running, then try again. Your draft is preserved.');
        return;
      }
      const requiresReview = !api || api.status === 412 || api.outcomeUncertain || api.status === 0;
      setBlocked(requiresReview || api?.status === 404);
      setMissing(api?.status === 404);
      setError(api?.status === 404 ? 'This project no longer exists. Your draft is preserved.' :
        requiresReview ? 'The project changed or the outcome is uncertain. Refresh and review before deciding whether to retry. Your draft is preserved.' :
        api?.problem?.fieldErrors?.name?.join(' ') ?? api?.message ?? 'Could not save project.');
      if (api?.status === 404) await client.invalidateQueries();
    }
  }

  async function review() {
    setChecking(true);
    try {
      if (editing) {
        const latest = await getProject(editing.id);
        setEditing(latest);
        setError(`Latest server name: “${latest.name}”, version ${latest.version}. Your draft is unchanged. Choose the action again only after reviewing.`);
        setBlocked(false);
      } else {
        const projects = await listProjects();
        const match = projects.find((project) => project.name.toLowerCase() === name.trim().toLowerCase());
        setError(match ? `A project named “${match.name}” exists. No create was retried. Close this form and use it, or change the name and refresh again.` :
          'Fresh projects checked; no matching name exists. Review your draft, then explicitly create again.');
        setBlocked(Boolean(match));
      }
      await client.invalidateQueries();
    } catch (failure) {
      setMissing(failure instanceof ApiError && failure.status === 404);
      setError(failure instanceof ApiError && failure.status === 404 ? 'This project no longer exists. Close this form and refresh projects.' : 'Could not refresh projects. Your draft is safe; try again.');
      if (failure instanceof ApiError && failure.status === 404) await client.invalidateQueries();
    } finally {setChecking(false);}
  }

  return <section className="project-panel" aria-label="Projects">
    <div className="list-heading"><h2>Projects</h2><button className="button button-secondary" type="button" onClick={() => start('create')}>New project</button></div>
    <p role="status">{notice}</p>
    {query.isPending ? <p role="status">Loading projects…</p> : query.isError ?
      <p role="alert">Projects couldn’t load. <button type="button" onClick={() => void query.refetch()}>Retry projects</button></p> :
      !query.data?.length ? <p>No projects yet. Unassigned tasks are welcome.</p> :
      <ul className="project-list">{query.data.map((project) => <li key={project.id}>
        <span>{project.name}</span><div>
          <button type="button" className="text-button" onClick={() => start('rename', project)} aria-label={`Rename ${project.name}`}>Rename</button>{' '}
          <button type="button" className="text-button" onClick={() => start('delete', project)} aria-label={`Delete project ${project.name}`}>Delete</button>
        </div>
      </li>)}</ul>}
    <Dialog.Root open={Boolean(mode)} onOpenChange={(open) => {if (!open && !pending) setMode(undefined);}}>
      <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="confirm-content">
        <Dialog.Title className="dialog-title">{mode === 'delete' ? 'Delete project?' : mode === 'rename' ? 'Rename project' : 'Create project'}</Dialog.Title>
        <Dialog.Description className="dialog-intro">{mode === 'delete' ? `Delete “${editing?.name}”? All its tasks will be retained as unassigned.` : 'Names are unique, ignoring case. Changes are saved only after confirmation.'}</Dialog.Description>
        <form onSubmit={(event) => void submit(event)}>
          {mode !== 'delete' ? <div className="field"><label htmlFor="project-name">Project name</label>
            <input id="project-name" value={name} onChange={(event) => {setName(event.target.value); if (!blocked) setError('');}} disabled={pending} aria-invalid={Boolean(error)} aria-describedby={error ? 'project-error' : undefined} /></div> : null}
          {error ? <p id="project-error" role="alert">{error}</p> : null}
          {blocked && !missing ? <button type="button" onClick={() => void review()} disabled={pending}>{checking ? 'Refreshing…' : 'Refresh and review project'}</button> : null}
          <div className="form-actions">
            <button type="button" className="button button-secondary" onClick={() => setMode(undefined)} disabled={pending}>Cancel</button>
            <button type="submit" className={mode === 'delete' ? 'button button-danger' : 'button button-primary'} disabled={pending || blocked}>
              {pending ? 'Saving…' : mode === 'delete' ? 'Delete project permanently' : 'Save project'}
            </button>
          </div>
        </form>
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  </section>;
}
