import { expect, test } from '@playwright/test';

const email = process.env.WEB_TEST_EMAIL;
const password = process.env.WEB_TEST_PASSWORD;

test.beforeEach(async () => {
  test.skip(
    !email || !password,
    'Set WEB_TEST_EMAIL and WEB_TEST_PASSWORD for a disposable bootstrapped installation.',
  );
});

test('owner signs in, preferences survive reload, and signing out revokes access', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Email address').fill(email!);
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('link', { name: 'Profile', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible();
  const displayName = `Test owner ${test.info().project.name}`;
  await page.getByLabel('Display name').fill(displayName);
  await page.getByLabel('Time zone').fill('Europe/London');
  await page.getByLabel('Weight unit').selectOption('kg');
  await page.getByLabel('Distance unit').selectOption('km');
  await page.getByLabel('Appearance').selectOption('light');
  await page.goto('/#settings/account');
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeDisabled();
  await page.goto('/#settings/profile');
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page.getByRole('status')).toHaveText('Your preferences are saved.');
  await page.reload();
  await expect(page.getByLabel('Display name')).toHaveValue(displayName);
  await expect(page.getByLabel('Time zone')).toHaveValue('Europe/London');
  await expect(page.getByLabel('Weight unit')).toHaveValue('kg');
  await expect(page.getByLabel('Distance unit')).toHaveValue('km');
  await page.goto('/#settings/account');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  const me = await page.request.get('/api/me');
  expect(me.status()).toBe(401);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('a stale edit is preserved and requires review before overwriting another session', async ({
  page,
  browser,
}) => {
  await page.goto('/');
  await page.getByLabel('Email address').fill(email!);
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('link', { name: 'Profile', exact: true }).click();
  await page.getByLabel('Display name').fill('Unsaved local name');
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto(process.env.WEB_TEST_URL ?? 'http://127.0.0.1:5173');
  await otherPage.getByLabel('Email address').fill(email!);
  await otherPage.getByLabel('Password', { exact: true }).fill(password!);
  await otherPage.getByRole('button', { name: 'Sign in', exact: true }).click();
  await otherPage.getByRole('link', { name: 'Settings', exact: true }).click();
  await otherPage.getByRole('link', { name: 'Profile', exact: true }).click();
  await otherPage.getByLabel('Time zone').fill('Asia/Tokyo');
  await otherPage.getByRole('button', { name: 'Save preferences' }).click();
  await expect(otherPage.getByRole('status')).toHaveText('Your preferences are saved.');
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page.getByRole('alert')).toContainText('Preferences changed on another device.');
  await expect(page.getByLabel('Display name')).toHaveValue('Unsaved local name');
  await page.getByRole('button', { name: 'Reload saved preferences' }).click();
  await expect(page.getByRole('table')).toContainText('Asia/Tokyo');
  await page.getByRole('button', { name: 'Keep saved preferences' }).click();
  await expect(page.getByLabel('Time zone')).toHaveValue('Asia/Tokyo');
  await expect(page.getByRole('button', { name: 'Save preferences' })).toBeDisabled();
  await other.close();
});

test('invalid credentials are rejected without clearing the entered identity', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email address').fill(email!);
  await page.getByLabel('Password', { exact: true }).fill('incorrect-fictional-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('The email or password was not accepted.');
  await expect(page.getByLabel('Email address')).toHaveValue(email!);
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue(
    'incorrect-fictional-password',
  );
  expect((await page.request.get('/api/me')).status()).toBe(401);
});

test('a committed save with a lost response is reconciled before newer edits are saved', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Email address').fill(email!);
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('link', { name: 'Profile', exact: true }).click();
  await page.getByLabel('Display name').fill('Confirmed original save');
  await page.route('**/api/preferences', async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    expect(response.ok()).toBeTruthy();
    await route.abort('failed');
  });
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page.getByRole('alert')).toContainText(
    "The preference save is unconfirmed.",
  );
  await page.unroute('**/api/preferences');
  await page.getByLabel('Display name').fill('Newer unsaved edit');
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page.getByRole('status')).toContainText('Your previous save is confirmed.');
  await expect(page.getByLabel('Display name')).toHaveValue('Newer unsaved edit');
  const confirmed = await page.request.get('/api/preferences');
  expect((await confirmed.json()).value.displayName).toBe('Confirmed original save');
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page.getByRole('status')).toHaveText('Your preferences are saved.');
  await page.reload();
  await expect(page.getByLabel('Display name')).toHaveValue('Newer unsaved edit');
});

test('revoking a session preserves an unsaved edit through signing in again', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email address').fill(email!);
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('link', { name: 'Profile', exact: true }).click();
  await page.getByLabel('Display name').fill('Preserved after session ended');
  const origin = new URL(process.env.WEB_TEST_URL ?? 'http://127.0.0.1:5173').origin;
  const signedOut = await page.request.post('/api/auth/sign-out', {
    headers: { Origin: origin },
    data: {},
  });
  expect(signedOut.ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Your unsaved preferences are still here.');
  await page.getByLabel('Email address').fill(email!);
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('Display name')).toHaveValue('Preserved after session ended');
  await expect(page.getByRole('table')).toBeVisible();
  await page.getByRole('button', { name: 'Keep my reviewed edits' }).click();
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page.getByRole('status')).toHaveText('Your preferences are saved.');
});

test('settings separates daily preferences from account and connections', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email address').fill(email!);
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Display name')).toHaveCount(0);
  for (const name of ['Profile', 'Notifications', 'Connections', 'Account']) {
    await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  }
  await page.getByRole('link', { name: 'Profile', exact: true }).click();
  await page.getByLabel('Display name').fill('Draft retained through navigation');
  await page.getByRole('link', { name: '← Settings', exact: true }).click();
  await page.getByRole('link', { name: 'Account', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeDisabled();
  await page.getByRole('link', { name: '← Settings', exact: true }).click();
  await page.getByRole('link', { name: 'Profile', exact: true }).click();
  await expect(page.getByLabel('Display name')).toHaveValue('Draft retained through navigation');
});
