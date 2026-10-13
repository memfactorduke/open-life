import {
  readFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  statSync,
  cpSync,
} from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const notices = [
  'Third-party dependency notices',
  'Original project source is MIT. Dependency terms remain their own.',
  '',
];
for (const location of Object.keys(lock.packages)
  .filter((path) => path.includes('node_modules/'))
  .sort()) {
  if (!existsSync(join(location, 'package.json'))) {
    if (lock.packages[location].optional) continue;
    throw new Error(`Install dependencies before generating notices: ${location}`);
  }
  const pkg = JSON.parse(readFileSync(join(location, 'package.json'), 'utf8'));
  notices.push(
    `${pkg.name}@${pkg.version} (${typeof pkg.license === 'string' ? pkg.license : 'Review package license'})`,
  );
  const files = readdirSync(location).filter(
    (file) =>
      /^(licen[cs]e|copying|notice)(\.|$)/i.test(file) ||
      (pkg.name?.startsWith('@img/sharp-libvips-') && file === 'README.md'),
  );
  if (files.length === 0)
    notices.push('No top-level notice file. Review the package before distribution.');
  for (const file of files) {
    if (statSync(join(location, file)).isFile())
      notices.push(file, readFileSync(join(location, file), 'utf8'));
  }
  notices.push('');
}
mkdirSync('.runtime', { recursive: true });
const native = 'scripts/licenses/sharp-libvips-1.3.4';
const sources = JSON.parse(readFileSync(join(native, 'sources.json')));
const crates = JSON.parse(readFileSync(join(native, 'rust-crates.json')));
const installed = `node_modules/@img/sharp-libvips-${process.platform}-${process.arch}`;
const pkg = JSON.parse(readFileSync(join(installed, 'package.json')));
if (pkg.version !== sources.packageVersion || pkg.license !== 'LGPL-3.0-or-later')
  throw new Error('Native license assets must be reviewed for the installed libvips version.');
const installedVersions = JSON.parse(readFileSync(join(installed, 'versions.json')));
if (JSON.stringify(installedVersions) !== JSON.stringify(sources.versions))
  throw new Error('Native component versions differ from the reviewed source provenance.');
cpSync(native, '.runtime/native-licenses', { recursive: true });
cpSync('scripts/native-license-verify.mjs', '.runtime/native-licenses/verify.mjs');
const files = {};
function inventory(directory, relative = '') {
  for (const name of readdirSync(directory).sort()) {
    const file = join(directory, name);
    const path = join(relative, name);
    if (statSync(file).isDirectory()) inventory(file, path);
    else files[path] = createHash('sha256').update(readFileSync(file)).digest('hex');
  }
}
inventory(native);
files['verify.mjs'] = createHash('sha256')
  .update(readFileSync('scripts/native-license-verify.mjs'))
  .digest('hex');
writeFileSync(
  '.runtime/native-licenses/bundle.json',
  JSON.stringify(
    {
      packageVersion: pkg.version,
      buildCommit: sources.buildCommit,
      versions: JSON.parse(readFileSync(join(installed, 'versions.json'))),
      files,
      sourceArchives: sources.components,
      rustCrates: crates,
    },
    null,
    2,
  ) + '\n',
);
notices.push(
  'Native libvips license texts, build provenance and source provision: native-licenses/README.md',
);
writeFileSync('.runtime/THIRD-PARTY-NOTICES.txt', notices.join('\n'));
console.log(
  'Wrote .runtime/THIRD-PARTY-NOTICES.txt. Review dependencies flagged before distribution.',
);
