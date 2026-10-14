import { spawn } from 'node:child_process';

export function spawnGroup(file, args, options = {}) {
  const graceMs = options.graceMs ?? Number(process.env.SUPERVISE_GRACE_MS ?? 2000);
  const child = spawn(file, args, {
    stdio: options.stdio ?? 'inherit',
    env: options.env ?? process.env,
    detached: process.platform !== 'win32',
  });
  let timer;
  let stoppingPromise;
  const signal = (pid, sig) => {
    try {
      if (process.platform !== 'win32') process.kill(-pid, sig);
      else process.kill(pid, sig);
      return true;
    } catch (error) {
      if (error.code === 'ESRCH') return false;
      throw error;
    }
  };
  const alive = () => Boolean(child.pid) && signal(child.pid, 0);
  const stop = () => {
    if (stoppingPromise) return stoppingPromise;
    stoppingPromise = new Promise((resolve) => {
      const finish = () => {
        if (timer) clearInterval(timer);
        timer = undefined;
        resolve(child.exitCode ?? 0);
      };
      const deadline = Date.now() + graceMs;
      if (child.pid) signal(child.pid, 'SIGTERM');
      timer = setInterval(() => {
        if (!alive()) return finish();
        if (Date.now() >= deadline) signal(child.pid, 'SIGKILL');
      }, 20);
      if (!alive()) finish();
    });
    return stoppingPromise;
  };
  const exited = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
  return { child, stop, exited };
}

export function supervise(commands, options = {}) {
  const groups = commands.map(([file, ...args]) => spawnGroup(file, args, options));
  let stopping = false;
  const stop = (code) => {
    if (stopping) return;
    stopping = true;
    process.exitCode = code;
    for (const group of groups) void group.stop();
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => stop(signal === 'SIGINT' ? 0 : 1));
  }
  for (const group of groups) {
    group.child.on('error', (error) => {
      console.error(error.message);
      stop(1);
    });
    group.child.on('exit', (code) => {
      if (!stopping) stop(code ?? 1);
    });
  }
}
