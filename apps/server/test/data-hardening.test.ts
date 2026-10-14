import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { Pool } from 'pg';
import { SessionSchema } from '@mems-life/domain';
import { migrate, bootstrapOwner, transaction } from '../src/database.js';
import { readConfig } from '../src/config.js';
import { requireOwner } from '../src/operations.js';
import { executeTaskCommand } from '../src/tasks.js';
import { allocateTaskFile, receiveTaskFile } from '../src/task-files.js';
import { WhoopService } from '../src/whoop.js';
import { ApplicationError } from '../src/errors.js';
import { issueAgentGrant } from '../src/agent-grants.js';
import { createSyncSnapshot } from '../src/sync.js';
import { enterMaintenance, resumeMaintenance } from '../src/portability.js';

const databaseUrl =
  process.env.RC_DATA_TEST_DATABASE_URL ??
  'postgresql://mems_life@127.0.0.1:55432/mems_life_rc_data';
if (new URL(databaseUrl).pathname !== '/mems_life_rc_data')
  throw new Error('Data-hardening fixtures require isolated mems_life_rc_data.');

test('data service restore and consent barriers protect bytes and credentials', async (t) => {
  const pool = new Pool({ connectionString: databaseUrl, max: 5 });
  const directory = await mkdtemp(join(tmpdir(), 'data-hardening-fixture-'));
  const config = readConfig({
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: 'fictional-data-hardening-secret-123456',
    NODE_ENV: 'test',
  });
  const authorize = async () => {};
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await migrate(pool, config);
    await bootstrapOwner(pool, config, {
      email: 'data-hardening@example.test',
      name: 'Fictional Data Owner',
      password: 'fictional-data-password-123456',
    });
    const actor = await requireOwner(
      pool,
      (await pool.query('SELECT owner_id FROM installation')).rows[0].owner_id,
    );
    const staleActor = { ...actor, expectedEpoch: randomUUID() };
    const epochError = (error: unknown) =>
      error instanceof ApplicationError && error.code === 'SYNC_EPOCH_CHANGED';

    await t.test('old-epoch task-file transfers never consume or publish bytes', async () => {
      const taskId = randomUUID();
      await executeTaskCommand(
        pool,
        actor,
        {
          type: 'task.create',
          operationId: randomUUID(),
          taskId,
          expectedRevision: 0,
          content: { title: 'Fictional protected artifact', description: '', notes: '' },
        },
        authorize,
      );
      const bytes = Buffer.from('Fictional immutable artifact');
      const input = {
        fileId: randomUUID(),
        operationId: randomUUID(),
        expectedRevision: 1,
        name: 'fixture.txt',
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        contentType: 'text/plain' as const,
      };
      await allocateTaskFile(pool, actor, taskId, input, authorize);
      let consumed = false;
      async function* source() {
        consumed = true;
        yield bytes;
      }
      await assert.rejects(
        receiveTaskFile(pool, staleActor, input.fileId, source(), directory, authorize),
        epochError,
      );
      assert.equal(consumed, false);
      assert.equal(
        (await pool.query('SELECT status FROM task_files WHERE id=$1', [input.fileId])).rows[0]
          .status,
        'pending',
      );
      await receiveTaskFile(
        pool,
        actor,
        input.fileId,
        Readable.from([bytes]),
        directory,
        authorize,
      );
      assert.deepEqual(await readdir(join(directory, 'task-files/staging')), [input.fileId]);
    });

    let sessionLive = true;
    let revokeDuringExchange = false;
    const fake: typeof fetch = async (url) => {
      if (String(url).endsWith('/token')) {
        if (revokeDuringExchange) sessionLive = false;
        return Response.json({
          access_token: 'fictional-access',
          refresh_token: 'fictional-refresh',
          expires_in: 3600,
        });
      }
      if (String(url).endsWith('/user/profile/basic')) return Response.json({ user_id: 123 });
      if (String(url).endsWith('/activity/workout/missing-workout'))
        return new Response(null, { status: 404 });
      return Response.json({ records: [] });
    };
    const svc = new WhoopService(
      pool,
      {
        WHOOP_CLIENT_ID: 'fictional-client',
        WHOOP_CLIENT_SECRET: 'fictional-secret',
        WHOOP_REDIRECT_URI: 'https://fixture.example.test/api/whoop/callback',
        WHOOP_TOKEN_KEY: 'ab'.repeat(32),
      },
      fake,
    );
    await t.test('old-epoch WHOOP commands cannot start consent or delete cache', async () => {
      const command = {
        type: 'whoop.connect' as const,
        channel: 'web' as const,
        operationId: randomUUID(),
        expectedRevision: 0,
      };
      await assert.rejects(
        svc.command(staleActor, command, 'fictional-session', authorize),
        epochError,
      );
      assert.equal((await pool.query('SELECT 1 FROM whoop_states')).rowCount, 0);
      assert.equal(
        (
          await pool.query('SELECT 1 FROM operation_receipts WHERE operation_id=$1', [
            command.operationId,
          ])
        ).rowCount,
        0,
      );
    });
    await t.test(
      'WHOOP cannot reuse an operation ID reserved by one-time credential issuance',
      async () => {
        const operationId = randomUUID();
        await issueAgentGrant(
          pool,
          actor,
          {
            operationId,
            label: 'Fictional reserved operation',
            scopes: ['tasks:read'],
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          },
          authorize,
        );
        await assert.rejects(
          svc.command(
            actor,
            {
              type: 'whoop.connect',
              channel: 'web',
              operationId,
              expectedRevision: 0,
            },
            'fictional-session',
            authorize,
          ),
          (error: unknown) =>
            error instanceof ApplicationError && error.code === 'OPERATION_ID_REUSED',
        );
        assert.equal((await pool.query('SELECT 1 FROM whoop_states')).rowCount, 0);
      },
    );
    await t.test(
      'old-epoch callbacks retain their nonce for reviewed current-epoch consent',
      async () => {
        const connect = await svc.command(
          actor,
          {
            type: 'whoop.connect',
            channel: 'web',
            operationId: randomUUID(),
            expectedRevision: (await svc.read(actor)).revision,
          },
          'fictional-session',
          authorize,
        );
        const state = new URL(connect.authorizationUrl!).searchParams.get('state')!;
        await assert.rejects(
          svc.callback(staleActor, 'fictional-session', state, 'fictional-code', authorize),
          epochError,
        );
        assert.equal((await pool.query('SELECT 1 FROM whoop_states')).rowCount, 1);
        await svc.callback(actor, 'fictional-session', state, 'fictional-code', authorize);
        assert.equal((await svc.read(actor)).status, 'connected');
      },
    );
    await t.test(
      'reconciliation records when a missing provider workout was actually rechecked',
      async () => {
        const current = (await pool.query('SELECT account_id FROM whoop_connection')).rows[0];
        const oldRetrieval = new Date(Date.now() - 3 * 3600000).toISOString();
        await pool.query(
          `INSERT INTO whoop_observations(owner_id,account_id,provider_account_id,resource,provider_id,payload,retrieved_at)
        VALUES($1,$2,'123','workout','missing-workout',$3,$4)`,
          [
            actor.userId,
            current.account_id,
            {
              id: 'missing-workout',
              user_id: 123,
              start: new Date(Date.now() - 3600000).toISOString(),
              end: new Date().toISOString(),
              updated_at: oldRetrieval,
              score_state: 'PENDING_SCORE',
              score: null,
            },
            oldRetrieval,
          ],
        );
        await svc.command(
          actor,
          {
            type: 'whoop.refresh',
            operationId: randomUUID(),
            expectedRevision: (await svc.read(actor)).revision,
          },
          'fictional-session',
          authorize,
        );
        const missing = (await svc.read(actor)).observations.find(
          (observation) => observation.providerId === 'missing-workout',
        )!;
        assert.equal(missing.available, false);
        assert.ok(
          missing.retrievedAt > oldRetrieval,
          'A checked 404 must carry the time of that check.',
        );
      },
    );
    await t.test(
      'consent exchange rechecks a session revoked while the provider responds',
      async () => {
        const check = async () => {
          if (!sessionLive)
            throw new ApplicationError(401, 'UNAUTHENTICATED', 'Fictional session revoked.');
        };
        const connect = await svc.command(
          actor,
          {
            type: 'whoop.connect',
            channel: 'web',
            operationId: randomUUID(),
            expectedRevision: (await svc.read(actor)).revision,
          },
          'fictional-session',
          check,
        );
        const before = (await pool.query('SELECT account_id,tokens FROM whoop_credentials'))
          .rows[0];
        revokeDuringExchange = true;
        await assert.rejects(
          svc.callback(
            actor,
            'fictional-session',
            new URL(connect.authorizationUrl!).searchParams.get('state')!,
            'fictional-code',
            check,
          ),
          (error: unknown) => error instanceof ApplicationError && error.code === 'UNAUTHENTICATED',
        );
        assert.deepEqual(
          (await pool.query('SELECT account_id,tokens FROM whoop_credentials')).rows[0],
          before,
        );
        assert.equal((await pool.query('SELECT 1 FROM whoop_states')).rowCount, 0);
      },
    );
    await t.test(
      'maintenance rejects waiting writers without starving the operator pool',
      async () => {
        const small = new Pool({ connectionString: databaseUrl, max: 2 });
        const release = await enterMaintenance(small);
        let ran = false;
        const blocked = transaction(small, async () => {
          ran = true;
        }).catch((error: unknown) => error);
        try {
          await new Promise((resolve) => setTimeout(resolve, 30));
          const result = await Promise.race([
            small.query('SELECT maintenance FROM portability_control'),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 300)),
          ]);
          assert.ok(
            result,
            'The exclusive maintenance lock and rejected writer occupied every pool slot.',
          );
          assert.equal(ran, false);
        } finally {
          await release();
          const error = await blocked;
          assert.ok(error instanceof ApplicationError && error.code === 'MAINTENANCE');
          await resumeMaintenance(small);
          await small.end();
        }
      },
    );
    await t.test(
      'one valid oversized workout is rejected in SQL before JSON hydration',
      async () => {
        const at = new Date().toISOString(),
          sessionId = randomUUID();
        const exerciseId = (await pool.query('SELECT id FROM exercises LIMIT 1')).rows[0].id;
        const representative = SessionSchema.parse({
          id: sessionId,
          revision: 1,
          name: 'Fictional capacity session',
          notes: '',
          status: 'active',
          sourceRoutineId: null,
          sourceRoutineRevision: null,
          supersets: [],
          timer: null,
          startedAt: at,
          updatedAt: at,
          finishedAt: null,
          items: [
            {
              id: randomUUID(),
              exerciseId,
              snapshot: { name: 'Fictional movement', mode: 'weighted', supportsLoad: true },
              targets: [],
              notes: '',
              status: 'in-progress',
              replacedItemId: null,
              results: [
                {
                  id: randomUUID(),
                  kind: 'working',
                  measurements: { mode: 'weighted', reps: 1, loadKg: 1 },
                  notes: 'x'.repeat(7000),
                  round: null,
                  recordedAt: at,
                  correctedAt: null,
                  removedAt: null,
                },
              ],
            },
          ],
        });
        // Expand only in PostgreSQL: 10 allowed exercises × 1000 allowed sets ×
        // 7000-character allowed notes. All identities remain distinct.
        await pool.query(
          `INSERT INTO workout_sessions(id,owner_id,revision,status,value,started_at,updated_at)
        SELECT $1,$2,1,'active',jsonb_set($3::jsonb,'{items}',
          (SELECT jsonb_agg(jsonb_set(jsonb_set($3::jsonb->'items'->0,'{id}',to_jsonb(gen_random_uuid())), '{results}',
            (SELECT jsonb_agg(jsonb_set($3::jsonb->'items'->0->'results'->0,'{id}',to_jsonb(gen_random_uuid()))) FROM generate_series(1,1000)))) FROM generate_series(1,10))),$4,$4`,
          [sessionId, actor.userId, representative, at],
        );
        const size = (
          await pool.query(
            'SELECT octet_length(value::text) AS bytes,pg_column_size(value) AS stored_bytes FROM workout_sessions WHERE id=$1',
            [sessionId],
          )
        ).rows[0];
        assert.ok(size.bytes > 64 * 1024 * 1024);
        assert.ok(
          size.stored_bytes < size.bytes,
          'Compressed storage size cannot bound JSON hydration.',
        );
        const observed = new Pool({ connectionString: databaseUrl, max: 1 });
        const connect = observed.connect.bind(observed);
        let maximumBytes = 0;
        observed.connect = (async () => {
          const client = await connect(),
            query = client.query.bind(client);
          client.query = (async (sql: string, values?: unknown[]) => {
            const result = await query(sql, values);
            if (/^FETCH/.test(sql))
              maximumBytes = Math.max(maximumBytes, Buffer.byteLength(JSON.stringify(result.rows)));
            return result;
          }) as typeof client.query;
          return client;
        }) as typeof observed.connect;
        const start = performance.now();
        const requestId = randomUUID();
        try {
          await assert.rejects(
            createSyncSnapshot(observed, actor, requestId, authorize),
            (error: unknown) =>
              error instanceof ApplicationError && error.code === 'SYNC_SNAPSHOT_TOO_LARGE',
          );
          assert.ok(maximumBytes < 100_000, `Oversized aggregate hydrated ${maximumBytes} bytes.`);
          t.diagnostic(
            `Oversized workout: ${size.bytes} serialized bytes, ${size.stored_bytes} stored bytes; largest hydrated batch ${maximumBytes} bytes; rejection ${(performance.now() - start).toFixed(1)}ms.`,
          );
          assert.equal(
            (await pool.query('SELECT 1 FROM sync_snapshots WHERE request_id=$1', [requestId]))
              .rowCount,
            0,
          );
          // The same wire guard applies to unbounded provider payloads. Move
          // the large fictional JSON in SQL so no fixture hydration hides a leak.
          await pool.query(
            `INSERT INTO whoop_observations(owner_id,account_id,provider_account_id,resource,provider_id,payload,retrieved_at)
            SELECT $1,gen_random_uuid(),'123','workout','oversized-fixture',value,now() FROM workout_sessions WHERE id=$2`,
            [actor.userId, sessionId],
          );
          await pool.query('DELETE FROM workout_sessions WHERE id=$1', [sessionId]);
          const providerRequestId = randomUUID();
          await assert.rejects(
            createSyncSnapshot(observed, actor, providerRequestId, authorize),
            (error: unknown) =>
              error instanceof ApplicationError &&
              error.code === 'SYNC_SNAPSHOT_TOO_LARGE' &&
              error.message.includes('64 MiB serialized transfer limit'),
          );
          assert.ok(maximumBytes < 100_000);
          assert.equal(
            (
              await pool.query('SELECT 1 FROM sync_snapshots WHERE request_id=$1', [
                providerRequestId,
              ])
            ).rowCount,
            0,
          );
        } finally {
          await observed.end();
          await pool.query('DELETE FROM workout_sessions WHERE id=$1', [sessionId]);
          await pool.query("DELETE FROM whoop_observations WHERE provider_id='oversized-fixture'");
        }
      },
    );
    await t.test(
      'oversized snapshots stop reading in bounded batches before exhausting memory',
      async () => {
        await pool.query(
          `INSERT INTO tasks(id,owner_id,revision,phase,content,sort_order,created_at,updated_at)
        SELECT gen_random_uuid(),$1,1,'planned',$2,ordinal,now(),now() FROM generate_series(1,900) ordinal`,
          [
            actor.userId,
            {
              title: 'Fictional capacity record',
              description: 'x'.repeat(20_000),
              notes: 'x'.repeat(20_000),
            },
          ],
        );
        const observedPool = new Pool({ connectionString: databaseUrl, max: 1 });
        const connect = observedPool.connect.bind(observedPool);
        let maximumBatch = 0;
        observedPool.connect = (async () => {
          const client = await connect();
          const query = client.query.bind(client);
          // Observe real PostgreSQL results without replacing the database or its operations.
          client.query = (async (sql: string, values?: unknown[]) => {
            const result = await query(sql, values);
            if (/SELECT \* FROM tasks|^FETCH/.test(sql))
              maximumBatch = Math.max(maximumBatch, result.rows.length);
            return result;
          }) as typeof client.query;
          return client;
        }) as typeof observedPool.connect;
        const requestId = randomUUID();
        try {
          await assert.rejects(
            createSyncSnapshot(observedPool, actor, requestId, authorize),
            (error: unknown) =>
              error instanceof ApplicationError && error.code === 'SYNC_SNAPSHOT_TOO_LARGE',
          );
          assert.ok(
            maximumBatch > 0 && maximumBatch <= 100,
            `Read ${maximumBatch} records at once before the snapshot capacity check.`,
          );
          assert.equal(
            (await pool.query('SELECT 1 FROM sync_snapshots WHERE request_id=$1', [requestId]))
              .rowCount,
            0,
          );
        } finally {
          await observedPool.end();
        }
      },
    );
  } finally {
    await pool.end();
    await rm(directory, { recursive: true, force: true });
  }
});
