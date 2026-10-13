import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { FeatureAuthorization } from './feature-routes.js';
import { ownerExport } from './portability.js';
export function registerPortabilityRoutes(
  app: FastifyInstance,
  pool: Pool,
  authorization: FeatureAuthorization,
): void {
  app.get('/api/export', async (request, reply) => {
    const { principal } = await authorization.ownerSession(request);
    reply
      .header('Content-Disposition', 'attachment; filename="mems-life-export-v1.json"')
      .header('Cache-Control', 'no-store');
    return ownerExport(pool, principal);
  });
}
