import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const image = process.env.CONTAINER_VERIFY_IMAGE ?? 'mems-life:verify';
const postgresImage =
  'postgres:16.14-bookworm@sha256:64154d0babcb1741988719e703419af0382b19953706149f9872fbd0f438efa8';
const runId = `mems-life-verify-${randomBytes(6).toString('hex')}`;
const resources = {
  network: runId,
  database: `${runId}-database`,
  app: `${runId}-app`,
  media: `${runId}-media`,
};
const password = randomBytes(32).toString('hex');
const lockHash = createHash('sha256')
  .update(readFileSync(`${root}/package-lock.json`))
  .digest('hex');
const docker = (args, options = {}) =>
  execFileSync('docker', args, { cwd: root, encoding: 'utf8', ...options });
const request = (url, options = {}) =>
  fetch(url, { signal: AbortSignal.timeout(10000), ...options });
const waitFor = async (description, check) => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if (await check()) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for ${description}.`);
};

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  for (const name of [resources.app, resources.database]) {
    try {
      docker(['rm', '--force', '--volumes', name], { stdio: 'ignore' });
    } catch {}
  }
  try {
    docker(['volume', 'rm', resources.media], { stdio: 'ignore' });
  } catch {}
  try {
    docker(['network', 'rm', resources.network], { stdio: 'ignore' });
  } catch {}
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    cleanup();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  });
}

try {
  docker(['info'], { stdio: 'ignore' });
  if (!process.argv.includes('--skip-build')) {
    docker(['build', '--tag', image, '.'], { stdio: 'inherit' });
  }
  docker(
    [
      'run',
      '--rm',
      image,
      'node',
      '--input-type=module',
      '-e',
      `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import { createHash } from 'node:crypto';
    assert.equal(process.getuid(), 1000);
    assert.equal(process.versions.node, '24.21.0');
    assert.equal(createHash('sha256').update(fs.readFileSync('package-lock.json')).digest('hex'), '${lockHash}');
    for (const path of ['apps/server/src', 'apps/server/test', 'apps/mobile', 'apps/web/src', 'scripts', 'node_modules/expo', 'node_modules/react-native', 'node_modules/react', 'node_modules/typescript', 'node_modules/jest', 'node_modules/tsx', 'node_modules/@playwright']) {
      assert.equal(fs.existsSync(path), false, path + ' must not be distributed');
    }
    for (const name of ['@mems-life/domain', 'better-auth', '@better-auth/expo', 'pg', 'fastify', '@modelcontextprotocol/sdk/server/mcp.js', 'sharp']) await import(name);
    const { default: sharp } = await import('sharp');
    const png = await sharp({create:{width:4,height:4,channels:3,background:'#78a456'}}).png().toBuffer();
    assert.equal((await sharp(png).metadata()).width, 4);
    fs.accessSync('apps/web/dist/index.html');
    fs.accessSync('THIRD-PARTY-NOTICES.txt');
    fs.writeFileSync('/var/lib/mems-life/media/verification.txt', 'fixture');
    fs.unlinkSync('/var/lib/mems-life/media/verification.txt');
    console.log('Runtime identity, lock, imports, files, and media permissions passed.');
  `,
    ],
    { stdio: 'inherit' },
  );
  console.log('Verified lock SHA-256: ' + lockHash);
  docker(['network', 'create', resources.network]);
  docker(['volume', 'create', resources.media]);
  docker([
    'run',
    '--detach',
    '--name',
    resources.database,
    '--network',
    resources.network,
    '--env',
    'POSTGRES_DB=mems_life',
    '--env',
    'POSTGRES_USER=mems_life',
    '--env',
    `POSTGRES_PASSWORD=${password}`,
    postgresImage,
  ]);
  await waitFor('PostgreSQL', () => {
    docker(['exec', resources.database, 'pg_isready', '-U', 'mems_life', '-d', 'mems_life'], {
      stdio: 'ignore',
    });
    return true;
  });
  const appEnvironment = [
    '--env',
    `DATABASE_URL=postgresql://mems_life:${password}@${resources.database}:5432/mems_life`,
    '--env',
    `BETTER_AUTH_SECRET=${randomBytes(32).toString('hex')}`,
    '--env',
    'BETTER_AUTH_URL=https://container.example.invalid',
    '--env',
    'WEB_ORIGIN=https://container.example.invalid',
    '--env',
    'MEDIA_DIRECTORY=/var/lib/mems-life/media',
  ];
  const administratorContainer = ['run', '--rm', '--network', resources.network, ...appEnvironment];
  docker([...administratorContainer, image, 'npm', 'run', 'db:migrate'], { stdio: 'inherit' });
  docker(
    [
      ...administratorContainer,
      '--interactive',
      '--env',
      'OWNER_EMAIL=fixture@example.invalid',
      '--env',
      'OWNER_NAME=Container Fixture',
      image,
      'npm',
      'run',
      'bootstrap',
    ],
    { input: `${password}\n`, stdio: ['pipe', 'inherit', 'inherit'] },
  );
  docker([...administratorContainer, '--interactive', image, 'npm', 'run', 'recover'], {
    input: `${password}\n`,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  docker([
    'run',
    '--detach',
    '--name',
    resources.app,
    '--network',
    resources.network,
    '--publish',
    '127.0.0.1::3001',
    '--mount',
    `type=volume,source=${resources.media},target=/var/lib/mems-life/media`,
    ...appEnvironment,
    image,
  ]);
  const serviceOrigin = () =>
    `http://127.0.0.1:${docker(['port', resources.app, '3001/tcp']).trim().split(':').at(-1)}`;
  let origin = serviceOrigin();
  await waitFor('service health', async () => {
    const response = await request(`${origin}/api/health`);
    return response.ok && (await response.json()).status === 'ok';
  });
  const home = await request(origin);
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /<html/);
  const asset = html.match(/src="([^\"]+\.js)"/)?.[1];
  assert.ok(asset, 'Web HTML must reference its built JavaScript asset.');
  assert.equal((await request(new URL(asset, origin))).status, 200);
  assert.equal((await request(`${origin}/api/me`)).status, 401);
  const login = await request(`${origin}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://container.example.invalid' },
    body: JSON.stringify({ email: 'fixture@example.invalid', password }),
  });
  assert.equal(login.status, 200, await login.text());
  const cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  assert.ok(cookie, 'Sign-in must return a session cookie.');
  const authenticated = async (path, method = 'GET', body, binary = false) => {
    const response = await request(`${origin}${path}`, {
      method,
      headers: {
        Cookie: cookie,
        Origin: 'https://container.example.invalid',
        ...(body === undefined
          ? {}
          : { 'Content-Type': binary ? 'application/octet-stream' : 'application/json' }),
      },
      ...(body === undefined ? {} : { body: binary ? body : JSON.stringify(body) }),
    });
    assert.equal(response.status, 200, `${method} ${path}: ${await response.clone().text()}`);
    return response;
  };
  await authenticated('/api/me');
  const preferences = await (await authenticated('/api/preferences')).json();
  const savedPreferences = await (
    await authenticated('/api/preferences', 'PUT', {
      operationId: randomUUID(),
      expectedRevision: preferences.revision,
      value: {
        ...preferences.value,
        displayName: 'Persisted Container Fixture',
        timeZone: 'America/New_York',
      },
    })
  ).json();
  const entryId = randomUUID();
  await authenticated('/api/food/commands', 'POST', {
    type: 'food.create',
    operationId: randomUUID(),
    entryId,
    expectedRevision: 0,
    content: {
      text: 'Fictional vegetables',
      occurredAt: new Date().toISOString(),
      timezone: 'UTC',
    },
  });
  const photo = Buffer.from(
    docker([
      'run',
      '--rm',
      image,
      'node',
      '--input-type=module',
      '-e',
      "import sharp from 'sharp'; console.log((await sharp({create:{width:12,height:12,channels:3,background:'#98ba72'}}).jpeg().toBuffer()).toString('base64'))",
    ]).trim(),
    'base64',
  );
  const allocation = await (
    await authenticated(`/api/food/${entryId}/uploads`, 'POST', {
      operationId: randomUUID(),
      expectedRevision: 1,
      size: photo.length,
      sha256: createHash('sha256').update(photo).digest('hex'),
      contentType: 'image/jpeg',
    })
  ).json();
  const photoId = allocation.upload.id;
  await authenticated(`/api/media/${photoId}/content`, 'PUT', photo, true);
  await authenticated(`/api/media/${photoId}/finalize`, 'POST', {
    operationId: randomUUID(),
    expectedRevision: 1,
  });
  assert.equal((await request(`${origin}/api/media/${photoId}`)).status, 401);
  const taskId = randomUUID(),
    fileId = randomUUID(),
    file = Buffer.from('Fictional container transfer fixture.\n');
  await authenticated('/api/tasks/commands', 'POST', {
    type: 'task.create',
    operationId: randomUUID(),
    taskId,
    expectedRevision: 0,
    content: { title: 'Container fixture', description: '', notes: '' },
  });
  await authenticated(`/api/tasks/${taskId}/files`, 'POST', {
    operationId: randomUUID(),
    expectedRevision: 1,
    fileId,
    name: 'fixture.txt',
    size: file.length,
    sha256: createHash('sha256').update(file).digest('hex'),
    contentType: 'text/plain',
  });
  await authenticated(`/api/task-files/${fileId}/content`, 'PUT', file, true);
  await authenticated(`/api/task-files/${fileId}/finalize`, 'POST', {
    operationId: randomUUID(),
    expectedRevision: 1,
  });
  assert.equal((await request(`${origin}/api/task-files/${fileId}`)).status, 401);
  const verifyPersisted = async () => {
    assert.deepEqual(await (await authenticated('/api/preferences')).json(), savedPreferences);
    const photoResponse = await authenticated(`/api/media/${photoId}`);
    assert.match(photoResponse.headers.get('cache-control') ?? '', /(?:^|,\s*)no-store(?:,|$)/);
    assert.deepEqual(Buffer.from(await photoResponse.arrayBuffer()), photo);
    const fileResponse = await authenticated(`/api/task-files/${fileId}`);
    assert.match(fileResponse.headers.get('cache-control') ?? '', /(?:^|,\s*)no-store(?:,|$)/);
    assert.deepEqual(Buffer.from(await fileResponse.arrayBuffer()), file);
  };
  await verifyPersisted();
  docker(['restart', resources.database]);
  await waitFor('PostgreSQL after restart', () => {
    docker(['exec', resources.database, 'pg_isready', '-U', 'mems_life', '-d', 'mems_life'], {
      stdio: 'ignore',
    });
    return true;
  });
  docker(['restart', resources.app]);
  origin = serviceOrigin();
  await waitFor('service after restart', async () => (await request(`${origin}/api/health`)).ok);
  await verifyPersisted();
  console.log(
    'Applied migration versions: ' +
      docker([
        'exec',
        resources.database,
        'psql',
        '-U',
        'mems_life',
        '-d',
        'mems_life',
        '-Atc',
        "SELECT string_agg(version::text, ',' ORDER BY version) FROM application_migrations",
      ]).trim(),
  );
  const ownerCount = docker([
    'exec',
    resources.database,
    'psql',
    '-U',
    'mems_life',
    '-d',
    'mems_life',
    '-Atc',
    'SELECT count(*) FROM installation',
  ]);
  assert.equal(ownerCount.trim(), '1', 'Bootstrap state must survive application restart.');
  console.log(
    'Container migration, bootstrap, recovery, web assets, authentication, private photo/file transfers, and media/preferences/database restart persistence passed.',
  );
  console.log(
    docker(['image', 'inspect', image, '--format', 'Image {{.Id}}; {{.Size}} bytes']).trim(),
  );
} finally {
  cleanup();
}
