import type { Pool } from 'pg';
import { transaction } from './database.js';
export async function migrateSync(pool: Pool): Promise<void> {
  await transaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(7311021)');
    if (
      (await client.query('SELECT version FROM application_migrations WHERE version=12')).rowCount
    )
      return;
    await client.query(`
      CREATE TABLE sync_snapshots(
        id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES "user"(id), request_id uuid NOT NULL,
        installation_id uuid NOT NULL, epoch uuid NOT NULL, watermark bigint NOT NULL CHECK(watermark>=0),
        schema_version integer NOT NULL CHECK(schema_version=1), expires_at timestamptz NOT NULL,
        UNIQUE(owner_id,request_id));
      CREATE TABLE sync_snapshot_records(
        snapshot_id uuid NOT NULL REFERENCES sync_snapshots(id) ON DELETE CASCADE,
        ordinal integer NOT NULL CHECK(ordinal>=0), record jsonb NOT NULL,
        PRIMARY KEY(snapshot_id,ordinal));
      CREATE INDEX sync_snapshot_expiry ON sync_snapshots(expires_at);
      CREATE TABLE sync_retention(owner_id text PRIMARY KEY REFERENCES "user"(id), floor bigint NOT NULL DEFAULT 0 CHECK(floor>=0));
      INSERT INTO application_migrations(version) VALUES(12);
    `);
  });
}
