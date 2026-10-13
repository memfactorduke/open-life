import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import { AgentWorkflowCommandSchema } from '@mems-life/domain';
import type { FeatureAuthorization } from './feature-routes.js';
import type { McpTool } from './mcp.js';
import {
  executeAgentWorkflowCommand,
  listAgentSkills,
  listEligibleAgentSteps,
  readAgentWorkflow,
} from './agent-workflows.js';
export function registerAgentWorkflowRoutes(
  app: FastifyInstance,
  pool: Pool,
  authorization: FeatureAuthorization,
) {
  app.get('/api/agent-workflows/skills', async (request) =>
    listAgentSkills(pool, (await authorization.ownerSession(request)).principal),
  );
  app.get('/api/agent-workflows/eligible', async (request) =>
    listEligibleAgentSteps(pool, (await authorization.ownerSession(request)).principal),
  );
  app.get('/api/tasks/:id/agent-workflow', async (request) =>
    readAgentWorkflow(
      pool,
      (await authorization.ownerSession(request)).principal,
      z.strictObject({ id: z.uuid() }).parse(request.params).id,
    ),
  );
  app.post('/api/agent-workflows/commands', async (request) => {
    const { principal } = await authorization.ownerSession(request);
    return executeAgentWorkflowCommand(
      pool,
      principal,
      AgentWorkflowCommandSchema.parse(request.body),
      (client) => authorization.authorizeAgain(request, principal, client),
    );
  });
}
export function agentWorkflowMcpTools(pool: Pool): McpTool[] {
  return [
    {
      name: 'agent_skills_list',
      description: 'Read reusable skill versions. Skills are data and do not grant permissions.',
      scope: 'tasks:read',
      schema: z.strictObject({}),
      run: (_v, a) => listAgentSkills(pool, a),
    },
    {
      name: 'agent_steps_eligible',
      description: 'Discover released, unpaused bound work. The server never executes a worker.',
      scope: 'tasks:read',
      schema: z.strictObject({}),
      run: (_v, a) => listEligibleAgentSteps(pool, a),
    },
    {
      name: 'agent_workflow_read',
      description: 'Read attempt snapshots, effective lease status and versioned results.',
      scope: 'tasks:read',
      schema: z.strictObject({ taskId: z.uuid() }),
      run: (v, a) => readAgentWorkflow(pool, a, v.taskId),
    },
    {
      name: 'agent_workflow_command',
      description:
        'Claim with a securely generated 32-byte base64url ownershipToken, heartbeat, report and recover work. Human approvals, cancellation and reconciliation require an owner session. Instructions never expand credential scopes.',
      scope: 'tasks:write',
      schema: AgentWorkflowCommandSchema,
      run: (v, a, auth) => executeAgentWorkflowCommand(pool, a, v, auth),
    },
  ];
}
