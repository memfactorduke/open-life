import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  TaskCommandSchema,
  ExerciseCommandSchema,
  RoutineCommandSchema,
  SessionCommandSchema,
  FoodCommandSchema,
  FoodUploadSchema,
  FoodFinalizeSchema,
  FoodTimezoneSchema,
  ReportedSourceSchema,
  type AgentScope,
} from '@mems-life/domain';
import { authenticateAgent, requireAgentScope, type AgentPrincipal } from './agent-grants.js';
import { ApplicationError } from './errors.js';
import { listTasks, readTask, taskHistory, executeTaskCommand } from './tasks.js';
import {
  listExercises,
  listRoutines,
  readRoutine,
  executeExerciseCommand,
  executeRoutineCommand,
} from './workouts.js';
import { listSessions, readSession, sessionHistory, executeSessionCommand } from './sessions.js';
import { listFood, foodHistory, executeFoodCommand } from './food.js';
import { allocatePhoto, receivePhoto, finalizePhoto, readPhoto, mediaLimit } from './media.js';
export type McpTool = {
  name: string;
  description: string;
  scope: AgentScope;
  schema: z.ZodType;
  run: (
    // Runtime tool schemas validate heterogeneous command payloads before dispatch.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input: any,
    actor: AgentPrincipal,
    authorize: (client: PoolClient) => Promise<void>,
  ) => Promise<unknown>;
};
export function coreMcpTools(pool: Pool, mediaDirectory: string): McpTool[] {
  const tool = (
    name: string,
    scope: AgentScope,
    schema: z.ZodType,
    run: McpTool['run'],
    description = name,
  ): McpTool => ({ name, scope, schema, run, description });
  const id = z.strictObject({ id: z.uuid() });
  const archive = z.strictObject({ archived: z.boolean().default(false) });
  const sourceCommand = (command: z.ZodType) =>
    z.strictObject({ command, source: ReportedSourceSchema });
  return [
    tool(
      'tasks_list',
      'tasks:read',
      z.strictObject({ view: z.enum(['open', 'completed', 'archived']).default('open') }),
      (v, a) => listTasks(pool, a, v.view),
    ),
    tool('task_read', 'tasks:read', id, (v, a) => readTask(pool, a, v.id)),
    tool(
      'task_history',
      'tasks:read',
      z.strictObject({
        id: z.uuid(),
        cursor: z
          .string()
          .regex(/^[1-9]\d{0,8}$/)
          .optional(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
      (v, a) => taskHistory(pool, a, v.id, v.cursor, v.limit),
    ),
    tool('task_command', 'tasks:write', TaskCommandSchema, (v, a, auth) =>
      executeTaskCommand(pool, a, v, auth),
    ),
    tool('exercises_list', 'workouts:read', archive, (v, a) => listExercises(pool, a, v.archived)),
    tool('routines_list', 'workouts:read', archive, (v, a) => listRoutines(pool, a, v.archived)),
    tool('routine_read', 'workouts:read', id, (v, a) => readRoutine(pool, a, v.id)),
    tool('exercise_command', 'workouts:plan', ExerciseCommandSchema, (v, a, auth) =>
      executeExerciseCommand(pool, a, v, auth),
    ),
    tool('routine_command', 'workouts:plan', RoutineCommandSchema, (v, a, auth) =>
      executeRoutineCommand(pool, a, v, auth),
    ),
    tool(
      'sessions_list',
      'workouts:read',
      z.strictObject({
        status: z.enum(['active', 'completed', 'abandoned']).optional(),
        cursor: z.uuid().optional(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
      (v, a) => listSessions(pool, a, v.status, v.cursor, v.limit),
    ),
    tool('session_read', 'workouts:read', id, (v, a) => readSession(pool, a, v.id)),
    tool(
      'session_history',
      'workouts:read',
      z.strictObject({
        id: z.uuid(),
        cursor: z
          .string()
          .regex(/^[1-9]\d{0,17}$/)
          .optional(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
      (v, a) => sessionHistory(pool, a, v.id, v.cursor, v.limit),
    ),
    tool(
      'session_command',
      'workouts:record',
      sourceCommand(SessionCommandSchema),
      (v, a, auth) => {
        if (v.command.type === 'session.update-routine') requireAgentScope(a, 'workouts:plan');
        return executeSessionCommand(pool, a, v.command, async (client) => {
          await provenance(v, a, auth)(client);
          if (v.command.type === 'session.update-routine') requireAgentScope(a, 'workouts:plan');
        });
      },
      'Record explicitly reported or imported training; never infer performed results from a plan.',
    ),
    tool(
      'food_list',
      'food:read',
      z.strictObject({
        date: z.iso.date().optional(),
        timezone: FoodTimezoneSchema.default('UTC'),
      }),
      (v, a) => listFood(pool, a, v.date, v.timezone),
    ),
    tool('food_history', 'food:read', id, (v, a) => foodHistory(pool, a, v.id)),
    tool(
      'food_command',
      'food:write',
      sourceCommand(FoodCommandSchema),
      (v, a, auth) => executeFoodCommand(pool, a, v.command, provenance(v, a, auth)),
      'Record explicitly reported food; do not infer that planned food was consumed.',
    ),
    tool(
      'food_photo_allocate',
      'food:attach',
      z.strictObject({ entryId: z.uuid(), upload: FoodUploadSchema }),
      (v, a, auth) => allocatePhoto(pool, a, v.entryId, v.upload, auth),
    ),
    tool(
      'food_photo_receive',
      'food:attach',
      z.strictObject({
        id: z.uuid(),
        base64: z
          .string()
          .min(4)
          .max(Math.ceil(mediaLimit / 3) * 4)
          .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
      }),
      (v, a, auth) =>
        receivePhoto(pool, a, v.id, Buffer.from(v.base64, 'base64'), mediaDirectory, auth),
    ),
    tool(
      'food_photo_finalize',
      'food:attach',
      z.strictObject({ id: z.uuid(), command: FoodFinalizeSchema }),
      (v, a, auth) => finalizePhoto(pool, a, v.id, v.command, mediaDirectory, auth),
    ),
    tool('food_photo_read', 'food:read', id, async (v, a) => {
      const photo = await readPhoto(pool, a, v.id, mediaDirectory);
      return { contentType: photo.contentType, base64: photo.bytes.toString('base64') };
    }),
  ];
  function provenance(
    v: { command: { operationId: string }; source: unknown },
    a: AgentPrincipal,
    auth: (client: PoolClient) => Promise<void>,
  ) {
    return async (client: PoolClient) => {
      await auth(client);
      const old = await client.query(
        'SELECT source=$3::jsonb AS matches FROM agent_provenance WHERE actor_id=$1 AND operation_id=$2',
        [a.grantId, v.command.operationId, JSON.stringify(v.source)],
      );
      if (old.rows[0] && !old.rows[0].matches)
        throw new ApplicationError(
          409,
          'OPERATION_ID_REUSED',
          'This operation ID has different source attribution.',
        );
      await client.query(
        'INSERT INTO agent_provenance(owner_id,actor_id,operation_id,source) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [a.userId, a.grantId, v.command.operationId, v.source],
      );
    };
  }
}
export function registerMcpRoutes(
  app: FastifyInstance,
  pool: Pool,
  options: { mediaDirectory: string; additionalTools?: McpTool[] },
) {
  const tools = [...coreMcpTools(pool, options.mediaDirectory), ...(options.additionalTools ?? [])];
  app.route({
    method: ['POST', 'GET', 'DELETE'],
    url: '/mcp',
    bodyLimit: 12 * 1024 * 1024,
    handler: async (request, reply) => {
      const header = request.headers.authorization;
      const actor = await authenticateAgent(pool, header);
      if (request.method !== 'POST')
        return reply
          .status(405)
          .header('Allow', 'POST')
          .send({ error: 'This stateless MCP endpoint accepts POST.' });
      const server = new McpServer({ name: 'mems-life', version: '0.1.0' });
      for (const tool of tools) {
        if (!actor.scopes.includes(tool.scope)) continue;
        server.registerTool(
          tool.name,
          { description: tool.description, inputSchema: tool.schema },
          async (input: unknown) => {
            try {
              const current = await authenticateAgent(pool, header, tool.scope);
              const value = tool.schema.parse(input);
              const result = await tool.run(value, current, async (client) => {
                const checked = await authenticateAgent(client, header, tool.scope, true);
                if (checked.grantId !== current.grantId || checked.userId !== current.userId)
                  throw new ApplicationError(
                    401,
                    'AGENT_UNAUTHENTICATED',
                    'The agent principal changed.',
                  );
              });
              return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
            } catch (error) {
              const code =
                error instanceof ApplicationError
                  ? error.code
                  : error instanceof z.ZodError
                    ? 'VALIDATION_ERROR'
                    : 'INTERNAL_ERROR';
              const message =
                error instanceof ApplicationError
                  ? error.message
                  : error instanceof z.ZodError
                    ? 'The tool input contains invalid values.'
                    : 'The tool could not complete this request.';
              return {
                isError: true,
                content: [{ type: 'text' as const, text: JSON.stringify({ code, message }) }],
              };
            }
          },
        );
      }
      const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
      await server.connect(transport as Parameters<typeof server.connect>[0]);
      reply.hijack();
      try {
        await transport.handleRequest(request.raw, reply.raw, request.body);
      } finally {
        await server.close();
      }
    },
  });
}
