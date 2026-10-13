import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const expectedNode = readFileSync(new URL('../.node-version', import.meta.url), 'utf8').trim();
const expectedNpm = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url)),
).packageManager.slice(4);
const npm = execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim();
if (process.versions.node !== expectedNode || npm !== expectedNpm) {
  throw new Error(
    `Use Node ${expectedNode} and npm ${expectedNpm}; found ${process.versions.node} and ${npm}.`,
  );
}
console.log(`Node ${process.versions.node}; npm ${npm}`);
