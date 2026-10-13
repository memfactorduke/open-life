// Real SQLite durability seam. This does not exercise the Expo native driver or real device lifecycle.
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { register } from 'tsx/esm/api';
register();
const imported = await import('../apps/mobile/src/offline/index.ts');
const { OfflineStore, OfflineCoordinator } = imported.default ?? imported;
const { applyTaskCommand } = await import('@mems-life/domain');
const folder = mkdtempSync(join(tmpdir(), 'mems-offline-'));
const path = join(folder, 'device.sqlite');
const identity = { ownerId: randomUUID(), installationId: randomUUID() };
const epoch = randomUUID();
const now = '2026-10-12T12:00:00.000Z';
function adapter(path) {
  const db = new DatabaseSync(path);
  let fail = false;
  let busy = Promise.resolve();
  const executor = {
    exec: async (sql) => {
      db.exec(sql);
    },
    run: async (sql, ...args) => {
      if (fail) throw new Error('SQLITE_FULL');
      db.prepare(sql).run(...args);
    },
    all: async (sql, ...args) => db.prepare(sql).all(...args),
  };
  return {
    ...executor,
    transaction: async (work) => {
      const previous = busy;
      let unlock;
      busy = new Promise((r) => (unlock = r));
      await previous;
      db.exec('BEGIN IMMEDIATE');
      try {
        const value = await work(executor);
        db.exec('COMMIT');
        return value;
      } catch (e) {
        try {
          db.exec('ROLLBACK');
        } catch {
          /* SQLITE_FULL may already roll back; preserve the original error. */
        }
        throw e;
      } finally {
        unlock();
      }
    },
    close: async () => db.close(),
    fail: () => {
      fail = true;
    },
    recover: () => {
      fail = false;
    },
  };
}
const taskCreate = (id = randomUUID()) => ({
  type: 'task.create',
  operationId: randomUUID(),
  taskId: id,
  expectedRevision: 0,
  content: { title: 'Fictional offline task', description: '', notes: '' },
});
const record = (task) => ({
  recordType: 'task',
  id: task.id,
  revision: task.revision,
  value: task,
});
const snapshot = (records = [], watermark = '0', e = epoch) => ({
  ...identity,
  schemaVersion: 1,
  epoch: e,
  watermark,
  snapshotId: randomUUID(),
  records,
  nextCursor: null,
});
let db = adapter(path);
let store = new OfflineStore(db, identity);
await store.initialize();
await store.stageSnapshot(snapshot());
const create = taskCreate();
await store.save(create, { now });
assert.equal((await store.records('task'))[0].status, 'pending');
await db.close();
db = adapter(path);
store = new OfflineStore(db, identity);
await store.initialize();
assert.deepEqual(JSON.parse((await store.outbox())[0].payload), create);
assert.equal((await store.records())[0].value.content.title, create.content.title);
console.log('PASS: reopen preserves acknowledged projection and immutable outbox');
const receipts = new Map();
const sends = [];
let lose = true;
const transport = {
  snapshot: async () => snapshot(),
  changes: async (e, c) => ({
    ...identity,
    schemaVersion: 1,
    epoch: e,
    watermark: c,
    cursor: c,
    hasMore: false,
    records: [],
  }),
  send: async (command) => {
    sends.push(JSON.stringify(command));
    let value = receipts.get(command.operationId);
    if (!value) {
      value = [record(applyTaskCommand(null, command, now))];
      receipts.set(command.operationId, value);
    }
    if (lose) {
      lose = false;
      throw new Error('response lost');
    }
    return value;
  },
};
const coordinator = new OfflineCoordinator(store, transport, randomUUID);
await coordinator.sync();
assert.equal((await store.outbox())[0].state, 'uncertain');
await db.run('UPDATE offline_outbox SET next_attempt_at=0');
await coordinator.sync();
assert.equal(receipts.size, 1);
assert.equal(sends[0], sends[1]);
assert.equal((await store.records())[0].status, 'synced');
console.log('PASS: response-loss retry sends same ID and exact payload, one receipt');
const old = (await store.records())[0].value;
const edit = {
  type: 'task.edit',
  operationId: randomUUID(),
  taskId: old.id,
  expectedRevision: old.revision,
  content: { ...old.content, title: 'Local retained title' },
};
await store.save(edit, { now });
const dependent = {
  ...edit,
  operationId: randomUUID(),
  expectedRevision: 2,
  content: { ...edit.content, notes: 'Dependent' },
};
await store.save(dependent, { now });
const unrelated = taskCreate();
await store.save(unrelated, { now });
const other = applyTaskCommand(
  old,
  {
    ...edit,
    operationId: randomUUID(),
    content: { ...old.content, title: 'Second device version' },
  },
  now,
);
await store.applyFeed({
  ...identity,
  schemaVersion: 1,
  epoch,
  watermark: '1',
  cursor: '1',
  hasMore: false,
  records: [record(other)],
});
transport.send = async (command) => {
  if (command.taskId === old.id)
    throw Object.assign(new Error('revision conflict'), { status: 409 });
  return [record(applyTaskCommand(null, command, now))];
};
await coordinator.sync();
const out = await store.outbox();
assert.equal(out.find((o) => o.operationId === edit.operationId).state, 'conflict');
assert.equal(out.find((o) => o.operationId === dependent.operationId).state, 'never-sent');
assert.equal(out.find((o) => o.operationId === unrelated.operationId).state, 'synced');
const conflict = (await store.conflicts())[0];
assert.equal(JSON.parse(conflict.local_value).content.title, 'Local retained title');
assert.equal(JSON.parse(conflict.server_value).content.title, 'Second device version');
console.log(
  'PASS: two-device conflict retains both copies, blocks dependent chain, continues unrelated',
);
await assert.rejects(
  () =>
    store.save({
      type: 'task.complete',
      operationId: randomUUID(),
      taskId: old.id,
      expectedRevision: 2,
    }),
  /online confirmation/,
);
await assert.rejects(() => store.signOut(), /Pending/);
await store.signOut(true);
assert.equal((await store.state()).signedOut, true);
await coordinator.sync();
assert.equal(
  (await store.outbox()).find((o) => o.operationId === dependent.operationId).state,
  'never-sent',
);
await store.signIn();
const otherStore = new OfflineStore(db, { ...identity, ownerId: randomUUID() });
await otherStore.initialize();
assert.equal((await otherStore.records()).length, 0);
assert.equal((await otherStore.outbox()).length, 0);
console.log(
  'PASS: execution-sensitive offline actions denied; logout retains work; account partition isolated',
);
const full = taskCreate();
db.fail();
await assert.rejects(() => store.save(full, { now }), /SQLITE_FULL/);
db.recover();
assert.equal(
  (await store.outbox()).some((o) => o.operationId === full.operationId),
  false,
);
assert.equal(
  (await store.records()).some((o) => o.id === full.taskId),
  false,
);
console.log('PASS: storage-full failure rolls back record and outbox before saved acknowledgement');
const fullDisk = adapter(join(folder, 'full-disk.sqlite'));
const fullStore = new OfflineStore(fullDisk, identity);
await fullStore.initialize();
const pageCount = (await fullDisk.all('PRAGMA page_count'))[0].page_count;
await fullDisk.exec(`PRAGMA max_page_count=${pageCount}`);
const bulky = taskCreate();
bulky.content.description = 'x'.repeat(20000);
bulky.content.notes = 'y'.repeat(20000);
await assert.rejects(() => fullStore.save(bulky, { now }), /database or disk is full/);
assert.equal((await fullStore.records()).length, 0);
assert.equal((await fullStore.outbox()).length, 0);
await fullDisk.close();
console.log(
  'PASS: actual SQLite SQLITE_FULL from max_page_count leaves no acknowledged record/outbox',
);

const unsent = taskCreate();
await store.save(unsent, { now });
const attempted = taskCreate();
await store.save(attempted, { now });
await store.markAttempt(attempted.operationId);
await db.close();
db = adapter(path);
store = new OfflineStore(db, identity);
await store.initialize();
assert.equal(
  (await store.outbox()).find((o) => o.operationId === attempted.operationId).state,
  'uncertain',
);
const restored = randomUUID();
await store.observeEpoch(restored);
await store.stageSnapshot(snapshot([record(old)], '0', restored));
assert.equal((await store.records()).find((r) => r.id === old.id).confirmed.revision, 1);
assert.equal(
  (await store.records()).find((r) => r.id === old.id).value.content.title,
  'Local retained title',
);
assert.equal((await store.state()).replayPaused, true);
assert.equal(
  (await store.outbox()).find((o) => o.operationId === unsent.operationId).state,
  'review',
);
await assert.rejects(() => store.revalidateNeverSent(attempted.operationId), /reconciliation/);
await store.revalidateNeverSent(unsent.operationId);
assert.equal(
  (await store.outbox()).find((o) => o.operationId === unsent.operationId).state,
  'never-sent',
);
assert.equal(
  (await store.records()).some((r) => r.id === attempted.taskId),
  true,
);
console.log(
  'PASS: epoch restore pauses replay, retains work; unsent revalidation differs from attempted reconciliation',
);
const snapId = randomUUID();
const first = { ...snapshot([], '2', restored), snapshotId: snapId, nextCursor: '1' };
await store.stageSnapshot(first);
assert.equal((await store.state()).cursor, '0');
await store.stageSnapshot({ ...first, nextCursor: null, records: [record(other)] }, '1');
assert.equal((await store.state()).cursor, '2');
const beforeCursor = (await store.state()).cursor;
db.fail();
await assert.rejects(
  () =>
    store.applyFeed({
      ...identity,
      schemaVersion: 1,
      epoch: restored,
      watermark: '3',
      cursor: '3',
      hasMore: false,
      records: [record({ ...other, revision: 3 })],
    }),
  /SQLITE_FULL/,
);
db.recover();
assert.equal((await store.state()).cursor, beforeCursor);
console.log(
  'PASS: snapshot installs only complete consistent chain; feed record and cursor commit atomically',
);
// Epoch replay cannot resume while earlier ambiguous attempts still need owner review.
await assert.rejects(() => store.resumeAfterReview(), /Review every/);
for (const aggregate of new Set(
  (await store.outbox())
    .filter((o) => ['review', 'conflict', 'uncertain', 'attempted'].includes(o.state))
    .map((o) => o.aggregate),
))
  await store.keepServer(aggregate);
await store.resumeAfterReview();
const authCoordinator = new OfflineCoordinator(
  store,
  {
    ...transport,
    send: async () => {
      throw Object.assign(new Error('auth expired'), { status: 401 });
    },
  },
  randomUUID,
);
await authCoordinator.sync();
assert.equal(authCoordinator.lastError, 'Sign in again. Local changes remain saved.');
assert.equal(
  (await store.outbox()).find((o) => o.operationId === unsent.operationId).state,
  'uncertain',
);
console.log('PASS: expired authentication retains durable work and stops sends');
// Exercise a routine-derived workout with stable IDs and keep planned targets apart from results.
const workoutOwner = { ...identity, ownerId: randomUUID() };
const workoutStore = new OfflineStore(db, workoutOwner);
await workoutStore.initialize();
const exercise = {
  id: randomUUID(),
  revision: 1,
  name: 'Fictional squat',
  mode: 'weighted',
  supportsLoad: true,
  notes: '',
  origin: 'custom',
  archivedAt: null,
  createdAt: now,
  updatedAt: now,
};
const sourceItem = randomUUID(),
  sourceTarget = randomUUID(),
  sessionItem = randomUUID(),
  sessionTarget = randomUUID();
const routine = {
  id: randomUUID(),
  revision: 1,
  name: 'Fictional routine',
  notes: '',
  archivedAt: null,
  createdAt: now,
  updatedAt: now,
  items: [
    {
      id: sourceItem,
      exerciseId: exercise.id,
      snapshot: { name: exercise.name, mode: exercise.mode, supportsLoad: true },
      notes: '',
      targets: [
        {
          id: sourceTarget,
          kind: 'working',
          measurements: { mode: 'weighted', reps: 8, loadKg: 100 },
          notes: '',
        },
      ],
    },
  ],
};
await workoutStore.ingestValidatedRecords([
  { recordType: 'exercise', id: exercise.id, revision: 1, value: exercise },
  { recordType: 'routine', id: routine.id, revision: 1, value: routine },
]);
const sessionId = randomUUID();
await workoutStore.save(
  {
    type: 'session.start',
    operationId: randomUUID(),
    sessionId,
    expectedRevision: 0,
    name: 'Offline workout',
    routineId: routine.id,
    expectedRoutineRevision: 1,
    itemIdentities: [
      {
        routineItemId: sourceItem,
        itemId: sessionItem,
        targets: [{ routineTargetId: sourceTarget, targetId: sessionTarget }],
      },
    ],
  },
  { now },
);
let localSession = (await workoutStore.records('session'))[0].value;
assert.equal(localSession.items[0].id, sessionItem);
assert.equal(localSession.items[0].targets[0].id, sessionTarget);
assert.equal(localSession.items[0].results.length, 0);
const setId = randomUUID();
await workoutStore.save(
  {
    type: 'session.record-set',
    operationId: randomUUID(),
    sessionId,
    expectedRevision: 1,
    itemId: sessionItem,
    setId,
    kind: 'working',
    measurements: { mode: 'weighted', reps: 6, loadKg: 80 },
    notes: 'Recorded actual effort',
    round: null,
  },
  { now },
);
await workoutStore.save(
  { type: 'session.finish', operationId: randomUUID(), sessionId, expectedRevision: 2 },
  { now },
);
localSession = (await workoutStore.records('session'))[0].value;
assert.equal(localSession.status, 'completed');
assert.equal(localSession.items[0].targets[0].measurements.reps, 8);
assert.equal(localSession.items[0].results[0].measurements.reps, 6);
assert.equal((await workoutStore.state()).activeSessionId, null);
await assert.rejects(
  () =>
    workoutStore.save({
      type: 'session.record-set',
      operationId: randomUUID(),
      sessionId,
      expectedRevision: 3,
      itemId: sessionItem,
      setId: randomUUID(),
      kind: 'working',
      measurements: { mode: 'weighted', reps: 9, loadKg: 100 },
      notes: '',
      round: null,
    }),
  /explicit corrections/,
);
const foodId = randomUUID();
const photo = {
  id: randomUUID(),
  entryId: foodId,
  uri: 'file:///fixture/Documents/food/image.jpg',
  size: 128,
  sha256: 'a'.repeat(64),
  operationId: randomUUID(),
};
await workoutStore.save(
  {
    type: 'food.create',
    operationId: randomUUID(),
    entryId: foodId,
    expectedRevision: 0,
    content: { text: 'Fictional meal', occurredAt: now, timezone: 'UTC' },
  },
  { now, photo },
);
await workoutStore.setDraft('food.description', { text: 'Unsaved description' });
await assert.rejects(() => workoutStore.setDraft('auth', { cookie: 'secret' }), /secure storage/);
await db.close();
db = adapter(path);
const reopenedWorkout = new OfflineStore(db, workoutOwner);
await reopenedWorkout.initialize();
assert.equal((await reopenedWorkout.records('session'))[0].value.items[0].results[0].id, setId);
assert.equal((await reopenedWorkout.photos())[0].uri, photo.uri);
assert.equal((await reopenedWorkout.getDraft('food.description')).text, 'Unsaved description');
console.log(
  'PASS: routine workout identities, actual results/completion, photo references and drafts persist across reopen; finished sessions cannot resurrect',
);
await db.close();
rmSync(folder, { recursive: true, force: true });
console.log(
  'Verified actual Node 24 SQLite seam; native Expo driver, camera/filesystem and force-quit simulator gates remain separate.',
);
