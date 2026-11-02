import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { getTask, listProjects, saveProject } from '../../api/client';
import { createMockTask, seedMockProjects, writeMockProject, setMockLatency } from '../../mocks/store';
import { server } from '../../mocks/server';
import { renderWithQuery } from '../../test/render';
import { ProjectManager } from './ProjectManager';

const PROJECT = {id: '00000000-0000-4000-8000-000000000001', name: 'Work', version: 0};

it('loads, validates, creates, renames and deletes while retaining tasks unassigned', async () => {
  const user = userEvent.setup();
  setMockLatency(20);
  renderWithQuery(<ProjectManager />);
  expect(screen.getByText('Loading projects…')).toBeVisible();
  expect(await screen.findByText(/No projects yet/)).toBeVisible();
  await user.click(screen.getByRole('button', {name: 'New project'}));
  expect(screen.getByLabelText('Project name')).toHaveFocus();
  await user.click(screen.getByRole('button', {name: 'Save project'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('1–100');
  await user.type(screen.getByLabelText('Project name'), '  Work  ');
  await user.click(screen.getByRole('button', {name: 'Save project'}));
  expect(await screen.findByRole('button', {name: 'Rename Work'})).toBeVisible();
  const project = (await listProjects())[0];
  const task = createMockTask('00000000-0000-4000-8000-000000000010', {title: 'Keep me', projectId: project.id});
  await user.click(screen.getByRole('button', {name: 'Rename Work'}));
  await user.clear(screen.getByLabelText('Project name'));
  await user.type(screen.getByLabelText('Project name'), 'Personal');
  await user.click(screen.getByRole('button', {name: 'Save project'}));
  expect(await screen.findByRole('button', {name: 'Delete project Personal'})).toBeVisible();
  await user.click(screen.getByRole('button', {name: 'Delete project Personal'}));
  expect(screen.getByRole('dialog')).toHaveTextContent('retained as unassigned');
  await user.click(screen.getByRole('button', {name: 'Delete project permanently'}));
  expect(await screen.findByText(/No projects yet/)).toBeVisible();
  expect(await getTask(task.id)).toMatchObject({title: 'Keep me', projectId: null, version: 1});
});

it('clears the project success notice after a short delay', async () => {
  const user = userEvent.setup();
  seedMockProjects([PROJECT]);
  renderWithQuery(<ProjectManager />);
  await user.click(await screen.findByRole('button', {name: 'Delete project Work'}));
  await user.click(screen.getByRole('button', {name: 'Delete project permanently'}));
  expect(await screen.findByText('Project deleted. Its tasks are now unassigned.')).toBeVisible();
  await waitFor(() => expect(screen.queryByText('Project deleted. Its tasks are now unassigned.')).not.toBeInTheDocument(), {timeout: 6000});
});

it('retries list errors and preserves duplicate-name drafts', async () => {
  const user = userEvent.setup();
  seedMockProjects([PROJECT]);
  server.use(http.get('/api/projects', () => HttpResponse.error(), {once: true}));
  renderWithQuery(<ProjectManager />);
  await user.click(await screen.findByRole('button', {name: 'Retry projects'}));
  expect(await screen.findByText('Work')).toBeVisible();
  await user.click(screen.getByRole('button', {name: 'New project'}));
  await user.type(screen.getByLabelText('Project name'), 'work');
  await user.click(screen.getByRole('button', {name: 'Save project'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
  expect(screen.getByLabelText('Project name')).toHaveValue('work');
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('explains a missing project endpoint on create and allows a retry', async () => {
  const user = userEvent.setup();
  server.use(http.post('/api/projects', () => HttpResponse.json(
    {type: 'about:blank', title: 'Not Found', status: 404, detail: 'No static resource api/projects.', instance: '/api/projects'},
    {status: 404, headers: {'Content-Type': 'application/problem+json'}}), {once: true}));
  renderWithQuery(<ProjectManager />);
  await user.click(await screen.findByRole('button', {name: 'New project'}));
  await user.type(screen.getByLabelText('Project name'), 'Work');
  await user.click(screen.getByRole('button', {name: 'Save project'}));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('project service is unavailable');
  expect(alert).not.toHaveTextContent('no longer exists');
  expect(screen.getByLabelText('Project name')).toHaveValue('Work');
  await user.click(screen.getByRole('button', {name: 'Save project'}));
  expect(await screen.findByRole('button', {name: 'Rename Work'})).toBeVisible();
});

it('requires explicit fresh review of rename conflicts and retains the draft', async () => {
  const user = userEvent.setup();
  seedMockProjects([PROJECT]);
  renderWithQuery(<ProjectManager />);
  await user.click(await screen.findByRole('button', {name: 'Rename Work'}));
  await user.clear(screen.getByLabelText('Project name'));
  await user.type(screen.getByLabelText('Project name'), 'My draft');
  await saveProject('Other tab', PROJECT);
  await user.click(screen.getByRole('button', {name: 'Save project'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('outcome is uncertain');
  expect(screen.getByRole('button', {name: 'Save project'})).toBeDisabled();
  server.use(http.get('/api/projects/:id', () => HttpResponse.error(), {once: true}));
  await user.click(screen.getByRole('button', {name: 'Refresh and review project'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not refresh');
  await user.click(screen.getByRole('button', {name: 'Refresh and review project'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Other tab');
  expect(screen.getByLabelText('Project name')).toHaveValue('My draft');
  await user.click(screen.getByRole('button', {name: 'Save project'}));
  expect(await screen.findByRole('button', {name: 'Rename My draft'})).toBeVisible();
});

it('checks uncertain creates for matching names, blocks duplicate retry, and refreshes changed drafts', async () => {
  const user = userEvent.setup();
  renderWithQuery(<ProjectManager />);
  await screen.findByText(/No projects yet/);
  server.use(http.post('/api/projects', async ({request}) => {
    const body = await request.json() as {name: string};
    writeMockProject({...PROJECT, name: body.name});
    return HttpResponse.error();
  }, {once: true}));
  await user.click(screen.getByRole('button', {name: 'New project'}));
  await user.type(screen.getByLabelText('Project name'), 'Work');
  await user.click(screen.getByRole('button', {name: 'Save project'}));
  await user.click(await screen.findByRole('button', {name: 'Refresh and review project'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('exists. No create was retried');
  expect(screen.getByRole('button', {name: 'Save project'})).toBeDisabled();
  await user.clear(screen.getByLabelText('Project name'));
  await user.type(screen.getByLabelText('Project name'), 'Another');
  await user.click(screen.getByRole('button', {name: 'Refresh and review project'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('no matching name');
  await user.click(screen.getByRole('button', {name: 'Save project'}));
  expect(await screen.findByRole('button', {name: 'Rename Another'})).toBeVisible();
  expect(await listProjects()).toHaveLength(2);
});

it('handles stale delete, uncertain committed delete and missing project recovery', async () => {
  const user = userEvent.setup();
  seedMockProjects([PROJECT]);
  renderWithQuery(<ProjectManager />);
  await user.click(await screen.findByRole('button', {name: 'Delete project Work'}));
  await saveProject('Changed', PROJECT);
  await user.click(screen.getByRole('button', {name: 'Delete project permanently'}));
  await user.click(await screen.findByRole('button', {name: 'Refresh and review project'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Changed');
  server.use(http.delete('/api/projects/:id', () => {seedMockProjects([]); return HttpResponse.error();}, {once: true}));
  await user.click(screen.getByRole('button', {name: 'Delete project permanently'}));
  await user.click(await screen.findByRole('button', {name: 'Refresh and review project'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('no longer exists');
  expect(screen.getByRole('button', {name: 'Delete project permanently'})).toBeDisabled();
  await user.click(screen.getByRole('button', {name: 'Cancel'}));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});
