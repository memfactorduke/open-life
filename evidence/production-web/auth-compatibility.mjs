import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
const credentials = JSON.parse(
  await readFile(
    new URL('../../.runtime/production-web/credentials.json', import.meta.url),
    'utf8',
  ),
);
const child = spawn(
  'npx',
  [
    'playwright',
    'test',
    '--config',
    'evidence/production-web/playwright.config.ts',
    'private-workspace.spec.ts',
    '--project',
    'chromium',
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      WEB_TEST_URL: 'https://localhost:3443',
      WEB_TEST_EMAIL: credentials.email,
      WEB_TEST_PASSWORD: credentials.password,
    },
  },
);
child.on('exit', (code) => process.exit(code ?? 1));
