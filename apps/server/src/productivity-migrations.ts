import type { Pool } from 'pg';
import { transaction } from './database.js';
export async function migrateProductivity(pool: Pool): Promise<void> {
  await transaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(7311021)');
    if ((await client.query('SELECT version FROM application_migrations WHERE version=7')).rowCount)
      return;
    await client.query(`
 CREATE TABLE boards(id uuid PRIMARY KEY,owner_id text NOT NULL REFERENCES "user"(id),revision integer NOT NULL CHECK(revision>0),value jsonb NOT NULL,UNIQUE(owner_id,id));
 CREATE TABLE projects(id uuid PRIMARY KEY,owner_id text NOT NULL REFERENCES "user"(id),revision integer NOT NULL CHECK(revision>0),value jsonb NOT NULL,UNIQUE(owner_id,id));
 CREATE TABLE recurrence_series(id uuid PRIMARY KEY,owner_id text NOT NULL REFERENCES "user"(id),revision integer NOT NULL CHECK(revision>0),value jsonb NOT NULL,UNIQUE(owner_id,id));
 ALTER TABLE tasks ADD COLUMN organization jsonb NOT NULL DEFAULT '{"boardId":null,"columnId":null,"projectId":null,"tags":[],"priority":"none"}';
 ALTER TABLE tasks ADD COLUMN schedule jsonb NOT NULL DEFAULT '{"dueAt":null,"scheduledAt":null,"seriesId":null,"occurrenceKey":null,"skippedAt":null}';
 ALTER TABLE tasks ADD COLUMN paused boolean NOT NULL DEFAULT false;
 ALTER TABLE tasks ADD COLUMN final_review_required boolean NOT NULL DEFAULT false;
 ALTER TABLE tasks ADD COLUMN final_review_satisfied boolean NOT NULL DEFAULT false;
 ALTER TABLE tasks ADD CONSTRAINT tasks_owner_identity UNIQUE(owner_id,id);
 ALTER TABLE tasks ADD COLUMN board_id uuid, ADD COLUMN project_id uuid, ADD COLUMN series_id uuid;
 ALTER TABLE tasks ADD CONSTRAINT task_board_owner FOREIGN KEY(owner_id,board_id) REFERENCES boards(owner_id,id);
 ALTER TABLE tasks ADD CONSTRAINT task_project_owner FOREIGN KEY(owner_id,project_id) REFERENCES projects(owner_id,id);
 ALTER TABLE tasks ADD CONSTRAINT task_series_owner FOREIGN KEY(owner_id,series_id) REFERENCES recurrence_series(owner_id,id);
 CREATE UNIQUE INDEX task_series_occurrence ON tasks(owner_id,series_id,(schedule->>'occurrenceKey')) WHERE series_id IS NOT NULL;
 CREATE TABLE task_steps(id uuid PRIMARY KEY,deleted_at timestamptz,owner_id text NOT NULL REFERENCES "user"(id),task_id uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),value jsonb NOT NULL,FOREIGN KEY(owner_id,task_id) REFERENCES tasks(owner_id,id));
 CREATE INDEX task_steps_parent ON task_steps(owner_id,task_id);
 INSERT INTO application_migrations(version) VALUES(7);
 `);
  });
}
