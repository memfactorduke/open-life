import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import { migrate, bootstrapOwner } from '../src/database.js';
import { migrateSessions } from '../src/session-migrations.js';
import { executeTaskCommand } from '../src/tasks.js';
import Fastify from 'fastify';
import { registerWhoopRoutes } from '../src/whoop-routes.js';
import { migrateFeatures } from '../src/feature-migrations.js';
import { migrateWhoop } from '../src/whoop-migrations.js';
import { readConfig } from '../src/config.js';
import { requireOwner } from '../src/operations.js';
import { WhoopService } from '../src/whoop.js';
const url =
  process.env.WHOOP_TEST_DATABASE_URL ??
  'postgresql://mems_life@127.0.0.1:55432/mems_life_whoop_test';
if (new URL(url).pathname !== '/mems_life_whoop_test')
  throw new Error('WHOOP fixtures require isolated mems_life_whoop_test.');
test('WHOOP real PG lifecycle: session-bound OAuth, pages, scores, rotation, outage, replacement, 404, receipts and revocation', async () => {
  const pool = new Pool({ connectionString: url, max: 3 });
  const cfg = readConfig({
    DATABASE_URL: url,
    BETTER_AUTH_SECRET: 'fictional-whoop-test-secret-length-32',
    NODE_ENV: 'test',
  });
  let unblock: () => void = () => {};
  let started: () => void = () => {};
  let blocked: Promise<void> | null = null;
  let now = new Date('2026-10-12T12:00:00Z'),
    account = 123,
    mode = 'healthy',
    refreshes = 0,
    revokes = 0;
  const seen: string[] = [];
  const record = (id: string | number) => ({
    id,
    user_id: account,
    start: '2026-10-12T10:00:00Z',
    end: '2026-10-12T11:00:00Z',
    updated_at: '2026-10-12T11:01:00Z',
    timezone_offset: '-04:00',
    score_state: 'PENDING_SCORE',
    score: null,
  });
  const fake: typeof fetch = async (input, init) => {
    const u = new URL(String(input));
    seen.push(u.toString());
    if (blocked && u.pathname.endsWith('/user/profile/basic')) {
      started();
      await blocked;
    }
    if (mode === 'token-fail' && u.pathname.endsWith('/token'))
      return new Response(null, { status: 500 });
    if (u.pathname.endsWith('/token')) {
      const p = new URLSearchParams(String(init?.body));
      if (p.get('grant_type') === 'refresh_token') refreshes++;
      return Response.json({
        access_token: `fictional-access-${refreshes}`,
        refresh_token: `fictional-refresh-${refreshes}`,
        expires_in: 3600,
      });
    }
    if (u.pathname.endsWith('/user/access')) {
      revokes++;
      return new Response(null, { status: mode === 'revoke-fail' ? 500 : 204 });
    }
    if (mode === '401') return new Response(null, { status: 401 });
    if (mode === '429')
      return new Response(null, { status: 429, headers: { 'Retry-After': '7200' } });
    if (u.pathname.endsWith('/user/profile/basic')) return Response.json({ user_id: account });
    if (mode === '404' && u.pathname.endsWith('/activity/workout/w1'))
      return new Response(null, { status: 404 });
    if (u.pathname.endsWith('/activity/workout'))
      return Response.json(
        u.searchParams.get('nextToken')
          ? { records: [{ ...record('w2'), score_state: 'SCORED', score: { strain: 8 } }] }
          : { records: [record('w1')], next_token: 'page2' },
      );
    if (u.pathname.endsWith('/activity/workout/w1')) return Response.json(record('w1'));
    if (u.pathname.endsWith('/activity/workout/w2'))
      return Response.json({ ...record('w2'), score_state: 'SCORED', score: { strain: 8 } });
    if (u.pathname.endsWith('/cycle')) return Response.json({ records: [record(9)] });
    if (u.pathname.endsWith('/cycle/9')) return Response.json(record(9));
    return Response.json({ records: [] });
  };
  try {
    await pool.query('DROP SCHEMA public CASCADE;CREATE SCHEMA public');
    await migrate(pool, cfg);
    await migrateFeatures(pool);
    await migrateSessions(pool);
    await migrateWhoop(pool);
    await migrateWhoop(pool);
    await bootstrapOwner(pool, cfg, {
      email: 'whoop@example.test',
      name: 'WHOOP fixture',
      password: 'fictional-whoop-password-123',
    });
    const actor = await requireOwner(
      pool,
      (await pool.query('SELECT owner_id FROM installation')).rows[0].owner_id,
    );
    const svc = new WhoopService(
      pool,
      {
        WHOOP_CLIENT_ID: 'fictional-client',
        WHOOP_CLIENT_SECRET: 'fictional-secret',
        WHOOP_REDIRECT_URI: 'https://fixture.example.test/api/whoop/callback',
        WHOOP_TOKEN_KEY: 'ab'.repeat(32),
      },
      fake,
      () => now,
    );
    const authorize = async () => {};
    const command = async (
      type: 'whoop.connect' | 'whoop.refresh' | 'whoop.disconnect' | 'whoop.delete-cache',
    ) =>
      svc.command(
        actor,
        {
          type,
          ...(type === 'whoop.connect' ? { channel: 'web' as const } : {}),
          operationId: randomUUID(),
          expectedRevision: (await svc.read(actor)).revision,
        },
        'fictional-session',
        authorize,
      );
    const connect = await command('whoop.connect');
    const state = new URL(connect.authorizationUrl!).searchParams.get('state')!;
    const original = (
      await pool.query('SELECT request FROM operation_receipts WHERE operation_id=$1', [
        connect.operationId,
      ])
    ).rows[0].request;
    assert.deepEqual(await svc.command(actor, original, 'fictional-session', authorize), connect);
    await assert.rejects(
      svc.command(actor, { ...original, channel: 'native' }, 'fictional-session', authorize),
      /another change/,
    );
    assert.equal(state.length, 8);
    await assert.rejects(
      svc.callback(actor, 'wrong-session', state, 'fictional-code', authorize),
      /another session/,
    );
    await svc.callback(actor, 'fictional-session', state, 'fictional-code', authorize);
    await assert.rejects(
      svc.callback(actor, 'fictional-session', state, 'fictional-code', authorize),
      /another session/,
    );
    await command('whoop.refresh');
    let result = await svc.read(actor);
    assert.equal(result.observations.filter((o) => o.resource === 'workout').length, 2);
    assert.equal(result.observations.find((o) => o.providerId === 'w1')!.score, null);
    assert.equal(result.observations.find((o) => o.providerId === 'w2')!.score?.strain, 8);
    assert.ok(seen.some((u) => u.includes('nextToken=page2')));
    await assert.rejects(command('whoop.refresh'), /once an hour/);
    now = new Date(now.getTime() + 3601000);
    await Promise.all([svc.poll(), svc.poll()]);
    assert.equal(refreshes, 1);
    assert.ok(
      (await pool.query("SELECT id FROM whoop_history WHERE actor_type='system'")).rowCount,
    );
    now = new Date(now.getTime() + 3601000);
    mode = '404';
    await command('whoop.refresh');
    assert.equal(
      (await svc.read(actor)).observations.find((o) => o.providerId === 'w1')!.available,
      false,
    );
    now = new Date(now.getTime() + 3601000);
    mode = '429';
    await command('whoop.refresh');
    result = await svc.read(actor);
    assert.match(result.error!, /rate limit/);
    assert.equal(result.nextRefreshAt, new Date(now.getTime() + 7200000).toISOString());
    assert.equal(result.observations.length, 3);
    now = new Date(now.getTime() + 7201000);
    mode = '401';
    await command('whoop.refresh');
    assert.equal((await svc.read(actor)).status, 'reconnect');
    mode = 'healthy';
    account = 456;
    const replace = await command('whoop.connect');
    await svc.callback(
      actor,
      'fictional-session',
      new URL(replace.authorizationUrl!).searchParams.get('state')!,
      'second-code',
      authorize,
    );
    assert.ok((await svc.read(actor)).observations.every((o) => !o.currentAccount));
    await command('whoop.refresh');
    result = await svc.read(actor);
    assert.equal(result.observations.length, 6);
    assert.equal(result.observations.filter((o) => o.currentAccount).length, 3);
    const sessionId = randomUUID();
    await pool.query(
      "INSERT INTO workout_sessions(id,owner_id,revision,status,value,started_at,updated_at) VALUES($1,$2,1,'completed',$3,now(),now())",
      [sessionId, actor.userId, { sets: 'fixture-local-results', notes: 'Preserve me' }],
    );
    await svc.command(
      actor,
      {
        type: 'whoop.link',
        operationId: randomUUID(),
        expectedRevision: result.revision,
        providerId: 'w1',
        sessionId,
      },
      'fictional-session',
      authorize,
    );
    await assert.rejects(
      svc.command(
        actor,
        {
          type: 'whoop.link',
          operationId: randomUUID(),
          expectedRevision: (await svc.read(actor)).revision,
          providerId: 'w2',
          sessionId,
        },
        'fictional-session',
        authorize,
      ),
      /already linked/,
    );
    now = new Date(now.getTime() + 3601000);
    mode = '404';
    await command('whoop.refresh');
    assert.equal(
      (await svc.read(actor)).observations.find((o) => o.currentAccount && o.providerId === 'w1')!
        .linkedSessionId,
      null,
    );
    assert.deepEqual(
      (await pool.query('SELECT value FROM workout_sessions WHERE id=$1', [sessionId])).rows[0]
        .value,
      { sets: 'fixture-local-results', notes: 'Preserve me' },
    );
    now = new Date(now.getTime() + 3601000);
    mode = 'healthy';
    blocked = new Promise<void>((r) => {
      unblock = r;
    });
    const requested = new Promise<void>((r) => {
      started = r;
    });
    const polling = svc.poll();
    await requested;
    await Promise.race([
      executeTaskCommand(
        pool,
        actor,
        {
          type: 'task.create',
          operationId: randomUUID(),
          taskId: randomUUID(),
          expectedRevision: 0,
          content: { title: 'Core work during WHOOP network', description: '', notes: '' },
        },
        authorize,
      ),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('WHOOP blocked local tasks')), 1000),
      ),
    ]);
    unblock();
    blocked = null;
    await polling;
    await svc.command(
      actor,
      {
        type: 'whoop.link',
        operationId: randomUUID(),
        expectedRevision: (await svc.read(actor)).revision,
        providerId: 'w2',
        sessionId,
      },
      'fictional-session',
      authorize,
    );
    const native = await svc.command(
      actor,
      {
        type: 'whoop.connect',
        channel: 'native',
        operationId: randomUUID(),
        expectedRevision: (await svc.read(actor)).revision,
      },
      'fictional-session',
      authorize,
    );
    const nativeState = new URL(native.authorizationUrl!).searchParams.get('state')!;
    const app = Fastify();
    registerWhoopRoutes(
      app,
      pool,
      {
        ownerSession: async () => ({
          principal: actor,
          session: { session: { id: 'fictional-session' } },
        }),
        authorizeAgain: authorize,
      },
      svc.config,
      svc,
    );
    const redirect = await app.inject({
      method: 'GET',
      url: `/api/whoop/callback?state=${nativeState}&code=native-code`,
    });
    assert.equal(redirect.statusCode, 302);
    assert.ok(redirect.headers.location?.startsWith('memslife://whoop-callback?'));
    assert.ok(!redirect.headers.location?.includes('access_token'));
    const completed = await app.inject({
      method: 'POST',
      url: '/api/whoop/callback',
      payload: { state: nativeState, code: 'native-code' },
    });
    assert.equal(completed.statusCode, 200);
    await command('whoop.refresh');
    await svc.command(
      actor,
      {
        type: 'whoop.link',
        operationId: randomUUID(),
        expectedRevision: (await svc.read(actor)).revision,
        providerId: 'w2',
        sessionId,
      },
      'fictional-session',
      authorize,
    );
    assert.equal(
      (await svc.read(actor)).observations.filter((o) => o.linkedSessionId === sessionId).length,
      2,
    );

    await app.close();
    const failed = await command('whoop.connect');
    const failedState = new URL(failed.authorizationUrl!).searchParams.get('state')!;
    mode = 'token-fail';
    await assert.rejects(
      svc.callback(actor, 'fictional-session', failedState, 'bad-code', authorize),
    );
    mode = 'healthy';
    await assert.rejects(
      svc.callback(actor, 'fictional-session', failedState, 'bad-code', authorize),
      /another session/,
    );
    now = new Date(now.getTime() + 3601000);
    const beforeRotation = refreshes;
    await pool.query(
      "CREATE FUNCTION fixture_fail_observation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fictional observation failure'; END $$; CREATE TRIGGER fixture_observation_fail BEFORE INSERT OR UPDATE ON whoop_observations FOR EACH ROW EXECUTE FUNCTION fixture_fail_observation()",
    );
    await assert.rejects(svc.poll());
    assert.equal(refreshes, beforeRotation + 1);
    const durable = (await pool.query('SELECT expires_at FROM whoop_credentials')).rows[0]
      .expires_at;
    assert.equal(durable.toISOString(), new Date(now.getTime() + 3600000).toISOString());
    await pool.query(
      'DROP TRIGGER fixture_observation_fail ON whoop_observations; DROP FUNCTION fixture_fail_observation()',
    );
    const rev = (await pool.query('SELECT tokens FROM whoop_connection')).rows[0].tokens;
    assert.ok(!rev.includes('fictional-access'));
    mode = 'revoke-fail';
    const disconnect = await command('whoop.disconnect');
    assert.equal(disconnect.revocation, 'failed');
    assert.equal(revokes, 1);
    assert.equal((await pool.query('SELECT tokens FROM whoop_connection')).rows[0].tokens, null);
    assert.equal((await svc.read(actor)).observations.length, 9);
    assert.ok((await svc.read(actor)).observations.every((o) => !o.currentAccount));
    await command('whoop.delete-cache');
    assert.equal((await svc.read(actor)).observations.length, 0);
    await assert.rejects(
      svc.command(
        actor,
        {
          type: 'whoop.connect',
          channel: 'web',
          operationId: randomUUID(),
          expectedRevision: (await svc.read(actor)).revision,
        },
        'fictional-session',
        async () => {
          throw new Error('revoked session');
        },
      ),
      /revoked session/,
    );
  } finally {
    await pool.end();
  }
});
