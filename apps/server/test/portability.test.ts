import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { migrate, bootstrapOwner, transaction } from '../src/database.js';
import { migratePortability } from '../src/portability-migrations.js';
import { readConfig } from '../src/config.js';
import { requireOwner } from '../src/operations.js';
import { executeTaskCommand } from '../src/tasks.js';
import {
  ownerExport,
  verifyTree,
  digestFile,
  redactPortable,
  beginMaintenanceWrite,
  enterMaintenance,
  withMaintenanceWrite,
} from '../src/portability.js';
const run = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const sourceUrl =
  process.env.PORTABILITY_TEST_DATABASE_URL ??
  'postgresql://mems_life@127.0.0.1:55432/mems_life_portability_test';
const restoreUrl =
  process.env.RESTORE_TEST_DATABASE_URL ??
  'postgresql://mems_life@127.0.0.1:55432/mems_life_restore_test';
if (
  new URL(sourceUrl).pathname !== '/mems_life_portability_test' ||
  new URL(restoreUrl).pathname !== '/mems_life_restore_test'
)
  throw new Error('Portability requires isolated test databases.');
test('actual PostgreSQL coherent DB/media backup, secret-free export, independent restore, tombstones/receipts/history and epoch rotation', async () => {
  const pool = new Pool({ connectionString: sourceUrl });
  const restored = new Pool({ connectionString: restoreUrl });
  const temp = await realpath(await mkdtemp(join(tmpdir(), 'mems-portability-')));
  const media = join(temp, 'media');
  await mkdir(join(media, 'files'), { recursive: true });
  await mkdir(join(media, 'staging'));
  const config = readConfig({
    DATABASE_URL: sourceUrl,
    BETTER_AUTH_SECRET: 'fictional-portability-auth-secret-123456',
    NODE_ENV: 'test',
  });
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await restored.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await migrate(pool, config);
    await migratePortability(pool);
    await bootstrapOwner(pool, config, {
      email: 'portability@example.test',
      name: 'Fictional Export Owner',
      password: 'fictional-password-123456',
    });
    const actor = await requireOwner(
      pool,
      (await pool.query('SELECT owner_id FROM installation')).rows[0].owner_id,
    );
    const installation = (await pool.query('SELECT id,epoch FROM installation')).rows[0];
    const taskId = randomUUID();
    const operationId = randomUUID();
    const command = {
      type: 'task.create' as const,
      operationId,
      taskId,
      expectedRevision: 0,
      content: { title: 'Portable fictional record', description: '', notes: '' },
    };
    await executeTaskCommand(pool, actor, command, async () => {});
    const account = randomUUID();
    await pool.query(
      "INSERT INTO whoop_connection(owner_id,account_id,tokens,pending_state) VALUES($1,$2,'connection-secret','oauth-secret')",
      [actor.userId, account],
    );
    await pool.query(
      "INSERT INTO whoop_credentials(owner_id,account_id,tokens,expires_at) VALUES($1,$2,'credential-secret',now()+interval '1 hour')",
      [actor.userId, account],
    );
    const grant = randomUUID();
    await pool.query(
      "INSERT INTO agent_grants(id,owner_id,label,verifier,scopes,expires_at,issue_operation_id) VALUES($1,$2,'fixture',$3,ARRAY['tasks:read'],now()+interval '1 hour',$4)",
      [grant, actor.userId, 'a'.repeat(64), randomUUID()],
    );
    const agentOperationId = randomUUID(),
      agentTaskId = randomUUID();
    await executeTaskCommand(
      pool,
      { ...actor, actorId: grant, actorType: 'agent' },
      { ...command, operationId: agentOperationId, taskId: agentTaskId },
      async () => {},
    );
    await pool.query(
      'INSERT INTO agent_provenance(owner_id,actor_id,operation_id,source) VALUES($1,$2,$3,$4)',
      [
        actor.userId,
        grant,
        agentOperationId,
        { source: 'fictional agent source', tool: 'fixture' },
      ],
    );
    const bytes = Buffer.from('fictional staged bytes');
    const id = randomUUID();
    const hash = createHash('sha256').update(bytes).digest('hex');
    await writeFile(join(media, 'staging', id), bytes);
    const entry = randomUUID();
    await pool.query(
      'INSERT INTO food_entries(id,owner_id,revision,value,occurred_at) VALUES($1,$2,1,$3,now())',
      [entry, actor.userId, { id: entry, photoIds: [] }],
    );
    await pool.query(
      "INSERT INTO food_media(id,entry_id,owner_id,status,size,sha256,content_type) VALUES($1,$2,$3,'received',$4,$5,'image/png')",
      [id, entry, actor.userId, bytes.length, hash],
    );
    const fileId = randomUUID();
    await mkdir(join(media, 'task-files/files'), { recursive: true });
    await mkdir(join(media, 'task-files/staging'));
    await writeFile(join(media, 'task-files/files', fileId), bytes);
    await pool.query(
      "INSERT INTO task_files(id,task_id,owner_id,name,status,size,sha256,content_type) VALUES($1,$2,$3,'fixture.txt','finalized',$4,$5,'text/plain')",
      [fileId, taskId, actor.userId, bytes.length, hash],
    );
    const exportData = await ownerExport(pool, actor);
    const text = JSON.stringify(exportData);
    for (const secret of [
      'connection-secret',
      'oauth-secret',
      'credential-secret',
      'fictional-password-123456',
      'a'.repeat(64),
    ])
      assert.equal(text.includes(secret), false);
    assert(exportData.records.task_history?.length);
    assert(
      exportData.records.audit_events?.some(
        (row) => row.actor_id === grant && row.operation_id === agentOperationId,
      ),
    );
    assert(
      exportData.records.operation_receipts?.some(
        (row) => row.actor_id === grant && row.operation_id === agentOperationId,
      ),
    );
    assert(
      exportData.records.agent_provenance?.some(
        (row) => row.actor_id === grant && row.operation_id === agentOperationId,
      ),
    );
    assert.deepEqual(
      redactPortable({
        value: { token_verifier: 'attempt-secret', secret: 'raw-grant', tokens: 'whoop-token' },
        name: 'safe',
      }),
      { value: {}, name: 'safe' },
    );
    const inFlight = await pool.connect();
    await inFlight.query('BEGIN');
    await beginMaintenanceWrite(inFlight);
    let drained = false;
    const drain = enterMaintenance(pool).then((release) => {
      drained = true;
      return release;
    });
    for (let i = 0; i < 50; i++) {
      if ((await pool.query('SELECT maintenance FROM portability_control')).rows[0].maintenance)
        break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(
      (await pool.query('SELECT maintenance FROM portability_control')).rows[0].maintenance,
      true,
    );
    assert.equal(drained, false);
    await inFlight.query('COMMIT');
    inFlight.release();
    const held = await drain;
    assert.equal(drained, true);
    await held();
    await assert.rejects(
      transaction(pool, async (client) => {
        await beginMaintenanceWrite(client);
      }),
    );
    await pool.query('UPDATE portability_control SET maintenance=false');
    await executeTaskCommand(
      pool,
      actor,
      { type: 'task.delete', operationId: randomUUID(), taskId, expectedRevision: 1 },
      async () => {},
    );
    const smallPool = new Pool({ connectionString: sourceUrl, max: 2 });
    try {
      await Promise.race([
        Promise.all(
          Array.from({ length: 6 }, () =>
            withMaintenanceWrite(smallPool, () =>
              transaction(smallPool, async (client) => {
                await client.query('SELECT 1');
              }),
            ),
          ),
        ),
        new Promise((_, reject) => {
          const timer = setTimeout(() => reject(new Error('Small-pool guard deadlocked.')), 3000);
          timer.unref();
        }),
      ]);
      let start!: () => void;
      const started = new Promise<void>((resolve) => {
        start = resolve;
      });
      let finish!: () => void;
      const allowed = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const transfer = withMaintenanceWrite(smallPool, async () => {
        start();
        await allowed;
        await transaction(smallPool, async (client) => {
          await client.query('SELECT 1');
        });
      });
      await started;
      const drain = enterMaintenance(smallPool);
      for (let i = 0; i < 50; i++) {
        if ((await pool.query('SELECT maintenance FROM portability_control')).rows[0].maintenance)
          break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      finish();
      await transfer;
      const unlock = await drain;
      await unlock();
      await pool.query('UPDATE portability_control SET maintenance=false');
    } finally {
      await smallPool.end();
    }
    const backup = join(temp, 'backup');
    const env = { ...process.env, DATABASE_URL: sourceUrl, MEDIA_DIRECTORY: media };
    await run(
      process.execPath,
      ['--import', 'tsx', join(repositoryRoot, 'scripts/backup.mjs'), backup],
      {
        env,
        cwd: repositoryRoot,
      },
    );
    const manifest = JSON.parse(await readFile(join(backup, 'manifest.json'), 'utf8'));
    assert.equal(manifest.media.length, 2);
    await verifyTree(join(backup, 'media'), manifest.media);
    const postId = randomUUID();
    const lostOperationId = randomUUID();
    await executeTaskCommand(
      pool,
      actor,
      { ...command, taskId: postId, operationId: lostOperationId },
      async () => {},
    );
    const readable = join(temp, 'readable');
    await run(
      process.execPath,
      ['--import', 'tsx', join(repositoryRoot, 'scripts/export.mjs'), readable],
      { env, cwd: repositoryRoot },
    );
    const readableJson = await readFile(join(readable, 'records.json'), 'utf8');
    assert.equal(readableJson.includes('credential-secret'), false);
    assert.deepEqual(await digestFile(join(readable, 'attachments/task-files/files', fileId)), {
      size: bytes.length,
      sha256: hash,
    });
    const targetMedia = join(temp, 'restored-media');
    await run(
      process.execPath,
      ['--import', 'tsx', join(repositoryRoot, 'scripts/restore.mjs'), backup],
      {
        env: { ...env, DATABASE_URL: restoreUrl, MEDIA_DIRECTORY: targetMedia },
        cwd: repositoryRoot,
      },
    );
    const recovered = (await restored.query('SELECT id,epoch FROM installation')).rows[0];
    assert.equal(recovered.id, installation.id);
    assert.notEqual(recovered.epoch, installation.epoch);
    assert.equal(
      (await restored.query('SELECT maintenance FROM portability_control')).rows[0].maintenance,
      true,
    );
    assert.equal((await restored.query('SELECT 1 FROM tasks WHERE id=$1', [postId])).rowCount, 0);
    assert.equal(
      (
        await restored.query('SELECT 1 FROM operation_receipts WHERE operation_id=$1', [
          lostOperationId,
        ])
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await restored.query('SELECT 1 FROM operation_receipts WHERE operation_id=$1', [
          operationId,
        ])
      ).rowCount,
      1,
    );
    assert.equal(
      (await restored.query('SELECT 1 FROM task_history WHERE task_id=$1', [taskId])).rowCount,
      2,
    );
    assert(
      (await restored.query('SELECT deleted_at FROM tasks WHERE id=$1', [taskId])).rows[0]
        .deleted_at,
    );
    assert.deepEqual(await digestFile(join(targetMedia, 'staging', id)), {
      size: bytes.length,
      sha256: hash,
    });
    await writeFile(join(backup, 'media/staging', id), 'tampered');
    await assert.rejects(verifyTree(join(backup, 'media'), manifest.media), /checksum/);
  } finally {
    await pool.end();
    await restored.end();
    await rm(temp, { recursive: true, force: true });
  }
});
