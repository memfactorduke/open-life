import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { Pool } from 'pg';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/mems_life_test')
  throw new Error('TEST_DATABASE_URL must name mems_life_test.');
test('administrator CLI accepts stdin, refuses repeated bootstrap, and does not log secrets', async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    const env = {
      ...process.env,
      DATABASE_URL: databaseUrl,
      BETTER_AUTH_SECRET: 'fictional-cli-test-secret-at-least-32-characters',
      BETTER_AUTH_URL: 'http://localhost:3001',
      WEB_ORIGIN: 'http://localhost:5173',
      OWNER_EMAIL: 'cli-owner@example.test',
      OWNER_NAME: 'CLI Fixture',
      NODE_ENV: 'test',
    };
    const password = 'fixture-cli-password-12345';
    const invoke = (command: string, input = '') =>
      spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', command], {
        cwd: new URL('../', import.meta.url),
        env,
        input,
        encoding: 'utf8',
        timeout: 15000,
      });
    const migration = invoke('migrate');
    assert.equal(migration.status, 0, migration.stderr);
    assert.match(migration.stdout, /Migrations applied/);
    const bootstrap = invoke('bootstrap', `${password}\n`);
    assert.equal(bootstrap.status, 0, bootstrap.stderr);
    assert.match(bootstrap.stdout, /owner created/);
    const duplicate = invoke('bootstrap', `${password}\n`);
    assert.equal(duplicate.status, 1);
    const recovery = invoke('recover', 'replacement-cli-password-12345\n');
    assert.equal(recovery.status, 0, recovery.stderr);
    assert.match(recovery.stdout, /sessions revoked/);
    for (const result of [migration, bootstrap, duplicate, recovery]) {
      assert.ok(!`${result.stdout}${result.stderr}`.includes(password));
      assert.ok(!`${result.stdout}${result.stderr}`.includes('replacement-cli-password'));
    }
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM installation')).rows[0].n, 1);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM audit_events WHERE event_type='owner.recovered'",
        )
      ).rows[0].n,
      1,
    );
  } finally {
    await pool.end();
  }
});
