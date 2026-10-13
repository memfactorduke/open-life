import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import {
  BoardCommandSchema,
  ProjectCommandSchema,
  RecurrenceCommandSchema,
  StepCommandSchema,
} from '@mems-life/domain';
import type { FeatureAuthorization } from './feature-routes.js';
import {
  listBoards,
  listProjects,
  executeBoardCommand,
  executeProjectCommand,
} from './organization.js';
import { listRecurrence, executeRecurrenceCommand } from './recurrence.js';
import { listSteps, executeStepCommand } from './steps.js';
import { queryTasks } from './tasks.js';
export const TaskQuerySchema = z.strictObject({
  view: z.enum(['open', 'completed', 'archived', 'deleted', 'all']).default('open'),
  search: z.string().max(500).optional(),
  boardId: z.uuid().optional(),
  projectId: z.uuid().optional(),
  tag: z.string().max(80).optional(),
  priority: z.enum(['none', 'low', 'normal', 'high', 'urgent']).optional(),
  timing: z.enum(['upcoming', 'overdue']).optional(),
  phase: z.enum(['planned', 'next', 'active', 'completed']).optional(),
  responsibility: z.enum(['human', 'agent', 'either']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.coerce.number().int().nonnegative().default(0),
});
export function registerProductivityRoutes(
  app: FastifyInstance,
  pool: Pool,
  authorization: FeatureAuthorization,
) {
  app.get('/api/boards', async (request) =>
    listBoards(pool, (await authorization.ownerSession(request)).principal),
  );
  app.get('/api/projects', async (request) =>
    listProjects(pool, (await authorization.ownerSession(request)).principal),
  );
  app.get('/api/recurrence', async (request) =>
    listRecurrence(pool, (await authorization.ownerSession(request)).principal),
  );
  app.get('/api/tasks/query', async (request) =>
    queryTasks(
      pool,
      (await authorization.ownerSession(request)).principal,
      TaskQuerySchema.parse(request.query),
    ),
  );
  app.get('/api/tasks/:id/steps', async (request) =>
    listSteps(
      pool,
      (await authorization.ownerSession(request)).principal,
      z.strictObject({ id: z.uuid() }).parse(request.params).id,
    ),
  );
  app.post('/api/boards/commands', async (request) => {
    const { principal } = await authorization.ownerSession(request);
    return executeBoardCommand(pool, principal, BoardCommandSchema.parse(request.body), (client) =>
      authorization.authorizeAgain(request, principal, client),
    );
  });
  app.post('/api/projects/commands', async (request) => {
    const { principal } = await authorization.ownerSession(request);
    return executeProjectCommand(
      pool,
      principal,
      ProjectCommandSchema.parse(request.body),
      (client) => authorization.authorizeAgain(request, principal, client),
    );
  });
  app.post('/api/recurrence/commands', async (request) => {
    const { principal } = await authorization.ownerSession(request);
    return executeRecurrenceCommand(
      pool,
      principal,
      RecurrenceCommandSchema.parse(request.body),
      (client) => authorization.authorizeAgain(request, principal, client),
    );
  });
  app.post('/api/steps/commands', async (request) => {
    const { principal } = await authorization.ownerSession(request);
    return executeStepCommand(pool, principal, StepCommandSchema.parse(request.body), (client) =>
      authorization.authorizeAgain(request, principal, client),
    );
  });
}

export function productivityMcpTools(pool: Pool): import('./mcp.js').McpTool[] {
  return [
    {
      name: 'tasks_query',
      description: 'Search owner tasks across lifecycle views with bounded pages.',
      scope: 'tasks:read',
      schema: TaskQuerySchema,
      run: (v, a) => queryTasks(pool, a, v),
    },
    {
      name: 'boards_list',
      description: 'Read board configuration and explicit phase mappings.',
      scope: 'tasks:read',
      schema: z.strictObject({}),
      run: (_v, a) => listBoards(pool, a),
    },
    {
      name: 'projects_list',
      description: 'Read project configuration.',
      scope: 'tasks:read',
      schema: z.strictObject({}),
      run: (_v, a) => listProjects(pool, a),
    },
    {
      name: 'steps_list',
      description: 'Read parent steps, next actions and waiting reasons.',
      scope: 'tasks:read',
      schema: z.strictObject({ id: z.uuid() }),
      run: (v, a) => listSteps(pool, a, v.id),
    },
    {
      name: 'step_command',
      description:
        'Edit steps through the same validated operations; Planned parents remain dormant.',
      scope: 'tasks:write',
      schema: StepCommandSchema,
      run: (v, a, auth) => executeStepCommand(pool, a, v, auth),
    },
    {
      name: 'board_command',
      description: 'Edit board labels/configuration without releasing work.',
      scope: 'tasks:write',
      schema: BoardCommandSchema,
      run: (v, a, auth) => executeBoardCommand(pool, a, v, auth),
    },
    {
      name: 'project_command',
      description: 'Edit owner project configuration.',
      scope: 'tasks:write',
      schema: ProjectCommandSchema,
      run: (v, a, auth) => executeProjectCommand(pool, a, v, auth),
    },
    {
      name: 'recurrence_list',
      description: 'Read recurrence series and cancellation history.',
      scope: 'tasks:read',
      schema: z.strictObject({}),
      run: (_v, a) => listRecurrence(pool, a),
    },
    {
      name: 'recurrence_command',
      description: 'Configure recurrence or skip one occurrence without fabricating history.',
      scope: 'tasks:write',
      schema: RecurrenceCommandSchema,
      run: (v, a, auth) => executeRecurrenceCommand(pool, a, v, auth),
    },
  ];
}
