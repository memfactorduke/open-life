import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import {
  AgentWorkflowCommandResponseSchema,
  AgentWorkflowResponseSchema,
  EligibleAgentStepsSchema,
  type AgentWorkflowCommand,
  type Task,
  type TaskStep,
} from '@mems-life/domain';
import { migrate, bootstrapOwner } from '../src/database.js';
import { readConfig } from '../src/config.js';
import { requireOwner } from '../src/operations.js';
import { executeTaskCommand } from '../src/tasks.js';
import { executeStepCommand, readSteps } from '../src/steps.js';
import {
  executeAgentWorkflowCommand,
  listEligibleAgentSteps,
  readAgentWorkflow,
} from '../src/agent-workflows.js';
import { assertAgentParentComplete } from '../src/artifact-review.js';
const databaseUrl =
  process.env.AGENT_WORKFLOW_TEST_DATABASE_URL ??
  'postgresql://mems_life@127.0.0.1:55432/mems_life_agent_workflows_test';
if (new URL(databaseUrl).pathname !== '/mems_life_agent_workflows_test')
  throw new Error('Workflow tests require isolated mems_life_agent_workflows_test.');
const config = readConfig({
  DATABASE_URL: databaseUrl,
  BETTER_AUTH_SECRET: 'fictional-workflow-secret-minimum-length',
  BETTER_AUTH_URL: 'http://localhost:3001',
  WEB_ORIGIN: 'http://localhost:5173',
  NODE_ENV: 'test',
});
const token = () => randomBytes(32).toString('base64url');
for (const mode of ['rejected edit', 'lost upload'] as const)
  test(`real PostgreSQL YouTube workflow: ${mode}`, async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 5 });
    try {
      await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
      await migrate(pool, config);
      await bootstrapOwner(pool, config, {
        email: 'workflow@example.test',
        name: 'Workflow Fixture',
        password: 'fictional-password-1234',
      });
      const actor = await requireOwner(
          pool,
          (await pool.query('SELECT owner_id FROM installation')).rows[0].owner_id,
        ),
        auth = async () => {};
      const invoke = (v: Omit<AgentWorkflowCommand, 'operationId'> | Record<string, unknown>) =>
        executeAgentWorkflowCommand(
          pool,
          actor,
          { operationId: randomUUID(), ...v } as AgentWorkflowCommand,
          auth,
        );
      async function task(): Promise<Task> {
        return (
          await executeTaskCommand(
            pool,
            actor,
            {
              type: 'task.create',
              taskId: randomUUID(),
              expectedRevision: 0,
              operationId: randomUUID(),
              content: { title: 'Fictional YouTube production', description: '', notes: '' },
            },
            auth,
          )
        ).task;
      }
      async function addStep(
        parent: Task,
        title: string,
        responsibility: 'human' | 'agent' | 'either',
        dependencies: string[] = [],
      ): Promise<{ task: Task; step: TaskStep }> {
        return executeStepCommand(
          pool,
          actor,
          {
            type: 'step.create',
            taskId: parent.id,
            id: randomUUID(),
            expectedRevision: 0,
            expectedTaskRevision: parent.revision,
            operationId: randomUUID(),
            content: {
              title,
              instructions: 'Use fictional artifacts only',
              responsibility,
              dependencies,
              required: true,
              order: (await readSteps(pool, actor.userId, parent.id)).length,
            },
          },
          auth,
        );
      }
      const skillId = randomUUID();
      const skillContent = {
        name: 'Fictional script procedure',
        instructions: 'Write a script from supplied brief.',
        resources: [],
        inputKeys: ['brief'],
        requirements: [{ key: 'deliverable', kind: 'text' as const, required: true }],
      };
      await invoke({ type: 'skill.put', id: skillId, expectedRevision: 0, content: skillContent });
      let parent = await task();
      let created = await addStep(parent, 'Script', 'agent');
      parent = created.task;
      const script = created.step;
      created = await addStep(parent, 'Record', 'human', [script.id]);
      parent = created.task;
      const recording = created.step;
      created = await addStep(parent, 'Edit', 'agent', [recording.id]);
      parent = created.task;
      const edit = created.step;
      created = await addStep(parent, 'Review edit', 'human', [edit.id]);
      parent = created.task;
      const review = created.step;
      created = await addStep(parent, 'Private upload', 'either', [review.id]);
      parent = created.task;
      const upload = created.step;
      created = await addStep(parent, 'Thumbnail', 'agent', [script.id]);
      parent = created.task;
      const thumbnail = created.step;
      created = await addStep(parent, 'Approve and attach thumbnail', 'human', [
        thumbnail.id,
        upload.id,
      ]);
      parent = created.task;
      const attachment = created.step;
      created = await addStep(parent, 'Publish', 'human', [attachment.id, upload.id]);
      parent = created.task;
      const publish = created.step;
      for (const step of [script, edit, thumbnail, upload])
        await invoke({
          type: 'binding.put',
          taskId: parent.id,
          stepId: step.id,
          expectedRevision: 0,
          skillId,
          skillVersion: 1,
          inputs: { brief: 'Fictional educational video' },
          requirements: skillContent.requirements,
          risk: step.id === upload.id ? 'external-effect' : 'none',
          retryable: true,
          requiresApproval: true,
        });
      assert.equal(
        (await listEligibleAgentSteps(pool, actor)).eligible.length,
        0,
        'Planned work dormant',
      );
      parent = (await readAgentWorkflow(pool, actor, parent.id)).task;
      parent = (
        await executeTaskCommand(
          pool,
          actor,
          {
            type: 'task.move',
            taskId: parent.id,
            expectedRevision: parent.revision,
            operationId: randomUUID(),
            phase: 'next',
            beforeTaskId: null,
          },
          auth,
        )
      ).task;
      const scriptCurrent = (await readSteps(pool, actor.userId, parent.id)).find(
        (s) => s.id === script.id,
      )!;
      const ownershipToken = token();
      const claims = await Promise.allSettled([
        invoke({
          type: 'attempt.claim',
          taskId: parent.id,
          stepId: script.id,
          expectedStepRevision: scriptCurrent.revision,
          ownershipToken,
        }),
        invoke({
          type: 'attempt.claim',
          taskId: parent.id,
          stepId: script.id,
          expectedStepRevision: scriptCurrent.revision,
          ownershipToken: token(),
        }),
      ]);
      assert.equal(claims.filter((v) => v.status === 'fulfilled').length, 1);
      const claim = claims.find((v) => v.status === 'fulfilled')!;
      assert.equal(claim.status, 'fulfilled');
      if (claim.status !== 'fulfilled') throw new Error('No winner');
      const attempt = claim.value.attempt!;
      assert.equal(claim.value.task!.phase, 'active');
      await invoke({
        type: 'skill.put',
        id: skillId,
        expectedRevision: 1,
        content: { ...skillContent, instructions: 'Revised skill instructions' },
      });
      assert.equal(
        (await readAgentWorkflow(pool, actor, parent.id)).attempts[0]!.snapshot.skill.instructions,
        skillContent.instructions,
      );
      const owned = { taskId: parent.id, stepId: script.id, attemptId: attempt.id, ownershipToken };
      await invoke({ ...owned, type: 'attempt.heartbeat' });
      await invoke({ ...owned, type: 'attempt.progress', message: 'Fictional script drafted' });
      await assert.rejects(
        invoke({
          ...owned,
          type: 'attempt.finish',
          artifacts: [{ key: 'wrong', kind: 'text', text: 'wrong' }],
          summary: 'Invalid deliverable',
        }),
        /required text result/,
      );
      const finishCommand: AgentWorkflowCommand = {
        ...owned,
        type: 'attempt.finish',
        operationId: randomUUID(),
        artifacts: [{ key: 'deliverable', kind: 'text', text: 'Fictional script v1' }],
        summary: 'Saved script',
      };
      const finished = await executeAgentWorkflowCommand(pool, actor, finishCommand, auth);
      await pool.query(
        "UPDATE agent_attempts SET value=jsonb_set(value,'{expiresAt}',to_jsonb('2000-01-01T00:00:00.000Z'::text)) WHERE id=$1",
        [attempt.id],
      );
      assert.deepEqual(
        await executeAgentWorkflowCommand(pool, actor, finishCommand, auth),
        finished,
        'lost completion response replay succeeds after expiry',
      );
      await assert.rejects(
        invoke({ ...owned, type: 'attempt.progress', message: 'Late progress' }),
        /expired/,
      );
      const receipts = (await pool.query('SELECT request,response FROM operation_receipts')).rows;
      assert.equal(
        JSON.stringify(receipts).includes(ownershipToken),
        false,
        'raw ownership token is never persisted',
      );
      let workflow = await readAgentWorkflow(pool, actor, parent.id);
      assert.equal(
        workflow.steps.find((s) => s.id === script.id)!.status,
        'active',
        'view/finish is not approval',
      );
      const scriptResult = finished.result!;
      await invoke({
        type: 'result.approve',
        taskId: parent.id,
        stepId: script.id,
        resultId: scriptResult.id,
        expectedVersion: scriptResult.version,
      });
      assert.deepEqual(
        (await listEligibleAgentSteps(pool, actor)).eligible.map((v) => v.step.id),
        [thumbnail.id],
      );
      async function completeHuman(stepId: string) {
        const w = await readAgentWorkflow(pool, actor, parent.id),
          s = w.steps.find((v) => v.id === stepId)!;
        await executeStepCommand(
          pool,
          actor,
          {
            type: 'step.status',
            taskId: parent.id,
            id: stepId,
            status: 'completed',
            expectedRevision: s.revision,
            expectedTaskRevision: w.task.revision,
            operationId: randomUUID(),
          },
          auth,
        );
      }
      async function run(stepId: string, text: string) {
        const w = await readAgentWorkflow(pool, actor, parent.id),
          s = w.steps.find((v) => v.id === stepId)!,
          secret = token();
        const c = await invoke({
          type: 'attempt.claim',
          taskId: parent.id,
          stepId,
          expectedStepRevision: s.revision,
          ownershipToken: secret,
        });
        const f = await invoke({
          type: 'attempt.finish',
          taskId: parent.id,
          stepId,
          attemptId: c.attempt!.id,
          ownershipToken: secret,
          artifacts: [{ key: 'deliverable', kind: 'text', text }],
          summary: text,
        });
        return f.result!;
      }
      await assert.rejects(
        completeHuman(edit.id),
        /workflow operations/,
        'manual completion cannot bypass agent requirements',
      );
      await completeHuman(recording.id);
      assert.ok(
        (await listEligibleAgentSteps(pool, actor)).eligible.some((v) => v.step.id === edit.id),
        'human handoff releases editing',
      );
      if (mode === 'rejected edit') {
        const firstEdit = await run(edit.id, 'Edit candidate v1');
        await invoke({
          type: 'result.request-changes',
          taskId: parent.id,
          stepId: edit.id,
          resultId: firstEdit.id,
          expectedVersion: 1,
          feedback: 'Shorten introduction',
        });
        await assert.rejects(
          invoke({
            type: 'result.approve',
            taskId: parent.id,
            stepId: edit.id,
            resultId: firstEdit.id,
            expectedVersion: 1,
          }),
          /rejected version/,
        );
        const secondEdit = await run(edit.id, 'Edit candidate v2');
        assert.equal(secondEdit.version, 2);
        await assert.rejects(
          invoke({
            type: 'result.approve',
            taskId: parent.id,
            stepId: edit.id,
            resultId: firstEdit.id,
            expectedVersion: 1,
          }),
          /current result version/,
        );
        await invoke({
          type: 'result.approve',
          taskId: parent.id,
          stepId: edit.id,
          resultId: secondEdit.id,
          expectedVersion: 2,
        });
      } else {
        const result = await run(edit.id, 'Edit candidate accepted');
        await invoke({
          type: 'result.approve',
          taskId: parent.id,
          stepId: edit.id,
          resultId: result.id,
          expectedVersion: 1,
        });
      }
      await completeHuman(review.id);
      const thumbResult = await run(thumbnail.id, 'Thumbnail candidate');
      await invoke({
        type: 'result.approve',
        taskId: parent.id,
        stepId: thumbnail.id,
        resultId: thumbResult.id,
        expectedVersion: 1,
      });
      workflow = await readAgentWorkflow(pool, actor, parent.id);
      if (mode === 'lost upload') {
        const uploadToken = token();
        const uploadedClaim = await invoke({
          type: 'attempt.claim',
          taskId: parent.id,
          stepId: upload.id,
          expectedStepRevision: workflow.steps.find((s) => s.id === upload.id)!.revision,
          ownershipToken: uploadToken,
        });
        await invoke({
          type: 'attempt.cancel',
          taskId: parent.id,
          stepId: upload.id,
          attemptId: uploadedClaim.attempt!.id,
          reason: 'Stop and check private destination',
        });
        await assert.rejects(
          invoke({
            type: 'attempt.heartbeat',
            taskId: parent.id,
            stepId: upload.id,
            attemptId: uploadedClaim.attempt!.id,
            ownershipToken: uploadToken,
          }),
          /requested stopping/,
        );
        await pool.query(
          "UPDATE agent_attempts SET value=jsonb_set(value,'{expiresAt}',to_jsonb('2000-01-01T00:00:00.000Z'::text)) WHERE id=$1",
          [uploadedClaim.attempt!.id],
        );
        assert.equal(
          (await readAgentWorkflow(pool, actor, parent.id)).attempts.find(
            (a) => a.id === uploadedClaim.attempt!.id,
          )!.effectiveStatus,
          'outcome-unknown',
        );
        assert.equal(
          (await listEligibleAgentSteps(pool, actor)).eligible.some((v) => v.step.id === upload.id),
          false,
          'expiry does not authorize duplicate upload',
        );
        await assert.rejects(
          invoke({
            type: 'attempt.finish',
            taskId: parent.id,
            stepId: upload.id,
            attemptId: uploadedClaim.attempt!.id,
            ownershipToken: uploadToken,
            artifacts: [{ key: 'deliverable', kind: 'text', text: 'late upload' }],
            summary: 'late',
          }),
          /expired/,
        );
        const reconciliation = await invoke({
          type: 'attempt.reconcile',
          taskId: parent.id,
          stepId: upload.id,
          attemptId: uploadedClaim.attempt!.id,
          outcome: 'performed',
          evidence: 'Verified fictional private destination fixture-upload-1',
          artifacts: [
            { key: 'deliverable', kind: 'text', text: 'private destination fixture-upload-1' },
          ],
        });
        await invoke({
          type: 'result.approve',
          taskId: parent.id,
          stepId: upload.id,
          resultId: reconciliation.result!.id,
          expectedVersion: 1,
        });
      } else {
        const result = await run(
          upload.id,
          'Verified fictional private destination fixture-upload-1',
        );
        await invoke({
          type: 'result.approve',
          taskId: parent.id,
          stepId: upload.id,
          resultId: result.id,
          expectedVersion: 1,
        });
      }
      await completeHuman(attachment.id);
      await completeHuman(publish.id);
      const client = await pool.connect();
      try {
        await assertAgentParentComplete(client, actor.userId, parent.id);
      } finally {
        client.release();
      }
      workflow = await readAgentWorkflow(pool, actor, parent.id);
      await executeTaskCommand(
        pool,
        actor,
        {
          type: 'task.complete',
          taskId: parent.id,
          expectedRevision: workflow.task.revision,
          operationId: randomUUID(),
        },
        auth,
      );
      assert.equal(
        (await pool.query('SELECT COUNT(*) FROM agent_attempts WHERE step_id=$1', [upload.id]))
          .rows[0].count,
        '1',
      );
      const history = (
        await pool.query(
          "SELECT COUNT(*) FROM audit_events WHERE event_type='step.status' AND value->>'id'=$1 AND value->>'status'='completed'",
          [publish.id],
        )
      ).rows[0].count;
      assert.equal(history, '1', 'one verified human publication fixture event');
      assert.ok(
        (await pool.query("SELECT 1 FROM change_feed WHERE record_type='attempt'")).rowCount,
        'attempts reach committed feed',
      );
      const restarted = new Pool({ connectionString: databaseUrl });
      try {
        assert.equal(
          (await readAgentWorkflow(restarted, actor, parent.id)).results.length,
          mode === 'rejected edit' ? 5 : 4,
        );
      } finally {
        await restarted.end();
      }
    } finally {
      await pool.end();
    }
  });

test('external recovery requires stopped-worker evidence and explicit replacement; no-review outputs continue automatically', async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await migrate(pool, config);
    await bootstrapOwner(pool, config, {
      email: 'recovery@example.test',
      name: 'Recovery Fixture',
      password: 'fictional-password-1234',
    });
    const actor = await requireOwner(
        pool,
        (await pool.query('SELECT owner_id FROM installation')).rows[0].owner_id,
      ),
      auth = async () => {};
    const invoke = (input: Record<string, unknown>) =>
      executeAgentWorkflowCommand(
        pool,
        actor,
        { operationId: randomUUID(), ...input } as AgentWorkflowCommand,
        auth,
      );
    let parent = (
      await executeTaskCommand(
        pool,
        actor,
        {
          type: 'task.create',
          taskId: randomUUID(),
          expectedRevision: 0,
          operationId: randomUUID(),
          content: { title: 'Fictional private effect', description: '', notes: '' },
        },
        auth,
      )
    ).task;
    const created = await executeStepCommand(
      pool,
      actor,
      {
        type: 'step.create',
        taskId: parent.id,
        id: randomUUID(),
        expectedRevision: 0,
        expectedTaskRevision: parent.revision,
        operationId: randomUUID(),
        content: {
          title: 'Private effect',
          instructions: 'Produce fictional destination v1',
          responsibility: 'agent',
          required: true,
          dependencies: [],
          order: 0,
        },
      },
      auth,
    );
    const stepId = created.step.id,
      skillId = randomUUID();
    parent = created.task;
    await invoke({
      type: 'skill.put',
      id: skillId,
      expectedRevision: 0,
      content: {
        name: 'Private effect procedure',
        instructions: 'Use fictional destination only.',
        resources: [],
        inputKeys: [],
        requirements: [{ key: 'destination', kind: 'text', required: true }],
      },
    });
    await invoke({
      type: 'binding.put',
      taskId: parent.id,
      stepId,
      expectedRevision: 0,
      skillId,
      skillVersion: 1,
      inputs: {},
      requirements: [{ key: 'destination', kind: 'text', required: true }],
      risk: 'external-effect',
      retryable: true,
      requiresApproval: false,
    });
    parent = (await readAgentWorkflow(pool, actor, parent.id)).task;
    parent = (
      await executeTaskCommand(
        pool,
        actor,
        {
          type: 'task.move',
          taskId: parent.id,
          expectedRevision: parent.revision,
          operationId: randomUUID(),
          phase: 'next',
          beforeTaskId: null,
        },
        auth,
      )
    ).task;
    parent = (
      await executeTaskCommand(
        pool,
        actor,
        {
          type: 'task.pause',
          taskId: parent.id,
          expectedRevision: parent.revision,
          operationId: randomUUID(),
          paused: true,
        },
        auth,
      )
    ).task;
    const current = (await readSteps(pool, actor.userId, parent.id))[0]!;
    await assert.rejects(
      invoke({
        type: 'attempt.claim',
        taskId: parent.id,
        stepId,
        expectedStepRevision: current.revision,
        ownershipToken: token(),
      }),
      /not released and ready/,
    );
    parent = (
      await executeTaskCommand(
        pool,
        actor,
        {
          type: 'task.pause',
          taskId: parent.id,
          expectedRevision: parent.revision,
          operationId: randomUUID(),
          paused: false,
        },
        auth,
      )
    ).task;
    const secret = token();
    const claim = await invoke({
      type: 'attempt.claim',
      taskId: parent.id,
      stepId,
      expectedStepRevision: current.revision,
      ownershipToken: secret,
    });
    const attemptId = claim.attempt!.id;
    await invoke({
      type: 'attempt.cancel',
      taskId: parent.id,
      stepId,
      attemptId,
      reason: 'Check before replacing',
    });
    await assert.rejects(
      invoke({
        type: 'attempt.reconcile',
        taskId: parent.id,
        stepId,
        attemptId,
        outcome: 'not-performed',
        evidence: 'Destination empty',
        artifacts: [],
        workerStoppedEvidence: 'Owner says stopped',
      }),
      /cooperative terminal acknowledgment/,
    );
    await pool.query(
      "UPDATE agent_attempts SET value=jsonb_set(value,'{expiresAt}',to_jsonb('2000-01-01T00:00:00.000Z'::text)) WHERE id=$1",
      [attemptId],
    );
    await assert.rejects(
      invoke({
        type: 'attempt.reconcile',
        taskId: parent.id,
        stepId,
        attemptId,
        outcome: 'not-performed',
        evidence: 'Destination empty',
        artifacts: [],
      }),
      /separate evidence/,
    );
    let resolved = await invoke({
      type: 'attempt.reconcile',
      taskId: parent.id,
      stepId,
      attemptId,
      outcome: 'performed',
      evidence: 'Verified fictional destination v1',
      artifacts: [{ key: 'destination', kind: 'text', text: 'fixture-v1' }],
    });
    assert.equal(
      (await readSteps(pool, actor.userId, parent.id))[0]!.status,
      'completed',
      'no-review reconciliation automatically completes',
    );
    assert.equal(resolved.result!.approvedAt, null, 'no human approval invented');
    let w = await readAgentWorkflow(pool, actor, parent.id),
      step = w.steps[0]!;
    await executeStepCommand(
      pool,
      actor,
      {
        type: 'step.edit',
        taskId: parent.id,
        id: stepId,
        expectedRevision: step.revision,
        expectedTaskRevision: w.task.revision,
        operationId: randomUUID(),
        content: { ...step.content, instructions: 'Produce fictional destination v2' },
      },
      auth,
    );
    assert.equal((await readSteps(pool, actor.userId, parent.id))[0]!.status, 'pending');
    resolved = await invoke({
      type: 'attempt.reconcile',
      taskId: parent.id,
      stepId,
      attemptId,
      outcome: 'performed',
      evidence: 'Old destination v1 exists, newer instructions unmet',
      artifacts: [{ key: 'destination', kind: 'text', text: 'fixture-v1' }],
    });
    assert.ok(resolved.result!.feedback?.includes('Current requirements remain unmet'));
    assert.equal(
      (await listEligibleAgentSteps(pool, actor)).eligible.length,
      0,
      'known performed effect blocks replacement by default',
    );
    w = await readAgentWorkflow(pool, actor, parent.id);
    step = w.steps[0]!;
    await assert.rejects(
      invoke({
        type: 'attempt.claim',
        taskId: parent.id,
        stepId,
        expectedStepRevision: step.revision,
        ownershipToken: token(),
      }),
      /unknown outcome/,
    );
    await assert.rejects(
      invoke({
        type: 'attempt.reconcile',
        taskId: parent.id,
        stepId,
        attemptId,
        outcome: 'performed',
        evidence: 'Replace existing destination',
        allowReplacement: true,
        artifacts: [{ key: 'destination', kind: 'text', text: 'fixture-v1' }],
      }),
      /separate evidence/,
    );
    await invoke({
      type: 'attempt.reconcile',
      taskId: parent.id,
      stepId,
      attemptId,
      outcome: 'performed',
      evidence: 'Explicitly authorize replacement of verified v1 with v2',
      workerStoppedEvidence: 'Worker process terminated and verified no outstanding upload job',
      allowReplacement: true,
      artifacts: [{ key: 'destination', kind: 'text', text: 'fixture-v1' }],
    });
    assert.equal((await listEligibleAgentSteps(pool, actor)).eligible.length, 1);
    w = await readAgentWorkflow(pool, actor, parent.id);
    step = w.steps[0]!;
    const nextToken = token();
    const next = await invoke({
      type: 'attempt.claim',
      taskId: parent.id,
      stepId,
      expectedStepRevision: step.revision,
      ownershipToken: nextToken,
    });
    await assert.rejects(
      invoke({
        type: 'attempt.finish',
        taskId: parent.id,
        stepId,
        attemptId,
        ownershipToken: secret,
        summary: 'Old late worker',
        artifacts: [{ key: 'destination', kind: 'text', text: 'late-v1' }],
      }),
      /expired/,
    );
    const finish = {
      type: 'attempt.finish',
      taskId: parent.id,
      stepId,
      attemptId: next.attempt!.id,
      ownershipToken: nextToken,
      summary: 'Current fictional destination v2',
      artifacts: [{ key: 'destination', kind: 'text', text: 'fixture-v2' }],
    };
    const done = await invoke(finish);
    assert.equal(done.result!.approvedAt, null);
    assert.equal((await readSteps(pool, actor.userId, parent.id))[0]!.status, 'completed');
    const client = await pool.connect();
    try {
      await assertAgentParentComplete(client, actor.userId, parent.id);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
});

test('editable YouTube template is atomic and dormant; duplicate approval and assignment preserve running dependency semantics', async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await migrate(pool, config);
    await bootstrapOwner(pool, config, {
      email: 'template@example.test',
      name: 'Template Fixture',
      password: 'fictional-password-1234',
    });
    const actor = await requireOwner(
        pool,
        (await pool.query('SELECT owner_id FROM installation')).rows[0].owner_id,
      ),
      auth = async () => {};
    const invoke = async (input: Record<string, unknown>) => {
      const response = await executeAgentWorkflowCommand(
        pool,
        actor,
        { operationId: randomUUID(), ...input } as AgentWorkflowCommand,
        auth,
      );
      AgentWorkflowCommandResponseSchema.parse(response);
      return response;
    };
    const create: AgentWorkflowCommand = {
      type: 'workflow.youtube-create',
      operationId: randomUUID(),
      taskId: randomUUID(),
    };
    const seeded = await executeAgentWorkflowCommand(pool, actor, create, auth);
    assert.deepEqual(await executeAgentWorkflowCommand(pool, actor, create, auth), seeded);
    let w = AgentWorkflowResponseSchema.parse(await readAgentWorkflow(pool, actor, create.taskId));
    assert.equal(w.task.phase, 'planned');
    assert.equal(w.steps.length, 8);
    assert.equal(w.skills.length, 4);
    assert.equal(w.bindings.length, 4);
    assert.equal(
      EligibleAgentStepsSchema.parse(await listEligibleAgentSteps(pool, actor)).eligible.length,
      0,
    );
    await executeTaskCommand(
      pool,
      actor,
      {
        type: 'task.move',
        operationId: randomUUID(),
        taskId: w.task.id,
        expectedRevision: w.task.revision,
        phase: 'next',
        beforeTaskId: null,
      },
      auth,
    );
    w = AgentWorkflowResponseSchema.parse(await readAgentWorkflow(pool, actor, create.taskId));
    const script = w.steps.find((s) => s.content.title === 'Write script')!,
      thumbnail = w.steps.find((s) => s.content.title === 'Draft thumbnail')!;
    const scriptToken = token(),
      scriptClaim = await invoke({
        type: 'attempt.claim',
        taskId: w.task.id,
        stepId: script.id,
        expectedStepRevision: script.revision,
        ownershipToken: scriptToken,
      });
    const scriptFinish = await invoke({
      type: 'attempt.finish',
      taskId: w.task.id,
      stepId: script.id,
      attemptId: scriptClaim.attempt!.id,
      ownershipToken: scriptToken,
      summary: 'Script fixture',
      artifacts: [{ key: 'deliverable', kind: 'text', text: 'Fictional script' }],
    });
    const thumbToken = token(),
      thumbClaim = await invoke({
        type: 'attempt.claim',
        taskId: w.task.id,
        stepId: thumbnail.id,
        expectedStepRevision: thumbnail.revision,
        ownershipToken: thumbToken,
      });
    w = AgentWorkflowResponseSchema.parse(await readAgentWorkflow(pool, actor, create.taskId));
    const currentScript = w.steps.find((s) => s.id === script.id)!;
    await executeStepCommand(
      pool,
      actor,
      {
        type: 'step.assign',
        operationId: randomUUID(),
        taskId: w.task.id,
        id: script.id,
        expectedRevision: currentScript.revision,
        expectedTaskRevision: w.task.revision,
        assignedTo: 'Fictional reviewer',
      },
      auth,
    );
    assert.equal(
      (await readSteps(pool, actor.userId, w.task.id)).find((s) => s.id === script.id)!
        .executionRevision,
      currentScript.executionRevision,
    );
    const approved = await invoke({
      type: 'result.approve',
      taskId: w.task.id,
      stepId: script.id,
      resultId: scriptFinish.result!.id,
      expectedVersion: 1,
    });
    w = AgentWorkflowResponseSchema.parse(await readAgentWorkflow(pool, actor, create.taskId));
    const before = w.steps.find((s) => s.id === script.id)!;
    const approval: AgentWorkflowCommand = {
      type: 'result.approve',
      operationId: randomUUID(),
      taskId: w.task.id,
      stepId: script.id,
      resultId: scriptFinish.result!.id,
      expectedVersion: 1,
    };
    const duplicate = await executeAgentWorkflowCommand(pool, actor, approval, auth);
    assert.equal(
      duplicate.result!.revision,
      approved.result!.revision,
      'already approved latest version is a no-op',
    );
    const after = (await readSteps(pool, actor.userId, w.task.id)).find((s) => s.id === script.id)!;
    assert.equal(after.revision, before.revision);
    assert.equal(after.executionRevision, before.executionRevision);
    await assert.rejects(
      executeAgentWorkflowCommand(pool, actor, approval, async () => {
        throw new Error('Live authorization revoked');
      }),
      /authorization revoked/,
      'cached receipt never bypasses live authorization',
    );
    const thumbFinish = await invoke({
      type: 'attempt.finish',
      taskId: w.task.id,
      stepId: thumbnail.id,
      attemptId: thumbClaim.attempt!.id,
      ownershipToken: thumbToken,
      summary: 'Thumbnail fixture',
      artifacts: [{ key: 'deliverable', kind: 'text', text: 'Fictional thumbnail' }],
    });
    await invoke({
      type: 'result.approve',
      taskId: w.task.id,
      stepId: thumbnail.id,
      resultId: thumbFinish.result!.id,
      expectedVersion: 1,
    });
    await invoke({
      type: 'result.request-changes',
      taskId: w.task.id,
      stepId: script.id,
      resultId: scriptFinish.result!.id,
      expectedVersion: 1,
      feedback: 'Revise script before continuing',
    });
    w = AgentWorkflowResponseSchema.parse(await readAgentWorkflow(pool, actor, create.taskId));
    assert.equal(
      w.steps.find((s) => s.id === thumbnail.id)!.status,
      'pending',
      'upstream revision reopens completed descendant readiness',
    );
    assert.equal(
      w.results.find((r) => r.id === thumbFinish.result!.id)!.approvedAt,
      null,
      'old downstream approval invalidated',
    );
    assert.ok(w.results.find((r) => r.id === thumbFinish.result!.id)!.feedback);
    await assert.rejects(
      invoke({
        type: 'result.approve',
        taskId: w.task.id,
        stepId: thumbnail.id,
        resultId: thumbFinish.result!.id,
        expectedVersion: 1,
      }),
      /previous instructions/,
    );
    const client = await pool.connect();
    try {
      await assert.rejects(
        assertAgentParentComplete(client, actor.userId, w.task.id),
        /current version/,
      );
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
});
