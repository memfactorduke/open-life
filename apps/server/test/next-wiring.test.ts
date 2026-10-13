import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { migrate, bootstrapOwner } from '../src/database.js';
import { requireOwner } from '../src/operations.js';
import { issueAgentGrant } from '../src/agent-grants.js';

test('shared app integrates workflow migration and scoped WHOOP MCP reads', async () => {
  const databaseUrl =
    process.env.NEXT_WIRING_TEST_DATABASE_URL ??
    'postgresql://mems_life@127.0.0.1:55432/mems_life_next_wiring_test';
  assert.equal(new URL(databaseUrl).pathname, '/mems_life_next_wiring_test');
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const config = readConfig({
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: 'fictional-next-wiring-test-secret-minimum-length',
    BETTER_AUTH_URL: 'http://localhost:3001',
    WEB_ORIGIN: 'http://localhost:5173',
    MEDIA_DIRECTORY: '.runtime/next-wiring-test-media',
    NODE_ENV: 'test',
  });
  let service: Awaited<ReturnType<typeof createApp>> | undefined;
  const clients: Client[] = [];
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await migrate(pool, config);
    await migrate(pool, config);
    assert.deepEqual(
      (await pool.query('SELECT version FROM application_migrations ORDER BY version')).rows.map(
        (row) => row.version,
      ),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('agent_skills','agent_bindings','agent_attempts','agent_results')",
        )
      ).rows[0].n,
      4,
    );
    await bootstrapOwner(pool, config, {
      email: 'next-wiring-owner@example.test',
      name: 'Next Wiring Fixture',
      password: 'fictional-next-wiring-password-123',
    });
    const owner = await requireOwner(
      pool,
      (await pool.query('SELECT owner_id FROM installation')).rows[0].owner_id,
    );
    const issue = (scopes: ('tasks:read' | 'tasks:write' | 'whoop:read')[]) =>
      issueAgentGrant(
        pool,
        owner,
        {
          operationId: randomUUID(),
          label: 'Fictional integration client',
          scopes,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
        async () => {},
      );
    const whoop = await issue(['whoop:read']);
    const tasks = await issue(['tasks:read']);
    const taskWrites = await issue(['tasks:read', 'tasks:write']);
    service = await createApp(config, pool);
    const address = await service.app.listen({ host: '127.0.0.1', port: 0 });
    async function connect(secret: string) {
      const client = new Client({ name: 'next-wiring-generic-client', version: '1.0' });
      clients.push(client);
      await client.connect(
        new StreamableHTTPClientTransport(new URL(address + '/mcp'), {
          requestInit: { headers: { Authorization: `Bearer ${secret}` } },
        }),
      );
      return client;
    }
    const providerReader = await connect(whoop.secret);
    const taskReader = await connect(tasks.secret);
    const taskWriter = await connect(taskWrites.secret);
    assert(
      (await providerReader.listTools()).tools.some((tool) => tool.name === 'whoop_observations'),
    );
    assert(
      !(await taskReader.listTools()).tools.some((tool) => tool.name === 'whoop_observations'),
    );
    const response = await providerReader.callTool({ name: 'whoop_observations', arguments: {} });
    assert(!response.isError);
    const serialized = JSON.stringify(response);
    assert(!serialized.includes('tokens'));
    assert(!serialized.includes('pending_state'));
    assert(!serialized.includes(whoop.secret));
    assert.equal(
      (await taskReader.callTool({ name: 'whoop_observations', arguments: {} })).isError,
      true,
    );
    assert(
      (await taskReader.listTools()).tools.some((tool) => tool.name === 'agent_steps_eligible'),
    );
    assert.equal(
      (await service.app.inject({ method: 'GET', url: '/api/agent-workflows/skills' })).statusCode,
      401,
    );
    const login = await service.app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: config.WEB_ORIGIN },
      payload: {
        email: 'next-wiring-owner@example.test',
        password: 'fictional-next-wiring-password-123',
      },
    });
    assert.equal(login.statusCode, 200);
    const headers = {
      origin: config.WEB_ORIGIN,
      cookie: login.cookies.map((item) => `${item.name}=${item.value}`).join('; '),
    };
    async function command(url: string, payload: Record<string, unknown>, expected = 200) {
      const response = await service!.app.inject({
        method: 'POST',
        url,
        headers,
        payload: { operationId: randomUUID(), ...payload },
      });
      assert.equal(response.statusCode, expected, response.body);
      return response.json();
    }
    const taskId = randomUUID(),
      stepId = randomUUID(),
      skillId = randomUUID();
    let task = (
      await command('/api/tasks/commands', {
        type: 'task.create',
        taskId,
        expectedRevision: 0,
        content: { title: 'Fictional bound workflow', description: '', notes: '' },
      })
    ).task;
    const stepContent = {
      title: 'Draft fixture',
      instructions: 'Write fictional text.',
      responsibility: 'agent',
      required: true,
      dependencies: [],
      order: 0,
    };
    task = (
      await command('/api/steps/commands', {
        type: 'step.create',
        taskId,
        id: stepId,
        expectedRevision: 0,
        expectedTaskRevision: task.revision,
        content: stepContent,
      })
    ).task;
    const requirements = [{ key: 'draft', kind: 'text', required: true }];
    await command('/api/agent-workflows/commands', {
      type: 'skill.put',
      id: skillId,
      expectedRevision: 0,
      content: {
        name: 'Fictional drafting',
        instructions: 'Return fixture text.',
        resources: [],
        inputKeys: [],
        requirements,
      },
    });
    task = (
      await command('/api/agent-workflows/commands', {
        type: 'binding.put',
        taskId,
        stepId,
        expectedRevision: 0,
        skillId,
        skillVersion: 1,
        inputs: {},
        requirements,
        risk: 'none',
        retryable: true,
        requiresApproval: true,
      })
    ).task;
    task = (
      await command('/api/tasks/commands', {
        type: 'task.move',
        taskId,
        expectedRevision: task.revision,
        phase: 'next',
        beforeTaskId: null,
      })
    ).task;
    async function currentStep() {
      return (await pool.query('SELECT value FROM task_steps WHERE id=$1', [stepId])).rows[0].value;
    }
    for (const status of ['active', 'completed']) {
      const blocked = await command(
        '/api/steps/commands',
        {
          type: 'step.status',
          taskId,
          id: stepId,
          expectedRevision: (await currentStep()).revision,
          expectedTaskRevision: task.revision,
          status,
        },
        409,
      );
      assert.equal(blocked.error.code, 'AGENT_REVIEW_REQUIRED');
    }
    const ownershipToken = randomBytes(32).toString('base64url');
    const claim = await command('/api/agent-workflows/commands', {
      type: 'attempt.claim',
      taskId,
      stepId,
      expectedStepRevision: (await currentStep()).revision,
      ownershipToken,
    });
    task = claim.task;
    const finish = await command('/api/agent-workflows/commands', {
      type: 'attempt.finish',
      taskId,
      stepId,
      attemptId: claim.attempt.id,
      ownershipToken,
      artifacts: [{ key: 'draft', kind: 'text', text: 'Fictional output.' }],
      summary: 'Draft ready for review.',
    });
    task = finish.task;
    assert.equal(
      (
        await command(
          '/api/tasks/commands',
          { type: 'task.complete', taskId, expectedRevision: task.revision },
          409,
        )
      ).error.code,
      'AGENT_REVIEW_REQUIRED',
    );
    task = (
      await command('/api/agent-workflows/commands', {
        type: 'result.approve',
        taskId,
        stepId,
        resultId: finish.result.id,
        expectedVersion: finish.result.version,
      })
    ).task;
    task = (
      await command('/api/steps/commands', {
        type: 'step.edit',
        taskId,
        id: stepId,
        expectedRevision: (await currentStep()).revision,
        expectedTaskRevision: task.revision,
        content: { ...stepContent, instructions: 'Changed current instructions.' },
      })
    ).task;
    assert.equal((await currentStep()).status, 'pending');
    const humanStepId = randomUUID();
    task = (
      await command('/api/steps/commands', {
        type: 'step.create',
        taskId,
        id: humanStepId,
        expectedRevision: 0,
        expectedTaskRevision: task.revision,
        content: {
          ...stepContent,
          title: 'Human publication approval',
          responsibility: 'human',
          order: 1,
        },
      })
    ).task;
    for (const edit of [
      {
        id: humanStepId,
        expectedRevision: 1,
        content: {
          ...stepContent,
          title: 'Human publication approval',
          responsibility: 'either',
          order: 1,
        },
      },
      {
        id: stepId,
        expectedRevision: (await currentStep()).revision,
        content: { ...stepContent, instructions: 'Changed current instructions.', required: false },
      },
    ]) {
      const denied = await taskWriter.callTool({
        name: 'step_command',
        arguments: {
          type: 'step.edit',
          operationId: randomUUID(),
          taskId,
          expectedTaskRevision: task.revision,
          ...edit,
        },
      });
      assert(denied.isError);
      assert(JSON.stringify(denied).includes('OWNER_REVIEW_REQUIRED'));
    }
    const deniedReview = await taskWriter.callTool({
      name: 'task_command',
      arguments: {
        type: 'task.review',
        operationId: randomUUID(),
        taskId,
        expectedRevision: task.revision,
        required: false,
        satisfied: true,
      },
    });
    assert(deniedReview.isError);
    assert(JSON.stringify(deniedReview).includes('HUMAN_RELEASE_REQUIRED'));
    assert.equal(
      (
        await command(
          '/api/tasks/commands',
          { type: 'task.complete', taskId, expectedRevision: task.revision },
          409,
        )
      ).error.code,
      'AGENT_REVIEW_REQUIRED',
    );
    const feed = (
      await pool.query(
        "SELECT record_type FROM change_feed WHERE record_type IN ('skill','binding','attempt','result')",
      )
    ).rows.map((row) => row.record_type);
    for (const kind of ['skill', 'binding', 'attempt', 'result']) assert(feed.includes(kind));
    const snapshot = await service.app.inject({
      method: 'POST',
      url: '/api/sync/snapshots',
      headers,
      payload: { requestId: randomUUID(), schemaVersion: 1 },
    });
    assert.equal(snapshot.statusCode, 200, snapshot.body);
    const oldEpoch = snapshot.json().epoch,
      restoredEpoch = randomUUID();
    assert.equal(typeof oldEpoch, 'string');
    await pool.query('UPDATE installation SET epoch=$1', [restoredEpoch]);
    const operationId = randomUUID();
    const receiptCount = (await pool.query('SELECT count(*)::int AS n FROM operation_receipts'))
      .rows[0].n;
    const feedPosition = (await pool.query('SELECT feed_position FROM installation')).rows[0]
      .feed_position;
    const staleEpoch = await service.app.inject({
      method: 'POST',
      url: '/api/tasks/commands',
      headers: { ...headers, 'x-mems-life-epoch': oldEpoch },
      payload: {
        type: 'task.edit',
        operationId,
        taskId,
        expectedRevision: task.revision,
        content: { title: 'Old epoch must not overwrite', description: '', notes: '' },
      },
    });
    assert.equal(staleEpoch.statusCode, 409, staleEpoch.body);
    assert.equal(staleEpoch.json().error.code, 'SYNC_EPOCH_CHANGED');
    assert.equal(staleEpoch.json().error.details.epoch, restoredEpoch);
    assert.equal(
      (await pool.query('SELECT count(*)::int AS n FROM operation_receipts')).rows[0].n,
      receiptCount,
    );
    assert.equal(
      (await pool.query('SELECT feed_position FROM installation')).rows[0].feed_position,
      feedPosition,
    );
    assert.equal(
      (await pool.query('SELECT content FROM tasks WHERE id=$1', [taskId])).rows[0].content.title,
      'Fictional bound workflow',
    );
  } finally {
    for (const client of clients) await client.close();
    await service?.app.close();
    await pool.end();
  }
});
