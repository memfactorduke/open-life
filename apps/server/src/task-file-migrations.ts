import type { Pool } from 'pg';
import { transaction } from './database.js';
export async function migrateTaskFiles(pool: Pool) {
  await transaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(7311021)');
    if (
      (await client.query('SELECT version FROM application_migrations WHERE version=11')).rowCount
    )
      return;
    await client.query(
      `CREATE TABLE task_files(id uuid PRIMARY KEY,task_id uuid NOT NULL REFERENCES tasks(id),owner_id text NOT NULL REFERENCES "user"(id),name text NOT NULL,status text NOT NULL CHECK(status IN('pending','received','finalized')),size integer NOT NULL CHECK(size>0 AND size<=52428800),sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),content_type text NOT NULL CHECK(content_type IN('text/plain','text/markdown','application/pdf','image/png','image/jpeg','video/mp4')),created_at timestamptz NOT NULL DEFAULT now(),detached_at timestamptz); CREATE INDEX task_files_task ON task_files(owner_id,task_id); INSERT INTO application_migrations(version) VALUES(11);`,
    );
  });
}
