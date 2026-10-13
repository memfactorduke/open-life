import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

test.use({ baseURL: 'https://localhost:3443', ignoreHTTPSErrors: true });

test('production CSP permits private photos while preserving secure task files and accessible layouts', async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  test.skip(
    process.env.WEB_PRODUCTION_TEST !== '1',
    'Requires the isolated local production TLS fixture.',
  );
  const credentials = JSON.parse(
    await readFile(
      new URL('../../../.runtime/production-web/credentials.json', import.meta.url),
      'utf8',
    ),
  );
  const violations: unknown[] = [];
  await page.exposeFunction('recordCspViolation', (value: unknown) => violations.push(value));
  await page.addInitScript(() =>
    document.addEventListener('securitypolicyviolation', (event) => {
      void (
        window as unknown as { recordCspViolation: (value: unknown) => Promise<void> }
      ).recordCspViolation({ directive: event.violatedDirective, blockedURI: event.blockedURI });
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  const response = await page.goto('/');
  const csp = response!.headers()['content-security-policy'];
  expect(csp).toContain("img-src 'self' data: blob:");
  expect(csp).toContain("script-src 'self';");
  expect(response!.headers()['x-content-type-options']).toBe('nosniff');
  await page.getByLabel('Email address').fill(credentials.email);
  await page.getByLabel('Password', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  const sessionCookies = (await page.context().cookies()).filter((cookie) =>
    cookie.name.includes('session_token'),
  );
  expect(sessionCookies.length).toBeGreaterThan(0);
  expect(sessionCookies.every((cookie) => cookie.secure && cookie.httpOnly)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('today-phone.png'), fullPage: true });
  await page.route('**/api/attention', (route) => route.abort('failed'));
  await page.getByRole('button', { name: 'Refresh Today', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('today-refresh-error.png'), fullPage: true });
  await page.unroute('**/api/attention');
  await page.getByRole('button', { name: 'Retry Today', exact: true }).press('Enter');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Refresh Today', exact: true })).toBeEnabled();
  await page.getByRole('link', { name: 'Food', exact: false }).click();
  const name = `Production fictional meal ${crypto.randomUUID().slice(0, 8)}`;
  const png = await sharp({ create: { width: 24, height: 24, channels: 3, background: '#db9d47' } })
    .png()
    .toBuffer();
  const jpeg = await sharp({
    create: { width: 24, height: 24, channels: 3, background: '#649a60' },
  })
    .jpeg()
    .toBuffer();
  await page.getByRole('textbox', { name: 'Notes', exact: true }).fill(name);
  await page.getByLabel('Add private photos').setInputFiles([
    { name: 'fictional-meal.png', mimeType: 'image/png', buffer: png },
    { name: 'fictional-meal.jpeg', mimeType: 'image/jpeg', buffer: jpeg },
  ]);
  await page.getByRole('button', { name: 'Save entry', exact: true }).press('Enter');
  await expect(page.getByRole('status')).toHaveText('Food entry saved.');
  const card = page.getByRole('article').filter({ has: page.getByText(name, { exact: true }) });
  await expect(card.getByRole('img')).toHaveCount(2);
  await expect
    .poll(() =>
      card
        .getByRole('img')
        .evaluateAll((images) =>
          images.every(
            (image) =>
              (image as HTMLImageElement).complete &&
              (image as HTMLImageElement).naturalWidth === 24 &&
              (image as HTMLImageElement).src.startsWith('blob:'),
          ),
        ),
    )
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath('food-phone.png'), fullPage: true });
  await page.reload();
  await expect
    .poll(() =>
      card
        .getByRole('img')
        .evaluateAll(
          (images) =>
            images.length === 2 &&
            images.every((image) => (image as HTMLImageElement).naturalWidth === 24),
        ),
    )
    .toBe(true);
  await page.getByRole('link', { name: 'Tasks', exact: false }).click();
  const taskName = `Production fictional task ${crypto.randomUUID().slice(0, 8)}`;
  await page.getByLabel('New task', { exact: true }).fill(taskName);
  await page.getByRole('button', { name: 'Add to Planned' }).press('Enter');
  await page.getByRole('button', { name: taskName, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('File to attach').setInputFiles({
    name: 'fictional-script.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('<script>window.unsafeExecution=true</script>'),
  });
  await dialog.getByRole('button', { name: 'Attach private file', exact: true }).press('Enter');
  const link = dialog.getByRole('link', { name: 'fictional-script.txt', exact: true });
  await expect(link).toBeVisible();
  const attachment = await page.request.get((await link.getAttribute('href'))!);
  expect(attachment.status()).toBe(200);
  expect(attachment.headers()['content-disposition']).toContain('attachment;');
  expect(attachment.headers()['x-content-type-options']).toBe('nosniff');
  expect(await attachment.text()).toContain('<script>');
  expect(await page.evaluate(() => 'unsafeExecution' in window)).toBe(false);
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.screenshot({ path: testInfo.outputPath('task-file-tablet.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('link', { name: 'Settings', exact: false }).click();
  await page.getByLabel('Appearance').selectOption('dark');
  await page.getByRole('button', { name: 'Save preferences' }).press('Enter');
  await expect(page.getByRole('status').first()).toHaveText('Your preferences are saved.');
  await page.reload();
  await expect(page.getByLabel('Appearance')).toHaveValue('dark');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByLabel('Display name').focus();
  const focus = await page.getByLabel('Display name').evaluate((element) => ({
    active: document.activeElement === element,
    outline: getComputedStyle(element).outlineWidth,
  }));
  expect(focus.active).toBe(true);
  expect(parseFloat(focus.outline)).toBeGreaterThanOrEqual(2);
  await page.screenshot({ path: testInfo.outputPath('settings-dark-tablet.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => (document.documentElement.style.fontSize = '125%'));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('settings-dark-phone-text-scale.png'),
    fullPage: true,
  });
  expect(violations).toEqual([]);
  await writeFile(
    testInfo.outputPath('production-verification.json'),
    JSON.stringify(
      {
        origin: 'https://localhost:3443',
        tls: 'Self-signed isolated laboratory; ignoreHTTPSErrors does not waive CSP or secure cookies.',
        csp,
        violations,
        images: { count: 2, naturalWidth: 24, authenticatedBlobUrls: true },
        attachment: {
          disposition: attachment.headers()['content-disposition'],
          nosniff: attachment.headers()['x-content-type-options'],
        },
        keyboardFocus: focus,
        sessionCookies: { count: sessionCookies.length, secure: true, httpOnly: true },
        browser: testInfo.project.name,
      },
      null,
      2,
    ),
  );
});
