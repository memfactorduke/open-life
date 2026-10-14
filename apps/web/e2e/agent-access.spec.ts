import { expect, test } from '@playwright/test';
const email = process.env.WEB_TEST_EMAIL,
  password = process.env.WEB_TEST_PASSWORD;
const origin = new URL(process.env.WEB_TEST_URL ?? 'http://127.0.0.1:5173').origin;
const labels = new Set<string>();
test.use({ trace: 'off', screenshot: 'off' });
test.beforeEach(async ({ page }) => {
  labels.clear();
  test.skip(!email || !password, 'Requires a disposable local installation owner.');
  await page.goto('/');
  await page.getByLabel('Email address').fill(email!);
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await page.goto('/#settings');
  await page.getByRole('link', { name: 'Connections', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Agent access', exact: true })).toBeVisible();
});
test.afterEach(async ({ page }) => {
  if (!email || !password || labels.size === 0) return;
  const response = await page.request.get('/api/agent-grants');
  if (!response.ok()) return;
  const grants = (await response.json()).grants as {
    id: string;
    label: string;
    revokedAt: string | null;
  }[];
  for (const grant of grants.filter((g) => labels.has(g.label) && !g.revokedAt))
    expect(
      (
        await page.request.post('/api/agent-grants/revoke', {
          headers: { Origin: origin },
          data: { operationId: crypto.randomUUID(), grantId: grant.id },
        })
      ).ok(),
    ).toBeTruthy();
});
test('creates scoped expiring access, copies only on request, clears the key and revokes', async ({
  page,
}) => {
  const label = `Fictional access ${crypto.randomUUID().slice(0, 8)}`;
  labels.add(label);
  await page.getByRole('button', { name: 'Add agent', exact: true }).click();
  await page.getByLabel('Agent name', { exact: true }).fill(label);
  await page.getByRole('combobox', { name: 'Purpose', exact: true }).selectOption('custom');
  await page.getByLabel('Plan exercises and routines', { exact: true }).check();
  await expect(
    page.getByLabel('Record reported or imported workouts', { exact: true }),
  ).not.toBeChecked();
  let issuedBody: { operationId: string; scopes: string[]; expiresAt: string } | null = null;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/agent-grants'))
      issuedBody = request.postDataJSON();
  });
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          if (!text.startsWith('ml_')) throw new Error('Unexpected key');
          (window as unknown as { copied: boolean }).copied = true;
        },
      },
    });
  });
  await page.getByRole('button', { name: 'Create one-time key' }).click();
  const key = page.getByLabel('One-time agent key');
  await expect(key).toBeVisible();
  expect(issuedBody!.scopes).toEqual(['tasks:read', 'workouts:plan']);
  expect(new Date(issuedBody!.expiresAt).getTime()).toBeGreaterThan(Date.now());
  const stored = (await (await page.request.get('/api/agent-grants')).json()).grants.find(
    (grant: { label: string }) => grant.label === label,
  );
  expect(stored.scopes).toEqual(['tasks:read', 'workouts:plan']);
  expect(stored.expiresAt).toBe(issuedBody!.expiresAt);
  expect(stored.secret).toBeUndefined();
  expect(stored.verifier).toBeUndefined();
  const duplicate = await page.request.post('/api/agent-grants', {
    headers: { Origin: origin },
    data: { ...issuedBody!, label },
  });
  expect(duplicate.status()).toBe(409);
  expect((await duplicate.json()).error.code).toBe('GRANT_SECRET_ALREADY_ISSUED');
  await page.getByRole('button', { name: 'Copy key', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Key copied');
  expect(await page.evaluate(() => (window as unknown as { copied: boolean }).copied)).toBe(true);
  await page.getByRole('button', { name: 'Done · hide key' }).click();
  await expect(key).toHaveCount(0);
  await page.reload();
  await expect(key).toHaveCount(0);
  await page.getByRole('button', { name: `Revoke ${label}`, exact: true }).click();
  const card = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: label, exact: true }) });
  await expect(card).toContainText('Revoked');
  await expect(card).toContainText('history retained');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('agent-access-phone.png'), fullPage: true });
});
test('lost issuance response exposes committed grant for revocation without automatic issue retry', async ({
  page,
}) => {
  const label = `Fictional lost key ${crypto.randomUUID().slice(0, 8)}`;
  labels.add(label);
  await page.getByRole('button', { name: 'Add agent', exact: true }).click();
  await page.getByLabel('Agent name', { exact: true }).fill(label);
  let count = 0;
  await page.route('**/api/agent-grants', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    count++;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.abort('failed');
  });
  await page.getByRole('button', { name: 'Create one-time key' }).click();
  await expect(page.getByRole('alert')).toContainText('The key could not be retrieved');
  await expect(page.getByLabel('One-time agent key')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create one-time key' })).toBeDisabled();
  expect(count).toBe(1);
  await page.unroute('**/api/agent-grants');
  await page.getByRole('button', { name: `Revoke ${label}`, exact: true }).click();
  const card = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: label, exact: true }) });
  await expect(card).toContainText('Revoked');
  await page.getByRole('button', { name: 'I reviewed grants; create a replacement' }).click();
  await expect(page.getByRole('button', { name: 'Create one-time key' })).toBeEnabled();
});

test('leaving Settings clears the revealed key without revoking access', async ({ page }) => {
  const label = `Fictional navigation ${crypto.randomUUID().slice(0, 8)}`;
  labels.add(label);
  await page.getByRole('button', { name: 'Add agent', exact: true }).click();
  await page.getByLabel('Agent name', { exact: true }).fill(label);
  await page.getByRole('button', { name: 'Create one-time key' }).click();
  await expect(page.getByLabel('One-time agent key')).toBeVisible();
  await page.goto('/#tasks');
  await expect(page.getByLabel('One-time agent key')).toHaveCount(0);
  await page.goto('/#settings');
  await page.getByRole('link', { name: 'Connections', exact: true }).click();
  await expect(page.getByLabel('One-time agent key')).toHaveCount(0);
  await expect(page.getByRole('button', { name: `Revoke ${label}`, exact: true })).toBeVisible();
});

test('workout planner preset keeps performed recording separate and presents optional setup details', async ({
  page,
}) => {
  const label = `Fictional planning ${crypto.randomUUID().slice(0, 8)}`;
  labels.add(label);
  await expect(page.getByLabel('Agent name', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add agent', exact: true }).click();
  await page.getByLabel('Agent name', { exact: true }).fill(label);
  await page.getByRole('combobox', { name: 'Purpose', exact: true }).selectOption('workouts');
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Access duration', exact: true }).selectOption('1');
  let issued: { scopes: string[]; expiresAt: string } | undefined;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/agent-grants'))
      issued = request.postDataJSON();
  });
  await page.getByRole('button', { name: 'Create one-time key' }).click();
  await expect(page.getByLabel('One-time agent key')).toBeVisible();
  expect(issued!.scopes).toEqual(['workouts:read', 'workouts:plan']);
  expect(Math.abs(Date.parse(issued!.expiresAt) - Date.now() - 86400000)).toBeLessThan(60000);
  await expect(page.getByText('Authorization: Bearer YOUR_KEY', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Manual setup details' }).click();
  await expect(page.getByText('Authorization: Bearer YOUR_KEY', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as unknown as { endpointCopied: boolean }).endpointCopied =
            text === `${location.origin}/mcp`;
        },
      },
    });
  });
  await page.getByRole('button', { name: 'Copy endpoint', exact: true }).click();
  expect(
    await page.evaluate(() => (window as unknown as { endpointCopied: boolean }).endpointCopied),
  ).toBe(true);
  await page.getByRole('button', { name: 'Done · hide key' }).click();
  await page.getByRole('button', { name: `Revoke ${label}`, exact: true }).click();
});
