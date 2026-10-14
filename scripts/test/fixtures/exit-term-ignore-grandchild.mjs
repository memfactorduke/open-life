import { spawn } from 'node:child_process';
const grandchild = spawn(process.execPath, [process.argv[3], process.argv[2]], {
  stdio: 'ignore',
});
grandchild.unref();
process.on('SIGTERM', () => process.exit(0));
setInterval(() => {}, 1000);
