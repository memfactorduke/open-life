import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
const email = process.env.WEB_TEST_EMAIL;
const password = process.env.WEB_TEST_PASSWORD;
const origin = new URL(process.env.WEB_TEST_URL ?? 'http://127.0.0.1:5173').origin;
test('real service persists opt-in choices, retains a conflicting draft, and restores fixture choices', async ({
  page,
}) => {
  test.skip(!email || !password, 'Requires a disposable fictional installation.');
  await page.goto('/');
  await page.getByLabel('Email address').fill(email!);
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Settings', exact: false }).click();
  await page.getByRole('link', { name: 'Notifications', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Notifications', exact: true });
  await expect(panel.getByLabel('Enable notifications', { exact: false })).toBeVisible();
  const initial = await (await page.request.get('/api/notifications/preferences')).json();
  expect(initial.providerConfigured).toBe(false);
  try {
    await panel.getByRole('checkbox', { name: 'Enable notifications' }).check();
    await panel.getByRole('checkbox', { name: 'Due reminders' }).check();
    await panel.getByRole('checkbox', { name: 'Ready for you' }).uncheck();
    await panel.getByRole('checkbox', { name: 'Work needs help' }).uncheck();
    await panel.getByRole('button', { name: 'Save notification choices', exact: true }).click();
    await expect(panel.getByRole('status')).toHaveText('Notification choices saved.');
    await page.reload();
    await expect(panel.getByRole('checkbox', { name: 'Due reminders' })).toBeChecked();
    const current = await (await page.request.get('/api/notifications/preferences')).json();
    await panel.getByRole('checkbox', { name: 'Work needs help' }).check();
    const changed = await page.request.put('/api/notifications/preferences', {
      data: {
        operationId: randomUUID(),
        expectedRevision: current.revision,
        value: { ...current.value, due: false },
      },
      headers: { Origin: origin },
    });
    expect(changed.ok()).toBe(true);
    await panel.getByRole('button', { name: 'Save notification choices', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('These choices changed elsewhere');
    await expect(panel.getByRole('checkbox', { name: 'Due reminders' })).toBeChecked();
    await expect(panel.getByRole('checkbox', { name: 'Work needs help' })).toBeChecked();
    await panel.getByRole('button', { name: 'Save reviewed notification choices' }).click();
    await expect(panel.getByRole('status')).toHaveText('Notification choices saved.');
    const saved = await (await page.request.get('/api/notifications/preferences')).json();
    expect(saved.value).toEqual({ enabled: true, due: true, handoff: false, failure: true });
    await panel.screenshot({
      path: test.info().outputPath('notifications-settings.png'),
    });
  } finally {
    const latest = await (await page.request.get('/api/notifications/preferences')).json();
    const restored = await page.request.put('/api/notifications/preferences', {
      data: { operationId: randomUUID(), expectedRevision: latest.revision, value: initial.value },
      headers: { Origin: origin },
    });
    expect(restored.ok()).toBe(true);
    expect((await (await page.request.get('/api/notifications/preferences')).json()).value).toEqual(
      initial.value,
    );
  }
});

test('notification draft and unconfirmed request survive leaving Settings before exact retry', async ({
  page,
}) => {
  test.skip(!email || !password, 'Requires a disposable fictional installation.');
  await page.goto('/');
  await page.getByLabel('Email address').fill(email!);
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.goto('/#settings/notifications');
  const panel = page.getByRole('region', { name: 'Notifications', exact: true });
  await expect(panel.getByLabel('Enable notifications', { exact: false })).toBeVisible();
  const initial = await (await page.request.get('/api/notifications/preferences')).json();
  const writes: unknown[] = [];
  let fail = true;
  try {
    await panel.getByRole('checkbox', { name: 'Enable notifications' }).check();
    await panel.getByRole('checkbox', { name: 'Due reminders' }).check();
    await page.getByRole('link', { name: '← Settings', exact: true }).click();
    await page.getByRole('link', { name: 'Notifications', exact: true }).click();
    await expect(panel.getByRole('checkbox', { name: 'Due reminders' })).toBeChecked();
    await page.route('**/api/notifications/preferences', async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      writes.push(route.request().postDataJSON());
      if (fail) {
        fail = false;
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'UNAVAILABLE', message: 'Fictional connection interrupted' },
          }),
        });
      }
      return route.continue();
    });
    await panel.getByRole('button', { name: 'Save notification choices', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('The save is unconfirmed');
    await page.getByRole('link', { name: '← Settings', exact: true }).click();
    await page.getByRole('link', { name: 'Tasks', exact: true }).click();
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByRole('link', { name: 'Notifications', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('The save is unconfirmed');
    await expect(panel.getByRole('checkbox', { name: 'Due reminders' })).toBeChecked();
    await panel.getByRole('button', { name: 'Retry notification settings' }).click();
    await expect(panel.getByRole('status')).toHaveText('Notification choices saved.');
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(writes[0]);
  } finally {
    await page.unroute('**/api/notifications/preferences');
    const latest = await (await page.request.get('/api/notifications/preferences')).json();
    const restored = await page.request.put('/api/notifications/preferences', {
      headers: { Origin: origin },
      data: { operationId: randomUUID(), expectedRevision: latest.revision, value: initial.value },
    });
    expect(restored.ok()).toBe(true);
  }
});
