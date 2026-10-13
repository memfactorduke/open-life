import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  RecurrenceSeriesSchema,
  RecurrenceCommandSchema,
  nextOccurrence,
  TaskSchema,
  type Task,
  type RecurrenceCommand,
  type RecurrenceRule,
} from '@mems-life/domain';
import { featureOperation, checkRevision } from './feature-migrations.js';
import { requireOwner, type OwnerPrincipal } from './operations.js';
import { ApplicationError } from './errors.js';
import { saveTask, taskFromRow } from './tasks.js';
async function availableOccurrence(
  client: PoolClient,
  ownerId: string,
  seriesId: string,
  rule: RecurrenceRule,
  boundary: string,
  excludeId?: string,
) {
  for (let attempt = 0; attempt < 3700; attempt++) {
    const occurrence = nextOccurrence(rule, boundary);
    const exists = await client.query(
      "SELECT id FROM tasks WHERE owner_id=$1 AND series_id=$2 AND schedule->>'occurrenceKey'=$3 AND ($4::uuid IS NULL OR id<>$4::uuid)",
      [ownerId, seriesId, occurrence.key, excludeId ?? null],
    );
    if (!exists.rowCount) return occurrence;
    boundary = occurrence.at;
  }
  throw new ApplicationError(
    409,
    'RECURRENCE_EXHAUSTED',
    'No unused future occurrence could be generated.',
  );
}
export async function generateNextOccurrence(
  client: PoolClient,
  ownerId: string,
  seriesId: string,
  after: string,
  operationId: string,
  actor?: OwnerPrincipal,
): Promise<Task | null> {
  const row = (
    await client.query('SELECT value FROM recurrence_series WHERE owner_id=$1 AND id=$2', [
      ownerId,
      seriesId,
    ])
  ).rows[0];
  if (!row) return null;
  const series = RecurrenceSeriesSchema.parse(row.value);
  if (series.cancelledAt) return null;
  if (
    (
      await client.query(
        "SELECT id FROM tasks WHERE owner_id=$1 AND series_id=$2 AND phase<>'completed' AND schedule->>'skippedAt' IS NULL AND deleted_at IS NULL",
        [ownerId, seriesId],
      )
    ).rowCount
  )
    return null;
  const latest = (
    await client.query(
      "SELECT max((schedule->>'scheduledAt')::timestamptz) AS at FROM tasks WHERE owner_id=$1 AND series_id=$2",
      [ownerId, seriesId],
    )
  ).rows[0]?.at;
  const boundary = latest && latest.getTime() > Date.parse(after) ? latest.toISOString() : after;
  const occurrence = await availableOccurrence(client, ownerId, seriesId, series.rule, boundary);
  const task = TaskSchema.parse({
    id: randomUUID(),
    revision: 1,
    phase: 'planned',
    content: series.content,
    order: 0,
    createdAt: after,
    updatedAt: after,
    completedAt: null,
    archivedAt: null,
    deletedAt: null,
    schedule: {
      dueAt: occurrence.at,
      scheduledAt: occurrence.at,
      seriesId,
      occurrenceKey: occurrence.key,
      skippedAt: null,
    },
  });
  await saveTask(client, ownerId, task);
  await client.query(
    'INSERT INTO task_history(task_id,owner_id,actor_id,operation_id,event_type,revision,task,created_at,actor_type) VALUES($1,$2,$7,$3,$4,1,$5,$6,$8)',
    [
      task.id,
      ownerId,
      operationId,
      'task.create',
      task,
      after,
      actor?.actorId ?? ownerId,
      actor?.actorType === 'agent' ? 'agent' : 'human',
    ],
  );
  return task;
}
export async function listRecurrence(pool: Pool, actor: OwnerPrincipal) {
  await requireOwner(pool, actor.userId);
  return {
    series: (
      await pool.query('SELECT value FROM recurrence_series WHERE owner_id=$1 ORDER BY id', [
        actor.userId,
      ])
    ).rows.map((r) => RecurrenceSeriesSchema.parse(r.value)),
  };
}
export async function executeRecurrenceCommand(
  pool: Pool,
  actor: OwnerPrincipal,
  input: RecurrenceCommand,
  authorize: (client: PoolClient) => Promise<void>,
) {
  const command = RecurrenceCommandSchema.parse(input);
  return featureOperation(pool, actor, command, authorize, async (client) => {
    const row = (
      await client.query('SELECT value FROM recurrence_series WHERE owner_id=$1 AND id=$2', [
        actor.userId,
        command.id,
      ])
    ).rows[0];
    const old = row ? RecurrenceSeriesSchema.parse(row.value) : null;
    checkRevision(old?.revision ?? 0, command.expectedRevision);
    if (!old && command.type !== 'series.create')
      throw new ApplicationError(404, 'NOT_FOUND', 'Recurrence series not found.');
    if (old?.cancelledAt)
      throw new ApplicationError(409, 'SERIES_CANCELLED', 'This recurrence series is cancelled.');
    if (
      command.type === 'series.create' &&
      (await client.query('SELECT id FROM recurrence_series WHERE id=$1', [command.id])).rowCount
    )
      throw new ApplicationError(409, 'RECORD_EXISTS', 'This series ID is already used.');
    const now = new Date().toISOString();
    let series = old;
    if (command.type === 'series.create' || command.type === 'series.edit')
      series = RecurrenceSeriesSchema.parse({
        id: command.id,
        revision: command.expectedRevision + 1,
        content: command.content,
        rule: command.rule,
        createdAt: old?.createdAt ?? now,
        updatedAt: now,
        cancelledAt: null,
      });
    if (command.type === 'series.cancel')
      series = { ...old!, revision: old!.revision + 1, updatedAt: now, cancelledAt: now };
    const changedTasks: Task[] = [];
    if (command.type === 'series.skip') {
      const taskRow = (
        await client.query('SELECT * FROM tasks WHERE owner_id=$1 AND id=$2 AND series_id=$3', [
          actor.userId,
          command.taskId,
          command.id,
        ])
      ).rows[0];
      if (!taskRow) throw new ApplicationError(404, 'NOT_FOUND', 'Occurrence not found.');
      const task = taskFromRow(taskRow);
      checkRevision(task.revision, command.expectedTaskRevision);
      if (task.phase === 'completed' || task.schedule.skippedAt)
        throw new ApplicationError(
          409,
          'OCCURRENCE_CLOSED',
          'This occurrence is already completed or skipped.',
        );
      changedTasks.push({
        ...task,
        revision: task.revision + 1,
        updatedAt: now,
        archivedAt: now,
        schedule: { ...task.schedule, skippedAt: now },
      });
    }
    // Only future pending occurrences are updated; started/overdue work and completed history stay as recorded.
    if (command.type === 'series.edit' || command.type === 'series.cancel') {
      const pending = await client.query(
        "SELECT * FROM tasks WHERE owner_id=$1 AND series_id=$2 AND phase='planned' AND deleted_at IS NULL AND archived_at IS NULL AND (schedule->>'scheduledAt')::timestamptz>now()",
        [actor.userId, command.id],
      );
      for (const row of pending.rows) {
        const task = taskFromRow(row);
        const occurrence =
          command.type === 'series.edit'
            ? await availableOccurrence(
                client,
                actor.userId,
                command.id,
                series!.rule,
                now,
                task.id,
              )
            : null;
        changedTasks.push({
          ...task,
          revision: task.revision + 1,
          updatedAt: now,
          ...(occurrence
            ? {
                content: series!.content,
                schedule: {
                  ...task.schedule,
                  dueAt: occurrence.at,
                  scheduledAt: occurrence.at,
                  occurrenceKey: occurrence.key,
                },
              }
            : { archivedAt: now }),
        });
      }
    }
    await client.query(
      'INSERT INTO recurrence_series(id,owner_id,revision,value) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,value=excluded.value WHERE recurrence_series.owner_id=excluded.owner_id',
      [series!.id, actor.userId, series!.revision, series],
    );
    for (const task of changedTasks) {
      await saveTask(client, actor.userId, task);
      await client.query(
        'INSERT INTO task_history(task_id,owner_id,actor_id,operation_id,event_type,revision,task,created_at,actor_type) VALUES($1,$2,$8,$3,$4,$5,$6,$7,$9)',
        [
          task.id,
          actor.userId,
          command.operationId,
          'task.edit',
          task.revision,
          task,
          now,
          actor.actorId ?? actor.userId,
          actor.actorType === 'agent' ? 'agent' : 'human',
        ],
      );
    }
    if (command.type !== 'series.cancel') {
      const next = await generateNextOccurrence(
        client,
        actor.userId,
        command.id,
        now,
        command.operationId,
        actor,
      );
      if (next) changedTasks.push(next);
    }
    return {
      result: { series, changedTasks },
      records: [
        {
          recordType: 'series' as const,
          id: series!.id,
          revision: series!.revision,
          value: series,
          eventType: command.type,
        },
        ...changedTasks.map((value) => ({
          recordType: 'task' as const,
          id: value.id,
          revision: value.revision,
          value,
          eventType: value.revision === 1 ? 'task.create' : 'task.edit',
        })),
      ],
    };
  });
}
