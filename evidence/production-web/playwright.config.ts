import { defineConfig } from '@playwright/test';
import original from '../../apps/web/playwright.config';
export default defineConfig({
  ...original,
  testDir: '../../apps/web/e2e',
  outputDir: './auth-results',
  use: { ...original.use, baseURL: 'https://localhost:3443', ignoreHTTPSErrors: true },
});
