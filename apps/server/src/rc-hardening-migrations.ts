import type { Pool } from 'pg';
import { transaction } from './database.js';

export async function migrateRcHardening(pool: Pool): Promise<void> {
  await transaction(
    pool,
    async (client) => {
      await client.query('SELECT pg_advisory_xact_lock_shared(7311027)');
      await client.query('SELECT pg_advisory_xact_lock(7311021)');
      if (
        (await client.query('SELECT version FROM application_migrations WHERE version=15')).rowCount
      )
        return;
      await client.query(`
      CREATE INDEX audit_events_operation ON audit_events(actor_id,operation_id);
      CREATE INDEX agent_attempts_latest ON agent_attempts(owner_id,step_id,(value->>'createdAt') DESC,id DESC);
      INSERT INTO application_migrations(version) VALUES(15);
    `);
    },
    { maintenanceExempt: true },
  );
}
