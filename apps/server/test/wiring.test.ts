import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { migrate, bootstrapOwner } from '../src/database.js';
import { mediaLimit } from '../src/media.js';

test('actual application preserves bounded upload and session errors and origin defenses', async () => {
  const databaseUrl =
    process.env.WIRING_TEST_DATABASE_URL ??
    'postgresql://mems_life@127.0.0.1:55432/mems_life_wiring_test';
  assert.equal(new URL(databaseUrl).pathname, '/mems_life_wiring_test');
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  const config = readConfig({
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: 'fictional-wiring-test-secret-minimum-length',
    BETTER_AUTH_URL: 'http://localhost:3001',
    WEB_ORIGIN: 'http://localhost:5173',
    MEDIA_DIRECTORY: '.runtime/wiring-test-media',
    NODE_ENV: 'test',
  });
  let service: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await migrate(pool, config);
    await migrate(pool, config);
    const identity = {
      email: 'wiring-owner@example.test',
      name: 'Wiring Fixture',
      password: 'fictional-wiring-password-123',
    };
    await bootstrapOwner(pool, config, identity);
    service = await createApp(config, pool);
    const login = await service.app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: config.WEB_ORIGIN },
      payload: { email: identity.email, password: identity.password },
    });
    assert.equal(login.statusCode, 200);
    const cookie = login.cookies.map((item) => `${item.name}=${item.value}`).join('; ');
    const session = await service.app.inject({
      method: 'POST',
      url: '/api/sessions/commands',
      headers: { origin: config.WEB_ORIGIN, cookie },
      payload: { padding: 'x'.repeat(1_048_577) },
    });
    assert.equal(session.statusCode, 413);
    assert.equal(session.json().error.code, 'REQUEST_TOO_LARGE');
    const photo = await service.app.inject({
      method: 'PUT',
      url: `/api/media/${randomUUID()}/content`,
      headers: { origin: config.WEB_ORIGIN, cookie, 'content-type': 'application/octet-stream' },
      payload: Buffer.alloc(mediaLimit + 1),
    });
    assert.equal(photo.statusCode, 413);
    assert.equal(photo.json().error.code, 'REQUEST_TOO_LARGE');
    const missingOrigin = await service.app.inject({
      method: 'POST',
      url: '/api/sessions/commands',
      headers: { cookie },
      payload: {},
    });
    assert.equal(missingOrigin.statusCode, 403);
    const noAgent = await service.app.inject({ method: 'POST', url: '/mcp', payload: {} });
    assert.equal(noAgent.statusCode, 401);
    const badOrigin = await service.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { origin: 'https://untrusted.example.test' },
      payload: {},
    });
    assert.equal(badOrigin.statusCode, 403);
    assert.deepEqual(
      (await pool.query('SELECT version FROM application_migrations ORDER BY version')).rows.map(
        (row) => row.version,
      ),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    );
    const hardeningIndexes = (
      await pool.query(
        "SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND indexname IN ('audit_events_operation','agent_attempts_latest') ORDER BY indexname",
      )
    ).rows;
    assert.deepEqual(
      hardeningIndexes.map((row) => row.indexname),
      ['agent_attempts_latest', 'audit_events_operation'],
    );
    assert.match(hardeningIndexes[0].indexdef, /owner_id, step_id.*createdAt.*DESC, id DESC/);
    assert.match(hardeningIndexes[1].indexdef, /actor_id, operation_id/);
  } finally {
    await service?.app.close();
    await pool.end();
  }
});
