import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import Fastify from 'fastify';
import { migrate, bootstrapOwner } from '../src/database.js';
import { readConfig } from '../src/config.js';
import { requireOwner } from '../src/operations.js';
import { executeTaskCommand } from '../src/tasks.js';
import { executeFoodCommand } from '../src/food.js';
import { executeSessionCommand } from '../src/sessions.js';
import {
  readAttention,
  readNotificationPreferences,
  updateNotificationPreferences,
  registerNotificationDevice,
  reconcileAttention,
  deliverNotifications,
  ExpoPushProvider,
  type PushProvider,
} from '../src/attention.js';
import { registerAttentionRoutes } from '../src/attention-routes.js';
const databaseUrl =
  process.env.ATTENTION_TEST_DATABASE_URL ??
  'postgresql://mems_life@127.0.0.1:55432/mems_life_attention_test';
if (new URL(databaseUrl).pathname !== '/mems_life_attention_test')
  throw new Error('Attention tests require isolated mems_life_attention_test.');
const config = readConfig({
  DATABASE_URL: databaseUrl,
  BETTER_AUTH_SECRET: 'fictional-attention-test-secret-at-least-32',
  BETTER_AUTH_URL: 'http://localhost:3001',
  WEB_ORIGIN: 'http://localhost:5173',
  NODE_ENV: 'test',
});
test('PostgreSQL attention remains available; durable dedupe, owner opt-in, session revocation, private payload and receipt errors', async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const authorize = async () => {};
  try {
    await pool.query('DROP SCHEMA public CASCADE;CREATE SCHEMA public');
    await migrate(pool, config);
    await bootstrapOwner(pool, config, {
      email: 'attention@example.test',
      name: 'Fictional Attention',
      password: 'fictional-password-123',
    });
    const owner = (await pool.query('SELECT owner_id FROM installation')).rows[0].owner_id;
    const actor = await requireOwner(pool, owner);
    const taskId = randomUUID();
    let response = await executeTaskCommand(
      pool,
      actor,
      {
        type: 'task.create',
        operationId: randomUUID(),
        taskId,
        expectedRevision: 0,
        content: { title: 'Private fictional task title', description: '', notes: '' },
      },
      authorize,
    );
    response = await executeTaskCommand(
      pool,
      actor,
      {
        type: 'task.move',
        operationId: randomUUID(),
        taskId,
        expectedRevision: response.task.revision,
        phase: 'next',
        beforeTaskId: null,
      },
      authorize,
    );
    await executeTaskCommand(
      pool,
      actor,
      {
        type: 'task.schedule',
        operationId: randomUUID(),
        taskId,
        expectedRevision: response.task.revision,
        dueAt: '2026-01-01T00:00:00.000Z',
        scheduledAt: null,
      },
      authorize,
    );
    const attention = await readAttention(pool, actor);
    assert.equal(attention.items[0]?.kind, 'due');
    assert.equal(attention.food.count, 0);
    assert.equal(attention.activeSession, null);
    await pool.query(
      "UPDATE owner_preferences SET value=jsonb_set(value,'{timeZone}', '\"America/New_York\"') WHERE owner_id=$1",
      [owner],
    );
    const foodId = randomUUID();
    await executeFoodCommand(
      pool,
      actor,
      {
        type: 'food.create',
        operationId: randomUUID(),
        entryId: foodId,
        expectedRevision: 0,
        content: {
          text: 'Fictional breakfast',
          occurredAt: '2026-10-13T00:20:00.000Z',
          timezone: 'America/New_York',
        },
      },
      authorize,
    );
    await executeFoodCommand(
      pool,
      actor,
      {
        type: 'food.create',
        operationId: randomUUID(),
        entryId: randomUUID(),
        expectedRevision: 0,
        content: {
          text: 'Fictional next day',
          occurredAt: '2026-10-13T05:00:00.000Z',
          timezone: 'America/New_York',
        },
      },
      authorize,
    );
    const workoutId = randomUUID();
    await executeSessionCommand(
      pool,
      actor,
      {
        type: 'session.start',
        operationId: randomUUID(),
        sessionId: workoutId,
        expectedRevision: 0,
        name: 'Fictional training',
        routineId: null,
        expectedRoutineRevision: null,
      },
      authorize,
    );
    const day = await readAttention(pool, actor, '2026-10-13T00:30:00.000Z');
    assert.equal(day.date, '2026-10-12');
    assert.equal(day.food.count, 1);
    assert.equal(day.food.entries[0]?.id, foodId);
    assert.equal(day.activeSession?.id, workoutId);
    await reconcileAttention(pool);
    await reconcileAttention(pool);
    assert.equal(
      Number((await pool.query('SELECT count(*) FROM attention_events')).rows[0].count),
      1,
    );
    assert.equal((await readNotificationPreferences(pool, actor)).value.enabled, false);
    const sessionId = randomUUID();
    await pool.query(
      'INSERT INTO session(id,token,"userId","expiresAt","updatedAt") VALUES($1,$2,$3,now()+interval \'1 day\',now())',
      [sessionId, randomUUID(), owner],
    );
    const deviceId = randomUUID(),
      token = 'ExpoPushToken[fictional_device]';
    await assert.rejects(
      registerNotificationDevice(
        pool,
        actor,
        sessionId,
        { deviceId, token, expectedPreferenceRevision: 0 },
        authorize,
      ),
      /Enable notifications/,
    );
    const preferences = await updateNotificationPreferences(
      pool,
      actor,
      {
        operationId: randomUUID(),
        expectedRevision: 0,
        value: { enabled: true, due: true, handoff: true, failure: true },
      },
      authorize,
    );
    await registerNotificationDevice(
      pool,
      actor,
      sessionId,
      { deviceId, token, expectedPreferenceRevision: preferences.revision },
      authorize,
    );
    const foreignId = randomUUID();
    await pool.query(
      'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,false,now(),now())',
      [foreignId, 'Foreign fixture', `${foreignId}@example.test`],
    );
    const foreignDevice = randomUUID();
    await pool.query(
      'INSERT INTO notification_devices(id,owner_id,session_id,token) VALUES($1,$2,$3,$4)',
      [foreignDevice, foreignId, 'foreign-session', 'ExpoPushToken[foreign_fixture]'],
    );
    await assert.rejects(
      registerNotificationDevice(
        pool,
        actor,
        sessionId,
        {
          deviceId: randomUUID(),
          token: 'ExpoPushToken[foreign_fixture]',
          expectedPreferenceRevision: 1,
        },
        authorize,
      ),
      /belongs to another owner/,
    );
    await assert.rejects(readAttention(pool, { ...actor, userId: foreignId }), /does not own/);
    let sends = 0;
    const provider: PushProvider = {
      send: async (messages) => {
        sends++;
        assert.equal(messages.length, 1);
        assert.equal(JSON.stringify(messages).includes('Private fictional task'), false);
        assert.deepEqual(messages[0]?.data.route, { kind: 'task', id: taskId });
        return [{ status: 'ok', id: 'fixture-ticket' }];
      },
      receipts: async () => ({
        'fixture-ticket': { status: 'error', details: { error: 'DeviceNotRegistered' } },
      }),
    };
    await reconcileAttention(pool, provider);
    await reconcileAttention(pool, provider);
    assert.equal(sends, 1);
    assert.equal(
      (await pool.query('SELECT status FROM notification_deliveries')).rows[0].status,
      'accepted',
    );
    await deliverNotifications(pool, provider, new Date(Date.now() + 16 * 60 * 1000).toISOString());
    assert.equal(
      (await pool.query('SELECT status FROM notification_deliveries')).rows[0].status,
      'errored',
    );
    assert.equal(
      (await pool.query('SELECT active FROM notification_devices WHERE id=$1', [deviceId])).rows[0]
        .active,
      false,
    );
    assert.equal(
      Number((await pool.query('SELECT count(*) FROM attention_events')).rows[0].count),
      1,
    );
    // A receipt error retires the token; stale preference revisions cannot register again.
    await assert.rejects(
      registerNotificationDevice(
        pool,
        actor,
        sessionId,
        { deviceId, token, expectedPreferenceRevision: 0 },
        authorize,
      ),
      /Enable notifications/,
    );
    await registerNotificationDevice(
      pool,
      actor,
      sessionId,
      { deviceId, token, expectedPreferenceRevision: preferences.revision },
      authorize,
    );
    await pool.query('DELETE FROM session WHERE id=$1', [sessionId]);
    await reconcileAttention(pool);
    assert.equal(
      (await pool.query('SELECT active FROM notification_devices WHERE id=$1', [deviceId])).rows[0]
        .active,
      false,
    );
    await assert.rejects(
      registerNotificationDevice(
        pool,
        actor,
        sessionId,
        { deviceId, token, expectedPreferenceRevision: preferences.revision },
        authorize,
      ),
      /Sign in again/,
    );
    await updateNotificationPreferences(
      pool,
      actor,
      {
        operationId: randomUUID(),
        expectedRevision: 1,
        value: { enabled: false, due: true, handoff: true, failure: true },
      },
      authorize,
    );
    assert.equal((await readAttention(pool, actor)).items.length, 1);
    const replacementSession = randomUUID();
    await pool.query(
      'INSERT INTO session(id,token,"userId","expiresAt","updatedAt") VALUES($1,$2,$3,now()+interval \'1 day\',now())',
      [replacementSession, randomUUID(), owner],
    );
    await updateNotificationPreferences(
      pool,
      actor,
      {
        operationId: randomUUID(),
        expectedRevision: 2,
        value: { enabled: true, due: true, handoff: true, failure: true },
      },
      authorize,
    );
    const newDevice = randomUUID();
    await registerNotificationDevice(
      pool,
      actor,
      replacementSession,
      {
        deviceId: newDevice,
        token: 'ExpoPushToken[replacement_fixture]',
        expectedPreferenceRevision: 3,
      },
      authorize,
    );
    const forbidden = new ExpoPushProvider(
      undefined,
      async () => new Response('', { status: 401 }),
    );
    await reconcileAttention(pool, forbidden);
    assert.equal(
      (
        await pool.query('SELECT status FROM notification_deliveries WHERE device_id=$1', [
          newDevice,
        ])
      ).rows[0].status,
      'errored',
    );
    assert.equal(
      Number((await pool.query('SELECT count(*) FROM attention_events')).rows[0].count),
      1,
    );
    const retryDevice = randomUUID();
    await registerNotificationDevice(
      pool,
      actor,
      replacementSession,
      {
        deviceId: retryDevice,
        token: 'ExpoPushToken[retry_fixture]',
        expectedPreferenceRevision: 3,
      },
      authorize,
    );
    const throttled = new ExpoPushProvider(
      undefined,
      async () => new Response('', { status: 429 }),
    );
    await reconcileAttention(pool, throttled);
    const retry = (
      await pool.query(
        'SELECT status,attempts,next_attempt_at FROM notification_deliveries WHERE device_id=$1',
        [retryDevice],
      )
    ).rows[0];
    assert.equal(retry.status, 'pending');
    assert.equal(retry.attempts, 1);
    assert.ok(retry.next_attempt_at.getTime() > Date.now());
    const acceptedProvider: PushProvider = {
      send: async () => [{ status: 'ok', id: 'retry-ticket' }],
      receipts: async () => ({ 'retry-ticket': { status: 'ok' } }),
    };
    await deliverNotifications(
      pool,
      acceptedProvider,
      new Date(Date.now() + 2 * 60 * 1000).toISOString(),
    );
    assert.equal(
      (
        await pool.query('SELECT status FROM notification_deliveries WHERE device_id=$1', [
          retryDevice,
        ])
      ).rows[0].status,
      'accepted',
    );
    await deliverNotifications(
      pool,
      acceptedProvider,
      new Date(Date.now() + 18 * 60 * 1000).toISOString(),
    );
    assert.equal(
      (
        await pool.query('SELECT status FROM notification_deliveries WHERE device_id=$1', [
          retryDevice,
        ])
      ).rows[0].status,
      'provider-accepted',
    );
    await pool.query('UPDATE portability_control SET maintenance=true');
    await assert.rejects(reconcileAttention(pool), /paused for recovery/);
    await pool.query('UPDATE portability_control SET maintenance=false');
    const app = Fastify();
    registerAttentionRoutes(
      app,
      pool,
      { ownerSession: async () => ({ principal: actor }), authorizeAgain: async () => {} },
      { pollIntervalMs: 100000 },
    );
    try {
      assert.equal((await app.inject({ method: 'GET', url: '/api/attention' })).statusCode, 200);
      assert.equal(
        (
          await app.inject({
            method: 'POST',
            url: '/api/notifications/devices',
            payload: { deviceId, token, expectedPreferenceRevision: 2 },
          })
        ).statusCode,
        401,
      );
    } finally {
      await app.close();
    }
  } finally {
    await pool.end();
  }
});
test('Expo protocol validates batches, rejects invalid receipts, distinguishes accepted ticket and handles HTTP failure', async () => {
  let requests = 0;
  const fetcher: typeof fetch = async (_url, options) => {
    requests++;
    const messages = JSON.parse(String(options?.body));
    assert.equal(messages.length, 1);
    return new Response(JSON.stringify({ data: [{ status: 'ok', id: 'fixture-ticket' }] }), {
      status: 200,
    });
  };
  const provider = new ExpoPushProvider(undefined, fetcher);
  const message = {
    to: 'ExpoPushToken[fictional]',
    title: 'Mem’s Life',
    body: 'Generic',
    data: { route: { kind: 'task' as const, id: randomUUID() } },
    sound: 'default' as const,
  };
  assert.equal((await provider.send([message]))[0]?.status, 'ok');
  assert.equal(requests, 1);
  await assert.rejects(provider.send(Array.from({ length: 101 }, () => message)), /at most 100/);
  const bad = new ExpoPushProvider(
    undefined,
    async () => new Response(JSON.stringify({ data: { ticket: { status: 'unexpected' } } })),
  );
  await assert.rejects(bad.receipts(['ticket']), /Invalid Expo/);
  const forbidden = new ExpoPushProvider(
    'fictional-token',
    async () => new Response('', { status: 401 }),
  );
  await assert.rejects(
    forbidden.send([message]),
    (error) =>
      error instanceof Error &&
      error.message === 'Expo HTTP 401' &&
      (error as Error & { retryable: boolean }).retryable === false,
  );
  const transient = new ExpoPushProvider(undefined, async () => new Response('', { status: 429 }));
  await assert.rejects(
    transient.send([message]),
    (error) =>
      error instanceof Error && (error as Error & { retryable: boolean }).retryable === true,
  );
});
