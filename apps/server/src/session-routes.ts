import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import { SessionCommandSchema } from '@mems-life/domain';
import type { FeatureAuthorization } from './feature-routes.js';
import {
  executeSessionCommand,
  listSessions,
  readSession,
  sessionHistory,
  exercisePerformance,
} from './sessions.js';
const idParams = z.strictObject({ id: z.uuid() });
const page = {
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
};
export function registerSessionRoutes(
  app: FastifyInstance,
  pool: Pool,
  authorization: FeatureAuthorization,
): void {
  app.get('/api/sessions/clock', async (request) => {
    await authorization.ownerSession(request);
    return { now: new Date().toISOString() };
  });
  app.post('/api/sessions/commands', { bodyLimit: 1_048_576 }, async (request) => {
    const { principal } = await authorization.ownerSession(request);
    return executeSessionCommand(
      pool,
      principal,
      SessionCommandSchema.parse(request.body),
      (client) => authorization.authorizeAgain(request, principal, client),
    );
  });
  app.get('/api/sessions', async (request) => {
    const { principal } = await authorization.ownerSession(request);
    const q = z
      .strictObject({ ...page, status: z.enum(['active', 'completed', 'abandoned']).optional() })
      .parse(request.query);
    return listSessions(pool, principal, q.status, q.cursor, q.limit);
  });
  app.get('/api/sessions/:id', async (request) => {
    const { principal } = await authorization.ownerSession(request);
    return readSession(pool, principal, idParams.parse(request.params).id);
  });
  app.get('/api/sessions/:id/history', async (request) => {
    const { principal } = await authorization.ownerSession(request);
    const q = z
      .strictObject({
        cursor: z
          .string()
          .regex(/^[1-9]\d{0,17}$/)
          .optional(),
        limit: page.limit,
      })
      .parse(request.query);
    return sessionHistory(pool, principal, idParams.parse(request.params).id, q.cursor, q.limit);
  });
  app.get('/api/exercises/:id/performance', async (request) => {
    const { principal } = await authorization.ownerSession(request);
    const q = z
      .strictObject({
        ...page,
        mode: z.enum(['weighted', 'bodyweight', 'timed', 'distance']).optional(),
        excludeSessionId: z.uuid().optional(),
      })
      .parse(request.query);
    return exercisePerformance(
      pool,
      principal,
      idParams.parse(request.params).id,
      q.cursor,
      q.limit,
      q.mode,
      q.excludeSessionId,
    );
  });
}
