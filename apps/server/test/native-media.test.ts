import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
import { Pool } from 'pg';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { migrate, bootstrapOwner } from '../src/database.js';

test('actual native HTTP food photo allocation, binary transfer, finalization and private read', async () => {
  const databaseUrl =
    process.env.NATIVE_MEDIA_TEST_DATABASE_URL ??
    'postgresql://mems_life@127.0.0.1:55432/mems_life_native_media_test';
  assert.equal(new URL(databaseUrl).pathname, '/mems_life_native_media_test');
  const pool = new Pool({ connectionString: databaseUrl });
  const directory = await mkdtemp(join(tmpdir(), 'mems-native-media-'));
  const config = readConfig({
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: 'fictional-native-media-secret-long-enough',
    BETTER_AUTH_URL: 'http://localhost:3001',
    WEB_ORIGIN: 'http://localhost:5173',
    MEDIA_DIRECTORY: directory,
    NODE_ENV: 'test',
  });
  let service: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await migrate(pool, config);
    const identity = {
      email: 'native-media@example.test',
      name: 'Native Media Fixture',
      password: 'fictional-native-media-password-123',
    };
    await bootstrapOwner(pool, config, identity);
    service = await createApp(config, pool);
    const login = await service.app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: 'memslife://' },
      payload: identity,
    });
    assert.equal(login.statusCode, 200, login.body);
    const cookie = login.cookies.map((item) => `${item.name}=${item.value}`).join('; ');
    const headers = { origin: 'memslife://', cookie };
    const entryId = randomUUID();
    const create = await service.app.inject({
      method: 'POST',
      url: '/api/food/commands',
      headers,
      payload: {
        type: 'food.create',
        operationId: randomUUID(),
        entryId,
        expectedRevision: 0,
        content: {
          text: 'Fictional native JPEG',
          occurredAt: '2026-10-12T12:00:00.000Z',
          timezone: 'America/New_York',
        },
      },
    });
    assert.equal(create.statusCode, 200, create.body);
    const bytes = process.env.NATIVE_MEDIA_FIXTURE
      ? await readFile(process.env.NATIVE_MEDIA_FIXTURE)
      : await sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#d8bb8a' } })
          .jpeg({ quality: 85 })
          .toBuffer();
    const allocation = await service.app.inject({
      method: 'POST',
      url: `/api/food/${entryId}/uploads`,
      headers,
      payload: {
        operationId: randomUUID(),
        expectedRevision: 1,
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        contentType: 'image/jpeg',
      },
    });
    assert.equal(allocation.statusCode, 200, allocation.body);
    const uploadId = allocation.json().upload.id;
    const contentUrl = `/api/media/${uploadId}/content`;
    const anonymous = await service.app.inject({
      method: 'PUT',
      url: contentUrl,
      headers: { origin: 'memslife://', 'content-type': 'image/jpeg' },
      payload: bytes,
    });
    assert.equal(anonymous.statusCode, 401, anonymous.body);
    const oversized = await service.app.inject({
      method: 'PUT',
      url: contentUrl,
      headers: { ...headers, 'content-type': 'image/jpeg' },
      payload: Buffer.alloc(8 * 1024 * 1024 + 1),
    });
    assert.equal(oversized.statusCode, 413, oversized.body);
    const mismatch = await service.app.inject({
      method: 'PUT',
      url: contentUrl,
      headers: { ...headers, 'content-type': 'image/jpeg' },
      payload: bytes.subarray(0, bytes.length - 1),
    });
    assert.equal(mismatch.statusCode, 422, mismatch.body);
    assert.equal(mismatch.json().error.code, 'PHOTO_CHECKSUM');
    const upload = await service.app.inject({
      method: 'PUT',
      url: contentUrl,
      headers: { ...headers, 'content-type': 'image/jpeg' },
      payload: bytes,
    });
    assert.equal(upload.statusCode, 200, upload.body);
    const command = { operationId: randomUUID(), expectedRevision: 1 };
    const finalizeRequest = {
      method: 'POST' as const,
      url: `/api/media/${uploadId}/finalize`,
      headers,
      payload: command,
    };
    const finalize = await service.app.inject(finalizeRequest);
    assert.equal(finalize.statusCode, 200, finalize.body);
    assert.equal(finalize.json().entry.photoIds.filter((id: string) => id === uploadId).length, 1);
    assert.deepEqual((await service.app.inject(finalizeRequest)).json(), finalize.json());
    const image = await service.app.inject({ url: `/api/media/${uploadId}`, headers });
    assert.equal(image.statusCode, 200, image.body);
    assert.deepEqual(image.rawPayload, bytes);
  } finally {
    await service?.app.close();
    await pool.end();
    await rm(directory, { recursive: true, force: true });
  }
});
