// Target an EMPTY, separate database and new media directory. No live installation is overwritten.
import { Pool } from 'pg';
import { readFile, mkdir, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  digestFile,
  verifyTree,
  copyPrivateTree,
  verifyDatabaseMedia,
  postgresCommand,
  rotateRestoreEpoch,
} from '../apps/server/src/portability.ts';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  if (!process.env.DATABASE_URL || !process.env.MEDIA_DIRECTORY || !process.argv[2])
    throw new Error('DATABASE_URL, new MEDIA_DIRECTORY and backup directory required.');
  const backup = resolve(process.argv[2]);
  if ((await lstat(backup)).isSymbolicLink()) throw new Error('Symlink backup rejected.');
  const manifest = JSON.parse(await readFile(join(backup, 'manifest.json'), 'utf8'));
  if (
    manifest.format !== 'mems-life-coherent-backup' ||
    manifest.version !== 1 ||
    !manifest.migrations.includes(13)
  )
    throw new Error('Unsupported backup schema.');
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
  const target = resolve(process.env.MEDIA_DIRECTORY);
  await mkdir(target, { mode: 0o700 });
  const copied = await copyPrivateTree(join(backup, 'media'), target);
  const expected = [...manifest.media].sort((a, b) => a.path.localeCompare(b.path));
  if (JSON.stringify(copied) !== JSON.stringify(expected))
    throw new Error('Media manifest does not describe the complete private tree.');
  await postgresCommand('pg_restore', process.env.DATABASE_URL, [
    '--exit-on-error',
    '--single-transaction',
    '--no-owner',
    '--dbname',
    new URL(process.env.DATABASE_URL).pathname.slice(1),
    join(backup, 'database.dump'),
  ]);
  // The dump captures maintenance=true. It remains closed throughout validation and epoch rotation.
  await verifyDatabaseMedia(pool, target);
  const installation = (await pool.query('SELECT id FROM installation')).rows[0];
  if (installation?.id !== manifest.installationId)
    throw new Error('Installation identity mismatch.');
  const versions = (
    await pool.query('SELECT version FROM application_migrations ORDER BY version')
  ).rows.map((r) => r.version);
  if (JSON.stringify(versions) !== JSON.stringify(manifest.migrations))
    throw new Error('Migration manifest mismatch.');
  const epoch = await rotateRestoreEpoch(pool, manifest.capturedAt);
  console.log(
    `Restore verified; new epoch ${epoch}. Maintenance remains closed. Supply protected configuration, check access, then run backup.mjs --resume. Changes after ${manifest.capturedAt} may be lost; previously attempted commands require review.`,
  );
} finally {
  await pool.end();
}
