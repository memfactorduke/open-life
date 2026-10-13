import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const email = process.env.WEB_TEST_EMAIL;
const password = process.env.WEB_TEST_PASSWORD;
const origin = new URL(process.env.WEB_TEST_URL ?? 'http://127.0.0.1:5173').origin;
const owned = new Set<string>();

test.beforeEach(async ({ page }) => {
  test.skip(!email || !password, 'Requires fictional owner credentials and live PostgreSQL.');
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
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await page.goto('/#food');
  await expect(page.getByRole('heading', { name: 'Food diary', exact: true })).toBeVisible();
});

test.afterEach(async ({ page }) => {
  if (!email || !password || !owned.size) return;
  // Only soft-delete the unique records this test created, including interrupted journeys.
  const response = await page.request.get('/api/food');
  expect(response.ok()).toBeTruthy();
  for (const entry of (await response.json()).entries) {
    if (!owned.has(entry.id)) continue;
    const deleted = await page.request.post('/api/food/commands', {
      headers: { Origin: origin },
      data: {
        type: 'food.delete',
        operationId: crypto.randomUUID(),
        entryId: entry.id,
        expectedRevision: entry.revision,
      },
    });
    expect(deleted.ok(), await deleted.text()).toBeTruthy();
  }
});

test('private two-photo diary persists and exact retries recover committed allocation and finalization losses', async ({
  page,
  playwright,
}, testInfo) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 390, height: 844 });
  const name = `Fictional meal ${crypto.randomUUID().slice(0, 8)}`;
  const png = await sharp({ create: { width: 24, height: 24, channels: 3, background: '#db9d47' } })
    .png()
    .toBuffer();
  const jpeg = await sharp({
    create: { width: 24, height: 24, channels: 3, background: '#649a60' },
  })
    .jpeg()
    .toBuffer();
  const commands: Record<string, unknown>[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/food/commands'))
      commands.push(request.postDataJSON());
  });
  await page.getByRole('textbox', { name: 'Notes', exact: true }).fill(name);
  await page.getByLabel('Date and time', { exact: true }).fill('2026-09-15T12:30');
  await page.getByLabel('Daily history', { exact: true }).fill('2026-09-15');
  await page.getByLabel('Add private photos', { exact: false }).setInputFiles([
    { name: 'fictional-meal.png', mimeType: 'image/png', buffer: png },
    { name: 'fictional-meal.jpeg', mimeType: 'image/jpeg', buffer: jpeg },
  ]);
  await page.screenshot({ path: testInfo.outputPath('phone-draft.png'), fullPage: true });
  const allocations: string[] = [];
  const allocationIds: string[] = [];
  let loseAllocation = true;
  await page.route('**/api/food/*/uploads', async (route) => {
    allocations.push(route.request().postData()!);
    const response = await route.fetch();
    expect(response.ok(), await response.text()).toBeTruthy();
    allocationIds.push((await response.json()).upload.id);
    if (loseAllocation) {
      loseAllocation = false;
      await route.abort('failed');
    } else await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Save entry', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(
    'Your text and remaining photos are retained here.',
  );
  await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue(name);
  await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toBeDisabled();
  await expect(page.getByText('2 photos waiting to upload.', { exact: false })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('phone-allocation-response-lost.png'),
    fullPage: true,
  });
  const finalizations: string[] = [];
  let loseFinalize = true;
  await page.route('**/api/media/*/finalize', async (route) => {
    finalizations.push(route.request().postData()!);
    const response = await route.fetch();
    expect(response.ok(), await response.text()).toBeTruthy();
    if (loseFinalize) {
      loseFinalize = false;
      await route.abort('failed');
    } else await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Save entry', exact: true }).click();
  await expect.poll(() => finalizations.length).toBe(1);
  await expect(page.getByRole('status')).toContainText(
    'Your text and remaining photos are retained here.',
  );
  expect(allocations[1]).toBe(allocations[0]);
  expect(allocationIds[1]).toBe(allocationIds[0]);
  await expect(page.getByLabel('Date and time', { exact: true })).toHaveValue('2026-09-15T12:30');
  await expect(page.getByRole('button', { name: 'New entry', exact: true })).toBeDisabled();
  await page.screenshot({
    path: testInfo.outputPath('phone-finalize-response-lost.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Save entry', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Food entry saved.');
  expect(finalizations[1]).toBe(finalizations[0]);
  expect(commands.map((command) => command.type)).toEqual(['food.create']);
  expect(allocations).toHaveLength(3);
  expect(finalizations).toHaveLength(3);
  const list = await page.request.get('/api/food?date=2026-09-15&timezone=America%2FNew_York');
  expect(list.ok()).toBeTruthy();
  const entry = (await list.json()).entries.find(
    (value: { content: { text: string } }) => value.content.text === name,
  );
  expect(entry).toBeTruthy();
  expect(entry.photoIds).toHaveLength(2);
  expect(new Set(entry.photoIds).size).toBe(2);
  expect(entry.revision).toBe(3);
  expect(entry.content.timezone).toBe('America/New_York');
  expect(entry.content.occurredAt).toBe('2026-09-15T16:30:00.000Z');
  const [firstId, secondId] = entry.photoIds;
  const photo = await page.request.get(`/api/media/${firstId}`);
  expect(photo.status()).toBe(200);
  expect(await photo.body()).toEqual(png);
  expect(photo.headers()['cache-control']).toContain('no-store');
  expect(photo.headers()['content-type']).toContain('image/png');
  expect(await (await page.request.get(`/api/media/${secondId}`)).body()).toEqual(jpeg);
  const anonymous = await playwright.request.newContext({ baseURL: origin });
  expect((await anonymous.get(`/api/media/${firstId}`)).status()).toBe(401);
  const copied = await anonymous.get(`/media/files/${firstId}`);
  expect(copied.headers()['content-type'] ?? '').not.toContain('image/');
  expect(await copied.body()).not.toEqual(png);
  const traversal = await page.request.get('/api/media/%2e%2e%2ffiles%2f' + firstId);
  expect(traversal.status()).toBeGreaterThanOrEqual(400);
  expect(await traversal.body()).not.toEqual(png);
  await anonymous.dispose();
  await page.reload();
  await page.getByLabel('Daily history', { exact: true }).fill('2026-09-15');
  const card = page.getByRole('article').filter({ has: page.getByText(name, { exact: true }) });
  await expect(card.getByRole('img', { name: 'Private food diary photo' })).toHaveCount(2);
  await expect
    .poll(() =>
      card
        .getByRole('img')
        .evaluateAll((images) =>
          images.every(
            (image) =>
              (image as HTMLImageElement).complete &&
              (image as HTMLImageElement).naturalWidth === 24,
          ),
        ),
    )
    .toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('phone-saved.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('textbox', { name: 'Notes', exact: true }).fill(`${name} corrected`);
  await page.getByLabel('Date and time', { exact: true }).fill('2026-09-15T13:45');
  await page.getByRole('button', { name: 'Save entry', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Food entry saved.');
  const corrected = page
    .getByRole('article')
    .filter({ has: page.getByText(`${name} corrected`, { exact: true }) });
  await expect(corrected).toBeVisible();
  await corrected.getByRole('button', { name: 'Remove photo', exact: true }).first().click();
  await expect(corrected.getByRole('img')).toHaveCount(1);
  expect((await page.request.get(`/api/media/${firstId}`)).status()).toBe(404);
  await corrected.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Entry history', exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('desktop-corrected-history.png'),
    fullPage: true,
  });
  const historyResponse = await page.request.get(`/api/food/${entry.id}/history`);
  const history = await historyResponse.json();
  expect(history.events.map((event: { type: string }) => event.type)).toEqual([
    'food.detach',
    'food.edit',
    'food.photo.finalize',
    'food.photo.finalize',
    'food.create',
  ]);
  expect(history.events[0].entry.id).toBe(entry.id);
  expect(history.events[0].entry.revision).toBe(5);
  expect(history.events[0].entry.content.occurredAt).toBe('2026-09-15T17:45:00.000Z');
  expect(
    history.events.every(
      (event: { actorType: string; actorId: string }) =>
        event.actorType === 'owner' && !!event.actorId,
    ),
  ).toBe(true);
  page.once('dialog', (dialog) => dialog.accept());
  await corrected.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(corrected).toHaveCount(0);
  expect((await page.request.get(`/api/media/${secondId}`)).status()).toBe(404);
  const deletedHistory = await (await page.request.get(`/api/food/${entry.id}/history`)).json();
  expect(deletedHistory.events[0].type).toBe('food.delete');
  expect(deletedHistory.events[0].entry.deletedAt).toBeTruthy();
  expect(deletedHistory.events[0].entry.revision).toBe(6);
  const deletedUpload = await page.request.post(`/api/food/${entry.id}/uploads`, {
    headers: { Origin: origin },
    data: {
      operationId: crypto.randomUUID(),
      expectedRevision: 6,
      size: png.length,
      sha256: createHash('sha256').update(png).digest('hex'),
      contentType: 'image/png',
    },
  });
  expect(deletedUpload.status()).toBe(409);
  expect((await deletedUpload.json()).error.code).toBe('DELETED');
  const evidencePath = testInfo.outputPath('persisted-food-history.json');
  await writeFile(
    evidencePath,
    JSON.stringify(
      {
        entry,
        history,
        deletedHistory,
        allocationIds,
        allocations,
        finalizations,
        commands,
        protectedPhoto: {
          cacheControl: photo.headers()['cache-control'],
          contentType: photo.headers()['content-type'],
          byteLength: png.length,
        },
      },
      null,
      2,
    ),
  );
  await testInfo.attach('persisted-food-history', {
    path: evidencePath,
    contentType: 'application/json',
  });
});
