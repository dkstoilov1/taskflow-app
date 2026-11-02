import { http, HttpResponse } from 'msw';
import { changeTaskStatus, createTask, deleteProject, getProject, getStatistics, getTask, listProjects, listTasks, saveProject, updateTask } from '../api/client';
import { dateInZone, isCalendarDate, shiftDate, weekStartFor } from '../api/calendar';
import { seedMockProjects, seedMockTasks } from './store';
import { server } from './server';

const ID = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const today = dateInZone('UTC');

it('validates real calendar dates including leap years and low years without UTC deadline conversion', () => {
  for (const date of ['0001-01-01', '2000-02-29', '9999-12-31']) expect(isCalendarDate(date)).toBe(true);
  for (const date of ['0000-01-01', '2026-02-29', '2024-02-30', '2026-13-01', '2026-1-01', 'x']) expect(isCalendarDate(date)).toBe(false);
  expect(shiftDate('2026-01-01', -1)).toBe('2025-12-31');
  expect(weekStartFor('2026-11-08')).toBe('2026-11-02');
  expect(dateInZone('America/New_York', new Date('2026-11-02T01:00:00Z'))).toBe('2026-11-01');
});

it('supports expanded task fields, completion timestamps, repeated complete, edit retention and reopen', async () => {
  const project = await saveProject('Launch');
  let task = await createTask({title: 'Task', dueDate: '2026-12-01', priority: 'high', projectId: project.id});
  task = await changeTaskStatus(task, 'completed');
  const completedAt = task.completedAt;
  expect(completedAt).toMatch(/Z$/);
  task = await changeTaskStatus(task, 'completed');
  expect(task.completedAt).toBe(completedAt);
  task = await updateTask(task.id, task.version, {...taskInput(task), title: 'Edited'});
  expect(task.completedAt).toBe(completedAt);
  expect((await getStatistics('UTC')).completedToday).toBe(1);
  task = await changeTaskStatus(task, 'active');
  expect(task.completedAt).toBeNull();
  expect((await getStatistics('UTC')).completedToday).toBe(0);
  await expect(changeTaskStatus({...task, version: 0}, 'completed')).rejects.toMatchObject({status: 412});
});

function taskInput(task: Awaited<ReturnType<typeof getTask>>) {
  return {title: task.title, description: task.description, dueDate: task.dueDate, priority: task.priority, projectId: task.projectId, status: task.status};
}

it('intersects all filters and views before pagination, includes undated/completed in All, sorts nulls last', async () => {
  seedMockProjects([{id: ID, name: 'Work', version: 0}]);
  const fields = [
    {title: 'Past', dueDate: shiftDate(today, -1), priority: 'high' as const, projectId: ID},
    {title: 'Today', dueDate: today, priority: 'low' as const, projectId: ID},
    {title: 'Future', dueDate: shiftDate(today, 1), priority: 'medium' as const, projectId: null},
    {title: 'Undated', dueDate: null, priority: 'low' as const, projectId: null},
    {title: 'Done', dueDate: today, status: 'completed' as const, projectId: ID},
  ];
  for (const input of fields) await createTask(input);
  expect((await listTasks({view: 'today'})).totalElements).toBe(2);
  expect((await listTasks({view: 'upcoming'})).items[0].title).toBe('Future');
  expect((await listTasks({view: 'completed', status: 'active'})).totalElements).toBe(0);
  expect((await listTasks({view: 'today', priority: 'high', project: ID, due: 'overdue', q: 'Past'})).totalElements).toBe(1);
  expect((await listTasks({project: OTHER})).totalElements).toBe(0);
  expect((await listTasks({project: 'unassigned'})).totalElements).toBe(2);
  for (const sort of ['due_asc', 'due_desc'] as const) {
    const page = await listTasks({sort, size: 2});
    expect(page.totalElements).toBe(5);
    expect(page.totalPages).toBe(3);
    expect((await listTasks({sort, size: 2, page: 2})).items[0].title).toBe('Undated');
  }
  expect((await listTasks({sort: 'priority_desc'})).items[0].title).toBe('Past');
  expect((await listTasks({sort: 'priority_asc'})).items[0].priority).toBe('low');
  expect((await listTasks({sort: 'status_asc'})).items[0].status).toBe('active');
  expect((await listTasks({sort: 'status_desc'})).items[0].status).toBe('completed');
  const thisWeek = await listTasks({due: 'this_week'});
  expect(thisWeek.items.every((task) => task.dueDate && task.dueDate >= weekStartFor(today) && task.dueDate <= shiftDate(weekStartFor(today), 6))).toBe(true);
});

it.each([
  {dueDate: '2026-02-30'}, {priority: null}, {priority: 'urgent'}, {status: null}, {status: 'done'},
  {priority: ['high']}, {status: ['completed']},
  {projectId: OTHER}, {projectId: 'bad'}, {completedAt: '2026-11-02T00:00:00Z'}, {unknown: true},
])('rejects invalid expanded task input %j', async (input) => {
  const response = await fetch('/api/tasks', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({title: 'Valid', ...input})});
  expect(response.status).toBe(400);
});

it.each(['view=bad', 'status=bad', 'priority=bad', 'due=bad', 'project=bad', 'sort=bad', 'timeZone=not-a-zone'])('rejects invalid task query %s', async (query) => {
  expect((await fetch(`/api/tasks?${query}`)).status).toBe(400);
});

it('validates project names, duplicate errors, headers, versions and deletion version effects', async () => {
  const first = await saveProject('  Work  ');
  expect(await getProject(first.id)).toEqual(first);
  await expect(saveProject('wOrK')).rejects.toMatchObject({status: 409, problem: {fieldErrors: {name: expect.any(Array)}}});
  await expect(saveProject(' ')).rejects.toMatchObject({status: 400});
  await expect(saveProject('😀'.repeat(101))).rejects.toMatchObject({status: 400});
  const unicode = await saveProject('😀'.repeat(100));
  expect((await listProjects()).length).toBe(2);
  const renamed = await saveProject('Changed', first);
  await expect(saveProject('Stale', first)).rejects.toMatchObject({status: 412});
  await expect(deleteProject(first)).rejects.toMatchObject({status: 412});
  const task = await createTask({title: 'Retained', projectId: renamed.id, status: 'completed'});
  await deleteProject(renamed);
  const retained = await getTask(task.id);
  expect(retained).toMatchObject({projectId: null, version: 1, completedAt: task.completedAt});
  await expect(updateTask(task.id, 0, {title: 'Stale'})).rejects.toMatchObject({status: 412});
  await expect(getProject(first.id)).rejects.toMatchObject({status: 404});
  await deleteProject(unicode);
  for (const headers of [{}, {'If-Match': 'W/"0"'}] as Record<string, string>[]) {
    const response = await fetch(`/api/projects/${OTHER}`, {method: 'DELETE', headers});
    expect(response.status).toBe('If-Match' in headers ? 400 : 428);
  }
});

it('aggregates timezone-local current completions and all projects including empty and fractional rates', async () => {
  seedMockProjects([{id: ID, name: 'Work', version: 0}, {id: OTHER, name: 'Empty', version: 0}]);
  seedMockTasks(Array.from({length: 4}, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
    title: `Task ${index}`, description: '', version: 0, createdAt: index,
    projectId: index === 3 ? null : ID, status: index === 0 || index === 3 ? 'completed' : 'active',
    completedAt: index === 0 || index === 3 ? new Date().toISOString() : null,
  })));
  const stats = await getStatistics('UTC');
  expect(stats.completedToday).toBe(2);
  expect(stats.completedThisWeek).toBe(2);
  expect(stats.dailyCompletions).toHaveLength(7);
  expect(stats.projects).toEqual([
    {projectId: OTHER, name: 'Empty', totalTasks: 0, completedTasks: 0, completionRate: 0},
    {projectId: ID, name: 'Work', totalTasks: 3, completedTasks: 1, completionRate: 33.3},
  ]);
  await expect(getStatistics('not-a-zone')).rejects.toMatchObject({status: 400});
});

it('rejects malformed success task metadata, project headers and inconsistent aggregate responses', async () => {
  const project = await saveProject('Work');
  server.use(http.get('/api/projects/:id', () => HttpResponse.json(project, {headers: {ETag: 'W/"0"'}})));
  await expect(getProject(project.id)).rejects.toMatchObject({status: 200});
  server.use(http.post('/api/projects', () => HttpResponse.json(project, {status: 201, headers: {ETag: '"0"', Location: '/api/projects/wrong'}})));
  await expect(saveProject('Work')).rejects.toMatchObject({outcomeUncertain: true});
  const stats = await getStatistics('UTC');
  server.use(http.get('/api/statistics', () => HttpResponse.json({...stats, dailyCompletions: []})));
  await expect(getStatistics('UTC')).rejects.toMatchObject({status: 200});
  const task = await createTask({title: 'Task'});
  server.use(http.patch('/api/tasks/:id/status', () => HttpResponse.json({...task, status: 'completed', completedAt: null}, {headers: {ETag: '"0"'}})));
  await expect(changeTaskStatus(task, 'completed')).rejects.toMatchObject({outcomeUncertain: true});
});

it('uses calendar-day boundaries across DST and inclusive Monday–Sunday week filters', async () => {
  vi.useFakeTimers({toFake: ['Date']});
  try {
    vi.setSystemTime(new Date('2026-11-02T05:01:00Z'));
    const instants = ['2026-11-01T03:59:59Z', '2026-11-01T04:00:00Z', '2026-11-02T04:59:59Z', '2026-11-02T05:00:00Z'];
    seedMockTasks(instants.map((completedAt, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
      title: 'DST completion', description: '', version: 0, createdAt: index, status: 'completed', completedAt,
    })));
    const stats = await getStatistics('America/New_York');
    expect(stats.today).toBe('2026-11-02');
    expect(stats.weekStart).toBe('2026-11-02');
    expect(stats.completedToday).toBe(1);
    expect(stats.completedThisWeek).toBe(1);
    expect(stats.dailyCompletions.slice(-3)).toEqual([
      {date: '2026-10-31', count: 1}, {date: '2026-11-01', count: 2}, {date: '2026-11-02', count: 1},
    ]);
    vi.setSystemTime(new Date('2026-11-08T17:00:00Z'));
    seedMockTasks(['2026-11-01', '2026-11-02', '2026-11-08', '2026-11-09'].map((dueDate, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 20).padStart(12, '0')}`,
      title: `Deadline ${dueDate}`, description: '', version: 0, createdAt: index, dueDate,
    })));
    expect((await listTasks({due: 'this_week', timeZone: 'America/New_York'})).totalElements).toBe(2);
    expect((await listTasks({view: 'today', timeZone: 'America/New_York'})).totalElements).toBe(3);
    expect((await listTasks({view: 'upcoming', timeZone: 'America/New_York'})).totalElements).toBe(1);
  } finally {vi.useRealTimers();}
});
