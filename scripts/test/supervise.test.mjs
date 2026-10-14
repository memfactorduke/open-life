import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('a child that ignores SIGTERM is killed after the grace period', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'mems-supervise-')));
  const pidFile = join(directory, 'child.pid');
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { supervise } from './scripts/supervise.mjs';
       supervise([[process.execPath, 'scripts/test/fixtures/ignore-term.mjs', ${JSON.stringify(pidFile)}]]);`,
    ],
    { env: { ...process.env, SUPERVISE_GRACE_MS: '200' }, stdio: 'ignore' },
  );
  try {
    const pid = Number(await waitFor(pidFile));
    process.kill(child.pid, 'SIGINT');
    const code = await new Promise((resolve) => child.once('exit', resolve));
    assert.equal(code, 0);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.throws(() => process.kill(pid, 0), /ESRCH/);
  } finally {
    try {
      process.kill(child.pid, 'SIGKILL');
    } catch {}
    await rm(directory, { recursive: true, force: true });
  }
});

test('a grandchild that ignores SIGTERM is killed after its parent exits', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'mems-supervise-grand-')));
  const pidFile = join(directory, 'grandchild.pid');
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { supervise } from './scripts/supervise.mjs';
       supervise([[process.execPath, 'scripts/test/fixtures/exit-term-ignore-grandchild.mjs', ${JSON.stringify(pidFile)}, 'scripts/test/fixtures/ignore-term.mjs']]);`,
    ],
    { env: { ...process.env, SUPERVISE_GRACE_MS: '200' }, stdio: 'ignore' },
  );
  try {
    const pid = Number(await waitFor(pidFile));
    const started = Date.now();
    process.kill(child.pid, 'SIGINT');
    const code = await new Promise((resolve) => child.once('exit', resolve));
    const elapsed = Date.now() - started;
    assert.equal(code, 0);
    assert.ok(elapsed >= 180, `supervisor exited after ${elapsed}ms, before the grace SIGKILL`);
    assert.throws(() => process.kill(pid, 0), /ESRCH/);
  } finally {
    try {
      process.kill(child.pid, 'SIGKILL');
    } catch {}
    await rm(directory, { recursive: true, force: true });
  }
});

async function waitFor(path) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      return await readFile(path, 'utf8');
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error('Timed out waiting for the supervised child.');
}
