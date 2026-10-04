import { X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { generate } from 'selfsigned';
import { lanAddresses } from './network.js';

type Meta = { ips: string[]; names: string[]; notAfter: string; ca?: string };

const day = 24 * 60 * 60 * 1000;

// A private certificate authority for this computer, created once in data/tls. Devices that
// trust it (see README) open the HTTPS game without a warning, also after the server
// certificate below is renewed.
async function localAuthority(directory: string) {
  const files = { key: join(directory, 'ca-key.pem'), cert: join(directory, 'ca.pem') };
  if (existsSync(files.key) && existsSync(files.cert)) {
    const cert = readFileSync(files.cert, 'utf8');
    if (new Date(new X509Certificate(cert).validTo).getTime() > Date.now() + 30 * day) {
      return { key: readFileSync(files.key, 'utf8'), cert, created: false };
    }
  }
  const host = hostname().split('.')[0];
  const pems = await generate([{ name: 'commonName', value: `Among Us at home – ${host}` }], {
    algorithm: 'sha256', keySize: 2048, notAfterDate: new Date(Date.now() + 10 * 365 * day),
    extensions: [
      { name: 'basicConstraints', cA: true, critical: true },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    ],
  });
  mkdirSync(directory, { recursive: true });
  writeFileSync(files.key, pems.private, { mode: 0o600 });
  writeFileSync(files.cert, pems.cert);
  return { key: pems.private, cert: pems.cert, created: true };
}

// The HTTPS certificate for playing on the home network, so phone browsers allow live
// camera scanning. It is signed by the local authority and reused while it still covers
// this computer's current addresses.
export async function localCertificate(directory: string) {
  const ca = await localAuthority(directory);
  const caFingerprint = new X509Certificate(ca.cert).fingerprint256;
  const ips = ['127.0.0.1', ...lanAddresses()];
  const host = hostname().split('.')[0];
  const names = ['localhost', host, `${host}.local`];
  const files = { key: join(directory, 'key.pem'), cert: join(directory, 'cert.pem'), meta: join(directory, 'certificate.json') };
  const result = (key: string, cert: string, created: boolean) => ({ key, cert, ca: ca.cert, created, caCreated: ca.created });
  if (existsSync(files.key) && existsSync(files.cert) && existsSync(files.meta)) {
    const meta = JSON.parse(readFileSync(files.meta, 'utf8')) as Meta;
    const covered = ips.every(ip => meta.ips.includes(ip)) && names.every(name => meta.names.includes(name));
    if (covered && meta.ca === caFingerprint && new Date(meta.notAfter).getTime() > Date.now() + 7 * day) {
      return result(readFileSync(files.key, 'utf8'), readFileSync(files.cert, 'utf8'), false);
    }
  }
  // Browsers reject server certificates valid for more than 398 days.
  const notAfter = new Date(Date.now() + 397 * day);
  const pems = await generate([{ name: 'commonName', value: `${host} (Among Us at home)` }], {
    algorithm: 'sha256', keySize: 2048, notAfterDate: notAfter, ca: { key: ca.key, cert: ca.cert },
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [...names.map(value => ({ type: 2 as const, value })), ...ips.map(ip => ({ type: 7 as const, ip }))] },
    ],
  });
  writeFileSync(files.key, pems.private, { mode: 0o600 });
  writeFileSync(files.cert, pems.cert);
  writeFileSync(files.meta, JSON.stringify({ ips, names, notAfter: notAfter.toISOString(), ca: caFingerprint } satisfies Meta, null, 2));
  return result(pems.private, pems.cert, true);
}
