import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
const root = resolve(process.argv[2] ?? '.');
const licenses = join(root, 'native-licenses');
const manifest = JSON.parse(readFileSync(join(licenses, 'bundle.json')));
assert.equal(manifest.packageVersion, '1.3.4');
assert.equal(manifest.buildCommit, 'ebb95f8add54eee8bed840e3fb587e4cbec857d7');
for (const [file, digest] of Object.entries(manifest.files))
  assert.equal(
    createHash('sha256')
      .update(readFileSync(join(licenses, file)))
      .digest('hex'),
    digest,
    file,
  );
const pkgPath = join(
  resolve(process.argv[3] ?? root),
  'node_modules/@img',
  `sharp-libvips-${process.platform}-${process.arch}`,
);
if (existsSync(pkgPath)) {
  const pkg = JSON.parse(readFileSync(join(pkgPath, 'package.json')));
  assert.equal(pkg.version, manifest.packageVersion);
  assert.equal(pkg.license, 'LGPL-3.0-or-later');
  assert.deepEqual(JSON.parse(readFileSync(join(pkgPath, 'versions.json'))), manifest.versions);
  assert.deepEqual(
    manifest.versions,
    JSON.parse(readFileSync(join(licenses, 'sources.json'))).versions,
  );
  const readme = readFileSync(join(pkgPath, 'README.md'), 'utf8');
  assert.equal(readme.split('\n').filter((line) => /^\| [a-z]/.test(line)).length, 29);
  assert.ok(readFileSync(join(root, 'THIRD-PARTY-NOTICES.txt'), 'utf8').includes(readme));
} else throw new Error('Expected installed target-platform libvips package');
assert.equal(manifest.sourceArchives.length, 33);
assert.equal(manifest.rustCrates.length, 357);
assert.ok(manifest.files['LGPL-3.0.txt'] && manifest.files['GPL-3.0.txt']);
assert.ok(manifest.files['components/vips/libvips/foreign/libnsgif/COPYING']);
assert.ok(manifest.files['components/aom/PATENTS']);
for (const item of manifest.sourceArchives.filter((item) => !item.name.startsWith('patch-')))
  assert.ok(item.licenseFiles.length, item.name);
console.log(
  `Native license bundle verified: libvips ${manifest.versions.vips}, ${Object.keys(manifest.files).length} files, ${manifest.sourceArchives.length + manifest.rustCrates.length} source archive references.`,
);
