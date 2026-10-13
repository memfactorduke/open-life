#!/usr/bin/env node
/** Build reviewed release evidence, or independently validate the Git candidate set.
 * Run with Node 24. No staging, deletion, app control or raw credential output.
 */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const out = '.scratch/mems-life-v1/evidence/release-safe';
// These exact receipts were inspected. They describe historical runs, not a frozen
// current-source release. Add a final receipt only after content/privacy review.
const reviewed = [
  'dependency-privacy-audit.json',
  'native-foundation/results.json',
  'native-features/results.json',
  'daily-focus-web/verification.json',
  'productivity-web/verification.json',
  'archive-recovery/verification.json',
  'sessions-service/receipt.json',
  'foundation-service/results.json',
  'integration-next/epoch-integration-proof.json',
  'native-photo-failure/proof.json',
]
  .map((name) => `.scratch/mems-life-v1/evidence/${name}`)
  .concat([
    'evidence/production-web/verification.json',
    '.scratch/mems-life-v1/evidence/zod-alignment/checks.json',
    '.scratch/mems-life-v1/evidence/offline-save-review-fix-receipt.json',
    '.scratch/mems-life-v1/evidence/offline-live/protocol-proof.json',
    '.scratch/mems-life-v1/evidence/native-gym-food/results.json',
  ]);
// Explicit path arguments attest prior human content review; never recurse a folder.
const args = process.argv.slice(2);
const extraReceipts = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--validate') continue;
  if (args[i] !== '--receipt' || !args[i + 1])
    throw new Error('Use --receipt REPO_RELATIVE_JSON or --validate');
  const file = args[++i];
  if (
    path.isAbsolute(file) ||
    file.includes('\\') ||
    file.split('/').includes('..') ||
    !file.endsWith('.json') ||
    file.startsWith(`${out}/`)
  )
    throw new Error('Receipt must be an exact repo-relative JSON source outside release-safe');
  extraReceipts.push(file);
}
// Pixels checked: fictional task/project labels and example.test owner only.
const screenshots = [
  '.scratch/mems-life-v1/evidence/productivity-web/phone-chromium.png',
  '.scratch/mems-life-v1/evidence/productivity-web/desktop-chromium.png',
  '.scratch/mems-life-v1/evidence/native-features/task-restored-relaunch.png',
];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const maxTextBytes = 2 * 1024 * 1024;
const maxFileBytes = 15 * 1024 * 1024;
const maxCandidateBytes = 100 * 1024 * 1024;
const rules = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  [
    'vendor-key',
    /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_]{32,}|gh[pousr]_[A-Za-z0-9]{30,}|AKIA[A-Z0-9]{16})\b/g,
  ],
  ['literal-bearer', /\bBearer\s+[A-Za-z0-9_.~-]{24,}/g],
  [
    'session-cookie',
    /(?:__Secure-)?better-auth\.session_token(?:=|["']?\s*:\s*["'])[^\s;"']{12,}/g,
  ],
  [
    'serialized-session',
    /["']name["']\s*:\s*["'](?:__Secure-)?better-auth\.session_token["'][\s\S]{0,250}?["']value["']\s*:\s*["'][^"']{12,}/g,
  ],
  ['credential-url', /(?:postgres(?:ql)?|https?):\/\/[^\s/:]+:[^\s/@]{8,}@/g],
];
function scan(text, file = '') {
  return rules.flatMap(([rule, expression]) => {
    const count = [...text.matchAll(expression)].filter((match) => {
      if (rule !== 'credential-url') return true;
      // Source interpolation is not a captured credential. Actual substituted
      // URLs in output still fail. One deliberate negative-test fixture allowed.
      if (/\$\{[^}]+\}/.test(match[0])) return false;
      return !(
        file === 'apps/mobile/tests/installation.test.ts' &&
        match[0] === ['https://owner:', 'password@'].join('')
      );
    }).length;
    return count ? [{ rule, count }] : [];
  });
}
const denied =
  /(?:^|\/)(?:\.runtime|\.maestro|\.playwright-artifacts[^/]*|screen-hierarchy|logs|test-results|playwright-report)(?:\/|$)|\.(?:log|zip|trace|network|jsonl|tgz|gz|tar)$/i;
const escape = (s) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
async function build() {
  await mkdir(path.join(root, out, 'receipts'), { recursive: true });
  await mkdir(path.join(root, out, 'screenshots'), { recursive: true });
  const entries = [];
  for (const source of [...new Set([...reviewed, ...extraReceipts, ...screenshots])]) {
    const raw = await readFile(path.join(root, source));
    if (raw.length > maxFileBytes) throw new Error(`Reviewed file exceeds size bound: ${source}`);
    const isImage = source.endsWith('.png');
    let content = raw;
    if (!isImage) {
      const text = raw.toString('utf8');
      if (raw.length > maxTextBytes || scan(text).length)
        throw new Error(`Receipt privacy/size check failed: ${source}; values withheld`);
      // Remove workstation-specific absolute prefix, retaining a local-only path.
      content = Buffer.from(
        `${JSON.stringify(JSON.parse(text.replaceAll(`${root}/`, '')), null, 2)}\n`,
      );
    }
    const rebased = source.startsWith('.scratch/mems-life-v1/evidence/')
      ? source.slice('.scratch/mems-life-v1/evidence/'.length)
      : source;
    const relative = `${isImage ? 'screenshots' : 'receipts'}/${rebased.replaceAll('/', '--')}`;
    await writeFile(path.join(root, out, relative), content);
    entries.push({
      file: relative,
      bytes: content.length,
      sha256: hash(content),
      rawLocalOnly: source,
      rawBytes: raw.length,
      rawSha256: hash(raw),
      review: isImage
        ? 'Fictional pixels visually inspected'
        : 'Explicit reviewed receipt; original evidence links are local-only',
    });
  }
  const manifest = {
    schemaVersion: 1,
    policy:
      'Historical scoped evidence; per-receipt source hashes/limitations govern. Raw paths are local-only references, never public links. No release readiness inferred.',
    entries,
  };
  await writeFile(path.join(root, out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(
    path.join(root, out, 'index.html'),
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reviewed release evidence</title><style>body{font:16px/1.6 system-ui;background:#f4f5f0;color:#24382f;margin:0}main{max-width:1050px;margin:auto;padding:40px 24px}h1{font-size:38px;line-height:1.2}table{width:100%;border-collapse:collapse;background:white}th,td{text-align:left;padding:12px;border-bottom:1px solid #dce3dc;vertical-align:top}code{font-size:12px;overflow-wrap:anywhere}a{color:#286343}img{max-width:100%;max-height:520px;border:1px solid #ccc}section{margin:32px 0}small{color:#56675d}@media(max-width:700px){table{display:block;overflow:auto}}</style><main><h1>Reviewed release evidence</h1><p>${escape(manifest.policy)}</p><p>Raw logs, traces, request results and original HTML indexes remain on the original workstation. They can contain active fixture session cookies. This committed index links only to reviewed copies below. These historical receipts may identify earlier source states; final validation remains a separate gate.</p><nav><a href="#receipts">Receipts</a> · <a href="#screenshots">Screenshots</a> · <a href="manifest.json">Hashes and local provenance</a></nav><section id="receipts"><h2>Scoped receipts</h2><table><tr><th>Receipt</th><th>Bytes</th><th>SHA-256</th></tr>${entries
      .filter((e) => e.file.startsWith('receipts/'))
      .map(
        (e) =>
          `<tr><td><a href="${e.file}">${escape(e.file)}</a></td><td>${e.bytes}</td><td><code>${e.sha256}</code></td></tr>`,
      )
      .join(
        '',
      )}</table></section><section id="screenshots"><h2>Fictional interface records</h2>${entries
      .filter((e) => e.file.startsWith('screenshots/'))
      .map(
        (e) =>
          `<figure><a href="${e.file}"><img src="${e.file}" alt="${escape(e.file)}"></a><figcaption>${escape(e.file)} — historical screenshot; fictional fixture.</figcaption></figure>`,
      )
      .join('')}</section></main></html>\n`,
  );
  console.log(
    JSON.stringify({
      generated: entries.length,
      receiptAndImageBytes: entries.reduce((n, e) => n + e.bytes, 0),
      output: out,
    }),
  );
}
async function validate() {
  // Git itself supplies the independent broad-add candidate; tracked paths are
  // checked too because ignores never protect files already in the index.
  const files = [
    ...new Set(
      execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
        .toString()
        .split('\0')
        .filter(Boolean),
    ),
  ].sort();
  const issues = [];
  let bytes = 0;
  const manifest = JSON.parse(await readFile(path.join(root, out, 'manifest.json'), 'utf8'));
  const safe = new Set([
    `${out}/manifest.json`,
    `${out}/index.html`,
    ...manifest.entries.map((e) => `${out}/${e.file}`),
  ]);
  for (const file of files) {
    const info = await stat(path.join(root, file));
    bytes += info.size;
    if (denied.test(file) || info.size > maxFileBytes)
      issues.push({ file, reason: 'raw-artifact-or-size-bound', bytes: info.size });
    if (
      (file.startsWith('.scratch/mems-life-v1/evidence/') ||
        file.startsWith('.scratch/timezone-proof/') ||
        /^apps\/[^/]+\/evidence\//.test(file)) &&
      !safe.has(file)
    )
      issues.push({ file, reason: 'not-in-reviewed-evidence-manifest' });
    if (!/\.(?:png|jpe?g|gif|ico|woff2?|pdf)$/i.test(file)) {
      if (info.size > maxTextBytes)
        issues.push({ file, reason: 'text-scan-size-bound', bytes: info.size });
      else
        for (const finding of scan(await readFile(path.join(root, file), 'utf8'), file))
          issues.push({ file, ...finding });
    }
  }
  for (const entry of manifest.entries) {
    if (hash(await readFile(path.join(root, out, entry.file))) !== entry.sha256)
      issues.push({ file: entry.file, reason: 'reviewed-copy-hash-mismatch' });
  }
  if (bytes > maxCandidateBytes) issues.push({ reason: 'candidate-total-size-bound', bytes });
  console.log(
    JSON.stringify(
      {
        candidateFiles: files.length,
        candidateBytes: bytes,
        maximumCandidateBytes: maxCandidateBytes,
        issues,
        credentialValues: 'never printed',
        limitations:
          'Targeted secret formats only; screenshots need visual review; fixture false positives require explicit human-readable review, never blanket suppression.',
      },
      null,
      2,
    ),
  );
  if (issues.length) process.exitCode = 1;
}
if (process.argv.includes('--validate')) await validate();
else await build();
