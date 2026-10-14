import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const image = process.env.CONTAINER_OPERATOR_VERIFY_IMAGE ?? 'mems-life:operator-verify';
const databaseImage = process.env.CONTAINER_VERIFY_DATABASE_IMAGE ?? 'mems-life:database-verify';
const project = `mems-life-operator-verify-${randomBytes(5).toString('hex')}`;
mkdirSync(join(root, '.runtime'), { recursive: true });
const temp = mkdtempSync(join(root, '.runtime', project));
const archives = join(temp, 'archives'),
  configuration = join(temp, 'configuration');
mkdirSync(archives, { mode: 0o700 });
mkdirSync(configuration, { mode: 0o700 });
const secret = randomBytes(32).toString('hex');
writeFileSync(join(configuration, 'fixture.env'), `FICTIONAL_SECRET=${secret}\n`, { mode: 0o600 });
const envFile = join(temp, 'installation.env');
writeFileSync(
  envFile,
  `POSTGRES_PASSWORD=${randomBytes(32).toString('hex')}\nRESTORE_POSTGRES_PASSWORD=${randomBytes(32).toString('hex')}\nBETTER_AUTH_SECRET=${randomBytes(32).toString('hex')}\nAPP_HOST=operator.example.invalid\nOPERATOR_ARCHIVE_DIRECTORY=${archives}\nOPERATOR_CONFIGURATION_DIRECTORY=${configuration}\n`,
  { mode: 0o600 },
);
const override = join(temp, 'override.json');
writeFileSync(
  override,
  JSON.stringify({
    services: {
      operator: { image },
      'restore-operator': { image },
      database: { image: databaseImage },
      'restore-database': { image: databaseImage },
    },
  }),
);
const docker = (args, options = {}) =>
  execFileSync('docker', args, { cwd: root, encoding: 'utf8', ...options });
const compose = (args, options) =>
  docker(
    [
      'compose',
      '--project-name',
      project,
      '--env-file',
      envFile,
      '-f',
      'compose.yml',
      '-f',
      override,
      ...args,
    ],
    options,
  );
const operator = (args, restored = false, options) =>
  compose(['run', '--rm', '-T', restored ? 'restore-operator' : 'operator', ...args], options);
const sql = (query, restored = false) =>
  compose([
    'exec',
    '-T',
    restored ? 'restore-database' : 'database',
    'psql',
    '-U',
    'mems_life',
    '-d',
    'mems_life',
    '-Atc',
    query,
  ]).trim();
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try {
    compose(
      ['--profile', 'operator', '--profile', 'restore', 'down', '--volumes', '--remove-orphans'],
      { stdio: 'ignore' },
    );
  } catch {}
  rmSync(temp, { recursive: true, force: true });
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    cleanup();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  });
}

try {
  if (!process.argv.includes('--skip-build')) {
    docker(['build', '--target', 'database', '-t', databaseImage, '.'], { stdio: 'inherit' });
    docker(['build', '--target', 'operator', '-t', image, '.'], { stdio: 'inherit' });
  }
  docker(
    [
      'run',
      '--rm',
      image,
      '--input-type=module',
      '-e',
      `
        import assert from 'node:assert/strict';
        import fs from 'node:fs';
        import {execFileSync} from 'node:child_process';
        assert.equal(process.versions.node,'24.21.0');
        for (const path of ['node_modules/tsx','node_modules/typescript','node_modules/expo','node_modules/react-native','node_modules/jest','node_modules/@playwright','apps/server/src','/usr/local/bin/gosu','/usr/local/bin/docker-entrypoint.sh','/usr/lib/postgresql/16/bin/postgres'])
          assert.equal(fs.existsSync(path),false,path);
        for (const client of ['pg_dump','pg_restore'])
          assert.ok(execFileSync(client,['--version'],{encoding:'utf8'}).includes('16.14'));
        const status=fs.readFileSync('/var/lib/dpkg/status','utf8');
        const expected={'perl-base':'5.36.0-7+deb12u4','perl':'5.36.0-7+deb12u4','perl-modules-5.36':'5.36.0-7+deb12u4','libperl5.36':'5.36.0-7+deb12u4','libssl3':'3.0.22-1~deb12u1','openssl':'3.0.22-1~deb12u1','libpcre2-8-0':'10.42-1+deb12u2'};
        for (const [name,version] of Object.entries(expected)) {
          const entry=status.split('Package: '+name+String.fromCharCode(10)).at(1)?.split('Package:').at(0);
          assert.ok(entry?.includes('Version: '+version),'Pinned security revision '+name);
        }
        const {nativeImageInventory}=await import('./apps/server/dist/native-image-inventory.js');
        const native=nativeImageInventory();
        assert.deepEqual(native.decoderPolicy.allowed,['VipsForeignLoadJpegBuffer','VipsForeignLoadPngBuffer']);
        console.log('Native decoder security inventory: '+JSON.stringify(native));
        console.log('Operator versions and minimal dependency boundary passed.');
      `,
    ],
    { stdio: 'inherit' },
  );
  console.log(
    docker([
      'image',
      'inspect',
      databaseImage,
      '--format',
      'Database {{.Id}}; {{.Size}} bytes',
    ]).trim(),
  );
  compose(['up', '-d', '--wait', 'database']);
  // Only these one-shot setup calls receive fictional auth configuration.
  const cli = (command, options) =>
    compose(
      [
        'run',
        '--rm',
        '-T',
        '-e',
        'BETTER_AUTH_URL=https://operator.example.invalid',
        '-e',
        'WEB_ORIGIN=https://operator.example.invalid',
        '-e',
        'OWNER_EMAIL=fixture@example.invalid',
        '-e',
        'OWNER_NAME=Operator Fixture',
        'operator',
        'apps/server/dist/cli.js',
        command,
      ],
      options,
    );
  cli('migrate');
  cli('bootstrap', { input: `${randomBytes(32).toString('hex')}\n` });
  const original = sql("SELECT id::text || ',' || epoch::text FROM installation");
  const fileId = randomUUID(),
    taskId = randomUUID();
  const bytes = 'Fictional attachment bytes',
    hash = createHash('sha256').update(bytes).digest('hex');
  operator([
    '--input-type=module',
    '-e',
    `import {Pool} from 'pg'; import fs from 'node:fs/promises'; import {requireOwner} from './apps/server/dist/operations.js'; import {executeTaskCommand} from './apps/server/dist/tasks.js'; const pool=new Pool({connectionString:process.env.DATABASE_URL}); try {const owner=(await pool.query('SELECT owner_id FROM installation')).rows[0].owner_id;const actor=await requireOwner(pool,owner);await executeTaskCommand(pool,actor,{type:'task.create',operationId:'${randomUUID()}',taskId:'${taskId}',expectedRevision:0,content:{title:'Portable operator fixture',description:'',notes:''}},async()=>{});await fs.mkdir(process.env.MEDIA_DIRECTORY+'/task-files/files',{recursive:true,mode:0o700});await fs.writeFile(process.env.MEDIA_DIRECTORY+'/task-files/files/${fileId}','${bytes}',{mode:0o600});await fs.mkdir(process.env.MEDIA_DIRECTORY+'/staging',{recursive:true,mode:0o700});await fs.writeFile(process.env.MEDIA_DIRECTORY+'/staging/pending','Pending fictional bytes',{mode:0o600});await pool.query("INSERT INTO task_files(id,task_id,owner_id,name,status,size,sha256,content_type) VALUES($1,$2,$3,'fixture.txt','finalized',$4,$5,'text/plain')",['${fileId}','${taskId}',owner,${Buffer.byteLength(bytes)},'${hash}']);} finally {await pool.end();}`,
  ]);
  operator(['scripts/export.mjs', '/archives/export']);
  const exported = readFileSync(join(archives, 'export/records.json'), 'utf8');
  assert.ok(exported.includes('Portable operator fixture'));
  assert.equal(exported.includes(secret), false);
  assert.equal(
    readFileSync(join(archives, `export/attachments/task-files/files/${fileId}`), 'utf8'),
    bytes,
  );
  operator(['scripts/backup.mjs', '/archives/backup', '/configuration/fixture.env']);
  const manifest = JSON.parse(readFileSync(join(archives, 'backup/manifest.json'), 'utf8'));
  assert.ok(manifest.migrations.includes(13));
  assert.equal(
    manifest.database.sha256,
    createHash('sha256')
      .update(readFileSync(join(archives, 'backup/database.dump')))
      .digest('hex'),
  );
  assert.equal(
    readFileSync(join(archives, 'backup/protected-configuration/0-fixture.env'), 'utf8'),
    `FICTIONAL_SECRET=${secret}\n`,
  );
  assert.equal(statSync(join(archives, 'backup')).mode & 0o777, 0o700);
  assert.equal(statSync(join(archives, 'backup/database.dump')).mode & 0o777, 0o600);
  compose(['--profile', 'restore', 'up', '-d', '--wait', 'restore-database']);
  operator(['scripts/restore.mjs', '/archives/backup'], true);
  const restored = sql("SELECT id::text || ',' || epoch::text FROM installation", true).split(',');
  assert.equal(restored[0], original.split(',')[0]);
  assert.notEqual(restored[1], original.split(',')[1]);
  assert.equal(sql('SELECT maintenance FROM portability_control', true), 't');
  assert.equal(sql('SELECT maintenance FROM portability_control'), 'f');
  assert.equal(sql("SELECT id::text || ',' || epoch::text FROM installation"), original);
  operator(
    [
      '--input-type=module',
      '-e',
      `import fs from 'node:fs/promises'; import assert from 'node:assert/strict';const root=process.env.MEDIA_DIRECTORY;assert.equal(await fs.readFile(root+'/task-files/files/${fileId}','utf8'),'${bytes}');assert.equal(await fs.readFile(root+'/staging/pending','utf8'),'Pending fictional bytes');`,
    ],
    true,
  );
  operator(
    [
      '--input-type=module',
      '-e',
      'import fs from "node:fs/promises"; async function visit(p){const s=await fs.lstat(p);if(s.isSymbolicLink()||(!s.isDirectory()&&!s.isFile()))throw Error("Unsafe restored tree");if(s.isDirectory())for(const n of await fs.readdir(p))await visit(p+"/"+n);await fs.chown(p,1000,1000);}await visit(process.env.MEDIA_DIRECTORY);',
    ],
    true,
  );
  compose([
    'run',
    '--rm',
    '-T',
    '--user',
    '1000:1000',
    'restore-operator',
    '--input-type=module',
    '-e',
    `import fs from 'node:fs/promises';import assert from 'node:assert/strict';assert.equal(process.getuid(),1000);assert.equal(await fs.readFile(process.env.MEDIA_DIRECTORY+'/task-files/files/${fileId}','utf8'),'${bytes}');`,
  ]);
  // Reject a second restore without touching the original installation.
  assert.throws(() =>
    operator(['scripts/restore.mjs', '/archives/backup'], true, { stdio: 'pipe' }),
  );
  operator(['scripts/backup.mjs', '--resume'], true);
  assert.equal(sql('SELECT maintenance FROM portability_control', true), 'f');
  console.log(
    'Compose export, protected coherent backup, independent database/media restore, migration manifest, rotated epoch, closed maintenance, unchanged original and explicit resume passed.',
  );
  console.log(
    docker([
      'image',
      'inspect',
      image,
      '--format',
      'Operator {{.Id}}; {{.Architecture}}; {{.Size}} bytes',
    ]).trim(),
  );
} finally {
  cleanup();
}
