import { randomUUID, createHash } from 'node:crypto';
import { mkdir, open, lstat, link, unlink, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join } from 'node:path';
import sharp from './image-codecs.js';
import type { Pool, PoolClient } from 'pg';
import type { FoodUpload } from '@mems-life/domain';
import { featureOperation } from './feature-migrations.js';
import { transaction } from './database.js';
import { requireOwner, type OwnerPrincipal } from './operations.js';
import { foodRecord, assertFoodRevision, saveFood } from './food.js';
import { ApplicationError } from './errors.js';
const MAX_SIZE = 8 * 1024 * 1024;
export const mediaLimit = MAX_SIZE;
type Media = {
  id: string;
  entry_id: string;
  owner_id: string;
  status: 'pending' | 'received' | 'finalized';
  size: number;
  sha256: string;
  content_type: 'image/jpeg' | 'image/png';
  detached_at: Date | null;
};
async function paths(directory: string, id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id))
    throw new ApplicationError(400, 'INVALID_ID', 'Invalid photo ID.');
  const configured = resolve(directory);
  await mkdir(configured, { recursive: true, mode: 0o700 });
  if ((await lstat(configured)).isSymbolicLink())
    throw new Error('Media directory must not be a symbolic link.');
  const root = await realpath(configured);
  for (const sub of ['staging', 'files']) {
    await mkdir(join(root, sub), { recursive: true, mode: 0o700 });
    if (
      !(await lstat(join(root, sub))).isDirectory() ||
      (await realpath(join(root, sub))) !== join(root, sub)
    )
      throw new Error('Unsafe media directory.');
  }
  return { staged: join(root, 'staging', id), final: join(root, 'files', id), root };
}
async function bytesAt(path: string): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_SIZE) throw new Error('Invalid media file.');
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}
export async function validatePhoto(
  bytes: Buffer,
  media: Pick<Media, 'size' | 'sha256' | 'content_type'>,
  decode = true,
) {
  if (
    bytes.length !== media.size ||
    bytes.length > MAX_SIZE ||
    createHash('sha256').update(bytes).digest('hex') !== media.sha256
  )
    throw new ApplicationError(
      422,
      'PHOTO_CHECKSUM',
      'Photo size or checksum did not match. Retry the original photo.',
    );
  const magic = bytes.subarray(0, 8);
  const type = magic.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? 'image/png'
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      ? 'image/jpeg'
      : null;
  if (type !== media.content_type)
    throw new ApplicationError(422, 'PHOTO_TYPE', 'Only valid JPEG and PNG photos are accepted.');
  if (!decode) return;
  try {
    const image = sharp(bytes, { limitInputPixels: 16_000_000, failOn: 'warning' });
    const metadata = await image.metadata();
    if (metadata.pages && metadata.pages > 1) throw new Error('Animated images are not supported.');
    await image.raw().toBuffer();
  } catch {
    throw new ApplicationError(
      422,
      'PHOTO_TYPE',
      'This photo could not be decoded. Export it as JPEG or PNG.',
    );
  }
}
async function row(client: Pool | PoolClient, actor: OwnerPrincipal, id: string): Promise<Media> {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))
    throw new ApplicationError(400, 'INVALID_ID', 'Invalid photo ID.');
  const media = (
    await client.query('SELECT * FROM food_media WHERE id=$1 AND owner_id=$2', [id, actor.userId])
  ).rows[0] as Media | undefined;
  if (!media || media.detached_at) throw new ApplicationError(404, 'NOT_FOUND', 'Photo not found.');
  const entry = await foodRecord(client, actor, media.entry_id);
  if (entry.deletedAt) throw new ApplicationError(404, 'NOT_FOUND', 'Photo not found.');
  return media;
}
export async function allocatePhoto(
  pool: Pool,
  actor: OwnerPrincipal,
  entryId: string,
  input: FoodUpload,
  authorize: (client: PoolClient) => Promise<void>,
) {
  const command = { ...input, type: 'food.photo.stage', entryId };
  const response = await featureOperation(pool, actor, command, authorize, async (client) => {
    const entry = await foodRecord(client, actor, entryId);
    assertFoodRevision(entry, input.expectedRevision);
    if (entry.photoIds.length >= 12)
      throw new ApplicationError(422, 'PHOTO_LIMIT', 'An entry can contain up to twelve photos.');
    const active = await client.query(
      "SELECT id FROM food_media WHERE entry_id=$1 AND detached_at IS NULL AND status<>'finalized'",
      [entryId],
    );
    if (active.rowCount! >= 12)
      throw new ApplicationError(
        429,
        'UPLOAD_LIMIT',
        'Finish existing uploads before adding more photos.',
      );
    const id = randomUUID();
    await client.query(
      "INSERT INTO food_media(id,entry_id,owner_id,status,size,sha256,content_type) VALUES($1,$2,$3,'pending',$4,$5,$6)",
      [id, entryId, actor.userId, input.size, input.sha256, input.contentType],
    );
    return { result: { upload: { id, status: 'pending' as const } }, records: [] };
  });
  return { upload: response.upload };
}
export async function receivePhoto(
  pool: Pool,
  actor: OwnerPrincipal,
  id: string,
  bytes: Buffer,
  directory: string,
  authorize: (client: PoolClient) => Promise<void>,
) {
  return transaction(pool, async (client) => {
    await client.query('SELECT id FROM installation WHERE owner_id=$1 FOR UPDATE', [actor.userId]);
    await requireOwner(client, actor.userId);
    await authorize(client);
    await requireOwner(client, actor.userId, actor.expectedEpoch);
    const media = await row(client, actor, id);
    await validatePhoto(bytes, media);
    const p = await paths(directory, id);
    if (media.status === 'finalized') {
      await validatePhoto(await bytesAt(p.final), media);
      return { upload: { id, status: 'finalized' } };
    }
    try {
      const file = await open(
        p.staged,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await file.writeFile(bytes);
        await file.sync();
      } finally {
        await file.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        await validatePhoto(await bytesAt(p.staged), media);
      } catch {
        await unlink(p.staged);
        throw new ApplicationError(
          409,
          'UPLOAD_INTERRUPTED',
          'The interrupted upload was cleared. Retry this same upload.',
        );
      }
    }
    await client.query("UPDATE food_media SET status='received' WHERE id=$1", [id]);
    return { upload: { id, status: 'received' } };
  });
}
async function finalizeBytes(directory: string, media: Media) {
  const p = await paths(directory, media.id);
  try {
    await validatePhoto(await bytesAt(p.final), media);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await validatePhoto(await bytesAt(p.staged), media);
    try {
      await link(p.staged, p.final);
    } catch (linkError) {
      if ((linkError as NodeJS.ErrnoException).code !== 'EEXIST') throw linkError;
      await validatePhoto(await bytesAt(p.final), media);
    }
  }
  const dir = await open(join(p.root, 'files'), constants.O_RDONLY);
  try {
    await dir.sync();
  } finally {
    await dir.close();
  }
  await unlink(p.staged).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}
export async function finalizePhoto(
  pool: Pool,
  actor: OwnerPrincipal,
  id: string,
  input: { operationId: string; expectedRevision: number },
  directory: string,
  authorize: (client: PoolClient) => Promise<void>,
) {
  const command = { ...input, type: 'food.photo.finalize', photoId: id };
  return featureOperation(pool, actor, command, authorize, async (client) => {
    const media = await row(client, actor, id);
    const entry = await foodRecord(client, actor, media.entry_id);
    assertFoodRevision(entry, input.expectedRevision);
    if (media.status === 'finalized')
      throw new ApplicationError(
        409,
        'ALREADY_FINALIZED',
        'This upload was already attached. Reload the entry.',
      );
    if (entry.photoIds.length >= 12)
      throw new ApplicationError(422, 'PHOTO_LIMIT', 'An entry can contain up to twelve photos.');
    try {
      await finalizeBytes(directory, media);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new ApplicationError(409, 'UPLOAD_PENDING', 'Upload the photo before finalizing.');
      throw error;
    }
    await client.query("UPDATE food_media SET status='finalized' WHERE id=$1", [id]);
    return saveFood(
      client,
      actor,
      {
        ...entry,
        revision: entry.revision + 1,
        photoIds: [...entry.photoIds, id],
        updatedAt: new Date().toISOString(),
      },
      input.operationId,
      'food.photo.finalize',
    );
  });
}
export async function readPhoto(pool: Pool, actor: OwnerPrincipal, id: string, directory: string) {
  await requireOwner(pool, actor.userId);
  const media = await row(pool, actor, id);
  const entry = await foodRecord(pool, actor, media.entry_id);
  if (media.status !== 'finalized' || !entry.photoIds.includes(id))
    throw new ApplicationError(404, 'NOT_FOUND', 'Photo not found.');
  const bytes = await bytesAt((await paths(directory, id)).final);
  await validatePhoto(bytes, media, false);
  return { bytes, contentType: media.content_type };
}
// Reconcile only database-known uploads. Unreferenced bytes are retained for coordinated backup and later reference-checked cleanup.
export async function reconcileMedia(pool: Pool, directory: string) {
  await transaction(pool, async (client) => {
    const owners = await client.query('SELECT id FROM installation ORDER BY id FOR UPDATE');
    void owners;
    const media = await client.query<Media>(
      "SELECT * FROM food_media WHERE status<>'finalized' AND detached_at IS NULL ORDER BY created_at",
    );
    for (const item of media.rows) {
      const p = await paths(directory, item.id);
      let valid = false;
      for (const path of [p.final, p.staged]) {
        try {
          await validatePhoto(await bytesAt(path), item);
          valid = true;
          break;
        } catch (error) {
          if (
            (error as NodeJS.ErrnoException).code !== 'ENOENT' &&
            !(error instanceof ApplicationError)
          )
            throw error;
        }
      }
      await client.query('UPDATE food_media SET status=$2 WHERE id=$1', [
        item.id,
        valid ? 'received' : 'pending',
      ]);
    }
  });
}
