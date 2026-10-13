import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Pool } from 'pg';
import { migrate } from '../src/database.js';
import { readConfig } from '../src/config.js';
import { migrateReleaseReconciliation } from '../src/release-reconciliation-migrations.js';

const databaseUrl =
  process.env.RECONCILIATION_TEST_DATABASE_URL ??
  'postgresql://mems_life@127.0.0.1:55432/mems_life_reconciliation_test';
if (new URL(databaseUrl).pathname !== '/mems_life_reconciliation_test')
  throw new Error('Reconciliation tests require isolated mems_life_reconciliation_test database.');
const config = readConfig({
  DATABASE_URL: databaseUrl,
  BETTER_AUTH_SECRET: 'fictional-reconciliation-secret-minimum-length',
  BETTER_AUTH_URL: 'http://localhost:3001',
  WEB_ORIGIN: 'http://localhost:5173',
  NODE_ENV: 'test',
});
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// Capture row hashes in SQL without displaying record or credential contents. Existing
// columns are projected explicitly so added columns do not disguise a changed old row.
async function snapshot(pool: Pool) {
  const tables = (
    await pool.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_type='BASE TABLE'
    AND table_name NOT IN ('application_migrations','whoop_credentials') ORDER BY table_name`)
  ).rows;
  const result = [];
  for (const { table_name } of tables) {
    const columns = (
      await pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
        [table_name],
      )
    ).rows.map((r) => r.column_name);
    const projection = columns.map((c) => `"${c}"`).join(',');
    const sql = `SELECT md5(COALESCE(jsonb_agg(row_data ORDER BY row_data::text),'[]'::jsonb)::text) AS digest
      FROM (SELECT to_jsonb(r) AS row_data FROM (SELECT ${projection} FROM "${table_name}") r) rows`;
    result.push({ table_name, columns, sql, digest: (await pool.query(sql)).rows[0].digest });
  }
  return result;
}

test('forward repair preserves an earlier installed schema and records, ciphertext, actor safety and idempotency', async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await migrate(pool, config);
    await migrateReleaseReconciliation(pool); // Already-current fresh schema is also supported.
    await pool.query(`INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt")
      VALUES('fixture-owner','Fictional owner','owner@example.test',true,now(),now()),
      ('fixture-other','Fictional other','other@example.test',true,now(),now());
      INSERT INTO installation(id,epoch,owner_id,feed_position) VALUES('${id(1)}','${id(2)}','fixture-owner',17);
      INSERT INTO owner_preferences(owner_id,revision,value) VALUES('fixture-owner',4,'{"fixture":true}');
      INSERT INTO tasks(id,owner_id,revision,phase,content,sort_order,created_at,updated_at)
        VALUES('${id(3)}','fixture-owner',2,'active','{"title":"Fictional task"}',0,now(),now());
      INSERT INTO task_history(task_id,owner_id,actor_id,operation_id,event_type,revision,task,created_at)
        VALUES('${id(3)}','fixture-owner','fixture-owner','${id(4)}','task.created',1,'{}',now());
      INSERT INTO exercises(id,owner_id,revision,origin,content,created_at,updated_at)
        VALUES('${id(5)}','fixture-owner',1,'custom','{}',now(),now());
      INSERT INTO routines(id,owner_id,revision,content,created_at,updated_at)
        VALUES('${id(6)}','fixture-owner',1,'{}',now(),now());
      INSERT INTO routine_exercises(routine_id,item_id,exercise_id,ordinal,owner_id)
        VALUES('${id(6)}','${id(7)}','${id(5)}',0,'fixture-owner');
      INSERT INTO workout_sessions(id,owner_id,revision,status,value,started_at,updated_at)
        VALUES('${id(8)}','fixture-owner',2,'completed','{}',now(),now());
      INSERT INTO workout_session_history(session_id,owner_id,actor_id,actor_type,operation_id,event_type,revision,value,created_at)
        VALUES('${id(8)}','fixture-owner','fixture-owner','owner','${id(9)}','session.completed',2,'{}',now());
      INSERT INTO food_entries(id,owner_id,revision,value,occurred_at)
        VALUES('${id(10)}','fixture-owner',1,'{}',now());
      INSERT INTO food_history(entry_id,revision,operation_id,event_type,actor_id,actor_type,value)
        VALUES('${id(10)}',1,'${id(11)}','food.created','fixture-owner','owner','{}');
      INSERT INTO food_media(id,entry_id,owner_id,status,size,sha256,content_type)
        VALUES('${id(12)}','${id(10)}','fixture-owner','pending',10,repeat('a',64),'image/jpeg');
      INSERT INTO boards(id,owner_id,revision,value) VALUES('${id(13)}','fixture-owner',1,'{}');
      INSERT INTO projects(id,owner_id,revision,value) VALUES('${id(14)}','fixture-owner',1,'{}');
      INSERT INTO recurrence_series(id,owner_id,revision,value) VALUES('${id(15)}','fixture-owner',1,'{}');
      INSERT INTO task_steps(id,owner_id,task_id,revision,value) VALUES('${id(16)}','fixture-owner','${id(3)}',1,'{}');
      INSERT INTO agent_grants(id,owner_id,label,verifier,scopes,expires_at,issue_operation_id)
        VALUES('${id(17)}','fixture-owner','Fictional grant',repeat('b',64),ARRAY['tasks:write'],now()+interval '1 day','${id(18)}');
      INSERT INTO audit_events(actor_id,actor_type,operation_id,event_type,record_id,value)
        VALUES('fixture-owner','owner','${id(19)}','fixture.saved','${id(3)}','{}');
      INSERT INTO operation_receipts(actor_id,operation_id,request,response)
        VALUES('fixture-owner','${id(19)}','{}','{"saved":true}');
      INSERT INTO change_feed(position,owner_id,operation_id,record_type,record_id,revision,value)
        VALUES(17,'fixture-owner','${id(19)}','task','${id(3)}',2,'{}');
      INSERT INTO whoop_connection(owner_id,status,account_id,tokens,expires_at)
        VALUES('fixture-owner','connected','${id(20)}','fictional-encrypted-ciphertext',now()+interval '1 hour');
      INSERT INTO whoop_states(state_hash,owner_id,session_id,channel,expires_at)
        VALUES(repeat('c',64),'fixture-owner','fictional-session','web',now()+interval '1 hour');
      INSERT INTO whoop_history(owner_id,actor_type,operation_id,event_type,value)
        VALUES('fixture-owner','owner','${id(24)}','fixture.connected','{}');
      INSERT INTO agent_provenance(owner_id,actor_id,operation_id,source)
        VALUES('fixture-owner','${id(17)}','${id(23)}','{}');
      INSERT INTO whoop_observations(owner_id,account_id,provider_account_id,resource,provider_id,payload,retrieved_at,linked_session_id)
        VALUES('fixture-owner','${id(20)}','fictional-provider','workout','fictional-workout','{}',now(),'${id(8)}');`);
    // Reproduce the earlier applied drafts, independently of fresh-install tests.
    await pool.query(`DELETE FROM application_migrations WHERE version=10;
      DROP TABLE whoop_credentials; ALTER TABLE whoop_connection DROP COLUMN pending_state;
      DROP INDEX whoop_unique_session_link;
      CREATE UNIQUE INDEX whoop_unique_session_link ON whoop_observations(owner_id,linked_session_id) WHERE linked_session_id IS NOT NULL;
      DROP TRIGGER actor_identity ON operation_receipts; DROP TRIGGER actor_identity ON audit_events;
      DROP TRIGGER actor_identity ON task_history; DROP TRIGGER actor_identity ON workout_session_history; DROP TRIGGER actor_identity ON food_history;
      ALTER TABLE workout_session_history DROP COLUMN reason; ALTER TABLE workout_session_history DROP COLUMN actor_type;
      ALTER TABLE workout_session_history ADD CONSTRAINT workout_session_history_actor_id_fkey FOREIGN KEY(actor_id) REFERENCES "user"(id);
      ALTER TABLE task_history DROP COLUMN actor_type;
      ALTER TABLE task_history ADD CONSTRAINT task_history_actor_id_fkey FOREIGN KEY(actor_id) REFERENCES "user"(id);
      ALTER TABLE food_history DROP COLUMN actor_id; ALTER TABLE food_history DROP COLUMN actor_type;
      ALTER TABLE task_steps DROP COLUMN deleted_at;
      ALTER TABLE agent_grants DROP CONSTRAINT valid_agent_scopes;
      ALTER TABLE operation_receipts ADD CONSTRAINT operation_receipts_actor_id_fkey FOREIGN KEY(actor_id) REFERENCES "user"(id);
      ALTER TABLE audit_events ADD CONSTRAINT audit_events_actor_id_fkey FOREIGN KEY(actor_id) REFERENCES "user"(id);`);
    const before = await snapshot(pool);
    await migrateReleaseReconciliation(pool);
    for (const row of before)
      assert.equal((await pool.query(row.sql)).rows[0].digest, row.digest, row.table_name);
    assert.equal(
      (
        await pool.query(`SELECT c.tokens=w.tokens AND c.expires_at=w.expires_at AND c.account_id=w.account_id AS intact
      FROM whoop_credentials c JOIN whoop_connection w USING(owner_id)`)
      ).rows[0].intact,
      true,
    );
    assert.equal(
      (await pool.query('SELECT actor_id,actor_type FROM food_history')).rows[0].actor_id,
      'fixture-owner',
    );
    await pool.query(`INSERT INTO whoop_observations(owner_id,account_id,provider_account_id,resource,provider_id,payload,retrieved_at,linked_session_id)
      VALUES('fixture-owner','${id(21)}','fictional-replacement','workout','replacement-workout','{}',now(),'${id(8)}')`);
    await assert.rejects(
      pool.query(
        `INSERT INTO operation_receipts(actor_id,operation_id,request,response) VALUES('unknown','${id(22)}','{}','{}')`,
      ),
      { code: '23503' },
    );
    await assert.rejects(
      pool.query(`INSERT INTO task_history(task_id,owner_id,actor_id,actor_type,operation_id,event_type,revision,task,created_at)
      VALUES('${id(3)}','fixture-owner','fixture-other','human','${id(22)}','fixture',3,'{}',now())`),
      { code: '23503' },
    );
    await assert.rejects(
      pool.query(`INSERT INTO workout_session_history(session_id,owner_id,actor_id,actor_type,operation_id,event_type,revision,value,created_at)
      VALUES('${id(8)}','fixture-owner','fixture-other','owner','${id(22)}','fixture',3,'{}',now())`),
      { code: '23503' },
    );
    await assert.rejects(
      pool.query(`INSERT INTO audit_events(actor_id,actor_type,operation_id,event_type,record_id)
      VALUES('unknown','agent','${id(22)}','fixture','${id(3)}')`),
      { code: '23503' },
    );
    await assert.rejects(
      pool.query(`INSERT INTO food_history(entry_id,revision,operation_id,event_type,actor_id,actor_type,value)
      VALUES('${id(10)}',2,'${id(22)}','fixture','fixture-other','owner','{}')`),
      { code: '23503' },
    );
    await assert.rejects(
      pool.query(`UPDATE agent_grants SET scopes=ARRAY['unknown:scope'] WHERE id='${id(17)}'`),
      { code: '23514' },
    );
    await pool.query(`INSERT INTO task_history(task_id,owner_id,actor_id,actor_type,operation_id,event_type,revision,task,created_at)
      VALUES('${id(3)}','fixture-owner','${id(17)}','agent','${id(23)}','fixture.agent',3,'{}',now())`);
    const repaired = await snapshot(pool);
    await migrateReleaseReconciliation(pool);
    for (const row of repaired)
      assert.equal((await pool.query(row.sql)).rows[0].digest, row.digest, row.table_name);
    assert.equal(
      (
        await pool.query(
          'SELECT count(*)::integer AS n FROM application_migrations WHERE version=10',
        )
      ).rows[0].n,
      1,
    );
    // A refreshed credential already stored separately must not be overwritten by
    // the legacy connection copy, and malformed metadata must roll back all repair.
    await pool.query(`UPDATE whoop_credentials SET tokens='fictional-newer-ciphertext';
      DELETE FROM application_migrations WHERE version=10;`);
    await migrateReleaseReconciliation(pool);
    assert.equal(
      (
        await pool.query(
          `SELECT tokens='fictional-newer-ciphertext' AS preserved FROM whoop_credentials`,
        )
      ).rows[0].preserved,
      true,
    );
    await pool.query(`DELETE FROM application_migrations WHERE version=10;
      ALTER TABLE whoop_connection DROP COLUMN pending_state;
      UPDATE whoop_connection SET expires_at=NULL;`);
    await assert.rejects(migrateReleaseReconciliation(pool), /credential metadata is incomplete/);
    assert.equal(
      (
        await pool.query(`SELECT count(*)::integer AS n FROM information_schema.columns
      WHERE table_name='whoop_connection' AND column_name='pending_state'`)
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await pool.query(
          'SELECT count(*)::integer AS n FROM application_migrations WHERE version=10',
        )
      ).rows[0].n,
      0,
    );
    await pool.query(`UPDATE whoop_connection SET expires_at=now()+interval '1 hour';`);
    await migrateReleaseReconciliation(pool);
  } finally {
    await pool.end();
  }
});
