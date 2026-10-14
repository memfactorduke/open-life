import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool, type PoolClient } from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import { getMigrations } from 'better-auth/db/migration';
import { defaultPreferences } from '@mems-life/domain';
import { createAuth } from './auth.js';
import type { Config } from './config.js';
import { ApplicationError } from './errors.js';
import { migrateFeatures, seedOwnerProducts } from './feature-migrations.js';
import { migrateSessions } from './session-migrations.js';
import { migrateFood } from './food-migrations.js';
import { migrateWhoop } from './whoop-migrations.js';
import { migrateProductivity } from './productivity-migrations.js';
import { migrateMcp } from './mcp-migrations.js';
import { migrateAgentWorkflows } from './agent-workflow-migrations.js';
import { migrateReleaseReconciliation } from './release-reconciliation-migrations.js';
import { migrateTaskFiles } from './task-file-migrations.js';
import { migrateSync } from './sync-migrations.js';
import { migratePortability } from './portability-migrations.js';
import { migrateAttention } from './attention-migrations.js';
import { migrateRcHardening } from './rc-hardening-migrations.js';
import { beginMaintenanceWrite, MAINTENANCE_LOCK } from './portability.js';

const migrationContext = new AsyncLocalStorage<boolean>();

export async function transaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
  options: { maintenanceExempt?: boolean; isolation?: 'repeatable-read' } = {},
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(
      options.isolation === 'repeatable-read' ? 'BEGIN ISOLATION LEVEL REPEATABLE READ' : 'BEGIN',
    );
    if (options.maintenanceExempt || migrationContext.getStore())
      await client.query('SELECT pg_advisory_xact_lock_shared($1)', [MAINTENANCE_LOCK]);
    else await beginMaintenanceWrite(client);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function createTransactionAuth(
  config: Config,
  client: PoolClient,
  reset?: (token: string) => void,
) {
  const db = new Kysely<unknown>({
    dialect: new PostgresDialect({
      pool: {
        connect: async () => ({ query: client.query.bind(client), release() {} }),
        end: async () => {},
      },
    }),
  });
  return createAuth(config, { db, type: 'postgres', transaction: false }, reset);
}

export async function migrate(pool: Pool, config: Config): Promise<void> {
  await migrationContext.run(true, () => migrateInstallation(pool, config));
}

async function migrateInstallation(pool: Pool, config: Config): Promise<void> {
  await transaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(7311021)');
    const auth = createTransactionAuth(config, client);
    const migration = await getMigrations(auth.options);
    await migration.runMigrations();
    await client.query(
      'CREATE TABLE IF NOT EXISTS application_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const applied = await client.query(
      'SELECT version FROM application_migrations WHERE version=1',
    );
    if (applied.rowCount) return;
    await client.query(`
      CREATE TABLE installation (
        singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
        id uuid NOT NULL UNIQUE,
        epoch uuid NOT NULL,
        feed_position bigint NOT NULL DEFAULT 0 CHECK(feed_position >= 0),
        owner_id text NOT NULL UNIQUE REFERENCES "user"(id),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS owner_preferences (
        owner_id text PRIMARY KEY REFERENCES "user"(id),
        revision integer NOT NULL CHECK(revision >= 0),
        value jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS operation_receipts (
        actor_id text NOT NULL REFERENCES "user"(id),
        operation_id uuid NOT NULL,
        request jsonb NOT NULL,
        response jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(actor_id, operation_id)
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        actor_id text NOT NULL REFERENCES "user"(id),
        actor_type text NOT NULL CHECK(actor_type IN ('owner','local-administrator')),
        operation_id uuid NOT NULL,
        event_type text NOT NULL,
        record_id text NOT NULL,
        revision integer,
        value jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS change_feed (
        position bigint NOT NULL,
        ordinal integer NOT NULL DEFAULT 0 CHECK(ordinal >= 0),
        owner_id text NOT NULL REFERENCES "user"(id),
        operation_id uuid NOT NULL,
        record_type text NOT NULL,
        record_id text NOT NULL,
        revision integer NOT NULL,
        value jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(owner_id,position,ordinal)
      );
      INSERT INTO application_migrations(version) VALUES(1);
    `);
  });
  await migrateFeatures(pool);
  await migrateSessions(pool);
  await migrateFood(pool);
  await migrateWhoop(pool);
  await migrateProductivity(pool);
  await migrateMcp(pool);
  await migrateAgentWorkflows(pool);
  await migrateReleaseReconciliation(pool);
  await migrateTaskFiles(pool);
  await migrateSync(pool);
  await migratePortability(pool);
  await migrateAttention(pool);
  await migrateRcHardening(pool);
}

export async function bootstrapOwner(
  pool: Pool,
  config: Config,
  input: { email: string; name: string; password: string },
): Promise<string> {
  return transaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(7311021)');
    const existing = await client.query('SELECT id FROM installation');
    if (existing.rowCount)
      throw new ApplicationError(
        409,
        'OWNER_EXISTS',
        'An owner already exists. Use local recovery.',
      );
    const auth = createTransactionAuth(config, client);
    const { user } = await auth.api.createUser({ body: { ...input, role: 'user' } });
    const installationId = randomUUID();
    await client.query('INSERT INTO installation(id,owner_id,epoch) VALUES($1,$2,$3)', [
      installationId,
      user.id,
      randomUUID(),
    ]);
    await client.query('INSERT INTO owner_preferences(owner_id,revision,value) VALUES($1,0,$2)', [
      user.id,
      defaultPreferences({ name: user.name }),
    ]);
    await seedOwnerProducts(client, user.id);
    await client.query(
      "INSERT INTO audit_events(actor_id,actor_type,operation_id,event_type,record_id) VALUES($1,'local-administrator',$2,'owner.bootstrapped',$1)",
      [user.id, randomUUID()],
    );
    return installationId;
  });
}

export async function recoverOwner(pool: Pool, config: Config, password: string): Promise<void> {
  await transaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(7311021)');
    const owner = await client.query<{ owner_id: string; email: string }>(
      'SELECT i.owner_id,u.email FROM installation i JOIN "user" u ON u.id=i.owner_id FOR UPDATE OF i',
    );
    const row = owner.rows[0];
    if (!row)
      throw new ApplicationError(
        409,
        'OWNER_MISSING',
        'Bootstrap the installation before recovery.',
      );
    let resetToken: string | undefined;
    const auth = createTransactionAuth(config, client, (token) => {
      resetToken = token;
    });
    await auth.api.requestPasswordReset({ body: { email: row.email } });
    if (!resetToken) throw new Error('Local password reset did not produce a token.');
    await auth.api.resetPassword({ body: { newPassword: password, token: resetToken } });
    await client.query(
      "INSERT INTO audit_events(actor_id,actor_type,operation_id,event_type,record_id) VALUES($1,'local-administrator',$2,'owner.recovered',$1)",
      [row.owner_id, randomUUID()],
    );
  });
}
