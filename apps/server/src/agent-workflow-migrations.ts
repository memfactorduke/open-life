import type { Pool } from 'pg';
import { transaction } from './database.js';
export async function migrateAgentWorkflows(pool: Pool) {
  await transaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(7311021)');
    if ((await client.query('SELECT version FROM application_migrations WHERE version=9')).rowCount)
      return;
    await client.query(`
      CREATE TABLE agent_skills(id uuid PRIMARY KEY,owner_id text NOT NULL REFERENCES "user"(id),value jsonb NOT NULL);
      CREATE TABLE agent_bindings(step_id uuid PRIMARY KEY REFERENCES task_steps(id),owner_id text NOT NULL REFERENCES "user"(id),task_id uuid NOT NULL,value jsonb NOT NULL);
      CREATE TABLE agent_attempts(id uuid PRIMARY KEY,owner_id text NOT NULL REFERENCES "user"(id),task_id uuid NOT NULL,step_id uuid NOT NULL REFERENCES task_steps(id),token_verifier text NOT NULL,value jsonb NOT NULL);
      CREATE INDEX agent_attempts_step ON agent_attempts(owner_id,step_id);
      CREATE TABLE agent_results(id uuid PRIMARY KEY,owner_id text NOT NULL REFERENCES "user"(id),task_id uuid NOT NULL,step_id uuid NOT NULL REFERENCES task_steps(id),attempt_id uuid NOT NULL REFERENCES agent_attempts(id),version integer NOT NULL CHECK(version>0),value jsonb NOT NULL,UNIQUE(step_id,version));
      INSERT INTO application_migrations(version) VALUES(9);
    `);
  });
}
