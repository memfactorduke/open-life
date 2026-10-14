// Hermetic production web fixture. Credentials stay in mode 0600 files and are never printed.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import { register } from 'tsx/esm/api';

export const fixtureDatabase = 'mems_life_ci_web';

register();
const { createApp } = await import('../apps/server/src/app.ts');
const { migrate, bootstrapOwner } = await import('../apps/server/src/database.ts');
const { readConfig } = await import('../apps/server/src/config.ts');

export function boundedPort(value, name) {
  if (!/^[0-9]+$/.test(String(value))) throw new Error(`${name} must be an integer port.`);
  const port = Number(value);
  if (port < 1024 || port > 65535) throw new Error(`${name} must be between 1024 and 65535.`);
  return port;
}

export function fixturePostgresPort() {
  return boundedPort(process.env.MEMS_LIFE_PG_PORT ?? '55432', 'MEMS_LIFE_PG_PORT');
}

export function fixturePorts(env = process.env) {
  const appPort = boundedPort(env.RC_WEB_APP_PORT ?? '3631', 'RC_WEB_APP_PORT');
  const tlsPort = boundedPort(env.RC_WEB_TLS_PORT ?? '3643', 'RC_WEB_TLS_PORT');
  if (appPort === tlsPort) throw new Error('App and TLS ports must be different.');
  return { appPort, tlsPort };
}

async function ensureDatabase(pgPort) {
  if (fixtureDatabase !== 'mems_life_ci_web')
    throw new Error('Refusing an unexpected fixture database.');
  const admin = new Pool({
    connectionString: `postgresql://mems_life@127.0.0.1:${pgPort}/postgres`,
    max: 1,
  });
  try {
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      fixtureDatabase,
    ]);
    if (!existing.rowCount) await admin.query('CREATE DATABASE mems_life_ci_web');
  } finally {
    await admin.end();
  }
}

async function protectedFile(url, bytes) {
  await writeFile(url, bytes, { mode: 0o600, flag: 'wx' }).catch(async (error) => {
    if (error.code !== 'EEXIST') throw error;
  });
  await chmod(url, 0o600);
  const info = await lstat(url);
  if (info.isSymbolicLink() || !info.isFile() || info.mode & 0o077) {
    throw new Error('Fixture credential file must be a regular mode 0600 file.');
  }
}

export async function startRcWebFixture(env = process.env) {
  const { appPort, tlsPort } = fixturePorts(env);
  const pgPort = fixturePostgresPort();
  const runtime = new URL('../.runtime/ci-web/', import.meta.url);
  const runtimePath = fileURLToPath(runtime);
  await mkdir(runtime, { recursive: true, mode: 0o700 });
  await chmod(runtimePath, 0o700);
  const media = new URL('media/', runtime);
  await mkdir(media, { recursive: true, mode: 0o700 });
  const credentialsUrl = new URL('credentials.json', runtime);
  let credentials;
  try {
    credentials = JSON.parse(await readFile(credentialsUrl, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    credentials = {
      email: 'ci-web@example.test',
      password: randomBytes(24).toString('hex'),
      secret: randomBytes(32).toString('hex'),
    };
    await protectedFile(credentialsUrl, JSON.stringify(credentials));
  }
  await chmod(credentialsUrl, 0o600);
  if (!credentials.email || !credentials.password || !credentials.secret) {
    throw new Error('Fixture credentials are incomplete.');
  }
  const origin = `https://127.0.0.1:${tlsPort}`;
  const envFile = [
    `WEB_TEST_EMAIL=${credentials.email}`,
    `WEB_TEST_PASSWORD=${credentials.password}`,
    `WEB_TEST_URL=${origin}`,
    'WEB_PRODUCTION_TEST=1',
    'WEB_TEST_IGNORE_HTTPS_ERRORS=1',
    env.RC_WEB_TODAY_LIVE === '1' ? 'TODAY_LIVE_WORKOUT_PROOF=1' : '',
  ]
    .filter(Boolean)
    .join('\n')
    .concat('\n');
  const envUrl = new URL('web.env', runtime);
  await writeFile(envUrl, envFile, { mode: 0o600 });
  await chmod(envUrl, 0o600);
  const key = fileURLToPath(new URL('key.pem', runtime));
  const cert = fileURLToPath(new URL('cert.pem', runtime));
  try {
    await readFile(key);
    await readFile(cert);
  } catch {
    const generated = spawnSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-sha256',
        '-days',
        '2',
        '-nodes',
        '-keyout',
        key,
        '-out',
        cert,
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=DNS:localhost,IP:127.0.0.1',
      ],
      { stdio: 'ignore' },
    );
    if (generated.status !== 0) throw new Error('Could not create the local fixture certificate.');
  }
  await chmod(key, 0o600);
  await chmod(cert, 0o600);
  await ensureDatabase(pgPort);
  const config = readConfig({
    DATABASE_URL: `postgresql://mems_life@127.0.0.1:${pgPort}/${fixtureDatabase}`,
    BETTER_AUTH_SECRET: credentials.secret,
    BETTER_AUTH_URL: origin,
    WEB_ORIGIN: origin,
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(appPort),
    MEDIA_DIRECTORY: fileURLToPath(media),
    EXPO_PUSH_ENABLED: 'false',
  });
  if (new URL(config.DATABASE_URL).pathname !== `/${fixtureDatabase}`) {
    throw new Error('Fixture database escaped its allowlist.');
  }
  const pool = new Pool({ connectionString: config.DATABASE_URL, max: 5 });
  let app;
  let proxy;
  let released = false;
  const releaseStartup = async () => {
    if (released) return;
    released = true;
    if (proxy) await new Promise((resolve) => proxy.close(resolve));
    if (app) await app.close();
    await pool.end();
  };
  try {
    await migrate(pool, config);
    if (!(await pool.query('SELECT 1 FROM installation')).rowCount) {
      await bootstrapOwner(pool, config, {
        email: credentials.email,
        name: 'Fictional CI Reviewer',
        password: credentials.password,
      });
    }
    app = (await createApp(config, pool)).app;
    await app.listen({ host: '127.0.0.1', port: appPort });
    proxy = https.createServer(
      { key: await readFile(key), cert: await readFile(cert) },
      (request, response) => {
        const upstream = http.request(
          {
            hostname: '127.0.0.1',
            port: appPort,
            path: request.url,
            method: request.method,
            headers: { ...request.headers, 'x-forwarded-proto': 'https' },
          },
          (incoming) => {
            response.writeHead(incoming.statusCode ?? 502, incoming.headers);
            incoming.pipe(response);
          },
        );
        upstream.on('error', () => {
          if (!response.headersSent) response.writeHead(502);
          response.end();
        });
        request.pipe(upstream);
      },
    );
    await new Promise((resolve, reject) => {
      proxy.once('error', reject);
      proxy.listen(tlsPort, '127.0.0.1', resolve);
    });
  } catch (error) {
    await releaseStartup();
    throw error;
  }
  const stop = async () => {
    await releaseStartup();
  };
  console.log(
    `RC web fixture ready at ${origin} for ${fixtureDatabase}. Credentials remain in .runtime/ci-web.`,
  );
  return {
    origin,
    appPort,
    tlsPort,
    database: fixtureDatabase,
    credentialsPath: fileURLToPath(credentialsUrl),
    envPath: fileURLToPath(envUrl),
    stop,
  };
}

export function fixtureHelp() {
  return [
    'Usage: node scripts/rc-web-fixture.mjs [--help]',
    'Starts the hermetic production fixture on 127.0.0.1.',
    'RC_WEB_APP_PORT defaults to 3631 and RC_WEB_TLS_PORT defaults to 3643.',
    'Ports must be between 1024 and 65535 and must differ.',
    'The only database is mems_life_ci_web. Credentials stay in .runtime/ci-web.',
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(fixtureHelp());
  } else {
    try {
      const started = await startRcWebFixture();
      for (const signal of ['SIGINT', 'SIGTERM']) {
        process.once(signal, () => {
          started.stop().then(
            () => process.exit(0),
            () => process.exit(1),
          );
        });
      }
    } catch (error) {
      console.error(error.code === 'EADDRINUSE' ? error.message : 'Fixture startup failed.');
      process.exitCode = 1;
    }
  }
}
