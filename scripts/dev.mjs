import { supervise } from './supervise.mjs';

supervise([
  ['npm', 'run', 'dev', '--workspace', '@mems-life/server'],
  ['npm', 'run', 'dev', '--workspace', '@mems-life/web'],
]);
