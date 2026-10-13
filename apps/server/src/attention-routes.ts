import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import { NotificationPreferencesCommandSchema, NotificationDeviceSchema } from '@mems-life/domain';
import type { FeatureAuthorization } from './feature-routes.js';
import { ApplicationError } from './errors.js';
import {
  readAttention,
  readNotificationPreferences,
  updateNotificationPreferences,
  registerNotificationDevice,
  deactivateNotificationDevice,
  reconcileAttention,
  type PushProvider,
} from './attention.js';
export function registerAttentionRoutes(
  app: FastifyInstance,
  pool: Pool,
  authorization: FeatureAuthorization,
  options: { provider?: PushProvider; maintenance?: () => boolean; pollIntervalMs?: number } = {},
) {
  app.get('/api/attention', async (request) => {
    const { principal } = await authorization.ownerSession(request);
    return readAttention(pool, principal);
  });
  app.get('/api/notifications/preferences', async (request) => {
    const { principal } = await authorization.ownerSession(request);
    return {
      ...(await readNotificationPreferences(pool, principal)),
      providerConfigured: !!options.provider,
    };
  });
  app.put('/api/notifications/preferences', async (request) => {
    const { principal } = await authorization.ownerSession(request);
    return updateNotificationPreferences(
      pool,
      principal,
      NotificationPreferencesCommandSchema.parse(request.body),
      (client) => authorization.authorizeAgain(request, principal, client),
    );
  });
  app.post('/api/notifications/devices', async (request) => {
    const { principal, session } = await authorization.ownerSession(request);
    if (!session)
      throw new ApplicationError(401, 'SESSION_REQUIRED', 'A signed-in owner session is required.');
    return registerNotificationDevice(
      pool,
      principal,
      session.session.id,
      NotificationDeviceSchema.parse(request.body),
      (client) => authorization.authorizeAgain(request, principal, client),
    );
  });
  app.delete('/api/notifications/devices/:id', async (request) => {
    const { principal } = await authorization.ownerSession(request);
    return deactivateNotificationDevice(
      pool,
      principal,
      z.strictObject({ id: z.uuid() }).parse(request.params).id,
      (client) => authorization.authorizeAgain(request, principal, client),
    );
  });
  let timer: ReturnType<typeof setInterval> | undefined;
  let current: Promise<void> | undefined;
  const tick = () => {
    if (current || options.maintenance?.()) return;
    current = reconcileAttention(pool, options.provider)
      .catch((error) => {
        if (!(error instanceof ApplicationError && error.code === 'MAINTENANCE'))
          app.log.error({ err: error }, 'Attention reconciliation failed');
      })
      .finally(() => {
        current = undefined;
      });
  };
  app.addHook('onReady', async () => {
    tick();
    timer = setInterval(tick, options.pollIntervalMs ?? 60000);
    timer.unref();
  });
  app.addHook('onClose', async () => {
    if (timer) clearInterval(timer);
    await current;
  });
}
