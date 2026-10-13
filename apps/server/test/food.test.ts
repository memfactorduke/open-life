import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm, readFile, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import Fastify from 'fastify';
import { Pool } from 'pg';
import { migrate, bootstrapOwner } from '../src/database.js';
import { readConfig } from '../src/config.js';
import { migrateFeatures } from '../src/feature-migrations.js';
import { migrateFood } from '../src/food-migrations.js';
import { requireOwner } from '../src/operations.js';
import { executeFoodCommand, listFood, foodHistory } from '../src/food.js';
import {
  allocatePhoto,
  receivePhoto,
  finalizePhoto,
  readPhoto,
  reconcileMedia,
} from '../src/media.js';
import { registerFoodRoutes } from '../src/food-routes.js';
const databaseUrl =
  process.env.FOOD_TEST_DATABASE_URL ??
  'postgresql://mems_life@127.0.0.1:55432/mems_life_food_test';
if (new URL(databaseUrl).pathname !== '/mems_life_food_test')
  throw new Error('Food tests require isolated mems_life_food_test database.');
const config = readConfig({
  DATABASE_URL: databaseUrl,
  BETTER_AUTH_SECRET: 'fictional-food-test-secret-minimum-length',
  BETTER_AUTH_URL: 'http://localhost:3001',
  WEB_ORIGIN: 'http://localhost:5173',
  NODE_ENV: 'test',
});
test('PostgreSQL food revisions, history, private validated media, interruption reconciliation and HTTP bounded authorization', async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 3 });
  const directory = await mkdtemp(join(tmpdir(), 'food-fixture-'));
  const authorize = async () => {};
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await migrate(pool, config);
    await migrateFeatures(pool);
    await migrateFood(pool);
    await migrateFood(pool);
    await bootstrapOwner(pool, config, {
      email: 'food-owner@example.test',
      name: 'Food Fixture',
      password: 'fictional-food-password-123',
    });
    const actor = await requireOwner(
      pool,
      (await pool.query('SELECT owner_id FROM installation')).rows[0].owner_id,
    );
    const create = {
      type: 'food.create' as const,
      operationId: randomUUID(),
      entryId: randomUUID(),
      expectedRevision: 0 as const,
      content: {
        text: 'Fictional rice and vegetables',
        occurredAt: '2026-10-10T01:30:00.000Z',
        timezone: 'America/New_York',
      },
    };
    const created = await executeFoodCommand(pool, actor, create, authorize);
    assert.deepEqual(await executeFoodCommand(pool, actor, create, authorize), created);
    assert.equal((await listFood(pool, actor, '2026-10-09', 'America/New_York')).entries.length, 1);
    assert.equal((await listFood(pool, actor, '2026-10-10', 'America/New_York')).entries.length, 0);
    await assert.rejects(
      executeFoodCommand(
        pool,
        actor,
        { ...create, content: { ...create.content, text: 'Reused' } },
        authorize,
      ),
      /different content/,
    );
    await assert.rejects(
      executeFoodCommand(
        pool,
        actor,
        {
          type: 'food.edit',
          operationId: randomUUID(),
          entryId: create.entryId,
          expectedRevision: 9,
          content: create.content,
        },
        authorize,
      ),
      /changed/,
    );
    await assert.rejects(
      executeFoodCommand(
        pool,
        actor,
        { ...create, operationId: randomUUID(), entryId: randomUUID() },
        async () => {
          throw new Error('revoked session');
        },
      ),
      /revoked session/,
    );
    const bytes = await sharp({
      create: { width: 12, height: 12, channels: 3, background: '#98ba72' },
    })
      .jpeg()
      .toBuffer();
    const allocate = {
      operationId: randomUUID(),
      expectedRevision: 1,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      contentType: 'image/jpeg' as const,
    };
    const staged = await allocatePhoto(pool, actor, create.entryId, allocate, authorize);
    assert.deepEqual(await allocatePhoto(pool, actor, create.entryId, allocate, authorize), staged);
    await assert.rejects(
      receivePhoto(pool, actor, staged.upload.id, Buffer.from('bad'), directory, authorize),
      /checksum/,
    );
    await assert.rejects(readPhoto(pool, actor, staged.upload.id, directory), /not found/);
    await receivePhoto(pool, actor, staged.upload.id, bytes, directory, authorize);
    await receivePhoto(pool, actor, staged.upload.id, bytes, directory, authorize);
    const finalize = { operationId: randomUUID(), expectedRevision: 1 };
    const attached = await finalizePhoto(
      pool,
      actor,
      staged.upload.id,
      finalize,
      directory,
      authorize,
    );
    assert.equal(attached.entry.photoIds.length, 1);
    assert.deepEqual(
      await finalizePhoto(pool, actor, staged.upload.id, finalize, directory, authorize),
      attached,
    );
    assert.deepEqual((await readPhoto(pool, actor, staged.upload.id, directory)).bytes, bytes);
    await assert.rejects(
      readPhoto(
        pool,
        { userId: 'another-user', installationId: actor.installationId },
        staged.upload.id,
        directory,
      ),
      /does not own/,
    );
    await assert.rejects(
      receivePhoto(pool, actor, '../../unsafe', bytes, directory, authorize),
      /Invalid photo ID/,
    );
    const second = await allocatePhoto(
      pool,
      actor,
      create.entryId,
      { ...allocate, operationId: randomUUID(), expectedRevision: 2 },
      authorize,
    );
    await receivePhoto(pool, actor, second.upload.id, bytes, directory, authorize);
    // Crash gap: finalized bytes exist but transaction never committed. Reconcile recovers a known upload, then same ID finalizes.
    await writeFile(
      join(directory, 'files', second.upload.id),
      await readFile(join(directory, 'staging', second.upload.id)),
    );
    await pool.query("UPDATE food_media SET status='pending' WHERE id=$1", [second.upload.id]);
    await reconcileMedia(pool, directory);
    assert.equal(
      (await pool.query('SELECT status FROM food_media WHERE id=$1', [second.upload.id])).rows[0]
        .status,
      'received',
    );
    const twice = await finalizePhoto(
      pool,
      actor,
      second.upload.id,
      { operationId: randomUUID(), expectedRevision: 2 },
      directory,
      authorize,
    );
    assert.equal(twice.entry.photoIds.length, 2);
    const poison = Buffer.from('<script>bad</script>');
    const fake = await allocatePhoto(
      pool,
      actor,
      create.entryId,
      {
        ...allocate,
        operationId: randomUUID(),
        expectedRevision: 3,
        size: poison.length,
        sha256: createHash('sha256').update(poison).digest('hex'),
      },
      authorize,
    );
    await assert.rejects(
      receivePhoto(pool, actor, fake.upload.id, poison, directory, authorize),
      /JPEG and PNG/,
    );
    const truncated = bytes.subarray(0, 20);
    const truncatedUpload = await allocatePhoto(
      pool,
      actor,
      create.entryId,
      {
        ...allocate,
        operationId: randomUUID(),
        expectedRevision: 3,
        size: truncated.length,
        sha256: createHash('sha256').update(truncated).digest('hex'),
      },
      authorize,
    );
    await assert.rejects(
      receivePhoto(pool, actor, truncatedUpload.upload.id, truncated, directory, authorize),
      /decoded/,
    );
    const app = Fastify();
    registerFoodRoutes(
      app,
      pool,
      {
        ownerSession: async (request) => {
          if (request.headers.authorization !== 'fixture')
            throw Object.assign(new Error('Unauthenticated'), { statusCode: 401 });
          return { principal: actor };
        },
        authorizeAgain: async () => {},
      },
      { mediaDirectory: directory },
    );
    assert.equal((await app.inject({ url: `/api/media/${staged.upload.id}` })).statusCode, 401);
    const download = await app.inject({
      url: `/api/media/${staged.upload.id}`,
      headers: { authorization: 'fixture' },
    });
    assert.equal(download.statusCode, 200);
    assert.equal(download.headers['cache-control'], 'private, no-store');
    assert.equal(download.headers['x-content-type-options'], 'nosniff');
    assert.equal(
      (
        await app.inject({
          url: `/api/media/${fake.upload.id}/content`,
          method: 'PUT',
          headers: { authorization: 'fixture', 'content-type': 'application/octet-stream' },
          payload: Buffer.alloc(8388609),
        })
      ).statusCode,
      413,
    );
    // Simulated transport drops discard successful HTTP responses after PostgreSQL commits.
    // Replaying immutable allocation/finalization commands must yield the original result and one attachment.
    const allocationCommand = { ...allocate, operationId: randomUUID(), expectedRevision: 3 };
    const allocationRequest = {
      url: `/api/food/${create.entryId}/uploads`,
      method: 'POST' as const,
      headers: { authorization: 'fixture' },
      payload: allocationCommand,
    };
    const droppedAllocation = await app.inject(allocationRequest);
    assert.equal(droppedAllocation.statusCode, 200);
    const recoveredAllocation = await app.inject(allocationRequest);
    assert.deepEqual(recoveredAllocation.json(), droppedAllocation.json());
    const recoveredId = recoveredAllocation.json().upload.id;
    assert.equal(
      (
        await app.inject({
          url: `/api/media/${recoveredId}/content`,
          method: 'PUT',
          headers: { authorization: 'fixture', 'content-type': 'application/octet-stream' },
          payload: bytes,
        })
      ).statusCode,
      200,
    );
    const finalizationCommand = { operationId: randomUUID(), expectedRevision: 3 };
    const finalizationRequest = {
      url: `/api/media/${recoveredId}/finalize`,
      method: 'POST' as const,
      headers: { authorization: 'fixture' },
      payload: finalizationCommand,
    };
    const droppedFinalization = await app.inject(finalizationRequest);
    assert.equal(droppedFinalization.statusCode, 200);
    const recoveredFinalization = await app.inject(finalizationRequest);
    assert.deepEqual(recoveredFinalization.json(), droppedFinalization.json());
    assert.equal(
      recoveredFinalization.json().entry.photoIds.filter((id: string) => id === recoveredId).length,
      1,
    );
    const interrupted = await allocatePhoto(
      pool,
      actor,
      create.entryId,
      { ...allocate, operationId: randomUUID(), expectedRevision: 4 },
      authorize,
    );
    await writeFile(join(directory, 'staging', interrupted.upload.id), bytes.subarray(0, 4));
    await reconcileMedia(pool, directory);
    assert.equal(
      (await pool.query('SELECT status FROM food_media WHERE id=$1', [interrupted.upload.id]))
        .rows[0].status,
      'pending',
    );
    await assert.rejects(
      receivePhoto(pool, actor, interrupted.upload.id, bytes, directory, authorize),
      /interrupted upload was cleared/,
    );
    await receivePhoto(pool, actor, interrupted.upload.id, bytes, directory, authorize);
    const linkedDirectory = directory + '-symlink';
    await symlink(directory, linkedDirectory);
    await assert.rejects(
      readPhoto(pool, actor, staged.upload.id, linkedDirectory),
      /symbolic link/,
    );
    await rm(linkedDirectory);
    await app.close();
    const deleted = await executeFoodCommand(
      pool,
      actor,
      {
        type: 'food.delete',
        entryId: create.entryId,
        operationId: randomUUID(),
        expectedRevision: 4,
      },
      authorize,
    );
    assert.ok(deleted.entry.deletedAt);
    assert.equal((await listFood(pool, actor)).entries.length, 0);
    await assert.rejects(readPhoto(pool, actor, staged.upload.id, directory), /not found/);
    await assert.rejects(
      finalizePhoto(
        pool,
        actor,
        fake.upload.id,
        { operationId: randomUUID(), expectedRevision: 4 },
        directory,
        authorize,
      ),
      /not found/,
    );
    assert.equal((await foodHistory(pool, actor, create.entryId)).events.length, 5);
    assert.equal(
      (await pool.query("SELECT count(*) FROM change_feed WHERE record_type='food'")).rows[0].count,
      '5',
    );
  } finally {
    await pool.end();
    await rm(directory, { recursive: true, force: true });
  }
});
