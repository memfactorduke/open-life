// Real node:sqlite checks; native Expo/device durability still requires separate verification.
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { register } from 'tsx/esm/api';
register();
const imported = await import('../apps/mobile/src/offline/index.ts');
const { OfflineStore } = imported.default ?? imported;
const db = new DatabaseSync(':memory:');
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
    db.exec('BEGIN');
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
const identity = { ownerId: randomUUID(), installationId: randomUUID() },
  epoch = randomUUID();
const store = new OfflineStore(adapter, identity);
await store.initialize();
const id = randomUUID(),
  now = '2026-10-13T12:00:00.000Z',
  content = { text: 'Fictional lunch', occurredAt: now, timezone: 'UTC' };
const entry = {
  id,
  revision: 1,
  content,
  photoIds: [],
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
};
const snapshot = (records, e = epoch) => ({
  ...identity,
  schemaVersion: 1,
  epoch: e,
  watermark: '0',
  snapshotId: randomUUID(),
  records,
  nextCursor: null,
});
const record = (value) => ({ recordType: 'food', id, revision: value.revision, value });
await store.stageSnapshot(snapshot([record(entry)]));
const operationId = randomUUID();
await store.save({
  type: 'food.edit',
  operationId,
  entryId: id,
  expectedRevision: 1,
  content: { ...content, text: 'Local lunch' },
});
await store.markAttempt(operationId);
const restored = randomUUID();
await store.stageSnapshot(
  snapshot(
    [record({ ...entry, revision: 2, content: { ...content, text: 'Server lunch' } })],
    restored,
  ),
);
await assert.rejects(store.resumeAfterReview(), /Review every/);
await assert.rejects(
  store.saveReviewed(operationId, randomUUID(), {
    epoch: restored,
    revision: 2,
    outcomeChecked: false,
  }),
  /original attempt/,
);
await assert.rejects(store.reconcileAttempted(operationId, 'reviewed-absent'), /new operation/);
const newOp = randomUUID();
await store.saveReviewed(operationId, newOp, {
  epoch: restored,
  revision: 2,
  outcomeChecked: true,
});
const all = await store.outbox();
assert.equal(all.find((o) => o.operationId === operationId).state, 'discarded');
assert.equal(JSON.parse(all.find((o) => o.operationId === newOp).payload).expectedRevision, 2);
assert.equal((await store.conflicts()).length, 1);
assert.equal(JSON.parse((await store.conflicts())[0].local_value).content.text, 'Local lunch');
await store.reject(newOp, 'Conflict');
await store.ingestValidatedRecords([record({ ...entry, revision: 3, deletedAt: now })]);
await assert.rejects(
  store.saveReviewed(newOp, randomUUID(), { epoch: restored, revision: 3, outcomeChecked: true }),
  /deleted/,
);
const newId = randomUUID();
const fork = await store.saveReviewed(
  newOp,
  randomUUID(),
  { epoch: restored, revision: 3, outcomeChecked: true },
  newId,
);
assert.equal(fork.id, newId);
assert.equal(fork.revision, 1);
assert.equal((await store.records()).find((r) => r.id === id).value.deletedAt, now);
const photo = {
  id: randomUUID(),
  entryId: newId,
  uri: 'file:///fixture/Documents/retained.jpg',
  size: 10,
  sha256: 'a'.repeat(64),
  operationId: randomUUID(),
  attempts: 1,
  attemptEpoch: restored,
  delivery: 'attempted',
};
await store.retainPhoto(photo);
await store.updatePhoto(photo, 'needs-attention');
await assert.rejects(store.resumeAfterReview(), /Review every/);
await assert.rejects(store.updatePhoto({ ...photo, attemptEpoch: epoch }, 'pending'), /unchanged/);
await store.requeueReviewedPhoto(photo.id, randomUUID(), randomUUID());
assert.equal((await store.photos()).filter((p) => p.uri === photo.uri).length, 2);
assert.equal((await store.photos()).find((p) => p.id === photo.id).status, 'discarded');
const recoveryStore = new OfflineStore(adapter, { ...identity, ownerId: randomUUID() });
await recoveryStore.initialize();
await recoveryStore.stageSnapshot(
  snapshot([], restored).ownerId === identity.ownerId
    ? { ...snapshot([], restored), ownerId: recoveryStore.partition.ownerId }
    : snapshot([], restored),
);
// Review a chain one command at a time, with actual acknowledgements unlocking the next.
const chainId = randomUUID(),
  first = randomUUID(),
  second = randomUUID();
await recoveryStore.save({
  type: 'food.create',
  operationId: first,
  entryId: chainId,
  expectedRevision: 0,
  content,
});
await recoveryStore.save({
  type: 'food.edit',
  operationId: second,
  entryId: chainId,
  expectedRevision: 1,
  content: { ...content, text: 'Second retained edit' },
});
await recoveryStore.reject(first, 'Retained creation needs review');
// Deleted/missing creations fork with a fresh record ID; ordinary edits use current server revision.
await recoveryStore.ingestValidatedRecords([
  { recordType: 'food', id: chainId, revision: 1, value: { ...entry, id: chainId } },
]);
await recoveryStore.reject(second, 'Review edit');
await recoveryStore.keepServer(`food:${chainId}`);
const a = randomUUID(),
  b = randomUUID();
await recoveryStore.save({
  type: 'food.edit',
  operationId: a,
  entryId: chainId,
  expectedRevision: 1,
  content: { ...content, text: 'First edit' },
});
await recoveryStore.save({
  type: 'food.edit',
  operationId: b,
  entryId: chainId,
  expectedRevision: 2,
  content: { ...content, text: 'Last edit' },
});
await recoveryStore.reject(a, 'Review');
await recoveryStore.reject(b, 'Review');
const recoveredA = randomUUID();
const savedA = await recoveryStore.saveReviewed(a, recoveredA, {
  epoch: restored,
  revision: 1,
  outcomeChecked: true,
});
assert.deepEqual((await recoveryStore.outbox()).find((o) => o.operationId === b).dependencies, [
  recoveredA,
]);
if (!(await recoveryStore.markAttempt(recoveredA, true)))
  throw new Error('Paused reviewed food edit was not attempted.');
await recoveryStore.accept(
  recoveredA,
  [{ recordType: 'food', id: chainId, revision: savedA.revision, value: savedA.value }],
  { expectedEpoch: restored },
);
const savedB = await recoveryStore.saveReviewed(b, randomUUID(), {
  epoch: restored,
  revision: 2,
  outcomeChecked: true,
});
assert.equal(savedB.value.content.text, 'Last edit');
// Captured photos remain durable drafts until the owner's save activates them atomically.
const draftPhoto = {
  ...photo,
  id: randomUUID(),
  entryId: chainId,
  operationId: randomUUID(),
  attempts: 0,
  attemptEpoch: undefined,
  delivery: 'never-sent',
};
await recoveryStore.retainPhoto(draftPhoto);
assert.equal((await recoveryStore.photos()).find((p) => p.id === draftPhoto.id).status, 'draft');
await recoveryStore.save(
  {
    type: 'food.edit',
    operationId: randomUUID(),
    entryId: chainId,
    expectedRevision: savedB.revision,
    content,
  },
  { photo: draftPhoto },
);
assert.equal((await recoveryStore.photos()).find((p) => p.id === draftPhoto.id).status, 'pending');
// A reviewed diary fork moves a new retained-photo identity to that entry and archives old upload metadata.
const deletedId = randomUUID(),
  deletedOp = randomUUID(),
  deletedPhoto = { ...draftPhoto, id: randomUUID(), entryId: deletedId, operationId: randomUUID() };
await recoveryStore.save(
  { type: 'food.create', operationId: deletedOp, entryId: deletedId, expectedRevision: 0, content },
  { photo: deletedPhoto },
);
await recoveryStore.reject(deletedOp, 'Original entry absent after restore');
const copiedId = randomUUID(),
  copiedPhotoId = randomUUID();
await recoveryStore.saveReviewed(
  deletedOp,
  randomUUID(),
  { epoch: restored, revision: null, outcomeChecked: true },
  copiedId,
  [{ oldId: deletedPhoto.id, id: copiedPhotoId, operationId: randomUUID() }],
);
assert.equal((await recoveryStore.photos()).find((p) => p.id === copiedPhotoId).entryId, copiedId);
assert.equal(
  (await recoveryStore.photos()).find((p) => p.id === copiedPhotoId).status,
  'needs-attention',
);
assert.equal(
  (await recoveryStore.photos()).find((p) => p.id === deletedPhoto.id).status,
  'discarded',
);
const sessionId = randomUUID(),
  session = {
    id: sessionId,
    revision: 1,
    name: 'Fictional workout',
    notes: '',
    status: 'active',
    sourceRoutineId: null,
    sourceRoutineRevision: null,
    items: [],
    supersets: [],
    timer: null,
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
  };
await recoveryStore.ingestValidatedRecords([
  { recordType: 'session', id: sessionId, revision: 1, value: session },
]);
const sessionOp = randomUUID();
await recoveryStore.save({
  type: 'session.set-notes',
  operationId: sessionOp,
  sessionId,
  expectedRevision: 1,
  itemId: null,
  notes: 'Local measurements note',
});
await recoveryStore.ingestValidatedRecords([
  {
    recordType: 'session',
    id: sessionId,
    revision: 2,
    value: { ...session, revision: 2, status: 'completed', finishedAt: now },
  },
]);
await recoveryStore.reject(sessionOp, 'Finished on server');
await assert.rejects(
  recoveryStore.saveReviewed(sessionOp, randomUUID(), {
    epoch: restored,
    revision: 2,
    outcomeChecked: true,
  }),
  /finished workout/,
);
console.log(
  'PASS: real SQLite conflict copies, restored attempts cannot replay, new revision/ID, deleted fork, retained photo bytes references and immutable epoch provenance.',
);
// Later commands keep their immutable intent after earlier recovery changes the shared projection.
const recoveryImport = await import('../apps/mobile/src/offline/recovery.ts');
const { reviewCommandDifferences } = recoveryImport.default ?? recoveryImport;
const { applyTaskCommand } = await import('@mems-life/domain');
const taskStore = new OfflineStore(adapter, {
  ownerId: randomUUID(),
  installationId: randomUUID(),
});
await taskStore.initialize();
const taskId = randomUUID();
const originalTask = applyTaskCommand(
  null,
  {
    type: 'task.create',
    operationId: randomUUID(),
    taskId,
    expectedRevision: 0,
    content: { title: 'Initial title', description: '', notes: '' },
  },
  now,
);
const taskRecord = (value) => ({ recordType: 'task', id: taskId, revision: value.revision, value });
const taskSnapshot = (value, e) => ({
  ...taskStore.partition,
  schemaVersion: 1,
  epoch: e,
  watermark: '0',
  snapshotId: randomUUID(),
  records: [taskRecord(value)],
  nextCursor: null,
});
await taskStore.stageSnapshot(taskSnapshot(originalTask, epoch));
const editId = randomUUID(),
  scheduleId = randomUUID(),
  laterEditId = randomUUID();
await taskStore.save({
  type: 'task.edit',
  operationId: editId,
  taskId,
  expectedRevision: 1,
  content: { title: 'Earlier title', description: '', notes: '' },
});
await taskStore.save({
  type: 'task.schedule',
  operationId: scheduleId,
  taskId,
  expectedRevision: 2,
  dueAt: '2026-10-20T12:00:00.000Z',
  scheduledAt: null,
});
await taskStore.save({
  type: 'task.edit',
  operationId: laterEditId,
  taskId,
  expectedRevision: 3,
  content: { title: 'Later immutable title', description: 'Later description', notes: '' },
});
await taskStore.stageSnapshot(taskSnapshot(originalTask, restored));
const recoveredEdit = randomUUID();
await taskStore.saveReviewed(editId, recoveredEdit, {
  epoch: restored,
  revision: 1,
  outcomeChecked: true,
});
const acceptedTask = applyTaskCommand(
  originalTask,
  JSON.parse((await taskStore.outbox()).find((o) => o.operationId === recoveredEdit).payload),
  now,
);
if (!(await taskStore.markAttempt(recoveredEdit, true)))
  throw new Error('Paused reviewed task edit was not attempted.');
await taskStore.accept(recoveredEdit, [taskRecord(acceptedTask)], { expectedEpoch: restored });
const retainedSchedule = (await taskStore.outbox()).find((o) => o.operationId === scheduleId);
const scheduleFields = reviewCommandDifferences(
  JSON.parse(retainedSchedule.payload),
  acceptedTask,
  await taskStore.records(),
);
assert.equal(
  scheduleFields.find((f) => f.field === 'Due').local,
  new Date('2026-10-20T12:00:00.000Z').toLocaleString(),
);
assert.equal(scheduleFields.find((f) => f.field === 'Due').server, 'Not set');
const forkId = randomUUID(),
  forkOp = randomUUID();
await taskStore.saveReviewed(
  laterEditId,
  forkOp,
  { epoch: restored, revision: 2, outcomeChecked: true },
  forkId,
);
assert.equal(
  (await taskStore.records('task')).find((r) => r.id === forkId).value.content.title,
  'Later immutable title',
);
assert.equal(
  JSON.parse((await taskStore.outbox()).find((o) => o.operationId === forkOp).payload).content
    .description,
  'Later description',
);
console.log(
  'PASS: later schedule compares immutable due date; separate text fork saves the later immutable content after earlier recovery acknowledgement.',
);
await adapter.close();
