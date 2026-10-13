import type { Pool } from 'pg';
import { transaction } from './database.js';
export async function migrateWhoop(pool: Pool): Promise<void> {
  await transaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(7311021)');
    if ((await client.query('SELECT version FROM application_migrations WHERE version=6')).rowCount)
      return;
    await client.query(`
   CREATE TABLE whoop_connection(owner_id text PRIMARY KEY REFERENCES "user"(id),revision integer NOT NULL DEFAULT 0,status text NOT NULL DEFAULT 'disconnected',account_id uuid,provider_account_id text,pending_state text,connected_at timestamptz,tokens text,expires_at timestamptz,last_success_at timestamptz,last_attempt_at timestamptz,next_refresh_at timestamptz,error text);
   CREATE TABLE whoop_credentials(owner_id text PRIMARY KEY REFERENCES "user"(id),account_id uuid NOT NULL,tokens text NOT NULL,expires_at timestamptz NOT NULL);
   CREATE TABLE whoop_states(state_hash text PRIMARY KEY,owner_id text NOT NULL REFERENCES "user"(id),session_id text NOT NULL,channel text NOT NULL,expires_at timestamptz NOT NULL);
   CREATE TABLE whoop_observations(owner_id text NOT NULL REFERENCES "user"(id),account_id uuid NOT NULL,provider_account_id text NOT NULL,resource text NOT NULL,provider_id text NOT NULL,revision integer NOT NULL DEFAULT 1,payload jsonb NOT NULL,retrieved_at timestamptz NOT NULL,available boolean NOT NULL DEFAULT true,linked_session_id uuid,PRIMARY KEY(owner_id,account_id,resource,provider_id));
   CREATE UNIQUE INDEX whoop_unique_session_link ON whoop_observations(owner_id,account_id,linked_session_id) WHERE linked_session_id IS NOT NULL;
   CREATE TABLE whoop_history(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,owner_id text NOT NULL REFERENCES "user"(id),actor_type text NOT NULL,operation_id uuid NOT NULL,event_type text NOT NULL,value jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
   ALTER TABLE audit_events DROP CONSTRAINT audit_events_actor_type_check;
   ALTER TABLE audit_events ADD CONSTRAINT audit_events_actor_type_check CHECK(actor_type IN ('owner','agent','local-administrator','system'));
   INSERT INTO application_migrations(version) VALUES(6);
  `);
  });
}
