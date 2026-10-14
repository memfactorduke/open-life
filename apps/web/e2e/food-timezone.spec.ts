import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const email = process.env.WEB_TEST_EMAIL;
const password = process.env.WEB_TEST_PASSWORD;
const origin = new URL(process.env.WEB_TEST_URL ?? 'http://127.0.0.1:5173').origin;

test.use({ timezoneId: 'America/New_York' });

for (const scenario of [
  {
    zone: 'Asia/Tokyo',
    wallTime: '2026-10-13T00:30',
    instant: '2026-10-12T15:30:00Z',
    livePreferences: true,
  },
  {
    zone: 'America/New_York',
    wallTime: '2026-03-08T02:30',
    instant: '2026-03-08T07:30:00Z',
    livePreferences: false,
  },
  {
    zone: 'America/New_York',
    wallTime: '2026-11-01T01:30',
    instant: '2026-11-01T05:30:00Z',
    livePreferences: false,
  },
]) {
  test(`food uses owner ${scenario.zone} for ${scenario.wallTime}`, async ({ page }, testInfo) => {
    test.skip(!email || !password, 'Requires the synthetic owner and PostgreSQL.');
    const owned = new Set<string>();
    const commands: Record<string, unknown>[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/api/food/commands')) {
        const body = request.postDataJSON();
        commands.push(body);
        if (body.type === 'food.create') owned.add(body.entryId);
      }
    });
    await page.clock.setFixedTime(new Date('2026-10-13T03:00:00Z'));
    if (!scenario.livePreferences)
      await page.route('**/api/preferences', async (route) => {
        const response = await route.fetch();
        const record = await response.json();
        await route.fulfill({
          response,
          json: { ...record, value: { ...record.value, timeZone: scenario.zone } },
        });
      });
    await page.goto('/');
    await page.getByLabel('Email address').fill(email!);
    await page.getByLabel('Password', { exact: true }).fill(password!);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.locator('#today-heading')).toBeVisible();
    let originalPreferences: { revision: number; value: Record<string, unknown> } | undefined;
    if (scenario.livePreferences) {
      originalPreferences = await (await page.request.get('/api/preferences')).json();
      const saved = await page.request.put('/api/preferences', {
        headers: { Origin: origin },
        data: {
          operationId: crypto.randomUUID(),
          expectedRevision: originalPreferences!.revision,
          value: { ...originalPreferences!.value, timeZone: scenario.zone },
        },
      });
      expect(saved.ok(), await saved.text()).toBeTruthy();
      await page.reload();
      const preferences = await (await page.request.get('/api/preferences')).json();
      expect(preferences.value.timeZone).toBe(scenario.zone);
    }
    await page.goto('/#food');
    try {
      await expect(page.locator('.food').getByText(scenario.zone, { exact: true })).toBeVisible();
      if (scenario.livePreferences) {
        await expect(page.getByLabel('Daily history', { exact: true })).toHaveValue('2026-10-13');
        await expect(page.getByLabel('Date and time', { exact: true })).toHaveValue(
          '2026-10-13T12:00',
        );
      }
      const name = `Fictional owner-zone meal ${crypto.randomUUID()}`;
      await page.getByRole('textbox', { name: 'Notes', exact: true }).fill(name);
      await page.getByLabel('Date and time', { exact: true }).fill(scenario.wallTime);
      await page.getByLabel('Daily history', { exact: true }).fill(scenario.wallTime.slice(0, 10));
      await page.getByRole('button', { name: 'Save entry', exact: true }).click();
      await expect(page.getByRole('status')).toHaveText('Food entry saved.');
      const entries = (await (await page.request.get('/api/food')).json()).entries;
      const entry = entries.find((candidate: { id: string }) => owned.has(candidate.id));
      expect(entry.content.timezone).toBe(scenario.zone);
      expect(new Date(entry.content.occurredAt).toISOString()).toBe(
        new Date(scenario.instant).toISOString(),
      );
      const card = page.locator('.food article').filter({ hasText: name });
      await expect(card).toHaveCount(1);
      await expect(card.locator('time')).toHaveText(
        new Date(scenario.instant).toLocaleString('en-US', { timeZone: scenario.zone }),
      );
      await card.getByRole('button', { name: 'Edit', exact: true }).click();
      const correctedWallTime =
        scenario.wallTime === '2026-03-08T02:30' ? '2026-03-08T03:30' : scenario.wallTime;
      await expect(page.getByLabel('Date and time', { exact: true })).toHaveValue(
        correctedWallTime,
      );
      await page.getByRole('textbox', { name: 'Notes', exact: true }).fill(`${name} corrected`);
      await page.getByRole('button', { name: 'Save entry', exact: true }).click();
      await expect(page.getByRole('status')).toHaveText('Food entry saved.');
      const afterEdit = (await (await page.request.get('/api/food')).json()).entries.find(
        (candidate: { id: string }) => candidate.id === entry.id,
      );
      expect(afterEdit.content.text).toBe(`${name} corrected`);
      expect(afterEdit.content.occurredAt).toBe(entry.content.occurredAt);
      expect(afterEdit.content.timezone).toBe(scenario.zone);
      await writeFile(
        testInfo.outputPath('persisted-timezone.json'),
        JSON.stringify({ scenario, entry, afterEdit, commands }, null, 2),
      );
      await page.screenshot({ path: testInfo.outputPath('owner-timezone.png'), fullPage: true });
    } finally {
      const list = await page.request.get('/api/food');
      expect(list.ok()).toBeTruthy();
      for (const entry of (await list.json()).entries) {
        if (!owned.has(entry.id)) continue;
        const deletion = await page.request.post('/api/food/commands', {
          headers: { Origin: origin },
          data: {
            type: 'food.delete',
            entryId: entry.id,
            expectedRevision: entry.revision,
            operationId: crypto.randomUUID(),
          },
        });
        expect(deletion.ok(), await deletion.text()).toBeTruthy();
      }
      const remaining = (await (await page.request.get('/api/food')).json()).entries;
      expect(remaining.filter((entry: { id: string }) => owned.has(entry.id))).toHaveLength(0);
      if (originalPreferences) {
        const current = await (await page.request.get('/api/preferences')).json();
        const restored = await page.request.put('/api/preferences', {
          headers: { Origin: origin },
          data: {
            operationId: crypto.randomUUID(),
            expectedRevision: current.revision,
            value: originalPreferences.value,
          },
        });
        expect(restored.ok(), await restored.text()).toBeTruthy();
      }
    }
  });
}
