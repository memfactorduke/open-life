// Real Node SQLite durability and transaction proof; server/native proof remains separate.
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { register } from 'tsx/esm/api';
register();
const imported = await import('../apps/mobile/src/offline/index.ts');
const { OfflineStore } = imported.default ?? imported;
const directory = mkdtempSync(join(tmpdir(), 'orphan-photo-proof-'));
const filename = join(directory, 'offline.sqlite');
let db;
const executor = {
  exec: async (sql) => db.exec(sql),
  run: async (sql, ...params) => {
    db.prepare(sql).run(...params);
  },
  all: async (sql, ...params) => db.prepare(sql).all(...params),
};
const adapter = {
  ...executor,
  transaction: async (work) => {
    db.exec('BEGIN');
    try {
      const result = await work(executor);
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  },
};
const partition = { installationId: randomUUID(), ownerId: randomUUID() };
let store;
const reopen = async () => {
  if (db) db.close();
  db = new DatabaseSync(filename);
  store = new OfflineStore(adapter, partition);
  await store.initialize();
};
const oldEpoch = randomUUID(),
  restoredEpoch = randomUUID();
const at = '2026-10-13T12:00:00.000Z';
const makeEntry = (id) => ({
  id,
  revision: 1,
  content: { text: 'Fictional retained lunch', occurredAt: at, timezone: 'UTC' },
  photoIds: [],
  createdAt: at,
  updatedAt: at,
  deletedAt: null,
});
const original = makeEntry(randomUUID()),
  ordinary = makeEntry(randomUUID());
const snapshot = (epoch, entries) => ({
  ...partition,
  epoch,
  schemaVersion: 1,
  snapshotId: randomUUID(),
  watermark: '0',
  nextCursor: null,
  records: entries.map((value) => ({
    recordType: 'food',
    id: value.id,
    revision: value.revision,
    value,
  })),
});
try {
  await reopen();
  await store.stageSnapshot(snapshot(oldEpoch, [original, ordinary]));
  const photo = {
    id: randomUUID(),
    operationId: randomUUID(),
    entryId: original.id,
    uri: 'file:///fictional/Documents/original.jpg',
    sha256: 'a'.repeat(64),
    size: 40,
    uploadId: randomUUID(),
    allocationRevision: 1,
    finalizeRevision: 1,
    attemptEpoch: oldEpoch,
    attempts: 1,
    delivery: 'uncertain',
  };
  // No pending text command: this is the previously unhandled restore case.
  await store.retainPhoto(photo);
  assert.equal((await store.outbox()).length, 0);
  await reopen();
  await store.stageSnapshot(snapshot(restoredEpoch, []));
  assert.equal((await store.records()).length, 0, 'missing server cache records must disappear');
  const retained = (await store.photos())[0];
  assert.equal(retained.status, 'needs-attention');
  assert.deepEqual(retained.retainedEntry, original);
  await reopen();
  const newId = randomUUID(),
    newOp = randomUUID();
  await store.forkRetainedPhotoEntry(photo.id, newId, newOp, restoredEpoch);
  const command = JSON.parse((await store.outbox())[0].payload);
  assert.equal(command.entryId, newId);
  assert.equal(command.expectedRevision, 0);
  assert.deepEqual(command.content, original.content);
  assert.equal((await store.photos()).length, 1, 'text review must not queue an upload');
  await assert.rejects(
    store.requeueReviewedPhoto(photo.id, randomUUID(), randomUUID(), newId),
    /server confirmed/,
  );
  await assert.rejects(
    store.forkRetainedPhotoEntry(photo.id, randomUUID(), randomUUID(), restoredEpoch),
    /earlier recovery/,
  );
  // Apply a protocol acknowledgement to the actual SQLite state (not a live server proof).
  await store.markAttempt(newOp);
  const recovered = { ...makeEntry(newId), content: command.content };
  await store.accept(newOp, [{ recordType: 'food', id: newId, revision: 1, value: recovered }]);
  await reopen();
  const newPhotoId = randomUUID();
  await store.requeueReviewedPhoto(photo.id, newPhotoId, randomUUID(), newId);
  const photos = await store.photos();
  const historical = photos.find((p) => p.id === photo.id),
    fresh = photos.find((p) => p.id === newPhotoId);
  assert.equal(historical.entryId, original.id);
  assert.equal(historical.uploadId, photo.uploadId);
  assert.equal(historical.finalizeRevision, 1);
  assert.equal(historical.attemptEpoch, oldEpoch);
  assert.equal(historical.status, 'discarded');
  assert.equal(fresh.entryId, newId);
  assert.equal(fresh.uri, photo.uri);
  assert.equal(fresh.status, 'pending');
  assert.equal(fresh.attempts, 0);
  assert.equal(fresh.uploadId, undefined);
  assert.equal(fresh.attemptEpoch, undefined);
  await store.resumeAfterReview();
  assert.equal((await store.records('food')).length, 1);
  assert.equal((await store.records('food'))[0].id, newId);
  assert.equal((await store.outbox()).filter((o) => o.state === 'synced').length, 1);
  console.log(
    'PASS: confirmed-only diary + retained photo survive restore/restart; reviewed text fork, ack gate, fresh photo identity, immutable historical upload and no original resurrection. Real Node SQLite; no native or PostgreSQL claim.',
  );
} finally {
  db?.close();
  rmSync(directory, { recursive: true, force: true });
}
