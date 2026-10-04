import { resolve } from 'node:path';
import { networkInterfaces } from 'node:os';
import { createApp } from './app.js';

const server = createApp({
  databasePath: process.env.DATABASE_PATH || './data/game.sqlite',
  production: process.env.NODE_ENV === 'production',
  clientPath: resolve('dist/client'),
});
const port = Number(process.env.PORT || 3001);
server.http.listen(port, '0.0.0.0', () => {
  console.log(`Game server listening on http://localhost:${port}`);
  // Phones on the same Wi-Fi use one of these addresses (also when hosting from a laptop).
  for (const address of Object.values(networkInterfaces()).flat()) {
    if (address && address.family === 'IPv4' && !address.internal) console.log(`On your network: http://${address.address}:${port}`);
  }
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void server.close().then(() => process.exit(0)); });
}
