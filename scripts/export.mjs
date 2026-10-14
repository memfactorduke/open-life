// Local owner-authorized export. Backup is the separate administrative operation.
import { Pool } from 'pg';
import { chmod, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  digestFile,
  enterMaintenance,
  ownerExport,
  verifyTree,
} from '../apps/server/src/portability.ts';
import { requireOwner } from '../apps/server/src/operations.ts';
import { assertDisjoint, createPrivateDirectory, fsyncTree } from './operator-safety.mjs';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
let release;
try {
  if (!process.argv[2] || !process.env.MEDIA_DIRECTORY || !process.env.DATABASE_URL)
    throw new Error('DATABASE_URL, new export directory and MEDIA_DIRECTORY required.');
  const media = resolve(process.env.MEDIA_DIRECTORY);
  const requested = resolve(process.argv[2]);
  assertDisjoint(requested, media);
  const destination = await createPrivateDirectory(requested);
  assertDisjoint(destination, media);
  release = await enterMaintenance(pool);
  const owner = (await pool.query('SELECT owner_id FROM installation')).rows[0];
  const actor = await requireOwner(pool, owner.owner_id);
  const data = await ownerExport(pool, actor);
  for (const attachment of data.attachments) {
    if (!attachment.path.startsWith('attachments/'))
      throw new Error('Unsafe export attachment path.');
    const relative = attachment.path.slice('attachments/'.length);
    const source = join(media, relative);
    await verifyTree(media, [{ path: relative, size: attachment.size, sha256: attachment.sha256 }]);
    const actual = await digestFile(source);
    if (actual.sha256 !== attachment.sha256 || actual.size !== attachment.size)
      throw new Error('Export attachment checksum mismatch.');
    const target = join(destination, attachment.path);
    assertDisjoint(media, target);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await copyFile(source, target, constants.COPYFILE_EXCL);
    await chmod(target, 0o600);
  }
  await writeFile(join(destination, 'records.json'), JSON.stringify(data, null, 2), {
    mode: 0o600,
  });
  await fsyncTree(destination);
  await pool.query(
    'UPDATE portability_control SET maintenance=false,entered_at=NULL WHERE singleton=true',
  );
  console.log(`Owner records and attachments exported to ${destination}.`);
} finally {
  if (release) await release();
  await pool.end();
}
