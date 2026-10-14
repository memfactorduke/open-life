import { createHash } from 'node:crypto';
import { taskFileLimit } from '@mems-life/domain';
import { ApplicationError } from './errors.js';

/** Inspect the already-opened file, bounding every read against its recorded size. */
export async function inspectFileBytes(
  stream: AsyncIterable<Buffer>,
  size: number,
  contentType: string,
) {
  const mismatch = () =>
    new ApplicationError(
      422,
      'FILE_CHECKSUM',
      'File size or checksum does not match. Retry the original file.',
    );
  if (!Number.isSafeInteger(size) || size <= 0 || size > taskFileLimit) throw mismatch();
  const imageBytes = contentType.startsWith('image/') ? Buffer.alloc(size) : null;
  const hash = createHash('sha256');
  let received = 0;
  let prefix = Buffer.alloc(0),
    tail = Buffer.alloc(0);
  const decoder = contentType.startsWith('text/')
    ? new TextDecoder('utf-8', { fatal: true })
    : null;
  for await (const chunk of stream) {
    if (chunk.length > size - received) throw mismatch();
    imageBytes && chunk.copy(imageBytes, received);
    received += chunk.length;
    hash.update(chunk);
    if (prefix.length < 32) prefix = Buffer.concat([prefix, chunk.subarray(0, 32 - prefix.length)]);
    tail = Buffer.concat([tail, chunk.subarray(-1024)]).subarray(-1024);
    if (decoder) {
      try {
        if (decoder.decode(chunk, { stream: true }).includes('\0')) throw new Error('Binary text');
      } catch {
        throw new ApplicationError(422, 'FILE_TYPE', 'Text files must contain valid UTF-8 text.');
      }
    }
  }
  if (received !== size) throw mismatch();
  if (decoder) {
    try {
      decoder.decode();
    } catch {
      throw new ApplicationError(422, 'FILE_TYPE', 'Text files must contain valid UTF-8 text.');
    }
  }
  return { prefix, tail, imageBytes, sha256: hash.digest('hex') };
}
