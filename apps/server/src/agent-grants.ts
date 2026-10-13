import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { AgentGrantCreateSchema, type AgentScope } from '@mems-life/domain';
import { transaction } from './database.js';
import { ApplicationError } from './errors.js';
import { requireOwner, type OwnerPrincipal } from './operations.js';
export type AgentPrincipal = OwnerPrincipal & {
  actorId: string;
  actorType: 'agent';
  grantId: string;
  scopes: AgentScope[];
};
const hash = (secret: string) => createHash('sha256').update(secret).digest('hex');
const denied = () =>
  new ApplicationError(
    401,
    'AGENT_UNAUTHENTICATED',
    'A valid unexpired agent credential is required.',
  );
export function requireAgentScope(actor: AgentPrincipal, scope: AgentScope) {
  if (!actor.scopes.includes(scope))
    throw new ApplicationError(403, 'INSUFFICIENT_SCOPE', `This tool requires ${scope}.`);
}
export async function authenticateAgent(
  client: Pool | PoolClient,
  header: unknown,
  scope?: AgentScope,
  lock = false,
): Promise<AgentPrincipal> {
  if (typeof header !== 'string' || !/^Bearer ml_[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(header))
    throw denied();
  const credential = header.slice(7),
    id = credential.slice(3, 39);
  const row = (
    await client.query(
      'SELECT g.*,i.id AS installation_id FROM agent_grants g JOIN installation i ON i.owner_id=g.owner_id WHERE g.id=$1' +
        (lock ? ' FOR SHARE OF g' : ''),
      [id],
    )
  ).rows[0];
  if (
    !row ||
    row.revoked_at ||
    new Date(row.expires_at).getTime() <= Date.now() ||
    !timingSafeEqual(Buffer.from(hash(credential), 'hex'), Buffer.from(row.verifier, 'hex'))
  )
    throw denied();
  const actor: AgentPrincipal = {
    userId: row.owner_id,
    installationId: row.installation_id,
    actorId: row.id,
    actorType: 'agent',
    grantId: row.id,
    scopes: row.scopes,
  };
  if (scope) requireAgentScope(actor, scope);
  return actor;
}
export async function listAgentGrants(pool: Pool, owner: OwnerPrincipal) {
  await requireOwner(pool, owner.userId);
  return {
    grants: (
      await pool.query(
        'SELECT id,label,scopes,expires_at AS "expiresAt",revoked_at AS "revokedAt",created_at AS "createdAt" FROM agent_grants WHERE owner_id=$1 ORDER BY created_at DESC',
        [owner.userId],
      )
    ).rows,
  };
}
export async function issueAgentGrant(
  pool: Pool,
  owner: OwnerPrincipal,
  input: unknown,
  authorize: (client: PoolClient) => Promise<void>,
) {
  const command = AgentGrantCreateSchema.parse(input),
    expiry = new Date(command.expiresAt).getTime();
  if (expiry <= Date.now() || expiry > Date.now() + 366 * 86400000)
    throw new ApplicationError(400, 'GRANT_EXPIRY', 'Choose an expiry within the next year.');
  return transaction(pool, async (client) => {
    await client.query('SELECT id FROM installation WHERE owner_id=$1 FOR UPDATE', [owner.userId]);
    await requireOwner(client, owner.userId);
    await authorize(client);
    if (
      (
        await client.query(
          'SELECT id FROM agent_grants WHERE owner_id=$1 AND issue_operation_id=$2',
          [owner.userId, command.operationId],
        )
      ).rowCount
    )
      throw new ApplicationError(
        409,
        'GRANT_SECRET_ALREADY_ISSUED',
        'This grant was issued already. Its secret cannot be retrieved. Revoke it and issue a new grant.',
      );
    const id = randomUUID(),
      secret = `ml_${id}.${randomBytes(32).toString('base64url')}`;
    await client.query(
      'INSERT INTO agent_grants(id,owner_id,label,verifier,scopes,expires_at,issue_operation_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        id,
        owner.userId,
        command.label,
        hash(secret),
        command.scopes,
        command.expiresAt,
        command.operationId,
      ],
    );
    await client.query(
      "INSERT INTO audit_events(actor_id,actor_type,operation_id,event_type,record_id,value) VALUES($1,'owner',$2,'agent-grant.issued',$3,$4)",
      [
        owner.userId,
        command.operationId,
        id,
        { id, label: command.label, scopes: command.scopes, expiresAt: command.expiresAt },
      ],
    );
    return {
      grant: { id, label: command.label, scopes: command.scopes, expiresAt: command.expiresAt },
      secret,
    };
  });
}
export async function revokeAgentGrant(
  pool: Pool,
  owner: OwnerPrincipal,
  grantId: string,
  operationId: string,
  authorize: (client: PoolClient) => Promise<void>,
) {
  return transaction(pool, async (client) => {
    await client.query('SELECT id FROM installation WHERE owner_id=$1 FOR UPDATE', [owner.userId]);
    await requireOwner(client, owner.userId);
    await authorize(client);
    const request = { type: 'agent-grant.revoke', grantId, operationId };
    const receipt = await client.query(
      'SELECT response,request=$3::jsonb AS matches FROM operation_receipts WHERE actor_id=$1 AND operation_id=$2',
      [owner.userId, operationId, JSON.stringify(request)],
    );
    if (receipt.rows[0]) {
      if (!receipt.rows[0].matches)
        throw new ApplicationError(
          409,
          'OPERATION_ID_REUSED',
          'This operation ID was already used for different content.',
        );
      return receipt.rows[0].response;
    }
    if (
      (
        await client.query('SELECT 1 FROM audit_events WHERE actor_id=$1 AND operation_id=$2', [
          owner.userId,
          operationId,
        ])
      ).rowCount
    )
      throw new ApplicationError(
        409,
        'OPERATION_ID_REUSED',
        'This operation ID was already used for another operation.',
      );
    const grant = await client.query(
      'UPDATE agent_grants SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 AND owner_id=$2 RETURNING id,revoked_at',
      [grantId, owner.userId],
    );
    if (!grant.rowCount) throw new ApplicationError(404, 'NOT_FOUND', 'Agent grant not found.');
    await client.query(
      "INSERT INTO audit_events(actor_id,actor_type,operation_id,event_type,record_id) SELECT $1,'owner',$2,'agent-grant.revoked',$3 WHERE NOT EXISTS(SELECT 1 FROM audit_events WHERE actor_id=$1 AND operation_id=$2)",
      [owner.userId, operationId, grantId],
    );
    const response = {
      grant: { id: grant.rows[0].id, revokedAt: grant.rows[0].revoked_at.toISOString() },
    };
    await client.query(
      'INSERT INTO operation_receipts(actor_id,operation_id,request,response) VALUES($1,$2,$3,$4)',
      [owner.userId, operationId, request, response],
    );
    return response;
  });
}
