import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { AgentGrantCreateSchema, AgentGrantRevokeSchema } from '@mems-life/domain';
import type { FeatureAuthorization } from './feature-routes.js';
import { issueAgentGrant, listAgentGrants, revokeAgentGrant } from './agent-grants.js';
export function registerAgentGrantRoutes(
  app: FastifyInstance,
  pool: Pool,
  authorization: FeatureAuthorization,
) {
  app.get('/api/agent-grants', async (request) => {
    const { principal } = await authorization.ownerSession(request);
    return listAgentGrants(pool, principal);
  });
  app.post('/api/agent-grants', async (request, reply) => {
    const { principal } = await authorization.ownerSession(request);
    const result = await issueAgentGrant(
      pool,
      principal,
      AgentGrantCreateSchema.parse(request.body),
      (client) => authorization.authorizeAgain(request, principal, client),
    );
    reply.header('Cache-Control', 'no-store');
    return result;
  });
  app.post('/api/agent-grants/revoke', async (request) => {
    const { principal } = await authorization.ownerSession(request);
    const input = AgentGrantRevokeSchema.parse(request.body);
    return revokeAgentGrant(pool, principal, input.grantId, input.operationId, (client) =>
      authorization.authorizeAgain(request, principal, client),
    );
  });
}
