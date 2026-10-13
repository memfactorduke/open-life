import type { Pool, PoolClient } from 'pg';
import {
  FoodEntrySchema,
  FoodCommandSchema,
  type FoodEntry,
  type FoodCommand,
} from '@mems-life/domain';
import { requireOwner, type OwnerPrincipal } from './operations.js';
import { checkRevision, featureOperation } from './feature-migrations.js';
import { ApplicationError } from './errors.js';
export async function foodRecord(
  client: Pool | PoolClient,
  actor: OwnerPrincipal,
  id: string,
): Promise<FoodEntry> {
  const row = (
    await client.query('SELECT value FROM food_entries WHERE id=$1 AND owner_id=$2', [
      id,
      actor.userId,
    ])
  ).rows[0];
  if (!row) throw new ApplicationError(404, 'NOT_FOUND', 'Food entry not found.');
  return FoodEntrySchema.parse(row.value);
}
export async function listFood(pool: Pool, actor: OwnerPrincipal, date?: string, timezone = 'UTC') {
  await requireOwner(pool, actor.userId);
  const rows = await pool.query(
    'SELECT value FROM food_entries WHERE owner_id=$1 AND deleted_at IS NULL AND ($2::text IS NULL OR (occurred_at AT TIME ZONE $3)::date=$2::date) ORDER BY occurred_at DESC,id',
    [actor.userId, date ?? null, timezone],
  );
  return { entries: rows.rows.map((row) => FoodEntrySchema.parse(row.value)) };
}
export async function foodHistory(pool: Pool, actor: OwnerPrincipal, id: string) {
  await requireOwner(pool, actor.userId);
  await foodRecord(pool, actor, id);
  const rows = await pool.query(
    'SELECT * FROM food_history WHERE entry_id=$1 ORDER BY revision DESC LIMIT 100',
    [id],
  );
  return {
    events: rows.rows.map((row) => ({
      operationId: row.operation_id,
      type: row.event_type,
      actorId: row.actor_id,
      actorType: row.actor_type,
      entry: FoodEntrySchema.parse(row.value),
      createdAt: row.created_at.toISOString(),
    })),
  };
}
export async function saveFood(
  client: PoolClient,
  actor: OwnerPrincipal,
  entry: FoodEntry,
  operationId: string,
  eventType: string,
) {
  await client.query(
    'INSERT INTO food_entries(id,owner_id,revision,value,occurred_at,deleted_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,value=excluded.value,occurred_at=excluded.occurred_at,deleted_at=excluded.deleted_at',
    [entry.id, actor.userId, entry.revision, entry, entry.content.occurredAt, entry.deletedAt],
  );
  await client.query(
    'INSERT INTO food_history(entry_id,revision,operation_id,event_type,value,actor_id,actor_type) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [
      entry.id,
      entry.revision,
      operationId,
      eventType,
      entry,
      actor.actorId ?? actor.userId,
      actor.actorType ?? 'owner',
    ],
  );
  return {
    result: { entry },
    records: [
      {
        recordType: 'food' as const,
        id: entry.id,
        revision: entry.revision,
        value: entry,
        eventType,
      },
    ],
  };
}
export function assertFoodRevision(entry: FoodEntry, revision: number) {
  checkRevision(entry.revision, revision);
  if (entry.deletedAt)
    throw new ApplicationError(
      409,
      'DELETED',
      'This food entry was deleted. Save as a new entry instead.',
    );
}
export async function executeFoodCommand(
  pool: Pool,
  actor: OwnerPrincipal,
  input: FoodCommand,
  authorizeAgain: (client: PoolClient) => Promise<void>,
) {
  const command = FoodCommandSchema.parse(input);
  return featureOperation(pool, actor, command, authorizeAgain, async (client) => {
    const now = new Date().toISOString();
    let entry: FoodEntry;
    if (command.type === 'food.create') {
      if (
        (await client.query('SELECT id FROM food_entries WHERE id=$1', [command.entryId])).rowCount
      )
        throw new ApplicationError(409, 'RECORD_EXISTS', 'This entry ID already exists.');
      entry = {
        id: command.entryId,
        revision: 1,
        content: command.content,
        photoIds: [],
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
    } else {
      entry = await foodRecord(client, actor, command.entryId);
      assertFoodRevision(entry, command.expectedRevision);
      entry = { ...entry, revision: entry.revision + 1, updatedAt: now };
      if (command.type === 'food.edit') entry.content = command.content;
      if (command.type === 'food.delete') {
        entry.deletedAt = now;
        await client.query('UPDATE food_media SET detached_at=$2 WHERE entry_id=$1', [
          entry.id,
          now,
        ]);
      }
      if (command.type === 'food.detach') {
        if (!entry.photoIds.includes(command.photoId))
          throw new ApplicationError(404, 'NOT_FOUND', 'Photo not attached to this entry.');
        entry.photoIds = entry.photoIds.filter((id) => id !== command.photoId);
        await client.query('UPDATE food_media SET detached_at=$2 WHERE id=$1', [
          command.photoId,
          now,
        ]);
      }
    }
    return saveFood(client, actor, FoodEntrySchema.parse(entry), command.operationId, command.type);
  });
}
