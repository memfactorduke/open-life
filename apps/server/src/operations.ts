import type { Pool, PoolClient } from 'pg';
import {
  PreferencesRecordSchema,
  type PreferencesCommand,
  type PreferencesRecord,
} from '@mems-life/domain';
import { transaction } from './database.js';
import { ApplicationError } from './errors.js';

export type OwnerPrincipal = {
  userId: string;
  installationId: string;
  actorId?: string;
  actorType?: 'owner' | 'agent';
  expectedEpoch?: string;
};
export async function requireOwner(
  client: Pool | PoolClient,
  userId: string,
  expectedEpoch?: string,
): Promise<OwnerPrincipal> {
  const result = await client.query<{ id: string; epoch: string }>(
    'SELECT id,epoch FROM installation WHERE owner_id=$1',
    [userId],
  );
  const row = result.rows[0];
  if (!row)
    throw new ApplicationError(
      403,
      'OWNER_REQUIRED',
      'This account does not own the installation.',
    );
  if (expectedEpoch && expectedEpoch !== row.epoch)
    throw new ApplicationError(
      409,
      'SYNC_EPOCH_CHANGED',
      'The server was restored. Review saved local changes before sending them again.',
      { epoch: row.epoch },
    );
  return { userId, installationId: row.id, ...(expectedEpoch ? { expectedEpoch } : {}) };
}
export async function readPreferences(
  pool: Pool,
  actor: OwnerPrincipal,
): Promise<PreferencesRecord> {
  await requireOwner(pool, actor.userId);
  const result = await pool.query(
    'SELECT revision,value FROM owner_preferences WHERE owner_id=$1',
    [actor.userId],
  );
  return PreferencesRecordSchema.parse(result.rows[0]);
}
export async function updatePreferences(
  pool: Pool,
  actor: OwnerPrincipal,
  command: PreferencesCommand,
  authorizeAgain: (client: PoolClient) => Promise<void>,
): Promise<PreferencesRecord> {
  return transaction(pool, async (client) => {
    await client.query('SELECT id FROM installation WHERE owner_id=$1 FOR UPDATE', [actor.userId]);
    await requireOwner(client, actor.userId);
    await authorizeAgain(client);
    await requireOwner(client, actor.userId, actor.expectedEpoch);
    const receipt = await client.query<{ response: unknown; matches: boolean }>(
      'SELECT response,request=$3::jsonb AS matches FROM operation_receipts WHERE actor_id=$1 AND operation_id=$2',
      [actor.userId, command.operationId, JSON.stringify({ type: 'preferences.update', command })],
    );
    const previous = receipt.rows[0];
    if (previous) {
      if (!previous.matches)
        throw new ApplicationError(
          409,
          'OPERATION_ID_REUSED',
          'This operation ID was already used for different content.',
        );
      return PreferencesRecordSchema.parse(previous.response);
    }
    const current = await client.query<{ revision: number }>(
      'SELECT revision FROM owner_preferences WHERE owner_id=$1',
      [actor.userId],
    );
    const revision = current.rows[0]?.revision;
    if (revision !== command.expectedRevision)
      throw new ApplicationError(
        409,
        'REVISION_CONFLICT',
        'Preferences changed on another device. Reload before saving.',
        { currentRevision: revision },
      );
    const response = PreferencesRecordSchema.parse({
      revision: revision + 1,
      value: command.value,
    });
    await client.query(
      'UPDATE owner_preferences SET revision=$2,value=$3,updated_at=now() WHERE owner_id=$1',
      [actor.userId, response.revision, response.value],
    );
    await client.query(
      'INSERT INTO operation_receipts(actor_id,operation_id,request,response) VALUES($1,$2,$3,$4)',
      [actor.userId, command.operationId, { type: 'preferences.update', command }, response],
    );
    await client.query(
      "INSERT INTO audit_events(actor_id,actor_type,operation_id,event_type,record_id,revision,value) VALUES($1,'owner',$2,'preferences.updated',$1,$3,$4)",
      [actor.userId, command.operationId, response.revision, response.value],
    );
    const feed = await client.query<{ feed_position: string }>(
      'UPDATE installation SET feed_position=feed_position+1 WHERE owner_id=$1 RETURNING feed_position',
      [actor.userId],
    );
    await client.query(
      "INSERT INTO change_feed(owner_id,operation_id,record_type,record_id,revision,value,position) VALUES($1,$2,'preferences',$1,$3,$4,$5)",
      [
        actor.userId,
        command.operationId,
        response.revision,
        response.value,
        feed.rows[0]!.feed_position,
      ],
    );
    return response;
  });
}
