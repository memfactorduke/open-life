// Run locally as the authorized installation operator: node --import tsx scripts/backup.mjs DESTINATION [SECRET_FILE ...]
import { Pool } from 'pg';
import { mkdir, writeFile, copyFile, chmod, lstat, realpath } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import {
  enterMaintenance,
  resumeMaintenance,
  copyPrivateTree,
  verifyDatabaseMedia,
  postgresCommand,
  digestFile,
} from '../apps/server/src/portability.ts';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
let release;
try {
  if (process.argv[2] === '--resume') {
    await resumeMaintenance(pool);
    console.log('Maintenance resumed.');
  } else {
    if (!process.env.DATABASE_URL || !process.env.MEDIA_DIRECTORY || !process.argv[2])
      throw new Error('DATABASE_URL, MEDIA_DIRECTORY and a new destination are required.');
    const destination = resolve(process.argv[2]);
    await mkdir(destination, { mode: 0o700 });
    if ((await realpath(destination)) !== destination)
      throw new Error('Destination cannot contain symlinks.');
    release = await enterMaintenance(pool);
    await verifyDatabaseMedia(pool, resolve(process.env.MEDIA_DIRECTORY));
    const installation = (await pool.query('SELECT id,epoch,owner_id FROM installation')).rows[0];
    if (!installation) throw new Error('An initialized installation is required.');
    const capturedAt = new Date().toISOString();
    const dump = join(destination, 'database.dump');
    await postgresCommand('pg_dump', process.env.DATABASE_URL, ['--format=custom', '--file', dump]);
    await chmod(dump, 0o600);
    const media = await copyPrivateTree(process.env.MEDIA_DIRECTORY, join(destination, 'media'));
    const protectedConfiguration = [];
    await mkdir(join(destination, 'protected-configuration'), { mode: 0o700 });
    for (const [index, source] of process.argv.slice(3).entries()) {
      const stat = await lstat(source);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077)
        throw new Error('Secret inputs must be regular operator-only files (0600).');
      const name = `${index}-${basename(source)}`;
      const target = join(destination, 'protected-configuration', name);
      await copyFile(source, target);
      await chmod(target, 0o600);
      protectedConfiguration.push({ name, ...(await digestFile(target)) });
    }
    const migrations = (
      await pool.query('SELECT version FROM application_migrations ORDER BY version')
    ).rows.map((r) => r.version);
    await writeFile(
      join(destination, 'manifest.json'),
      JSON.stringify(
        {
          format: 'mems-life-coherent-backup',
          version: 1,
          capturedAt,
          installationId: installation.id,
          epoch: installation.epoch,
          migrations,
          database: await digestFile(dump),
          media,
          protectedConfiguration,
          configurationChecklistRequiresOperatorReview: true,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    await pool.query(
      'UPDATE portability_control SET maintenance=false,entered_at=NULL WHERE singleton=true',
    );
    console.log(
      `Database and media backup verified at ${destination}. Protected configuration supplied: ${protectedConfiguration.length > 0}.`,
    );
  }
} finally {
  if (release) await release();
  await pool.end();
}
