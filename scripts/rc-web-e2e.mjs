// Load fixture credentials inside this process and pass them only to the test child.
import { readFile, writeFile } from 'node:fs/promises';
import https from 'node:https';
import { pathToFileURL } from 'node:url';
import { startRcWebFixture } from './rc-web-fixture.mjs';
import { spawnGroup } from './supervise.mjs';

export function e2eHelp() {
  return [
    'Usage: node scripts/rc-web-e2e.mjs [--help]',
    'Starts the hermetic fixture, then runs npm run test:e2e in its own process group.',
    'SIGINT and SIGTERM stop that group before stopping the fixture.',
    'An interrupt during startup closes a fixture that finishes afterward and does not spawn tests.',
    'RC_WEB_APP_PORT defaults to 3631 and RC_WEB_TLS_PORT defaults to 3643.',
    'Set RC_WEB_TODAY_LIVE=1 to enable the live Today proof.',
  ].join('\n');
}

export async function runRcWebE2e(options = {}) {
  const start = options.start ?? startRcWebFixture;
  const command = options.command ?? ['npm', 'run', 'test:e2e'];
  const graceMs = options.graceMs;
  let started;
  let group;
  let groupStop;
  let interrupted = false;
  let exitCode = 1;
  const beginGroupStop = () => {
    if (group && !groupStop) groupStop = group.stop();
  };
  const onSigint = () => {
    interrupted = true;
    exitCode = 0;
    beginGroupStop();
  };
  const onSigterm = () => {
    interrupted = true;
    exitCode = 1;
    beginGroupStop();
  };
  const stopLatest = async () => {
    beginGroupStop();
    if (groupStop) await groupStop;
    if (started) await started.stop();
  };
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);
  try {
    started = await start();
    if (interrupted) return exitCode;
    if (!options.skipHealth) await waitForHealth(started.origin);
    if (interrupted) return exitCode;
    const values = options.envValues ?? (await readEnv(started.envPath));
    if (interrupted) return exitCode;
    if (!values.WEB_TEST_EMAIL || !values.WEB_TEST_PASSWORD || !values.WEB_TEST_URL) {
      throw new Error('Fixture environment is missing browser credentials.');
    }
    if (interrupted) return exitCode;
    group = spawnGroup(command[0], command.slice(1), {
      env: { ...process.env, ...values },
      graceMs,
      stdio: options.stdio ?? 'inherit',
    });
    const childCode = await group.exited;
    if (!interrupted) exitCode = childCode;
  } catch (error) {
    if (!interrupted) throw error;
  } finally {
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
    await stopLatest();
  }
  return exitCode;
}

async function readEnv(path) {
  return Object.fromEntries(
    (await readFile(path, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf('=');
        if (index < 1) throw new Error('Fixture environment file is invalid.');
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

function waitForHealth(origin) {
  return new Promise((resolve, reject) => {
    const attempt = (remaining) => {
      const request = https.get(
        `${origin}/api/health`,
        { rejectUnauthorized: false },
        (response) => {
          response.resume();
          if (response.statusCode === 200) resolve();
          else retry(remaining);
        },
      );
      request.on('error', () => retry(remaining));
    };
    const retry = (remaining) => {
      if (remaining <= 0) reject(new Error('Fixture health check failed.'));
      else setTimeout(() => attempt(remaining - 1), 250);
    };
    attempt(80);
  });
}

const fakeValues = {
  WEB_TEST_EMAIL: 'ci-web@example.test',
  WEB_TEST_PASSWORD: 'fake-password',
  WEB_TEST_URL: 'https://127.0.0.1:9',
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(e2eHelp());
  } else if (process.env.RC_WEB_E2E_FAKE === '1') {
    process.exitCode = await runRcWebE2e({
      skipHealth: true,
      graceMs: Number(process.env.SUPERVISE_GRACE_MS ?? 200),
      stdio: 'ignore',
      command: [
        process.execPath,
        'scripts/test/fixtures/exit-term-ignore-grandchild.mjs',
        process.env.RC_WEB_FAKE_PID,
        'scripts/test/fixtures/ignore-term.mjs',
      ],
      envValues: fakeValues,
      start: async () => ({
        origin: 'https://127.0.0.1:9',
        stop: async () => writeFile(process.env.RC_WEB_FAKE_STOPPED, 'stopped\n'),
      }),
    });
  } else if (process.env.RC_WEB_E2E_FAKE === 'delay') {
    process.exitCode = await runRcWebE2e({
      skipHealth: true,
      graceMs: 200,
      stdio: 'ignore',
      command: [
        process.execPath,
        '--input-type=module',
        '-e',
        "import { writeFileSync } from 'node:fs'; writeFileSync(process.env.RC_WEB_FAKE_SPAWNED, 'spawned\\n');",
      ],
      envValues: fakeValues,
      start: async () => {
        await writeFile(process.env.RC_WEB_FAKE_STARTING, 'starting\n');
        await new Promise((resolve) => setTimeout(resolve, 5000));
        return {
          origin: 'https://127.0.0.1:9',
          stop: async () => writeFile(process.env.RC_WEB_FAKE_STOPPED, 'stopped\n'),
        };
      },
    });
  } else {
    try {
      process.exitCode = await runRcWebE2e();
    } catch (error) {
      console.error(error.code === 'EADDRINUSE' ? error.message : 'Browser fixture failed.');
      process.exitCode = 1;
    }
  }
}
