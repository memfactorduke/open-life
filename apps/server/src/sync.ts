import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { SyncSnapshotPageSchema, SyncChangesPageSchema, type SyncRecord } from '@mems-life/domain';
import { transaction } from './database.js';
import { requireOwner, type OwnerPrincipal } from './operations.js';
import { ApplicationError } from './errors.js';
import { taskFromRow } from './tasks.js';

const MAX_SNAPSHOT_RECORDS = 50_000;
const MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024;
const MAX_TRANSACTION_RECORDS = 10_000;
const MAX_TRANSACTION_BYTES = 8 * 1024 * 1024;
const TTL_MINUTES = 30;
function ownerOnly(actor: OwnerPrincipal) {
  if (actor.actorType === 'agent' || (actor.actorId && actor.actorId !== actor.userId))
    throw new ApplicationError(403, 'OWNER_REQUIRED', 'Synchronization requires an owner session.');
}
type Installation = { id: string; epoch: string; feed_position: string };
async function installation(client: PoolClient, actor: OwnerPrincipal) {
  ownerOnly(actor);
  await requireOwner(client, actor.userId);
  const row = (
    await client.query<Installation>(
      'SELECT id,epoch,feed_position FROM installation WHERE owner_id=$1 FOR UPDATE',
      [actor.userId],
    )
  ).rows[0]!;
  if (row.id !== actor.installationId)
    throw new ApplicationError(
      409,
      'SYNC_INSTALLATION_CHANGED',
      'Sign in again and restart synchronization.',
      { rebootstrap: true },
    );
  return row;
}
function epochCheck(actual: string, expected: string) {
  if (actual !== expected)
    throw new ApplicationError(
      409,
      'SYNC_EPOCH_CHANGED',
      'The installation was restored. Retain pending edits, pause replay and download a new snapshot.',
      { epoch: actual, rebootstrap: true, pauseReplay: true },
    );
}
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v);
async function collect(client: PoolClient, ownerId: string): Promise<SyncRecord[]> {
  const records: SyncRecord[] = [];
  let bytes = 0;
  const add = (record: SyncRecord) => {
    bytes += Buffer.byteLength(JSON.stringify(record));
    if (records.length >= MAX_SNAPSHOT_RECORDS || bytes > MAX_SNAPSHOT_BYTES)
      throw new ApplicationError(
        413,
        'SYNC_SNAPSHOT_TOO_LARGE',
        'Snapshot exceeds supported offline cache capacity.',
      );
    records.push(record);
  };
  const rows = async (table: string) =>
    (
      await client.query(`SELECT * FROM ${table} WHERE owner_id=$1 ORDER BY 1 LIMIT $2`, [
        ownerId,
        MAX_SNAPSHOT_RECORDS + 1,
      ])
    ).rows;
  for (const r of await rows('owner_preferences'))
    add({
      recordType: 'preferences',
      id: ownerId,
      revision: r.revision,
      value: { revision: r.revision, value: r.value },
    });
  for (const r of await rows('tasks'))
    add({ recordType: 'task', id: r.id, revision: r.revision, value: taskFromRow(r) });
  for (const [table, kind] of [
    ['exercises', 'exercise'],
    ['routines', 'routine'],
  ] as const) {
    for (const r of await rows(table))
      add({
        recordType: kind,
        id: r.id,
        revision: r.revision,
        value: {
          ...r.content,
          id: r.id,
          revision: r.revision,
          ...(kind === 'exercise' ? { origin: r.origin } : {}),
          createdAt: iso(r.created_at),
          updatedAt: iso(r.updated_at),
          archivedAt: iso(r.archived_at),
        },
      });
  }
  for (const [table, kind] of [
    ['workout_sessions', 'session'],
    ['food_entries', 'food'],
    ['boards', 'board'],
    ['projects', 'project'],
    ['recurrence_series', 'series'],
    ['task_steps', 'step'],
    ['agent_skills', 'skill'],
    ['agent_bindings', 'binding'],
    ['agent_attempts', 'attempt'],
    ['agent_results', 'result'],
  ] as const) {
    for (const r of await rows(table))
      add({
        recordType: kind,
        id: r.id ?? r.step_id,
        revision: r.revision ?? r.value.revision,
        value: r.value,
      });
  }
  for (const r of await rows('food_media'))
    add({
      recordType: 'media',
      id: r.id,
      revision: 0,
      value: {
        id: r.id,
        entryId: r.entry_id,
        status: r.status,
        size: r.size,
        sha256: r.sha256,
        contentType: r.content_type,
        createdAt: iso(r.created_at),
        detachedAt: iso(r.detached_at),
      },
    });
  if ((await client.query("SELECT to_regclass('public.task_files') AS name")).rows[0].name)
    for (const r of await rows('task_files'))
      add({
        recordType: 'taskFile',
        id: r.id,
        revision: 0,
        value: {
          id: r.id,
          taskId: r.task_id,
          name: r.name,
          status: r.status,
          size: r.size,
          sha256: r.sha256,
          contentType: r.content_type,
          createdAt: iso(r.created_at),
          detachedAt: iso(r.detached_at),
        },
      });
  // Provider credentials, OAuth states, grant verifiers and private storage locations are deliberately absent.
  for (const r of await rows('whoop_connection'))
    add({
      recordType: 'connection',
      id: ownerId,
      revision: r.revision,
      value: {
        status: r.status,
        accountId: r.account_id,
        connectedAt: iso(r.connected_at),
        lastSuccessAt: iso(r.last_success_at),
      },
    });
  for (const r of await rows('whoop_observations'))
    add({
      recordType: 'provider',
      id: `${r.account_id}:${r.resource}:${r.provider_id}`,
      revision: r.revision,
      value: {
        accountId: r.account_id,
        resource: r.resource,
        providerId: r.provider_id,
        payload: r.payload,
        retrievedAt: iso(r.retrieved_at),
        available: r.available,
        linkedSessionId: r.linked_session_id,
      },
    });
  return records;
}
export async function createSyncSnapshot(
  pool: Pool,
  actor: OwnerPrincipal,
  requestId: string,
  authorizeAgain: (client: PoolClient) => Promise<void>,
) {
  ownerOnly(actor);
  for (let attempt = 0; ; attempt++) {
    try {
      const id = await transaction(
        pool,
        async (client) => {
          const i = await installation(client, actor);
          await authorizeAgain(client);
          await client.query('DELETE FROM sync_snapshots WHERE expires_at<=now()');
          const existing = (
            await client.query(
              'SELECT id,epoch FROM sync_snapshots WHERE owner_id=$1 AND request_id=$2',
              [actor.userId, requestId],
            )
          ).rows[0];
          if (existing) {
            epochCheck(i.epoch, existing.epoch);
            return existing.id as string;
          }
          const records = await collect(client, actor.userId);
          const id = randomUUID();
          await client.query(
            `INSERT INTO sync_snapshots(id,owner_id,request_id,installation_id,epoch,watermark,schema_version,expires_at) VALUES($1,$2,$3,$4,$5,$6,1,now()+interval '${TTL_MINUTES} minutes')`,
            [id, actor.userId, requestId, i.id, i.epoch, i.feed_position],
          );
          await client.query(
            'INSERT INTO sync_snapshot_records(snapshot_id,ordinal,record) SELECT $1,ordinality-1,value FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY',
            [id, JSON.stringify(records)],
          );
          return id;
        },
        { isolation: 'repeatable-read' },
      );
      return readSyncSnapshot(pool, actor, id, '0', 100, authorizeAgain);
    } catch (error) {
      if (attempt < 2 && (error as { code?: string }).code === '40001') continue;
      throw error;
    }
  }
}
export async function readSyncSnapshot(
  pool: Pool,
  actor: OwnerPrincipal,
  id: string,
  cursor = '0',
  limit = 100,
  authorizeAgain: (client: PoolClient) => Promise<void> = async () => {},
) {
  return transaction(pool, async (client) => {
    const i = await installation(client, actor);
    await authorizeAgain(client);
    const s = (
      await client.query('SELECT * FROM sync_snapshots WHERE id=$1 AND owner_id=$2', [
        id,
        actor.userId,
      ])
    ).rows[0];
    if (!s || new Date(s.expires_at).getTime() <= Date.now())
      throw new ApplicationError(
        410,
        'SYNC_SNAPSHOT_EXPIRED',
        'Restart snapshot download; retain all pending local edits.',
        { rebootstrap: true },
      );
    epochCheck(i.epoch, s.epoch);
    const rows = (
      await client.query(
        'SELECT ordinal,record FROM sync_snapshot_records WHERE snapshot_id=$1 AND ordinal >= $2 ORDER BY ordinal LIMIT $3',
        [id, cursor, limit + 1],
      )
    ).rows;
    return SyncSnapshotPageSchema.parse({
      schemaVersion: 1,
      ownerId: actor.userId,
      installationId: s.installation_id,
      epoch: s.epoch,
      watermark: s.watermark,
      snapshotId: id,
      expiresAt: iso(s.expires_at),
      records: rows.slice(0, limit).map((r) => r.record),
      nextCursor: rows.length > limit ? String(rows[limit].ordinal) : null,
    });
  });
}
export async function readSyncChanges(
  pool: Pool,
  actor: OwnerPrincipal,
  epoch: string,
  cursor = '0',
  limit = 100,
  authorizeAgain: (client: PoolClient) => Promise<void> = async () => {},
) {
  return transaction(pool, async (client) => {
    const i = await installation(client, actor);
    await authorizeAgain(client);
    epochCheck(i.epoch, epoch);
    const floor =
      (await client.query('SELECT floor FROM sync_retention WHERE owner_id=$1', [actor.userId]))
        .rows[0]?.floor ?? '0';
    if (BigInt(cursor) < BigInt(floor))
      throw new ApplicationError(
        409,
        'SYNC_CURSOR_EXPIRED',
        'Change history was retained only after this cursor. Download a new snapshot and retain pending edits.',
        { rebootstrap: true },
      );
    if (BigInt(cursor) > BigInt(i.feed_position))
      throw new ApplicationError(
        409,
        'SYNC_CURSOR_INVALID',
        'Cursor is ahead of the committed installation watermark.',
        { rebootstrap: true },
      );
    const groups = (
      await client.query(
        'SELECT position,count(*)::integer AS count,sum(octet_length(value::text)+512)::bigint AS bytes FROM change_feed WHERE owner_id=$1 AND position>$2 AND position<=$3 GROUP BY position ORDER BY position LIMIT $4',
        [actor.userId, cursor, i.feed_position, limit + 1],
      )
    ).rows;
    let count = 0,
      pageBytes = 0n,
      last = cursor;
    for (const g of groups) {
      if (
        count &&
        (count + g.count > limit || pageBytes + BigInt(g.bytes) > BigInt(MAX_TRANSACTION_BYTES))
      )
        break;
      if (g.count > MAX_TRANSACTION_RECORDS || BigInt(g.bytes) > BigInt(MAX_TRANSACTION_BYTES))
        throw new ApplicationError(
          413,
          'SYNC_TRANSACTION_TOO_LARGE',
          'A transaction exceeds the supported change page capacity. Download a fresh snapshot.',
          { rebootstrap: true },
        );
      count += g.count;
      pageBytes += BigInt(g.bytes);
      last = g.position;
      if (count >= limit) break;
    }
    // Empty operations consume positions too; advance through them when no later records remain.
    const hasMore = groups.some((g) => BigInt(g.position) > BigInt(last));
    if (!hasMore) last = i.feed_position;
    const rows = (
      await client.query(
        'SELECT * FROM change_feed WHERE owner_id=$1 AND position>$2 AND position<=$3 ORDER BY position,ordinal',
        [actor.userId, cursor, last],
      )
    ).rows;
    return SyncChangesPageSchema.parse({
      schemaVersion: 1,
      ownerId: actor.userId,
      installationId: i.id,
      epoch: i.epoch,
      watermark: i.feed_position,
      records: rows.map((r) => ({
        recordType: r.record_type,
        id: r.record_id,
        revision: r.revision,
        value: r.value,
        position: r.position,
        ordinal: r.ordinal,
        operationId: r.operation_id,
      })),
      cursor: last,
      hasMore,
    });
  });
}
// Tombstoned source rows remain: feed retention must never resurrect deleted records.
export async function retainSyncChanges(pool: Pool, actor: OwnerPrincipal, through: string) {
  return transaction(pool, async (client) => {
    const i = await installation(client, actor);
    if (BigInt(through) > BigInt(i.feed_position))
      throw new ApplicationError(
        409,
        'SYNC_CURSOR_INVALID',
        'Retention cannot pass the committed watermark.',
      );
    await client.query(
      'INSERT INTO sync_retention(owner_id,floor) VALUES($1,$2) ON CONFLICT(owner_id) DO UPDATE SET floor=greatest(sync_retention.floor,EXCLUDED.floor)',
      [actor.userId, through],
    );
    await client.query('DELETE FROM change_feed WHERE owner_id=$1 AND position<=$2', [
      actor.userId,
      through,
    ]);
    await client.query('DELETE FROM sync_snapshots WHERE expires_at<=now()');
  });
}
