import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const issuesDirectory = path.join(root, '.scratch/mems-life-v1/issues');
const errors = [];
const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--json' && arg !== '--help')) {
  console.error('Usage: node scripts/release-status.mjs [--json | --help]');
  process.exit(2);
}
if (args.includes('--help')) {
  console.log(
    'Read the 29 release tickets, validate dependencies, and report recorded evidence.\nUsage: node scripts/release-status.mjs [--json]\nOpen or unverified work is normal. Malformed tracker data exits with code 1.',
  );
  process.exit(0);
}

const files = (await readdir(issuesDirectory)).filter((file) => /^\d+.*\.md$/.test(file)).sort();
const issues = await Promise.all(
  files.map(async (file) => {
    const source = await readFile(path.join(issuesDirectory, file), 'utf8');
    const heading = source.match(/^# (\d+): (.+)$/m);
    const id = heading ? Number(heading[1]) : Number(file.match(/^\d+/)[0]);
    if (!heading || id !== Number(file.match(/^\d+/)[0]))
      errors.push(`${file}: missing or mismatched ticket heading`);
    const field = (name) => {
      const matches = [...source.matchAll(new RegExp(`^${name}: (.+)$`, 'gm'))];
      if (matches.length !== 1) errors.push(`${file}: expected one ${name} field`);
      return matches[0]?.[1]?.trim() ?? '';
    };
    const status = field('Status');
    if (
      !['needs-triage', 'needs-info', 'ready-for-agent', 'ready-for-human', 'wontfix'].includes(
        status,
      )
    )
      errors.push(`${file}: invalid Status ${status}`);
    const state = field('State');
    if (!['open', 'claimed', 'resolved'].includes(state))
      errors.push(`${file}: invalid State ${state}`);
    const blockers = field('Blocked by');
    const dependencies =
      blockers === 'None' ? [] : blockers.split(',').map((item) => Number(item.trim()));
    if (blockers !== 'None' && !/^\d+(?:,\s*\d+)*$/.test(blockers))
      errors.push(`${file}: malformed blockers`);
    if (new Set(dependencies).size !== dependencies.length)
      errors.push(`${file}: duplicate blockers`);
    const acceptanceSection =
      source.match(/^## Acceptance criteria\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1] ?? '';
    const criteria = [...acceptanceSection.matchAll(/^- \[([ xX])\] (.+)$/gm)].map((match) => ({
      checked: match[1] !== ' ',
      text: match[2],
    }));
    if (!criteria.length) errors.push(`${file}: missing acceptance criteria`);
    const comments = source.match(/^## Comments\s*\n([\s\S]*)$/m)?.[1]?.trim() ?? '';
    const evidence = [...comments.matchAll(/^Evidence:\s*(.+)$/gm)].map((match) => ({
      note: match[1].trim(),
    }));
    for (const match of comments.matchAll(/<!--\s*release-evidence\s+([\s\S]*?)-->/g)) {
      try {
        const record = JSON.parse(match[1]);
        if (
          !record ||
          Array.isArray(record) ||
          typeof record !== 'object' ||
          typeof record.result !== 'string' ||
          !record.result.trim()
        )
          throw new Error('expected an object with a result string');
        evidence.push(record);
      } catch (error) {
        errors.push(`${file}: malformed release-evidence (${error.message})`);
      }
    }
    return {
      id,
      title: heading?.[2] ?? file,
      file: path.relative(root, path.join(issuesDirectory, file)),
      status,
      state,
      dependencies,
      criteria,
      comments,
      evidence,
      evidenceRecorded: evidence.length > 0,
      verifiedComplete:
        state === 'resolved' &&
        criteria.length > 0 &&
        criteria.every((criterion) => criterion.checked) &&
        evidence.length > 0,
    };
  }),
);

const byId = new Map();
for (const issue of issues) {
  if (byId.has(issue.id)) errors.push(`Duplicate ticket ID ${issue.id}`);
  byId.set(issue.id, issue);
  if (issue.id < 1 || issue.id > 29) errors.push(`Unexpected ticket ID ${issue.id}`);
}
for (let id = 1; id <= 29; id++) if (!byId.has(id)) errors.push(`Missing ticket ID ${id}`);
for (const issue of issues)
  for (const id of issue.dependencies)
    if (!byId.has(id)) errors.push(`Ticket ${issue.id}: unknown blocker ${id}`);
const visited = new Set();
const visiting = new Set();
function visit(id, trail = []) {
  if (visiting.has(id)) {
    errors.push(`Dependency cycle: ${[...trail, id].join(' -> ')}`);
    return;
  }
  if (visited.has(id) || !byId.has(id)) return;
  visiting.add(id);
  for (const dependency of byId.get(id).dependencies) visit(dependency, [...trail, id]);
  visiting.delete(id);
  visited.add(id);
}
for (const issue of issues) visit(issue.id);
for (const issue of issues)
  issue.unmetDependencies = issue.dependencies.filter((id) => !byId.get(id)?.verifiedComplete);
const report = {
  valid: errors.length === 0,
  errors,
  totals: {
    tickets: issues.length,
    resolved: issues.filter((issue) => issue.state === 'resolved').length,
    verifiedComplete: issues.filter((issue) => issue.verifiedComplete).length,
    evidenceRecorded: issues.filter((issue) => issue.evidenceRecorded).length,
    criteria: issues.reduce((sum, issue) => sum + issue.criteria.length, 0),
    checkedCriteria: issues.reduce(
      (sum, issue) => sum + issue.criteria.filter((criterion) => criterion.checked).length,
      0,
    ),
  },
  openFrontier: issues
    .filter((issue) => issue.state === 'open' && !issue.unmetDependencies.length)
    .map((issue) => issue.id),
  activeFrontier: issues
    .filter((issue) => issue.state === 'claimed' && !issue.unmetDependencies.length)
    .map((issue) => issue.id),
  issues,
};
if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
else {
  console.log(
    `Tracker ${report.valid ? 'valid' : 'INVALID'} | ${report.totals.tickets} tickets | ${report.totals.verifiedComplete} verified complete | ${report.totals.checkedCriteria}/${report.totals.criteria} criteria checked`,
  );
  console.log(
    `Open frontier: ${report.openFrontier.join(', ') || 'none'} | Active frontier: ${report.activeFrontier.join(', ') || 'none'}`,
  );
  for (const issue of issues)
    console.log(
      `${String(issue.id).padStart(2, '0')} ${issue.state.padEnd(8)} ${issue.criteria.filter((criterion) => criterion.checked).length}/${issue.criteria.length} criteria | evidence ${issue.evidence.length} | blockers ${issue.unmetDependencies.join(',') || 'none'} | ${issue.title}`,
    );
  for (const error of errors) console.error(error);
}
process.exitCode = report.valid ? 0 : 1;
