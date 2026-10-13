import type { Pool, PoolClient } from 'pg';
import {
  TaskSchema,
  TaskCommandSchema,
  TaskRuleError,
  applyTaskCommand,
  type Task,
  type TaskCommand,
  type TaskCommandResponse,
} from '@mems-life/domain';
import { ApplicationError } from './errors.js';
import { requireOwner, type OwnerPrincipal } from './operations.js';
import { validateOrganization } from './organization.js';
import { assertParentComplete } from './steps.js';
import { generateNextOccurrence } from './recurrence.js';
import { featureOperation } from './feature-migrations.js';

export function taskFromRow(row: Record<string, unknown>): Task {
  const instant = (value: unknown) => (value instanceof Date ? value.toISOString() : value);
  return TaskSchema.parse({
    id: row.id,
    revision: row.revision,
    phase: row.phase,
    content: row.content,
    order: row.sort_order,
    organization: row.organization,
    schedule: row.schedule,
    paused: row.paused,
    finalReviewRequired: row.final_review_required,
    finalReviewSatisfied: row.final_review_satisfied,
    createdAt: instant(row.created_at),
    updatedAt: instant(row.updated_at),
    completedAt: instant(row.completed_at),
    archivedAt: instant(row.archived_at),
    deletedAt: instant(row.deleted_at),
  });
}
export async function listTasks(
  pool: Pool,
  actor: OwnerPrincipal,
  view: 'open' | 'completed' | 'archived' = 'open',
) {
  await requireOwner(pool, actor.userId);
  const filters = {
    open: "archived_at IS NULL AND phase<>'completed'",
    completed: "archived_at IS NULL AND phase='completed'",
    archived: 'archived_at IS NOT NULL',
  };
  const rows = await pool.query(
    `SELECT * FROM tasks WHERE owner_id=$1 AND deleted_at IS NULL AND ${filters[view]} ORDER BY CASE phase WHEN 'planned' THEN 0 WHEN 'next' THEN 1 WHEN 'active' THEN 2 ELSE 3 END,sort_order,id LIMIT 1000`,
    [actor.userId],
  );
  return { tasks: rows.rows.map(taskFromRow) };
}
export async function readTask(pool: Pool, actor: OwnerPrincipal, id: string) {
  await requireOwner(pool, actor.userId);
  const rows = await pool.query('SELECT * FROM tasks WHERE owner_id=$1 AND id=$2', [
    actor.userId,
    id,
  ]);
  if (!rows.rows[0]) throw new ApplicationError(404, 'NOT_FOUND', 'Task not found.');
  return { task: taskFromRow(rows.rows[0]) };
}
export async function taskHistory(
  pool: Pool,
  actor: OwnerPrincipal,
  id: string,
  cursor?: string,
  limit = 50,
) {
  await readTask(pool, actor, id);
  const rows = await pool.query(
    'SELECT * FROM task_history WHERE owner_id=$1 AND task_id=$2 AND revision<$3 ORDER BY revision DESC LIMIT $4',
    [actor.userId, id, cursor ? Number(cursor) : 2147483647, limit + 1],
  );
  const page = rows.rows.slice(0, limit);
  return {
    events: page.map((row) => ({
      id: row.id,
      operationId: row.operation_id,
      actorId: row.actor_id,
      actorType: row.actor_type === 'agent' ? ('agent' as const) : ('human' as const),
      type: row.event_type,
      revision: row.revision,
      task: TaskSchema.parse(row.task),
      createdAt: row.created_at.toISOString(),
    })),
    nextCursor: rows.rows.length > limit ? String(page.at(-1)!.revision) : null,
  };
}
export async function saveTask(client: PoolClient, ownerId: string, task: Task) {
  await client.query(
    'INSERT INTO tasks(id,owner_id,revision,phase,content,sort_order,created_at,updated_at,completed_at,archived_at,deleted_at,organization,schedule,paused,final_review_required,final_review_satisfied,board_id,project_id,series_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,phase=excluded.phase,content=excluded.content,sort_order=excluded.sort_order,updated_at=excluded.updated_at,completed_at=excluded.completed_at,archived_at=excluded.archived_at,deleted_at=excluded.deleted_at,organization=excluded.organization,schedule=excluded.schedule,paused=excluded.paused,final_review_required=excluded.final_review_required,final_review_satisfied=excluded.final_review_satisfied,board_id=excluded.board_id,project_id=excluded.project_id,series_id=excluded.series_id WHERE tasks.owner_id=excluded.owner_id',
    [
      task.id,
      ownerId,
      task.revision,
      task.phase,
      task.content,
      task.order,
      task.createdAt,
      task.updatedAt,
      task.completedAt,
      task.archivedAt,
      task.deletedAt,
      task.organization,
      task.schedule,
      task.paused,
      task.finalReviewRequired,
      task.finalReviewSatisfied,
      task.organization.boardId,
      task.organization.projectId,
      task.schedule.seriesId,
    ],
  );
}
export async function executeTaskCommand(
  pool: Pool,
  actor: OwnerPrincipal,
  input: TaskCommand,
  authorizeAgain: (client: PoolClient) => Promise<void>,
): Promise<TaskCommandResponse> {
  const command = TaskCommandSchema.parse(input);
  return featureOperation(pool, actor, command, authorizeAgain, async (client) => {
    const rows = await client.query(
      'SELECT * FROM tasks WHERE owner_id=$1 ORDER BY sort_order,id',
      [actor.userId],
    );
    const tasks = rows.rows.map(taskFromRow);
    const old = tasks.find((task) => task.id === command.taskId) ?? null;
    if (!old && command.type === 'task.create') {
      const duplicate = await client.query('SELECT id FROM tasks WHERE id=$1', [command.taskId]);
      if (duplicate.rowCount)
        throw new ApplicationError(409, 'RECORD_EXISTS', 'This task ID is already used.');
    }
    if (
      actor.actorType === 'agent' &&
      (command.type === 'task.pause' ||
        command.type === 'task.review' ||
        (command.type === 'task.move' && old?.phase === 'planned' && command.phase !== 'planned') ||
        (command.type === 'task.reopen' && command.phase !== 'planned') ||
        (command.type === 'task.complete' && (old?.phase === 'planned' || old?.paused)))
    )
      throw new ApplicationError(
        403,
        'HUMAN_RELEASE_REQUIRED',
        'Only the person may release, pause or approve work.',
      );
    const now = new Date().toISOString();
    let task: Task;
    try {
      task = applyTaskCommand(old, command, now);
    } catch (error) {
      if (error instanceof TaskRuleError)
        throw new ApplicationError(
          error.code === 'not_found' ? 404 : 409,
          error.code.toUpperCase(),
          error.message,
        );
      throw error;
    }
    if (
      old?.schedule.skippedAt &&
      !['task.delete', 'task.restore', 'task.unarchive'].includes(command.type)
    )
      throw new ApplicationError(
        409,
        'OCCURRENCE_SKIPPED',
        'Skipped occurrence history cannot be completed or reopened.',
      );
    if (command.type === 'task.complete') await assertParentComplete(client, actor.userId, task);
    if (
      (command.type === 'task.move' || command.type === 'task.reopen') &&
      task.organization.boardId
    ) {
      const board = (
        await client.query('SELECT value FROM boards WHERE owner_id=$1 AND id=$2', [
          actor.userId,
          task.organization.boardId,
        ])
      ).rows[0]?.value;
      const column =
        board?.content.columns.find(
          (c: { id: string; phase: string }) =>
            old?.phase === task.phase &&
            c.id === old.organization.columnId &&
            c.phase === task.phase,
        ) ?? board?.content.columns.find((c: { phase: string }) => c.phase === task.phase);
      task = { ...task, organization: { ...task.organization, columnId: column?.id ?? null } };
    }
    await validateOrganization(client, actor.userId, task);
    const sameLane = (left: Task, right: Task) =>
      left.phase === right.phase &&
      left.organization.boardId === right.organization.boardId &&
      left.organization.columnId === right.organization.columnId;
    const peers = tasks.filter(
      (peer) => peer.id !== task.id && sameLane(peer, task) && !peer.archivedAt && !peer.deletedAt,
    );
    const visible = !task.archivedAt && !task.deletedAt;
    if (command.type === 'task.move' && command.beforeTaskId) {
      const index = peers.findIndex((peer) => peer.id === command.beforeTaskId);
      if (index < 0)
        throw new ApplicationError(
          409,
          'INVALID_ORDER',
          'The destination task is no longer in this column.',
        );
      peers.splice(index, 0, task);
    } else if (visible) {
      if (
        ![
          'task.create',
          'task.move',
          'task.complete',
          'task.reopen',
          'task.unarchive',
          'task.restore',
        ].includes(command.type) &&
        old &&
        sameLane(old, task)
      )
        peers.splice(Math.min(task.order, peers.length), 0, task);
      else peers.push(task);
    }
    const changed = new Map<string, Task>([[task.id, task]]);
    if (visible)
      for (const [order, peer] of peers.entries()) {
        const reordered =
          peer.id === task.id
            ? { ...peer, order }
            : peer.order === order
              ? peer
              : { ...peer, order, revision: peer.revision + 1, updatedAt: now };
        if (peer.id === task.id || peer.order !== order) changed.set(peer.id, reordered);
      }
    if (old && (!sameLane(old, task) || !visible)) {
      const source = tasks.filter(
        (peer) => peer.id !== task.id && sameLane(peer, old) && !peer.archivedAt && !peer.deletedAt,
      );
      for (const [order, peer] of source.entries())
        if (peer.order !== order)
          changed.set(peer.id, { ...peer, order, revision: peer.revision + 1, updatedAt: now });
    }
    task = changed.get(task.id)!;
    const changedTasks = [...changed.values()];
    for (const changedTask of changedTasks) {
      await saveTask(client, actor.userId, changedTask);
      await client.query(
        'INSERT INTO task_history(task_id,owner_id,actor_id,operation_id,event_type,revision,task,created_at,actor_type) VALUES($1,$2,$8,$3,$4,$5,$6,$7,$9)',
        [
          changedTask.id,
          actor.userId,
          command.operationId,
          changedTask.id === task.id ? command.type : 'task.move',
          changedTask.revision,
          changedTask,
          now,
          actor.actorId ?? actor.userId,
          actor.actorType === 'agent' ? 'agent' : 'human',
        ],
      );
    }
    if (command.type === 'task.complete' && task.schedule.seriesId) {
      const next = await generateNextOccurrence(
        client,
        actor.userId,
        task.schedule.seriesId,
        now,
        command.operationId,
        actor,
      );
      if (next) changedTasks.push(next);
    }
    return {
      result: { task, changedTasks },
      records: changedTasks.map((value) => ({
        recordType: 'task' as const,
        id: value.id,
        revision: value.revision,
        value,
        eventType: value.id === task.id ? command.type : 'task.move',
      })),
    };
  });
}

export type TaskQuery = {
  view?: 'open' | 'completed' | 'archived' | 'deleted' | 'all';
  search?: string | undefined;
  boardId?: string | undefined;
  projectId?: string | undefined;
  tag?: string | undefined;
  priority?: string | undefined;
  timing?: 'upcoming' | 'overdue' | undefined;
  phase?: string | undefined;
  responsibility?: 'human' | 'agent' | 'either' | undefined;
  limit?: number;
  cursor?: number;
};
export async function queryTasks(pool: Pool, actor: OwnerPrincipal, query: TaskQuery = {}) {
  await requireOwner(pool, actor.userId);
  const parameters: unknown[] = [actor.userId];
  const where = ['t.owner_id=$1'];
  const bind = (value: unknown) => {
    parameters.push(value);
    return `$${parameters.length}`;
  };
  const view = query.view ?? 'open';
  if (view !== 'all')
    where.push(view === 'deleted' ? 't.deleted_at IS NOT NULL' : 't.deleted_at IS NULL');
  if (view === 'open') where.push("t.archived_at IS NULL AND t.phase<>'completed'");
  if (view === 'completed') where.push("t.archived_at IS NULL AND t.phase='completed'");
  if (view === 'archived') where.push('t.archived_at IS NOT NULL');
  if (query.search) {
    const term = bind(`%${query.search.replace(/[\\%_]/g, '\\$&')}%`);
    where.push(
      `(t.content->>'title' ILIKE ${term} OR t.content->>'description' ILIKE ${term} OR t.content->>'notes' ILIKE ${term})`,
    );
  }
  if (query.boardId) where.push(`t.board_id=${bind(query.boardId)}`);
  if (query.projectId) where.push(`t.project_id=${bind(query.projectId)}`);
  if (query.tag) where.push(`t.organization->'tags' ? ${bind(query.tag)}`);
  if (query.priority) where.push(`t.organization->>'priority'=${bind(query.priority)}`);
  if (query.phase) where.push(`t.phase=${bind(query.phase)}`);
  if (query.timing)
    where.push(
      `t.phase<>'completed' AND t.schedule->>'skippedAt' IS NULL AND ${query.timing === 'overdue' ? "(t.schedule->>'dueAt')::timestamptz <" : "LEAST((t.schedule->>'scheduledAt')::timestamptz,(t.schedule->>'dueAt')::timestamptz) >="} now()`,
    );
  if (query.responsibility) {
    const responsibility = bind(query.responsibility);
    where.push(
      `EXISTS(SELECT 1 FROM task_steps s WHERE s.owner_id=t.owner_id AND s.task_id=t.id AND s.deleted_at IS NULL AND s.value->>'status' NOT IN ('completed','skipped') AND (s.value->'content'->>'responsibility'=${responsibility} OR s.value->'content'->>'responsibility'='either'))`,
    );
  }
  const limit = Math.min(100, Math.max(1, query.limit ?? 50));
  const cursor = Math.max(0, query.cursor ?? 0);
  const rows = await pool.query(
    `SELECT t.* FROM tasks t WHERE ${where.join(' AND ')} ORDER BY t.created_at,t.id LIMIT ${bind(limit + 1)} OFFSET ${bind(cursor)}`,
    parameters,
  );
  return {
    tasks: rows.rows.slice(0, limit).map(taskFromRow),
    nextCursor: rows.rows.length > limit ? String(cursor + limit) : null,
  };
}
