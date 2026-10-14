import { isDeepStrictEqual } from 'node:util';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  AgentWorkflowCommandSchema,
  type AgentWorkflowCommand,
  type SkillReference,
  type SkillBinding,
  type AgentAttempt,
  type AgentResult,
  type ArtifactReference,
} from '@mems-life/domain';
import {
  stepRollup,
  TaskSchema,
  TaskStepSchema,
  type Task,
  type TaskStep,
} from '@mems-life/domain';
import { featureOperation, checkRevision, type ChangedRecord } from './feature-migrations.js';
import { requireOwner, type OwnerPrincipal } from './operations.js';
import { readSteps } from './steps.js';
import { taskFromRow, saveTask, activateReleasedTask } from './tasks.js';
import { ApplicationError } from './errors.js';
import { validateArtifactReferences, invalidateAgentResults } from './artifact-review.js';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
function deny(code: string, message: string): never {
  throw new ApplicationError(409, code, message);
}
const human = (actor: OwnerPrincipal) => {
  if (actor.actorType === 'agent')
    throw new ApplicationError(
      403,
      'HUMAN_REQUIRED',
      'A person must approve, cancel, or reconcile this work.',
    );
};
const leaseMs = 120000;
async function bindings(
  client: Pool | PoolClient,
  ownerId: string,
  taskId: string,
): Promise<SkillBinding[]> {
  return (
    await client.query('SELECT value FROM agent_bindings WHERE owner_id=$1 AND task_id=$2', [
      ownerId,
      taskId,
    ])
  ).rows.map((r) => r.value);
}
async function attempts(
  client: Pool | PoolClient,
  ownerId: string,
  taskId?: string,
): Promise<AgentAttempt[]> {
  return (
    await client.query(
      'SELECT value FROM agent_attempts WHERE owner_id=$1' + (taskId ? ' AND task_id=$2' : ''),
      taskId ? [ownerId, taskId] : [ownerId],
    )
  ).rows.map((r) => r.value);
}
function effective(attempt: AgentAttempt) {
  if (
    ['running', 'cancel-requested'].includes(attempt.status) &&
    Date.parse(attempt.expiresAt) <= Date.now()
  )
    return attempt.snapshot.binding.risk === 'external-effect' ? 'outcome-unknown' : 'expired';
  return attempt.status;
}
function blocking(attempt: AgentAttempt, step?: TaskStep, binding?: SkillBinding) {
  if (
    attempt.status === 'reconciled' &&
    attempt.reconciliation?.outcome === 'performed' &&
    !attempt.reconciliation.replacementAuthorized
  )
    return true;
  if (
    attempt.status === 'submitted' &&
    attempt.snapshot.binding.risk === 'none' &&
    step &&
    binding &&
    (attempt.snapshot.binding.revision !== binding.revision ||
      !isDeepStrictEqual(attempt.snapshot.stepContent, step.content))
  )
    return false;
  return ['running', 'cancel-requested', 'outcome-unknown', 'submitted'].includes(
    effective(attempt),
  );
}
export async function readAgentWorkflow(pool: Pool, actor: OwnerPrincipal, taskId: string) {
  await requireOwner(pool, actor.userId);
  const row = (
    await pool.query('SELECT * FROM tasks WHERE owner_id=$1 AND id=$2', [actor.userId, taskId])
  ).rows[0];
  if (!row) throw new ApplicationError(404, 'NOT_FOUND', 'Task not found.');
  return {
    task: taskFromRow(row),
    steps: await readSteps(pool, actor.userId, taskId),
    bindings: await bindings(pool, actor.userId, taskId),
    attempts: (await attempts(pool, actor.userId, taskId)).map((a) => ({
      ...a,
      effectiveStatus: effective(a),
    })),
    results: (
      await pool.query(
        'SELECT value FROM agent_results WHERE owner_id=$1 AND task_id=$2 ORDER BY version',
        [actor.userId, taskId],
      )
    ).rows.map((r) => r.value),
    skills: (
      await pool.query('SELECT value FROM agent_skills WHERE owner_id=$1 ORDER BY id', [
        actor.userId,
      ])
    ).rows.map((r) => r.value),
  };
}
export async function listAgentSkills(pool: Pool, actor: OwnerPrincipal) {
  await requireOwner(pool, actor.userId);
  return {
    skills: (
      await pool.query('SELECT value FROM agent_skills WHERE owner_id=$1 ORDER BY id', [
        actor.userId,
      ])
    ).rows.map((r) => r.value),
  };
}
export async function listEligibleAgentSteps(pool: Pool, actor: OwnerPrincipal) {
  await requireOwner(pool, actor.userId);
  const all = (
      await pool.query(
        "SELECT a.value FROM agent_attempts a JOIN tasks t ON t.id=a.task_id AND t.owner_id=a.owner_id WHERE a.owner_id=$1 AND t.phase IN ('next','active') AND NOT t.paused AND t.archived_at IS NULL AND t.deleted_at IS NULL",
        [actor.userId],
      )
    ).rows.map((row) => row.value as AgentAttempt),
    result: { task: Task; step: TaskStep; binding: SkillBinding }[] = [];
  const rows = await pool.query(
    "SELECT * FROM tasks WHERE owner_id=$1 AND phase IN ('next','active') AND NOT paused AND archived_at IS NULL AND deleted_at IS NULL ORDER BY sort_order,id",
    [actor.userId],
  );
  const taskIds = rows.rows.map((row) => row.id as string);
  const [stepRows, bindingRows] = await Promise.all([
    pool.query(
      "SELECT value FROM task_steps WHERE owner_id=$1 AND task_id=ANY($2::uuid[]) AND deleted_at IS NULL ORDER BY (value->'content'->>'order')::integer,id",
      [actor.userId, taskIds],
    ),
    pool.query('SELECT value FROM agent_bindings WHERE owner_id=$1 AND task_id=ANY($2::uuid[])', [
      actor.userId,
      taskIds,
    ]),
  ]);
  const stepsByTask = new Map<string, TaskStep[]>();
  for (const row of stepRows.rows) {
    const step = TaskStepSchema.parse(row.value);
    const group = stepsByTask.get(step.taskId) ?? [];
    group.push(step);
    stepsByTask.set(step.taskId, group);
  }
  const bindingsByStep = new Map(
    bindingRows.rows.map((row) => {
      const binding = row.value as SkillBinding;
      return [binding.stepId, binding] as const;
    }),
  );
  const attemptsByStep = new Map<string, AgentAttempt[]>();
  for (const attempt of all) {
    const group = attemptsByStep.get(attempt.stepId) ?? [];
    group.push(attempt);
    attemptsByStep.set(attempt.stepId, group);
  }
  for (const row of rows.rows) {
    const task = taskFromRow(row),
      steps = stepsByTask.get(task.id) ?? [];
    for (const entry of stepRollup(task, steps).entries) {
      const binding = bindingsByStep.get(entry.step.id),
        past = attemptsByStep.get(entry.step.id) ?? [];
      const leaseExpired =
        entry.step.status === 'active' && past.some((a) => effective(a) === 'expired');
      if (
        !(entry.ready || (leaseExpired && entry.waitingReason === null)) ||
        entry.step.content.responsibility === 'human' ||
        !binding ||
        past.some((a) => blocking(a, entry.step, binding)) ||
        (!binding.retryable && past.length)
      )
        continue;
      if (Object.values(binding.inputs).some((v) => !v.trim())) continue;
      result.push({ task, step: entry.step, binding });
    }
  }
  return { eligible: result };
}
export async function executeAgentWorkflowCommand(
  pool: Pool,
  actor: OwnerPrincipal,
  input: AgentWorkflowCommand,
  authorize: (client: PoolClient) => Promise<void>,
) {
  const command = AgentWorkflowCommandSchema.parse(input);
  // Never persist the raw bearer-equivalent attempt token in receipts, audit, or change feed.
  const canonical =
    'ownershipToken' in command
      ? { ...command, ownershipToken: hash(command.ownershipToken) }
      : command;
  return featureOperation<{
    skill?: SkillReference;
    binding?: SkillBinding;
    task?: Task;
    attempt?: AgentAttempt;
    result?: AgentResult | null;
  }>(pool, actor, canonical, authorize, async (client) => {
    const records: ChangedRecord[] = [],
      now = new Date().toISOString(),
      actorId = actor.actorId ?? actor.userId;
    const audit = async (id: string, revision: number, value: unknown) => {
      const kind =
        command.type === 'skill.put'
          ? 'skill'
          : command.type === 'binding.put' && id === ('stepId' in command ? command.stepId : '')
            ? 'binding'
            : typeof value === 'object' && value && 'artifacts' in value
              ? 'result'
              : 'attempt';
      records.push({ recordType: kind, id, revision, value, eventType: command.type });
    };
    if (command.type === 'workflow.youtube-create') {
      human(actor);
      if ((await client.query('SELECT 1 FROM tasks WHERE id=$1', [command.taskId])).rowCount)
        deny('RECORD_EXISTS', 'Task ID is already used.');
      const order = Number(
        (
          await client.query(
            "SELECT COALESCE(MAX(sort_order),-1)+1 AS ordinal FROM tasks WHERE owner_id=$1 AND phase='planned' AND archived_at IS NULL AND deleted_at IS NULL",
            [actor.userId],
          )
        ).rows[0].ordinal,
      );
      const task = TaskSchema.parse({
        id: command.taskId,
        revision: 1,
        phase: 'planned',
        content: {
          title: 'Fictional YouTube workflow',
          description:
            'Editable coordination example. Use test artifacts only; no real uploads or publication.',
          notes: 'Script and thumbnail branch after script. Human publication remains separate.',
        },
        order,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        archivedAt: null,
        deletedAt: null,
        finalReviewRequired: true,
      });
      await saveTask(client, actor.userId, task);
      records.push({
        recordType: 'task',
        id: task.id,
        revision: task.revision,
        value: task,
        eventType: command.type,
      });
      await client.query(
        'INSERT INTO task_history(task_id,owner_id,actor_id,operation_id,event_type,revision,task,created_at,actor_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [task.id, actor.userId, actorId, command.operationId, 'task.create', 1, task, now, 'human'],
      );
      const ids = Array.from({ length: 8 }, () => randomUUID());
      const definitions = [
        { title: 'Write script', role: 'agent', dependencies: [], approval: false, risk: 'none' },
        {
          title: 'Record script',
          role: 'human',
          dependencies: [ids[0]],
          approval: false,
          risk: 'none',
        },
        {
          title: 'Edit recorded video',
          role: 'agent',
          dependencies: [ids[1]],
          approval: true,
          risk: 'none',
        },
        {
          title: 'Watch and review accepted edit',
          role: 'human',
          dependencies: [ids[2]],
          approval: false,
          risk: 'none',
        },
        {
          title: 'Verify private upload',
          role: 'either',
          dependencies: [ids[3]],
          approval: true,
          risk: 'external-effect',
        },
        {
          title: 'Draft thumbnail',
          role: 'agent',
          dependencies: [ids[0]],
          approval: true,
          risk: 'none',
        },
        {
          title: 'Approve and attach thumbnail',
          role: 'human',
          dependencies: [ids[4], ids[5]],
          approval: false,
          risk: 'none',
        },
        {
          title: 'Verify human publication',
          role: 'human',
          dependencies: [ids[4], ids[6]],
          approval: false,
          risk: 'none',
        },
      ] as const;
      for (const [index, definition] of definitions.entries()) {
        const step = TaskStepSchema.parse({
          id: ids[index],
          taskId: task.id,
          revision: 1,
          executionRevision: 1,
          content: {
            title: definition.title,
            instructions:
              'Use fictional test artifacts only. Record evidence of this action; do not publish personal media.',
            responsibility: definition.role,
            required: true,
            dependencies: definition.dependencies,
            order: index,
          },
          status: 'pending',
          assignedTo: null,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        });
        await client.query(
          'INSERT INTO task_steps(id,owner_id,task_id,revision,value) VALUES($1,$2,$3,1,$4)',
          [step.id, actor.userId, task.id, step],
        );
        records.push({
          recordType: 'step',
          id: step.id,
          revision: 1,
          value: step,
          eventType: command.type,
        });
        if (definition.role === 'human') continue;
        const skill: SkillReference = {
          id: randomUUID(),
          revision: 1,
          versions: [
            {
              name: `Fictional ${definition.title}`,
              instructions: `${definition.title} using supplied fictional inputs. Return a saved text test artifact or destination receipt; no real external effects.`,
              resources: [],
              inputKeys: ['brief'],
              requirements: [{ key: 'deliverable', kind: 'text', required: true }],
            },
          ],
        };
        await client.query('INSERT INTO agent_skills(id,owner_id,value) VALUES($1,$2,$3)', [
          skill.id,
          actor.userId,
          skill,
        ]);
        const binding: SkillBinding = {
          taskId: task.id,
          stepId: step.id,
          revision: 1,
          skillId: skill.id,
          skillVersion: 1,
          inputs: { brief: 'Fictional educational video; fixture artifacts only' },
          requirements: skill.versions[0]!.requirements,
          risk: definition.risk,
          retryable: true,
          requiresApproval: definition.approval,
        };
        await client.query(
          'INSERT INTO agent_bindings(step_id,owner_id,task_id,value) VALUES($1,$2,$3,$4)',
          [step.id, actor.userId, task.id, binding],
        );
        records.push(
          { recordType: 'skill', id: skill.id, revision: 1, value: skill, eventType: command.type },
          {
            recordType: 'binding',
            id: step.id,
            revision: 1,
            value: binding,
            eventType: command.type,
          },
        );
      }
      return { result: { task }, records };
    }
    if (command.type === 'skill.put') {
      const old = (
        await client.query('SELECT value FROM agent_skills WHERE owner_id=$1 AND id=$2', [
          actor.userId,
          command.id,
        ])
      ).rows[0]?.value as SkillReference | undefined;
      checkRevision(old?.revision ?? 0, command.expectedRevision);
      if (
        new Set(command.content.inputKeys).size !== command.content.inputKeys.length ||
        new Set(command.content.requirements.map((r) => r.key)).size !==
          command.content.requirements.length
      )
        deny('DUPLICATE_KEY', 'Skill keys must be unique.');
      const skill: SkillReference = {
        id: command.id,
        revision: (old?.revision ?? 0) + 1,
        versions: [...(old?.versions ?? []), command.content],
      };
      if (old)
        await client.query('UPDATE agent_skills SET value=$3 WHERE owner_id=$1 AND id=$2', [
          actor.userId,
          command.id,
          skill,
        ]);
      else {
        if ((await client.query('SELECT 1 FROM agent_skills WHERE id=$1', [command.id])).rowCount)
          deny('RECORD_EXISTS', 'Skill ID is already used.');
        await client.query('INSERT INTO agent_skills(id,owner_id,value) VALUES($1,$2,$3)', [
          skill.id,
          actor.userId,
          skill,
        ]);
      }
      await audit(skill.id, skill.revision, skill);
      return { result: { skill }, records };
    }
    const row = (
      await client.query('SELECT * FROM tasks WHERE owner_id=$1 AND id=$2 FOR UPDATE', [
        actor.userId,
        command.taskId,
      ])
    ).rows[0];
    if (!row) throw new ApplicationError(404, 'NOT_FOUND', 'Task not found.');
    let task = taskFromRow(row);
    const steps = await readSteps(client, actor.userId, task.id),
      step = steps.find((s) => s.id === command.stepId);
    if (!step) throw new ApplicationError(404, 'NOT_FOUND', 'Step not found.');
    const bound = await bindings(client, actor.userId, task.id),
      binding = bound.find((b) => b.stepId === step.id);
    const past = (await attempts(client, actor.userId, task.id)).filter(
      (a) => a.stepId === step.id,
    );
    const saveStep = async (value: TaskStep) => {
      value.revision++;
      value.executionRevision++;
      value.updatedAt = now;
      await client.query('UPDATE task_steps SET revision=$3,value=$4 WHERE owner_id=$1 AND id=$2', [
        actor.userId,
        value.id,
        value.revision,
        value,
      ]);
      records.push({
        recordType: 'step',
        id: value.id,
        revision: value.revision,
        value,
        eventType: command.type,
      });
    };
    const saveParent = async () => {
      task = { ...task, revision: task.revision + 1, updatedAt: now, finalReviewSatisfied: false };
      await saveTask(client, actor.userId, task);
      await client.query(
        'INSERT INTO task_history(task_id,owner_id,actor_id,operation_id,event_type,revision,task,created_at,actor_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [
          task.id,
          actor.userId,
          actorId,
          command.operationId,
          'task.edit',
          task.revision,
          task,
          now,
          actor.actorType === 'agent' ? 'agent' : 'human',
        ],
      );
      records.push({
        recordType: 'task',
        id: task.id,
        revision: task.revision,
        value: task,
        eventType: command.type,
      });
    };
    const saveAttempt = async (a: AgentAttempt) => {
      a.revision++;
      a.updatedAt = now;
      await client.query('UPDATE agent_attempts SET value=$3 WHERE owner_id=$1 AND id=$2', [
        actor.userId,
        a.id,
        a,
      ]);
      await audit(a.id, a.revision, a);
    };
    const reopen = async () => {
      const affected = new Set([step.id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const s of steps)
          if (!affected.has(s.id) && s.content.dependencies.some((d) => affected.has(d))) {
            affected.add(s.id);
            grew = true;
          }
      }
      records.push(
        ...(await invalidateAgentResults(
          client,
          actor.userId,
          task.id,
          [...affected],
          'Instructions or a prerequisite result changed.',
        )),
      );
      for (const s of steps)
        if (affected.has(s.id) && s.status !== 'pending') {
          s.status = 'pending';
          await saveStep(s);
        }
      await saveParent();
    };
    const validateOutputs = async (artifacts: ArtifactReference[], useBinding: SkillBinding) => {
      await validateArtifactReferences(client, actor.userId, task.id, artifacts);
      for (const requirement of useBinding.requirements)
        if (
          requirement.required &&
          !artifacts.some((a) => a.key === requirement.key && a.kind === requirement.kind)
        )
          deny(
            'OUTPUT_REQUIRED',
            `Provide the required ${requirement.kind} result: ${requirement.key}.`,
          );
    };
    const makeResult = async (a: AgentAttempt, artifacts: ArtifactReference[], summary: string) => {
      await validateOutputs(artifacts, a.snapshot.binding);
      const version = Number(
        (
          await client.query(
            'SELECT COALESCE(MAX(version),0)+1 AS version FROM agent_results WHERE owner_id=$1 AND step_id=$2',
            [actor.userId, step.id],
          )
        ).rows[0].version,
      );
      const result: AgentResult = {
        id: randomUUID(),
        revision: 1,
        taskId: task.id,
        stepId: step.id,
        attemptId: a.id,
        version,
        artifacts,
        summary,
        approvedAt: null,
        approvedBy: null,
        feedback: null,
        createdAt: now,
      };
      await client.query(
        'INSERT INTO agent_results(id,owner_id,task_id,step_id,attempt_id,version,value) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [result.id, actor.userId, task.id, step.id, a.id, version, result],
      );
      await audit(result.id, result.revision, result);
      return result;
    };
    if (command.type === 'binding.put') {
      if (task.archivedAt || task.deletedAt || task.phase === 'completed')
        deny('PARENT_CLOSED', 'Reopen the task before changing its binding.');
      if (step.content.responsibility === 'human')
        deny('HUMAN_STEP_REQUIRED', 'A human step cannot have an agent binding.');
      checkRevision(binding?.revision ?? 0, command.expectedRevision);
      if (actor.actorType === 'agent' && binding?.requiresApproval && !command.requiresApproval)
        throw new ApplicationError(
          403,
          'HUMAN_REVIEW_POLICY',
          'Only a person may remove a required human review gate.',
        );
      const skill = (
        await client.query('SELECT value FROM agent_skills WHERE owner_id=$1 AND id=$2', [
          actor.userId,
          command.skillId,
        ])
      ).rows[0]?.value as SkillReference | undefined;
      const version = skill?.versions[command.skillVersion - 1];
      if (!version) deny('SKILL_VERSION_MISSING', 'Choose an existing skill version.');
      if (version.inputKeys.some((k) => !command.inputs[k]?.trim()))
        deny('INPUT_REQUIRED', 'Provide every required skill input.');
      if (new Set(command.requirements.map((r) => r.key)).size !== command.requirements.length)
        deny('DUPLICATE_KEY', 'Requirement keys must be unique.');
      for (const r of version.requirements)
        if (
          r.required &&
          !command.requirements.some((c) => c.key === r.key && c.kind === r.kind && c.required)
        )
          deny('OUTPUT_REQUIRED', 'The binding must retain required skill outputs.');
      const value: SkillBinding = {
        taskId: task.id,
        stepId: step.id,
        revision: (binding?.revision ?? 0) + 1,
        skillId: command.skillId,
        skillVersion: command.skillVersion,
        inputs: command.inputs,
        requirements: command.requirements,
        risk: command.risk,
        retryable: command.retryable,
        requiresApproval: command.requiresApproval,
      };
      for (const a of past)
        if (['running', 'cancel-requested', 'submitted'].includes(a.status)) {
          a.status = a.snapshot.binding.risk === 'external-effect' ? 'outcome-unknown' : 'yielded';
          a.error = 'Binding changed while work was running.';
          await saveAttempt(a);
        }
      await client.query(
        'INSERT INTO agent_bindings(step_id,owner_id,task_id,value) VALUES($1,$2,$3,$4) ON CONFLICT(step_id) DO UPDATE SET value=excluded.value WHERE agent_bindings.owner_id=excluded.owner_id',
        [step.id, actor.userId, task.id, value],
      );
      await reopen();
      await audit(step.id, value.revision, value);
      return { result: { binding: value, task }, records };
    }
    if (command.type === 'attempt.claim') {
      checkRevision(step.revision, command.expectedStepRevision);
      const ready = stepRollup(task, steps).entries.find((e) => e.step.id === step.id)!;
      const expired = past.some((a) => effective(a) === 'expired');
      if (
        !(ready.ready || (step.status === 'active' && expired && !ready.waitingReason)) ||
        step.content.responsibility === 'human'
      )
        deny('STEP_NOT_READY', 'This step is not released and ready for an agent.');
      if (!binding) deny('BINDING_REQUIRED', 'Select a skill and required inputs before claiming.');
      if (past.some((a) => blocking(a, step, binding)))
        deny(
          'ATTEMPT_BLOCKED',
          'An attempt is running, awaiting review, or has an unknown outcome.',
        );
      if (!binding.retryable && past.length)
        deny('RETRY_DISABLED', 'This binding does not allow another attempt.');
      const skill = (
        await client.query('SELECT value FROM agent_skills WHERE owner_id=$1 AND id=$2', [
          actor.userId,
          binding.skillId,
        ])
      ).rows[0]?.value as SkillReference;
      const a: AgentAttempt = {
        id: randomUUID(),
        taskId: task.id,
        stepId: step.id,
        revision: 1,
        actorId,
        status: 'running',
        expiresAt: new Date(Date.now() + leaseMs).toISOString(),
        createdAt: now,
        updatedAt: now,
        snapshot: {
          stepContent: step.content,
          stepRevision: step.revision,
          dependencyRevisions: Object.fromEntries(
            step.content.dependencies.map((id) => [
              id,
              steps.find((s) => s.id === id)!.executionRevision,
            ]),
          ),
          binding,
          skill: skill.versions[binding.skillVersion - 1]!,
        },
        progress: [],
        error: null,
        reconciliation: null,
      };
      await client.query(
        'INSERT INTO agent_attempts(id,owner_id,task_id,step_id,token_verifier,value) VALUES($1,$2,$3,$4,$5,$6)',
        [a.id, actor.userId, task.id, step.id, hash(command.ownershipToken), a],
      );
      step.status = 'active';
      await saveStep(step);
      task = await activateReleasedTask(client, actor.userId, task);
      await saveParent();
      await audit(a.id, a.revision, a);
      return { result: { attempt: a, task }, records };
    }
    if (command.type === 'result.approve' || command.type === 'result.request-changes') {
      human(actor);
      const latest = (
        await client.query(
          'SELECT value FROM agent_results WHERE owner_id=$1 AND step_id=$2 ORDER BY version DESC LIMIT 1',
          [actor.userId, step.id],
        )
      ).rows[0]?.value as AgentResult | undefined;
      if (!latest || latest.id !== command.resultId || latest.version !== command.expectedVersion)
        deny('RESULT_VERSION_CONFLICT', 'Review the current result version.');
      const a = past.find((x) => x.id === latest.attemptId)!;
      if (
        !binding ||
        a.snapshot.binding.revision !== binding.revision ||
        !isDeepStrictEqual(a.snapshot.stepContent, step.content) ||
        Object.entries(a.snapshot.dependencyRevisions ?? {}).some(
          ([id, revision]) => steps.find((s) => s.id === id)?.executionRevision !== revision,
        )
      )
        deny(
          'INSTRUCTIONS_CHANGED',
          'This result belongs to previous instructions. Request a current result.',
        );
      if (
        command.type === 'result.approve' &&
        latest.approvedAt &&
        !latest.feedback &&
        step.status === 'completed'
      )
        return { result: { result: latest, task }, records };
      if (
        task.archivedAt ||
        task.deletedAt ||
        task.phase === 'completed' ||
        task.phase === 'planned' ||
        task.paused
      )
        deny('STEP_NOT_READY', 'Release and resume this task before reviewing its result.');
      if (command.type === 'result.approve') {
        if (latest.feedback)
          deny('RESULT_REJECTED', 'A rejected version cannot be approved; submit a new version.');
        await validateOutputs(latest.artifacts, binding);
        if (stepRollup(task, steps).entries.find((e) => e.step.id === step.id)?.waitingReason)
          deny('STEP_NOT_READY', 'A prerequisite is no longer satisfied.');
        latest.approvedAt = now;
        latest.approvedBy = actorId;
        if (step.status !== 'completed') {
          step.status = 'completed';
          await saveStep(step);
        }
        await saveParent();
      } else {
        latest.approvedAt = null;
        latest.approvedBy = null;
        latest.feedback = command.feedback;
        a.status = 'yielded';
        a.error = command.feedback;
        await saveAttempt(a);
        await reopen();
      }
      latest.revision++;
      await client.query('UPDATE agent_results SET value=$3 WHERE owner_id=$1 AND id=$2', [
        actor.userId,
        latest.id,
        latest,
      ]);
      await audit(latest.id, latest.revision, latest);
      return { result: { result: latest, task }, records };
    }
    const entry = (
      await client.query(
        'SELECT value,token_verifier FROM agent_attempts WHERE owner_id=$1 AND id=$2 AND step_id=$3 AND task_id=$4',
        [actor.userId, command.attemptId, step.id, task.id],
      )
    ).rows[0];
    if (!entry) throw new ApplicationError(404, 'NOT_FOUND', 'Attempt not found.');
    const a = entry.value as AgentAttempt;
    if (command.type === 'attempt.cancel') {
      human(actor);
      if (!['running', 'cancel-requested'].includes(effective(a)))
        deny('ATTEMPT_NOT_RUNNING', 'This attempt is no longer running.');
      a.status = 'cancel-requested';
      a.error = command.reason;
      await saveAttempt(a);
      return { result: { attempt: a }, records };
    }
    if (command.type === 'attempt.reconcile') {
      human(actor);
      const state = effective(a);
      if (!['outcome-unknown', 'expired', 'cancel-requested', 'reconciled'].includes(state))
        deny('RECONCILIATION_NOT_REQUIRED', 'This attempt does not require reconciliation.');
      const permitsNewEffect = command.outcome === 'not-performed' || command.allowReplacement;
      if (
        permitsNewEffect &&
        ['running', 'cancel-requested'].includes(a.status) &&
        Date.parse(a.expiresAt) > Date.now()
      )
        deny(
          'WORKER_STILL_LIVE',
          'Wait for cooperative terminal acknowledgment before authorizing another attempt.',
        );
      if (
        permitsNewEffect &&
        a.snapshot.binding.risk === 'external-effect' &&
        !command.workerStoppedEvidence
      )
        deny(
          'WORKER_STOP_EVIDENCE_REQUIRED',
          'Provide separate evidence that the old worker stopped; absence at the destination is insufficient.',
        );
      const compatible =
        !!binding &&
        binding.revision === a.snapshot.binding.revision &&
        isDeepStrictEqual(a.snapshot.stepContent, step.content) &&
        Object.entries(a.snapshot.dependencyRevisions ?? {}).every(
          ([id, revision]) => steps.find((s) => s.id === id)?.executionRevision === revision,
        );
      let result: AgentResult | null = null;
      if (command.outcome === 'performed') {
        result = await makeResult(a, command.artifacts, command.evidence);
        if (!compatible || command.allowReplacement) {
          result.feedback =
            'Historical external effect retained. Current requirements remain unmet.';
          await client.query('UPDATE agent_results SET value=$3 WHERE owner_id=$1 AND id=$2', [
            actor.userId,
            result.id,
            result,
          ]);
          const record = records.find((r) => r.id === result!.id);
          if (record) record.value = result;
        }
      }
      a.status =
        command.outcome === 'performed' && compatible && !command.allowReplacement
          ? 'submitted'
          : 'reconciled';
      a.reconciliation = {
        outcome: command.outcome,
        evidence: command.evidence,
        actorId,
        at: now,
        workerStoppedEvidence: command.workerStoppedEvidence ?? null,
        replacementAuthorized: command.allowReplacement,
      };
      await saveAttempt(a);
      if (command.outcome === 'not-performed' || command.allowReplacement) {
        step.status = 'pending';
        await saveStep(step);
      } else if (compatible && !binding!.requiresApproval) {
        step.status = 'completed';
        await saveStep(step);
      }
      await saveParent();
      return { result: { attempt: a, result, task }, records };
    }
    if (
      a.actorId !== actorId ||
      !timingSafeEqual(
        Buffer.from(hash(command.ownershipToken), 'hex'),
        Buffer.from(entry.token_verifier, 'hex'),
      )
    )
      throw new ApplicationError(
        403,
        'ATTEMPT_OWNER_REQUIRED',
        'Only the current claim owner may report this attempt.',
      );
    if (!['running', 'cancel-requested'].includes(effective(a)))
      deny('ATTEMPT_EXPIRED', 'This claim expired or is no longer current.');
    if (
      !binding ||
      binding.revision !== a.snapshot.binding.revision ||
      !isDeepStrictEqual(a.snapshot.stepContent, step.content) ||
      Object.entries(a.snapshot.dependencyRevisions ?? {}).some(
        ([id, revision]) => steps.find((s) => s.id === id)?.executionRevision !== revision,
      )
    )
      deny(
        'INSTRUCTIONS_CHANGED',
        'Instructions changed; this attempt cannot overwrite current work.',
      );
    if (
      command.type === 'attempt.finish' &&
      (task.archivedAt ||
        task.deletedAt ||
        task.phase === 'completed' ||
        !step.content.dependencies.every((id) =>
          steps.some(
            (s) =>
              s.id === id &&
              (s.status === 'completed' || (!s.content.required && s.status === 'skipped')),
          ),
        ))
    )
      deny('STEP_NOT_READY', 'The parent or its prerequisites no longer permit completion.');
    if (command.type === 'attempt.heartbeat') {
      if (a.status === 'cancel-requested')
        deny(
          'CANCEL_REQUESTED',
          'A person requested stopping. Yield or reconcile the actual outcome.',
        );
      a.expiresAt = new Date(Date.now() + leaseMs).toISOString();
    }
    if (command.type === 'attempt.progress') {
      if (a.progress.length >= 1000)
        deny('PROGRESS_LIMIT', 'This attempt has reached its progress-record limit.');
      a.progress.push({ at: now, message: command.message });
    }
    let result: AgentResult | null = null;
    if (command.type === 'attempt.finish') {
      if (a.status === 'cancel-requested')
        deny(
          'CANCEL_REQUESTED',
          'Report the stopping or uncertain outcome before submitting completion.',
        );
      result = await makeResult(a, command.artifacts, command.summary);
      a.status = 'submitted';
      if (!binding.requiresApproval) {
        step.status = 'completed';
        await saveStep(step);
      }
    }
    if (command.type === 'attempt.fail' || command.type === 'attempt.yield') {
      a.status =
        command.outcome === 'unknown'
          ? 'outcome-unknown'
          : command.type === 'attempt.fail'
            ? 'failed'
            : 'yielded';
      a.error = command.message;
      if (command.outcome === 'stopped') {
        step.status = 'pending';
        await saveStep(step);
      }
    }
    await saveAttempt(a);
    await saveParent();
    return { result: { attempt: a, result, task }, records };
  });
}
