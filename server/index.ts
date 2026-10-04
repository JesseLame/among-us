import { resolve } from 'node:path';
import { createApp } from './app.js';
import { lanAddresses } from './network.js';
import { localCertificate } from './tls.js';

// `--https` (npm run play:https) serves over HTTPS with a certificate from a local authority,
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
  if (tls?.caCreated) console.log('Created a new local certificate authority in data/tls/ca.pem. Trust it once on each device to skip the "not private" warning (see README).');
  else if (tls) console.log('Using the local certificate authority in data/tls/ca.pem. Devices that trust it open the game without a warning.');
  if (tls) console.log(`Install it on a phone from ${protocol}://${lanAddresses()[0] ?? 'localhost'}:${port}/ca.crt`);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void server.close().then(() => process.exit(0)); });
}
