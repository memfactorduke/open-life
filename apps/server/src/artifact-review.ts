import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import type { ArtifactReference, SkillBinding, AgentResult, AgentAttempt } from '@mems-life/domain';
import { ApplicationError } from './errors.js';
export async function isAgentBoundStep(
  client: PoolClient,
  ownerId: string,
  stepId: string,
): Promise<boolean> {
  return Boolean(
    (
      await client.query('SELECT 1 FROM agent_bindings WHERE owner_id=$1 AND step_id=$2', [
        ownerId,
        stepId,
      ])
    ).rowCount,
  );
}
export async function assertBoundStepTransition(
  client: PoolClient,
  ownerId: string,
  stepId: string,
  status: string,
) {
  if (
    ['active', 'completed'].includes(status) &&
    (
      await client.query('SELECT 1 FROM agent_bindings WHERE owner_id=$1 AND step_id=$2', [
        ownerId,
        stepId,
      ])
    ).rowCount
  )
    throw new ApplicationError(
      409,
      'AGENT_REVIEW_REQUIRED',
      'Claim bound work and approve its current result through the workflow operations.',
    );
}
export async function assertAgentParentComplete(
  client: PoolClient,
  ownerId: string,
  taskId: string,
) {
  const rows = await client.query(
    `SELECT s.value AS step,b.value AS binding,r.value AS result,a.value AS attempt FROM task_steps s JOIN agent_bindings b ON b.step_id=s.id AND b.owner_id=s.owner_id LEFT JOIN LATERAL (SELECT value,attempt_id FROM agent_results WHERE owner_id=s.owner_id AND step_id=s.id ORDER BY version DESC LIMIT 1) r ON true LEFT JOIN agent_attempts a ON a.id=r.attempt_id WHERE s.owner_id=$1 AND s.task_id=$2 AND s.deleted_at IS NULL AND (s.value->'content'->>'required')::boolean`,
    [ownerId, taskId],
  );
  const steps = (
    await client.query(
      'SELECT value FROM task_steps WHERE owner_id=$1 AND task_id=$2 AND deleted_at IS NULL',
      [ownerId, taskId],
    )
  ).rows.map((row) => row.value as { id: string; executionRevision: number });
  for (const row of rows.rows) {
    const result = row.result as AgentResult | null,
      attempt = row.attempt as AgentAttempt | null,
      binding = row.binding as SkillBinding;
    if (
      !result ||
      (binding.requiresApproval && !result.approvedAt) ||
      result.feedback ||
      !attempt ||
      attempt.snapshot.binding.revision !== binding.revision ||
      !isDeepStrictEqual(attempt.snapshot.stepContent, row.step.content) ||
      Object.entries(attempt.snapshot.dependencyRevisions ?? {}).some(
        ([id, revision]) => steps.find((s) => s.id === id)?.executionRevision !== revision,
      )
    )
      throw new ApplicationError(
        409,
        'AGENT_REVIEW_REQUIRED',
        'Approve the current version of every required agent result before completing this task.',
      );
  }
}
export async function validateArtifactReferences(
  client: PoolClient,
  ownerId: string,
  taskId: string,
  artifacts: ArtifactReference[],
) {
  if (new Set(artifacts.map((a) => a.key)).size !== artifacts.length)
    throw new ApplicationError(400, 'DUPLICATE_OUTPUT', 'Result keys must be unique.');
  for (const artifact of artifacts)
    if (artifact.kind === 'file') {
      // The task-file owner installs this table; fail closed until bounded storage is available.
      if (
        !(await client.query("SELECT to_regclass('public.task_files') AS table_name")).rows[0]
          ?.table_name
      )
        throw new ApplicationError(
          409,
          'FILE_STORAGE_UNAVAILABLE',
          'Private task-file storage is not configured.',
        );
      const file = await client.query(
        "SELECT 1 FROM task_files WHERE id=$1 AND owner_id=$2 AND task_id=$3 AND status='finalized' AND detached_at IS NULL",
        [artifact.fileId, ownerId, taskId],
      );
      if (!file.rowCount)
        throw new ApplicationError(
          409,
          'ARTIFACT_NOT_FINALIZED',
          'This artifact must reference a finalized private file belonging to this task.',
        );
    }
}

/** Reopen current readiness while retaining prior execution and external-effect evidence. */
export async function invalidateAgentResults(
  client: PoolClient,
  ownerId: string,
  taskId: string,
  stepIds: string[],
  reason: string,
): Promise<import('./feature-migrations.js').ChangedRecord[]> {
  const records: import('./feature-migrations.js').ChangedRecord[] = [];
  if (!stepIds.length) return records;
  const now = new Date().toISOString();
  const attemptRows = await client.query(
    'SELECT value FROM agent_attempts WHERE owner_id=$1 AND task_id=$2 AND step_id=ANY($3::uuid[])',
    [ownerId, taskId, stepIds],
  );
  for (const row of attemptRows.rows) {
    const a = row.value as AgentAttempt;
    if (!['running', 'cancel-requested', 'submitted'].includes(a.status)) continue;
    a.status = a.snapshot.binding.risk === 'external-effect' ? 'outcome-unknown' : 'yielded';
    a.error = reason;
    a.revision++;
    a.updatedAt = now;
    await client.query('UPDATE agent_attempts SET value=$3 WHERE owner_id=$1 AND id=$2', [
      ownerId,
      a.id,
      a,
    ]);
    records.push({
      recordType: 'attempt',
      id: a.id,
      revision: a.revision,
      value: a,
      eventType: 'attempt.prerequisite.changed',
    });
  }
  const resultRows = await client.query(
    'SELECT value FROM agent_results WHERE owner_id=$1 AND task_id=$2 AND step_id=ANY($3::uuid[])',
    [ownerId, taskId, stepIds],
  );
  for (const row of resultRows.rows) {
    const r = row.value as AgentResult;
    if (r.feedback) continue;
    r.approvedAt = null;
    r.approvedBy = null;
    r.feedback = reason;
    r.revision++;
    await client.query('UPDATE agent_results SET value=$3 WHERE owner_id=$1 AND id=$2', [
      ownerId,
      r.id,
      r,
    ]);
    records.push({
      recordType: 'result',
      id: r.id,
      revision: r.revision,
      value: r,
      eventType: 'result.prerequisite.changed',
    });
  }
  return records;
}
