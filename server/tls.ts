import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { generate } from 'selfsigned';
import { lanAddresses } from './network.js';

type Meta = { ips: string[]; names: string[]; notAfter: string };

// A self-signed certificate for playing over HTTPS on the home network, so phone
// browsers allow live camera scanning. Phones warn once because no authority signed it.
// It is reused while it still covers this computer's current addresses, so phones are
// not asked again after every restart.
export async function localCertificate(directory: string) {
  const ips = ['127.0.0.1', ...lanAddresses()];
  const host = hostname().split('.')[0];
  const names = ['localhost', host, `${host}.local`];
  const files = { key: join(directory, 'key.pem'), cert: join(directory, 'cert.pem'), meta: join(directory, 'certificate.json') };
  if (existsSync(files.key) && existsSync(files.cert) && existsSync(files.meta)) {
    const meta = JSON.parse(readFileSync(files.meta, 'utf8')) as Meta;
    const covered = ips.every(ip => meta.ips.includes(ip)) && names.every(name => meta.names.includes(name));
    if (covered && new Date(meta.notAfter).getTime() > Date.now() + 7 * 24 * 60 * 60 * 1000) {
      return { key: readFileSync(files.key, 'utf8'), cert: readFileSync(files.cert, 'utf8'), created: false };
    }
  }
  // Browsers reject server certificates valid for more than 398 days.
  const notAfter = new Date(Date.now() + 397 * 24 * 60 * 60 * 1000);
  const pems = await generate([{ name: 'commonName', value: `${host} (Among Us at home)` }], {
    algorithm: 'sha256', keySize: 2048, notAfterDate: notAfter,
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [...names.map(value => ({ type: 2 as const, value })), ...ips.map(ip => ({ type: 7 as const, ip }))] },
    ],
  });
  mkdirSync(directory, { recursive: true });
  writeFileSync(files.key, pems.private, { mode: 0o600 });
  writeFileSync(files.cert, pems.cert);
  writeFileSync(files.meta, JSON.stringify({ ips, names, notAfter: notAfter.toISOString() } satisfies Meta, null, 2));
  return { key: pems.private, cert: pems.cert, created: true };
}
