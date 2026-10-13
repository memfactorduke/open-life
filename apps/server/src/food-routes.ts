import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import {
  FoodCommandSchema,
  FoodUploadSchema,
  FoodFinalizeSchema,
  FoodTimezoneSchema,
} from '@mems-life/domain';
import type { FeatureAuthorization } from './feature-routes.js';
import { executeFoodCommand, listFood, foodHistory } from './food.js';
import { allocatePhoto, receivePhoto, finalizePhoto, readPhoto, mediaLimit } from './media.js';
import { ApplicationError } from './errors.js';
const params = z.strictObject({ id: z.uuid() });
export function registerFoodRoutes(
  app: FastifyInstance,
  pool: Pool,
  authorization: FeatureAuthorization,
  options: { mediaDirectory: string },
) {
  app.get('/api/food', async (request) => {
    const { principal } = await authorization.ownerSession(request);
    const query = z
      .strictObject({ date: z.iso.date().optional(), timezone: FoodTimezoneSchema.default('UTC') })
      .parse(request.query);
    return listFood(pool, principal, query.date, query.timezone);
  });
  app.get('/api/food/:id/history', async (request) => {
    const { principal } = await authorization.ownerSession(request);
    return foodHistory(pool, principal, params.parse(request.params).id);
  });
  app.post('/api/food/commands', async (request) => {
    const { principal } = await authorization.ownerSession(request);
    return executeFoodCommand(pool, principal, FoodCommandSchema.parse(request.body), (client) =>
      authorization.authorizeAgain(request, principal, client),
    );
  });
  app.post('/api/food/:id/uploads', async (request) => {
    const { principal } = await authorization.ownerSession(request);
    return allocatePhoto(
      pool,
      principal,
      params.parse(request.params).id,
      FoodUploadSchema.parse(request.body),
      (client) => authorization.authorizeAgain(request, principal, client),
    );
  });
  let active = 0;
  const counted = new WeakSet<object>();
  app.register(async (scope) => {
    scope.addHook('onRequest', async (request) => {
      await authorization.ownerSession(request);
    });
    scope.addHook('preParsing', async (request) => {
      if (active >= 2)
        throw new ApplicationError(
          429,
          'UPLOAD_BUSY',
          'Two photos are uploading. Please retry shortly.',
        );
      active++;
      counted.add(request);
    });
    scope.addHook('onResponse', async (request) => {
      if (counted.has(request)) {
        counted.delete(request);
        active--;
      }
    });
    scope.addContentTypeParser(
      // Expo's File body uses the file MIME even when a caller supplies octet-stream.
      // These are still raw, bounded bytes; receivePhoto verifies the allocated type and checksum.
      ['application/octet-stream', 'image/jpeg', 'image/png'],
      { parseAs: 'buffer', bodyLimit: mediaLimit },
      (_request, body, done) => done(null, body),
    );
    scope.put('/api/media/:id/content', { bodyLimit: mediaLimit }, async (request) => {
      const { principal } = await authorization.ownerSession(request);
      if (!Buffer.isBuffer(request.body))
        throw new ApplicationError(400, 'PHOTO_BODY', 'Upload raw photo bytes.');
      return receivePhoto(
        pool,
        principal,
        params.parse(request.params).id,
        request.body,
        options.mediaDirectory,
        (client) => authorization.authorizeAgain(request, principal, client),
      );
    });
  });
  app.post('/api/media/:id/finalize', async (request) => {
    const { principal } = await authorization.ownerSession(request);
    return finalizePhoto(
      pool,
      principal,
      params.parse(request.params).id,
      FoodFinalizeSchema.parse(request.body),
      options.mediaDirectory,
      (client) => authorization.authorizeAgain(request, principal, client),
    );
  });
  app.get('/api/media/:id', async (request, reply) => {
    const { principal } = await authorization.ownerSession(request);
    const photo = await readPhoto(
      pool,
      principal,
      params.parse(request.params).id,
      options.mediaDirectory,
    );
    return reply
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .type(photo.contentType)
      .send(photo.bytes);
  });
}
