import { expect, test } from '@playwright/test';

const TASK_IDS = Array.from({ length: 24 }, (_, index) =>
  `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
);

test('create, edit, search, and permanently delete a task with keyboard controls', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'A fresh start.' })).toBeVisible();

  await page.getByRole('button', { name: 'New task' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('Title').fill('Sketch the new homepage');
  await page
    .getByLabel('Description')
    .fill('Start with a calm layout.\nKeep the description exactly.');
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  await page.keyboard.press('Tab');
  await page.getByRole('button', { name: 'Add task' }).press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Sketch the new homepage' }),
  ).toBeVisible();
  await expect(
    page.getByText('Start with a calm layout.\nKeep the description exactly.'),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Edit Sketch the new homepage' }).click();
  await page.getByLabel('Title').fill('Sketch the revised homepage');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    page.getByRole('heading', { name: 'Sketch the revised homepage' }),
  ).toBeVisible();

  await page.getByRole('searchbox', { name: 'Search tasks' }).fill('REVISED');
  await expect(
    page.getByRole('heading', { name: 'Sketch the revised homepage' }),
  ).toBeVisible();
  await expect(page.getByText('1 task')).toBeVisible();

  await page.getByRole('button', { name: 'Delete Sketch the revised homepage' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Keep task' })).toBeFocused();
  await page.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(page.getByRole('heading', { name: 'Nothing found yet.' })).toBeVisible();
});

test('paginates and searches on the server and fits narrow and wide layouts', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'A fresh start.' })).toBeVisible();
  await page.evaluate((ids) => {
    if (!window.taskflowMock) throw new Error('The in-browser mock is not ready.');
    return window.taskflowMock?.seed(
      ids.map((id, index) => ({
        id,
        title: `Task ${index + 1}`,
        description: `Description for item ${index + 1}`,
        version: 0,
        createdAt: index + 1,
      })),
    );
  }, TASK_IDS);
  expect(await page.evaluate(() => window.taskflowMock?.count())).toBe(24);
  await page.reload();
  await expect(page.getByText('24 tasks')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search tasks' }).fill('Task');
  await expect(page.getByRole('heading', { name: 'Task 24' })).toBeVisible();
  await expect(page.getByText('24 tasks')).toBeVisible();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByText('Page 2 of 2')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Task 4' })).toBeVisible();

  await page.getByRole('searchbox', { name: 'Search tasks' }).fill('Task 1');
  await expect(page.getByRole('heading', { name: 'Task 19' })).toBeVisible();
  await expect(page.getByText('Page 1 of 1')).not.toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    )
    .toBe(true);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    )
    .toBe(true);

  await page.getByRole('link', { name: 'TaskFlow home' }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'New task' })).toBeFocused();
});

test('preserves drafts after stale edits and deletes across two browser tabs', async ({
  page,
  context,
}) => {
  await page.goto('/');
  const taskId = TASK_IDS[0];
  await expect(page.getByRole('heading', { name: 'A fresh start.' })).toBeVisible();
  await page.evaluate(
    ({ id }) => {
      if (!window.taskflowMock) throw new Error('The in-browser mock is not ready.');
      return window.taskflowMock.seed([
        {
          id,
          title: 'Original task',
          description: 'Original notes',
          version: 0,
          createdAt: 1,
        },
      ]);
    },
    { id: taskId },
  );
  await page
    .getByRole('searchbox', { name: 'Search tasks' })
    .fill('Original task');
  await expect(page.getByRole('heading', { name: 'Original task' })).toBeVisible();

  await page.getByRole('button', { name: 'Edit Original task' }).click();
  await page.getByLabel('Title').fill('My safe unsaved draft');

  const secondTab = await context.newPage();
  await secondTab.goto('/');
  await expect(
    secondTab.getByRole('heading', { name: 'Original task' }),
  ).toBeVisible();
  await secondTab
    .getByRole('button', { name: 'Edit Original task' })
    .click();
  await secondTab.getByLabel('Title').fill('Changed elsewhere');
  await secondTab.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    secondTab.getByRole('heading', { name: 'Changed elsewhere' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('alert')).toContainText('changed in another tab');
  await expect(page.getByLabel('Title')).toHaveValue('My safe unsaved draft');
  await page.getByRole('button', { name: 'Review latest task' }).click();
  await expect(
    page.getByRole('heading', { name: 'Latest task on server · version 1' }),
  ).toBeVisible();
  await expect(page.getByText('Changed elsewhere')).toBeVisible();
  await page.getByRole('button', { name: 'Discard my draft and load latest' }).click();
  await expect(page.getByRole('alertdialog')).toContainText(
    'Discard your draft and load the latest task?',
  );
  await page.getByRole('button', { name: 'Keep my draft' }).click();
  await expect(page.getByLabel('Title')).toHaveValue('My safe unsaved draft');
  await page
    .getByRole('button', { name: 'Discard my draft and load latest' })
    .click();
  await page
    .getByRole('button', { name: 'Discard draft and load latest' })
    .click();
  await expect(page.getByLabel('Title')).toHaveValue('Changed elsewhere');
  await page.getByRole('button', { name: 'Cancel' }).click();

  await secondTab
    .getByRole('button', { name: 'Edit Changed elsewhere' })
    .click();
  await secondTab.getByLabel('Title').fill('Changed once more');
  await secondTab.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    secondTab.getByRole('heading', { name: 'Changed once more' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Delete Original task' }).click();
  await page.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(page.getByRole('alert')).toContainText('has not been deleted');
  await page.getByRole('button', { name: 'Reload latest task' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Changed once more');
  await page.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(page.getByRole('heading', { name: 'Nothing found yet.' })).toBeVisible();
});

test('requires a fresh server review before retrying an uncertain update', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'A fresh start.' })).toBeVisible();
  const taskId = TASK_IDS[5];
  await page.evaluate(
    ({ id }) => {
      if (!window.taskflowMock) throw new Error('The in-browser mock is not ready.');
      return window.taskflowMock.seed([
        {
          id,
          title: 'Current server task',
          description: 'Original server notes',
          version: 0,
          createdAt: 1,
        },
      ]);
    },
    { id: taskId },
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Current server task' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit Current server task' }).click();
  await page.getByLabel('Title').fill('Draft after uncertain update');
  await page.evaluate(() => window.taskflowMock?.failNext('network'));
  await page.getByRole('button', { name: 'Save changes' }).click();

  await expect(page.getByRole('alert')).toContainText('save outcome is uncertain');
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  await page.getByLabel('Title').fill('Edited while waiting for review');
  await expect(page.getByRole('button', { name: 'Check latest version' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();

  await page.getByRole('button', { name: 'Check latest version' }).click();
  await expect(
    page.getByRole('heading', { name: 'Latest task on server · version 0' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  await expect(page.getByLabel('Title')).toHaveValue(
    'Edited while waiting for review',
  );
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    page.getByRole('heading', { name: 'Edited while waiting for review' }),
  ).toBeVisible();
});

test('synchronizes reset followed by reseed into another tab with a cached revision', async ({
  page,
  context,
}) => {
  const taskId = TASK_IDS[0];
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'A fresh start.' })).toBeVisible();
  await page.evaluate(
    ({ id }) => {
      if (!window.taskflowMock) throw new Error('The in-browser mock is not ready.');
      return window.taskflowMock.seed([
        {
          id,
          title: 'Before reset',
          description: 'Old snapshot',
          version: 0,
          createdAt: 1,
        },
      ]);
    },
    { id: taskId },
  );
  await page.getByRole('searchbox', { name: 'Search tasks' }).fill('Before reset');
  await expect(page.getByRole('heading', { name: 'Before reset' })).toBeVisible();

  const secondTab = await context.newPage();
  await secondTab.goto('/');
  await expect(secondTab.getByRole('heading', { name: 'Before reset' }))
    .toBeVisible();

  await page.evaluate(async ({ id }) => {
    if (!window.taskflowMock) throw new Error('The in-browser mock is not ready.');
    await window.taskflowMock.reset();
    await window.taskflowMock.seed([
      {
        id,
        title: 'After reset and reseed',
        description: 'New snapshot',
        version: 0,
        createdAt: 2,
      },
    ]);
  }, { id: TASK_IDS[1] });

  await secondTab
    .getByRole('searchbox', { name: 'Search tasks' })
    .fill('After reset');
  await expect(
    secondTab.getByRole('heading', { name: 'After reset and reseed' }),
  ).toBeVisible();
  await expect(
    secondTab.getByRole('heading', { name: 'Before reset' }),
  ).not.toBeVisible();
});

test('keeps 10,000 seeded tasks paginated and responsive while delayed search remains interactive', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const observedWindow = window as Window & { __longTasks?: number[] };
    observedWindow.__longTasks = [];
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'A fresh start.' })).toBeVisible();
  await page.evaluate(() => {
    if (!window.taskflowMock) throw new Error('The in-browser mock is not ready.');
    const ids = Array.from({ length: 10_000 }, (_, index) =>
      `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    );
    return window.taskflowMock?.seed(
      ids.map((id, index) => ({
        id,
        title: `Task ${index + 1}`,
        description:
          index === 9_999
            ? 'rare-needle-10000'
            : `Description for item ${index + 1}`,
        version: 0,
        createdAt: index + 1,
      })),
    );
  });
  // Start measurement after fixture seeding so buffered setup work cannot be
  // delivered to the observer after the results array has been reset.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.evaluate(() => {
    const observedWindow = window as Window & {
      __longTasks?: number[];
      __longTaskObserver?: PerformanceObserver;
    };
    if (!('PerformanceObserver' in window)) {
      throw new Error('PerformanceObserver is required for the long-task check.');
    }
    if (!PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      throw new Error('The browser does not support long-task observations.');
    }
    observedWindow.__longTaskObserver = new PerformanceObserver((list) => {
      observedWindow.__longTasks?.push(
        ...list.getEntries().map((entry) => entry.duration),
      );
    });
    observedWindow.__longTaskObserver.observe({ type: 'longtask' });
  });
  const search = page.getByRole('searchbox', { name: 'Search tasks' });
  const listItems = page.getByRole('listitem');
  for (const { width, query } of [
    { width: 375, query: 'Task' },
    { width: 1440, query: 'task' },
  ]) {
    await page.setViewportSize({ width, height: 900 });
    const startedAt = Date.now();
    const listResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === 'GET' &&
        url.pathname === '/api/tasks' &&
        url.searchParams.get('q') === query &&
        response.ok()
      );
    });
    await search.fill(query);
    await listResponse;
    await expect(page.getByText('10000 tasks')).toBeVisible();
    await expect(listItems).toHaveCount(20);
    expect(
      Date.now() - startedAt,
      `${width}px warm 10,000-task list should be usable within 2,000 ms`,
    ).toBeLessThan(2_000);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
  }

  await page.evaluate(() => window.taskflowMock?.setLatency(250));
  await search.fill('rare');
  await expect(page.getByText('Updating tasks…')).toBeVisible();
  await search.fill('rare-needle-10000');
  await expect(page.getByRole('heading', { name: 'Task 10000' })).toBeVisible();

  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
  }
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const longTasks = await page.evaluate(() => {
    const observedWindow = window as Window & {
      __longTasks?: number[];
      __longTaskObserver?: PerformanceObserver;
    };
    const observer = observedWindow.__longTaskObserver;
    if (observer) {
      observedWindow.__longTasks?.push(
        ...observer.takeRecords().map((entry) => entry.duration),
      );
      observer.disconnect();
    }
    return observedWindow.__longTasks ?? [];
  });
  expect(
    longTasks.every((duration) => duration <= 50),
    `Long task durations exceeded 50 ms: ${JSON.stringify(longTasks.filter((duration) => duration > 50))}`,
  ).toBe(true);
});

test('surfaces uncertain create outcomes and warns before discarding dirty input', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New task' }).click();
  await page.getByLabel('Title').fill('Draft after a network failure');
  await page.evaluate(() => window.taskflowMock?.failNext('network'));
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByRole('alert')).toContainText('outcome is uncertain');
  await expect(page.getByLabel('Title')).toHaveValue(
    'Draft after a network failure',
  );
  await expect(
    page.getByRole('button', { name: 'Review recent tasks first' }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Refresh recent tasks' }).click();
  await expect(
    page.getByRole('heading', {
      name: 'Recent tasks · unfiltered first page',
    }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try create again' }))
    .toBeEnabled();
  await page.getByRole('button', { name: 'Try create again' }).click();
  await expect(
    page.getByRole('heading', { name: 'Draft after a network failure' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'New task' }).click();
  await page.getByLabel('Title').fill('Unsaved close warning');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog')).toContainText(
    'Discard your changes?',
  );
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await expect(
    page.getByRole('heading', { name: 'Draft after a network failure' }),
  ).toBeVisible();
});
