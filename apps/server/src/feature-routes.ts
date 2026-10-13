import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import {
  TaskCommandSchema,
  ExerciseCommandSchema,
  RoutineCommandSchema,
  TaskHistorySchema,
} from '@mems-life/domain';
import type { OwnerPrincipal } from './operations.js';
import { executeTaskCommand, listTasks, readTask, taskHistory } from './tasks.js';
import {
  executeExerciseCommand,
  executeRoutineCommand,
  listExercises,
  listRoutines,
  readRoutine,
} from './workouts.js';

export type FeatureAuthorization = {
  ownerSession: (
    request: FastifyRequest,
  ) => Promise<{ principal: OwnerPrincipal; session?: { session: { id: string } } }>;
  authorizeAgain: (
    request: FastifyRequest,
    principal: OwnerPrincipal,
    client: PoolClient,
  ) => Promise<void>;
};
const idParams = z.strictObject({ id: z.uuid() });
const archiveQuery = z.strictObject({ view: z.enum(['open', 'archived']).default('open') });
export function registerFeatureRoutes(
  app: FastifyInstance,
  pool: Pool,
  authorization: FeatureAuthorization,
): void {
  app.get('/api/tasks', async (request) => {
    const { principal } = await authorization.ownerSession(request);
    const { view } = z
      .strictObject({ view: z.enum(['open', 'completed', 'archived']).default('open') })
      .parse(request.query);
    return listTasks(pool, principal, view);
  });
  app.get('/api/tasks/:id', async (request) => {
    const { principal } = await authorization.ownerSession(request);
    return readTask(pool, principal, idParams.parse(request.params).id);
  });
  app.get('/api/tasks/:id/history', async (request) => {
    const { principal } = await authorization.ownerSession(request);
    const query = z
      .strictObject({
        cursor: z
          .string()
          .regex(/^[1-9]\d*$/)
          .transform(Number)
          .pipe(z.number().int().max(2147483647))
          .transform(String)
          .optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(request.query);
    return TaskHistorySchema.parse(
      await taskHistory(
        pool,
        principal,
        idParams.parse(request.params).id,
        query.cursor,
        query.limit,
      ),
    );
  });
  app.post('/api/tasks/commands', async (request) => {
    const { principal } = await authorization.ownerSession(request);
    return executeTaskCommand(pool, principal, TaskCommandSchema.parse(request.body), (client) =>
      authorization.authorizeAgain(request, principal, client),
    );
  });
  app.get('/api/exercises', async (request) => {
    const { principal } = await authorization.ownerSession(request);
    return listExercises(pool, principal, archiveQuery.parse(request.query).view === 'archived');
  });
  app.post('/api/exercises/commands', async (request) => {
    const { principal } = await authorization.ownerSession(request);
    return executeExerciseCommand(
      pool,
      principal,
      ExerciseCommandSchema.parse(request.body),
      (client) => authorization.authorizeAgain(request, principal, client),
    );
  });
  app.get('/api/routines', async (request) => {
    const { principal } = await authorization.ownerSession(request);
    return listRoutines(pool, principal, archiveQuery.parse(request.query).view === 'archived');
  });
  app.get('/api/routines/:id', async (request) => {
    const { principal } = await authorization.ownerSession(request);
    return readRoutine(pool, principal, idParams.parse(request.params).id);
  });
  app.post('/api/routines/commands', async (request) => {
    const { principal } = await authorization.ownerSession(request);
    return executeRoutineCommand(
      pool,
      principal,
      RoutineCommandSchema.parse(request.body),
      (client) => authorization.authorizeAgain(request, principal, client),
    );
  });
}
