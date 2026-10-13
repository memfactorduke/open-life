import type { Pool } from 'pg';
import { transaction } from './database.js';
export async function migrateFood(pool: Pool): Promise<void> {
  await transaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(7311021)');
    if ((await client.query('SELECT version FROM application_migrations WHERE version=5')).rowCount)
      return;
    await client.query(`
   CREATE TABLE food_entries(id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES "user"(id), revision integer NOT NULL CHECK(revision>0), value jsonb NOT NULL, occurred_at timestamptz NOT NULL, deleted_at timestamptz);
   CREATE INDEX food_daily ON food_entries(owner_id,occurred_at);
   CREATE TABLE food_history(entry_id uuid NOT NULL REFERENCES food_entries(id), revision integer NOT NULL, operation_id uuid NOT NULL, event_type text NOT NULL, actor_id text NOT NULL, actor_type text NOT NULL CHECK(actor_type IN('owner','agent')), value jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(entry_id,revision));
   CREATE TABLE food_media(id uuid PRIMARY KEY, entry_id uuid NOT NULL REFERENCES food_entries(id), owner_id text NOT NULL REFERENCES "user"(id), status text NOT NULL CHECK(status IN('pending','received','finalized')), size integer NOT NULL CHECK(size>0 AND size<=8388608), sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), content_type text NOT NULL CHECK(content_type IN('image/jpeg','image/png')), created_at timestamptz NOT NULL DEFAULT now(), detached_at timestamptz);
   INSERT INTO application_migrations(version) VALUES(5);
  `);
  });
}
