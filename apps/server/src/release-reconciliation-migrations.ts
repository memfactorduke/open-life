import type { Pool } from 'pg';
import { transaction } from './database.js';

/** Forward repair for installations that applied earlier drafts of versions 4–8.
 * Never replay a numbered migration or reset an installation to reconcile its schema.
 */
export async function migrateReleaseReconciliation(pool: Pool): Promise<void> {
  await transaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(7311021)');
    if (
      (await client.query('SELECT version FROM application_migrations WHERE version=10')).rowCount
    )
      return;
    await client.query(`
      ALTER TABLE whoop_connection ADD COLUMN IF NOT EXISTS pending_state text;
      CREATE TABLE IF NOT EXISTS whoop_credentials (
        owner_id text PRIMARY KEY REFERENCES "user"(id), account_id uuid NOT NULL,
        tokens text NOT NULL, expires_at timestamptz NOT NULL
      );
      DO $$ BEGIN
        IF EXISTS(SELECT 1 FROM whoop_connection WHERE status='connected' AND tokens IS NOT NULL
          AND (account_id IS NULL OR expires_at IS NULL)) THEN
          RAISE EXCEPTION 'Connected WHOOP credential metadata is incomplete; repair metadata before upgrading';
        END IF;
        IF EXISTS(SELECT 1 FROM whoop_connection w JOIN whoop_credentials c USING(owner_id)
          WHERE w.status='connected' AND w.account_id IS DISTINCT FROM c.account_id) THEN
          RAISE EXCEPTION 'Connected WHOOP credential account metadata conflicts; reconcile metadata before upgrading';
        END IF;
      END $$;
      -- Copy encrypted ciphertext inside PostgreSQL: no decryption or credential logging.
      -- A credential row already saved by the new refresh path is authoritative.
      INSERT INTO whoop_credentials(owner_id,account_id,tokens,expires_at)
        SELECT owner_id,account_id,tokens,expires_at FROM whoop_connection
        WHERE status='connected' AND tokens IS NOT NULL
        ON CONFLICT(owner_id) DO NOTHING;
      DO $$ BEGIN
        IF EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname=current_schema()
          AND indexname='whoop_unique_session_link'
          AND indexdef NOT LIKE '%(owner_id, account_id, linked_session_id)%') THEN
          DROP INDEX whoop_unique_session_link;
        END IF;
      END $$;
      CREATE UNIQUE INDEX IF NOT EXISTS whoop_unique_session_link
        ON whoop_observations(owner_id,account_id,linked_session_id)
        WHERE linked_session_id IS NOT NULL;
      ALTER TABLE workout_session_history DROP CONSTRAINT IF EXISTS workout_session_history_actor_id_fkey;
      ALTER TABLE workout_session_history ADD COLUMN IF NOT EXISTS actor_type text NOT NULL DEFAULT 'owner'
        CHECK(actor_type IN('owner','agent'));
      ALTER TABLE workout_session_history ADD COLUMN IF NOT EXISTS reason text;
      ALTER TABLE task_history DROP CONSTRAINT IF EXISTS task_history_actor_id_fkey;
      ALTER TABLE task_history ADD COLUMN IF NOT EXISTS actor_type text NOT NULL DEFAULT 'human'
        CHECK(actor_type IN('human','agent'));
      ALTER TABLE food_history ADD COLUMN IF NOT EXISTS actor_id text;
      UPDATE food_history h SET actor_id=e.owner_id FROM food_entries e
        WHERE e.id=h.entry_id AND h.actor_id IS NULL;
      ALTER TABLE food_history ALTER COLUMN actor_id SET NOT NULL;
      ALTER TABLE food_history DROP CONSTRAINT IF EXISTS food_history_actor_id_fkey;
      ALTER TABLE food_history ADD COLUMN IF NOT EXISTS actor_type text NOT NULL DEFAULT 'owner'
        CHECK(actor_type IN('owner','agent'));
      ALTER TABLE task_steps ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
      ALTER TABLE operation_receipts DROP CONSTRAINT IF EXISTS operation_receipts_actor_id_fkey;
      ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_actor_id_fkey;
      ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_actor_type_check;
      ALTER TABLE audit_events ADD CONSTRAINT audit_events_actor_type_check
        CHECK(actor_type IN ('owner','agent','local-administrator','system'));
      DO $$ BEGIN
        IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='agent_grants'::regclass
          AND conname='valid_agent_scopes') THEN
          ALTER TABLE agent_grants ADD CONSTRAINT valid_agent_scopes
            CHECK(scopes <@ ARRAY['tasks:read','tasks:write','workouts:read','workouts:plan','workouts:record','food:read','food:write','food:attach','whoop:read']::text[]);
        END IF;
      END $$;
      CREATE OR REPLACE FUNCTION validate_product_actor() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE actor_owner text;
      BEGIN
        IF TG_TABLE_NAME='operation_receipts' THEN
          IF EXISTS(SELECT 1 FROM "user" WHERE id=NEW.actor_id)
            OR EXISTS(SELECT 1 FROM agent_grants WHERE id::text=NEW.actor_id) THEN RETURN NEW; END IF;
          RAISE EXCEPTION 'Unknown operation actor' USING ERRCODE='23503';
        END IF;
        IF NEW.actor_type='agent' THEN
          SELECT owner_id INTO actor_owner FROM agent_grants WHERE id::text=NEW.actor_id;
        ELSE SELECT id INTO actor_owner FROM "user" WHERE id=NEW.actor_id; END IF;
        IF actor_owner IS NULL THEN RAISE EXCEPTION 'Unknown product actor' USING ERRCODE='23503'; END IF;
        IF TG_TABLE_NAME IN('task_history','workout_session_history') THEN
          IF actor_owner<>NEW.owner_id THEN
            RAISE EXCEPTION 'Actor owner mismatch' USING ERRCODE='23503';
          END IF;
        END IF;
        IF TG_TABLE_NAME='food_history' THEN
          IF NOT EXISTS(SELECT 1 FROM food_entries WHERE id=NEW.entry_id AND owner_id=actor_owner) THEN
            RAISE EXCEPTION 'Actor owner mismatch' USING ERRCODE='23503';
          END IF;
        END IF;
        RETURN NEW;
      END $$;
      DO $$ DECLARE target text; BEGIN
        FOREACH target IN ARRAY ARRAY['operation_receipts','audit_events','task_history','workout_session_history','food_history'] LOOP
          EXECUTE format('DROP TRIGGER IF EXISTS actor_identity ON %I',target);
          EXECUTE format('CREATE TRIGGER actor_identity BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION validate_product_actor()',target);
        END LOOP;
      END $$;
      INSERT INTO application_migrations(version) VALUES(10);
    `);
  });
}
