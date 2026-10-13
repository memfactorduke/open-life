import { randomUUID, createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, lstat, readdir, realpath, copyFile, chmod } from 'node:fs/promises';
import { resolve, join, relative, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client, type Pool, type PoolClient } from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { OwnerPrincipal } from './operations.js';
import { requireOwner } from './operations.js';
import { ApplicationError } from './errors.js';
import type { PortableExport } from '@mems-life/domain';
export const MAINTENANCE_LOCK = 7311027;
const admittedWrite = new AsyncLocalStorage<{ pool: Pool; active: boolean }>();
const transferQueues = new WeakMap<Pool, Promise<void>>();
export async function beginMaintenanceWrite(client: PoolClient): Promise<void> {
  // A wrapper holds its own session guard across nested work, including this transaction.
  if (admittedWrite.getStore()?.active) return;
  await client.query('SELECT pg_advisory_xact_lock_shared($1)', [MAINTENANCE_LOCK]);
  // Only the pre-portability migration schema may omit the control table.
  if (
    !(await client.query("SELECT to_regclass('public.portability_control') AS table_name")).rows[0]
      .table_name
  ) {
    const schema = (
      await client.query("SELECT to_regclass('public.application_migrations') AS table_name")
    ).rows[0].table_name;
    if (
      schema &&
      (await client.query('SELECT 1 FROM application_migrations WHERE version>=13 LIMIT 1'))
        .rowCount
    )
      throw new ApplicationError(
        503,
        'MAINTENANCE',
        'Recovery control is missing; operator repair is required.',
      );
    return;
  }
  const row = (
    await client.query('SELECT maintenance FROM portability_control WHERE singleton=true')
  ).rows[0];
  if (!row || row.maintenance)
    throw new ApplicationError(
      503,
      'MAINTENANCE',
      'The installation is paused for backup or recovery. Retain edits and retry after maintenance.',
    );
}
export async function withMaintenanceWrite<T>(pool: Pool, work: () => Promise<T>): Promise<T> {
  if (admittedWrite.getStore()?.pool === pool && admittedWrite.getStore()?.active) return work();
  // Serialize outer transfers and use a dedicated connection: reserving a pool slot before
  // BetterAuth asks that pool for a connection can starve all requests in a small pool.
  const previous = transferQueues.get(pool) ?? Promise.resolve();
  let finish!: () => void;
  const current = new Promise<void>((resolve) => {
    finish = resolve;
  });
  transferQueues.set(
    pool,
    previous.then(() => current),
  );
  await previous;
  const client = new Client(pool.options);
  let locked = false;
  const admission = { pool, active: true };
  try {
    await client.connect();
    await client.query('SELECT pg_advisory_lock_shared($1)', [MAINTENANCE_LOCK]);
    locked = true;
    const row = (
      await client.query('SELECT maintenance FROM portability_control WHERE singleton=true')
    ).rows[0];
    if (!row || row.maintenance)
      throw new ApplicationError(503, 'MAINTENANCE', 'The installation is paused for recovery.');
    return await admittedWrite.run(admission, work);
  } finally {
    admission.active = false;
    try {
      if (locked) await client.query('SELECT pg_advisory_unlock_shared($1)', [MAINTENANCE_LOCK]);
    } finally {
      await client.end().catch(() => {});
      finish();
    }
  }
}
export async function enterMaintenance(pool: Pool): Promise<() => Promise<void>> {
  const control = await pool.query(
    'UPDATE portability_control SET maintenance=true,entered_at=now() WHERE singleton=true',
  );
  if (control.rowCount !== 1)
    throw new Error('Maintenance control is missing; repair is required.');
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MAINTENANCE_LOCK]);
    await client.query('UPDATE portability_control SET maintenance=true WHERE singleton=true');
  } catch (error) {
    client.release();
    throw error;
  }
  return async () => {
    await client.query('SELECT pg_advisory_unlock($1)', [MAINTENANCE_LOCK]);
    client.release();
  };
}
export async function resumeMaintenance(pool: Pool): Promise<void> {
  const release = await enterMaintenance(pool);
  try {
    await pool.query(
      'UPDATE portability_control SET maintenance=false,entered_at=NULL WHERE singleton=true',
    );
  } finally {
    await release();
  }
}
const tables = [
  'owner_preferences',
  'tasks',
  'task_history',
  'exercises',
  'routines',
  'routine_exercises',
  'workout_sessions',
  'workout_session_history',
  'food_entries',
  'food_history',
  'food_media',
  'boards',
  'projects',
  'recurrence_series',
  'task_steps',
  'agent_grants',
  'agent_provenance',
  'agent_skills',
  'agent_bindings',
  'agent_attempts',
  'agent_results',
  'whoop_connection',
  'whoop_observations',
  'whoop_history',
  'task_files',
  'audit_events',
  'change_feed',
  'operation_receipts',
  'notification_preferences',
  'attention_events',
];
const secretKeys = new Set([
  'password',
  'token',
  'tokens',
  'accessToken',
  'refreshToken',
  'access_token',
  'refresh_token',
  'verifier',
  'token_verifier',
  'ownershipToken',
  'attemptToken',
  'authorizationUrl',
  'pending_state',
  'session_id',
  'clientSecret',
  'client_secret',
  'secret',
  'authorization',
]);
export function redactPortable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactPortable);
  if (value && typeof value === 'object' && !(value instanceof Date))
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !secretKeys.has(key))
        .map(([key, item]) => [key, redactPortable(item)]),
    );
  return value;
}
export async function ownerExport(pool: Pool, actor: OwnerPrincipal): Promise<PortableExport> {
  if (actor.actorType === 'agent')
    throw new ApplicationError(403, 'OWNER_REQUIRED', 'Export requires the owner session.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await requireOwner(client, actor.userId);
    const installation = (
      await client.query('SELECT id,epoch,owner_id FROM installation WHERE owner_id=$1', [
        actor.userId,
      ])
    ).rows[0];
    const records: PortableExport['records'] = {};
    for (const table of tables) {
      const columns = (
        await client.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",
          [table],
        )
      ).rows.map((r) => r.column_name);
      if (!columns.length) continue;
      // A single-owner installation; history joins and globally seeded catalogue retain provenance.
      const filter = columns.includes('owner_id')
        ? ' WHERE owner_id=$1'
        : columns.includes('actor_id') && ['operation_receipts', 'audit_events'].includes(table)
          ? ' WHERE (actor_id=$1 OR actor_id IN (SELECT id::text FROM agent_grants WHERE owner_id=$1))'
          : '';
      const rows = (
        await client.query(
          `SELECT * FROM "${table}"${filter} ORDER BY 1`,
          filter ? [actor.userId] : [],
        )
      ).rows;
      records[table] = redactPortable(rows) as PortableExport['records'][string];
    }
    const attachments: PortableExport['attachments'] = [];
    for (const [table, kind, prefix] of [
      ['food_media', 'food', 'files'],
      ['task_files', 'task', 'task-files/files'],
    ] as const)
      for (const row of records[table] ?? [])
        if (row.status === 'finalized')
          attachments.push({
            id: String(row.id),
            kind,
            path: `attachments/${prefix}/${row.id}`,
            size: Number(row.size),
            sha256: String(row.sha256),
            contentType: String(row.content_type),
            ...(row.name ? { name: String(row.name) } : {}),
          });
    await client.query('COMMIT');
    return {
      format: 'mems-life-owner-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      installationId: installation.id,
      epoch: installation.epoch,
      records,
      attachments,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
export async function digestFile(path: string): Promise<{ size: number; sha256: string }> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Only regular files are portable.');
    const hash = createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    return { size: stat.size, sha256: hash.digest('hex') };
  } finally {
    await handle.close();
  }
}
export async function copyPrivateTree(
  source: string,
  destination: string,
): Promise<Array<{ path: string; size: number; sha256: string }>> {
  const root = resolve(source);
  if ((await lstat(root)).isSymbolicLink() || (await realpath(root)) !== root)
    throw new Error('Media root may not contain symlinks.');
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const manifest: Array<{ path: string; size: number; sha256: string }> = [];
  async function visit(dir: string) {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, item.name);
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) throw new Error('Symlinks cannot be backed up.');
      const rel = relative(root, path);
      const target = join(destination, rel);
      if (stat.isDirectory()) {
        await mkdir(target, { mode: 0o700 });
        await visit(path);
      } else if (stat.isFile()) {
        const digest = await digestFile(path);
        await copyFile(path, target, constants.COPYFILE_EXCL);
        await chmod(target, 0o600);
        const copied = await digestFile(target);
        if (JSON.stringify(digest) !== JSON.stringify(copied))
          throw new Error('Media changed during backup.');
        manifest.push({ path: rel, ...digest });
      } else throw new Error('Unsupported media entry.');
    }
  }
  await visit(root);
  return manifest.sort((a, b) => a.path.localeCompare(b.path));
}
export async function verifyTree(
  root: string,
  manifest: Array<{ path: string; size: number; sha256: string }>,
): Promise<void> {
  const base = resolve(root);
  if ((await realpath(base)) !== base) throw new Error('Unsafe media root.');
  for (const item of manifest) {
    const file = resolve(base, item.path);
    if (file === base || !file.startsWith(base + '/')) throw new Error('Unsafe manifest path.');
    if ((await realpath(dirname(file))) !== dirname(file)) throw new Error('Symlink media path.');
    const actual = await digestFile(file);
    if (actual.size !== item.size || actual.sha256 !== item.sha256)
      throw new Error('Attachment checksum mismatch.');
  }
}
export async function verifyDatabaseMedia(pool: Pool, root: string): Promise<void> {
  for (const [table, prefix] of [
    ['food_media', 'files'],
    ['task_files', 'task-files/files'],
  ] as const) {
    for (const row of (
      await pool.query(
        `SELECT id,size,sha256,status FROM ${table} WHERE status IN ('received','finalized')`,
      )
    ).rows) {
      const path = join(
        root,
        row.status === 'finalized' ? prefix : prefix.replace(/files$/, 'staging'),
        String(row.id),
      );
      if ((await realpath(dirname(path))) !== dirname(path)) throw new Error('Symlink media path.');
      let actual;
      try {
        actual = await digestFile(path);
      } catch (error) {
        if (row.status !== 'received' || (error as NodeJS.ErrnoException).code !== 'ENOENT')
          throw error;
        actual = await digestFile(join(root, prefix, String(row.id)));
      }
      if (actual.size !== Number(row.size) || actual.sha256 !== row.sha256)
        throw new Error('Database attachment reference mismatch.');
    }
  }
}
const run = promisify(execFile);
export async function postgresCommand(
  command: 'pg_dump' | 'pg_restore',
  databaseUrl: string,
  args: string[],
): Promise<void> {
  const url = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new Error('PostgreSQL URL required.');
  // Credentials use the child environment, never argv or operator-facing errors.
  const env = {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: url.searchParams.get('sslmode') || 'prefer',
  };
  try {
    await run(command, args, { env, maxBuffer: 1024 * 1024 });
  } catch {
    throw new Error(
      `${command} failed. Review PostgreSQL availability and protected operator configuration.`,
    );
  }
}
export async function rotateRestoreEpoch(pool: Pool, backupTime: string): Promise<string> {
  const epoch = randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [MAINTENANCE_LOCK]);
    const changed = await client.query('UPDATE installation SET epoch=$1 RETURNING id', [epoch]);
    if (changed.rowCount !== 1) throw new Error('Backup must contain one owner installation.');
    await client.query('DELETE FROM sync_snapshots');
    if (
      (await client.query("SELECT to_regclass('public.notification_devices') AS table_name"))
        .rows[0].table_name
    ) {
      await client.query('DELETE FROM notification_deliveries');
      await client.query('DELETE FROM notification_devices');
    }
    const control = await client.query(
      'UPDATE portability_control SET maintenance=true,restored_from=$1,restored_at=now() WHERE singleton=true',
      [backupTime],
    );
    if (control.rowCount !== 1) throw new Error('Restored maintenance control is missing.');
    await client.query('COMMIT');
    return epoch;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
