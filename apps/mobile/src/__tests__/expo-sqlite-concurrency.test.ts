import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as SQLite from 'expo-sqlite';
import { openOfflineStore } from '../offline/expo';

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));

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
    getAllAsync: async (sql: string, ...params: (string | number | null)[]) =>
      native.prepare(sql).all(...params),
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
