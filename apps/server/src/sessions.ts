import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  SessionSchema,
  SessionCommandSchema,
  sessionEventTime,
  timerRemaining,
  measuredWorkingVolume,
  RoutineSchema,
  sessionItemsFromRoutine,
  type WorkoutSession,
  type SessionCommand,
  type SessionCommandResponse,
  type SessionExercise,
} from '@mems-life/domain';
import { requireOwner, type OwnerPrincipal } from './operations.js';
import { featureOperation, checkRevision, type ChangedRecord } from './feature-migrations.js';
import { ApplicationError } from './errors.js';
function fail(code: string, message: string): never {
  throw new ApplicationError(409, code, message);
}
function itemOf(session: WorkoutSession, id: string): SessionExercise {
  const item = session.items.find((x) => x.id === id);
  if (!item) throw new ApplicationError(404, 'NOT_FOUND', 'Session exercise not found.');
  return item;
}
async function newItem(
  client: PoolClient,
  owner: string,
  id: string,
  exerciseId: string,
  revision: number,
): Promise<SessionExercise> {
  const row = (
    await client.query('SELECT * FROM exercises WHERE id=$1 AND owner_id=$2', [exerciseId, owner])
  ).rows[0];
  if (!row) throw new ApplicationError(404, 'NOT_FOUND', 'Exercise not found.');
  checkRevision(row.revision, revision);
  if (row.archived_at) fail('EXERCISE_ARCHIVED', 'Choose an available exercise.');
  return {
    id,
    exerciseId,
    snapshot: {
      name: row.content.name,
      mode: row.content.mode,
      supportsLoad: row.content.supportsLoad,
    },
    targets: [],
    notes: '',
    status: 'planned',
    results: [],
    replacedItemId: null,
  };
}
export async function executeSessionCommand(
  pool: Pool,
  actor: OwnerPrincipal,
  input: SessionCommand,
  authorizeAgain: (client: PoolClient) => Promise<void>,
): Promise<SessionCommandResponse> {
  const command = SessionCommandSchema.parse(input);
  return featureOperation(pool, actor, command, authorizeAgain, async (client) => {
    const oldRow = (
      await client.query('SELECT * FROM workout_sessions WHERE id=$1 AND owner_id=$2', [
        command.sessionId,
        actor.userId,
      ])
    ).rows[0];
    if (
      !oldRow &&
      (await client.query('SELECT id FROM workout_sessions WHERE id=$1', [command.sessionId]))
        .rowCount
    )
      throw new ApplicationError(404, 'NOT_FOUND', 'Workout not found.');
    const old = oldRow ? SessionSchema.parse(oldRow.value) : null;
    checkRevision(
      old?.revision ?? (command.type === 'session.start' ? 0 : undefined),
      command.expectedRevision,
    );
    const now = new Date().toISOString();
    let eventTime: string;
    try {
      eventTime = sessionEventTime(command, old, now);
    } catch (error) {
      fail(
        'INVALID_EVENT_TIME',
        error instanceof Error ? error.message : 'Check the workout event time.',
      );
    }
    let session: WorkoutSession;
    const records: ChangedRecord[] = [];
    if (command.type === 'session.start') {
      if (
        command.itemIdentities?.some(
          (item) =>
            item.itemId === command.sessionId ||
            item.targets.some((target) => target.targetId === command.sessionId),
        )
      )
        fail(
          'INVALID_ROUTINE_IDENTITIES',
          'Session item and target identities must be unique from the session identity.',
        );
      if (
        (
          await client.query(
            "SELECT id FROM workout_sessions WHERE owner_id=$1 AND status='active'",
            [actor.userId],
          )
        ).rowCount
      )
        fail(
          'ACTIVE_SESSION_EXISTS',
          'Resume or explicitly abandon your active workout before starting another.',
        );
      let items: SessionExercise[] = [];
      let routineRevision: number | null = null;
      if (command.routineId) {
        const row = (
          await client.query('SELECT * FROM routines WHERE id=$1 AND owner_id=$2', [
            command.routineId,
            actor.userId,
          ])
        ).rows[0];
        if (!row) throw new ApplicationError(404, 'NOT_FOUND', 'Routine not found.');
        checkRevision(row.revision, command.expectedRoutineRevision ?? -1);
        if (row.archived_at) fail('ROUTINE_ARCHIVED', 'Unarchive the routine before starting it.');
        routineRevision = row.revision;
        try {
          items = sessionItemsFromRoutine(
            RoutineSchema.parse({
              ...row.content,
              id: row.id,
              revision: row.revision,
              createdAt: row.created_at.toISOString(),
              updatedAt: row.updated_at.toISOString(),
              archivedAt: null,
            }).items,
            command.itemIdentities,
            randomUUID,
          );
        } catch (error) {
          fail(
            'INVALID_ROUTINE_IDENTITIES',
            error instanceof Error ? error.message : 'Check the routine identities.',
          );
        }
      } else if (command.expectedRoutineRevision !== null)
        fail('INVALID_ROUTINE', 'An empty workout has no routine revision.');
      else if (command.itemIdentities?.length)
        fail('INVALID_ROUTINE_IDENTITIES', 'An empty workout has no routine items to identify.');
      session = {
        id: command.sessionId,
        revision: 1,
        name: command.name,
        notes: '',
        status: 'active',
        sourceRoutineId: command.routineId,
        sourceRoutineRevision: routineRevision,
        items,
        supersets: [],
        timer: null,
        startedAt: eventTime,
        updatedAt: now,
        finishedAt: null,
      };
    } else {
      if (!old) throw new ApplicationError(404, 'NOT_FOUND', 'Session not found.');
      session = structuredClone(old);
      session.revision++;
      session.updatedAt = now;
      const correction = [
        'session.correct-set',
        'session.remove-set',
        'session.set-notes',
        'session.update-routine',
      ].includes(command.type);
      if (session.status !== 'active' && !correction)
        fail('SESSION_FINISHED', 'Use an explicit correction to change a finished workout.');
      switch (command.type) {
        case 'session.add-exercise':
        case 'session.substitute-exercise': {
          if (session.items.some((x) => x.id === command.itemId))
            fail('DUPLICATE_ITEM', 'This exercise item identity is already used.');
          const added = await newItem(
            client,
            actor.userId,
            command.itemId,
            command.exerciseId,
            command.expectedExerciseRevision,
          );
          if (command.type === 'session.substitute-exercise') {
            const replaced = itemOf(session, command.replacedItemId);
            if (['removed', 'skipped'].includes(replaced.status))
              fail('INVALID_TRANSITION', 'This exercise is no longer available.');
            replaced.status = 'removed';
            added.replacedItemId = replaced.id;
            session.items.splice(session.items.indexOf(replaced) + 1, 0, added);
            session.supersets = session.supersets.map((g) => ({
              ...g,
              itemIds: g.itemIds.map((id) => (id === replaced.id ? added.id : id)),
            }));
          } else session.items.push(added);
          break;
        }
        case 'session.reorder-exercises': {
          if (
            command.itemIds.length !== session.items.length ||
            new Set(command.itemIds).size !== session.items.length
          )
            fail('INVALID_ORDER', 'Provide each session exercise exactly once.');
          session.items = command.itemIds.map((id) => itemOf(session, id));
          break;
        }
        case 'session.skip-exercise':
        case 'session.remove-exercise': {
          const item = itemOf(session, command.itemId);
          item.status = command.type === 'session.skip-exercise' ? 'skipped' : 'removed';
          session.supersets = session.supersets
            .map((g) => ({ ...g, itemIds: g.itemIds.filter((id) => id !== item.id) }))
            .filter((g) => g.itemIds.length >= 2);
          break;
        }
        case 'session.record-set':
        case 'session.correct-set': {
          const item = itemOf(session, command.itemId);
          const existing = item.results.find((x) => x.id === command.setId);
          if (command.type === 'session.record-set') {
            if (['removed', 'skipped'].includes(item.status))
              fail('INVALID_TRANSITION', 'Choose an available exercise to record a set.');
            if (session.items.some((i) => i.results.some((x) => x.id === command.setId)))
              fail('DUPLICATE_SET', 'This set identity is already used.');
            item.results.push({
              id: command.setId,
              kind: command.kind,
              measurements: command.measurements,
              notes: command.notes,
              round: command.round,
              recordedAt: eventTime,
              correctedAt: null,
              removedAt: null,
            });
            item.status = 'in-progress';
          } else {
            if (!existing || existing.removedAt)
              fail('SET_NOT_FOUND', 'Choose an existing result to correct.');
            Object.assign(existing, {
              kind: command.kind,
              measurements: command.measurements,
              notes: command.notes,
              round: command.round,
              correctedAt: eventTime,
            });
          }
          break;
        }
        case 'session.remove-set': {
          const result = itemOf(session, command.itemId).results.find(
            (x) => x.id === command.setId,
          );
          if (!result || result.removedAt)
            fail('SET_NOT_FOUND', 'Choose an existing result to remove.');
          result.removedAt = eventTime;
          result.correctedAt = eventTime;
          break;
        }
        case 'session.set-notes':
          if (command.itemId) itemOf(session, command.itemId).notes = command.notes;
          else session.notes = command.notes;
          break;
        case 'session.set-supersets':
          session.supersets = command.supersets;
          break;
        case 'session.timer': {
          if (command.itemId) itemOf(session, command.itemId);
          if (command.action === 'cancel') {
            session.timer = null;
            break;
          }
          const prior = session.timer;
          if (command.action === 'pause' || command.action === 'resume') {
            if (!prior || prior.id !== command.timerId)
              fail('TIMER_NOT_FOUND', 'Reload the active timer.');
            if (
              (command.action === 'pause' && prior.state !== 'running') ||
              (command.action === 'resume' && prior.state !== 'paused')
            )
              fail('INVALID_TRANSITION', 'Timer state changed.');
            const remaining = timerRemaining(prior, now);
            session.timer = {
              ...prior,
              state: command.action === 'pause' ? 'paused' : 'running',
              remainingSeconds: remaining,
              deadline:
                command.action === 'pause'
                  ? null
                  : new Date(Date.parse(now) + remaining * 1000).toISOString(),
              updatedAt: now,
            };
          } else
            session.timer = {
              id: command.timerId,
              kind: command.kind,
              state: 'running',
              durationSeconds: command.durationSeconds,
              remainingSeconds: command.durationSeconds,
              deadline: new Date(Date.parse(now) + command.durationSeconds * 1000).toISOString(),
              updatedAt: now,
              clockBasis: 'server',
              initiatingDeviceId: command.deviceId,
              itemId: command.itemId,
            };
          break;
        }
        case 'session.finish':
        case 'session.abandon':
          session.status = command.type === 'session.finish' ? 'completed' : 'abandoned';
          session.finishedAt = eventTime;
          session.timer = null;
          break;
        case 'session.update-routine': {
          const row = (
            await client.query('SELECT * FROM routines WHERE id=$1 AND owner_id=$2', [
              command.routineId,
              actor.userId,
            ])
          ).rows[0];
          if (!row) throw new ApplicationError(404, 'NOT_FOUND', 'Routine not found.');
          checkRevision(row.revision, command.expectedRoutineRevision);
          if (row.archived_at)
            fail('ROUTINE_ARCHIVED', 'Unarchive the routine before updating it.');
          for (const item of command.content.items) {
            const exercise = (
              await client.query('SELECT * FROM exercises WHERE id=$1 AND owner_id=$2', [
                item.exerciseId,
                actor.userId,
              ])
            ).rows[0];
            if (!exercise) fail('INVALID_EXERCISE', 'Routine contains an unavailable exercise.');
            const prior = row.content.items.find(
              (i: SessionExercise) => i.id === item.id && i.exerciseId === item.exerciseId,
            );
            if (
              JSON.stringify(prior?.snapshot) !== JSON.stringify(item.snapshot) &&
              (exercise.archived_at ||
                JSON.stringify({
                  name: exercise.content.name,
                  mode: exercise.content.mode,
                  supportsLoad: exercise.content.supportsLoad,
                }) !== JSON.stringify(item.snapshot))
            )
              fail('EXERCISE_CHANGED', 'Reload the exercise before updating the routine.');
          }
          const routine = RoutineSchema.parse({
            ...command.content,
            id: command.routineId,
            revision: row.revision + 1,
            createdAt: new Date(row.created_at).toISOString(),
            updatedAt: now,
            archivedAt: null,
          });
          await client.query(
            'UPDATE routines SET revision=$2,content=$3,updated_at=$4 WHERE id=$1',
            [routine.id, routine.revision, command.content, now],
          );
          await client.query('DELETE FROM routine_exercises WHERE routine_id=$1', [routine.id]);
          for (const [ordinal, item] of routine.items.entries())
            await client.query(
              'INSERT INTO routine_exercises(routine_id,item_id,exercise_id,ordinal,owner_id) VALUES($1,$2,$3,$4,$5)',
              [routine.id, item.id, item.exerciseId, ordinal, actor.userId],
            );
          records.push({
            recordType: 'routine',
            id: routine.id,
            revision: routine.revision,
            value: routine,
            eventType: 'routine.updated-from-session',
          });
          break;
        }
      }
    }
    session = SessionSchema.parse(session);
    await client.query(
      'INSERT INTO workout_sessions(id,owner_id,revision,status,value,started_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,status=excluded.status,value=excluded.value,updated_at=excluded.updated_at',
      [session.id, actor.userId, session.revision, session.status, session, session.startedAt, now],
    );
    await client.query(
      'INSERT INTO workout_session_history(session_id,owner_id,actor_id,actor_type,reason,operation_id,event_type,revision,value,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [
        session.id,
        actor.userId,
        actor.actorId ?? actor.userId,
        actor.actorType ?? 'owner',
        'reason' in command ? command.reason : null,
        command.operationId,
        command.type,
        session.revision,
        session,
        now,
      ],
    );
    records.push({
      recordType: 'session',
      id: session.id,
      revision: session.revision,
      value: session,
      eventType: command.type,
    });
    return { result: { session }, records };
  });
}
export async function readSession(pool: Pool, actor: OwnerPrincipal, id: string) {
  await requireOwner(pool, actor.userId);
  const row = (
    await pool.query('SELECT value FROM workout_sessions WHERE id=$1 AND owner_id=$2', [
      id,
      actor.userId,
    ])
  ).rows[0];
  if (!row) throw new ApplicationError(404, 'NOT_FOUND', 'Workout not found.');
  return { session: SessionSchema.parse(row.value) };
}
export async function listSessions(
  pool: Pool,
  actor: OwnerPrincipal,
  status?: WorkoutSession['status'],
  cursor?: string,
  limit = 50,
) {
  await requireOwner(pool, actor.userId);
  const rows = await pool.query(
    'SELECT value FROM workout_sessions WHERE owner_id=$1 AND ($2::text IS NULL OR status=$2) AND ($3::uuid IS NULL OR (started_at,id)<(SELECT started_at,id FROM workout_sessions WHERE id=$3 AND owner_id=$1)) ORDER BY started_at DESC,id DESC LIMIT $4',
    [actor.userId, status ?? null, cursor ?? null, Math.min(100, Math.max(1, limit)) + 1],
  );
  const sessions = rows.rows.slice(0, limit).map((row) => SessionSchema.parse(row.value));
  return { sessions, nextCursor: rows.rows.length > limit ? sessions.at(-1)!.id : null };
}
export async function sessionHistory(
  pool: Pool,
  actor: OwnerPrincipal,
  id: string,
  cursor?: string,
  limit = 50,
) {
  await readSession(pool, actor, id);
  const rows = await pool.query(
    'SELECT * FROM workout_session_history WHERE session_id=$1 AND owner_id=$2 AND ($3::bigint IS NULL OR id<$3) ORDER BY id DESC LIMIT $4',
    [id, actor.userId, cursor ?? null, limit + 1],
  );
  const events = rows.rows.slice(0, limit).map((row) => ({
    id: String(row.id),
    operationId: row.operation_id,
    actorId: row.actor_id,
    actorType: row.actor_type,
    reason: row.reason,
    eventType: row.event_type,
    revision: row.revision,
    session: SessionSchema.parse(row.value),
    createdAt: new Date(row.created_at).toISOString(),
  }));
  return { events, nextCursor: rows.rows.length > limit ? events.at(-1)!.id : null };
}
export async function exercisePerformance(
  pool: Pool,
  actor: OwnerPrincipal,
  exerciseId: string,
  cursor?: string,
  limit = 50,
  mode?: 'weighted' | 'bodyweight' | 'timed' | 'distance',
  excludeSessionId?: string,
) {
  await requireOwner(pool, actor.userId);
  const rows = await pool.query(
    "SELECT value FROM workout_sessions WHERE owner_id=$1 AND value->'items' @> $2::jsonb AND ($3::uuid IS NULL OR (started_at,id)<(SELECT started_at,id FROM workout_sessions WHERE id=$3 AND owner_id=$1)) AND ($5::uuid IS NULL OR id<>$5) ORDER BY started_at DESC,id DESC LIMIT $4",
    [
      actor.userId,
      JSON.stringify([{ exerciseId, ...(mode ? { snapshot: { mode } } : {}) }]),
      cursor ?? null,
      limit + 1,
      excludeSessionId ?? null,
    ],
  );
  const sessions = rows.rows.slice(0, limit).map((row) => SessionSchema.parse(row.value));
  return {
    performances: sessions.map((session) => ({
      sessionId: session.id,
      status: session.status,
      startedAt: session.startedAt,
      items: session.items.filter(
        (item) => item.exerciseId === exerciseId && (!mode || item.snapshot.mode === mode),
      ),
      measuredWorkingVolumeKgReps: measuredWorkingVolume({
        ...session,
        items: session.items.filter(
          (item) => item.exerciseId === exerciseId && (!mode || item.snapshot.mode === mode),
        ),
      }),
    })),
    nextCursor: rows.rows.length > limit ? sessions.at(-1)!.id : null,
  };
}
