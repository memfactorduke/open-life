import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, lstat, realpath, link, unlink, opendir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Pool, PoolClient } from 'pg';
import sharp from './image-codecs.js';
import { inspectFileBytes } from './file-bytes.js';
import {
  TaskFileAllocateSchema,
  TaskFileMutationSchema,
  taskFileLimit,
  type TaskFileAllocate,
  type TaskFileMutation,
  type TaskFile,
} from '@mems-life/domain';
import { ApplicationError } from './errors.js';
import { transaction } from './database.js';
import { featureOperation, checkRevision } from './feature-migrations.js';
import { requireOwner, type OwnerPrincipal } from './operations.js';
import { saveTask, taskFromRow } from './tasks.js';
type Authorization = (client: PoolClient) => Promise<void>;
type Row = {
  id: string;
  task_id: string;
  owner_id: string;
  name: string;
  status: TaskFile['status'];
  size: number;
  sha256: string;
  content_type: TaskFile['contentType'];
  created_at: Date;
  detached_at: Date | null;
};
const record = (r: Row): TaskFile => ({
  id: r.id,
  taskId: r.task_id,
  name: r.name,
  size: r.size,
  sha256: r.sha256,
  contentType: r.content_type,
  status: r.status,
  createdAt: r.created_at.toISOString(),
  detachedAt: r.detached_at?.toISOString() ?? null,
});
async function task(client: Pool | PoolClient, actor: OwnerPrincipal, id: string) {
  const r = (
    await client.query('SELECT * FROM tasks WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL', [
      id,
      actor.userId,
    ])
  ).rows[0];
  if (!r) throw new ApplicationError(404, 'NOT_FOUND', 'Task not found.');
  return taskFromRow(r);
}
async function row(client: Pool | PoolClient, actor: OwnerPrincipal, id: string, lock = false) {
  const r = (
    await client.query<Row>(
      'SELECT * FROM task_files WHERE id=$1 AND owner_id=$2 AND detached_at IS NULL' +
        (lock ? ' FOR UPDATE' : ''),
      [id, actor.userId],
    )
  ).rows[0];
  if (!r) throw new ApplicationError(404, 'NOT_FOUND', 'File not found.');
  await task(client, actor, r.task_id);
  return r;
}
async function fileParent(client: PoolClient, actor: OwnerPrincipal, id: string) {
  const found = (
    await client.query('SELECT task_id FROM task_files WHERE id=$1 AND owner_id=$2', [
      id,
      actor.userId,
    ])
  ).rows[0];
  if (!found) throw new ApplicationError(404, 'NOT_FOUND', 'File not found.');
  await task(client, actor, found.task_id);
}
async function paths(directory: string, id: string) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))
    throw new ApplicationError(400, 'INVALID_ID', 'Invalid file identity.');
  const configured = resolve(directory);
  await mkdir(configured, { recursive: true, mode: 0o700 });
  if ((await lstat(configured)).isSymbolicLink()) throw new Error('Unsafe media directory.');
  const base = await realpath(configured),
    root = join(base, 'task-files');
  for (const dir of [root, join(root, 'staging'), join(root, 'files')]) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    if (!(await lstat(dir)).isDirectory() || (await realpath(dir)) !== dir)
      throw new Error('Unsafe task-file directory.');
  }
  return {
    root,
    staged: join(root, 'staging', id.toLowerCase()),
    final: join(root, 'files', id.toLowerCase()),
  };
}
async function validate(path: string, r: Row) {
  const f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await f.stat();
    if (!stat.isFile() || stat.size !== r.size || stat.size > taskFileLimit)
      throw new ApplicationError(
        422,
        'FILE_CHECKSUM',
        'File size or checksum does not match. Retry the original file.',
      );
    const { prefix, tail, imageBytes, sha256 } = await inspectFileBytes(
      f.createReadStream({ autoClose: false }),
      r.size,
      r.content_type,
    );
    if (sha256 !== r.sha256)
      throw new ApplicationError(
        422,
        'FILE_CHECKSUM',
        'File size or checksum does not match. Retry the original file.',
      );
    const valid =
      r.content_type === 'image/png'
        ? prefix.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : r.content_type === 'image/jpeg'
          ? prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255
          : r.content_type === 'application/pdf'
            ? prefix.subarray(0, 5).toString() === '%PDF-' && tail.includes(Buffer.from('%%EOF'))
            : r.content_type === 'video/mp4'
              ? prefix.subarray(4, 8).toString() === 'ftyp' && prefix.readUInt32BE(0) >= 16
              : true;
    if (!valid)
      throw new ApplicationError(
        422,
        'FILE_TYPE',
        'File content does not match its declared type.',
      );
    if (r.content_type.startsWith('image/')) {
      try {
        const image = sharp(imageBytes!, {
          limitInputPixels: 16_000_000,
          failOn: 'warning',
        });
        const metadata = await image.metadata();
        if ((metadata.pages ?? 1) > 1) throw new Error('Animated image');
        await image.stats();
      } catch {
        throw new ApplicationError(
          422,
          'FILE_TYPE',
          'This image could not be decoded. Export a valid PNG or JPEG.',
        );
      }
    }
  } finally {
    await f.close();
  }
}
export async function allocateTaskFile(
  pool: Pool,
  actor: OwnerPrincipal,
  taskId: string,
  input: TaskFileAllocate,
  authorize: Authorization,
) {
  const value = TaskFileAllocateSchema.parse(input);
  const command = { ...value, type: 'task.file.allocate', taskId };
  const live = async (client: PoolClient) => {
    await authorize(client);
    await task(client, actor, taskId);
  };
  return featureOperation(pool, actor, command, live, async (client) => {
    const parent = await task(client, actor, taskId);
    checkRevision(parent.revision, value.expectedRevision);
    if (
      (
        await client.query(
          'SELECT 1 FROM task_files WHERE owner_id=$1 AND task_id=$2 AND detached_at IS NULL LIMIT 100',
          [actor.userId, taskId],
        )
      ).rowCount! >= 100
    )
      throw new ApplicationError(429, 'FILE_LIMIT', 'This task has reached its 100-file limit.');
    if ((await client.query('SELECT 1 FROM task_files WHERE id=$1', [value.fileId])).rowCount)
      throw new ApplicationError(409, 'FILE_ID_USED', 'Allocate a new immutable file identity.');
    const r = (
      await client.query<Row>(
        "INSERT INTO task_files(id,task_id,owner_id,name,status,size,sha256,content_type) VALUES($1,$2,$3,$4,'pending',$5,$6,$7) RETURNING *",
        [
          value.fileId,
          taskId,
          actor.userId,
          value.name,
          value.size,
          value.sha256,
          value.contentType,
        ],
      )
    ).rows[0]!;
    return { result: { file: record(r) }, records: [] };
  });
}
let active = 0;
export async function receiveTaskFile(
  pool: Pool,
  actor: OwnerPrincipal,
  id: string,
  stream: AsyncIterable<Uint8Array>,
  directory: string,
  authorize: Authorization,
) {
  if (active >= 2)
    throw new ApplicationError(429, 'UPLOAD_BUSY', 'Two files are transferring. Retry shortly.');
  active++;
  try {
    return await transaction(pool, async (client) => {
      await requireOwner(client, actor.userId);
      await authorize(client);
      await requireOwner(client, actor.userId, actor.expectedEpoch);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [id]);
      const r = await row(client, actor, id, true),
        p = await paths(directory, id);
      const temporary = join(p.root, 'staging', `${id.toLowerCase()}.${randomUUID()}.part`);
      const f = await open(
        temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        let size = 0;
        for await (const chunk of stream) {
          size += chunk.byteLength;
          if (size > r.size || size > taskFileLimit)
            throw new ApplicationError(413, 'FILE_LIMIT', 'File exceeds the allocated size.');
          await f.writeFile(chunk);
        }
        await f.sync();
        await f.close();
        await validate(temporary, r);
        // Auth and parent state can change during a slow upload; validate again before publishing bytes.
        await authorize(client);
        await requireOwner(client, actor.userId, actor.expectedEpoch);
        await row(client, actor, id);
        if (r.status === 'finalized') {
          await validate(p.final, r);
          return { file: record(r) };
        }
        try {
          await link(temporary, p.staged);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          try {
            await validate(p.staged, r);
          } catch {
            await unlink(p.staged);
            await link(temporary, p.staged);
          }
        }
        await client.query("UPDATE task_files SET status='received' WHERE id=$1", [id]);
        return { file: record({ ...r, status: 'received' }) };
      } finally {
        await f.close().catch(() => {});
        await unlink(temporary).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
      }
    });
  } finally {
    active--;
  }
}
async function finalizeBytes(directory: string, r: Row) {
  const p = await paths(directory, r.id);
  try {
    await validate(p.final, r);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await validate(p.staged, r);
    try {
      await link(p.staged, p.final);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await validate(p.final, r);
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
async function changedParent(
  client: PoolClient,
  actor: OwnerPrincipal,
  r: Row,
  operationId: string,
  type: string,
) {
  const parent = await task(client, actor, r.task_id),
    now = new Date().toISOString();
  const updated = {
    ...parent,
    revision: parent.revision + 1,
    updatedAt: now,
    finalReviewSatisfied: false,
  };
  await saveTask(client, actor.userId, updated);
  await client.query(
    'INSERT INTO task_history(task_id,owner_id,actor_id,operation_id,event_type,revision,task,created_at,actor_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [
      updated.id,
      actor.userId,
      actor.actorId ?? actor.userId,
      operationId,
      type,
      updated.revision,
      updated,
      now,
      actor.actorType === 'agent' ? 'agent' : 'human',
    ],
  );
  return {
    result: { file: record(r), task: updated },
    records: [
      {
        recordType: 'task' as const,
        id: updated.id,
        revision: updated.revision,
        value: updated,
        eventType: type,
      },
    ],
  };
}
export async function finalizeTaskFile(
  pool: Pool,
  actor: OwnerPrincipal,
  id: string,
  input: TaskFileMutation,
  directory: string,
  authorize: Authorization,
) {
  const value = TaskFileMutationSchema.parse(input);
  const command = { ...value, type: 'task.file.finalize', fileId: id };
  const live = async (client: PoolClient) => {
    await authorize(client);
    await fileParent(client, actor, id);
  };
  return featureOperation(pool, actor, command, live, async (client) => {
    const r = await row(client, actor, id, true),
      parent = await task(client, actor, r.task_id);
    checkRevision(parent.revision, value.expectedRevision);
    if (r.status === 'finalized')
      throw new ApplicationError(
        409,
        'ALREADY_FINALIZED',
        'This file is already attached. Reload the task.',
      );
    try {
      await finalizeBytes(directory, r);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new ApplicationError(409, 'UPLOAD_PENDING', 'Transfer this file before finalizing.');
      throw error;
    }
    await client.query("UPDATE task_files SET status='finalized' WHERE id=$1", [id]);
    return changedParent(
      client,
      actor,
      { ...r, status: 'finalized' },
      value.operationId,
      'task.file.finalize',
    );
  });
}
export async function detachTaskFile(
  pool: Pool,
  actor: OwnerPrincipal,
  id: string,
  input: TaskFileMutation,
  authorize: Authorization,
) {
  const value = TaskFileMutationSchema.parse(input);
  const command = { ...value, type: 'task.file.detach', fileId: id };
  const live = async (client: PoolClient) => {
    await authorize(client);
    await fileParent(client, actor, id);
  };
  return featureOperation(pool, actor, command, live, async (client) => {
    const r = await row(client, actor, id, true),
      parent = await task(client, actor, r.task_id);
    checkRevision(parent.revision, value.expectedRevision);
    if (
      (
        await client.query(
          `SELECT 1 FROM agent_results WHERE owner_id=$1 AND task_id=$2 AND value->'artifacts' @> $3::jsonb AND (value->>'approvedAt' IS NOT NULL OR value->>'feedback' IS NULL)`,
          [actor.userId, r.task_id, JSON.stringify([{ kind: 'file', fileId: id }])],
        )
      ).rowCount
    )
      throw new ApplicationError(
        409,
        'FILE_REVIEW_REQUIRED',
        'Request revisions for every result referencing this file before detaching it.',
      );
    const detached = new Date();
    await client.query('UPDATE task_files SET detached_at=$2 WHERE id=$1', [id, detached]);
    return changedParent(
      client,
      actor,
      { ...r, detached_at: detached },
      value.operationId,
      'task.file.detach',
    );
  });
}
export async function listTaskFiles(pool: Pool, actor: OwnerPrincipal, taskId: string) {
  await requireOwner(pool, actor.userId);
  await task(pool, actor, taskId);
  return {
    files: (
      await pool.query<Row>(
        'SELECT * FROM task_files WHERE owner_id=$1 AND task_id=$2 AND detached_at IS NULL ORDER BY created_at,id LIMIT 100',
        [actor.userId, taskId],
      )
    ).rows.map(record),
  };
}
export async function readTaskFile(
  pool: Pool,
  actor: OwnerPrincipal,
  id: string,
  directory: string,
) {
  await requireOwner(pool, actor.userId);
  const r = await row(pool, actor, id);
  if (r.status !== 'finalized') throw new ApplicationError(404, 'NOT_FOUND', 'File not found.');
  const p = await paths(directory, id);
  await validate(p.final, r);
  const f = await open(p.final, constants.O_RDONLY | constants.O_NOFOLLOW);
  return {
    file: record(r),
    stream: f.createReadStream({ autoClose: true }),
    contentType: r.content_type,
  };
}
// Only old scratch bytes for a known database identity are cleanup candidates.
// Original/staged/final versions and unknown files remain available to coherent backups.
async function cleanupInterruptedParts(client: PoolClient, directory: string) {
  if (active) return;
  const entries = await opendir(
    (await paths(directory, '00000000-0000-4000-8000-000000000000')).root + '/staging',
  );
  for await (const entry of entries) {
    const match = /^([a-f0-9-]{36})\.[a-f0-9-]{36}\.part$/.exec(entry.name);
    if (!match || !entry.isFile()) continue;
    if (!(await client.query('SELECT 1 FROM task_files WHERE id=$1', [match[1]])).rowCount)
      continue;
    const candidate = join(entries.path, entry.name),
      stat = await lstat(candidate);
    if (stat.isFile() && !stat.isSymbolicLink() && stat.mtimeMs < Date.now() - 24 * 60 * 60 * 1000)
      await unlink(candidate);
  }
}
export async function reconcileTaskFiles(pool: Pool, directory: string) {
  return transaction(pool, async (client) => {
    await client.query('SELECT id FROM installation ORDER BY id FOR UPDATE');
    await cleanupInterruptedParts(client, directory);
    const rows = await client.query<Row>(
      "SELECT * FROM task_files WHERE status<>'finalized' AND detached_at IS NULL ORDER BY created_at",
    );
    for (const r of rows.rows) {
      const p = await paths(directory, r.id);
      let valid = false;
      for (const candidate of [p.final, p.staged]) {
        try {
          await validate(candidate, r);
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
      await client.query('UPDATE task_files SET status=$2 WHERE id=$1', [
        r.id,
        valid ? 'received' : 'pending',
      ]);
    }
  });
}
