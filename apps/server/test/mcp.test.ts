import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { AgentScope, Exercise } from '@mems-life/domain';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { migrate, bootstrapOwner } from '../src/database.js';
import { migrateMcp } from '../src/mcp-migrations.js';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { requireOwner } from '../src/operations.js';
import { issueAgentGrant, revokeAgentGrant, authenticateAgent } from '../src/agent-grants.js';
const databaseUrl =
  process.env.MCP_TEST_DATABASE_URL ?? 'postgresql://mems_life@127.0.0.1:55432/mems_life_mcp_test';
if (new URL(databaseUrl).pathname !== '/mems_life_mcp_test')
  throw new Error('MCP tests require isolated mems_life_mcp_test database.');
test('real Streamable HTTP client, scoped grants, shared PostgreSQL records, attribution, retries and immediate revocation', async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const config = readConfig({
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: 'fictional-mcp-test-secret-minimum-length',
    BETTER_AUTH_URL: 'http://localhost:3001',
    WEB_ORIGIN: 'http://localhost:5173',
    NODE_ENV: 'test',
  });
  let app: Awaited<ReturnType<typeof createApp>>['app'] | undefined;
  const clients: Client[] = [];
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await migrate(pool, config);
    await migrateMcp(pool);
    await migrateMcp(pool);
    await bootstrapOwner(pool, config, {
      email: 'mcp-fixture@example.test',
      name: 'MCP Fixture',
      password: 'fictional-mcp-password-123',
    });
    const owner = await requireOwner(
      pool,
      (await pool.query('SELECT owner_id FROM installation')).rows[0].owner_id,
    );
    const createGrant = (scopes: AgentScope[]) =>
      issueAgentGrant(
        pool,
        owner,
        {
          operationId: randomUUID(),
          label: 'Fictional client',
          scopes,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
        async () => {},
      );
    const write = await createGrant([
      'tasks:read',
      'tasks:write',
      'food:read',
      'food:write',
      'workouts:read',
      'workouts:plan',
      'workouts:record',
    ]);
    const read = await createGrant(['tasks:read']);
    ({ app } = await createApp(config, pool));
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    async function connect(secret: string) {
      const client = new Client({ name: 'generic-header-test', version: '1.0' });
      clients.push(client);
      await client.connect(
        new StreamableHTTPClientTransport(new URL(address + '/mcp'), {
          requestInit: { headers: { Authorization: `Bearer ${secret}` } },
        }),
      );
      return client;
    }
    const writer = await connect(write.secret),
      reader = await connect(read.secret);
    const listed = await reader.listTools();
    assert(listed.tools.some((t) => t.name === 'task_read'));
    assert(!listed.tools.some((t) => t.name === 'task_command'));
    const taskId = randomUUID(),
      command = {
        type: 'task.create',
        operationId: randomUUID(),
        taskId,
        expectedRevision: 0,
        content: { title: 'Fictional MCP task', description: 'Shared record', notes: '' },
      };
    const result = await writer.callTool({ name: 'task_command', arguments: command });
    assert(!result.isError);
    assert.deepEqual(
      JSON.parse(
        (await writer.callTool({ name: 'task_command', arguments: command })).content[0].text,
      ),
      JSON.parse(result.content[0].text),
    );
    assert.equal(
      (await pool.query('SELECT content FROM tasks WHERE id=$1', [taskId])).rows[0].content.title,
      command.content.title,
    );
    const history = (
      await pool.query('SELECT actor_id,actor_type FROM task_history WHERE task_id=$1', [taskId])
    ).rows[0];
    assert.equal(history.actor_id, write.grant.id);
    assert.equal(history.actor_type, 'agent');
    const forbidden = await reader.callTool({ name: 'task_command', arguments: command });
    assert.equal(forbidden.isError, true);
    const stale = await writer.callTool({
      name: 'task_command',
      arguments: {
        type: 'task.edit',
        operationId: randomUUID(),
        taskId,
        expectedRevision: 0,
        content: command.content,
      },
    });
    assert.equal(stale.isError, true);
    assert(JSON.stringify(stale).includes('REVISION_CONFLICT'));
    const source = {
        kind: 'reported',
        reference: 'Fictional fixture report',
        reportedAt: new Date().toISOString(),
      },
      foodCommand = {
        type: 'food.create',
        operationId: randomUUID(),
        entryId: randomUUID(),
        expectedRevision: 0,
        content: { text: 'Fictional lunch', occurredAt: new Date().toISOString(), timezone: 'UTC' },
      };
    const missing = await writer.callTool({
      name: 'food_command',
      arguments: { command: foodCommand },
    });
    assert.equal(missing.isError, true);
    const food = await writer.callTool({
      name: 'food_command',
      arguments: { command: foodCommand, source },
    });
    assert(!food.isError);
    assert.deepEqual(
      JSON.parse(
        (
          await writer.callTool({
            name: 'food_command',
            arguments: { command: foodCommand, source },
          })
        ).content[0].text,
      ),
      JSON.parse(food.content[0].text),
    );
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM food_entries')).rows[0].n, 1);
    assert.equal(
      (
        await pool.query('SELECT actor_id FROM audit_events WHERE operation_id=$1', [
          foodCommand.operationId,
        ])
      ).rows[0].actor_id,
      write.grant.id,
    );
    const parsed = (response: { content: { text: string }[] }) =>
      JSON.parse(response.content[0].text);
    const exercises = parsed(
      await writer.callTool({ name: 'exercises_list', arguments: {} }),
    ).exercises;
    const exercise = exercises.find((e: Exercise) => e.mode === 'weighted');
    const routineId = randomUUID(),
      itemId = randomUUID();
    const routineCommand = {
      type: 'routine.create',
      operationId: randomUUID(),
      routineId,
      expectedRevision: 0,
      content: {
        name: 'Fictional routine',
        notes: 'Prepared, not performed',
        items: [
          {
            id: itemId,
            exerciseId: exercise.id,
            snapshot: {
              name: exercise.name,
              mode: exercise.mode,
              supportsLoad: exercise.supportsLoad,
            },
            targets: [
              {
                id: randomUUID(),
                kind: 'working',
                measurements: { mode: 'weighted', reps: 8, loadKg: 30 },
                notes: '',
              },
            ],
            notes: '',
          },
        ],
      },
    };
    const routine = await writer.callTool({ name: 'routine_command', arguments: routineCommand });
    assert(!routine.isError);
    assert.equal(
      (await pool.query('SELECT count(*)::int AS n FROM workout_sessions')).rows[0].n,
      0,
    );
    const sessionId = randomUUID(),
      start = {
        type: 'session.start',
        operationId: randomUUID(),
        sessionId,
        expectedRevision: 0,
        name: 'Fictional actual session',
        routineId,
        expectedRoutineRevision: 1,
      };
    const started = await writer.callTool({
      name: 'session_command',
      arguments: { command: start, source },
    });
    assert(!started.isError);
    const session = parsed(started).session;
    assert.equal(session.items[0].results.length, 0);
    const set = {
      type: 'session.record-set',
      operationId: randomUUID(),
      sessionId,
      expectedRevision: 1,
      itemId: session.items[0].id,
      setId: randomUUID(),
      kind: 'working',
      measurements: { mode: 'weighted', reps: 6, loadKg: 25 },
      notes: 'Fictional reported set',
      round: null,
    };
    const recorded = await writer.callTool({
      name: 'session_command',
      arguments: { command: set, source },
    });
    assert(!recorded.isError);
    assert.equal(parsed(recorded).session.items[0].results[0].measurements.reps, 6);
    const actualHistory = (
      await pool.query(
        'SELECT actor_id,actor_type FROM workout_session_history WHERE session_id=$1 ORDER BY revision DESC LIMIT 1',
        [sessionId],
      )
    ).rows[0];
    assert.equal(actualHistory.actor_id, write.grant.id);
    assert.equal(actualHistory.actor_type, 'agent');
    const staleSet = await writer.callTool({
      name: 'session_command',
      arguments: {
        command: {
          ...set,
          operationId: randomUUID(),
          type: 'session.correct-set',
          reason: 'Fictional correction',
        },
        source,
      },
    });
    assert.equal(staleSet.isError, true);
    assert(JSON.stringify(staleSet).includes('REVISION_CONFLICT'));
    await assert.rejects(
      issueAgentGrant(
        pool,
        owner,
        {
          operationId: (
            await pool.query('SELECT issue_operation_id FROM agent_grants WHERE id=$1', [
              write.grant.id,
            ])
          ).rows[0].issue_operation_id,
          label: 'retry',
          scopes: ['tasks:read'],
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
        async () => {},
      ),
      /cannot be retrieved/,
    );
    const badOrigin = await fetch(address + '/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${read.secret}`,
        Origin: 'https://untrusted.example.test',
      },
      body: '{}',
    });
    assert.equal(badOrigin.status, 403);
    const ownerOnly = await fetch(address + '/api/agent-grants', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${read.secret}`,
        Origin: config.WEB_ORIGIN,
      },
      body: JSON.stringify({
        operationId: randomUUID(),
        label: 'unauthorized',
        scopes: ['tasks:read'],
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      }),
    });
    assert.equal(ownerOnly.status, 401);
    const foreignId = randomUUID();
    await pool.query(
      'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,false,now(),now())',
      ['fictional-other-owner', 'Other fixture', 'other-mcp@example.test'],
    );
    await pool.query(
      "INSERT INTO tasks(id,owner_id,revision,phase,content,sort_order,created_at,updated_at) VALUES($1,$2,1,'planned',$3,0,now(),now())",
      [foreignId, 'fictional-other-owner', command.content],
    );
    const foreign = await writer.callTool({ name: 'task_read', arguments: { id: foreignId } });
    assert.equal(foreign.isError, true);
    assert(JSON.stringify(foreign).includes('NOT_FOUND'));
    await revokeAgentGrant(pool, owner, write.grant.id, randomUUID(), async () => {});
    await assert.rejects(writer.callTool({ name: 'task_read', arguments: { id: taskId } }));
    await assert.rejects(authenticateAgent(pool, `Bearer ${write.secret}`));
    await pool.query(
      "UPDATE agent_grants SET expires_at=now()-interval '1 second',created_at=now()-interval '2 seconds' WHERE id=$1",
      [read.grant.id],
    );
    await assert.rejects(reader.listTools());
    const unauthorized = await fetch(address + '/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(unauthorized.status, 401);
    const invalid = await fetch(address + '/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer bogus' },
      body: '{}',
    });
    assert.equal(invalid.status, 401);
    const safe = (
      await pool.query('SELECT verifier FROM agent_grants WHERE id=$1', [write.grant.id])
    ).rows[0].verifier;
    assert(!safe.includes(write.secret));
    assert.equal(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM operation_receipts WHERE response::text LIKE $1',
          ['%' + write.secret + '%'],
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
