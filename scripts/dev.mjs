import { spawn } from 'node:child_process';
const children = ['@mems-life/server', '@mems-life/web'].map((workspace) =>
  spawn('npm', ['run', 'dev', '--workspace', workspace], {
    stdio: 'inherit',
    env: process.env,
    detached: process.platform !== 'win32',
  }),
);
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM');
      else child.kill('SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
  process.exitCode = code;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(0));
for (const child of children) {
  child.on('error', (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on('exit', (code) => {
    if (!stopping) stop(code ?? 1);
  });
}
