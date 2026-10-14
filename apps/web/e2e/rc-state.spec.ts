import { expect, test } from '@playwright/test';

const email = process.env.WEB_TEST_EMAIL;
const password = process.env.WEB_TEST_PASSWORD;
const origin = new URL(process.env.WEB_TEST_URL ?? 'http://127.0.0.1:5173').origin;
const owned = new Set<string>();

test.beforeEach(async ({ page }) => {
  test.skip(!email || !password, 'Requires fictional fixture credentials.');
  owned.clear();
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/food/commands')) {
      const command = request.postDataJSON();
      if (command.type === 'food.create') owned.add(command.entryId);
    }
  });
  await page.goto('/');
  await page.getByLabel('Email address').fill(email!);
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('#today-heading')).toBeVisible();
});

test.afterEach(async ({ page }) => {
  if (!owned.size) return;
  const response = await page.request.get('/api/food');
  expect(response.ok()).toBeTruthy();
  for (const entry of (await response.json()).entries) {
    if (!owned.has(entry.id)) continue;
    const deletion = await page.request.post('/api/food/commands', {
      headers: { Origin: origin },
      data: {
        type: 'food.delete',
        operationId: crypto.randomUUID(),
        entryId: entry.id,
        expectedRevision: entry.revision,
      },
    });
    expect(deletion.ok(), await deletion.text()).toBeTruthy();
  }
});

test('a slower earlier food-day response cannot replace the chosen day', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let earlierStarted = false;
  const entry = (date: string, text: string) => ({
    id: crypto.randomUUID(),
    revision: 1,
    content: { text, occurredAt: `${date}T12:00:00.000Z`, timezone: 'UTC' },
    photoIds: [],
    createdAt: `${date}T12:00:00.000Z`,
    updatedAt: `${date}T12:00:00.000Z`,
    deletedAt: null,
  });
  // Delay only a selected history read; all authentication and other APIs remain real.
  await page.route('**/api/food?**', async (route) => {
    const date = new URL(route.request().url()).searchParams.get('date');
    if (date === '2026-01-10') {
      earlierStarted = true;
      await held;
    }
    await route.fulfill({
      json: {
        entries:
          date === '2026-01-10'
            ? [entry(date, 'Earlier-day response')]
            : date === '2026-01-11'
              ? [entry(date, 'Chosen-day response')]
              : [],
      },
    });
  });
  await page.getByRole('link', { name: 'Food', exact: false }).click();
  await page.getByLabel('Daily history', { exact: true }).fill('2026-01-10');
  await expect.poll(() => earlierStarted).toBe(true);
  await page.getByLabel('Daily history', { exact: true }).fill('2026-01-11');
  await expect(page.locator('.food article')).toContainText('Chosen-day response');
  const earlierResponse = page.waitForResponse((response) =>
    response.url().includes('date=2026-01-10'),
  );
  release();
  // Browser response completion plus the next animation frame lets React apply the old response.
  await earlierResponse;
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(page.locator('.food article')).toContainText('Chosen-day response');
  await expect(page.getByText('Earlier-day response', { exact: true })).toHaveCount(0);
});

test('food drafts survive navigation, prevent silent replacement, and lock while saving', async ({
  page,
}) => {
  const text = `RC draft ${crypto.randomUUID()}`;
  await page.getByRole('link', { name: 'Food', exact: false }).click();
  await page.getByLabel('Daily history', { exact: true }).fill('2026-01-12');
  await page.getByRole('button', { name: 'Add entry', exact: true }).click();
  await page.locator('.food-time summary').click();
  await page.getByRole('textbox', { name: 'What did you eat?', exact: true }).fill(text);
  await page.getByLabel('Date and time', { exact: true }).fill('2026-01-12T12:00');
  await page.getByRole('link', { name: 'Tasks', exact: false }).click();
  await page.getByRole('textbox', { name: 'New task', exact: true }).fill('Unsaved capture');
  await page.getByRole('link', { name: 'Food', exact: false }).click();
  await expect(page.getByRole('textbox', { name: 'What did you eat?', exact: true })).toHaveValue(
    text,
  );
  await page.getByRole('link', { name: 'Tasks', exact: false }).click();
  await expect(page.getByRole('textbox', { name: 'New task', exact: true })).toHaveValue(
    'Unsaved capture',
  );
  await page.getByRole('link', { name: 'Food', exact: false }).click();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let committed = false;
  await page.route('**/api/food/commands', async (route) => {
    const response = await route.fetch();
    expect(response.ok()).toBeTruthy();
    committed = true;
    await held;
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Save entry', exact: true }).click();
  await expect.poll(() => committed).toBe(true);
  await expect(
    page.getByRole('textbox', { name: 'What did you eat?', exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel('Date and time', { exact: true })).toBeDisabled();
  release();
  await expect(page.locator('.food [role="status"]')).toHaveText('Food entry saved.');
  const card = page.locator('.food article').filter({ hasText: text });
  await expect(card).toBeVisible();
  await page.getByRole('button', { name: 'Add entry', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'What did you eat?', exact: true })
    .fill('Keep this newer draft');
  await card.getByRole('button', { name: 'Edit entry', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'What did you eat?', exact: true })).toHaveValue(
    'Keep this newer draft',
  );
  await expect(page.locator('.food [role="status"]')).toContainText('Finish the current draft');
  await page.locator('.food-composer > details').last().getByText('More', { exact: true }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Discard draft', exact: true }).click();
  await card.getByRole('button', { name: 'Edit entry', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'What did you eat?', exact: true })).toHaveValue(
    text,
  );
});

test('a failed feature chunk can retry while another screen draft stays intact', async ({
  page,
}) => {
  await page.getByRole('link', { name: 'Food', exact: false }).click();
  await page.getByRole('button', { name: 'Add entry', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'What did you eat?', exact: true })
    .fill('Retain this open draft');
  let blockChunk = true;
  await page.route('**/assets/Tasks-*.js', async (route) => {
    if (blockChunk) {
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('link', { name: 'Tasks', exact: false }).click();
  await expect(page.getByRole('button', { name: 'Retry opening view', exact: true })).toBeVisible();
  blockChunk = false;
  await page.getByRole('button', { name: 'Retry opening view', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'New task', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Food', exact: false }).click();
  await expect(page.getByRole('textbox', { name: 'What did you eat?', exact: true })).toHaveValue(
    'Retain this open draft',
  );
});

test('retry restores a failed feature stylesheet as well as its screen', async ({ page }) => {
  let blockStyles = true;
  await page.route('**/assets/Tasks-*.css', async (route) => {
    if (blockStyles) await route.abort('failed');
    else await route.continue();
  });
  await page.getByRole('link', { name: 'Tasks', exact: false }).click();
  await expect(page.getByRole('button', { name: 'Retry opening view', exact: true })).toBeVisible();
  blockStyles = false;
  await page.getByRole('button', { name: 'Retry opening view', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'New task', exact: true })).toBeVisible();
  expect(
    await page.evaluate(() =>
      Array.from(document.styleSheets).some(
        (sheet) => sheet.href?.includes('/Tasks-') && sheet.href.includes('retry='),
      ),
    ),
  ).toBe(true);
  await page.getByText('Search and filters', { exact: true }).click();
  await expect(page.locator('.productivity-filters')).toHaveCSS('display', 'flex');
});

test('a retained task dialog does not block another page and keeps its draft', async ({ page }) => {
  const taskId = crypto.randomUUID();
  const created = await page.request.post('/api/tasks/commands', {
    headers: { Origin: origin },
    data: {
      type: 'task.create',
      operationId: crypto.randomUUID(),
      taskId,
      expectedRevision: 0,
      content: { title: `RC modal ${taskId}`, description: '', notes: '' },
    },
  });
  expect(created.ok()).toBeTruthy();
  try {
    await page.getByRole('link', { name: 'Tasks', exact: false }).click();
    await page.getByRole('button', { name: `RC modal ${taskId}`, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Edit task', exact: true }).click();
    await dialog.getByLabel('Title', { exact: true }).fill('Retained dialog draft');
    await page.evaluate(() => {
      window.location.hash = 'food';
    });
    await expect(page.getByRole('heading', { name: 'Food', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Add entry', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'What did you eat?', exact: true })
      .fill('Other page usable');
    await page.getByRole('link', { name: 'Tasks', exact: false }).click();
    await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('Retained dialog draft');
  } finally {
    const task = (await (await page.request.get(`/api/tasks/${taskId}`)).json()).task;
    const deleted = await page.request.post('/api/tasks/commands', {
      headers: { Origin: origin },
      data: {
        type: 'task.delete',
        operationId: crypto.randomUUID(),
        taskId,
        expectedRevision: task.revision,
      },
    });
    expect(deleted.ok()).toBeTruthy();
  }
});

test('a retained routine dialog does not block another page and keeps its draft', async ({
  page,
}) => {
  await page.getByRole('link', { name: 'Workouts', exact: false }).click();
  await page.getByRole('button', { name: 'New routine', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('Unsaved routine draft');
  await page.evaluate(() => {
    window.location.hash = 'food';
  });
  await page.getByRole('button', { name: 'Add entry', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'What did you eat?', exact: true })
    .fill('Other page usable');
  await page.getByRole('link', { name: 'Workouts', exact: false }).click();
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Unsaved routine draft');
});
