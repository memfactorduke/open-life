import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import { SyncSnapshotRequestSchema, SyncPositionSchema } from '@mems-life/domain';
import type { FeatureAuthorization } from './feature-routes.js';
import { createSyncSnapshot, readSyncSnapshot, readSyncChanges } from './sync.js';
const page = {
  cursor: SyncPositionSchema.default('0'),
  limit: z.coerce.number().int().min(1).max(500).default(100),
};
export function registerSyncRoutes(
  app: FastifyInstance,
  pool: Pool,
  authorization: FeatureAuthorization,
) {
  app.post('/api/sync/snapshots', async (request) => {
    const { principal } = await authorization.ownerSession(request);
    const body = SyncSnapshotRequestSchema.parse(request.body);
    return createSyncSnapshot(pool, principal, body.requestId, (client) =>
      authorization.authorizeAgain(request, principal, client),
    );
  });
  app.get('/api/sync/snapshots/:id', async (request) => {
    const { principal } = await authorization.ownerSession(request);
    const { id } = z.strictObject({ id: z.uuid() }).parse(request.params);
    const q = z.strictObject(page).parse(request.query);
    return readSyncSnapshot(pool, principal, id, q.cursor, q.limit, (client) =>
      authorization.authorizeAgain(request, principal, client),
    );
  });
  app.get('/api/sync/changes', async (request) => {
    const { principal } = await authorization.ownerSession(request);
    const q = z.strictObject({ ...page, epoch: z.uuid() }).parse(request.query);
    return readSyncChanges(pool, principal, q.epoch, q.cursor, q.limit, (client) =>
      authorization.authorizeAgain(request, principal, client),
    );
  });
}
