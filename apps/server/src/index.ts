import { createApp } from './app.js';
import { readConfig } from './config.js';

const config = readConfig();
const { app, pool } = await createApp(config);
const stop = async () => {
  await app.close();
  await pool.end();
};
process.once('SIGINT', () => {
  void stop();
});
process.once('SIGTERM', () => {
  void stop();
});
await app.listen({ port: config.PORT, host: config.HOST });
console.log(`Mem's Life service listening on ${config.HOST}:${config.PORT}`);
