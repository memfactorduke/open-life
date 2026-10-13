import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  ExerciseSchema,
  ExerciseCommandSchema,
  RoutineSchema,
  RoutineCommandSchema,
  type Exercise,
  type ExerciseCommand,
  type ExerciseCommandResponse,
  type Routine,
  type RoutineCommand,
  type RoutineCommandResponse,
  type RoutineContent,
} from '@mems-life/domain';
import { requireOwner, type OwnerPrincipal } from './operations.js';
import { featureOperation, checkRevision } from './feature-migrations.js';
import { ApplicationError } from './errors.js';

function dates(row: Record<string, unknown>) {
  const instant = (value: unknown) => (value instanceof Date ? value.toISOString() : value);
  return {
    id: row.id,
    revision: row.revision,
    createdAt: instant(row.created_at),
    updatedAt: instant(row.updated_at),
    archivedAt: instant(row.archived_at),
  };
}
function exerciseFromRow(row: Record<string, unknown>): Exercise {
  return ExerciseSchema.parse({ ...(row.content as object), ...dates(row), origin: row.origin });
}
function routineFromRow(row: Record<string, unknown>): Routine {
  return RoutineSchema.parse({ ...(row.content as object), ...dates(row) });
}
export async function listExercises(pool: Pool, actor: OwnerPrincipal, archived = false) {
  await requireOwner(pool, actor.userId);
  const rows = await pool.query(
    "SELECT * FROM exercises WHERE owner_id=$1 AND (archived_at IS NOT NULL)=$2 ORDER BY content->>'name',id",
    [actor.userId, archived],
  );
  return { exercises: rows.rows.map(exerciseFromRow) };
}
export async function listRoutines(pool: Pool, actor: OwnerPrincipal, archived = false) {
  await requireOwner(pool, actor.userId);
  const rows = await pool.query(
    "SELECT * FROM routines WHERE owner_id=$1 AND (archived_at IS NOT NULL)=$2 ORDER BY content->>'name',id",
    [actor.userId, archived],
  );
  return { routines: rows.rows.map(routineFromRow) };
}
export async function readRoutine(pool: Pool, actor: OwnerPrincipal, id: string) {
  await requireOwner(pool, actor.userId);
  const rows = await pool.query('SELECT * FROM routines WHERE owner_id=$1 AND id=$2', [
    actor.userId,
    id,
  ]);
  if (!rows.rows[0]) throw new ApplicationError(404, 'NOT_FOUND', 'Routine not found.');
  return { routine: routineFromRow(rows.rows[0]) };
}
function assertArchiveTransition(archivedAt: string | null, type: string) {
  if (type.endsWith('.archive') && archivedAt)
    throw new ApplicationError(409, 'INVALID_TRANSITION', 'This record is already archived.');
  if (type.endsWith('.unarchive') && !archivedAt)
    throw new ApplicationError(409, 'INVALID_TRANSITION', 'This record is not archived.');
  if (type.endsWith('.edit') && archivedAt)
    throw new ApplicationError(
      409,
      'INVALID_TRANSITION',
      'Unarchive this record before editing it.',
    );
}
export async function executeExerciseCommand(
  pool: Pool,
  actor: OwnerPrincipal,
  input: ExerciseCommand,
  authorizeAgain: (client: PoolClient) => Promise<void>,
): Promise<ExerciseCommandResponse> {
  const command = ExerciseCommandSchema.parse(input);
  return featureOperation(pool, actor, command, authorizeAgain, async (client) => {
    const rows = await client.query('SELECT * FROM exercises WHERE id=$1', [command.exerciseId]);
    if (rows.rows[0] && rows.rows[0].owner_id !== actor.userId)
      throw new ApplicationError(404, 'NOT_FOUND', 'Exercise not found.');
    const old = rows.rows[0] ? exerciseFromRow(rows.rows[0]) : null;
    checkRevision(
      old?.revision ?? (command.type === 'exercise.create' ? 0 : undefined),
      command.expectedRevision,
    );
    if (!old && command.type !== 'exercise.create')
      throw new ApplicationError(404, 'NOT_FOUND', 'Exercise not found.');
    if (old) assertArchiveTransition(old.archivedAt, command.type);
    const now = new Date().toISOString();
    const exercise = ExerciseSchema.parse({
      ...(old ?? {}),
      ...('content' in command ? command.content : {}),
      id: command.exerciseId,
      revision: (old?.revision ?? 0) + 1,
      origin: old?.origin ?? 'custom',
      createdAt: old?.createdAt ?? now,
      updatedAt: now,
      archivedAt:
        command.type === 'exercise.archive'
          ? now
          : command.type === 'exercise.unarchive'
            ? null
            : (old?.archivedAt ?? null),
    });
    const { id, revision, origin, createdAt, updatedAt, archivedAt, ...content } = exercise;
    await client.query(
      'INSERT INTO exercises(id,owner_id,revision,origin,content,created_at,updated_at,archived_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,content=excluded.content,updated_at=excluded.updated_at,archived_at=excluded.archived_at',
      [id, actor.userId, revision, origin, content, createdAt, updatedAt, archivedAt],
    );
    return {
      result: { exercise },
      records: [
        { recordType: 'exercise' as const, id, revision, value: exercise, eventType: command.type },
      ],
    };
  });
}
async function validateReferences(
  client: PoolClient,
  ownerId: string,
  content: RoutineContent,
  previous: Routine | null,
) {
  for (const item of content.items) {
    const rows = await client.query('SELECT * FROM exercises WHERE id=$1 AND owner_id=$2', [
      item.exerciseId,
      ownerId,
    ]);
    if (!rows.rows[0])
      throw new ApplicationError(
        400,
        'INVALID_EXERCISE',
        'A routine exercise does not exist in this installation.',
      );
    const exercise = exerciseFromRow(rows.rows[0]);
    const prior = previous?.items.find(
      (candidate) => candidate.id === item.id && candidate.exerciseId === item.exerciseId,
    );
    const snapshotMatches = (snapshot: typeof item.snapshot) =>
      snapshot.name === item.snapshot.name &&
      snapshot.mode === item.snapshot.mode &&
      snapshot.supportsLoad === item.snapshot.supportsLoad;
    const preserved = prior && snapshotMatches(prior.snapshot);
    if (!preserved && (exercise.archivedAt || !snapshotMatches(exercise)))
      throw new ApplicationError(
        409,
        'EXERCISE_CHANGED',
        'An exercise changed or was archived. Reload the exercise before adding it.',
      );
  }
}
export async function executeRoutineCommand(
  pool: Pool,
  actor: OwnerPrincipal,
  input: RoutineCommand,
  authorizeAgain: (client: PoolClient) => Promise<void>,
): Promise<RoutineCommandResponse> {
  const command = RoutineCommandSchema.parse(input);
  return featureOperation(pool, actor, command, authorizeAgain, async (client) => {
    const rows = await client.query('SELECT * FROM routines WHERE id=$1', [command.routineId]);
    if (rows.rows[0] && rows.rows[0].owner_id !== actor.userId)
      throw new ApplicationError(404, 'NOT_FOUND', 'Routine not found.');
    const old = rows.rows[0] ? routineFromRow(rows.rows[0]) : null;
    checkRevision(
      old?.revision ?? (command.type === 'routine.create' ? 0 : undefined),
      command.expectedRevision,
    );
    if (!old && command.type !== 'routine.create')
      throw new ApplicationError(404, 'NOT_FOUND', 'Routine not found.');
    if (old) assertArchiveTransition(old.archivedAt, command.type);
    const duplicate = command.type === 'routine.duplicate';
    const id = duplicate ? command.newId : command.routineId;
    if (duplicate && (await client.query('SELECT id FROM routines WHERE id=$1', [id])).rowCount)
      throw new ApplicationError(409, 'RECORD_EXISTS', 'This routine ID is already used.');
    const now = new Date().toISOString();
    let content: RoutineContent;
    if ('content' in command) {
      content = command.content;
      await validateReferences(client, actor.userId, content, old);
    } else {
      content = { name: old!.name, notes: old!.notes, items: old!.items };
    }
    if (duplicate)
      content = {
        ...content,
        name: `${content.name.slice(0, 493)} (copy)`,
        items: content.items.map((item) => ({
          ...item,
          id: randomUUID(),
          targets: item.targets.map((target) => ({ ...target, id: randomUUID() })),
        })),
      };
    const routine = RoutineSchema.parse({
      ...content,
      id,
      revision: duplicate ? 1 : (old?.revision ?? 0) + 1,
      createdAt: duplicate ? now : (old?.createdAt ?? now),
      updatedAt: now,
      archivedAt: duplicate
        ? null
        : command.type === 'routine.archive'
          ? now
          : command.type === 'routine.unarchive'
            ? null
            : (old?.archivedAt ?? null),
    });
    await client.query(
      'INSERT INTO routines(id,owner_id,revision,content,created_at,updated_at,archived_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,content=excluded.content,updated_at=excluded.updated_at,archived_at=excluded.archived_at',
      [id, actor.userId, routine.revision, content, routine.createdAt, now, routine.archivedAt],
    );
    await client.query('DELETE FROM routine_exercises WHERE routine_id=$1', [id]);
    for (const [ordinal, item] of routine.items.entries())
      await client.query(
        'INSERT INTO routine_exercises(routine_id,item_id,exercise_id,ordinal,owner_id) VALUES($1,$2,$3,$4,$5)',
        [id, item.id, item.exerciseId, ordinal, actor.userId],
      );
    return {
      result: { routine },
      records: [
        {
          recordType: 'routine' as const,
          id,
          revision: routine.revision,
          value: routine,
          eventType: command.type,
        },
      ],
    };
  });
}
