import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, rm, realpath, symlink, mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

let postgres16 = false;
try {
  postgres16 = /PostgreSQL\) 16\./.test(
    execFileSync('initdb', ['--version'], { encoding: 'utf8' }),
  );
} catch {
  postgres16 = false;
}
const needsPg16 =
  'PostgreSQL 16 initdb is required. Install postgresql-16 and put /usr/lib/postgresql/16/bin on PATH.';

const state = await realpath(await mkdtemp(join(tmpdir(), 'mems-pg-')));
const port = await freePort();
const env = { ...process.env, MEMS_LIFE_PG_STATE: state, MEMS_LIFE_PG_PORT: String(port) };

function db(args) {
  return spawnSync('bash', ['scripts/db.sh', ...args], { env, encoding: 'utf8' });
}

test(
  'fixture startup creates only the allowlisted databases and preserves them',
  { skip: postgres16 ? false : needsPg16 },
  () => {
    const started = db(['start']);
    assert.equal(started.status, 0, started.stderr);
    const names = query(
      "SELECT datname FROM pg_database WHERE datname LIKE 'mems_life%' ORDER BY 1",
    );
    assert.equal(names.includes('mems_life_rc_tooling'), false);
    assert.equal(names.includes('mems_life_offline_live_test'), false);
    assert.equal(names.includes('mems_life_rc_core'), true);
    assert.equal(names.includes('mems_life_ci_web'), true);
    assert.equal(names.includes('mems_life_rc_data'), true);
    assert.equal(names.filter((name) => name !== 'mems_life').length, 21);
    query('CREATE TABLE preserved(id integer)');
    const again = db(['start']);
    assert.equal(again.status, 0, again.stderr);
    assert.equal(query("SELECT to_regclass('public.preserved')")[0], 'preserved');
  },
);

test(
  'a symlinked state directory is refused',
  { skip: postgres16 ? false : needsPg16 },
  async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'mems-pg-link-')));
    const link = join(directory, 'state');
    await mkdir(join(directory, 'target'), { mode: 0o700 });
    await symlink(join(directory, 'target'), link);
    const result = spawnSync('bash', ['scripts/db.sh', 'init'], {
      env: { ...process.env, MEMS_LIFE_PG_STATE: link, MEMS_LIFE_PG_PORT: String(port + 1) },
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /symlink/i);
    await rm(directory, { recursive: true, force: true });
  },
);

test.after(() => {
  db(['stop']);
  spawnSync('rm', ['-rf', state]);
});

function query(sql) {
  const result = spawnSync(
    'psql',
    [
      '-d',
      sql.startsWith('CREATE') || sql.includes('to_regclass') ? 'mems_life_rc_data' : 'postgres',
      '-At',
      '-c',
      sql,
    ],
    {
      env: { ...env, PGHOST: '127.0.0.1', PGPORT: String(port), PGUSER: 'mems_life' },
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split('\n').filter(Boolean);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(typeof address === 'object' && address ? address.port : reject()));
    });
  });
}
