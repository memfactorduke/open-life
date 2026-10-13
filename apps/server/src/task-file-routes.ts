import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { authenticateAgent } from './agent-grants.js';
import type { AgentScope } from '@mems-life/domain';
import { ApplicationError } from './errors.js';
import { z } from 'zod';
import { TaskFileAllocateSchema, TaskFileMutationSchema, taskFileLimit } from '@mems-life/domain';
import type { FeatureAuthorization } from './feature-routes.js';
import {
  allocateTaskFile,
  receiveTaskFile,
  finalizeTaskFile,
  detachTaskFile,
  listTaskFiles,
  readTaskFile,
} from './task-files.js';
const params = z.strictObject({ id: z.uuid() });
export function registerTaskFileRoutes(
  app: FastifyInstance,
  pool: Pool,
  authorization: FeatureAuthorization,
  options: { mediaDirectory: string },
) {
  async function access(request: FastifyRequest, scope: AgentScope) {
    if (request.headers.authorization) {
      const principal = await authenticateAgent(pool, request.headers.authorization, scope);
      return {
        principal,
        authorize: async (client: PoolClient) => {
          const current = await authenticateAgent(client, request.headers.authorization, scope);
          if (current.grantId !== principal.grantId || current.userId !== principal.userId)
            throw new ApplicationError(
              401,
              'AGENT_UNAUTHENTICATED',
              'The agent principal changed.',
            );
        },
      };
    }
    const { principal } = await authorization.ownerSession(request);
    return {
      principal,
      authorize: (client: PoolClient) => authorization.authorizeAgain(request, principal, client),
    };
  }
  app.get('/api/tasks/:id/files', async (request) => {
    const { principal } = await access(request, 'tasks:read');
    return listTaskFiles(pool, principal, params.parse(request.params).id);
  });
  app.post('/api/tasks/:id/files', async (request) => {
    const { principal } = await authorization.ownerSession(request);
    return allocateTaskFile(
      pool,
      principal,
      params.parse(request.params).id,
      TaskFileAllocateSchema.parse(request.body),
      (client) => authorization.authorizeAgain(request, principal, client),
    );
  });
  app.post('/api/task-files/:id/finalize', async (request) => {
    const { principal } = await authorization.ownerSession(request);
    return finalizeTaskFile(
      pool,
      principal,
      params.parse(request.params).id,
      TaskFileMutationSchema.parse(request.body),
      options.mediaDirectory,
      (client) => authorization.authorizeAgain(request, principal, client),
    );
  });
  app.post('/api/task-files/:id/detach', async (request) => {
    const { principal } = await authorization.ownerSession(request);
    return detachTaskFile(
      pool,
      principal,
      params.parse(request.params).id,
      TaskFileMutationSchema.parse(request.body),
      (client) => authorization.authorizeAgain(request, principal, client),
    );
  });
  app.register(async (scope) => {
    scope.addHook('onRequest', async (request) => {
      await access(request, 'tasks:write');
    });
    scope.addContentTypeParser('application/octet-stream', (request, payload, done) => {
      void request;
      done(null, payload);
    });
    scope.put('/api/task-files/:id/content', { bodyLimit: taskFileLimit }, async (request) => {
      const { principal, authorize } = await access(request, 'tasks:write');
      if (
        !request.body ||
        typeof (request.body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] !== 'function'
      )
        throw new ApplicationError(
          400,
          'FILE_BODY',
          'Transfer raw bytes with application/octet-stream.',
        );
      const expired = () => request.raw.destroy(new Error('File transfer timed out.'));
      const socket = request.raw.socket;
      if (socket && typeof request.raw.setTimeout === 'function')
        request.raw.setTimeout(60_000, expired);
      const deadline = setTimeout(expired, 300_000);
      deadline.unref();
      try {
        return await receiveTaskFile(
          pool,
          principal,
          params.parse(request.params).id,
          request.body as AsyncIterable<Uint8Array>,
          options.mediaDirectory,
          authorize,
        );
      } finally {
        clearTimeout(deadline);
        // Consuming or aborting the body can detach IncomingMessage.socket.
        if (typeof socket?.setTimeout === 'function') socket.setTimeout(0);
        request.raw.removeListener('timeout', expired);
      }
    });
  });
  app.get('/api/task-files/:id', async (request, reply) => {
    const { principal } = await access(request, 'tasks:read');
    const result = await readTaskFile(
      pool,
      principal,
      params.parse(request.params).id,
      options.mediaDirectory,
    );
    return reply
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "sandbox; default-src 'none'")
      .header(
        'Content-Disposition',
        `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(result.file.name).replace(/['()*]/g, (character) => '%' + character.charCodeAt(0).toString(16).toUpperCase())}`,
      )
      .type(result.contentType)
      .send(result.stream);
  });
}
