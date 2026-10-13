import type { Pool } from 'pg';
export async function migratePortability(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock_shared(7311027)');
    await client.query('SELECT pg_advisory_xact_lock(7311021)');
    await client.query(
      `CREATE TABLE IF NOT EXISTS portability_control(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), maintenance boolean NOT NULL DEFAULT false, entered_at timestamptz, restored_from timestamptz, restored_at timestamptz); INSERT INTO portability_control(singleton) VALUES(true) ON CONFLICT DO NOTHING; INSERT INTO application_migrations(version) VALUES(13) ON CONFLICT DO NOTHING`,
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
