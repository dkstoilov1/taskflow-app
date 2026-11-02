import { expect, test } from '@playwright/test';

test('dashboard home, project lifecycle, metadata, complete/reopen and current productivity totals', async ({page}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', {name: 'Your focus, at a glance'})).toBeVisible();
  await page.getByRole('button', {name: 'New project'}).press('Enter');
  await expect(page.getByLabel('Project name')).toBeFocused();
  await page.getByLabel('Project name').fill('Release');
  await page.getByRole('button', {name: 'Save project'}).press('Enter');
  await expect(page.getByRole('button', {name: 'Rename Release'})).toBeVisible();
  await page.getByRole('button', {name: 'New task'}).click();
  await page.getByLabel('Title').fill('Ship the release');
  await page.getByLabel('Description').fill('All metadata survives editing.');
  const today = await page.evaluate(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
  await page.getByLabel('Deadline', {exact: true}).fill(today);
  await page.getByLabel('Priority', {exact: true}).selectOption('high');
  await page.getByLabel('Project', {exact: true}).selectOption({label: 'Release'});
  await page.getByRole('button', {name: 'Add task'}).click();
  const due = page.getByRole('region', {name: 'Due today', exact: true});
  await expect(due.getByRole('heading', {name: 'Ship the release'})).toBeVisible();
  await due.getByRole('button', {name: 'Complete Ship the release'}).click();
  await page.getByRole('button', {name: 'Complete task', exact: true}).press('Enter');
  await expect(page.getByText('1/1 tasks · 100.0%')).toBeVisible();
  await expect(page.getByRole('list', {name: 'Daily completions'}).getByRole('listitem')).toHaveCount(7);
  await page.getByRole('button', {name: 'Completed', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Ship the release'})).toBeVisible();
  await page.getByRole('button', {name: 'Edit Ship the release'}).click();
  await expect(page.getByLabel('Deadline', {exact: true})).toHaveValue(today);
  await expect(page.getByLabel('Priority', {exact: true})).toHaveValue('high');
  await expect(page.getByLabel('Status', {exact: true})).toHaveValue('completed');
  await page.getByLabel('Title').fill('Release shipped');
  await page.getByRole('button', {name: 'Save changes'}).click();
  await expect(page.getByRole('heading', {name: 'Release shipped'})).toBeVisible();
  await page.getByRole('button', {name: 'Reopen Release shipped'}).click();
  await page.getByRole('button', {name: 'Reopen task', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'A fresh start.'})).toBeVisible();
  await page.getByRole('button', {name: 'Rename Release'}).click();
  await page.getByLabel('Project name').fill('Renamed project');
  await page.getByRole('button', {name: 'Save project'}).click();
  await page.getByRole('button', {name: 'All Tasks', exact: true}).click();
  await expect(page.getByRole('list', {name: 'Tasks'}).getByText('Renamed project', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Delete project Renamed project'}).click();
  await expect(page.getByRole('dialog')).toContainText('retained as unassigned');
  await page.getByRole('button', {name: 'Delete project permanently'}).click();
  await expect(page.getByRole('heading', {name: 'Release shipped'})).toBeVisible();
  await expect(page.getByRole('list', {name: 'Tasks'}).getByText('Unassigned')).toBeVisible();
  await page.getByRole('button', {name: 'Dashboard', exact: true}).click();
  await expect(page.getByText('No projects yet.', {exact: true})).toBeVisible();
  for (const width of [375, 1440]) {
    await page.setViewportSize({width, height: 900});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
});

test('views and every filter intersect, all sorts and page reset use server query parameters', async ({page}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', {name: 'Your focus, at a glance'})).toBeVisible();
  await page.evaluate(async () => {
    const now = new Date();
    const date = (offset: number) => {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
      return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    };
    await window.taskflowMock!.seed(Array.from({length: 23}, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      title: `Organized ${index}`, description: '', version: 0, createdAt: index,
      priority: index % 2 ? 'low' : 'high', dueDate: index === 22 ? null : date(index % 3 - 1),
      status: index === 21 ? 'completed' : 'active',
      completedAt: index === 21 ? now.toISOString() : null,
    })));
  });
  await page.getByRole('button', {name: 'All Tasks', exact: true}).click();
  await expect(page.getByText('23 tasks')).toBeVisible();
  await page.getByRole('button', {name: 'Next page'}).click();
  await expect(page.getByText('Page 2 of 2')).toBeVisible();
  for (const sort of ['due_asc', 'due_desc', 'priority_desc', 'priority_asc', 'status_asc', 'status_desc', 'created_desc']) {
    const read = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/tasks' && url.searchParams.get('sort') === sort && url.searchParams.get('page') === '0';
    });
    await page.getByLabel('Sort tasks').selectOption(sort);
    await read;
    await expect(page.getByText('Page 1 of 2')).toBeVisible();
  }
  await page.getByRole('button', {name: 'Today', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Today and overdue'})).toBeVisible();
  await page.getByLabel('Status filter').selectOption('completed');
  await expect(page.getByText(/Filters intersect/)).toBeVisible();
  await expect(page.getByLabel('Status filter')).toHaveValue('completed');
  await page.getByRole('button', {name: 'Reset filters'}).click();
  await page.getByLabel('Priority filter').selectOption('high');
  await page.getByLabel('Deadline filter').selectOption('overdue');
  await page.getByLabel('Project filter').selectOption('unassigned');
  await page.getByRole('searchbox', {name: 'Search tasks'}).fill('Organized 0');
  await expect(page.getByText('1 task', {exact: true})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Organized 0', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Reset filters'}).click();
  await page.getByRole('button', {name: 'Upcoming', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Upcoming tasks'})).toBeVisible();
  await page.getByLabel('Deadline filter').selectOption('today');
  await expect(page.getByText(/Filters intersect/)).toBeVisible();
  await page.getByLabel('Deadline filter').selectOption('this_week');
  for (const width of [375, 1440]) {
    await page.setViewportSize({width, height: 900});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
});

test('project duplicates and uncertain creates preserve drafts and require review, completion conflicts never retry silently', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name: 'New project'}).click();
  await page.getByLabel('Project name').fill('Work');
  await page.getByRole('button', {name: 'Save project'}).click();
  await expect(page.getByRole('button', {name: 'Rename Work'})).toBeVisible();
  await page.getByRole('button', {name: 'New project'}).click();
  await page.getByLabel('Project name').fill('work');
  await page.getByRole('button', {name: 'Save project'}).click();
  await expect(page.getByRole('alert')).toContainText('already exists');
  await expect(page.getByLabel('Project name')).toHaveValue('work');
  await page.getByLabel('Project name').fill('Personal');
  await page.evaluate(() => window.taskflowMock!.failNext('network'));
  await page.getByRole('button', {name: 'Save project'}).click();
  await expect(page.getByRole('button', {name: 'Save project'})).toBeDisabled();
  await page.getByRole('button', {name: 'Refresh and review project'}).click();
  await expect(page.getByRole('alert')).toContainText('no matching name');
  await page.getByRole('button', {name: 'Save project'}).click();
  await expect(page.getByRole('button', {name: 'Rename Personal'})).toBeVisible();
  await page.evaluate(async () => {
    await window.taskflowMock!.seed([{
      id: '00000000-0000-4000-8000-000000000001', title: 'Concurrent', description: '', version: 0, createdAt: 1,
    }]);
  });
  await page.getByRole('button', {name: 'All Tasks', exact: true}).click();
  await page.getByRole('button', {name: 'Complete Concurrent'}).click();
  await page.evaluate(async () => {
    await fetch('/api/tasks/00000000-0000-4000-8000-000000000001/status', {
      method: 'PATCH', headers: {'Content-Type': 'application/json', 'If-Match': '"0"'}, body: JSON.stringify({status: 'completed'}),
    });
  });
  await page.getByRole('button', {name: 'Complete task', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Complete task', exact: true})).toBeDisabled();
  await page.getByRole('button', {name: 'Review latest status'}).click();
  await expect(page.getByRole('alert')).toContainText('Latest version 1 is completed');
  await page.getByRole('button', {name: 'Cancel', exact: true}).click();
  await page.getByRole('button', {name: 'Completed', exact: true}).click();
  await page.getByRole('button', {name: 'Reopen Concurrent'}).click();
  await page.evaluate(() => window.taskflowMock!.failNext('network'));
  await page.getByRole('button', {name: 'Reopen task', exact: true}).click();
  await expect(page.getByRole('alert')).toContainText('outcome is uncertain');
  await page.getByRole('button', {name: 'Review latest status'}).click();
  await expect(page.getByRole('alert')).toContainText('No retry was sent');
  await page.getByRole('button', {name: 'Reopen task', exact: true}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('project stale rename and delete require fresh values before an explicit retry', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name: 'New project'}).click();
  await page.getByLabel('Project name').fill('Original');
  await page.getByRole('button', {name: 'Save project'}).click();
  await page.getByRole('button', {name: 'Rename Original'}).click();
  await page.getByLabel('Project name').fill('Safe draft');
  await page.evaluate(async () => {
    const projects = await (await fetch('/api/projects')).json() as {id: string; version: number}[];
    await fetch(`/api/projects/${projects[0].id}`, {
      method: 'PUT', headers: {'Content-Type': 'application/json', 'If-Match': `"${projects[0].version}"`}, body: JSON.stringify({name: 'Other tab'}),
    });
  });
  await page.getByRole('button', {name: 'Save project'}).click();
  await expect(page.getByRole('button', {name: 'Save project'})).toBeDisabled();
  await page.getByRole('button', {name: 'Refresh and review project'}).click();
  await expect(page.getByRole('alert')).toContainText('Other tab');
  await expect(page.getByLabel('Project name')).toHaveValue('Safe draft');
  await page.getByRole('button', {name: 'Save project'}).click();
  await page.getByRole('button', {name: 'Delete project Safe draft'}).click();
  await page.evaluate(() => window.taskflowMock!.failNext('network'));
  await page.getByRole('button', {name: 'Delete project permanently'}).click();
  await page.getByRole('button', {name: 'Refresh and review project'}).click();
  await expect(page.getByRole('alert')).toContainText('Latest server name');
  await page.getByRole('button', {name: 'Delete project permanently'}).click();
  await expect(page.getByRole('button', {name: 'Rename Safe draft'})).not.toBeVisible();
});
