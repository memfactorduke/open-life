import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { transaction } from './database.js';
import { requireOwner, type OwnerPrincipal } from './operations.js';
import { ApplicationError } from './errors.js';

export async function migrateFeatures(pool: Pool): Promise<void> {
  await transaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(7311021)');
    const applied = await client.query(
      'SELECT version FROM application_migrations WHERE version=2',
    );
    if (!applied.rowCount) {
      await client.query(`
      CREATE TABLE tasks (
        id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES "user"(id),
        revision integer NOT NULL CHECK(revision > 0),
        phase text NOT NULL CHECK(phase IN ('planned','next','active','completed')),
        content jsonb NOT NULL, sort_order integer NOT NULL CHECK(sort_order >= 0),
        created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
        completed_at timestamptz, archived_at timestamptz, deleted_at timestamptz
      );
      CREATE INDEX tasks_owner_order ON tasks(owner_id,phase,sort_order,id);
      CREATE TABLE task_history (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, task_id uuid NOT NULL REFERENCES tasks(id),
        owner_id text NOT NULL REFERENCES "user"(id), actor_id text NOT NULL REFERENCES "user"(id),
        operation_id uuid NOT NULL, event_type text NOT NULL, revision integer NOT NULL,
        task jsonb NOT NULL, created_at timestamptz NOT NULL,
        UNIQUE(task_id,revision)
      );
      CREATE TABLE exercises (
        id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES "user"(id),
        revision integer NOT NULL CHECK(revision > 0),
        origin text NOT NULL CHECK(origin IN ('builtin','custom')),
        content jsonb NOT NULL, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
        archived_at timestamptz
      );
      CREATE TABLE routines (
        id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES "user"(id),
        revision integer NOT NULL CHECK(revision > 0), content jsonb NOT NULL,
        created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, archived_at timestamptz
      );
      CREATE TABLE routine_exercises (
        routine_id uuid NOT NULL REFERENCES routines(id), item_id uuid NOT NULL,
        exercise_id uuid NOT NULL REFERENCES exercises(id), ordinal integer NOT NULL CHECK(ordinal >= 0),
        PRIMARY KEY(routine_id,item_id), UNIQUE(routine_id,ordinal)
      );
      INSERT INTO application_migrations(version) VALUES(2);
    `);
    }
    const constrained = await client.query(
      'SELECT version FROM application_migrations WHERE version=3',
    );
    if (!constrained.rowCount)
      await client.query(`
      ALTER TABLE tasks ADD CONSTRAINT task_completion_matches_phase CHECK ((phase='completed')=(completed_at IS NOT NULL));
      ALTER TABLE exercises ADD CONSTRAINT exercises_owner_identity UNIQUE(owner_id,id);
      ALTER TABLE routines ADD CONSTRAINT routines_owner_identity UNIQUE(owner_id,id);
      ALTER TABLE routine_exercises ADD COLUMN owner_id text;
      UPDATE routine_exercises re SET owner_id=r.owner_id FROM routines r WHERE r.id=re.routine_id;
      ALTER TABLE routine_exercises ALTER COLUMN owner_id SET NOT NULL;
      ALTER TABLE routine_exercises ADD CONSTRAINT routine_reference_owner FOREIGN KEY(owner_id,routine_id) REFERENCES routines(owner_id,id);
      ALTER TABLE routine_exercises ADD CONSTRAINT exercise_reference_owner FOREIGN KEY(owner_id,exercise_id) REFERENCES exercises(owner_id,id);
      INSERT INTO application_migrations(version) VALUES(3);
    `);
    const owners = await client.query<{ owner_id: string }>('SELECT owner_id FROM installation');
    for (const owner of owners.rows) await seedOwnerProducts(client, owner.owner_id);
  });
}

export type ChangedRecord = {
  recordType:
    | 'task'
    | 'exercise'
    | 'routine'
    | 'session'
    | 'food'
    | 'provider'
    | 'connection'
    | 'board'
    | 'project'
    | 'series'
    | 'step'
    | 'skill'
    | 'binding'
    | 'attempt'
    | 'result';
  id: string;
  revision: number;
  value: unknown;
  eventType: string;
};
export async function featureOperation<T>(
  pool: Pool,
  actor: OwnerPrincipal,
  command: { type: string; operationId: string },
  authorizeAgain: (client: PoolClient) => Promise<void>,
  work: (client: PoolClient) => Promise<{ result: T; records: ChangedRecord[] }>,
): Promise<T & { operationId: string; feedPosition: string }> {
  return transaction(pool, async (client) => {
    const actorId = actor.actorId ?? actor.userId;
    const actorType = actor.actorType ?? 'owner';
    await client.query('SELECT id FROM installation WHERE owner_id=$1 FOR UPDATE', [actor.userId]);
    await requireOwner(client, actor.userId);
    await authorizeAgain(client);
    await requireOwner(client, actor.userId, actor.expectedEpoch);
    const receipt = await client.query<{
      response: T & { operationId: string; feedPosition: string };
      matches: boolean;
    }>(
      'SELECT response,request=$3::jsonb AS matches FROM operation_receipts WHERE actor_id=$1 AND operation_id=$2',
      [actorId, command.operationId, JSON.stringify(command)],
    );
    if (receipt.rows[0]) {
      if (!receipt.rows[0].matches)
        throw new ApplicationError(
          409,
          'OPERATION_ID_REUSED',
          'This operation ID was already used for different content.',
        );
      return receipt.rows[0].response;
    }
    const { result, records } = await work(client);
    const feed = await client.query<{ feed_position: string }>(
      'UPDATE installation SET feed_position=feed_position+1 WHERE owner_id=$1 RETURNING feed_position',
      [actor.userId],
    );
    const feedPosition = feed.rows[0]!.feed_position;
    const response = { ...result, operationId: command.operationId, feedPosition };
    for (const [ordinal, record] of records.entries()) {
      await client.query(
        'INSERT INTO audit_events(actor_id,actor_type,operation_id,event_type,record_id,revision,value) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          actorId,
          actorType,
          command.operationId,
          record.eventType,
          record.id,
          record.revision,
          record.value,
        ],
      );
      await client.query(
        'INSERT INTO change_feed(owner_id,position,ordinal,operation_id,record_type,record_id,revision,value) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          actor.userId,
          feedPosition,
          ordinal,
          command.operationId,
          record.recordType,
          record.id,
          record.revision,
          record.value,
        ],
      );
    }
    await client.query(
      'INSERT INTO operation_receipts(actor_id,operation_id,request,response) VALUES($1,$2,$3,$4)',
      [actorId, command.operationId, command, response],
    );
    return response;
  });
}
export function checkRevision(current: number | undefined, expected: number): void {
  if (current !== expected)
    throw new ApplicationError(
      409,
      'REVISION_CONFLICT',
      'This record changed. Reload before saving.',
      { currentRevision: current ?? null },
    );
}

export async function seedOwnerProducts(client: PoolClient, ownerId: string): Promise<void> {
  const existing = await client.query(
    "SELECT id FROM exercises WHERE owner_id=$1 AND origin='builtin' LIMIT 1",
    [ownerId],
  );
  if (existing.rowCount) return;
  const catalog = [
    { name: 'Barbell squat', mode: 'weighted', supportsLoad: true, notes: '' },
    { name: 'Bench press', mode: 'weighted', supportsLoad: true, notes: '' },
    { name: 'Deadlift', mode: 'weighted', supportsLoad: true, notes: '' },
    { name: 'Pull-up', mode: 'bodyweight', supportsLoad: true, notes: '' },
    { name: 'Push-up', mode: 'bodyweight', supportsLoad: false, notes: '' },
    { name: 'Plank', mode: 'timed', supportsLoad: false, notes: '' },
    { name: 'Running', mode: 'distance', supportsLoad: false, notes: '' },
    { name: 'Cycling', mode: 'distance', supportsLoad: false, notes: '' },
  ];
  for (const content of catalog)
    await client.query(
      "INSERT INTO exercises(id,owner_id,revision,origin,content,created_at,updated_at) VALUES($1,$2,1,'builtin',$3,now(),now())",
      [randomUUID(), ownerId, content],
    );
}
