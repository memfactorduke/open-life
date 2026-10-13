import type { Pool, PoolClient } from 'pg';
import {
  BoardSchema,
  ProjectSchema,
  BoardCommandSchema,
  ProjectCommandSchema,
  type BoardCommand,
  type ProjectCommand,
  type Task,
} from '@mems-life/domain';
import { featureOperation, checkRevision } from './feature-migrations.js';
import { requireOwner, type OwnerPrincipal } from './operations.js';
import { ApplicationError } from './errors.js';
export async function validateOrganization(
  client: PoolClient,
  ownerId: string,
  task: Task,
): Promise<void> {
  const { boardId, columnId, projectId } = task.organization;
  if ((boardId === null) !== (columnId === null))
    throw new ApplicationError(409, 'INVALID_COLUMN', 'Choose both a board and column.');
  if (boardId) {
    const result = await client.query('SELECT value FROM boards WHERE owner_id=$1 AND id=$2', [
      ownerId,
      boardId,
    ]);
    if (!result.rowCount) throw new ApplicationError(404, 'NOT_FOUND', 'Board not found.');
    const board = BoardSchema.parse(result.rows[0].value);
    const column = board.content.columns.find((c) => c.id === columnId);
    if (!column || (task.phase !== 'completed' && column.phase !== task.phase))
      throw new ApplicationError(
        409,
        'INVALID_COLUMN',
        'The column must match the task lifecycle phase.',
      );
  }
  if (
    projectId &&
    !(
      await client.query('SELECT id FROM projects WHERE owner_id=$1 AND id=$2', [
        ownerId,
        projectId,
      ])
    ).rowCount
  )
    throw new ApplicationError(404, 'NOT_FOUND', 'Project not found.');
}
export async function listBoards(pool: Pool, actor: OwnerPrincipal) {
  await requireOwner(pool, actor.userId);
  return {
    boards: (
      await pool.query(
        "SELECT value FROM boards WHERE owner_id=$1 ORDER BY value->'content'->>'name',id",
        [actor.userId],
      )
    ).rows.map((r) => BoardSchema.parse(r.value)),
  };
}
export async function listProjects(pool: Pool, actor: OwnerPrincipal) {
  await requireOwner(pool, actor.userId);
  return {
    projects: (
      await pool.query(
        "SELECT value FROM projects WHERE owner_id=$1 ORDER BY value->'content'->>'name',id",
        [actor.userId],
      )
    ).rows.map((r) => ProjectSchema.parse(r.value)),
  };
}
async function executeOrganization(
  pool: Pool,
  actor: OwnerPrincipal,
  input: BoardCommand | ProjectCommand,
  authorize: (client: PoolClient) => Promise<void>,
) {
  const isBoard = input.type.startsWith('board.');
  const command = isBoard ? BoardCommandSchema.parse(input) : ProjectCommandSchema.parse(input);
  const table = isBoard ? 'boards' : 'projects';
  const recordType = isBoard ? ('board' as const) : ('project' as const);
  return featureOperation(pool, actor, command, authorize, async (client) => {
    const rows = await client.query(`SELECT value FROM ${table} WHERE owner_id=$1 AND id=$2`, [
      actor.userId,
      command.id,
    ]);
    const old = rows.rows[0]?.value;
    checkRevision(old?.revision ?? 0, command.expectedRevision);
    if (
      command.type.endsWith('.create') &&
      !old &&
      (await client.query(`SELECT id FROM ${table} WHERE id=$1`, [command.id])).rowCount
    )
      throw new ApplicationError(409, 'RECORD_EXISTS', 'This ID is already used.');
    if (command.type.endsWith('.create') && old)
      throw new ApplicationError(409, 'RECORD_EXISTS', 'This configuration already exists.');
    if (command.type.endsWith('.edit') && !old)
      throw new ApplicationError(404, 'NOT_FOUND', 'Configuration not found.');
    if (isBoard && old) {
      const columns = (command as BoardCommand).content.columns;
      const linked = await client.query(
        'SELECT organization,phase FROM tasks WHERE owner_id=$1 AND board_id=$2',
        [actor.userId, command.id],
      );
      for (const row of linked.rows) {
        const previous = BoardSchema.parse(old).content.columns.find(
          (c) => c.id === row.organization.columnId,
        );
        const column = columns.find((c) => c.id === row.organization.columnId);
        if (!column || column.phase !== previous?.phase)
          throw new ApplicationError(
            409,
            'COLUMN_IN_USE',
            'Move existing tasks before removing a column or changing its lifecycle phase.',
          );
      }
    }
    const now = new Date().toISOString();
    const value = (isBoard ? BoardSchema : ProjectSchema).parse({
      id: command.id,
      revision: command.expectedRevision + 1,
      content: command.content,
      createdAt: old?.createdAt ?? now,
      updatedAt: now,
    });
    await client.query(
      `INSERT INTO ${table}(id,owner_id,revision,value) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,value=excluded.value WHERE ${table}.owner_id=excluded.owner_id`,
      [value.id, actor.userId, value.revision, value],
    );
    return {
      result: { record: value },
      records: [
        { recordType, id: value.id, revision: value.revision, value, eventType: command.type },
      ],
    };
  });
}
export const executeBoardCommand = (
  pool: Pool,
  actor: OwnerPrincipal,
  input: BoardCommand,
  authorize: (client: PoolClient) => Promise<void>,
) => executeOrganization(pool, actor, input, authorize);
export const executeProjectCommand = (
  pool: Pool,
  actor: OwnerPrincipal,
  input: ProjectCommand,
  authorize: (client: PoolClient) => Promise<void>,
) => executeOrganization(pool, actor, input, authorize);
