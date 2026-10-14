import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, symlink, writeFile, rm, realpath, chmod, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  copyOperatorFile,
  createPrivateDirectory,
  fsyncTree,
  pathsOverlap,
} from '../operator-safety.mjs';

const temp = await realpath(await mkdtemp(join(tmpdir(), 'mems-operator-')));

test('archive and media paths cannot contain each other', () => {
  assert.equal(pathsOverlap('/tmp/media', '/tmp/media/backup'), true);
  assert.equal(pathsOverlap('/tmp/backup', '/tmp/backup'), true);
  assert.equal(pathsOverlap('/tmp/media', '/tmp/media-backup'), false);
});

test('secret copy refuses a symlink swapped in for a regular file', async () => {
  const directory = join(temp, 'secrets');
  await mkdir(directory, { mode: 0o700 });
  const real = join(directory, 'real.env');
  const link = join(directory, 'linked.env');
  await writeFile(real, 'SECRET=value\n', { mode: 0o600 });
  await symlink(real, link);
  await assert.rejects(
    copyOperatorFile(link, join(directory, 'out.env')),
    /ELOOP|EINVAL|EPERM|operator-only|regular/,
  );
  await chmod(real, 0o644);
  await assert.rejects(copyOperatorFile(real, join(directory, 'wide.env')), /operator-only/);
});

test('backup refuses a destination inside the media tree before maintenance', async () => {
  const media = join(temp, 'media');
  await mkdir(media, { mode: 0o700 });
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'scripts/backup.mjs', join(media, 'nested-backup')],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        DATABASE_URL: 'postgresql://mems_life@127.0.0.1:1/mems_life',
        MEDIA_DIRECTORY: media,
      },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}\n${result.stdout}`, /must not overlap/);
  assert.equal(
    await lstat(join(media, 'nested-backup')).then(
      () => true,
      () => false,
    ),
    false,
  );
});

test('private directories are durable and reject a symlinked parent', async () => {
  const created = await createPrivateDirectory(join(temp, 'archive'));
  await writeFile(join(created, 'manifest.json'), '{}\n', { mode: 0o600 });
  await fsyncTree(created);
  assert.equal((await lstat(created)).mode & 0o077, 0);
  const outside = join(temp, 'outside');
  await mkdir(outside, { mode: 0o700 });
  const linked = join(temp, 'linked-parent');
  await symlink(outside, linked);
  await assert.rejects(createPrivateDirectory(join(linked, 'child')), /symlink/);
});

test.after(async () => {
  await rm(temp, { recursive: true, force: true });
});
