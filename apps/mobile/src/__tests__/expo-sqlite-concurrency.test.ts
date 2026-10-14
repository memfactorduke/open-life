import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as SQLite from 'expo-sqlite';
import { openOfflineStore } from '../offline/expo';
import { OfflineCoordinator, type OfflineTransport } from '../offline';

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));

let receiptRowsRead = 0;
// This is an adapter regression, not a native Expo test. Use real independent
// SQLite connections, matching installed Expo's exclusive transaction boundary.
function connection(path: string, limitPages = false): SQLite.SQLiteDatabase {
  const native = new DatabaseSync(path);
  if (limitPages) {
    const pages = native.prepare('PRAGMA page_count').get() as { page_count: number };
    native.exec(`PRAGMA max_page_count = ${pages.page_count}`);
  }
  const db = {
    execAsync: async (sql: string) => native.exec(sql),
    runAsync: async (sql: string, ...params: (string | number | null)[]) =>
      native.prepare(sql).run(...params),
    getAllAsync: async (sql: string, ...params: (string | number | null)[]) => {
      const rows = native.prepare(sql).all(...params);
      if (sql.includes('offline_outbox')) receiptRowsRead += rows.length;
      return rows;
    },
    closeAsync: async () => native.close(),
    withExclusiveTransactionAsync: async (work: (tx: SQLite.SQLiteDatabase) => Promise<void>) => {
      const tx = connection(path, limitPages);
      try {
        await tx.execAsync('BEGIN');
        await work(tx);
        await tx.execAsync('COMMIT');
      } catch (error) {
        await tx.execAsync('ROLLBACK');
        throw error;
      } finally {
        await tx.closeAsync();
      }
    },
  };
  return db as unknown as SQLite.SQLiteDatabase;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const partition = { installationId: 'fictional-installation', ownerId: 'fictional-owner' };
let folder: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'expo-offline-concurrency-'));
  jest
    .mocked(SQLite.openDatabaseAsync)
    .mockImplementation(async () => connection(join(folder, 'offline.sqlite')));
});
afterEach(() => rmSync(folder, { recursive: true, force: true }));

test('the connection harness actually rejects competing writers with SQLite error 5', async () => {
  const path = join(folder, 'control.sqlite');
  const base = connection(path),
    writer = connection(path);
  await base.execAsync('PRAGMA journal_mode=WAL; CREATE TABLE control(value TEXT)');
  await writer.execAsync('BEGIN');
  await writer.runAsync("INSERT INTO control VALUES('uncommitted')");
  await expect(base.runAsync("INSERT INTO control VALUES('competing')")).rejects.toMatchObject({
    errcode: 5,
    message: 'database is locked',
  });
  await writer.execAsync('ROLLBACK');
  await writer.closeAsync();
  await base.closeAsync();
});

test('snapshot transaction serializes competing foreground transaction and base writes', async () => {
  const store = await openOfflineStore(partition);
  await store.db.exec('CREATE TABLE adapter_probe(value TEXT NOT NULL)');
  const entered = deferred(),
    release = deferred();
  const snapshot = store.db.transaction(async (tx) => {
    await tx.run("INSERT INTO adapter_probe VALUES('snapshot')");
    entered.resolve();
    await release.promise;
    await tx.run("INSERT INTO adapter_probe VALUES('cursor')");
  });
  await entered.promise;
  const foreground = store.db.transaction(async (tx) => {
    await tx.run("INSERT INTO adapter_probe VALUES('projection')");
    await tx.run("INSERT INTO adapter_probe VALUES('outbox')");
  });
  const draft = store.db.run("INSERT INTO adapter_probe VALUES('draft')");
  // Attach the assertion before releasing so lock rejection is captured.
  const completed = expect(Promise.all([snapshot, foreground, draft])).resolves.toEqual([
    undefined,
    undefined,
    undefined,
  ]);
  release.resolve();
  await completed;
  expect(await store.db.all('SELECT value FROM adapter_probe ORDER BY rowid')).toEqual([
    { value: 'snapshot' },
    { value: 'cursor' },
    { value: 'projection' },
    { value: 'outbox' },
    { value: 'draft' },
  ]);
  await store.db.close();
});

test('another store initialization and reads wait for the active file transaction', async () => {
  const store = await openOfflineStore(partition);
  await store.db.exec('CREATE TABLE adapter_probe(value TEXT NOT NULL)');
  const entered = deferred(),
    release = deferred();
  const transaction = store.db.transaction(async (tx) => {
    await tx.run("INSERT INTO adapter_probe VALUES('committed')");
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  const secondStore = openOfflineStore({ ...partition, ownerId: 'second-fictional-owner' });
  let readCompleted = false;
  const read = store.db.all('SELECT value FROM adapter_probe').then((rows) => {
    readCompleted = true;
    return rows;
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(readCompleted).toBe(false);
  const completed = Promise.all([transaction, secondStore, read]);
  release.resolve();
  const [, other, rows] = await completed;
  expect(rows).toEqual([{ value: 'committed' }]);
  await store.db.close();
  await other.db.close();
});

test('rollback rejects the caller and releases the queue for subsequent durable work', async () => {
  const store = await openOfflineStore(partition);
  await store.db.exec('CREATE TABLE adapter_probe(value TEXT NOT NULL)');
  const failed = store.db.transaction(async (tx) => {
    await tx.run("INSERT INTO adapter_probe VALUES('must-roll-back')");
    throw new Error('disk failure');
  });
  const next = store.db.transaction(async (tx) => {
    await tx.run("INSERT INTO adapter_probe VALUES('durable-next')");
    return 'committed';
  });
  await expect(failed).rejects.toThrow('disk failure');
  await expect(next).resolves.toBe('committed');
  expect(await store.db.all('SELECT value FROM adapter_probe')).toEqual([
    { value: 'durable-next' },
  ]);
  await store.db.close();
});

test('a real SQLite full error survives Expo rollback masking and releases the queue', async () => {
  const path = join(folder, 'capacity.sqlite');
  const db = connection(path);
  jest.mocked(SQLite.openDatabaseAsync).mockResolvedValue(db);
  const store = await openOfflineStore(partition);
  await store.db.exec('CREATE TABLE capacity_probe(value BLOB)');
  const limited = connection(path, true);
  db.withExclusiveTransactionAsync = limited.withExclusiveTransactionAsync;
  // Installed Expo tries ROLLBACK after the failed callback. SQLite FULL has
  // already rolled back, so this control reproduces its masking failure.
  await expect(
    limited.withExclusiveTransactionAsync(async (tx) => {
      await tx.runAsync('INSERT INTO capacity_probe VALUES(randomblob(1000000))');
    }),
  ).rejects.toThrow('cannot rollback - no transaction is active');
  let original: unknown;
  const failed = store.db.transaction(async (tx) => {
    await tx.run("INSERT INTO capacity_probe VALUES('must-roll-back')");
    try {
      await tx.run('INSERT INTO capacity_probe VALUES(randomblob(1000000))');
    } catch (error) {
      original = error;
      throw error;
    }
  });
  const next = store.db.transaction(async (tx) => {
    await tx.run("INSERT INTO capacity_probe VALUES('durable-next')");
    return 'committed';
  });
  await expect(failed).rejects.toMatchObject({
    errcode: 13,
    message: 'database or disk is full',
  });
  await expect(failed).rejects.toBe(original);
  await expect(next).resolves.toBe('committed');
  expect(await store.db.all('SELECT value FROM capacity_probe')).toEqual([
    { value: 'durable-next' },
  ]);
  await limited.closeAsync();
  await store.db.close();
});

test('an error after a successful callback is returned unchanged', async () => {
  const db = connection(join(folder, 'commit.sqlite'));
  jest.mocked(SQLite.openDatabaseAsync).mockResolvedValue(db);
  const store = await openOfflineStore(partition);
  const commitFailure = Object.assign(new Error('commit failed'), { code: 'COMMIT_FAILURE' });
  db.withExclusiveTransactionAsync = async (work) => {
    await work(db);
    throw commitFailure;
  };
  await expect(store.db.transaction(async () => 'callback completed')).rejects.toBe(commitFailure);
  await store.db.close();
});

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function replayFixture() {
  const store = await openOfflineStore(partition);
  const now = '2026-10-13T12:00:00Z';
  await store.stageSnapshot({
    ...partition,
    schemaVersion: 1,
    epoch: 'epoch',
    watermark: '0',
    snapshotId: uuid(10),
    records: [],
    nextCursor: null,
  });
  const saved = await store.save({
    type: 'food.create',
    operationId: uuid(1),
    entryId: uuid(2),
    expectedRevision: 0,
    content: { text: 'Lunch', occurredAt: now, timezone: 'UTC' },
  });
  const transport: OfflineTransport = {
    snapshot: async () => {
      throw new Error('Unexpected snapshot');
    },
    changes: async () => ({
      ...partition,
      schemaVersion: 1,
      epoch: 'epoch',
      watermark: '0',
      records: [],
      cursor: '0',
      hasMore: false,
    }),
    send: jest.fn(async () => [{ ...saved, value: saved.value }]),
  };
  return { store, saved, transport };
}
test('a server acknowledgement that conflicts the next edit prevents its stale replay dispatch', async () => {
  const { store, saved, transport } = await replayFixture();
  await store.save({
    type: 'food.edit',
    operationId: uuid(3),
    entryId: uuid(2),
    expectedRevision: 1,
    content: { text: 'Retained local edit', occurredAt: '2026-10-13T12:00:00Z', timezone: 'UTC' },
  });
  jest
    .mocked(transport.send)
    .mockResolvedValue([
      { ...saved, revision: 2, value: { ...(saved.value as object), revision: 2 } },
    ]);
  await new OfflineCoordinator(store, transport, () => uuid(10)).sync();
  expect(transport.send).toHaveBeenCalledTimes(1);
  expect((await store.outbox())[1]).toMatchObject({ state: 'conflict', attempts: 0 });
  await store.db.close();
});
test('competing coordinators atomically claim one persisted command before dispatch', async () => {
  const { store, saved, transport } = await replayFixture();
  const entered = deferred(),
    release = deferred();
  jest.mocked(transport.send).mockImplementation(async () => {
    entered.resolve();
    await release.promise;
    return [saved];
  });
  const first = new OfflineCoordinator(store, transport, () => uuid(10)).sync();
  await entered.promise;
  await new OfflineCoordinator(store, transport, () => uuid(11)).sync();
  release.resolve();
  await first;
  expect(transport.send).toHaveBeenCalledTimes(1);
  expect((await store.outbox())[0]).toMatchObject({ state: 'synced', attempts: 1 });
  await store.db.close();
});
test('a late interrupted response cannot revive owner-discarded pending work', async () => {
  const { store } = await replayFixture();
  await store.markAttempt(uuid(1));
  await store.discardPending();
  await store.markUncertain(uuid(1), 1);
  expect((await store.outbox())[0].state).toBe('discarded');
  await store.db.close();
});

test('concurrent attempts claim a persisted command only once and respect sign-out', async () => {
  const { store } = await replayFixture();
  expect(await Promise.all([store.markAttempt(uuid(1)), store.markAttempt(uuid(1))])).toEqual([
    true,
    false,
  ]);
  await store.markUncertain(uuid(1), 1);
  await store.signOut(true);
  expect(await store.markAttempt(uuid(1))).toBe(false);
  await store.db.close();
});
test('a stale upload progress update cannot overwrite restore review or discarded retention', async () => {
  const { store } = await replayFixture();
  const photo = {
    id: uuid(5),
    operationId: uuid(6),
    entryId: uuid(2),
    uri: 'file:///fictional/Documents/lunch.jpg',
    size: 10,
    sha256: 'a'.repeat(64),
  };
  await store.retainPhoto(photo);
  await store.observeEpoch('restored-epoch');
  await expect(store.updatePhoto({ ...photo, attempts: 1 }, 'pending')).rejects.toMatchObject({
    code: 'PHOTO_REVIEW_REQUIRED',
  });
  expect((await store.photos())[0].status).toBe('needs-attention');
  await store.discardPending();
  await expect(store.updatePhoto(photo, 'pending')).rejects.toMatchObject({
    code: 'PHOTO_REVIEW_REQUIRED',
  });
  expect((await store.photos())[0].status).toBe('discarded');
  await store.db.close();
});

test('an acknowledgement omitting the edited record cannot erase a durable pending edit', async () => {
  const { store, saved } = await replayFixture();
  await store.markAttempt(uuid(1));
  await store.accept(uuid(1), [saved]);
  await store.save({
    type: 'food.edit',
    operationId: uuid(3),
    entryId: uuid(2),
    expectedRevision: 1,
    content: { text: 'Must remain retained', occurredAt: '2026-10-13T12:00:00Z', timezone: 'UTC' },
  });
  await store.markAttempt(uuid(3));
  await expect(store.accept(uuid(3), [])).rejects.toMatchObject({ code: 'INVALID_ACK' });
  expect((await store.outbox())[1].state).toBe('attempted');
  expect((await store.records('food'))[0].value).toMatchObject({
    content: { text: 'Must remain retained' },
  });
  await store.db.close();
});

test('recovery export reads outbox and projection from one consistent SQLite transaction', async () => {
  const { store } = await replayFixture();
  const original = store.outbox.bind(store);
  let edit: Promise<unknown> | undefined;
  jest.spyOn(store, 'outbox').mockImplementationOnce(async (tx) => {
    const entries = await original(tx);
    edit = store.save({
      type: 'food.edit',
      operationId: uuid(3),
      entryId: uuid(2),
      expectedRevision: 1,
      content: {
        text: 'Concurrent later edit',
        occurredAt: '2026-10-13T12:00:00Z',
        timezone: 'UTC',
      },
    });
    return entries;
  });
  const exported = JSON.parse(await store.exportPending());
  await edit;
  expect(exported.outbox).toHaveLength(1);
  expect(exported.records[0].value).toMatchObject({ revision: 1, content: { text: 'Lunch' } });
  expect((await store.records('food'))[0].revision).toBe(2);
  await store.db.close();
});

test('six months of retained receipts do not get reread for every pending dispatch', async () => {
  const { store, saved, transport } = await replayFixture();
  await store.markAttempt(uuid(1));
  await store.accept(uuid(1), [saved]);
  // Six months: roughly 4 workouts/week * 40 events plus 3 food entries/day * 2 events.
  // Keep immutable receipts as the product requires; another offline week adds 60 captures.
  await store.db.transaction(async (tx) => {
    for (let n = 100; n < 6100; n++)
      await tx.run(
        "INSERT INTO offline_outbox(partition,operation_id,aggregate,payload,local_at,dependencies,state) VALUES(?,?,?,?,?,?,'synced')",
        store.partitionKey,
        uuid(n),
        `food:${uuid(n + 10000)}`,
        '{}',
        '2026-10-13T12:00:00Z',
        '[]',
      );
  });
  for (let n = 7000; n < 7060; n++)
    await store.save({
      type: 'food.create',
      operationId: uuid(n),
      entryId: uuid(n + 10000),
      expectedRevision: 0,
      content: {
        text: 'Fictional retained meal',
        occurredAt: '2026-10-13T12:00:00Z',
        timezone: 'UTC',
      },
    });
  jest.mocked(transport.send).mockImplementation(async (command) => {
    const record = (await store.records('food')).find(
      (row) => row.id === (command as { entryId: string }).entryId,
    )!;
    return [record];
  });
  receiptRowsRead = 0;
  const started = performance.now();
  await new OfflineCoordinator(store, transport, () => uuid(10)).sync();
  const elapsed = performance.now() - started;
  console.info(
    `Offline six-month replay: ${elapsed.toFixed(1)} ms; ${receiptRowsRead} receipts materialized; 60 pending dispatches`,
  );
  expect(transport.send).toHaveBeenCalledTimes(60);
  expect(receiptRowsRead).toBeLessThan(15000);
  await store.db.close();
}, 30000);

test.each(['restore', 'sign-out', 'discard'] as const)(
  'a late photo finalization after %s cannot silently clear retained state',
  async (invalidation) => {
    const { store } = await replayFixture();
    const photo = {
      id: uuid(5),
      operationId: uuid(6),
      entryId: uuid(2),
      uri: 'file:///fictional/Documents/lunch.jpg',
      size: 10,
      sha256: 'a'.repeat(64),
      attemptEpoch: 'epoch',
      attempts: 1,
    };
    await store.retainPhoto(photo);
    await store.save(
      {
        type: 'food.edit',
        operationId: uuid(3),
        entryId: uuid(2),
        expectedRevision: 1,
        content: { text: 'Saved capture', occurredAt: '2026-10-13T12:00:00Z', timezone: 'UTC' },
      },
      { foodSave: { photoUris: [photo.uri], draftKey: 'food-editor' } },
    );
    if (invalidation === 'restore') await store.observeEpoch('new-epoch');
    if (invalidation === 'sign-out') await store.signOut(true);
    if (invalidation === 'discard') await store.discardPending();
    const before = (await store.photos())[0];
    await expect(
      store.updatePhoto({ ...before, delivery: 'synced' }, 'synced', {
        confirmedRecords: [
          {
            recordType: 'food',
            id: uuid(2),
            revision: 99,
            value: { staleFinalization: true, revision: 99 },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'PHOTO_REVIEW_REQUIRED' });
    expect((await store.photos())[0]).toEqual(before);
    expect((await store.records('food')).some((record) => record.revision === 99)).toBe(false);
    await store.db.close();
  },
);

test('explicit matching-image review can confirm an old upload only against the checked current epoch', async () => {
  const { store } = await replayFixture();
  const photo = {
    id: uuid(5),
    operationId: uuid(6),
    entryId: uuid(2),
    uri: 'file:///fictional/Documents/lunch.jpg',
    size: 10,
    sha256: 'a'.repeat(64),
    attemptEpoch: 'epoch',
    attempts: 1,
  };
  await store.retainPhoto(photo);
  await store.observeEpoch('new-epoch');
  await store.stageSnapshot({
    ...partition,
    schemaVersion: 1,
    epoch: 'new-epoch',
    watermark: '0',
    snapshotId: uuid(20),
    records: [],
    nextCursor: null,
  });
  await expect(
    store.updatePhoto({ ...photo, recoveredMediaId: uuid(30), delivery: 'synced' }, 'synced', {
      reviewedEpoch: 'epoch',
    }),
  ).rejects.toMatchObject({ code: 'PHOTO_REVIEW_REQUIRED' });
  await store.updatePhoto({ ...photo, recoveredMediaId: uuid(30), delivery: 'synced' }, 'synced', {
    reviewedEpoch: 'new-epoch',
  });
  expect((await store.photos())[0]).toMatchObject({
    status: 'synced',
    attemptEpoch: 'epoch',
    recoveredMediaId: uuid(30),
  });
  await store.db.close();
});

test.each(['restore', 'sign-out', 'reauth', 'discard'] as const)(
  'a late command acknowledgement after %s cannot revive or confirm retained work',
  async (invalidation) => {
    const { store, saved } = await replayFixture();
    await store.markAttempt(uuid(1));
    if (invalidation === 'restore') {
      await store.observeEpoch('new-epoch');
      await store.stageSnapshot({
        ...partition,
        schemaVersion: 1,
        epoch: 'new-epoch',
        watermark: '0',
        snapshotId: uuid(20),
        records: [],
        nextCursor: null,
      });
    }
    if (invalidation === 'sign-out' || invalidation === 'reauth') await store.signOut(true);
    if (invalidation === 'reauth') await store.signIn();
    if (invalidation === 'discard') await store.discardPending();
    const before = await store.exportPending();
    await expect(store.accept(uuid(1), [saved])).rejects.toMatchObject({
      code: 'ACK_REVIEW_REQUIRED',
    });
    expect(await store.exportPending()).toBe(before);
    await store.db.close();
  },
);

test('explicit reviewed receipt confirmation uses the current checked epoch', async () => {
  const { store, saved } = await replayFixture();
  await store.markAttempt(uuid(1));
  await store.observeEpoch('new-epoch');
  await store.stageSnapshot({
    ...partition,
    schemaVersion: 1,
    epoch: 'new-epoch',
    watermark: '0',
    snapshotId: uuid(20),
    records: [saved],
    nextCursor: null,
  });
  await expect(store.accept(uuid(1), [saved], { reviewedEpoch: 'epoch' })).rejects.toMatchObject({
    code: 'ACK_REVIEW_REQUIRED',
  });
  await store.reconcileAttempted(uuid(1), 'already-applied', [saved]);
  expect((await store.outbox())[0].state).toBe('synced');
  expect((await store.records('food'))[0].confirmed).toEqual(saved.value);
  await store.db.close();
});
test('late rejection or reviewed-dispatch failure cannot revive discarded commands', async () => {
  const { store } = await replayFixture();
  await store.markAttempt(uuid(1));
  await store.discardPending();
  await store.reject(uuid(1), 'Late rejected response');
  await store.requireAttemptReview(uuid(1), 'Late reviewed response');
  expect((await store.outbox())[0].state).toBe('discarded');
  await store.db.close();
});

test('compact sync summary counts only this partition pending and review states without decoding archived data', async () => {
  const store = await openOfflineStore(partition);
  await store.db.transaction(async (tx) => {
    const states = [
      'never-sent',
      'attempted',
      'uncertain',
      'conflict',
      'review',
      'synced',
      'discarded',
    ];
    for (let n = 0; n < states.length; n++)
      await tx.run(
        'INSERT INTO offline_outbox(partition,operation_id,aggregate,payload,local_at,dependencies,state) VALUES(?,?,?,?,?,?,?)',
        store.partitionKey,
        uuid(n + 100),
        'food:fixture',
        'malformed payload not needed by counts',
        'fixture',
        '[]',
        states[n],
      );
    const photos = ['draft', 'pending', 'needs-attention', 'synced', 'discarded'];
    for (let n = 0; n < photos.length; n++)
      await tx.run(
        'INSERT INTO offline_photos(partition,id,entry_id,value,status) VALUES(?,?,?,?,?)',
        store.partitionKey,
        uuid(n + 200),
        'fixture',
        JSON.stringify({ id: uuid(n + 200) }),
        photos[n],
      );
    await tx.run(
      "INSERT INTO offline_photos(partition,id,entry_id,value,status) VALUES('foreign',?,'fixture','{}','needs-attention')",
      uuid(300),
    );
    await tx.run(
      "INSERT INTO offline_outbox(partition,operation_id,aggregate,payload,local_at,dependencies,state) VALUES('foreign',?,'food:fixture','{}','fixture','[]','review')",
      uuid(301),
    );
    for (let n = 0; n < 6000; n++) {
      await tx.run(
        "INSERT INTO offline_outbox(partition,operation_id,aggregate,payload,local_at,dependencies,state) VALUES(?,?,'food:fixture','not JSON','fixture','[]','synced')",
        store.partitionKey,
        uuid(n + 1000),
      );
      await tx.run(
        "INSERT INTO offline_photos(partition,id,entry_id,value,status) VALUES(?,?,'fixture','not JSON','synced')",
        store.partitionKey,
        uuid(n + 10000),
      );
    }
  });
  const queries: string[] = [];
  const transaction = store.db.transaction.bind(store.db);
  jest.spyOn(store.db, 'transaction').mockImplementation((work) =>
    transaction((tx) =>
      work({
        ...tx,
        all: async <T>(sql: string, ...params: (string | number | null)[]) => {
          queries.push(sql);
          return tx.all<T>(sql, ...params);
        },
      }),
    ),
  );
  const started = performance.now();
  expect(await store.syncSummary()).toEqual({
    pendingChangeCount: 5,
    pendingPhotoCount: 3,
    reviewChangeCount: 2,
    reviewPhotoCount: 1,
  });
  console.info(
    `Compact sync summary with 6000 archived receipts/photos: ${(performance.now() - started).toFixed(1)} ms`,
  );
  expect(queries).toHaveLength(2);
  expect(queries.every((sql) => sql.startsWith('SELECT COUNT(*)'))).toBe(true);
  expect((await store.pendingEntries()).map((entry) => entry.state)).toEqual([
    'never-sent',
    'attempted',
    'uncertain',
    'conflict',
    'review',
  ]);
  expect((await store.pendingPhotos()).map((photo) => photo.status).sort()).toEqual([
    'draft',
    'needs-attention',
    'pending',
  ]);
  await store.db.close();
});
