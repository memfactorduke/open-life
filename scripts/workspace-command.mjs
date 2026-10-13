import { spawn } from 'node:child_process';
const command = process.argv[2];
if (!['migrate', 'bootstrap', 'recover'].includes(command))
  throw new Error('Unsupported administrator command.');
const child = spawn('npm', ['run', command, '--workspace', '@mems-life/server'], {
  stdio: 'inherit',
  env: process.env,
});
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
