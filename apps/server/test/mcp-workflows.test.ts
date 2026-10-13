import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { AgentWorkflowCommand } from '@mems-life/domain';
import { createApp } from '../src/app.js';
import { migrate, bootstrapOwner } from '../src/database.js';
import { readConfig } from '../src/config.js';
import { requireOwner } from '../src/operations.js';
import { issueAgentGrant } from '../src/agent-grants.js';
import { executeTaskCommand } from '../src/tasks.js';
import { executeStepCommand } from '../src/steps.js';
import { executeAgentWorkflowCommand } from '../src/agent-workflows.js';
const databaseUrl =
  process.env.MCP_WORKFLOWS_TEST_DATABASE_URL ??
  'postgresql://mems_life@127.0.0.1:55432/mems_life_mcp_workflows_test';
if (new URL(databaseUrl).pathname !== '/mems_life_mcp_workflows_test')
  throw new Error('Use isolated mems_life_mcp_workflows_test database.');
test('real generic MCP clients race claims and replay lost responses without duplicate attempts or results', async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 5 });
  const config = readConfig({
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: 'fictional-workflow-mcp-test-secret-12345',
    BETTER_AUTH_URL: 'http://localhost:3001',
    WEB_ORIGIN: 'http://localhost:5173',
    NODE_ENV: 'test',
  });
  let app: Awaited<ReturnType<typeof createApp>>['app'] | undefined;
  const clients: Client[] = [];
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await migrate(pool, config);
    await bootstrapOwner(pool, config, {
      email: 'workflow-mcp@example.test',
      name: 'Workflow MCP Fixture',
      password: 'fictional-workflow-mcp-password-123',
    });
    const owner = await requireOwner(
      pool,
      (await pool.query('SELECT owner_id FROM installation')).rows[0].owner_id,
    );
    const auth = async () => {};
    let task = (
      await executeTaskCommand(
        pool,
        owner,
        {
          type: 'task.create',
          operationId: randomUUID(),
          taskId: randomUUID(),
          expectedRevision: 0,
          content: { title: 'Fictional delegated work', description: '', notes: '' },
        },
        auth,
      )
    ).task;
    const stepId = randomUUID();
    task = (
      await executeStepCommand(
        pool,
        owner,
        {
          type: 'step.create',
          operationId: randomUUID(),
          taskId: task.id,
          id: stepId,
          expectedRevision: 0,
          expectedTaskRevision: task.revision,
          content: {
            title: 'Fictional draft',
            instructions: 'Write a fictional sentence',
            responsibility: 'agent',
            required: true,
            dependencies: [],
            order: 0,
          },
        },
        auth,
      )
    ).task;
    const humanId = randomUUID();
    task = (
      await executeStepCommand(
        pool,
        owner,
        {
          type: 'step.create',
          operationId: randomUUID(),
          taskId: task.id,
          id: humanId,
          expectedRevision: 0,
          expectedTaskRevision: task.revision,
          content: {
            title: 'Required human review',
            instructions: 'A person reviews the result',
            responsibility: 'human',
            required: true,
            dependencies: [],
            order: 1,
          },
        },
        auth,
      )
    ).task;
    const skillId = randomUUID(),
      requirements = [{ key: 'draft', kind: 'text' as const, required: true }];
    await executeAgentWorkflowCommand(
      pool,
      owner,
      {
        type: 'skill.put',
        operationId: randomUUID(),
        id: skillId,
        expectedRevision: 0,
        content: {
          name: 'Fictional draft skill',
          instructions: 'Return fixture text',
          resources: [],
          inputKeys: [],
          requirements,
        },
      },
      auth,
    );
    const bound = await executeAgentWorkflowCommand(
      pool,
      owner,
      {
        type: 'binding.put',
        operationId: randomUUID(),
        taskId: task.id,
        stepId,
        expectedRevision: 0,
        skillId,
        skillVersion: 1,
        inputs: {},
        requirements,
        risk: 'none',
        retryable: true,
        requiresApproval: true,
      },
      auth,
    );
    task = bound.task!;
    task = (
      await executeTaskCommand(
        pool,
        owner,
        {
          type: 'task.move',
          operationId: randomUUID(),
          taskId: task.id,
          expectedRevision: task.revision,
          phase: 'next',
          beforeTaskId: null,
        },
        auth,
      )
    ).task;
    const grants = [];
    for (let i = 0; i < 2; i++)
      grants.push(
        await issueAgentGrant(
          pool,
          owner,
          {
            operationId: randomUUID(),
            label: `Fictional watcher ${i}`,
            scopes: ['tasks:read', 'tasks:write'],
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
          },
          auth,
        ),
      );
    ({ app } = await createApp(config, pool));
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    for (const grant of grants) {
      const client = new Client({ name: 'generic-race-fixture', version: '1.0' });
      clients.push(client);
      await client.connect(
        new StreamableHTTPClientTransport(new URL(address + '/mcp'), {
          requestInit: { headers: { Authorization: `Bearer ${grant.secret}` } },
        }),
      );
    }
    const run = async (client: Client, command: AgentWorkflowCommand) => {
      const response = await client.callTool({
        name: 'agent_workflow_command',
        arguments: command,
      });
      const content = response.content as { type: string; text: string }[];
      return { isError: response.isError, value: JSON.parse(content[0]!.text) };
    };
    const downgrade = await run(clients[0]!, {
      type: 'binding.put',
      operationId: randomUUID(),
      taskId: task.id,
      stepId,
      expectedRevision: 1,
      skillId,
      skillVersion: 1,
      inputs: {},
      requirements,
      risk: 'none',
      retryable: true,
      requiresApproval: false,
    });
    assert.equal(downgrade.isError, true);
    assert.equal(downgrade.value.code, 'HUMAN_REVIEW_POLICY');
    assert.equal(
      (await pool.query('SELECT value FROM agent_bindings WHERE step_id=$1', [stepId])).rows[0]
        .value.requiresApproval,
      true,
    );
    const toolAttack = async (name: string, argumentsValue: Record<string, unknown>) => {
      const result = await clients[0]!.callTool({ name, arguments: argumentsValue });
      return {
        isError: result.isError,
        value: JSON.parse((result.content as { text: string }[])[0]!.text),
      };
    };
    const human = (await pool.query('SELECT value FROM task_steps WHERE id=$1', [humanId])).rows[0]
      .value;
    for (const content of [
      { ...human.content, responsibility: 'agent' },
      { ...human.content, responsibility: 'either' },
      { ...human.content, required: false },
    ]) {
      const attack = await toolAttack('step_command', {
        type: 'step.edit',
        operationId: randomUUID(),
        taskId: task.id,
        id: humanId,
        expectedRevision: human.revision,
        expectedTaskRevision: task.revision,
        content,
      });
      assert.equal(attack.isError, true);
      assert.equal(attack.value.code, 'OWNER_REVIEW_REQUIRED');
    }
    const review = await toolAttack('task_command', {
      type: 'task.review',
      operationId: randomUUID(),
      taskId: task.id,
      expectedRevision: task.revision,
      required: false,
      satisfied: true,
    });
    assert.equal(review.isError, true);
    assert.equal(review.value.code, 'HUMAN_RELEASE_REQUIRED');
    assert.equal(
      (await pool.query('SELECT value FROM task_steps WHERE id=$1', [humanId])).rows[0].value
        .content.responsibility,
      'human',
    );
    const stepRevision = (await pool.query('SELECT revision FROM task_steps WHERE id=$1', [stepId]))
      .rows[0].revision;
    const claims = clients.map(() => ({
      type: 'attempt.claim' as const,
      operationId: randomUUID(),
      taskId: task.id,
      stepId,
      expectedStepRevision: stepRevision,
      ownershipToken: randomBytes(32).toString('base64url'),
    }));
    const raced = await Promise.all(clients.map((client, i) => run(client, claims[i]!)));
    assert.equal(raced.filter((result) => !result.isError).length, 1);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM agent_attempts')).rows[0].n, 1);
    const winner = raced.findIndex((result) => !result.isError),
      attempt = raced[winner]!.value.attempt;
    assert.equal(attempt.actorId, grants[winner]!.grant.id);
    assert.equal(attempt.snapshot.skill.instructions, 'Return fixture text');
    assert.deepEqual((await run(clients[winner]!, claims[winner]!)).value, raced[winner]!.value);
    const stolen = await run(clients[1 - winner]!, {
      type: 'attempt.heartbeat',
      operationId: randomUUID(),
      taskId: task.id,
      stepId,
      attemptId: attempt.id,
      ownershipToken: claims[winner]!.ownershipToken,
    });
    assert.equal(stolen.isError, true);
    assert.equal(stolen.value.code, 'ATTEMPT_OWNER_REQUIRED');
    const finish = {
      type: 'attempt.finish' as const,
      operationId: randomUUID(),
      taskId: task.id,
      stepId,
      attemptId: attempt.id,
      ownershipToken: claims[winner]!.ownershipToken,
      artifacts: [{ key: 'draft', kind: 'text' as const, text: 'Fictional finished draft.' }],
      summary: 'Fictional result',
    };
    const first = await run(clients[winner]!, finish);
    assert(!first.isError);
    // Simulate a response lost by the watcher followed by a retry after its original lease.
    await pool.query(
      "UPDATE agent_attempts SET value=jsonb_set(value,'{expiresAt}',to_jsonb($2::text)) WHERE id=$1",
      [attempt.id, new Date(Date.now() - 1000).toISOString()],
    );
    const replay = await run(clients[winner]!, finish);
    assert.deepEqual(replay, first);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM agent_results')).rows[0].n, 1);
    const claimReplay = await run(clients[winner]!, claims[winner]!);
    assert.deepEqual(claimReplay.value, raced[winner]!.value);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM agent_attempts')).rows[0].n, 1);
    const late = await run(clients[winner]!, { ...finish, operationId: randomUUID() });
    assert.equal(late.isError, true);
    assert.equal(late.value.code, 'ATTEMPT_EXPIRED');
    const result = first.value.result;
    const approve = await run(clients[winner]!, {
      type: 'result.approve',
      operationId: randomUUID(),
      taskId: task.id,
      stepId,
      resultId: result.id,
      expectedVersion: result.version,
    });
    assert.equal(approve.isError, true);
    assert.equal(approve.value.code, 'HUMAN_REQUIRED');
    const reconcile = await run(clients[winner]!, {
      type: 'attempt.reconcile',
      operationId: randomUUID(),
      taskId: task.id,
      stepId,
      attemptId: attempt.id,
      outcome: 'not-performed',
      evidence: 'Fictional review',
      artifacts: [],
    });
    assert.equal(reconcile.isError, true);
    assert.equal(reconcile.value.code, 'HUMAN_REQUIRED');
    const token = claims[winner]!.ownershipToken;
    for (const table of ['operation_receipts', 'audit_events', 'change_feed', 'agent_attempts'])
      assert.equal(
        (
          await pool.query(
            `SELECT count(*)::int AS n FROM ${table} r WHERE row_to_json(r)::text LIKE $1`,
            ['%' + token + '%'],
          )
        ).rows[0].n,
        0,
      );
  } finally {
    for (const client of clients) await client.close();
    if (app) await app.close();
    await pool.end();
  }
});
