import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import { WhoopCommandSchema } from '@mems-life/domain';
import type { FeatureAuthorization } from './feature-routes.js';
import { ApplicationError } from './errors.js';
import { WhoopService, type WhoopConfig } from './whoop.js';
export function registerWhoopRoutes(
  app: FastifyInstance,
  pool: Pool,
  authorization: FeatureAuthorization,
  config: WhoopConfig,
  service = new WhoopService(pool, config),
) {
  app.get('/api/whoop', async (request) => {
    const { principal } = await authorization.ownerSession(request);
    return service.read(principal);
  });
  app.post('/api/whoop/commands', async (request) => {
    const owner = await authorization.ownerSession(request);
    const sessionId = owner.session?.session.id;
    if (!sessionId)
      throw new ApplicationError(401, 'UNAUTHENTICATED', 'A live session is required.');
    return service.command(
      owner.principal,
      WhoopCommandSchema.parse(request.body),
      sessionId,
      (client) => authorization.authorizeAgain(request, owner.principal, client),
    );
  });
  const callbackQuery = z.strictObject({
    state: z.string().length(8),
    code: z.string().min(1).max(2048),
  });
  app.get('/api/whoop/callback', async (request, reply) => {
    const query = callbackQuery.parse(request.query);
    const native = await service.nativeReturn(query.state, query.code);
    if (native) return reply.redirect(native);
    const owner = await authorization.ownerSession(request);
    const sessionId = owner.session?.session.id;
    if (!sessionId)
      throw new ApplicationError(401, 'UNAUTHENTICATED', 'A live session is required.');
    await service.callback(owner.principal, sessionId, query.state, query.code, (client) =>
      authorization.authorizeAgain(request, owner.principal, client),
    );
    return reply.redirect('/');
  });
  app.post('/api/whoop/callback', async (request) => {
    const query = callbackQuery.parse(request.body);
    const owner = await authorization.ownerSession(request);
    const sessionId = owner.session?.session.id;
    if (!sessionId)
      throw new ApplicationError(401, 'UNAUTHENTICATED', 'A live session is required.');
    return service.callback(owner.principal, sessionId, query.state, query.code, (client) =>
      authorization.authorizeAgain(request, owner.principal, client),
    );
  });
}

export function whoopMcpTools(pool: Pool, config: WhoopConfig): import('./mcp.js').McpTool[] {
  const service = new WhoopService(pool, config);
  return [
    {
      name: 'whoop_observations',
      description:
        'Read optional WHOOP observations with provenance, availability and freshness. No provider credentials.',
      scope: 'whoop:read',
      schema: z.strictObject({}),
      run: async (_input, actor) => service.read(actor),
    },
  ];
}
