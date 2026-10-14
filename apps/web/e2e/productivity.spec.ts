import { expect, test } from '@playwright/test';
const email = process.env.WEB_TEST_EMAIL,
  password = process.env.WEB_TEST_PASSWORD;
const origin = new URL(process.env.WEB_TEST_URL ?? 'http://127.0.0.1:5173').origin;
const tasks = new Set<string>(),
  series = new Set<string>();
test.beforeEach(async ({ page }) => {
  tasks.clear();
  series.clear();
  test.skip(!email || !password, 'Use a disposable owner installation.');
  page.on('response', async (response) => {
    if (!response.ok() || response.request().method() !== 'POST') return;
    const url = response.url();
    if (!/\/api\/(tasks|recurrence)\/commands$/.test(url)) return;
    const body = await response.json().catch(() => null);
    const input = response.request().postDataJSON();
    if (input?.type === 'task.create') tasks.add(input.taskId);
    if (
      input?.type === 'series.create' ||
      input?.type === 'series.generate' ||
      input?.type === 'series.skip'
    )
      for (const task of body?.changedTasks ?? []) if (task.revision === 1) tasks.add(task.id);
    if (body?.series) series.add(body.series.id);
  });
  await page.goto('/');
  await page.getByLabel('Email address').fill(email!);
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await page.goto('/#tasks');
});
test.afterEach(async ({ page }) => {
  if (!email || !password) return;
  const records = await page.request.get('/api/recurrence');
  if (records.ok())
    for (const record of (await records.json()).series.filter(
      (r: { id: string; cancelledAt: string | null }) => series.has(r.id) && !r.cancelledAt,
    ))
      await page.request.post('/api/recurrence/commands', {
        headers: { Origin: origin },
        data: {
          type: 'series.cancel',
          operationId: crypto.randomUUID(),
          id: record.id,
          expectedRevision: record.revision,
        },
      });
  for (const id of tasks) {
    const current = await page.request.get(`/api/tasks/${id}`);
    if (!current.ok()) continue;
    const { task } = await current.json();
    if (task.deletedAt) continue;
    const deleted = await page.request.post('/api/tasks/commands', {
      headers: { Origin: origin },
      data: {
        type: 'task.delete',
        operationId: crypto.randomUUID(),
        taskId: id,
        expectedRevision: task.revision,
      },
    });
    expect(deleted.ok()).toBeTruthy();
  }
});
test('configuration, organization, dates and parallel steps preserve one outcome', async ({
  page,
}, testInfo) => {
  const suffix = crypto.randomUUID().slice(0, 8),
    title = `Fictional outcome ${suffix}`,
    board = `Fictional board ${suffix}`,
    project = `Fictional project ${suffix}`;
  await page.getByRole('button', { name: 'Configure boards & projects' }).click();
  const config = page.locator('.configuration-panel');
  await config.getByLabel('Name', { exact: true }).fill(board);
  await config.getByLabel('Column 1', { exact: true }).fill('Ideas');
  await config.getByRole('button', { name: 'Save board', exact: true }).click();
  await expect(config.getByRole('status')).toContainText('Saved.');
  await config.getByLabel('Configuration type').selectOption('project');
  await config.getByLabel('Name', { exact: true }).fill(project);
  await config.getByRole('button', { name: 'Save project', exact: true }).click();
  await expect(page.getByLabel('Project filter').locator('option')).toContainText([
    'All projects',
    project,
  ]);
  await config.getByRole('button', { name: 'Close configuration' }).click();
  await page.getByLabel('New task', { exact: true }).fill(title);
  await page.getByRole('button', { name: 'Add to Planned' }).click();
  await page.getByRole('button', { name: title, exact: true }).click();
  const detail = page.getByRole('dialog');
  await detail.getByLabel('Task board').selectOption({ label: board });
  await detail.getByLabel('Task project').selectOption({ label: project });
  await detail.getByLabel('Task priority').selectOption('high');
  await detail.getByLabel('Tags (comma separated)').fill('fictional, launch');
  await detail.getByRole('button', { name: 'Save organization' }).click();
  await expect(detail.getByRole('status').first()).toContainText('Saved.');
  await detail.getByLabel('Due date', { exact: true }).fill('2026-11-01T12:00');
  await detail.getByRole('button', { name: 'Save dates' }).click();
  await expect(detail.getByRole('status').first()).toContainText('Saved.');
  await detail.getByLabel('Step title', { exact: true }).fill('Draft fictional copy');
  await detail.getByRole('combobox', { name: 'Responsibility', exact: true }).selectOption('agent');
  await detail.getByRole('button', { name: 'Add step', exact: true }).click();
  await expect(detail.locator('.step-card')).toHaveCount(1);
  await detail.getByLabel('Step title', { exact: true }).fill('Record fictional voice');
  await detail.getByRole('combobox', { name: 'Responsibility', exact: true }).selectOption('human');
  await detail.getByRole('button', { name: 'Add step', exact: true }).click();
  await expect(detail.locator('.step-card')).toHaveCount(2);
  await detail.getByLabel('Step title', { exact: true }).fill('Assemble fictional episode');
  await detail
    .getByRole('combobox', { name: 'Responsibility', exact: true })
    .selectOption('either');
  await detail.getByLabel('Draft fictional copy', { exact: true }).check();
  await detail.getByLabel('Record fictional voice', { exact: true }).check();
  await detail.getByRole('button', { name: 'Add step', exact: true }).click();
  await expect(detail.locator('.step-card')).toHaveCount(3);
  await expect(detail.getByText('Waiting for release to Next', { exact: true })).toHaveCount(3);
  await detail.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByLabel(`Move ${title}`, { exact: true }).selectOption('next');
  await page.getByRole('button', { name: title, exact: true }).click();
  await expect(detail.getByText('Ready to start', { exact: true })).toHaveCount(2);
  await expect(detail.getByText('Waiting for prerequisites', { exact: true })).toBeVisible();
  await detail.getByLabel('Status of Draft fictional copy').selectOption('completed');
  await expect(detail.getByLabel('Status of Draft fictional copy')).toHaveValue('completed');
  await detail.getByLabel('Status of Record fictional voice').selectOption('completed');
  await expect(detail.getByText('Ready to start', { exact: true })).toHaveCount(1);
  await detail.getByLabel('Status of Assemble fictional episode').selectOption('completed');
  await expect(
    detail.getByText('Required work is satisfied. You can complete the outcome.'),
  ).toBeVisible();
  await detail.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByLabel('Board filter').selectOption({ label: board });
  await expect(page.getByRole('region', { name: 'Ideas tasks' })).toBeVisible();
  await page.screenshot({
    path: `../../.scratch/mems-life-v1/evidence/productivity-web/desktop-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.reload();
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Active', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBeTruthy();
  await page.getByRole('button', { name: title, exact: true }).click();
  await expect(detail).toBeVisible();
  await page.screenshot({
    path: `../../.scratch/mems-life-v1/evidence/productivity-web/phone-${testInfo.project.name}.png`,
    fullPage: false,
  });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBeTruthy();
});
test('an uncertain step save retries the exact command and creates one step', async ({ page }) => {
  const title = `Fictional retry ${crypto.randomUUID().slice(0, 8)}`;
  await page.getByLabel('New task', { exact: true }).fill(title);
  await page.getByRole('button', { name: 'Add to Planned' }).click();
  await page.getByRole('button', { name: title, exact: true }).click();
  const detail = page.getByRole('dialog');
  const commands: unknown[] = [];
  let first = true;
  await page.route('**/api/steps/commands', async (route) => {
    commands.push(route.request().postDataJSON());
    if (first) {
      first = false;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await detail.getByLabel('Step title', { exact: true }).fill('One fictional step');
  await detail.getByRole('button', { name: 'Add step', exact: true }).click();
  await detail.getByRole('button', { name: 'Retry the same change', exact: true }).click();
  await expect(detail.locator('.step-card')).toHaveCount(1);
  expect(commands).toHaveLength(2);
  expect(commands[1]).toEqual(commands[0]);
  await expect(detail.getByLabel('Step title', { exact: true })).toHaveValue('One fictional step');
});
test('future repeat edits, occurrence skip and cancellation retain occurrence history', async ({
  page,
}) => {
  const title = `Fictional repeat ${crypto.randomUUID().slice(0, 8)}`;
  await page.getByLabel('New task', { exact: true }).fill(title);
  await page.getByRole('button', { name: 'Add to Planned' }).click();
  await page.getByRole('button', { name: title, exact: true }).click();
  const detail = page.getByRole('dialog');
  await detail.getByText('Repeat & occurrence history', { exact: true }).click();
  await detail.getByLabel('Repeat frequency').selectOption('monthly');
  await detail.getByLabel('Day of month').fill('31');
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/recurrence/commands') &&
      response.request().postDataJSON().type === 'series.create',
  );
  await detail.getByRole('button', { name: 'Create repeat series' }).click();
  const data = await (await created).json();
  expect(data.changedTasks).toHaveLength(1);
  const seriesId = data.series.id;
  await expect(detail.getByRole('button', { name: 'Save future recurrence' })).toBeVisible();
  await detail.getByRole('button', { name: 'Close', exact: true }).click();
  const repeatCard = page
    .locator('.task-card')
    .filter({ has: page.getByText('Repeats', { exact: true }) });
  await repeatCard.getByRole('button', { name: title, exact: true }).click();
  await detail.getByText('Repeat & occurrence history', { exact: true }).click();
  await detail.getByLabel('Day of month').fill('30');
  await detail.getByRole('button', { name: 'Save future recurrence' }).click();
  await expect(detail.getByRole('status').last()).toContainText('Saved.');
  const skipped = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/recurrence/commands') &&
      response.request().postDataJSON().type === 'series.skip',
  );
  await detail.getByRole('button', { name: 'Skip this occurrence' }).click();
  const skipData = await (await skipped).json();
  expect(
    skipData.changedTasks.some(
      (task: { schedule: { skippedAt: string | null } }) => task.schedule.skippedAt,
    ),
  ).toBeTruthy();
  await detail.getByRole('button', { name: 'Close', exact: true }).click();
  await repeatCard.getByRole('button', { name: title, exact: true }).click();
  await detail.getByText('Repeat & occurrence history', { exact: true }).click();
  await detail.getByRole('button', { name: 'Cancel future repeats' }).click();
  await expect(
    detail.getByText('This series is cancelled. Its occurrence history is retained.'),
  ).toBeVisible();
  await detail.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByRole('button', { name: title, exact: true })).toHaveCount(2);
  const saved = (await (await page.request.get('/api/recurrence')).json()).series.find(
    (value: { id: string }) => value.id === seriesId,
  );
  expect(saved.cancelledAt).toBeTruthy();
});
test('drag ordering and the Move up alternative persist', async ({ page }) => {
  const prefix = `Fictional ordering ${crypto.randomUUID().slice(0, 8)}`;
  const one = `${prefix} one`,
    two = `${prefix} two`;
  for (const title of [one, two]) {
    await page.getByLabel('New task', { exact: true }).fill(title);
    await page.getByRole('button', { name: 'Add to Planned' }).click();
    await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible();
  }
  await page.getByLabel('Search tasks').fill(prefix);
  await page.getByRole('button', { name: 'Find tasks' }).click();
  const region = page.getByRole('region', { name: 'Planned tasks' });
  await expect(region.locator('.task-title')).toHaveText([one, two]);
  const first = region
    .locator('.task-card')
    .filter({ has: page.getByRole('button', { name: one, exact: true }) });
  const second = region
    .locator('.task-card')
    .filter({ has: page.getByRole('button', { name: two, exact: true }) });
  await second.dragTo(first, {
    sourcePosition: { x: 10, y: 10 },
    targetPosition: { x: 10, y: 10 },
  });
  await expect(region.locator('.task-title')).toHaveText([two, one]);
  await first.getByRole('button', { name: 'Move up', exact: true }).click();
  await expect(region.locator('.task-title')).toHaveText([one, two]);
  await page.reload();
  await page.getByLabel('Search tasks').fill(prefix);
  await page.getByRole('button', { name: 'Find tasks' }).click();
  await expect(region.locator('.task-title')).toHaveText([one, two]);
});
test('a stale board opens a saved-version review before any overwrite', async ({ page }) => {
  const title = `Fictional stale ${crypto.randomUUID().slice(0, 8)}`;
  await page.getByLabel('New task', { exact: true }).fill(title);
  await page.getByRole('button', { name: 'Add to Planned' }).click();
  await expect(page.getByRole('button', { name: title, exact: true })).toBeEnabled();
  const task = (
    await (await page.request.get(`/api/tasks/query?search=${encodeURIComponent(title)}`)).json()
  ).tasks[0];
  const updated = await page.request.post('/api/tasks/commands', {
    headers: { Origin: origin },
    data: {
      type: 'task.edit',
      operationId: crypto.randomUUID(),
      taskId: task.id,
      expectedRevision: task.revision,
      content: { ...task.content, notes: 'Saved on another device' },
    },
  });
  expect(updated.ok()).toBeTruthy();
  await page.getByRole('button', { name: title, exact: true }).click();
  const detail = page.getByRole('dialog');
  await expect(detail.getByRole('heading', { name: 'Review the saved task' })).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Save task', exact: true })).toBeDisabled();
  await expect(detail.getByText('Saved on another device', { exact: true })).toBeVisible();
  await detail.getByRole('button', { name: 'Use saved version' }).click();
  await expect(detail.getByLabel('Notes', { exact: true })).toHaveValue('Saved on another device');
  await expect(detail.getByRole('button', { name: 'Save task', exact: true })).toBeEnabled();
});
