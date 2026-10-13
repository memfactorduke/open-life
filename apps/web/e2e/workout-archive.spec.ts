import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const email = process.env.WEB_TEST_EMAIL;
const password = process.env.WEB_TEST_PASSWORD;
const origin = new URL(process.env.WEB_TEST_URL ?? 'http://127.0.0.1:5173').origin;
const records: { kind: 'exercise' | 'routine'; id: string }[] = [];
async function command(page: Page, kind: string, data: object) {
  const response = await page.request.post(`/api/${kind}s/commands`, {
    headers: { Origin: origin },
    data: { operationId: crypto.randomUUID(), ...data },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json())[kind];
}
test.beforeEach(async ({ page }) => {
  records.length = 0;
  test.skip(!email || !password, 'Needs disposable installation credentials.');
  await page.goto('/');
  await page.getByLabel('Email address').fill(email!);
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
});
test.afterEach(async ({ page }) => {
  for (const { kind, id } of records.reverse()) {
    const list = (await (await page.request.get(`/api/${kind}s`)).json())[`${kind}s`];
    const record = list.find((item: { id: string }) => item.id === id);
    if (record)
      await command(page, kind, {
        type: `${kind}.archive`,
        [`${kind}Id`]: id,
        expectedRevision: record.revision,
      });
  }
});

test('recover archived exercises and routines after reload, preserving zero reps targets', async ({
  page,
}) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const exercise = await command(page, 'exercise', {
    type: 'exercise.create',
    exerciseId: crypto.randomUUID(),
    expectedRevision: 0,
    content: {
      name: `Fictional archive press ${suffix}`,
      mode: 'weighted',
      supportsLoad: true,
      notes: '',
    },
  });
  records.push({ kind: 'exercise', id: exercise.id });
  const routine = await command(page, 'routine', {
    type: 'routine.create',
    routineId: crypto.randomUUID(),
    expectedRevision: 0,
    content: {
      name: `Fictional archive routine ${suffix}`,
      notes: '',
      items: [
        {
          id: crypto.randomUUID(),
          exerciseId: exercise.id,
          snapshot: {
            name: exercise.name,
            mode: exercise.mode,
            supportsLoad: exercise.supportsLoad,
          },
          notes: '',
          targets: [
            {
              id: crypto.randomUUID(),
              kind: 'working',
              measurements: { mode: 'weighted', reps: 0, loadKg: null },
              notes: '',
            },
          ],
        },
      ],
    },
  });
  records.push({ kind: 'routine', id: routine.id });
  await page.goto('/#workouts');
  const routineCard = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: routine.name, exact: true }) });
  await routineCard.getByRole('button', { name: 'Edit routine', exact: true }).click();
  await expect(page.getByLabel('Repetitions', { exact: true })).toHaveValue('0');
  expect(
    await page
      .getByLabel('Repetitions', { exact: true })
      .evaluate((node: HTMLInputElement) => node.checkValidity()),
  ).toBeTruthy();
  await page.getByLabel('Notes', { exact: true }).fill('Zero reps retained in web editing.');
  await page.getByRole('button', { name: 'Save routine', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await routineCard.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(routineCard).toHaveCount(0);
  await page.getByRole('button', { name: 'Exercise library', exact: true }).click();
  const exerciseCard = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: exercise.name, exact: true }) });
  await exerciseCard.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(exerciseCard).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Exercise library', exact: true }).click();
  await page.getByLabel('Show archived exercises').check();
  await expect(exerciseCard).toBeVisible();
  await exerciseCard.getByRole('button', { name: 'Unarchive', exact: true }).click();
  await expect(exerciseCard).toHaveCount(0);
  await page.getByLabel('Show archived exercises').uncheck();
  await expect(exerciseCard).toBeVisible();
  await page.getByRole('button', { name: 'Routines', exact: true }).click();
  await page.getByLabel('Show archived routines').check();
  await expect(routineCard).toBeVisible();
  await routineCard.getByRole('button', { name: 'Unarchive', exact: true }).click();
  await expect(routineCard).toHaveCount(0);
  await page.getByLabel('Show archived routines').uncheck();
  await expect(routineCard).toBeVisible();
  await page.reload();
  await expect(routineCard).toBeVisible();
  const persisted = (await (await page.request.get(`/api/routines/${routine.id}`)).json()).routine;
  expect(persisted.revision).toBe(4);
  expect(persisted.archivedAt).toBeNull();
  expect(persisted.items[0].targets[0].measurements.reps).toBe(0);
  expect(persisted.notes).toBe('Zero reps retained in web editing.');
  const exercises = (await (await page.request.get('/api/exercises')).json()).exercises;
  expect(exercises.find((item: { id: string }) => item.id === exercise.id)).toMatchObject({
    revision: 3,
    archivedAt: null,
  });
  const evidencePath = test.info().outputPath('persisted-recovered-records.json');
  await writeFile(
    evidencePath,
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        routine: persisted,
        exercise: exercises.find((item: { id: string }) => item.id === exercise.id),
      },
      null,
      2,
    ),
  );
  await test.info().attach('persisted-recovered-records', {
    path: evidencePath,
    contentType: 'application/json',
  });
  await page.screenshot({ path: test.info().outputPath('recovered-library.png'), fullPage: true });
});
