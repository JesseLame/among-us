import { resolve } from 'node:path';
import { createApp } from './app.js';
import { lanAddresses } from './network.js';
import { localCertificate } from './tls.js';

// `--https` (npm run play:https) serves over HTTPS with a self-signed certificate,
// so phones on the home network may use the camera for live QR scanning.
const secure = process.argv.includes('--https');
const tls = secure ? await localCertificate(resolve('data/tls')) : undefined;
const server = createApp({
  databasePath: process.env.DATABASE_PATH || './data/game.sqlite',
  production: process.env.NODE_ENV === 'production',
  clientPath: resolve('dist/client'),
  tls,
});
const port = Number(process.env.PORT || 3001);
const protocol = secure ? 'https' : 'http';
server.http.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code !== 'EADDRINUSE') throw error;
  console.error(`Port ${port} is already in use, probably by another copy of the game (for example \`npm run dev\`). Stop it first, or start on another port: PORT=3005 npm start`);
  process.exit(1);
});
server.http.listen(port, '0.0.0.0', () => {
  console.log(`Game server listening on ${protocol}://localhost:${port}`);
  // Phones on the same Wi-Fi use one of these addresses (also when hosting from a laptop).
  for (const address of lanAddresses()) console.log(`On your network: ${protocol}://${address}:${port}`);
  if (tls?.created) console.log('Created a new certificate in data/tls. Each phone shows a one-time "not private" warning: choose to continue to the site.');
  else if (tls) console.log('Using the certificate in data/tls. Phones that accepted it before will not be asked again.');
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void server.close().then(() => process.exit(0)); });
}
