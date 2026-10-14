import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { TaskSchema, defaultPreferences, type AttentionResponse } from '@mems-life/domain';

// This suite verifies browser interaction and layout with fictional projection data.
// It does not establish database, device, or notification-provider correctness.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = '2026-10-12T12:00:00Z';
const task = TaskSchema.parse({
  id: id(1),
  revision: 2,
  phase: 'next',
  content: { title: 'Fictional due task', description: '', notes: '' },
  schedule: { dueAt: now },
  order: 0,
  createdAt: now,
  updatedAt: now,
  completedAt: null,
  archivedAt: null,
  deletedAt: null,
});
const day: AttentionResponse = {
  now,
  timezone: 'UTC',
  date: '2026-10-12',
  items: [
    {
      id: 'due:1',
      sourceId: task.id,
      sourceRevision: 2,
      kind: 'due',
      task,
      step: null,
      waitingReason: null,
      route: { kind: 'task', id: task.id },
      dedupeKey: 'due:1:2',
    },
    {
      id: 'review:2',
      sourceId: id(2),
      sourceRevision: 1,
      kind: 'review',
      task,
      step: null,
      waitingReason: 'review_result',
      route: { kind: 'task', id: task.id },
      dedupeKey: 'review:2:1',
    },
    {
      id: 'waiting:3',
      sourceId: task.id,
      sourceRevision: 2,
      kind: 'waiting',
      task,
      step: null,
      waitingReason: 'agent',
      route: { kind: 'task', id: task.id },
      dedupeKey: 'waiting:3:2',
    },
    {
      id: 'failure:4',
      sourceId: task.id,
      sourceRevision: 2,
      kind: 'failure',
      task,
      step: null,
      waitingReason: 'agent_failed',
      route: { kind: 'task', id: task.id },
      dedupeKey: 'failure:4:2',
    },
    {
      id: 'unknown:5',
      sourceId: task.id,
      sourceRevision: 2,
      kind: 'outcome-unknown',
      task,
      step: null,
      waitingReason: 'reconcile_agent_outcome',
      route: { kind: 'task', id: task.id },
      dedupeKey: 'unknown:5:2',
    },
  ],
  activeSession: {
    id: id(3),
    revision: 1,
    name: 'Fictional training',
    notes: '',
    status: 'active',
    sourceRoutineId: null,
    sourceRoutineRevision: null,
    items: [],
    supersets: [],
    timer: null,
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
  },
  food: {
    count: 1,
    route: '/food',
    entries: [
      {
        id: id(4),
        revision: 1,
        content: { text: 'Fictional lunch', occurredAt: now, timezone: 'UTC' },
        photoIds: [],
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    ],
  },
};

test('fictional daily focus adapts across phone, tablet rotation, compact split view and web', async ({
  page,
}, testInfo) => {
  let fail = false;
  let empty = false;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const user = {
      id: 'fictional-owner',
      name: 'Fictional owner',
      email: 'fictional@example.test',
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    };
    if (path === '/api/auth/get-session')
      return route.fulfill({
        json: {
          user,
          session: {
            id: 'fictional-session',
            userId: user.id,
            token: 'fixture',
            expiresAt: '2099-01-01T00:00:00Z',
            createdAt: now,
            updatedAt: now,
          },
        },
      });
    if (path === '/api/me')
      return route.fulfill({
        json: {
          user: { id: user.id, name: user.name, email: user.email },
          installationId: 'fictional-installation',
        },
      });
    if (path === '/api/preferences')
      return route.fulfill({
        json: {
          revision: 1,
          value: defaultPreferences({ name: 'A long fictional name '.repeat(12), timeZone: 'UTC' }),
        },
      });
    if (path === '/api/attention')
      return route.fulfill(
        fail
          ? {
              status: 503,
              json: { error: { code: 'offline', message: 'Connection interrupted.' } },
            }
          : {
              json: empty
                ? {
                    ...day,
                    items: [],
                    activeSession: null,
                    food: { count: 0, entries: [], route: '/food' },
                  }
                : day,
            },
      );
    return route.fulfill({
      status: 503,
      json: {
        error: {
          code: 'fixture',
          message: 'Dedicated domain view is outside this projection fixture.',
        },
      },
    });
  });
  await page.goto('/#today');
  await expect(page.locator('#today-heading')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Food today · 1', exact: true })).toBeVisible();
  for (const [label, width, height] of [
    ['phone', 390, 844],
    ['compact-tablet', 600, 800],
    ['tablet-portrait', 834, 1194],
    ['tablet-landscape', 1194, 834],
    ['web', 1440, 900],
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect(page.getByRole('button', { name: 'Capture a task', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resume workout', exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${label}.png`), fullPage: true });
  }
  await expect(
    page.getByRole('button', { name: 'Waiting: Fictional due task', exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Agent needs help: Fictional due task', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Outcome needs checking: Fictional due task', exact: true }),
  ).toBeVisible();
  await page.locator('.today-waiting summary').click();
  await expect(
    page.getByRole('button', { name: 'Waiting: Fictional due task', exact: true }),
  ).toBeVisible();
  await page.locator('.today-waiting summary').click();
  await expect(page.getByRole('button', { name: 'Resume workout', exact: true })).toHaveCount(1);
  const review = page.getByRole('button', {
    name: 'Review needed: Fictional due task',
    exact: true,
  });
  await expect(review).toContainText('Review the agent result.');
  await review.focus();
  await expect(review).toBeFocused();
  await expect(page.locator('.today-detail, .today-next, .today-greeting')).toHaveCount(0);
  fail = true;
  await page.getByRole('button', { name: 'Refresh Today', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Connection interrupted.');
  await expect(page.getByRole('alert')).toContainText('last confirmed view');
  await expect(page.getByRole('button', { name: 'Resume workout', exact: true })).toBeVisible();
  fail = false;
  empty = true;
  await page.getByRole('button', { name: 'Retry Today', exact: true }).click();
  await expect(page.getByText('Nothing needs your attention.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start workout', exact: true })).toBeVisible();
});

test('live PostgreSQL day reaches its exact task, workout and food records', async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.TODAY_LIVE_WORKOUT_PROOF !== '1',
    'Coordinator grants an exclusive fictional-owner window after native cleanup.',
  );
  const email = process.env.WEB_TEST_EMAIL,
    password = process.env.WEB_TEST_PASSWORD;
  expect(email, 'Disposable owner credentials required').toBeTruthy();
  expect(password, 'Disposable owner credentials required').toBeTruthy();
  const origin = new URL(process.env.WEB_TEST_URL ?? 'http://127.0.0.1:5173').origin;
  const ownedTasks = new Set<string>();
  const cleanup: Record<string, unknown> = {};
  const retain = async (name: string, value: unknown) => {
    const path = testInfo.outputPath(`${name}.json`);
    await writeFile(path, JSON.stringify(value, null, 2));
    await testInfo.attach(name, { path, contentType: 'application/json' });
  };
  const sessionId = crypto.randomUUID(),
    foodId = crypto.randomUUID();
  let started = false,
    foodCreated = false;
  const post = async (area: string, command: Record<string, unknown>) => {
    const response = await page.request.post(`/api/${area}/commands`, {
      headers: { Origin: origin },
      data: { operationId: crypto.randomUUID(), ...command },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  await page.goto('/');
  await page.getByLabel('Email address').fill(email!);
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('#today-heading')).toBeVisible();
  const sessions = await page.request.get('/api/sessions?status=active');
  expect(sessions.ok()).toBeTruthy();
  expect(
    (await sessions.json()).sessions,
    'Existing workouts must finish before this proof',
  ).toHaveLength(0);
  const suffix = crypto.randomUUID().slice(0, 8),
    instant = new Date().toISOString();
  try {
    const dueId = crypto.randomUUID();
    ownedTasks.add(dueId);
    const { task: captured } = await post('tasks', {
      type: 'task.create',
      taskId: dueId,
      expectedRevision: 0,
      content: { title: `Fictional due ${suffix}`, description: 'Today proof fixture', notes: '' },
    });
    const { task: moved } = await post('tasks', {
      type: 'task.move',
      taskId: dueId,
      expectedRevision: captured.revision,
      phase: 'next',
      beforeTaskId: null,
    });
    await post('tasks', {
      type: 'task.schedule',
      taskId: dueId,
      expectedRevision: moved.revision,
      dueAt: instant,
      scheduledAt: null,
    });
    const agentId = crypto.randomUUID();
    ownedTasks.add(agentId);
    const { task: agent } = await post('tasks', {
      type: 'task.create',
      taskId: agentId,
      expectedRevision: 0,
      content: {
        title: `Fictional handoff ${suffix}`,
        description: 'External agent waiting fixture',
        notes: '',
      },
    });
    const { task: released } = await post('tasks', {
      type: 'task.move',
      taskId: agentId,
      expectedRevision: agent.revision,
      phase: 'next',
      beforeTaskId: null,
    });
    await post('steps', {
      type: 'step.create',
      taskId: agentId,
      id: crypto.randomUUID(),
      expectedRevision: 0,
      expectedTaskRevision: released.revision,
      content: {
        title: `Fictional agent step ${suffix}`,
        instructions: 'Fictional work only',
        responsibility: 'agent',
        required: true,
        dependencies: [],
        order: 0,
      },
    });
    started = true;
    await post('sessions', {
      type: 'session.start',
      sessionId,
      expectedRevision: 0,
      name: `Fictional workout ${suffix}`,
      routineId: null,
      expectedRoutineRevision: null,
    });
    foodCreated = true;
    await post('food', {
      type: 'food.create',
      entryId: foodId,
      expectedRevision: 0,
      content: { text: `Fictional lunch ${suffix}`, occurredAt: instant, timezone: 'UTC' },
    });
    await page.getByRole('button', { name: 'Refresh Today', exact: true }).click();
    await expect(page.locator('.today-focus > .today-list')).toContainText(
      `Fictional due ${suffix}`,
    );
    await page.locator('.today-waiting summary').click();
    await expect(page.locator('.today-waiting')).toContainText(`Fictional agent step ${suffix}`);
    await expect(page.locator('.today-waiting')).toContainText('Waiting for an agent.');
    const response = await page.request.get('/api/attention');
    expect(response.ok()).toBeTruthy();
    const projection = await response.json();
    expect(projection.activeSession.id).toBe(sessionId);
    expect(projection.food.entries.some((entry: { id: string }) => entry.id === foodId)).toBe(true);
    await retain('owned-records', { taskIds: [...ownedTasks], sessionId, foodId });
    for (const [label, width, height] of [
      ['phone', 390, 844],
      ['compact-tablet', 600, 800],
      ['tablet-portrait', 834, 1194],
      ['tablet-landscape', 1194, 834],
      ['web', 1440, 900],
    ] as const) {
      await page.setViewportSize({ width, height });
      await expect(
        page.getByRole('button', { name: `Due now: Fictional due ${suffix}`, exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Resume workout', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: testInfo.outputPath(`live-today-${label}.png`),
        fullPage: true,
      });
    }
    await retain('live-projection', projection);
    const taskOpened = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/tasks/${dueId}` &&
        response.request().method() === 'GET',
    );
    await page
      .getByRole('button', { name: `Due now: Fictional due ${suffix}`, exact: true })
      .click();
    const taskResponse = await taskOpened;
    expect(taskResponse.ok()).toBeTruthy();
    expect((await taskResponse.json()).task.id).toBe(dueId);
    const taskDialog = page.getByRole('dialog', { name: `Fictional due ${suffix}`, exact: true });
    await expect(
      taskDialog.getByRole('heading', { name: `Fictional due ${suffix}`, exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('live-task.png'), fullPage: true });
    await page.goto('/#today');
    await page.getByRole('button', { name: 'Resume workout', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: `Fictional workout ${suffix}`, exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('live-workout.png'), fullPage: true });
    await page.goto('/#today');
    await page
      .locator('.today-food button')
      .filter({ hasText: `Fictional lunch ${suffix}` })
      .click();
    await expect(page.getByRole('heading', { name: 'Edit entry', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'What did you eat?', exact: true })).toHaveValue(
      `Fictional lunch ${suffix}`,
    );
    await page.screenshot({ path: testInfo.outputPath('live-food.png'), fullPage: true });
  } finally {
    if (started) {
      const response = await page.request.get(`/api/sessions/${sessionId}`);
      if (response.ok()) {
        const { session } = await response.json();
        if (session.status === 'active')
          await post('sessions', {
            type: 'session.abandon',
            sessionId,
            expectedRevision: session.revision,
          });
        const confirmed = await page.request.get(`/api/sessions/${sessionId}`);
        expect(confirmed.ok()).toBeTruthy();
        const { session: finalSession } = await confirmed.json();
        expect(finalSession.id).toBe(sessionId);
        expect(finalSession.status).toBe('abandoned');
        cleanup.session = {
          id: finalSession.id,
          revision: finalSession.revision,
          status: finalSession.status,
        };
      }
    }
    if (foodCreated) {
      const response = await page.request.get('/api/food');
      if (response.ok()) {
        const entry = (await response.json()).entries.find(
          (value: { id: string }) => value.id === foodId,
        );
        if (entry) {
          const result = await post('food', {
            type: 'food.delete',
            entryId: foodId,
            expectedRevision: entry.revision,
          });
          expect(result.entry.id).toBe(foodId);
          expect(result.entry.deletedAt).toBeTruthy();
          cleanup.food = {
            id: result.entry.id,
            revision: result.entry.revision,
            deletedAt: result.entry.deletedAt,
          };
        }
      }
    }
    for (const id of ownedTasks) {
      const response = await page.request.get(`/api/tasks/${id}`);
      if (response.status() === 404) continue;
      expect(response.ok()).toBeTruthy();
      const { task } = await response.json();
      expect(task.id).toBe(id);
      if (!task.deletedAt) {
        const result = await post('tasks', {
          type: 'task.delete',
          taskId: task.id,
          expectedRevision: task.revision,
        });
        expect(result.task.id).toBe(task.id);
        expect(result.task.deletedAt).toBeTruthy();
        const fresh = await page.request.get(`/api/tasks/${task.id}`);
        expect(fresh.ok()).toBeTruthy();
        const { task: finalTask } = await fresh.json();
        expect(finalTask.deletedAt).toBeTruthy();
        cleanup[task.id] = {
          id: finalTask.id,
          revision: finalTask.revision,
          deletedAt: finalTask.deletedAt,
        };
      }
    }
    const remaining = await page.request.get('/api/food');
    expect(remaining.ok()).toBeTruthy();
    expect(
      (await remaining.json()).entries.some((entry: { id: string }) => entry.id === foodId),
    ).toBe(false);
    await retain('cleanup-confirmed', cleanup);
  }
});
