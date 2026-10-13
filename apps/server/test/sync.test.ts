import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { migrate, bootstrapOwner, transaction } from '../src/database.js';
import { migrateSync } from '../src/sync-migrations.js';
import { readConfig } from '../src/config.js';
import { requireOwner } from '../src/operations.js';
import {
  createSyncSnapshot,
  readSyncSnapshot,
  readSyncChanges,
  retainSyncChanges,
} from '../src/sync.js';
import { executeTaskCommand } from '../src/tasks.js';
import { featureOperation } from '../src/feature-migrations.js';
import { createApp } from '../src/app.js';
const databaseUrl =
  process.env.SYNC_TEST_DATABASE_URL ??
  'postgresql://mems_life@127.0.0.1:55432/mems_life_sync_test';
if (new URL(databaseUrl).pathname !== '/mems_life_sync_test')
  throw new Error('Sync tests require isolated mems_life_sync_test.');
const config = readConfig({
  DATABASE_URL: databaseUrl,
  BETTER_AUTH_SECRET: 'fictional-sync-secret-at-least-32-characters',
  BETTER_AUTH_URL: 'http://localhost:3001',
  WEB_ORIGIN: 'http://localhost:5173',
  NODE_ENV: 'test',
});
const authorize = async () => {};
test('PostgreSQL frozen snapshot, catalogue, commit pagination, revocation, expiry, retention and restore epochs', async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 5 });
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await migrate(pool, config);
    await migrateSync(pool);
    await migrateSync(pool);
    await bootstrapOwner(pool, config, {
      email: 'sync@example.test',
      name: 'Sync Fixture',
      password: 'fictional-sync-password-123',
    });
    const actor = await requireOwner(
      pool,
      (await pool.query('SELECT owner_id FROM installation')).rows[0].owner_id,
    );
    const providerAccount = randomUUID();
    await pool.query(
      "INSERT INTO whoop_connection(owner_id,status,account_id,revision) VALUES($1,'connected',$2,1)",
      [actor.userId, providerAccount],
    );
    await pool.query(
      "INSERT INTO whoop_credentials(owner_id,account_id,tokens,expires_at) VALUES($1,$2,'fictional-secret-never-cache',now()+interval '1 hour')",
      [actor.userId, providerAccount],
    );
    const requestId = randomUUID();
    const boot = await createSyncSnapshot(pool, actor, requestId, authorize);
    assert.equal(boot.watermark, '0');
    assert.equal(boot.records.filter((r) => r.recordType === 'exercise').length, 8);
    assert.deepEqual(await createSyncSnapshot(pool, actor, requestId, authorize), boot);
    const taskId = randomUUID();
    await executeTaskCommand(
      pool,
      actor,
      {
        type: 'task.create',
        operationId: randomUUID(),
        taskId,
        expectedRevision: 0,
        content: { title: 'Fictional offline task', description: '', notes: '' },
      },
      authorize,
    );
    const frozen = await readSyncSnapshot(pool, actor, boot.snapshotId, '0', 1);
    assert.equal(frozen.watermark, '0');
    assert.equal(frozen.records.length, 1);
    const all = [...frozen.records];
    let cursor = frozen.nextCursor;
    while (cursor !== null) {
      const p = await readSyncSnapshot(pool, actor, boot.snapshotId, cursor, 1);
      assert.equal(p.watermark, '0');
      all.push(...p.records);
      cursor = p.nextCursor;
    }
    assert.equal(all.length, 10);
    assert.equal(JSON.stringify(all).includes('fictional-secret-never-cache'), false);
    assert.equal(
      all.some((r) => r.id === taskId),
      false,
    );
    const first = await readSyncChanges(pool, actor, boot.epoch, '0', 1);
    assert.equal(first.records[0]?.id, taskId);
    assert.equal(first.cursor, '1');
    await featureOperation(
      pool,
      actor,
      { type: 'fictional.multi', operationId: randomUUID() },
      authorize,
      async () => ({
        result: { ok: true },
        records: [0, 1, 2].map((n) => ({
          recordType: 'task' as const,
          id: randomUUID(),
          revision: 1,
          value: { fixture: n },
          eventType: 'fixture',
        })),
      }),
    );
    await featureOperation(
      pool,
      actor,
      { type: 'fictional.empty', operationId: randomUUID() },
      authorize,
      async () => ({ result: { ok: true }, records: [] }),
    );
    const whole = await readSyncChanges(pool, actor, boot.epoch, '1', 1);
    assert.equal(whole.records.length, 3);
    assert.deepEqual(
      whole.records.map((r) => r.ordinal),
      [0, 1, 2],
    );
    assert.equal(new Set(whole.records.map((r) => r.position)).size, 1);
    assert.equal(whole.cursor, '3');
    assert.equal(whole.hasMore, false);
    // An uncommitted writer blocks the snapshot's short owner lock. Its committed record and watermark arrive together.
    let unlock!: () => void, entered!: () => void;
    const gate = new Promise<void>((r) => {
      unlock = r;
    });
    const ready = new Promise<void>((r) => {
      entered = r;
    });
    const writer = transaction(pool, async (client) => {
      await client.query('SELECT id FROM installation WHERE owner_id=$1 FOR UPDATE', [
        actor.userId,
      ]);
      entered();
      await gate;
      await client.query(
        'UPDATE installation SET feed_position=feed_position+1 WHERE owner_id=$1',
        [actor.userId],
      );
      await client.query(
        "UPDATE tasks SET revision=2,content=jsonb_set(content,'{title}','\"Committed concurrent title\"') WHERE id=$1",
        [taskId],
      );
      await client.query(
        "INSERT INTO change_feed(owner_id,position,ordinal,operation_id,record_type,record_id,revision,value) SELECT owner_id,feed_position,0,$2,'task',$3,2,'{\"fixture\":true}'::jsonb FROM installation WHERE owner_id=$1",
        [actor.userId, randomUUID(), taskId],
      );
    });
    await ready;
    const concurrent = createSyncSnapshot(pool, actor, randomUUID(), authorize);
    unlock();
    await writer;
    const snap = await concurrent;
    assert.equal(snap.watermark, '4');
    assert.equal(snap.records.find((r) => r.id === taskId)?.revision, 2);
    const writes = await Promise.all(
      Array.from({ length: 5 }, (_, n) =>
        featureOperation(
          pool,
          actor,
          { type: 'fixture.competing', operationId: randomUUID() },
          authorize,
          async () => ({
            result: { n },
            records: [
              {
                recordType: 'task',
                id: randomUUID(),
                revision: 1,
                value: { n },
                eventType: 'fixture',
              },
            ],
          }),
        ),
      ),
    );
    const positions = writes
      .map((r) => r.feedPosition)
      .sort((a, b) => Number(BigInt(a) - BigInt(b)));
    assert.deepEqual(positions, ['5', '6', '7', '8', '9']);
    const seen: string[] = [];
    let feedCursor = '4';
    for (;;) {
      const p = await readSyncChanges(pool, actor, boot.epoch, feedCursor, 1);
      seen.push(...p.records.map((r) => r.position));
      assert.ok(BigInt(p.cursor) > BigInt(feedCursor));
      feedCursor = p.cursor;
      if (!p.hasMore) break;
    }
    assert.deepEqual(seen, positions);
    await assert.rejects(
      readSyncChanges(pool, actor, boot.epoch, '0', 100, async () => {
        throw new Error('revoked session');
      }),
      /revoked session/,
    );
    await assert.rejects(
      createSyncSnapshot(pool, { ...actor, userId: 'foreign' }, randomUUID(), authorize),
      /does not own/,
    );
    await assert.rejects(
      readSyncSnapshot(pool, { ...actor, actorType: 'agent' }, snap.snapshotId),
      /owner session/,
    );
    const expired = await createSyncSnapshot(pool, actor, randomUUID(), authorize);
    await pool.query("UPDATE sync_snapshots SET expires_at=now()-interval '1 minute' WHERE id=$1", [
      expired.snapshotId,
    ]);
    await assert.rejects(
      readSyncSnapshot(pool, actor, expired.snapshotId),
      (e) => (e as { code: string }).code === 'SYNC_SNAPSHOT_EXPIRED',
    );
    await retainSyncChanges(pool, actor, '2');
    await assert.rejects(
      readSyncChanges(pool, actor, boot.epoch, '1'),
      (e) => (e as { code: string }).code === 'SYNC_CURSOR_EXPIRED',
    );
    assert.equal(
      (
        await pool.query('SELECT count(*) FROM sync_snapshot_records WHERE snapshot_id=$1', [
          expired.snapshotId,
        ])
      ).rows[0].count,
      '0',
    );
    await pool.query('UPDATE tasks SET deleted_at=now() WHERE id=$1', [taskId]);
    const tomb = await createSyncSnapshot(pool, actor, randomUUID(), authorize);
    assert.ok(
      (tomb.records.find((r) => r.id === taskId)?.value as { deletedAt: string }).deletedAt,
    );
    const nextEpoch = randomUUID();
    await pool.query('UPDATE installation SET epoch=$1', [nextEpoch]);
    await assert.rejects(
      readSyncChanges(pool, actor, boot.epoch, '4'),
      (e) => (e as { code: string }).code === 'SYNC_EPOCH_CHANGED',
    );
    await assert.rejects(
      readSyncSnapshot(pool, actor, snap.snapshotId),
      (e) => (e as { code: string }).code === 'SYNC_EPOCH_CHANGED',
    );
    const restored = await createSyncSnapshot(pool, actor, randomUUID(), authorize);
    assert.equal(restored.epoch, nextEpoch);
    const { app } = await createApp(config, pool);
    try {
      assert.equal(
        (await app.inject({ method: 'GET', url: '/api/sync/changes?epoch=' + nextEpoch }))
          .statusCode,
        401,
      );
      assert.equal(
        (
          await app.inject({
            method: 'POST',
            url: '/api/sync/snapshots',
            payload: { requestId: randomUUID(), schemaVersion: 1 },
          })
        ).statusCode,
        403,
      );
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        headers: { origin: config.WEB_ORIGIN },
        payload: { email: 'sync@example.test', password: 'fictional-sync-password-123' },
      });
      assert.equal(login.statusCode, 200);
      const raw = login.headers['set-cookie'];
      const cookie = (Array.isArray(raw) ? raw : [raw])
        .filter(Boolean)
        .map((v) => String(v).split(';')[0])
        .join('; ');
      const page = await app.inject({
        method: 'GET',
        url: '/api/sync/changes?epoch=' + nextEpoch + '&cursor=4',
        headers: { cookie },
      });
      assert.equal(page.statusCode, 200);
      assert.equal(page.json().epoch, nextEpoch);
      assert.equal(
        (
          await app.inject({
            method: 'POST',
            url: '/api/sync/snapshots',
            headers: { cookie, origin: config.WEB_ORIGIN },
            payload: { requestId: randomUUID(), schemaVersion: 2 },
          })
        ).statusCode,
        400,
      );
      await pool.query('DELETE FROM session');
      assert.equal(
        (
          await app.inject({
            method: 'GET',
            url: '/api/sync/changes?epoch=' + nextEpoch,
            headers: { cookie },
          })
        ).statusCode,
        401,
      );
    } finally {
      await app.close();
    }
    await transaction(pool, async (client) => {
      await client.query('SELECT id FROM installation WHERE owner_id=$1 FOR UPDATE', [
        actor.userId,
      ]);
      await client.query(
        'UPDATE installation SET feed_position=feed_position+1 WHERE owner_id=$1',
        [actor.userId],
      );
      await client.query(
        "INSERT INTO change_feed(owner_id,position,ordinal,operation_id,record_type,record_id,revision,value) SELECT owner_id,feed_position,n,$2,'task',$3,1,'{}'::jsonb FROM installation CROSS JOIN generate_series(0,10000) n WHERE owner_id=$1",
        [actor.userId, randomUUID(), randomUUID()],
      );
    });
    await assert.rejects(
      readSyncChanges(pool, actor, nextEpoch, '9', 1),
      (e) => (e as { code: string }).code === 'SYNC_TRANSACTION_TOO_LARGE',
    );
  } finally {
    await pool.end();
  }
});
