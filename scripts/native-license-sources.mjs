import { readFileSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
const bundle = resolve('scripts/licenses/sharp-libvips-1.3.4');
const destination = resolve(process.argv[2] ?? '.runtime/native-license-sources');
const sources = JSON.parse(readFileSync(join(bundle, 'sources.json')));
const crates = JSON.parse(readFileSync(join(bundle, 'rust-crates.json')));
mkdirSync(destination, { recursive: true });
for (const item of [...sources.components, ...crates]) {
  if (typeof item.file !== 'string' || item.file.length === 0 || isAbsolute(item.file))
    throw new Error('Unsafe source archive path.');
  const file = resolve(destination, item.file);
  const rel = relative(destination, file);
  if (rel.startsWith('..') || isAbsolute(rel) || item.file.split(/[\\/]/).includes('..'))
    throw new Error('Unsafe source archive path.');
  if (!String(item.url).startsWith('https://')) throw new Error('Source archives must use HTTPS.');
  mkdirSync(resolve(file, '..'), { recursive: true });
  const expected = item.sha256 ?? item.checksum;
  let valid = false;
  try {
    valid = createHash('sha256').update(readFileSync(file)).digest('hex') === expected;
  } catch {}
  if (!valid) {
    execFileSync(
      'curl',
      [
        '--fail',
        '--location',
        '--silent',
        '--show-error',
        '--proto',
        '=https',
        '--retry',
        '2',
        '--max-time',
        '120',
        item.url,
        '-o',
        file,
      ],
      { stdio: 'inherit' },
    );
  }
  if (createHash('sha256').update(readFileSync(file)).digest('hex') !== expected)
    throw new Error(`Source checksum mismatch: ${item.file}`);
}
writeFileSync(
  join(destination, 'SOURCE-PROVISION.json'),
  JSON.stringify(
    {
      packageVersion: sources.packageVersion,
      buildCommit: sources.buildCommit,
      archiveCount: sources.components.length + crates.length,
      sourceManifestSha256: createHash('sha256')
        .update(readFileSync(join(bundle, 'sources.json')))
        .digest('hex'),
      rustManifestSha256: createHash('sha256')
        .update(readFileSync(join(bundle, 'rust-crates.json')))
        .digest('hex'),
      limitation:
        'Upstream post-edit Cargo.lock and original nightly/compiler image digests are not published. Included registry sources cover the original librsvg release lock, including a superset of disabled features; exact original build reproducibility is not established.',
    },
    null,
    2,
  ) + '\n',
);
cpSync(bundle, join(destination, 'scripts/licenses/sharp-libvips-1.3.4'), { recursive: true });
cpSync(
  'scripts/native-license-sources.mjs',
  join(destination, 'scripts/native-license-sources.mjs'),
);
console.log(`Verified source archives: ${destination}`);
