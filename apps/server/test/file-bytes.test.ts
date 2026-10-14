import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { inspectFileBytes } from '../src/file-bytes.js';
import { ApplicationError } from '../src/errors.js';

const mismatch = (error: unknown) =>
  error instanceof ApplicationError && error.status === 422 && error.code === 'FILE_CHECKSUM';

test('bounded file inspection rejects growth during reading and incomplete files before decode', async () => {
  let reachedAfterOverrun = false;
  async function* growing() {
    yield Buffer.from('abc');
    yield Buffer.from('def');
    reachedAfterOverrun = true;
    yield Buffer.from('more bytes');
  }
  await assert.rejects(inspectFileBytes(growing(), 5, 'image/png'), mismatch);
  assert.equal(reachedAfterOverrun, false);
  await assert.rejects(
    inspectFileBytes(Readable.from([Buffer.from('abc')]), 5, 'image/png'),
    mismatch,
  );
  await assert.rejects(
    inspectFileBytes(Readable.from([Buffer.from('abcdef')]), 5, 'application/pdf'),
    mismatch,
  );
});

test('bounded image inspection assembles exactly the validated bytes and nonimages remain streaming', async () => {
  const bytes = Buffer.from('fictional complete file bytes');
  for (const contentType of ['image/png', 'application/pdf']) {
    const result = await inspectFileBytes(
      Readable.from([bytes.subarray(0, 3), bytes.subarray(3)]),
      bytes.length,
      contentType,
    );
    assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.deepEqual(result.prefix, bytes);
    assert.deepEqual(result.tail, bytes);
    if (contentType === 'image/png') assert.deepEqual(result.imageBytes, bytes);
    else assert.equal(result.imageBytes, null);
  }
});
