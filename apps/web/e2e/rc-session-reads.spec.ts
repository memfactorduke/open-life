import { expect, test } from '@playwright/test';
const email = process.env.WEB_TEST_EMAIL,
  password = process.env.WEB_TEST_PASSWORD;

test('delayed older performance and audit reads stay with their selected workout', async ({
  page,
}) => {
  test.skip(!email || !password, 'Requires fictional authentication fixture.');
  const timestamp = '2026-10-01T12:00:00.000Z';
  const exercise = (name: string) => ({
    id: crypto.randomUUID(),
    revision: 1,
    name,
    mode: 'weighted' as const,
    supportsLoad: true,
    notes: '',
    origin: 'custom' as const,
    archivedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const first = exercise('Fixture press'),
    second = exercise('Fixture row');
  const item = (exercise: typeof first) => ({
    id: crypto.randomUUID(),
    exerciseId: exercise.id,
    snapshot: { name: exercise.name, mode: exercise.mode, supportsLoad: true },
    targets: [],
    notes: '',
    status: 'planned',
    results: [],
    replacedItemId: null,
  });
  const firstItem = item(first),
    secondItem = item(second);
  const session = {
    id: crypto.randomUUID(),
    revision: 1,
    name: 'Fixture live workout',
    notes: '',
    status: 'active',
    sourceRoutineId: null,
    sourceRoutineRevision: null,
    items: [firstItem, secondItem],
    supersets: [],
    timer: null,
    startedAt: timestamp,
    updatedAt: timestamp,
    finishedAt: null,
  };
  const historySession = {
    ...session,
    id: crypto.randomUUID(),
    name: 'Fixture history workout',
    status: 'completed',
    finishedAt: timestamp,
    items: [],
  };
  const performance = {
    sessionId: crypto.randomUUID(),
    status: 'completed',
    startedAt: timestamp,
    items: [
      {
        ...firstItem,
        results: [
          {
            id: crypto.randomUUID(),
            kind: 'working',
            measurements: { mode: 'weighted', reps: 777, loadKg: 10 },
            notes: '',
            round: null,
            recordedAt: timestamp,
            correctedAt: null,
            removedAt: null,
          },
        ],
      },
    ],
    measuredWorkingVolumeKgReps: 7770,
  };
  let releasePerformance!: () => void, releaseAudit!: () => void;
  const heldPerformance = new Promise<void>((resolve) => {
    releasePerformance = resolve;
  });
  const heldAudit = new Promise<void>((resolve) => {
    releaseAudit = resolve;
  });
  let performanceStarted = false,
    auditStarted = false;
  await page.route('**/api/sessions**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/clock')) return route.fulfill({ json: { now: timestamp } });
    if (url.pathname.endsWith('/history')) {
      auditStarted = true;
      await heldAudit;
      return route.fulfill({
        json: {
          events: [
            {
              id: 'fixture-event',
              operationId: crypto.randomUUID(),
              actorId: 'fixture-owner',
              actorType: 'owner',
              reason: 'Old audit must stay with its workout',
              eventType: 'session.start',
              revision: 1,
              session,
              createdAt: timestamp,
            },
          ],
          nextCursor: null,
        },
      });
    }
    return route.fulfill({
      json: {
        sessions:
          url.searchParams.get('status') === 'active' ? [session] : [session, historySession],
        nextCursor: null,
      },
    });
  });
  await page.route('**/api/routines**', (route) => route.fulfill({ json: { routines: [] } }));
  await page.route('**/api/exercises**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/performance')) {
      if (url.searchParams.has('cursor')) {
        performanceStarted = true;
        await heldPerformance;
        return route.fulfill({ json: { performances: [performance], nextCursor: null } });
      }
      return route.fulfill({
        json: {
          performances: [],
          nextCursor: url.pathname.includes(first.id) ? crypto.randomUUID() : null,
        },
      });
    }
    return route.fulfill({ json: { exercises: [first, second] } });
  });
  await page.goto('/');
  await page.getByLabel('Email address').fill(email!);
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('#today-heading')).toBeVisible();
  await page.getByRole('link', { name: 'Workouts', exact: false }).click();
  await page.getByRole('button', { name: 'Workout', exact: true }).click();
  await page.getByText('Previous sets', { exact: true }).click();
  await page.getByRole('button', { name: 'Load older exercise performance', exact: true }).click();
  await expect.poll(() => performanceStarted).toBe(true);
  await page
    .getByRole('button', { name: 'Fixture row planned · 0 actual sets', exact: true })
    .click();
  const earlierResponse = page.waitForResponse((response) => response.url().includes('cursor='));
  releasePerformance();
  await earlierResponse;
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(page.locator('.previous-performance')).not.toContainText('777');
  await page.getByText('Notes and history', { exact: true }).click();
  await page.getByRole('button', { name: 'Show correction history', exact: true }).click();
  await expect.poll(() => auditStarted).toBe(true);
  await page.getByRole('button', { name: 'Workout history', exact: true }).click();
  await page
    .locator('.session-history-list button')
    .filter({ hasText: 'Fixture history workout' })
    .click();
  const auditResponse = page.waitForResponse((response) => response.url().endsWith('/history'));
  releaseAudit();
  await auditResponse;
  await page.getByText('Notes and history', { exact: true }).click();
  await expect(
    page.getByText('Old audit must stay with its workout', { exact: false }),
  ).toHaveCount(0);
});
