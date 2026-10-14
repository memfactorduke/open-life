// Target an EMPTY, separate database and new media directory. No live installation is overwritten.
import { Pool } from 'pg';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  copyPrivateTree,
  digestFile,
  postgresCommand,
  rotateRestoreEpoch,
  verifyDatabaseMedia,
  verifyTree,
} from '../apps/server/src/portability.ts';
import {
  assertDisjoint,
  createPrivateDirectory,
  fsyncTree,
  plainDatabaseName,
} from './operator-safety.mjs';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
let committed = false;
try {
  if (!process.env.DATABASE_URL || !process.env.MEDIA_DIRECTORY || !process.argv[2])
    throw new Error('DATABASE_URL, new MEDIA_DIRECTORY and backup directory required.');
  const databaseName = plainDatabaseName(process.env.DATABASE_URL);
  const backup = resolve(process.argv[2]);
  if ((await lstat(backup)).isSymbolicLink() || (await realpath(backup)) !== backup)
    throw new Error('Symlink backup rejected.');
  const manifest = JSON.parse(await readFile(join(backup, 'manifest.json'), 'utf8'));
  if (
    manifest.format !== 'mems-life-coherent-backup' ||
    manifest.version !== 1 ||
    !manifest.migrations.includes(13)
  )
    throw new Error('Unsupported backup schema.');
  const media = resolve(process.env.MEDIA_DIRECTORY);
  assertDisjoint(media, backup);
  const target = await createPrivateDirectory(media);
  assertDisjoint(target, backup);
  if (
    (
      await pool.query(
        "SELECT 1 FROM information_schema.tables WHERE table_schema='public' LIMIT 1",
      )
    ).rowCount
  )
    throw new Error('Restore requires an empty independent database.');
  const actual = await digestFile(join(backup, 'database.dump'));
  if (actual.sha256 !== manifest.database.sha256 || actual.size !== manifest.database.size)
    throw new Error('Database checksum mismatch.');
  await verifyTree(join(backup, 'media'), manifest.media);
  await verifyTree(
    join(backup, 'protected-configuration'),
    manifest.protectedConfiguration.map((item) => ({ ...item, path: item.name })),
  );
  const copied = await copyPrivateTree(join(backup, 'media'), target);
  const expected = [...manifest.media].sort((left, right) => left.path.localeCompare(right.path));
  if (JSON.stringify(copied) !== JSON.stringify(expected))
    throw new Error('Media manifest does not describe the complete private tree.');
  await fsyncTree(target);
  await postgresCommand('pg_restore', process.env.DATABASE_URL, [
    '--exit-on-error',
    '--single-transaction',
    '--no-owner',
    '--dbname',
    databaseName,
    join(backup, 'database.dump'),
  ]);
  committed = true;
  await verifyDatabaseMedia(pool, target);
  const installation = (await pool.query('SELECT id FROM installation')).rows[0];
  if (installation?.id !== manifest.installationId)
    throw new Error('Installation identity mismatch.');
  const versions = (
    await pool.query('SELECT version FROM application_migrations ORDER BY version')
  ).rows.map((row) => row.version);
  if (JSON.stringify(versions) !== JSON.stringify(manifest.migrations))
    throw new Error('Migration manifest mismatch.');
  const epoch = await rotateRestoreEpoch(pool, manifest.capturedAt);
  console.log(
    `Restore verified; new epoch ${epoch}. Maintenance remains closed. Supply protected configuration, check access, then run backup.mjs --resume. Changes after ${manifest.capturedAt} may be lost; previously attempted commands require review.`,
  );
} catch (error) {
  if (committed) {
    try {
      await rotateRestoreEpoch(
        pool,
        JSON.parse(await readFile(join(resolve(process.argv[2]), 'manifest.json'), 'utf8'))
          .capturedAt,
      );
    } catch {}
  }
  throw error;
} finally {
  await pool.end();
}
