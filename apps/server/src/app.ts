import Fastify, { type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { fromNodeHeaders } from 'better-auth/node';
import { MeSchema, PreferencesCommandSchema } from '@mems-life/domain';
import { ZodError, z } from 'zod';
import { Pool } from 'pg';
import { createAuth } from './auth.js';
import { type Config, trustedOrigins } from './config.js';
import { ApplicationError, errorBody } from './errors.js';
import { createTransactionAuth } from './database.js';
import { readPreferences, requireOwner, updatePreferences } from './operations.js';
import { registerFeatureRoutes, type FeatureAuthorization } from './feature-routes.js';
import { registerSessionRoutes } from './session-routes.js';
import { registerFoodRoutes } from './food-routes.js';
import { reconcileMedia } from './media.js';
import { registerWhoopRoutes, whoopMcpTools } from './whoop-routes.js';
import { startWhoopPolling } from './whoop.js';
import { registerProductivityRoutes, productivityMcpTools } from './productivity-routes.js';
import { authenticateAgent, requireAgentScope } from './agent-grants.js';
import { registerAgentGrantRoutes } from './mcp-routes.js';
import { registerMcpRoutes } from './mcp.js';
import { registerAgentWorkflowRoutes, agentWorkflowMcpTools } from './agent-workflow-routes.js';
import { registerTaskFileRoutes } from './task-file-routes.js';
import { reconcileTaskFiles } from './task-files.js';
import { registerSyncRoutes } from './sync-routes.js';
import { taskFileMcpTools } from './task-file-tools.js';
import { registerPortabilityRoutes } from './portability-routes.js';
import { withMaintenanceWrite } from './portability.js';
import { registerAttentionRoutes } from './attention-routes.js';
import { ExpoPushProvider } from './attention.js';

const exposedAuthPaths = new Set([
  'sign-in/email',
  'sign-out',
  'get-session',
  'list-sessions',
  'revoke-session',
  'revoke-sessions',
  'revoke-other-sessions',
  'change-password',
]);
export async function createApp(
  config: Config,
  pool = new Pool({ connectionString: config.DATABASE_URL }),
) {
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 });
  const auth = createAuth(config, pool);
  const origins = trustedOrigins(config);
  await app.register(cors, {
    origin: origins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Origin', 'X-Mems-Life-Epoch'],
    maxAge: 600,
  });
  app.setErrorHandler((error, request, reply) => {
    if (request.url.startsWith('/api/auth/') && error instanceof ApplicationError)
      return reply.status(error.status).send({ code: error.code, message: error.message });
    if (error instanceof ApplicationError) return reply.status(error.status).send(errorBody(error));
    if (error instanceof ZodError)
      return reply
        .status(400)
        .send(
          errorBody(
            new ApplicationError(400, 'VALIDATION_ERROR', 'The request contains invalid values.'),
          ),
        );
    if (
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      error.statusCode === 413
    )
      return reply
        .status(413)
        .send(
          errorBody(
            new ApplicationError(
              413,
              'REQUEST_TOO_LARGE',
              'This request exceeds the allowed size.',
            ),
          ),
        );
    if (
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      error.statusCode === 400
    )
      return reply
        .status(400)
        .send(
          errorBody(new ApplicationError(400, 'INVALID_REQUEST', 'The request could not be read.')),
        );
    return reply
      .status(500)
      .send(
        errorBody(
          new ApplicationError(
            500,
            'INTERNAL_ERROR',
            'The service could not complete this request.',
          ),
        ),
      );
  });
  app.addHook('onRequest', async (request) => {
    if (request.method === 'OPTIONS') return;
    if (
      request.url.startsWith('/api/auth/') &&
      !request.headers.origin &&
      request.headers['expo-origin'] === `${config.NATIVE_SCHEME}://`
    ) {
      request.headers.origin = `${config.NATIVE_SCHEME}://`;
    }
    const origin = request.headers.origin;
    if (origin && !origins.includes(origin))
      throw new ApplicationError(403, 'ORIGIN_NOT_ALLOWED', 'This request origin is not trusted.');
    const authenticatedMcp = request.url === '/mcp' && !origin;
    if (authenticatedMcp) await authenticateAgent(pool, request.headers.authorization);
    const authenticatedTaskFile =
      !origin &&
      request.method === 'PUT' &&
      /^\/api\/task-files\/[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}\/content$/i.test(
        request.url,
      ) &&
      request.headers['content-type'] === 'application/octet-stream';
    if (authenticatedTaskFile)
      requireAgentScope(
        await authenticateAgent(pool, request.headers.authorization),
        'tasks:write',
      );
    if (
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) &&
      !authenticatedMcp &&
      !authenticatedTaskFile &&
      (!origin || !origins.includes(origin))
    ) {
      throw new ApplicationError(
        403,
        'ORIGIN_REQUIRED',
        'A trusted origin is required for changes.',
      );
    }
    if (
      request.headers['sec-fetch-site'] === 'cross-site' &&
      origin !== `${config.NATIVE_SCHEME}://`
    ) {
      throw new ApplicationError(403, 'CROSS_SITE_REQUEST', 'Cross-site requests are not allowed.');
    }
  });
  async function ownerSession(request: FastifyRequest) {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
      query: { disableRefresh: true, disableCookieCache: true },
    });
    if (!session)
      throw new ApplicationError(401, 'UNAUTHENTICATED', 'Sign in to access this installation.');
    const expectedEpoch =
      request.headers['x-mems-life-epoch'] === undefined
        ? undefined
        : z.uuid().parse(request.headers['x-mems-life-epoch']);
    const principal = await requireOwner(pool, session.user.id, expectedEpoch);
    return { session, principal };
  }
  app.get('/api/health', async () => {
    await pool.query('SELECT 1');
    return { status: 'ok' };
  });
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    handler: async (request, reply) => {
      const path = request.url.split('?')[0]?.slice('/api/auth/'.length);
      if (!path || !exposedAuthPaths.has(path))
        throw new ApplicationError(
          403,
          'AUTH_OPERATION_DISABLED',
          'This authentication operation is disabled. Use the local administrator commands for account setup or recovery.',
        );
      if (path !== 'sign-in/email') await ownerSession(request);
      const url = new URL(request.url, config.BETTER_AUTH_URL);
      const response = await withMaintenanceWrite(pool, () =>
        auth.handler(
          new Request(url, {
            method: request.method,
            headers: fromNodeHeaders(request.headers),
            ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
          }),
        ),
      );
      reply.status(response.status);
      response.headers.forEach((value, key) => {
        if (key !== 'set-cookie') reply.header(key, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length) reply.header('set-cookie', cookies);
      return reply.send(response.body ? await response.text() : null);
    },
  });
  app.get('/api/me', async (request) => {
    const { session, principal } = await ownerSession(request);
    return MeSchema.parse({
      user: { id: session.user.id, name: session.user.name, email: session.user.email },
      installationId: principal.installationId,
    });
  });
  app.get('/api/preferences', async (request) => {
    const { principal } = await ownerSession(request);
    return readPreferences(pool, principal);
  });
  app.put('/api/preferences', async (request) => {
    const { principal } = await ownerSession(request);
    const command = PreferencesCommandSchema.parse(request.body);
    return updatePreferences(pool, principal, command, async (client) => {
      const session = await createTransactionAuth(config, client).api.getSession({
        headers: fromNodeHeaders(request.headers),
        query: { disableRefresh: true, disableCookieCache: true },
      });
      if (!session || session.user.id !== principal.userId)
        throw new ApplicationError(401, 'UNAUTHENTICATED', 'Sign in to access this installation.');
      await requireOwner(client, session.user.id, principal.expectedEpoch);
    });
  });
  const authorization: FeatureAuthorization = {
    ownerSession,
    authorizeAgain: async (request, principal, client) => {
      const session = await createTransactionAuth(config, client).api.getSession({
        headers: fromNodeHeaders(request.headers),
        query: { disableRefresh: true, disableCookieCache: true },
      });
      if (!session || session.user.id !== principal.userId)
        throw new ApplicationError(401, 'UNAUTHENTICATED', 'Sign in to access this installation.');
      await requireOwner(client, session.user.id, principal.expectedEpoch);
    },
  };
  registerFeatureRoutes(app, pool, authorization);
  registerSessionRoutes(app, pool, authorization);
  registerProductivityRoutes(app, pool, authorization);
  registerAgentGrantRoutes(app, pool, authorization);
  registerAgentWorkflowRoutes(app, pool, authorization);
  registerSyncRoutes(app, pool, authorization);
  registerPortabilityRoutes(app, pool, authorization);
  registerAttentionRoutes(
    app,
    pool,
    authorization,
    config.EXPO_PUSH_ENABLED
      ? {
          provider: new ExpoPushProvider(config.EXPO_PUSH_ACCESS_TOKEN),
        }
      : {},
  );
  const mediaDirectory = resolve(
    config.MEDIA_DIRECTORY ??
      (config.NODE_ENV === 'production' ? '/var/lib/mems-life/media' : '.runtime/media'),
  );
  registerFoodRoutes(app, pool, authorization, { mediaDirectory });
  registerTaskFileRoutes(app, pool, authorization, { mediaDirectory });
  registerMcpRoutes(app, pool, {
    mediaDirectory,
    additionalTools: [
      ...productivityMcpTools(pool),
      ...whoopMcpTools(pool, config),
      ...agentWorkflowMcpTools(pool),
      ...taskFileMcpTools(pool, mediaDirectory),
    ],
  });
  registerWhoopRoutes(app, pool, authorization, config);
  let stopWhoopPolling: (() => void) | undefined;
  app.addHook('onReady', async () => {
    await reconcileMedia(pool, mediaDirectory);
    await reconcileTaskFiles(pool, mediaDirectory);
    stopWhoopPolling = startWhoopPolling(pool, config);
  });
  app.addHook('onClose', async () => {
    stopWhoopPolling?.();
  });
  if (config.NODE_ENV === 'production') {
    await app.register(fastifyStatic, {
      root: fileURLToPath(new URL('../../web/dist/', import.meta.url)),
      prefix: '/',
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/'))
        return reply
          .status(404)
          .send(errorBody(new ApplicationError(404, 'NOT_FOUND', 'This endpoint does not exist.')));
      return reply.sendFile('index.html');
    });
  }
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cache-Control', 'no-store');
    if (config.NODE_ENV === 'production')
      reply.header(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      );
    return payload;
  });
  return { app, auth, pool };
}
