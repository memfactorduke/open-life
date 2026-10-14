import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, realpath } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('--help exits before binding a port', async () => {
  for (const script of ['scripts/rc-web-fixture.mjs', 'scripts/rc-web-e2e.mjs']) {
    const result = await run(process.execPath, [script, '--help']);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /--help/);
    assert.doesNotMatch(result.stdout, /fixture ready/i);
  }
});

test('SIGINT stops the test group and then the fixture', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'mems-rc-web-')));
  const pidFile = join(directory, 'grandchild.pid');
  const stopped = join(directory, 'stopped');
  const child = spawn(process.execPath, ['scripts/rc-web-e2e.mjs'], {
    env: {
      ...process.env,
      RC_WEB_E2E_FAKE: '1',
      RC_WEB_FAKE_PID: pidFile,
      RC_WEB_FAKE_STOPPED: stopped,
      SUPERVISE_GRACE_MS: '200',
    },
    stdio: 'ignore',
  });
  try {
    const pid = Number(await waitFor(pidFile));
    const started = Date.now();
    process.kill(child.pid, 'SIGINT');
    const code = await new Promise((resolve) => child.once('exit', resolve));
    const elapsed = Date.now() - started;
    assert.equal(code, 0);
    assert.ok(elapsed >= 180, `wrapper exited after ${elapsed}ms`);
    assert.equal(await readFile(stopped, 'utf8'), 'stopped\n');
    assert.throws(() => process.kill(pid, 0), /ESRCH/);
  } finally {
    try {
      process.kill(child.pid, 'SIGKILL');
    } catch {}
    await rm(directory, { recursive: true, force: true });
  }
});

test('SIGINT during startup stops the late fixture and does not spawn', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'mems-rc-web-delay-')));
  const starting = join(directory, 'starting');
  const stopped = join(directory, 'stopped');
  const spawned = join(directory, 'spawned');
  const child = spawn(process.execPath, ['scripts/rc-web-e2e.mjs'], {
    env: {
      ...process.env,
      RC_WEB_E2E_FAKE: 'delay',
      RC_WEB_FAKE_STARTING: starting,
      RC_WEB_FAKE_STOPPED: stopped,
      RC_WEB_FAKE_SPAWNED: spawned,
    },
    stdio: 'ignore',
  });
  try {
    await waitFor(starting);
    process.kill(child.pid, 'SIGINT');
    const code = await new Promise((resolve) => child.once('exit', resolve));
    assert.equal(code, 0);
    assert.equal(await readFile(stopped, 'utf8'), 'stopped\n');
    await assert.rejects(readFile(spawned, 'utf8'), /ENOENT/);
  } finally {
    try {
      process.kill(child.pid, 'SIGKILL');
    } catch {}
    await rm(directory, { recursive: true, force: true });
  }
});

test('an occupied fixture port exits without keeping the other port', async () => {
  const appPort = await listenOnce();
  const tlsPort = await listenOnce();
  assert.notEqual(appPort, 3631);
  assert.notEqual(tlsPort, 3643);
  const occupied = createServer();
  await new Promise((resolve) => occupied.listen(appPort, '127.0.0.1', resolve));
  try {
    const result = await run(process.execPath, ['scripts/rc-web-fixture.mjs'], {
      RC_WEB_APP_PORT: String(appPort),
      RC_WEB_TLS_PORT: String(tlsPort),
    });
    assert.equal(result.code, 1);
    assert.match(
      result.stderr,
      new RegExp(`EADDRINUSE: address already in use 127\\.0\\.0\\.1:${appPort}`),
    );
    assert.equal(await listening(tlsPort), false);
    assert.equal(await listening(appPort), true);
  } finally {
    await new Promise((resolve) => occupied.close(resolve));
  }
});

function run(file, args, env = {}) {
  const child = spawn(file, args, { env: { ...process.env, ...env } });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  return new Promise((resolve) => {
    child.once('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

function listenOnce() {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function listening(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(true));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(false)));
  });
}

async function waitFor(path) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      return await readFile(path, 'utf8');
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}
