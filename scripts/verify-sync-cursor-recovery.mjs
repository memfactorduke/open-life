// Real Node SQLite coordinator checks. Native Expo/device lifecycle is a separate gate.
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { register } from 'tsx/esm/api';
register();
const imported = await import('../apps/mobile/src/offline/index.ts');
const { OfflineStore, OfflineCoordinator } = imported.default ?? imported;
const now = '2026-10-13T12:00:00.000Z';
const failure = (code, details = { rebootstrap: true }) =>
  Object.assign(new Error(code), { code, status: 409, details });
async function fixture() {
  const db = new DatabaseSync(':memory:');
  const sql = {
    exec: async (s) => db.exec(s),
    run: async (s, ...p) => {
      db.prepare(s).run(...p);
    },
    all: async (s, ...p) => db.prepare(s).all(...p),
  };
  const adapter = {
    ...sql,
    close: async () => db.close(),
    transaction: async (work) => {
      db.exec('BEGIN');
      try {
        const result = await work(sql);
        db.exec('COMMIT');
        return result;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
  const identity = { ownerId: randomUUID(), installationId: randomUUID() },
    epoch = randomUUID(),
    id = randomUUID();
  const entry = {
    id,
    revision: 1,
    content: { text: 'Fictional server lunch', occurredAt: now, timezone: 'UTC' },
    photoIds: [],
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  const record = (value) => ({ recordType: 'food', id: value.id, revision: value.revision, value });
  const snapshot = (
    records,
    watermark = '9',
    e = epoch,
    snapshotId = randomUUID(),
    nextCursor = null,
  ) => ({ ...identity, schemaVersion: 1, epoch: e, watermark, snapshotId, records, nextCursor });
  const feed = (cursor, records = []) => ({
    ...identity,
    schemaVersion: 1,
    epoch,
    watermark: cursor,
    cursor,
    records,
    hasMore: false,
  });
  const store = new OfflineStore(adapter, identity);
  await store.initialize();
  await store.stageSnapshot(snapshot([record(entry)], '1'));
  const command = {
    type: 'food.edit',
    operationId: randomUUID(),
    entryId: id,
    expectedRevision: 1,
    content: { ...entry.content, text: 'Local retained lunch' },
  };
  await store.save(command);
  await store.setDraft('fixture', { text: 'Unfinished diary input' });
  const photo = {
    id: randomUUID(),
    entryId: id,
    uri: 'file:///fixture/Documents/photo.jpg',
    size: 10,
    sha256: 'a'.repeat(64),
    operationId: randomUUID(),
  };
  await store.retainPhoto(photo);
  return { adapter, store, identity, epoch, id, entry, record, snapshot, feed, command, photo };
}
for (const code of ['SYNC_CURSOR_EXPIRED', 'SYNC_CURSOR_INVALID', 'SYNC_TRANSACTION_TOO_LARGE']) {
  const f = await fixture();
  let reads = 0,
    snapshots = 0,
    sends = 0;
  const snapshotId = randomUUID();
  const concurrentId = randomUUID();
  const concurrent = { ...f.entry, id: concurrentId };
  const coordinator = new OfflineCoordinator(
    f.store,
    {
      changes: async (epoch, cursor) => {
        assert.equal(epoch, f.epoch);
        if (++reads === 1) {
          assert.equal(cursor, '1');
          throw failure(code);
        }
        assert.equal(cursor, reads === 2 ? '9' : '10');
        return f.feed('10', [f.record(concurrent)]);
      },
      snapshot: async (requestId, requested, cursor) => {
        snapshots++;
        assert.ok(requestId);
        if (!requested) {
          assert.equal((await f.store.state()).cursor, '1');
          return f.snapshot([f.record(f.entry)], '9', f.epoch, snapshotId, '1');
        }
        assert.equal(requested, snapshotId);
        assert.equal(cursor, '1');
        assert.equal((await f.store.state()).cursor, '1');
        assert.equal(
          (await f.store.records()).find((r) => r.id === f.id).value.content.text,
          'Local retained lunch',
        );
        return f.snapshot([], '9', f.epoch, snapshotId);
      },
      send: async (command) => {
        sends++;
        assert.deepEqual(command, f.command);
        assert.equal((await f.store.state()).cursor, '10');
        assert.equal(
          (await f.store.records()).find((r) => r.id === f.id).value.content.text,
          'Local retained lunch',
        );
        return [f.record({ ...f.entry, revision: 2, content: command.content })];
      },
    },
    randomUUID,
  );
  await coordinator.sync();
  assert.equal(reads, 2);
  assert.equal(snapshots, 2);
  assert.equal(sends, 1);
  assert.equal((await f.store.state()).replayPaused, false);
  assert.equal((await f.store.outbox())[0].state, 'synced');
  assert.deepEqual(await f.store.getDraft('fixture'), { text: 'Unfinished diary input' });
  assert.equal((await f.store.photos())[0].uri, f.photo.uri);
  assert.ok((await f.store.records()).some((r) => r.id === concurrentId));
  await coordinator.sync();
  assert.equal(sends, 1);
  await f.adapter.close();
  console.log(
    `PASS: ${code} recovers atomic frozen snapshot, concurrent catch-up, immutable send once and retained local draft/photo`,
  );
}
// A fresh server version conflicts with unsent work; do not rewrite its revision or payload.
{
  const f = await fixture();
  let reads = 0,
    sends = 0;
  const c = new OfflineCoordinator(
    f.store,
    {
      changes: async () => {
        if (++reads === 1) throw failure('SYNC_CURSOR_EXPIRED');
        return f.feed('9');
      },
      snapshot: async () =>
        f.snapshot([
          f.record({
            ...f.entry,
            revision: 2,
            content: { ...f.entry.content, text: 'New server lunch' },
          }),
        ]),
      send: async () => {
        sends++;
        throw failure('REVISION_CONFLICT', {});
      },
    },
    randomUUID,
  );
  await c.sync();
  assert.equal(sends, 0);
  assert.equal((await f.store.outbox())[0].state, 'conflict');
  assert.deepEqual(JSON.parse((await f.store.outbox())[0].payload), f.command);
  assert.equal((await f.store.records())[0].value.content.text, 'Local retained lunch');
  await f.adapter.close();
  console.log('PASS: stale unsent revision becomes retained conflict before dispatch');
}
// Unknown errors and errors without the documented reset flag must retain their cursor.
for (const [code, details] of [
  ['OTHER_ERROR', { rebootstrap: true }],
  ['SYNC_CURSOR_EXPIRED', {}],
]) {
  const f = await fixture();
  let snapshots = 0;
  const c = new OfflineCoordinator(
    f.store,
    {
      changes: async () => {
        throw failure(code, details);
      },
      snapshot: async () => {
        snapshots++;
        return f.snapshot([]);
      },
      send: async () => {
        throw Error('Must not send');
      },
    },
    randomUUID,
  );
  await assert.rejects(c.sync());
  assert.equal(snapshots, 0);
  assert.equal((await f.store.state()).cursor, '1');
  assert.equal((await f.store.outbox())[0].attempts, 0);
  await f.adapter.close();
}
console.log('PASS: unknown 4xx and missing reset flag never trigger automatic snapshot');
// Repeated capacity errors are bounded, retain the snapshot watermark, and stop before writes.
{
  const f = await fixture();
  let snapshots = 0,
    reads = 0;
  const c = new OfflineCoordinator(
    f.store,
    {
      changes: async () => {
        reads++;
        throw failure('SYNC_TRANSACTION_TOO_LARGE');
      },
      snapshot: async () => {
        snapshots++;
        return f.snapshot([f.record(f.entry)]);
      },
      send: async () => {
        throw Error('Must not send');
      },
    },
    randomUUID,
  );
  await assert.rejects(c.sync(), /fresh snapshot|capacity/i);
  assert.equal(snapshots, 1);
  assert.equal(reads, 2);
  assert.equal((await f.store.state()).cursor, '9');
  assert.equal((await f.store.outbox())[0].attempts, 0);
  assert.match(c.lastError, /local work remains saved/i);
  await f.adapter.close();
  console.log(
    'PASS: repeated oversized transaction stops after one recovery without advancing past the transaction',
  );
}
// Even if feed claims a same-epoch cursor reset, the snapshot itself may reveal restore.
{
  const f = await fixture();
  await f.store.markAttempt(f.command.operationId);
  await f.store.markUncertain(f.command.operationId, 1);
  const restored = randomUUID();
  let sends = 0;
  const c = new OfflineCoordinator(
    f.store,
    {
      changes: async () => {
        throw failure('SYNC_CURSOR_EXPIRED');
      },
      snapshot: async () => f.snapshot([f.record(f.entry)], '9', restored),
      send: async () => {
        sends++;
        return [];
      },
    },
    randomUUID,
  );
  await c.sync();
  assert.equal(sends, 0);
  assert.equal((await f.store.state()).epoch, restored);
  assert.equal((await f.store.state()).replayPaused, true);
  assert.equal((await f.store.outbox())[0].state, 'review');
  assert.deepEqual(JSON.parse((await f.store.outbox())[0].payload), f.command);
  await f.adapter.close();
  console.log(
    'PASS: actual epoch change retains uncertain original work and blocks automatic replay',
  );
}
// Same-epoch lost receipts retry the original immutable command, even when
// confirmed revision advanced because the command may already have committed.
{
  const f = await fixture();
  await f.store.markAttempt(f.command.operationId);
  await f.store.db.run(
    "UPDATE offline_outbox SET state='uncertain',next_attempt_at=0 WHERE partition=?",
    f.store.partitionKey,
  );
  let reads = 0,
    sends = 0;
  const committed = { ...f.entry, revision: 2, content: f.command.content };
  const c = new OfflineCoordinator(
    f.store,
    {
      changes: async () => {
        if (++reads === 1) throw failure('SYNC_CURSOR_EXPIRED');
        return f.feed('9');
      },
      snapshot: async () => f.snapshot([f.record(committed)]),
      send: async (command) => {
        sends++;
        assert.deepEqual(command, f.command);
        return [f.record(committed)];
      },
    },
    randomUUID,
  );
  await c.sync();
  assert.equal(sends, 1);
  assert.equal((await f.store.outbox())[0].state, 'synced');
  assert.equal((await f.store.outbox())[0].operationId, f.command.operationId);
  await f.adapter.close();
  console.log(
    'PASS: same-epoch uncertain receipt retries original payload without changing its revision',
  );
}
// Snapshot failures cannot unlock writes or commit an incomplete watermark.
{
  const f = await fixture();
  let snapshots = 0;
  const snapshotId = randomUUID();
  const c = new OfflineCoordinator(
    f.store,
    {
      changes: async () => {
        throw failure('SYNC_TRANSACTION_TOO_LARGE');
      },
      snapshot: async () => {
        if (++snapshots === 1)
          return f.snapshot([f.record(f.entry)], '9', f.epoch, snapshotId, '1');
        throw new Error('Snapshot record exceeds capacity; local work remains saved.');
      },
      send: async () => {
        throw Error('Must not send');
      },
    },
    randomUUID,
  );
  await assert.rejects(c.sync(), /Snapshot record exceeds capacity/);
  assert.equal(snapshots, 2);
  assert.equal((await f.store.state()).cursor, '1');
  assert.equal((await f.store.outbox())[0].attempts, 0);
  assert.equal((await f.store.records())[0].value.content.text, 'Local retained lunch');
  await f.adapter.close();
  console.log(
    'PASS: oversized snapshot record stops recovery with original cursor and projection intact',
  );
}
