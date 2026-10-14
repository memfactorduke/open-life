import { supervise } from './supervise.mjs';

const command = process.argv[2];
if (!['migrate', 'bootstrap', 'recover'].includes(command ?? '')) {
  throw new Error('Unsupported administrator command.');
}
supervise([['npm', 'run', command, '--workspace', '@mems-life/server']]);
