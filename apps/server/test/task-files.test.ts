import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm, link, unlink, readdir, symlink, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import Fastify from 'fastify';
import { Pool } from 'pg';
import { migrate, bootstrapOwner } from '../src/database.js';
import { readConfig } from '../src/config.js';
import { requireOwner } from '../src/operations.js';
import { executeTaskCommand } from '../src/tasks.js';
import { migrateTaskFiles } from '../src/task-file-migrations.js';
import {
  allocateTaskFile,
  receiveTaskFile,
  finalizeTaskFile,
  readTaskFile,
  reconcileTaskFiles,
  detachTaskFile,
} from '../src/task-files.js';
import { registerTaskFileRoutes } from '../src/task-file-routes.js';
import { issueAgentGrant, authenticateAgent, revokeAgentGrant } from '../src/agent-grants.js';
import { taskFileMcpTools } from '../src/task-file-tools.js';
import { ApplicationError } from '../src/errors.js';
const databaseUrl =
  process.env.TASK_FILES_TEST_DATABASE_URL ??
  'postgresql://mems_life@127.0.0.1:55432/mems_life_task_files_test';
if (new URL(databaseUrl).pathname !== '/mems_life_task_files_test')
  throw new Error('Task-file tests require isolated mems_life_task_files_test database.');
const config = readConfig({
  DATABASE_URL: databaseUrl,
  BETTER_AUTH_SECRET: 'fictional-task-file-secret-minimum-length',
  BETTER_AUTH_URL: 'http://localhost:3001',
  WEB_ORIGIN: 'http://localhost:5173',
  NODE_ENV: 'test',
});
test('private streaming immutable task files: PostgreSQL receipts, interrupted transfer/finalize, permissions, versions and detach guard', async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 5 }),
    directory = await mkdtemp(join(tmpdir(), 'task-files-fixture-')),
    authorize = async () => {};
  const app = Fastify();
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await migrate(pool, config);
    await migrateTaskFiles(pool);
    await migrateTaskFiles(pool);
    await bootstrapOwner(pool, config, {
      email: 'task-files@example.test',
      name: 'File Fixture',
      password: 'fictional-file-password-123',
    });
    const actor = await requireOwner(
      pool,
      (await pool.query('SELECT owner_id FROM installation')).rows[0].owner_id,
    );
    const taskId = randomUUID();
    await executeTaskCommand(
      pool,
      actor,
      {
        type: 'task.create',
        taskId,
        operationId: randomUUID(),
        expectedRevision: 0,
        content: { title: 'Fictional edit', description: '', notes: '' },
      },
      authorize,
    );
    const bytes = Buffer.from('# Fictional result\nImmutable version one.\n'),
      input = {
        operationId: randomUUID(),
        expectedRevision: 1,
        fileId: randomUUID(),
        name: 'result.md',
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        contentType: 'text/markdown' as const,
      };
    const staged = await allocateTaskFile(pool, actor, taskId, input, authorize);
    assert.deepEqual(await allocateTaskFile(pool, actor, taskId, input, authorize), staged);
    await assert.rejects(
      allocateTaskFile(pool, actor, taskId, { ...input, name: 'changed.md' }, authorize),
      /different content/,
    );
    await assert.rejects(
      receiveTaskFile(
        pool,
        actor,
        input.fileId,
        Readable.from([Buffer.alloc(bytes.length, 65)]),
        directory,
        authorize,
      ),
      /checksum/,
    );
    await assert.rejects(
      receiveTaskFile(
        pool,
        actor,
        input.fileId,
        Readable.from([Buffer.alloc(bytes.length + 1, 65)]),
        directory,
        authorize,
      ),
      /exceeds/,
    );
    async function* interrupted() {
      yield bytes.subarray(0, 6);
      throw new Error('Fictional disconnected upload');
    }
    await assert.rejects(
      receiveTaskFile(pool, actor, input.fileId, interrupted(), directory, authorize),
      /disconnected/,
    );
    assert.equal((await readdir(join(directory, 'task-files', 'staging'))).length, 0);
    await assert.rejects(readTaskFile(pool, actor, input.fileId, directory), /not found/);
    let release!: () => void, started!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    async function* slow() {
      started();
      await wait;
      yield bytes;
    }
    const first = receiveTaskFile(pool, actor, input.fileId, slow(), directory, authorize);
    await running;
    const secondTransfer = receiveTaskFile(
      pool,
      actor,
      input.fileId,
      Readable.from([bytes]),
      directory,
      authorize,
    );
    await assert.rejects(
      receiveTaskFile(pool, actor, input.fileId, Readable.from([bytes]), directory, authorize),
      /Two files/,
    );
    release();
    await Promise.all([first, secondTransfer]);
    const stalePart = join(
      directory,
      'task-files',
      'staging',
      `${input.fileId}.${randomUUID()}.part`,
    );
    await writeFile(stalePart, 'stale incomplete fictional bytes');
    const old = new Date(Date.now() - 25 * 3600000);
    await utimes(stalePart, old, old);
    // Simulate hard crash after publishing bytes and removing staging, before database finalize.
    await link(
      join(directory, 'task-files', 'staging', input.fileId),
      join(directory, 'task-files', 'files', input.fileId),
    );
    await unlink(join(directory, 'task-files', 'staging', input.fileId));
    await reconcileTaskFiles(pool, directory);
    assert.equal((await readdir(join(directory, 'task-files', 'staging'))).length, 0);
    assert.equal(
      (await pool.query('SELECT status FROM task_files WHERE id=$1', [input.fileId])).rows[0]
        .status,
      'received',
    );
    const finalCommand = { operationId: randomUUID(), expectedRevision: 1 },
      finalized = await finalizeTaskFile(
        pool,
        actor,
        input.fileId,
        finalCommand,
        directory,
        authorize,
      );
    assert.equal(finalized.task.revision, 2);
    assert.deepEqual(
      await finalizeTaskFile(pool, actor, input.fileId, finalCommand, directory, authorize),
      finalized,
    );
    const file = await readTaskFile(pool, actor, input.fileId, directory);
    const chunks = [];
    for await (const chunk of file.stream) chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks), bytes);
    await assert.rejects(
      receiveTaskFile(
        pool,
        actor,
        input.fileId,
        Readable.from([Buffer.alloc(bytes.length, 65)]),
        directory,
        authorize,
      ),
      /checksum/,
    );
    await assert.rejects(
      readTaskFile(pool, { ...actor, userId: 'another-fictional-owner' }, input.fileId, directory),
      /does not own/,
    );
    await assert.rejects(
      receiveTaskFile(pool, actor, input.fileId, Readable.from([bytes]), directory, async () => {
        throw new ApplicationError(403, 'DENIED', 'Grant revoked.');
      }),
      /revoked/,
    );
    // A referenced approved result prevents access revocation until explicit revisions.
    const stepId = randomUUID(),
      attemptId = randomUUID(),
      resultId = randomUUID();
    await pool.query(
      'INSERT INTO task_steps(id,owner_id,task_id,revision,value) VALUES($1,$2,$3,1,$4)',
      [stepId, actor.userId, taskId, {}],
    );
    await pool.query(
      'INSERT INTO agent_attempts(id,owner_id,task_id,step_id,token_verifier,value) VALUES($1,$2,$3,$4,$5,$6)',
      [attemptId, actor.userId, taskId, stepId, 'fixture', {}],
    );
    await pool.query(
      'INSERT INTO agent_results(id,owner_id,task_id,step_id,attempt_id,version,value) VALUES($1,$2,$3,$4,$5,1,$6)',
      [
        resultId,
        actor.userId,
        taskId,
        stepId,
        attemptId,
        {
          approvedAt: new Date().toISOString(),
          feedback: null,
          artifacts: [{ kind: 'file', fileId: input.fileId, key: 'edit' }],
        },
      ],
    );
    await assert.rejects(
      detachTaskFile(
        pool,
        actor,
        input.fileId,
        { operationId: randomUUID(), expectedRevision: 2 },
        authorize,
      ),
      /Request revisions/,
    );
    await pool.query(
      'UPDATE agent_results SET value=value||\'{"approvedAt":null,"feedback":"Revise edit"}\'::jsonb WHERE id=$1',
      [resultId],
    );
    const detach = { operationId: randomUUID(), expectedRevision: 2 };
    await detachTaskFile(pool, actor, input.fileId, detach, authorize);
    await detachTaskFile(pool, actor, input.fileId, detach, authorize);
    await assert.rejects(readTaskFile(pool, actor, input.fileId, directory), /not found/);
    assert.equal(
      (await pool.query('SELECT status FROM task_files WHERE id=$1', [input.fileId])).rows[0]
        .status,
      'finalized',
    );
    const second = {
      ...input,
      fileId: randomUUID(),
      operationId: randomUUID(),
      expectedRevision: 3,
    };
    await allocateTaskFile(pool, actor, taskId, second, authorize);
    app.setErrorHandler((error, _request, reply) =>
      reply
        .status(error instanceof ApplicationError ? error.status : 500)
        .send({ error: error.message }),
    );
    registerTaskFileRoutes(
      app,
      pool,
      {
        ownerSession: async (request) => {
          if (request.headers.cookie !== 'fixture=owner')
            throw new ApplicationError(401, 'UNAUTHENTICATED', 'Sign in.');
          if (request.method !== 'GET' && request.headers.origin !== 'http://localhost:5173')
            throw new ApplicationError(403, 'ORIGIN', 'Origin required.');
          return { principal: actor };
        },
        authorizeAgain: authorize,
      },
      { mediaDirectory: directory },
    );
    assert.equal(
      (await app.inject({ method: 'GET', url: `/api/task-files/${second.fileId}` })).statusCode,
      401,
    );
    assert.equal(
      (
        await app.inject({
          method: 'PUT',
          url: `/api/task-files/${second.fileId}/content`,
          headers: { cookie: 'fixture=owner', 'content-type': 'application/octet-stream' },
          payload: bytes,
        })
      ).statusCode,
      403,
    );
    const uploaded = await app.inject({
      method: 'PUT',
      url: `/api/task-files/${second.fileId}/content`,
      headers: {
        cookie: 'fixture=owner',
        origin: 'http://localhost:5173',
        'content-type': 'application/octet-stream',
      },
      payload: bytes,
    });
    assert.equal(uploaded.statusCode, 200, uploaded.body);
    await finalizeTaskFile(
      pool,
      actor,
      second.fileId,
      { operationId: randomUUID(), expectedRevision: 3 },
      directory,
      authorize,
    );
    const download = await app.inject({
      url: `/api/task-files/${second.fileId}`,
      headers: { cookie: 'fixture=owner' },
    });
    assert.equal(download.statusCode, 200);
    assert.match(download.headers['content-disposition'] as string, /attachment/);
    assert.equal(download.headers['x-content-type-options'], 'nosniff');
    assert.match(download.headers['content-security-policy'] as string, /sandbox/);
    const grant = await issueAgentGrant(
      pool,
      actor,
      {
        operationId: randomUUID(),
        label: 'Fictional artifact worker',
        scopes: ['tasks:read', 'tasks:write'],
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      },
      authorize,
    );
    const header = `Bearer ${grant.secret}`,
      agent = await authenticateAgent(pool, header, 'tasks:write');
    const checkAgent = async (client: import('pg').PoolClient) => {
      await authenticateAgent(client, header, 'tasks:write');
    };
    const agentUpload = {
      ...input,
      fileId: randomUUID(),
      operationId: randomUUID(),
      expectedRevision: 4,
    };
    const tools = taskFileMcpTools(pool, directory);
    const allocated = (await tools
      .find((tool) => tool.name === 'task_file_allocate')!
      .run({ taskId, upload: agentUpload }, agent, checkAgent)) as { uploadPath: string };
    assert.equal(allocated.uploadPath, `/api/task-files/${agentUpload.fileId}/content`);
    const raw = await app.inject({
      method: 'PUT',
      url: allocated.uploadPath,
      headers: { authorization: header, 'content-type': 'application/octet-stream' },
      payload: bytes,
    });
    assert.equal(raw.statusCode, 200, raw.body);
    await tools
      .find((tool) => tool.name === 'task_file_finalize')!
      .run(
        { id: agentUpload.fileId, command: { operationId: randomUUID(), expectedRevision: 4 } },
        agent,
        checkAgent,
      );
    assert.equal(
      (
        await pool.query('SELECT actor_type FROM task_history WHERE task_id=$1 AND revision=5', [
          taskId,
        ])
      ).rows[0].actor_type,
      'agent',
    );
    assert.equal(
      (
        await app.inject({
          url: `/api/task-files/${agentUpload.fileId}`,
          headers: { authorization: header },
        })
      ).statusCode,
      200,
    );
    const foodGrant = await issueAgentGrant(
      pool,
      actor,
      {
        operationId: randomUUID(),
        label: 'Fictional food-only worker',
        scopes: ['food:attach'],
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      },
      authorize,
    );
    assert.equal(
      (
        await app.inject({
          method: 'PUT',
          url: allocated.uploadPath,
          headers: {
            authorization: `Bearer ${foodGrant.secret}`,
            'content-type': 'application/octet-stream',
          },
          payload: bytes,
        })
      ).statusCode,
      403,
    );
    await revokeAgentGrant(pool, actor, grant.grant.id, randomUUID(), authorize);
    assert.equal(
      (
        await app.inject({
          url: `/api/task-files/${agentUpload.fileId}`,
          headers: { authorization: header },
        })
      ).statusCode,
      401,
    );
    const unsafe = await mkdtemp(join(tmpdir(), 'unsafe-task-fixture-'));
    await symlink(unsafe, join(directory, 'other-root'));
    await assert.rejects(
      receiveTaskFile(
        pool,
        actor,
        second.fileId,
        Readable.from([bytes]),
        join(directory, 'other-root'),
        authorize,
      ),
      /Unsafe media directory/,
    );
    await rm(unsafe, { recursive: true, force: true });
    await pool.query('UPDATE tasks SET deleted_at=now() WHERE id=$1', [taskId]);
    assert.equal(
      (
        await app.inject({
          url: `/api/task-files/${second.fileId}`,
          headers: { cookie: 'fixture=owner' },
        })
      ).statusCode,
      404,
    );
    await assert.rejects(allocateTaskFile(pool, actor, taskId, second, authorize), /not found/);
  } finally {
    await app.close();
    await pool.end();
    await rm(directory, { recursive: true, force: true });
  }
});
