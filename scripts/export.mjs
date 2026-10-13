// Local owner-authorized export. Backup is the separate administrative operation.
import { Pool } from 'pg';
import { mkdir, writeFile, copyFile, chmod } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import {
  ownerExport,
  digestFile,
  enterMaintenance,
  verifyTree,
} from '../apps/server/src/portability.ts';
import { requireOwner } from '../apps/server/src/operations.ts';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
let release;
try {
  if (!process.argv[2] || !process.env.MEDIA_DIRECTORY)
    throw new Error('New export directory and MEDIA_DIRECTORY required.');
  const destination = resolve(process.argv[2]);
  await mkdir(destination, { mode: 0o700 });
  // Drain filesystem writers while collecting a matching readable export tree.
  release = await enterMaintenance(pool);
  const owner = (await pool.query('SELECT owner_id FROM installation')).rows[0];
  const actor = await requireOwner(pool, owner.owner_id);
  const data = await ownerExport(pool, actor);
  for (const attachment of data.attachments) {
    const source = join(
      resolve(process.env.MEDIA_DIRECTORY),
      attachment.path.slice('attachments/'.length),
    );
    await verifyTree(resolve(process.env.MEDIA_DIRECTORY), [
      {
        path: attachment.path.slice('attachments/'.length),
        size: attachment.size,
        sha256: attachment.sha256,
      },
    ]);
    const actual = await digestFile(source);
    if (actual.sha256 !== attachment.sha256 || actual.size !== attachment.size)
      throw new Error('Export attachment checksum mismatch.');
    const target = join(destination, attachment.path);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await copyFile(source, target);
    await chmod(target, 0o600);
  }
  await writeFile(join(destination, 'records.json'), JSON.stringify(data, null, 2), {
    mode: 0o600,
  });
  await pool.query(
    'UPDATE portability_control SET maintenance=false,entered_at=NULL WHERE singleton=true',
  );
  console.log(`Owner records and attachments exported to ${destination}.`);
} finally {
  if (release) await release();
  await pool.end();
}
