import { expect, test, type Page } from '@playwright/test';
const email = process.env.WEB_TEST_EMAIL,
  password = process.env.WEB_TEST_PASSWORD;
const origin = new URL(process.env.WEB_TEST_URL ?? 'http://127.0.0.1:5173').origin;
const owned = {
  exercises: new Set<string>(),
  routines: new Set<string>(),
  sessions: new Set<string>(),
};
async function post(page: Page, kind: string, data: Record<string, unknown>) {
  const response = await page.request.post(`/api/${kind}/commands`, {
    headers: { Origin: origin },
    data: { operationId: crypto.randomUUID(), ...data },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
test.beforeEach(async ({ page }) => {
  test.skip(
    !email || !password,
    'Requires disposable owner credentials and live PostgreSQL service.',
  );
  Object.values(owned).forEach((ids) => ids.clear());
  await page.goto('/');
  await page.getByLabel('Email address').fill(email!);
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  const current = await page.request.get('/api/sessions?status=active');
  expect(current.ok()).toBeTruthy();
  test.skip(
    (await current.json()).sessions.length > 0,
    'An owner workout is already active; never interrupt it.',
  );
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/sessions/commands')) {
      const cmd = request.postDataJSON();
      if (cmd.type === 'session.start') owned.sessions.add(cmd.sessionId);
    }
  });
});
test.afterEach(async ({ page }) => {
  if (!email || !password) return;
  for (const id of owned.sessions) {
    const response = await page.request.get(`/api/sessions/${id}`);
    if (!response.ok()) continue;
    const { session } = await response.json();
    if (session.status === 'active')
      await post(page, 'sessions', {
        type: 'session.abandon',
        sessionId: id,
        expectedRevision: session.revision,
      });
  }
  for (const kind of ['routines', 'exercises']) {
    const response = await page.request.get(`/api/${kind}`);
    if (!response.ok()) continue;
    for (const record of (await response.json())[kind])
      if (owned[kind as 'routines' | 'exercises'].has(record.id) && !record.archivedAt)
        await post(page, kind, {
          type: `${kind === 'routines' ? 'routine' : 'exercise'}.archive`,
          [kind === 'routines' ? 'routineId' : 'exerciseId']: record.id,
          expectedRevision: record.revision,
        });
  }
});
async function fixture(page: Page) {
  const exerciseId = crypto.randomUUID(),
    otherId = crypto.randomUUID(),
    routineId = crypto.randomUUID();
  owned.exercises.add(exerciseId);
  owned.exercises.add(otherId);
  owned.routines.add(routineId);
  await post(page, 'exercises', {
    type: 'exercise.create',
    exerciseId,
    expectedRevision: 0,
    content: {
      name: `Fictional press ${exerciseId.slice(0, 6)}`,
      mode: 'weighted',
      supportsLoad: true,
      notes: '',
    },
  });
  await post(page, 'exercises', {
    type: 'exercise.create',
    exerciseId: otherId,
    expectedRevision: 0,
    content: {
      name: `Fictional hold ${otherId.slice(0, 6)}`,
      mode: 'timed',
      supportsLoad: false,
      notes: '',
    },
  });
  const name = `Fictional session ${routineId.slice(0, 6)}`;
  await post(page, 'routines', {
    type: 'routine.create',
    routineId,
    expectedRevision: 0,
    content: {
      name,
      notes: 'Fixture plan',
      items: [
        {
          id: crypto.randomUUID(),
          exerciseId,
          snapshot: {
            name: `Fictional press ${exerciseId.slice(0, 6)}`,
            mode: 'weighted',
            supportsLoad: true,
          },
          notes: '',
          targets: [
            {
              id: crypto.randomUUID(),
              kind: 'working',
              measurements: { mode: 'weighted', reps: 8, loadKg: 20 },
              notes: '',
            },
          ],
        },
        {
          id: crypto.randomUUID(),
          exerciseId: otherId,
          snapshot: {
            name: `Fictional hold ${otherId.slice(0, 6)}`,
            mode: 'timed',
            supportsLoad: false,
          },
          notes: '',
          targets: [],
        },
      ],
    },
  });
  await page.goto('/#workouts');
  await page.reload();
  await page.getByRole('button', { name: 'Train', exact: true }).click();
  await page.getByLabel('Routine', { exact: true }).selectOption(routineId);
  await page.getByRole('button', { name: 'Start workout', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  return { exerciseId, otherId, routineId, name };
}
test('actual sets, exact retry, draft navigation, timer, finish and reasoned historical correction persist', async ({
  page,
}) => {
  const fixtureIds = await fixture(page);
  const area = page.locator('.session-area');
  const card = area.locator('article.session-card');
  await card.getByRole('button', { name: 'Save actual set', exact: true }).click();
  await expect(area).toContainText('Record the repetitions you performed.');
  await expect(card.locator('.actual-set')).toHaveCount(0);
  await card.getByLabel('Repetitions', { exact: true }).fill('7');
  await card.getByLabel(/^Load \(/).fill('25');
  await area
    .getByRole('button', { name: new RegExp(`Fictional hold ${fixtureIds.otherId.slice(0, 6)}`) })
    .click();
  await expect(card.getByLabel('Seconds', { exact: true })).toBeVisible();
  await expect(card.getByLabel(/^Load \(/)).toHaveCount(0);
  await area
    .getByRole('button', {
      name: new RegExp(`Fictional press ${fixtureIds.exerciseId.slice(0, 6)}`),
    })
    .click();
  await expect(card.getByLabel('Repetitions', { exact: true })).toHaveValue('7');
  const attempts: string[] = [];
  let lost = false;
  await page.route('**/api/sessions/commands', async (route) => {
    const cmd = route.request().postDataJSON();
    if (cmd.type === 'session.record-set') {
      attempts.push(cmd.operationId);
      if (!lost) {
        lost = true;
        await route.fetch();
        await route.abort('connectionfailed');
        return;
      }
    }
    await route.continue();
  });
  await card.getByRole('button', { name: 'Save actual set', exact: true }).click();
  await expect(area.getByRole('button', { name: 'Retry the same change' })).toBeVisible();
  await area.getByRole('button', { name: 'Retry the same change' }).click();
  await expect(card.locator('.actual-set')).toHaveCount(1);
  expect(attempts).toHaveLength(2);
  expect(attempts[0]).toBe(attempts[1]);
  await page.unroute('**/api/sessions/commands');
  await area.getByText('Workout tools', { exact: true }).click();
  await area.getByLabel('Timer duration (seconds)').fill('40');
  await area.getByRole('button', { name: 'Start rest timer' }).click();
  await expect(area.getByLabel('Workout timer')).toContainText('Rest');
  await area.getByRole('button', { name: 'Pause timer' }).click();
  await expect(area.getByLabel('Workout timer')).toContainText('paused');
  await page.reload();
  await page.getByRole('button', { name: 'Train', exact: true }).click();
  await expect(page.getByLabel('Workout timer')).toContainText('paused');
  await area.getByRole('button', { name: 'Resume timer' }).click();
  await expect(area.getByLabel('Workout timer')).toContainText('running');
  await area.getByRole('button', { name: 'Reset timer' }).click();
  await expect(area.getByLabel('Workout timer')).toContainText('40 seconds');
  await area.getByText('Finish this workout', { exact: true }).click();
  await area.getByRole('button', { name: 'Finish and save workout' }).click();
  await expect(area.locator('.session-heading')).toContainText('completed');
  await card.getByRole('button', { name: 'Correct set 1' }).click();
  await card.getByLabel('Repetitions', { exact: true }).fill('8');
  await card.getByLabel('Correction reason').fill('Count corrected after review');
  await card.getByRole('button', { name: 'Save correction', exact: true }).click();
  await expect(card.locator('.actual-set')).toContainText('Repetitions: 8');
  await page.screenshot({ path: test.info().outputPath('sessions-desktop.png'), fullPage: true });
  await expect(card.locator('.actual-set')).toContainText('Corrected');
  await area.getByText('Workout notes and history', { exact: true }).click();
  await area.getByRole('button', { name: 'Show correction history', exact: true }).click();
  await expect(area.getByText(/session.correct-set/).first()).toBeVisible();
  const sessionId = [...owned.sessions][0];
  const history = await (await page.request.get(`/api/sessions/${sessionId}/history`)).json();
  expect(
    history.events.some(
      (event: { reason: string | null }) => event.reason === 'Count corrected after review',
    ),
  ).toBeTruthy();
  await area.getByRole('button', { name: 'Workout history', exact: true }).click();
  await area.getByRole('button', { name: new RegExp(fixtureIds.name) }).click();
  await expect(card.locator('.actual-set')).toContainText('Repetitions: 8');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(area).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: test.info().outputPath('sessions-390.png'), fullPage: true });
});
test('revision conflict shows saved actual values while preserving editable draft', async ({
  page,
}) => {
  await fixture(page);
  const area = page.locator('.session-area'),
    card = area.locator('article.session-card');
  await card.getByLabel('Repetitions', { exact: true }).fill('9');
  await card.getByLabel(/^Load \(/).fill('30');
  const session = (await (await page.request.get('/api/sessions?status=active')).json())
    .sessions[0];
  await post(page, 'sessions', {
    type: 'session.record-set',
    sessionId: session.id,
    expectedRevision: session.revision,
    itemId: session.items[0].id,
    setId: crypto.randomUUID(),
    kind: 'working',
    measurements: { mode: 'weighted', reps: 5, loadKg: 11 },
    notes: 'Other client actual',
    round: null,
  });
  await card.getByRole('button', { name: 'Save actual set' }).click();
  await expect(area.locator('.conflict')).toContainText('Repetitions: 5');
  await expect(card.getByLabel('Repetitions', { exact: true })).toHaveValue('9');
  await area.getByRole('button', { name: 'Use current results; keep my draft for review' }).click();
  await card.getByRole('button', { name: 'Save actual set' }).click();
  await expect(card.locator('.actual-set')).toHaveCount(2);
});

test('zero repetitions and missing optional load remain explicit actual values', async ({
  page,
}) => {
  await fixture(page);
  const area = page.locator('.session-area'),
    card = area.locator('article.session-card');
  await card.getByLabel('Repetitions', { exact: true }).fill('0');
  await card.getByRole('button', { name: 'Save actual set', exact: true }).click();
  await expect(card.locator('.actual-set')).toHaveCount(1);
  await expect(card.locator('.actual-set')).toContainText('Repetitions: 0');
  await expect(card.locator('.actual-set')).toContainText('not recorded');
  const saved = (await (await page.request.get('/api/sessions?status=active')).json()).sessions[0];
  expect(saved.items[0].results[0].measurements).toEqual({
    mode: 'weighted',
    reps: 0,
    loadKg: null,
  });
  expect(saved.items[1].results).toEqual([]);
  await area.getByText('Finish this workout', { exact: true }).click();
  await area.getByRole('button', { name: 'Finish and save workout' }).click();
  await expect(area.locator('.session-heading')).toContainText('completed');
  const persisted = (await (await page.request.get(`/api/sessions/${saved.id}`)).json()).session;
  expect(persisted.status).toBe('completed');
  expect(persisted.items[1].results).toEqual([]);
  expect(persisted.items[1].status).toBe('planned');
});
