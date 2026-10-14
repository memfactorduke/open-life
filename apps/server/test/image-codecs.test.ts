import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import sharp from '../src/image-codecs.js';
import { nativeImageInventory } from '../src/native-image-inventory.js';
import { validatePhoto } from '../src/media.js';

const image = () => sharp({ create: { width: 12, height: 8, channels: 3, background: '#b84221' } });

test('native decoder boundary accepts PNG/JPEG buffers, keeps EXIF rotation and JPEG transforms', async () => {
  const png = await image().png().toBuffer();
  const jpeg = await image().withMetadata({ orientation: 6 }).jpeg().toBuffer();
  for (const [bytes, content_type] of [
    [png, 'image/png'],
    [jpeg, 'image/jpeg'],
  ] as const) {
    await validatePhoto(bytes, {
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      content_type,
    });
    assert.equal(
      (await sharp(bytes).raw().toBuffer({ resolveWithObject: true })).info.channels >= 3,
      true,
    );
  }
  const rotated = await sharp(jpeg).rotate().resize({ width: 4 }).jpeg().toBuffer();
  const metadata = await sharp(rotated).metadata();
  assert.equal(metadata.format, 'jpeg');
  assert.equal(metadata.width, 4);
  assert.equal(metadata.height, 6);
  assert.equal(metadata.orientation, undefined);
  const thumbnail = await sharp(png).resize({ width: 3 }).jpeg().toBuffer();
  assert.equal((await sharp(thumbnail).metadata()).width, 3);
});

test('native decoder itself rejects real HEIF/AVIF, SVG, GIF and WebP buffers', async () => {
  const unsupported = [
    ['HEIF/AVIF', await image().avif().toBuffer()],
    [
      'SVG',
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8"><rect width="12" height="8" fill="red"/></svg>',
      ),
    ],
    ['GIF', await image().gif().toBuffer()],
    ['WebP', await image().webp().toBuffer()],
  ] as const;
  for (const [format, bytes] of unsupported) {
    await assert.rejects(
      sharp(bytes).metadata(),
      /unsupported image format|blocked/,
      `${format} decoder must remain blocked`,
    );
    await assert.rejects(
      sharp(bytes).resize({ width: 3 }).jpeg().toBuffer(),
      /unsupported image format|blocked/,
      `${format} transforms must not bypass the allowlist`,
    );
  }
});

test('filesystem loaders remain blocked while already-opened private-file bytes decode', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'image-codecs-'));
  try {
    const bytes = await image().png().toBuffer();
    const path = join(directory, 'private.png');
    await writeFile(path, bytes);
    await assert.rejects(sharp(path).metadata(), /unsupported image format|blocked/);
    assert.equal((await sharp(bytes).metadata()).format, 'png');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('native inventory records actual linked versions and scoped advisory rationale', () => {
  const inventory = nativeImageInventory();
  assert.deepEqual(inventory.versions, sharp.versions);
  assert.ok(inventory.versions.vips);
  assert.ok(inventory.versions.png);
  assert.equal(
    inventory.assessments.find((a) => a.id === 'GHSA-q7mw-2fmm-5q94')?.justification,
    'vulnerable_code_not_in_execute_path',
  );
});
