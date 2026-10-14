// Run locally as the authorized installation operator: node --import tsx scripts/backup.mjs DESTINATION [SECRET_FILE ...]
import { Pool } from 'pg';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import {
  copyPrivateTree,
  digestFile,
  enterMaintenance,
  postgresCommand,
  resumeMaintenance,
  verifyDatabaseMedia,
} from '../apps/server/src/portability.ts';
import {
  assertDisjoint,
  copyOperatorFile,
  createPrivateDirectory,
  fsyncTree,
} from './operator-safety.mjs';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
let release;
try {
  if (process.argv[2] === '--resume') {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
    await resumeMaintenance(pool);
    console.log('Maintenance resumed.');
  } else {
    if (!process.env.DATABASE_URL || !process.env.MEDIA_DIRECTORY || !process.argv[2])
      throw new Error('DATABASE_URL, MEDIA_DIRECTORY and a new destination are required.');
    const media = resolve(process.env.MEDIA_DIRECTORY);
    const requested = resolve(process.argv[2]);
    assertDisjoint(requested, media);
    for (const source of process.argv.slice(3)) assertDisjoint(requested, source);
    const destination = await createPrivateDirectory(requested);
    assertDisjoint(destination, media);
    release = await enterMaintenance(pool);
    await verifyDatabaseMedia(pool, media);
    const installation = (await pool.query('SELECT id,epoch,owner_id FROM installation')).rows[0];
    if (!installation) throw new Error('An initialized installation is required.');
    const capturedAt = new Date().toISOString();
    const dump = join(destination, 'database.dump');
    await postgresCommand('pg_dump', process.env.DATABASE_URL, ['--format=custom', '--file', dump]);
    await chmod(dump, 0o600);
    const copied = await copyPrivateTree(media, join(destination, 'media'));
    const protectedConfiguration = [];
    const protectedDirectory = join(destination, 'protected-configuration');
    await mkdir(protectedDirectory, { mode: 0o700 });
    await chmod(protectedDirectory, 0o700);
    for (const [index, source] of process.argv.slice(3).entries()) {
      const name = `${index}-${basename(source)}`;
      const target = join(protectedDirectory, name);
      await copyOperatorFile(source, target);
      protectedConfiguration.push({ name, ...(await digestFile(target)) });
    }
    const migrations = (
      await pool.query('SELECT version FROM application_migrations ORDER BY version')
    ).rows.map((row) => row.version);
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
          media: copied,
          protectedConfiguration,
          configurationChecklistRequiresOperatorReview: true,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    await fsyncTree(destination);
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
