import type { Pool } from 'pg';
import { transaction } from './database.js';
export async function migrateAttention(pool: Pool) {
  await transaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock_shared(7311027)');
    await client.query('SELECT pg_advisory_xact_lock(7311021)');
    if (
      (await client.query('SELECT version FROM application_migrations WHERE version=14')).rowCount
    )
      return;
    await client.query(`
      CREATE TABLE notification_preferences(owner_id text PRIMARY KEY REFERENCES "user"(id),revision integer NOT NULL DEFAULT 0,value jsonb NOT NULL DEFAULT '{"enabled":false,"due":false,"handoff":false,"failure":false}');
      CREATE TABLE notification_devices(id uuid PRIMARY KEY,owner_id text NOT NULL REFERENCES "user"(id),session_id text NOT NULL,token text NOT NULL UNIQUE,active boolean NOT NULL DEFAULT true,registered_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE attention_events(id uuid PRIMARY KEY,owner_id text NOT NULL REFERENCES "user"(id),dedupe_key text NOT NULL,source_id uuid NOT NULL,source_revision integer NOT NULL,value jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),active boolean NOT NULL DEFAULT true,UNIQUE(owner_id,dedupe_key));
      CREATE TABLE notification_deliveries(event_id uuid NOT NULL REFERENCES attention_events(id),device_id uuid NOT NULL REFERENCES notification_devices(id),status text NOT NULL CHECK(status IN('pending','accepted','provider-accepted','errored','suppressed')),attempts integer NOT NULL DEFAULT 0,ticket_id text,error text,next_attempt_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(event_id,device_id));
      INSERT INTO application_migrations(version) VALUES(14);
    `);
  });
}
