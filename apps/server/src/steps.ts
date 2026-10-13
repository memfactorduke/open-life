import type { Pool, PoolClient } from 'pg';
import { isDeepStrictEqual } from 'node:util';
import {
  TaskStepSchema,
  StepCommandSchema,
  validateStepGraph,
  stepRollup,
  type Task,
  type TaskStep,
  type StepCommand,
} from '@mems-life/domain';
import { featureOperation, checkRevision } from './feature-migrations.js';
import { requireOwner, type OwnerPrincipal } from './operations.js';
import { ApplicationError } from './errors.js';
import { saveTask, taskFromRow } from './tasks.js';
import {
  assertAgentParentComplete,
  assertBoundStepTransition,
  invalidateAgentResults,
} from './artifact-review.js';
export async function readSteps(
  client: Pool | PoolClient,
  ownerId: string,
  taskId: string,
): Promise<TaskStep[]> {
  return (
    await client.query(
      "SELECT value FROM task_steps WHERE owner_id=$1 AND task_id=$2 AND deleted_at IS NULL ORDER BY (value->'content'->>'order')::integer,id",
      [ownerId, taskId],
    )
  ).rows.map((r) => TaskStepSchema.parse(r.value));
}
export async function assertParentComplete(client: PoolClient, ownerId: string, task: Task) {
  await assertAgentParentComplete(client, ownerId, task.id);
  const rollup = stepRollup(task, await readSteps(client, ownerId, task.id));
  if (!rollup.canComplete)
    throw new ApplicationError(
      409,
      'REQUIRED_STEPS',
      'Complete required steps and final review before completing the parent.',
    );
}
export async function listSteps(pool: Pool, actor: OwnerPrincipal, taskId: string) {
  await requireOwner(pool, actor.userId);
  const rows = await pool.query('SELECT * FROM tasks WHERE owner_id=$1 AND id=$2', [
    actor.userId,
    taskId,
  ]);
  if (!rows.rowCount) throw new ApplicationError(404, 'NOT_FOUND', 'Parent task not found.');
  const task = taskFromRow(rows.rows[0]);
  return { task, ...stepRollup(task, await readSteps(pool, actor.userId, taskId)) };
}
export async function executeStepCommand(
  pool: Pool,
  actor: OwnerPrincipal,
  input: StepCommand,
  authorize: (client: PoolClient) => Promise<void>,
) {
  const command = StepCommandSchema.parse(input);
  return featureOperation(pool, actor, command, authorize, async (client) => {
    const row = (
      await client.query('SELECT * FROM tasks WHERE owner_id=$1 AND id=$2', [
        actor.userId,
        command.taskId,
      ])
    ).rows[0];
    if (!row) throw new ApplicationError(404, 'NOT_FOUND', 'Parent task not found.');
    const parent = taskFromRow(row);
    checkRevision(parent.revision, command.expectedTaskRevision);
    if (parent.archivedAt || parent.deletedAt || parent.phase === 'completed')
      throw new ApplicationError(
        409,
        'PARENT_CLOSED',
        'Reopen or restore the parent before changing steps.',
      );
    const steps = await readSteps(client, actor.userId, parent.id);
    const old = steps.find((s) => s.id === command.id);
    checkRevision(old?.revision ?? 0, command.expectedRevision);
    if (command.type !== 'step.create' && !old)
      throw new ApplicationError(404, 'NOT_FOUND', 'Step not found.');
    if (
      actor.actorType === 'agent' &&
      command.type === 'step.edit' &&
      old &&
      ((old.content.responsibility === 'human' && command.content.responsibility !== 'human') ||
        (old.content.required && !command.content.required))
    )
      throw new ApplicationError(
        403,
        'OWNER_REVIEW_REQUIRED',
        'A person must change human responsibility or remove a required step.',
      );
    if (
      command.type === 'step.create' &&
      (await client.query('SELECT id FROM task_steps WHERE id=$1', [command.id])).rowCount
    )
      throw new ApplicationError(409, 'RECORD_EXISTS', 'This step ID is already used.');
    const now = new Date().toISOString();
    let step: TaskStep;
    if (command.type === 'step.create')
      step = {
        id: command.id,
        taskId: parent.id,
        revision: 1,
        executionRevision: 1,
        content: command.content,
        status: 'pending',
        assignedTo: null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      };
    else {
      step = { ...old!, revision: old!.revision + 1, updatedAt: now };
      if (command.type === 'step.edit') {
        step.content = command.content;
        if (!isDeepStrictEqual(old!.content, command.content)) {
          step.status = 'pending';
          step.executionRevision++;
        }
      }
      if (command.type === 'step.assign') step.assignedTo = command.assignedTo;
      if (command.type === 'step.status') {
        await assertBoundStepTransition(client, actor.userId, step.id, command.status);
        if (
          actor.actorType === 'agent' &&
          step.content.responsibility === 'human' &&
          command.status !== 'pending'
        )
          throw new ApplicationError(
            403,
            'HUMAN_STEP_REQUIRED',
            'A person must record execution of a human step.',
          );
        if (command.status === 'skipped' && step.content.required)
          throw new ApplicationError(409, 'REQUIRED_STEP', 'Required steps cannot be skipped.');
        if (['active', 'completed'].includes(command.status) && step.status !== 'completed') {
          const entry = stepRollup(parent, steps).entries.find((e) => e.step.id === step.id)!;
          if (entry.waitingReason)
            throw new ApplicationError(
              409,
              'STEP_NOT_READY',
              `Step is waiting: ${entry.waitingReason}.`,
            );
        }
        if (step.status !== command.status) step.executionRevision++;
        step.status = command.status;
      }
    }
    if (
      command.type === 'step.delete' &&
      (old!.content.required || steps.some((s) => s.content.dependencies.includes(command.id)))
    )
      throw new ApplicationError(
        409,
        'STEP_IN_USE',
        'Make this step optional and remove dependencies before deleting it.',
      );
    const updatedSteps = steps.filter((s) => s.id !== step.id);
    if (command.type !== 'step.delete') updatedSteps.push(step);
    try {
      validateStepGraph(updatedSteps);
    } catch (error) {
      throw new ApplicationError(409, 'INVALID_GRAPH', (error as Error).message);
    }
    // Reopening a prerequisite cannot leave unfinished descendants active. Completed external work remains history.
    const corrections: TaskStep[] = [];
    const invalidatedRecords = [];
    if (
      (command.type === 'step.status' && command.status === 'pending') ||
      (command.type === 'step.edit' && !isDeepStrictEqual(old!.content, step.content))
    ) {
      const affected = new Set([step.id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const candidate of updatedSteps)
          if (
            !affected.has(candidate.id) &&
            candidate.content.dependencies.some((id) => affected.has(id))
          ) {
            affected.add(candidate.id);
            grew = true;
          }
      }
      for (const candidate of updatedSteps) {
        if (
          candidate.id !== step.id &&
          affected.has(candidate.id) &&
          ['active', 'completed'].includes(candidate.status)
        ) {
          candidate.status = 'pending';
          candidate.revision++;
          candidate.executionRevision++;
          candidate.updatedAt = now;
          corrections.push(candidate);
        }
      }
      invalidatedRecords.push(
        ...(await invalidateAgentResults(
          client,
          actor.userId,
          parent.id,
          [...affected],
          'A prerequisite or its instructions changed. Review current work before proceeding.',
        )),
      );
    }
    if (command.type === 'step.delete')
      await client.query(
        'UPDATE task_steps SET deleted_at=$3,revision=$4,value=$5 WHERE owner_id=$1 AND id=$2',
        [actor.userId, step.id, now, step.revision, { ...step, deletedAt: now }],
      );
    else
      await client.query(
        'INSERT INTO task_steps(id,owner_id,task_id,revision,value) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,value=excluded.value WHERE task_steps.owner_id=excluded.owner_id AND task_steps.task_id=excluded.task_id',
        [step.id, actor.userId, parent.id, step.revision, step],
      );
    for (const corrected of corrections)
      await client.query('UPDATE task_steps SET revision=$3,value=$4 WHERE owner_id=$1 AND id=$2', [
        actor.userId,
        corrected.id,
        corrected.revision,
        corrected,
      ]);
    const task = {
      ...parent,
      revision: parent.revision + 1,
      updatedAt: now,
      finalReviewSatisfied: false,
    };
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
    return {
      result: {
        step: command.type === 'step.delete' ? null : step,
        task,
        ...stepRollup(task, updatedSteps),
      },
      records: [
        ...invalidatedRecords,
        {
          recordType: 'step' as const,
          id: step.id,
          revision: step.revision,
          value: command.type === 'step.delete' ? { ...step, deletedAt: now } : step,
          eventType: command.type,
        },
        ...corrections.map((value) => ({
          recordType: 'step' as const,
          id: value.id,
          revision: value.revision,
          value,
          eventType: 'step.readiness.corrected',
        })),
        {
          recordType: 'task' as const,
          id: task.id,
          revision: task.revision,
          value: task,
          eventType: command.type,
        },
      ],
    };
  });
}
