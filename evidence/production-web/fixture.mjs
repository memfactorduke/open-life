// Disposable local TLS laboratory, never public deployment. Credentials stay in ignored .runtime.
import { Pool } from 'pg';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import https from 'node:https';
import http from 'node:http';
import { createApp } from '../../apps/server/dist/app.js';
import { migrate, bootstrapOwner } from '../../apps/server/dist/database.js';
const runtime = new URL('../../.runtime/production-web/', import.meta.url);
await mkdir(runtime, { recursive: true });
const admin = new Pool({ connectionString: 'postgresql://mems_life@127.0.0.1:55432/postgres' });
const database = 'mems_life_production_web_test';
if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount)
  await admin.query(`CREATE DATABASE ${database}`);
await admin.end();
const databaseURL = `postgresql://mems_life@127.0.0.1:55432/${database}`;
const credentials = await readFile(new URL('credentials.json', runtime), 'utf8')
  .then(JSON.parse)
  .catch(() => ({
    email: 'production-review@example.test',
    password: randomBytes(24).toString('hex'),
    secret: randomBytes(32).toString('hex'),
  }));
await writeFile(new URL('credentials.json', runtime), JSON.stringify(credentials), { mode: 0o600 });
const config = {
  DATABASE_URL: databaseURL,
  BETTER_AUTH_SECRET: credentials.secret,
  BETTER_AUTH_URL: 'https://localhost:3443',
  WEB_ORIGIN: 'https://localhost:3443',
  NODE_ENV: 'production',
  NATIVE_SCHEME: 'memslife',
  HOST: '127.0.0.1',
  PORT: 3002,
  MEDIA_DIRECTORY: new URL('media', runtime).pathname,
};
const pool = new Pool({ connectionString: databaseURL });
await migrate(pool, config);
if (!(await pool.query('SELECT 1 FROM installation')).rowCount)
  await bootstrapOwner(pool, config, { ...credentials, name: 'Fictional production reviewer' });
const { app } = await createApp(config, pool);
await app.listen({ host: config.HOST, port: config.PORT });
const proxy = https.createServer(
  {
    key: await readFile(new URL('key.pem', runtime)),
    cert: await readFile(new URL('cert.pem', runtime)),
  },
  (request, response) => {
    const upstream = http.request(
      {
        hostname: '127.0.0.1',
        port: 3002,
        path: request.url,
        method: request.method,
        headers: { ...request.headers, 'x-forwarded-proto': 'https' },
      },
      (incoming) => {
        response.writeHead(incoming.statusCode, incoming.headers);
        incoming.pipe(response);
      },
    );
    upstream.on('error', () => {
      response.writeHead(502);
      response.end();
    });
    request.pipe(upstream);
  },
);
await new Promise((resolve) => proxy.listen(3443, '127.0.0.1', resolve));
console.log(
  'Production fixture ready: https://localhost:3443; isolated database; no external providers.',
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    proxy.close();
    await app.close();
    await pool.end();
    process.exit(0);
  });
