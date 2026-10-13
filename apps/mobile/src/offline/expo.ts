import * as SQLite from 'expo-sqlite';
import type { SqlDatabase, SqlExecutor, Partition } from './types';
import { OfflineStore } from './store';

// Every partition/store uses this same file. Expo exclusive transactions open
// separate connections, so even another store's initialization or a base write
// can fail with SQLITE_BUSY while a transaction is active. Queue entire public
// operations, including reads and close, until commit/rollback and finalization
// finish. Transaction callbacks use their own unqueued executor below.
let databaseTail: Promise<void> = Promise.resolve();
function serialize<T>(work: () => Promise<T>): Promise<T> {
  const operation = databaseTail.then(work);
  // A failed operation must reject its caller without poisoning later work.
  databaseTail = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

function executor(db: SQLite.SQLiteDatabase): SqlExecutor {
  return {
    exec: (sql) => db.execAsync(sql),
    run: async (sql, ...params) => {
      await db.runAsync(sql, ...params);
    },
    all: <T>(sql: string, ...params: (string | number | null)[]) =>
      db.getAllAsync<T>(sql, ...params),
  };
}
export async function openOfflineStore(partition: Partition): Promise<OfflineStore> {
  const db = await serialize(() => SQLite.openDatabaseAsync('mems-life-offline.sqlite'));
  const base = executor(db);
  const adapter: SqlDatabase = {
    exec: (sql) => serialize(() => base.exec(sql)),
    run: (sql, ...params) => serialize(() => base.run(sql, ...params)),
    all: <T>(sql: string, ...params: (string | number | null)[]) =>
      serialize(() => base.all<T>(sql, ...params)),
    transaction: (work) =>
      serialize(async () => {
        let result: Awaited<ReturnType<typeof work>> | undefined;
        let callbackFailed = false;
        let callbackError: unknown;
        try {
          await db.withExclusiveTransactionAsync(async (tx) => {
            try {
              result = await work(executor(tx));
            } catch (error) {
              callbackFailed = true;
              callbackError = error;
              throw error;
            }
          });
        } catch (error) {
          // SQLite can automatically roll back a full-disk transaction. Expo's
          // subsequent ROLLBACK then rejects, hiding the callback's original
          // failure. Preserve that exact error, including its native code/cause.
          // BEGIN/COMMIT failures still come from Expo unchanged.
          throw callbackFailed ? callbackError : error;
        }
        return result as Awaited<ReturnType<typeof work>>;
      }),
    close: () => serialize(() => db.closeAsync()),
  };
  const store = new OfflineStore(adapter, partition);
  await store.initialize();
  return store;
}
