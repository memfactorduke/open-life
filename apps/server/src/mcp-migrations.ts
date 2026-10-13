import type { Pool } from 'pg';
import { transaction } from './database.js';
export async function migrateMcp(pool: Pool): Promise<void> {
  await transaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(7311021)');
    if ((await client.query('SELECT version FROM application_migrations WHERE version=8')).rowCount)
      return;
    await client.query(`
CREATE TABLE agent_grants(id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES "user"(id), label text NOT NULL CHECK(length(label) BETWEEN 1 AND 100), verifier text NOT NULL UNIQUE CHECK(verifier ~ '^[a-f0-9]{64}$'), scopes text[] NOT NULL CHECK(cardinality(scopes) BETWEEN 1 AND 9), expires_at timestamptz NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), issue_operation_id uuid NOT NULL, UNIQUE(owner_id,issue_operation_id), CHECK(expires_at>created_at));
ALTER TABLE operation_receipts DROP CONSTRAINT operation_receipts_actor_id_fkey;
ALTER TABLE audit_events DROP CONSTRAINT audit_events_actor_id_fkey;
ALTER TABLE audit_events DROP CONSTRAINT audit_events_actor_type_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_actor_type_check CHECK(actor_type IN ('owner','agent','local-administrator','system'));
ALTER TABLE task_history DROP CONSTRAINT IF EXISTS task_history_actor_id_fkey;
ALTER TABLE task_history ADD COLUMN IF NOT EXISTS actor_type text NOT NULL DEFAULT 'human' CHECK(actor_type IN('human','agent'));
ALTER TABLE workout_session_history DROP CONSTRAINT IF EXISTS workout_session_history_actor_id_fkey;
ALTER TABLE workout_session_history ADD COLUMN IF NOT EXISTS actor_type text NOT NULL DEFAULT 'owner' CHECK(actor_type IN('owner','agent'));
ALTER TABLE food_history ADD COLUMN IF NOT EXISTS actor_id text;
UPDATE food_history h SET actor_id=e.owner_id FROM food_entries e WHERE e.id=h.entry_id AND h.actor_id IS NULL;
ALTER TABLE food_history ALTER COLUMN actor_id SET NOT NULL;
ALTER TABLE food_history ADD COLUMN IF NOT EXISTS actor_type text NOT NULL DEFAULT 'owner' CHECK(actor_type IN('owner','agent'));
CREATE TABLE agent_provenance(owner_id text NOT NULL REFERENCES "user"(id),actor_id uuid NOT NULL REFERENCES agent_grants(id),operation_id uuid NOT NULL,source jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(actor_id,operation_id));
CREATE FUNCTION validate_product_actor() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE agent boolean; actor_owner text;
BEGIN
 IF TG_TABLE_NAME='operation_receipts' THEN
  IF EXISTS(SELECT 1 FROM "user" WHERE id=NEW.actor_id) OR EXISTS(SELECT 1 FROM agent_grants WHERE id::text=NEW.actor_id) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Unknown operation actor' USING ERRCODE='23503';
 END IF;
 agent=NEW.actor_type='agent';
 IF agent THEN SELECT owner_id INTO actor_owner FROM agent_grants WHERE id::text=NEW.actor_id;
 ELSE SELECT id INTO actor_owner FROM "user" WHERE id=NEW.actor_id; END IF;
 IF actor_owner IS NULL THEN RAISE EXCEPTION 'Unknown product actor' USING ERRCODE='23503'; END IF;
 IF TG_TABLE_NAME IN('task_history','workout_session_history') THEN IF actor_owner<>NEW.owner_id THEN RAISE EXCEPTION 'Actor owner mismatch' USING ERRCODE='23503'; END IF; END IF;
 IF TG_TABLE_NAME='food_history' THEN IF NOT EXISTS(SELECT 1 FROM food_entries WHERE id=NEW.entry_id AND owner_id=actor_owner) THEN RAISE EXCEPTION 'Actor owner mismatch' USING ERRCODE='23503'; END IF; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER actor_identity BEFORE INSERT OR UPDATE ON operation_receipts FOR EACH ROW EXECUTE FUNCTION validate_product_actor();
CREATE TRIGGER actor_identity BEFORE INSERT OR UPDATE ON audit_events FOR EACH ROW EXECUTE FUNCTION validate_product_actor();
CREATE TRIGGER actor_identity BEFORE INSERT OR UPDATE ON task_history FOR EACH ROW EXECUTE FUNCTION validate_product_actor();
CREATE TRIGGER actor_identity BEFORE INSERT OR UPDATE ON workout_session_history FOR EACH ROW EXECUTE FUNCTION validate_product_actor();
CREATE TRIGGER actor_identity BEFORE INSERT OR UPDATE ON food_history FOR EACH ROW EXECUTE FUNCTION validate_product_actor();
ALTER TABLE agent_grants ADD CONSTRAINT valid_agent_scopes CHECK(scopes <@ ARRAY['tasks:read','tasks:write','workouts:read','workouts:plan','workouts:record','food:read','food:write','food:attach','whoop:read']::text[]);
INSERT INTO application_migrations(version) VALUES(8);`);
  });
}
