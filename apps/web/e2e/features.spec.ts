import { expect, test } from '@playwright/test';

const email = process.env.WEB_TEST_EMAIL;
const password = process.env.WEB_TEST_PASSWORD;
const origin = new URL(process.env.WEB_TEST_URL ?? 'http://127.0.0.1:5173').origin;

const created = {
  tasks: new Set<string>(),
  exercises: new Set<string>(),
  routines: new Set<string>(),
};
test.beforeEach(async ({ page }) => {
  Object.values(created).forEach((ids) => ids.clear());
  page.on('request', (request) => {
    if (
      request.method() !== 'POST' ||
      !/\/api\/(tasks|exercises|routines)\/commands$/.test(request.url())
    )
      return;
    const command = request.postDataJSON();
    if (command.type === 'task.create') created.tasks.add(command.taskId);
    if (command.type === 'exercise.create') created.exercises.add(command.exerciseId);
    if (command.type === 'routine.create') created.routines.add(command.routineId);
    if (command.type === 'routine.duplicate') created.routines.add(command.newId);
  });
  test.skip(
    !email || !password,
    'Set WEB_TEST_EMAIL and WEB_TEST_PASSWORD for a disposable installation.',
  );
  await page.goto('/');
  await page.getByLabel('Email address').fill(email!);
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
});

test.afterEach(async ({ page }) => {
  if (!email || !password) return;
  const taskViews = await Promise.all(
    ['open', 'completed', 'archived'].map(
      async (view) => (await (await page.request.get(`/api/tasks?view=${view}`)).json()).tasks,
    ),
  );
  for (const task of taskViews.flat().filter((task) => created.tasks.has(task.id))) {
    const response = await page.request.post('/api/tasks/commands', {
      headers: { Origin: origin },
      data: {
        type: 'task.delete',
        operationId: crypto.randomUUID(),
        taskId: task.id,
        expectedRevision: task.revision,
      },
    });
    expect(response.ok()).toBeTruthy();
  }
  for (const kind of ['routines', 'exercises'] as const) {
    const records = (await (await page.request.get(`/api/${kind}`)).json())[kind];
    for (const record of records.filter(
      (value: { id: string; archivedAt: string | null }) =>
        created[kind].has(value.id) && !value.archivedAt,
    )) {
      const singular = kind === 'routines' ? 'routine' : 'exercise';
      const response = await page.request.post(`/api/${kind}/commands`, {
        headers: { Origin: origin },
        data: {
          type: `${singular}.archive`,
          operationId: crypto.randomUUID(),
          [`${singular}Id`]: record.id,
          expectedRevision: record.revision,
        },
      });
      expect(response.ok()).toBeTruthy();
    }
  }
});

test('capture, deliberate phases, completion, archive, deletion and undo persist', async ({
  page,
}) => {
  const title = `Fictional capture ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto('/#tasks');
  await page.getByLabel('New task', { exact: true }).fill(title);
  await page.getByRole('button', { name: 'Add to Planned' }).click();
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible();
  await page.getByLabel(`Move ${title}`, { exact: true }).selectOption('next');
  await expect(page.getByRole('region', { name: 'Next tasks' })).toContainText(title);
  await page.getByLabel(`Move ${title}`, { exact: true }).selectOption('active');
  await expect(page.getByRole('region', { name: 'Active tasks' })).toContainText(title);
  await page.getByRole('button', { name: title, exact: true }).click();
  await page.getByLabel('Description', { exact: true }).fill('A real persisted task description.');
  await page.getByLabel('Notes', { exact: true }).fill('Fictional notes for verification.');
  await page.getByRole('button', { name: 'Save task', exact: true }).click();
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue(
    'A real persisted task description.',
  );
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  const card = page
    .getByRole('article')
    .filter({ has: page.getByRole('button', { name: title, exact: true }) });
  await card.getByRole('button', { name: 'Complete', exact: true }).click();
  await page.getByRole('button', { name: 'Completed', exact: true }).click();
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Reopen', exact: true }).click();
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  await page.getByRole('button', { name: title, exact: true }).click();
  await page.getByRole('button', { name: 'Archive', exact: true }).last().click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Unarchive', exact: true }).click();
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  await page.getByRole('button', { name: title, exact: true }).click();
  await page.getByRole('button', { name: 'Delete task', exact: true }).click();
  await expect(page.getByRole('button', { name: title, exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible();
  await page.getByRole('button', { name: title, exact: true }).click();
  await page.getByText('Change history', { exact: true }).click();
  await expect(page.locator('.history-drawer')).toContainText('restore');
  await page.screenshot({ path: test.info().outputPath('task-details.png'), fullPage: true });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByLabel('New task', { exact: true }).focus();
  await page.screenshot({ path: test.info().outputPath('task-board.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('region', { name: 'Planned tasks' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Next tasks' })).toBeHidden();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: test.info().outputPath('task-board-phone.png'), fullPage: true });
});

test('task conflict preserves edits and lost-response retry uses the original command', async ({
  page,
}) => {
  const title = `Fictional conflict ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto('/#tasks');
  await page.getByLabel('New task', { exact: true }).fill(title);
  await page.getByRole('button', { name: 'Add to Planned' }).click();
  await page.getByRole('button', { name: title, exact: true }).click();
  await page.getByLabel('Description', { exact: true }).fill('Local edit preserved.');
  const saved = (await (await page.request.get('/api/tasks?view=open')).json()).tasks.find(
    (item: { content: { title: string } }) => item.content.title === title,
  );
  const changed = await page.request.post('/api/tasks/commands', {
    headers: { Origin: origin },
    data: {
      type: 'task.edit',
      operationId: crypto.randomUUID(),
      taskId: saved.id,
      expectedRevision: saved.revision,
      content: { ...saved.content, description: 'Saved by another session.' },
    },
  });
  expect(changed.ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Save task', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review the saved task' })).toBeVisible();
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue(
    'Local edit preserved.',
  );
  await expect(page.getByRole('button', { name: 'Save task', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Keep my reviewed edits' }).click();
  let firstBody = '';
  await page.route('**/api/tasks/commands', async (route) => {
    firstBody = route.request().postData()!;
    const response = await route.fetch();
    expect(response.ok()).toBeTruthy();
    await route.abort('failed');
  });
  await page.getByRole('button', { name: 'Save task', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Retry the same change' }),
  ).toBeVisible();
  await expect(page.getByLabel('Description', { exact: true })).toBeDisabled();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Retry the same change' }),
  ).toBeEnabled();
  await page.unroute('**/api/tasks/commands');
  const replay = page.waitForRequest((request) => request.url().endsWith('/api/tasks/commands'));
  await page.getByRole('dialog').getByRole('button', { name: 'Retry the same change' }).click();
  expect((await replay).postData()).toBe(firstBody);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: title, exact: true }).click();
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue(
    'Local edit preserved.',
  );
});

test('custom exercise and reusable routine save targets in canonical units', async ({ page }) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const exerciseName = `Fictional press ${suffix}`;
  const routineName = `Fictional routine ${suffix}`;
  const preferences = (await (await page.request.get('/api/preferences')).json()).value;
  await page.goto('/#workouts');
  await page.getByRole('button', { name: 'Exercise library', exact: true }).click();
  await page.getByRole('button', { name: 'New exercise', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill(exerciseName);
  await page.getByLabel('Measurement', { exact: true }).selectOption('weighted');
  await page.getByRole('button', { name: 'Save exercise', exact: true }).click();
  await expect(page.getByRole('heading', { name: exerciseName, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Routines', exact: true }).click();
  await page.getByRole('button', { name: 'New routine', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill(routineName);
  const exercise = (await (await page.request.get('/api/exercises')).json()).exercises.find(
    (value: { name: string }) => value.name === exerciseName,
  );
  await page.getByLabel('Add an exercise', { exact: true }).selectOption(exercise.id);
  await page.getByRole('button', { name: 'Add target', exact: true }).click();
  await page.getByLabel('Repetitions', { exact: true }).fill('8');
  await page.getByLabel(`Load (${preferences.weightUnit})`, { exact: true }).fill('100');
  await page.getByLabel('Target notes', { exact: true }).fill('Controlled repetitions.');
  await page.screenshot({ path: test.info().outputPath('routine-editor.png'), fullPage: true });
  await page.getByRole('button', { name: 'Save routine', exact: true }).click();
  await expect(page.getByRole('heading', { name: routineName, exact: true })).toBeVisible();
  const routine = (await (await page.request.get('/api/routines')).json()).routines.find(
    (value: { name: string }) => value.name === routineName,
  );
  expect(routine.items[0].targets[0].measurements.reps).toBe(8);
  expect(routine.items[0].targets[0].measurements.loadKg).toBeCloseTo(
    preferences.weightUnit === 'lb' ? 45.359237 : 100,
    6,
  );
  await page.reload();
  const card = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: routineName, exact: true }) });
  await card.getByRole('button', { name: 'Edit routine', exact: true }).click();
  await expect(page.getByLabel(`Load (${preferences.weightUnit})`, { exact: true })).toHaveValue(
    '100',
  );
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await card.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: `${routineName} (copy)`, exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('routine-library.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.screenshot({
    path: test.info().outputPath('routine-library-phone.png'),
    fullPage: true,
  });
});

test('routine conflict preserves local edits and exact replay recovers a committed response loss', async ({
  page,
}) => {
  const name = `Fictional recovery ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto('/#workouts');
  await page.getByRole('button', { name: 'New routine', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Save routine', exact: true }).click();
  const card = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });
  await card.getByRole('button', { name: 'Edit routine', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill(`${name} local`);
  const routine = (await (await page.request.get('/api/routines')).json()).routines.find(
    (item: { name: string }) => item.name === name,
  );
  const changed = await page.request.post('/api/routines/commands', {
    headers: { Origin: origin },
    data: {
      type: 'routine.edit',
      operationId: crypto.randomUUID(),
      routineId: routine.id,
      expectedRevision: routine.revision,
      content: { name: `${name} server`, notes: 'Another session changed this plan.', items: [] },
    },
  });
  expect(changed.ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Save routine', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review the saved version' })).toBeVisible();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(`${name} local`);
  await expect(page.getByRole('button', { name: 'Save routine', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Keep my reviewed edits' }).click();
  let original = '';
  await page.route('**/api/routines/commands', async (route) => {
    original = route.request().postData()!;
    const response = await route.fetch();
    expect(response.ok()).toBeTruthy();
    await route.abort('failed');
  });
  await page.getByRole('button', { name: 'Save routine', exact: true }).click();
  const retry = page.getByRole('dialog').getByRole('button', { name: 'Retry the same change' });
  await expect(retry).toBeEnabled();
  await expect(page.getByLabel('Name', { exact: true })).toBeDisabled();
  await page.unroute('**/api/routines/commands');
  const replay = page.waitForRequest((request) => request.url().endsWith('/api/routines/commands'));
  await retry.click();
  expect((await replay).postData()).toBe(original);
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.reload();
  await expect(page.getByRole('heading', { name: `${name} local`, exact: true })).toBeVisible();
});
