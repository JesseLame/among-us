import { resolve } from 'node:path';
import { createApp } from './app.js';

const server = createApp({
  databasePath: process.env.DATABASE_PATH || './data/game.sqlite',
  production: process.env.NODE_ENV === 'production',
  clientPath: resolve('dist/client'),
});
const port = Number(process.env.PORT || 3001);
server.http.listen(port, '0.0.0.0', () => console.log(`Game server listening on http://localhost:${port}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void server.close().then(() => process.exit(0)); });
}
