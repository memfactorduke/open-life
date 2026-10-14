// Real PostgreSQL/createApp HTTP protocol and file-backed node:sqlite seam.
// This proves protocol/storage integration, not Expo driver or physical-device behavior.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { register } from 'tsx/esm/api';
import { Pool } from 'pg';
import sharp from 'sharp';
register();
const { createApp } = await import('../apps/server/src/app.ts');
const { migrate, bootstrapOwner } = await import('../apps/server/src/database.ts');
const { readConfig } = await import('../apps/server/src/config.ts');
const mod = await import('../apps/mobile/src/offline/index.ts');
const { OfflineStore, OfflineCoordinator } = mod.default ?? mod;
const domain = await import('@mems-life/domain');
const run = promisify(execFile);
const url =
  process.env.OFFLINE_LIVE_TEST_DATABASE_URL ??
  'postgresql://mems_life@127.0.0.1:55432/mems_life_offline_live_test';
const parsed = new URL(url);
assert.equal(parsed.pathname, '/mems_life_offline_live_test');
assert.equal(parsed.hostname, '127.0.0.1');
assert.equal(parsed.port, '55432');
assert.equal(parsed.username, 'mems_life');
const admin = new Pool({ connectionString: new URL('/postgres', parsed).href });
try {
  if (
    !(
      await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [
        'mems_life_offline_live_test',
      ])
    ).rowCount
  )
    await admin.query('CREATE DATABASE mems_life_offline_live_test');
} finally {
  await admin.end();
}
const pool = new Pool({ connectionString: url, max: 5 });
const folder = await realpath(await mkdtemp(join(tmpdir(), 'mems-offline-live-')));
const media = join(folder, 'media');
await mkdir(media);
let app, db, store, cookie;
const report = {
  kind: 'PostgreSQL/createApp + file-backed node:sqlite integration',
  deviceProof: false,
  database: parsed.pathname.slice(1),
  checks: [],
  requests: [],
};
const check = (name, evidence) => {
  report.checks.push({ name, ...evidence });
  console.log(`PASS: ${name}`);
};
const config = (directory) =>
  readConfig({
    DATABASE_URL: url,
    MEDIA_DIRECTORY: directory,
    BETTER_AUTH_SECRET: 'fictional-offline-live-auth-secret-123456789',
    BETTER_AUTH_URL: 'http://localhost:3001',
    WEB_ORIGIN: 'http://localhost:5173',
    NODE_ENV: 'test',
  });
async function login() {
  const reply = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    headers: { origin: 'http://localhost:5173' },
    payload: { email: 'offline-live@example.test', password: 'fictional-password-123456' },
  });
  assert.equal(reply.statusCode, 200);
  const raw = reply.headers['set-cookie'];
  cookie = (Array.isArray(raw) ? raw : [raw])
    .filter(Boolean)
    .map((v) => String(v).split(';')[0])
    .join('; ');
}
async function request(path, payload, method = payload === undefined ? 'GET' : 'POST', epoch) {
  const response = await app.inject({
    method,
    url: path,
    payload,
    headers: {
      cookie,
      origin: 'http://localhost:5173',
      ...(epoch ? { 'X-Mems-Life-Epoch': epoch } : {}),
      ...(Buffer.isBuffer(payload) ? { 'content-type': 'application/octet-stream' } : {}),
    },
  });
  report.requests.push({ method, path, status: response.statusCode });
  if (response.statusCode >= 400) {
    const failure = response.json().error;
    throw Object.assign(new Error(failure.message), {
      status: response.statusCode,
      code: failure.code,
      details: failure.details,
      epoch: failure.details?.epoch,
    });
  }
  return response;
}
function openSQLite(identity) {
  db = new DatabaseSync(join(folder, 'device.sqlite'));
  const executor = {
    exec: async (s) => db.exec(s),
    run: async (s, ...p) => {
      db.prepare(s).run(...p);
    },
    all: async (s, ...p) => db.prepare(s).all(...p),
  };
  const adapter = {
    ...executor,
    close: async () => db.close(),
    transaction: async (work) => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const value = await work(executor);
        db.exec('COMMIT');
        return value;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
  store = new OfflineStore(adapter, identity);
  return store.initialize();
}
let lossId;
const sends = [];
const transport = {
  snapshot: async (requestId, snapshotId, cursor) =>
    domain.SyncSnapshotPageSchema.parse(
      (
        await request(
          snapshotId
            ? `/api/sync/snapshots/${snapshotId}?cursor=${cursor}&limit=2`
            : '/api/sync/snapshots',
          snapshotId ? undefined : { requestId, schemaVersion: 1 },
        )
      ).json(),
    ),
  changes: async (epoch, cursor) =>
    domain.SyncChangesPageSchema.parse(
      (await request(`/api/sync/changes?epoch=${epoch}&cursor=${cursor}&limit=2`)).json(),
    ),
  send: async (command) => {
    const type = command.type.split('.')[0];
    sends.push(JSON.stringify(command));
    const response = (
      await request(
        `/api/${type === 'task' ? 'tasks' : type === 'session' ? 'sessions' : 'food'}/commands`,
        command,
        'POST',
        (await store.state()).epoch,
      )
    ).json();
    const value =
      type === 'task'
        ? domain.TaskCommandResponseSchema.parse(response).task
        : type === 'session'
          ? domain.SessionCommandResponseSchema.parse(response).session
          : domain.FoodCommandResponseSchema.parse(response).entry;
    if (command.operationId === lossId) {
      lossId = undefined;
      throw new Error('Deliberately dropped successful HTTP response after actual database commit');
    }
    return [{ recordType: type, id: value.id, revision: value.revision, value }];
  },
};
const receiptCount = async (id) =>
  Number(
    (await pool.query('SELECT count(*) FROM operation_receipts WHERE operation_id=$1', [id]))
      .rows[0].count,
  );
const foodCommand = () => ({
  type: 'food.create',
  operationId: randomUUID(),
  entryId: randomUUID(),
  expectedRevision: 0,
  content: {
    text: 'Fictional retained lunch',
    occurredAt: '2026-10-13T12:00:00.000Z',
    timezone: 'UTC',
  },
});
try {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  await migrate(pool, config(media));
  await bootstrapOwner(pool, config(media), {
    email: 'offline-live@example.test',
    name: 'Fictional Offline Owner',
    password: 'fictional-password-123456',
  });
  app = (await createApp(config(media), pool)).app;
  await login();
  const installation = (await pool.query('SELECT id,owner_id,epoch FROM installation')).rows[0];
  const identity = { ownerId: installation.owner_id, installationId: installation.id };
  await openSQLite(identity);
  let coordinator = new OfflineCoordinator(store, transport, randomUUID);
  await coordinator.bootstrap();
  const exercise = (await store.records('exercise'))
    .map((r) => r.value)
    .find((e) => e.mode === 'weighted');
  const routineId = randomUUID(),
    routineItem = randomUUID(),
    routineTarget = randomUUID(),
    sessionItem = randomUUID(),
    sessionTarget = randomUUID(),
    sessionId = randomUUID(),
    setId = randomUUID();
  await request(
    '/api/routines/commands',
    {
      type: 'routine.create',
      operationId: randomUUID(),
      routineId,
      expectedRevision: 0,
      content: {
        name: 'Fictional caller ID plan',
        notes: '',
        items: [
          {
            id: routineItem,
            exerciseId: exercise.id,
            snapshot: {
              name: exercise.name,
              mode: exercise.mode,
              supportsLoad: exercise.supportsLoad,
            },
            targets: [
              {
                id: routineTarget,
                kind: 'working',
                measurements: { mode: 'weighted', reps: 5, loadKg: 40 },
                notes: '',
              },
            ],
            notes: '',
          },
        ],
      },
    },
    'POST',
    installation.epoch,
  );
  await coordinator.sync();
  const start = {
    type: 'session.start',
    operationId: randomUUID(),
    sessionId,
    expectedRevision: 0,
    name: 'Fictional offline workout',
    routineId,
    expectedRoutineRevision: 1,
    itemIdentities: [
      {
        routineItemId: routineItem,
        itemId: sessionItem,
        targets: [{ routineTargetId: routineTarget, targetId: sessionTarget }],
      },
    ],
  };
  const workoutStart = '2026-10-09T20:00:00.000Z';
  const workoutSet = '2026-10-09T20:10:00.000Z';
  const workoutFinish = '2026-10-09T21:00:00.000Z';
  await store.save(start, { now: workoutStart });
  const originalStartPayload = (await store.outbox())[0].payload;
  await store.save(start, { now: workoutFinish });
  assert.equal((await store.outbox())[0].payload, originalStartPayload);
  await assert.rejects(store.save({ ...start, occurredAt: workoutFinish }), /operation ID/);
  await store.save(
    {
      type: 'session.record-set',
      operationId: randomUUID(),
      sessionId,
      expectedRevision: 1,
      itemId: sessionItem,
      setId,
      kind: 'working',
      measurements: { mode: 'weighted', reps: 4, loadKg: 40 },
      notes: '',
      round: null,
    },
    { now: workoutSet },
  );
  const finish = {
    type: 'session.finish',
    operationId: randomUUID(),
    sessionId,
    expectedRevision: 2,
  };
  await store.save(finish, { now: workoutFinish });
  const localSession = (await store.records('session')).find((r) => r.id === sessionId).value;
  assert.equal(localSession.startedAt, workoutStart);
  assert.equal(localSession.items[0].results[0].recordedAt, workoutSet);
  assert.equal(localSession.finishedAt, workoutFinish);
  assert.equal(JSON.parse((await store.outbox())[0].payload).occurredAt, workoutStart);
  const task = {
    type: 'task.create',
    operationId: randomUUID(),
    taskId: randomUUID(),
    expectedRevision: 0,
    content: {
      title: 'Fictional offline ordinary task',
      description: 'Retained on disk',
      notes: '',
    },
  };
  await store.save(task);
  const taskEdit = {
    type: 'task.edit',
    operationId: randomUUID(),
    taskId: task.taskId,
    expectedRevision: 1,
    content: { ...task.content, title: 'Fictional retained ordinary edit' },
  };
  await store.save(taskEdit);
  const bytes = await sharp({
    create: { width: 12, height: 12, channels: 3, background: '#98ba72' },
  })
    .jpeg()
    .toBuffer();
  await mkdir(join(folder, 'Documents'));
  const file = join(folder, 'Documents', 'retained.jpg');
  await writeFile(file, bytes);
  const photo = {
    id: randomUUID(),
    operationId: randomUUID(),
    entryId: randomUUID(),
    uri: `file://${file}`,
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    attempts: 0,
    delivery: 'never-sent',
  };
  const food = foodCommand();
  photo.entryId = food.entryId;
  await store.retainPhoto(photo);
  await store.setDraft('food-compose', { text: food.content.text, photos: [photo.uri] });
  await store.save(food, { foodSave: { photoUris: [photo.uri], draftKey: 'food-compose' } });
  assert.equal((await store.photos())[0].status, 'pending');
  assert.equal(
    (await store.outbox()).every((o) => o.state === 'never-sent'),
    true,
  );
  assert.equal((await pool.query('SELECT count(*) FROM tasks')).rows[0].count, '0');
  db.close();
  await openSQLite(identity);
  coordinator = new OfflineCoordinator(store, transport, randomUUID);
  assert.equal((await store.outbox()).length, 6);
  assert.deepEqual(await readFile(file), bytes);
  assert(!JSON.stringify(await store.records()).includes('fictional-password'));
  check('offline task, workout chain, food text and selected photo survive SQLite reopen', {
    outbox: 6,
    photoSha256: photo.sha256,
    credentialFree: true,
  });
  lossId = task.operationId;
  await coordinator.sync();
  assert.equal(
    (await store.outbox()).find((o) => o.operationId === task.operationId).state,
    'uncertain',
  );
  assert.equal(await receiptCount(task.operationId), 1);
  db.prepare('UPDATE offline_outbox SET next_attempt_at=0').run();
  await coordinator.sync();
  assert.equal(await receiptCount(task.operationId), 1);
  assert.equal(
    (await request(`/api/tasks/${task.taskId}/history`))
      .json()
      .events.filter((e) => e.operationId === task.operationId).length,
    1,
  );
  assert.equal(sends.filter((s) => JSON.parse(s).operationId === task.operationId).length, 2);
  assert.equal(
    (await store.records('task')).find((r) => r.id === task.taskId).confirmed.content.title,
    taskEdit.content.title,
  );
  assert.equal(await receiptCount(taskEdit.operationId), 1);
  const session = (await store.records('session')).find((r) => r.id === sessionId).confirmed;
  assert.equal(session.startedAt, workoutStart);
  assert.equal(session.items[0].results[0].recordedAt, workoutSet);
  assert.equal(session.finishedAt, workoutFinish);
  assert.equal(Date.parse(session.finishedAt) - Date.parse(session.startedAt), 3_600_000);
  assert(Date.parse(session.updatedAt) > Date.parse(workoutFinish));
  const queuedFinish = JSON.parse(
    (await store.outbox()).find((o) => o.operationId === finish.operationId).payload,
  );
  const firstReceipt = (
    await request('/api/sessions/commands', queuedFinish, 'POST', installation.epoch)
  ).json();
  const repeatedReceipt = (
    await request('/api/sessions/commands', queuedFinish, 'POST', installation.epoch)
  ).json();
  assert.deepEqual(repeatedReceipt, firstReceipt);
  assert.deepEqual(firstReceipt.session, session);
  assert.equal(await receiptCount(finish.operationId), 1);
  check('delayed offline hour-long workout retains event times and immutable finish receipt', {
    durationMs: 3_600_000,
    startedAt: session.startedAt,
    recordedAt: session.items[0].results[0].recordedAt,
    finishedAt: session.finishedAt,
    receivedAt: session.updatedAt,
  });
  assert.equal(session.items[0].id, sessionItem);
  assert.equal(session.items[0].targets[0].id, sessionTarget);
  assert.equal(session.items[0].results[0].id, setId);
  assert.equal(session.items[0].targets[0].measurements.reps, 5);
  assert.equal(session.items[0].results[0].measurements.reps, 4);
  check(
    'actual HTTP commit with dropped response retries one immutable receipt/history event; session IDs converge',
    {
      taskReceiptCount: 1,
      taskHistoryCount: 1,
      callerSessionId: sessionId,
      callerItemId: sessionItem,
      callerTargetId: sessionTarget,
      performedSetId: setId,
    },
  );
  const backup = join(folder, 'backup');
  const env = { ...process.env, DATABASE_URL: url, MEDIA_DIRECTORY: media };
  await run(process.execPath, ['--import', 'tsx', resolve('scripts/backup.mjs'), backup], { env });
  const orphan = foodCommand();
  const orphanPhoto = {
    ...photo,
    id: randomUUID(),
    operationId: randomUUID(),
    entryId: orphan.entryId,
  };
  await store.save(orphan, { photo: orphanPhoto });
  await coordinator.sync();
  assert.equal(
    (await store.outbox()).find((o) => o.operationId === orphan.operationId).state,
    'synced',
  );
  const late = foodCommand();
  await store.save(late);
  lossId = late.operationId;
  await coordinator.sync();
  assert.equal(await receiptCount(late.operationId), 1);
  const never = {
    type: 'task.create',
    operationId: randomUUID(),
    taskId: randomUUID(),
    expectedRevision: 0,
    content: { title: 'Fictional never-sent restore task', description: '', notes: '' },
  };
  await store.save(never);
  await app.close();
  app = undefined;
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  const restoredMedia = join(folder, 'restored-media');
  await run(process.execPath, ['--import', 'tsx', resolve('scripts/restore.mjs'), backup], {
    env: { ...env, MEDIA_DIRECTORY: restoredMedia },
  });
  await run(process.execPath, ['--import', 'tsx', resolve('scripts/backup.mjs'), '--resume'], {
    env: { ...env, MEDIA_DIRECTORY: restoredMedia },
  });
  app = (await createApp(config(restoredMedia), pool)).app;
  await login();
  const epoch = (await pool.query('SELECT epoch FROM installation')).rows[0].epoch;
  assert.notEqual(epoch, installation.epoch);
  assert.equal(await receiptCount(late.operationId), 0);
  await assert.rejects(
    request('/api/food/commands', late, 'POST', installation.epoch),
    (e) => e.code === 'SYNC_EPOCH_CHANGED',
  );
  assert.equal(await receiptCount(late.operationId), 0);
  await coordinator.sync();
  assert.equal((await store.state()).replayPaused, true);
  const retained = await store.outbox();
  assert.equal(retained.find((o) => o.operationId === late.operationId).state, 'review');
  assert.equal(retained.find((o) => o.operationId === never.operationId).state, 'review');
  await assert.rejects(store.resumeAfterReview(), /Review every/);
  check(
    'production backup/restore rotates epoch, removes post-backup receipt and blocks old-epoch replay before receipt lookup',
    {
      oldEpoch: installation.epoch,
      newEpoch: epoch,
      postBackupReceiptAbsent: true,
      attemptedRetained: true,
      neverSentRetained: true,
      replayPaused: true,
      restoredDatabase: 'same isolated fixture database',
      restoredMedia: 'fresh independent directory',
    },
  );
  const freshId = randomUUID(),
    freshOp = randomUUID();
  await store.saveReviewed(
    late.operationId,
    freshOp,
    { epoch, revision: null, outcomeChecked: true },
    freshId,
  );
  if (!(await store.markAttempt(freshOp, true)))
    throw new Error('Paused reviewed food fork was not attempted.');
  await store.accept(
    freshOp,
    await transport.send(
      JSON.parse((await store.outbox()).find((o) => o.operationId === freshOp).payload),
    ),
    { expectedEpoch: epoch },
  );
  await store.revalidateNeverSent(never.operationId);
  if (!(await store.markAttempt(never.operationId, true)))
    throw new Error('Paused revalidated command was not attempted.');
  await store.accept(never.operationId, await transport.send(never), { expectedEpoch: epoch });
  assert.equal(await receiptCount(freshOp), 1);
  assert.equal(await receiptCount(never.operationId), 1);
  check(
    'reviewed absent outcome uses fresh food/operation IDs; never-sent task is explicitly revalidated and genuinely acknowledged',
    { freshId, freshOp, neverSentReceiptCount: 1 },
  );
  // This acknowledged post-backup text disappears from the frozen restore, but its photo retains its diary context.
  const retainedPhoto = (await store.photos()).find((p) => p.id === orphanPhoto.id);
  assert.equal(retainedPhoto.status, 'needs-attention');
  assert.equal(retainedPhoto.retainedEntry.content.text, orphan.content.text);
  assert.equal(
    (await store.records('food')).some((r) => r.id === orphan.entryId),
    false,
  );
  const recoveredEntry = randomUUID(),
    recoveredTextOp = randomUUID();
  await store.forkRetainedPhotoEntry(orphanPhoto.id, recoveredEntry, recoveredTextOp, epoch);
  await assert.rejects(
    store.requeueReviewedPhoto(orphanPhoto.id, randomUUID(), randomUUID(), recoveredEntry),
    /server confirmed/,
  );
  if (!(await store.markAttempt(recoveredTextOp, true)))
    throw new Error('Paused retained photo text was not attempted.');
  await store.accept(
    recoveredTextOp,
    await transport.send(
      JSON.parse((await store.outbox()).find((o) => o.operationId === recoveredTextOp).payload),
    ),
    { expectedEpoch: epoch },
  );
  const recoveredPhotoId = randomUUID(),
    finalizeId = randomUUID();
  await store.requeueReviewedPhoto(orphanPhoto.id, recoveredPhotoId, finalizeId, recoveredEntry);
  const recovered = (await store.photos()).find((p) => p.id === recoveredPhotoId);
  const confirmed = (await store.records('food')).find((r) => r.id === recoveredEntry).confirmed;
  const allocation = domain.FoodUploadResponseSchema.parse(
    (
      await request(
        `/api/food/${recoveredEntry}/uploads`,
        {
          operationId: recovered.id,
          expectedRevision: confirmed.revision,
          size: recovered.size,
          sha256: recovered.sha256,
          contentType: 'image/jpeg',
        },
        'POST',
        epoch,
      )
    ).json(),
  );
  await request(`/api/media/${allocation.upload.id}/content`, await readFile(file), 'PUT', epoch);
  const finalized = domain.FoodCommandResponseSchema.parse(
    (
      await request(
        `/api/media/${allocation.upload.id}/finalize`,
        { operationId: finalizeId, expectedRevision: confirmed.revision },
        'POST',
        epoch,
      )
    ).json(),
  );
  await store.ingestValidatedRecords([
    {
      recordType: 'food',
      id: finalized.entry.id,
      revision: finalized.entry.revision,
      value: finalized.entry,
    },
  ]);
  await store.updatePhoto(
    { ...recovered, uploadId: allocation.upload.id, delivery: 'synced' },
    'synced',
  );
  const download = await request(`/api/media/${allocation.upload.id}`);
  assert.deepEqual(download.rawPayload, bytes);
  assert.match(download.headers['cache-control'], /no-store/);
  assert.equal(
    (await app.inject({ method: 'GET', url: `/api/media/${allocation.upload.id}` })).statusCode,
    401,
  );
  assert.equal(finalized.entry.photoIds.length, 1);
  assert.equal(await receiptCount(finalizeId), 1);
  check(
    'orphan diary context survives restore; fresh text acknowledgement gates fresh photo IDs and real private upload/finalization',
    {
      sha256: photo.sha256,
      attachmentCount: 1,
      finalizeReceiptCount: 1,
      privateDownload: true,
      recoveredEntry,
      recoveredTextOp,
      recoveredPhotoId,
      oldEntryAbsent: true,
      textAcknowledgementGate: true,
    },
  );
  report.limitations = [
    'node:sqlite seam; no Expo driver/device lifecycle proof',
    'Restore rewinds the guarded fixture database; independent-database restoration is verified by portability.test.ts',
    'NativeOfflineClient photo transport is not executed; production media HTTP endpoints and public OfflineStore review APIs are executed',
  ];
  report.verifiedAt = new Date().toISOString();
  report.runtime = process.version;
  report.postgresql = (await pool.query('SELECT version()')).rows[0].version;
  report.sqlite = db.prepare('SELECT sqlite_version() AS version').get().version;
  report.sourceSha256 = {};
  for (const source of [
    'scripts/verify-offline-live.mjs',
    'apps/mobile/src/offline/store.ts',
    'apps/mobile/src/offline/coordinator.ts',
    'apps/mobile/src/offline/recovery.ts',
    'apps/mobile/src/offline-client.ts',
    'apps/mobile/src/features.tsx',
    'apps/server/src/app.ts',
  ]) {
    try {
      report.sourceSha256[source] = createHash('sha256')
        .update(await readFile(resolve(source)))
        .digest('hex');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const evidence = resolve('.scratch/mems-life-v1/evidence/offline-live');
  await mkdir(evidence, { recursive: true });
  await writeFile(join(evidence, 'protocol-proof.json'), JSON.stringify(report, null, 2) + '\n');
} finally {
  if (app) await app.close();
  if (db) db.close();
  await pool.end();
  await rm(folder, { recursive: true, force: true });
}
