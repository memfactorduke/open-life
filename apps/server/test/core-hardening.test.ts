import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { migrate, bootstrapOwner } from '../src/database.js';
import { readConfig } from '../src/config.js';
import { requireOwner } from '../src/operations.js';
import { executeTaskCommand } from '../src/tasks.js';
import { executeBoardCommand } from '../src/organization.js';
import { executeStepCommand } from '../src/steps.js';
import {
  executeAgentWorkflowCommand,
  readAgentWorkflow,
  listEligibleAgentSteps,
} from '../src/agent-workflows.js';
import { authenticateAgent, issueAgentGrant } from '../src/agent-grants.js';
const databaseUrl =
  process.env.RC_CORE_TEST_DATABASE_URL ??
  'postgresql://mems_life@127.0.0.1:55432/mems_life_rc_core';
if (new URL(databaseUrl).pathname !== '/mems_life_rc_core')
  throw new Error('Core hardening tests require isolated mems_life_rc_core.');
const config = readConfig({
  DATABASE_URL: databaseUrl,
  BETTER_AUTH_SECRET: 'fictional-core-hardening-secret-minimum-length',
  NODE_ENV: 'test',
});
test('malformed UUID-shaped agent credentials are rejected before database access', async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await assert.rejects(
      authenticateAgent(pool, `Bearer ml_${'-'.repeat(36)}.${'A'.repeat(43)}`),
      (error: unknown) => {
        assert.equal((error as { code: string }).code, 'AGENT_UNAUTHENTICATED');
        return true;
      },
    );
  } finally {
    await pool.end();
  }
});
test('human execution and agent claim activate their parent into its configured Active column', async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await migrate(pool, config);
    await bootstrapOwner(pool, config, {
      email: 'core@example.test',
      name: 'Core Fixture',
      password: 'fictional-password-1234',
    });
    const actor = await requireOwner(
      pool,
      (await pool.query('SELECT owner_id FROM installation')).rows[0].owner_id,
    );
    const auth = async () => {};
    const reservedId = randomUUID();
    const grantInput = {
      operationId: reservedId,
      label: 'Fixture grant',
      scopes: ['tasks:read'],
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    };
    await issueAgentGrant(pool, actor, grantInput, auth);
    await assert.rejects(
      executeTaskCommand(
        pool,
        actor,
        {
          type: 'task.create',
          operationId: reservedId,
          taskId: randomUUID(),
          expectedRevision: 0,
          content: { title: 'Reused grant ID', description: '', notes: '' },
        },
        auth,
      ),
      (error: unknown) => (error as { code: string }).code === 'OPERATION_ID_REUSED',
    );
    const taskOperationId = randomUUID();
    await executeTaskCommand(
      pool,
      actor,
      {
        type: 'task.create',
        operationId: taskOperationId,
        taskId: randomUUID(),
        expectedRevision: 0,
        content: { title: 'Original task', description: '', notes: '' },
      },
      auth,
    );
    await assert.rejects(
      issueAgentGrant(pool, actor, { ...grantInput, operationId: taskOperationId }, auth),
      (error: unknown) => (error as { code: string }).code === 'OPERATION_ID_REUSED',
    );
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM agent_grants')).rows[0].n, 1);

    const boardId = randomUUID(),
      planned = randomUUID(),
      next = randomUUID(),
      active = randomUUID();
    await executeBoardCommand(
      pool,
      actor,
      {
        type: 'board.create',
        operationId: randomUUID(),
        id: boardId,
        expectedRevision: 0,
        content: {
          name: 'Fixture board',
          columns: [
            { id: planned, name: 'Planned', phase: 'planned' },
            { id: next, name: 'Next', phase: 'next' },
            { id: active, name: 'Active', phase: 'active' },
          ],
        },
      },
      auth,
    );
    for (const responsibility of ['human', 'agent'] as const) {
      let task = (
        await executeTaskCommand(
          pool,
          actor,
          {
            type: 'task.create',
            operationId: randomUUID(),
            taskId: randomUUID(),
            expectedRevision: 0,
            content: { title: `Fixture ${responsibility}`, description: '', notes: '' },
          },
          auth,
        )
      ).task;
      task = (
        await executeTaskCommand(
          pool,
          actor,
          {
            type: 'task.organize',
            operationId: randomUUID(),
            taskId: task.id,
            expectedRevision: task.revision,
            organization: { ...task.organization, boardId, columnId: planned },
          },
          auth,
        )
      ).task;
      const created = await executeStepCommand(
        pool,
        actor,
        {
          type: 'step.create',
          operationId: randomUUID(),
          taskId: task.id,
          id: randomUUID(),
          expectedRevision: 0,
          expectedTaskRevision: task.revision,
          content: {
            title: 'Fixture step',
            instructions: '',
            responsibility,
            required: true,
            order: 0,
            dependencies: [],
          },
        },
        auth,
      );
      task = created.task;
      const step = created.step!;
      if (responsibility === 'agent') {
        const skillId = randomUUID();
        await executeAgentWorkflowCommand(
          pool,
          actor,
          {
            type: 'skill.put',
            operationId: randomUUID(),
            id: skillId,
            expectedRevision: 0,
            content: {
              name: 'Fixture skill',
              instructions: 'Use fixtures',
              inputKeys: [],
              requirements: [{ key: 'output', kind: 'text', required: true }],
              resources: [],
            },
          },
          auth,
        );
        await executeAgentWorkflowCommand(
          pool,
          actor,
          {
            type: 'binding.put',
            operationId: randomUUID(),
            taskId: task.id,
            stepId: step.id,
            expectedRevision: 0,
            skillId,
            skillVersion: 1,
            inputs: {},
            requirements: [{ key: 'output', kind: 'text', required: true }],
            risk: 'none',
            retryable: true,
            requiresApproval: false,
          },
          auth,
        );
        task = (await readAgentWorkflow(pool, actor, task.id)).task;
      }
      task = (
        await executeTaskCommand(
          pool,
          actor,
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
      if (responsibility === 'agent') {
        await pool.query(
          "INSERT INTO tasks(id,owner_id,revision,phase,content,sort_order,created_at,updated_at) SELECT gen_random_uuid(),$1,1,'next',$2,n,now(),now() FROM generate_series(0,100) n",
          [actor.userId, { title: 'Fictional blocked queue entry', description: '', notes: '' }],
        );
        await pool.query('UPDATE tasks SET sort_order=101 WHERE id=$1', [task.id]);
        assert.ok(
          (await listEligibleAgentSteps(pool, actor)).eligible.some(
            (entry) => entry.step.id === step.id,
          ),
          'blocked earlier tasks cannot hide eligible work beyond the first hundred',
        );
      }
      task =
        responsibility === 'human'
          ? (
              await executeStepCommand(
                pool,
                actor,
                {
                  type: 'step.status',
                  operationId: randomUUID(),
                  taskId: task.id,
                  id: step.id,
                  expectedTaskRevision: task.revision,
                  expectedRevision: step.revision,
                  status: 'completed',
                },
                auth,
              )
            ).task
          : (
              await executeAgentWorkflowCommand(
                pool,
                actor,
                {
                  type: 'attempt.claim',
                  operationId: randomUUID(),
                  taskId: task.id,
                  stepId: step.id,
                  expectedStepRevision: (await readAgentWorkflow(pool, actor, task.id)).steps[0]!
                    .revision,
                  ownershipToken: randomBytes(32).toString('base64url'),
                },
                auth,
              )
            ).task!;
      assert.equal(task.phase, 'active');
      assert.equal(task.organization.columnId, active);
      assert.equal(
        task.order,
        responsibility === 'human' ? 0 : 1,
        'append without colliding with existing Active work',
      );
      const edited = await executeTaskCommand(
        pool,
        actor,
        {
          type: 'task.edit',
          operationId: randomUUID(),
          taskId: task.id,
          expectedRevision: task.revision,
          content: { ...task.content, notes: 'Still editable after starting' },
        },
        auth,
      );
      assert.equal(edited.task.content.notes, 'Still editable after starting');
    }
  } finally {
    await pool.end();
  }
});

test('only real fingerprinted production assets receive immutable caching', async () => {
  const { createApp } = await import('../src/app.js');
  const { mkdir, writeFile, mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const mediaDirectory = await mkdtemp(join(tmpdir(), 'mems-life-core-media-'));
  const webDirectory = join(mediaDirectory, 'web');
  await mkdir(join(webDirectory, 'assets'), { recursive: true });
  await writeFile(
    join(webDirectory, 'index.html'),
    '<!doctype html><title>Fictional cache fixture</title>',
  );
  await writeFile(join(webDirectory, 'assets/index-AbCdEfGh.js'), 'console.log("fixture")');
  await writeFile(join(webDirectory, 'assets/unhashed.js'), 'console.log("unhashed fixture")');
  const pool = new Pool({ connectionString: databaseUrl });
  let app: Awaited<ReturnType<typeof createApp>>['app'] | undefined;
  try {
    ({ app } = await createApp(
      {
        ...config,
        NODE_ENV: 'production',
        BETTER_AUTH_URL: 'https://fixture.example.test',
        WEB_ORIGIN: 'https://fixture.example.test',
        MEDIA_DIRECTORY: mediaDirectory,
      },
      pool,
      { webDirectory },
    ));
    const asset = 'index-AbCdEfGh.js';
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/notifications/devices/' + randomUUID(),
      headers: {
        origin: 'https://fixture.example.test',
        'access-control-request-method': 'DELETE',
      },
    });
    assert.equal(preflight.statusCode, 204);
    assert.match(String(preflight.headers['access-control-allow-methods']), /DELETE/);
    assert.equal(
      (await app.inject(`/assets/${asset}`)).headers['cache-control'],
      'public, max-age=31536000, immutable',
    );
    for (const path of [
      '/',
      '/assets/unhashed.js',
      '/assets/missing-AbCdEfGh.js',
      '/api/health',
      '/api/me',
    ])
      assert.equal((await app.inject(path)).headers['cache-control'], 'no-store', path);
  } finally {
    if (app) await app.close();
    await pool.end();
    await rm(mediaDirectory, { recursive: true, force: true });
  }
});

test('migration 15 waits behind the coherent backup maintenance barrier', async () => {
  const { migrateRcHardening } = await import('../src/rc-hardening-migrations.js');
  const pool = new Pool({ connectionString: databaseUrl, max: 3 });
  const backup = await pool.connect();
  let migration: Promise<void> | undefined;
  try {
    await pool.query(
      'DROP INDEX audit_events_operation; DROP INDEX agent_attempts_latest; DELETE FROM application_migrations WHERE version=15',
    );
    await backup.query('BEGIN');
    await backup.query('SELECT pg_advisory_xact_lock(7311027)');
    migration = migrateRcHardening(pool);
    let blocked = false;
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const locks = await backup.query(
        "SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=7311027 AND NOT granted",
      );
      if (locks.rowCount) {
        blocked = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(blocked, 'migration must wait for backup to finish');
    assert.equal(
      (await backup.query('SELECT 1 FROM application_migrations WHERE version=15')).rowCount,
      0,
    );
    await backup.query('COMMIT');
    await migration;
    assert.equal(
      (await pool.query('SELECT 1 FROM application_migrations WHERE version=15')).rowCount,
      1,
    );
    await migrateRcHardening(pool);
  } finally {
    await backup.query('ROLLBACK');
    backup.release();
    if (migration) await migration;
    await pool.end();
  }
});
