import { writeFileSync } from 'node:fs';
process.on('SIGTERM', () => {});
writeFileSync(process.argv[2], String(process.pid));
setInterval(() => {}, 1000);
