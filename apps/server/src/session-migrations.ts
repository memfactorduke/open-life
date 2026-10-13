import type { Pool } from 'pg';
import { transaction } from './database.js';
export async function migrateSessions(pool: Pool): Promise<void> {
  await transaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(7311021)');
    if ((await client.query('SELECT version FROM application_migrations WHERE version=4')).rowCount)
      return;
    await client.query(`
CREATE TABLE workout_sessions(id uuid PRIMARY KEY,owner_id text NOT NULL REFERENCES "user"(id),revision integer NOT NULL CHECK(revision>0),status text NOT NULL CHECK(status IN ('active','completed','abandoned')),value jsonb NOT NULL,started_at timestamptz NOT NULL,updated_at timestamptz NOT NULL);
CREATE UNIQUE INDEX one_active_workout_per_owner ON workout_sessions(owner_id) WHERE status='active';
CREATE INDEX workout_sessions_history_order ON workout_sessions(owner_id,started_at DESC,id DESC);
CREATE TABLE workout_session_history(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,session_id uuid NOT NULL REFERENCES workout_sessions(id),owner_id text NOT NULL REFERENCES "user"(id),actor_id text NOT NULL,actor_type text NOT NULL CHECK(actor_type IN ('owner','agent')),reason text,operation_id uuid NOT NULL,event_type text NOT NULL,revision integer NOT NULL,value jsonb NOT NULL,created_at timestamptz NOT NULL,UNIQUE(session_id,revision));
INSERT INTO application_migrations(version) VALUES(4);`);
  });
}
