import { expect, test } from '@playwright/test';

const PROJECT_ID = '00000000-0000-4000-8000-000000000010';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your focus, at a glance' })).toBeVisible();
  await page.evaluate(async (projectId) => {
    if (!window.taskflowMock) throw new Error('The stateful browser mock is required');
    await window.taskflowMock.reset();
    await window.taskflowMock.seedProjects([{ id: projectId, name: 'Design release', version: 0 }]);
    await window.taskflowMock.seed([
      {
        id: '00000000-0000-4000-8000-000000000011',
        title: 'Review visual hierarchy', description: 'Check the release notes.',
        version: 0, createdAt: 2, priority: 'high', status: 'active',
        projectId, dueDate: '2026-11-06',
      },
      {
        id: '00000000-0000-4000-8000-000000000012',
        title: 'Prepare design notes', description: '', version: 0, createdAt: 1,
        priority: 'low', status: 'completed', completedAt: new Date().toISOString(),
      },
    ]);
  }, PROJECT_ID);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Rename Design release' })).toBeVisible();
});

for (const width of [320, 390, 768, 1440]) {
  test(`keeps tasks prominent and the statistics strip compact at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole('button', { name: 'All Tasks', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Review visual hierarchy', exact: true })).toBeVisible();
    const tasks = page.getByRole('list', { name: 'Tasks', exact: true });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(tasks.getByRole('listitem').first()).toBeInViewport({ ratio: 0.5 });
    expect(await tasks.getByRole('listitem').first().evaluate((element) => element.getBoundingClientRect().top + window.scrollY)).toBeLessThan(650);
    await expect(tasks.getByText('high priority')).toHaveClass(/task-priority-high/);
    await expect(tasks.getByRole('listitem').last()).toHaveClass(/task-card-completed/);
    if (width <= 640) {
      await expect(page.getByLabel('Priority filter')).toBeHidden();
      await expect(page.getByRole('button', { name: 'Filters & sort' })).toHaveAttribute('aria-expanded', 'false');
    } else {
      await expect(page.getByLabel('Priority filter')).toBeVisible();
    }

    await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
    const strip = page.getByRole('list', { name: 'Daily completions' });
    await expect(strip.getByRole('listitem')).toHaveCount(7);
    const positions = await strip.getByRole('listitem').evaluateAll((items) => items.map((item) => item.getBoundingClientRect().top));
    expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(1);
    await expect(page.getByRole('heading', { name: 'Your focus, at a glance' })).toHaveCSS('font-weight', '700');
    const progress = page.getByRole('progressbar', { name: 'Design release completion' });
    await expect(progress).toHaveAttribute('max', '100');
    await expect(progress).toHaveCSS('height', '7px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}

test('mobile filters preserve selections when collapsed and remain available on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'All Tasks', exact: true }).click();
  const toggle = page.getByRole('button', { name: /Filters & sort/ });
  await toggle.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.getByLabel('Priority filter').selectOption('high');
  await expect(page.getByText('1 task', { exact: true })).toBeVisible();
  await expect(toggle).toContainText('1 active');
  await toggle.press('Enter');
  await expect(page.getByLabel('Priority filter')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Review visual hierarchy' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Prepare design notes' })).toHaveCount(0);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByLabel('Priority filter')).toBeVisible();
  await expect(page.getByLabel('Priority filter')).toHaveValue('high');
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await expect(page.getByText('2 tasks', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(toggle).not.toContainText('active');
});

test('confirmation dialogs show labeled project names instead of internal identifiers', async ({ page }) => {
  await page.getByRole('button', { name: 'All Tasks', exact: true }).click();
  await page.getByRole('button', { name: 'Complete Review visual hierarchy', exact: true }).click();
  const status = page.getByRole('dialog', { name: 'Complete this task?' });
  await expect(status).toContainText('Design release');
  await expect(status).not.toContainText(PROJECT_ID);
  for (const label of ['Deadline', 'Priority', 'Project', 'Status']) {
    await expect(status.getByText(label, { exact: true })).toBeVisible();
  }
  await status.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Delete Review visual hierarchy', exact: true }).click();
  const deletion = page.getByRole('alertdialog', { name: 'Delete this task?' });
  await expect(deletion).toContainText('Design release');
  await expect(deletion).not.toContainText(PROJECT_ID);
  await deletion.getByRole('button', { name: 'Keep task', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review visual hierarchy' })).toBeVisible();
});
