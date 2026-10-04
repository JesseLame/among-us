import { networkInterfaces } from 'node:os';

// The computer's IPv4 addresses on the home network, typical home-Wi-Fi ranges first.
export function lanAddresses() {
  const rank = (ip: string) => ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3;
  return Object.values(networkInterfaces()).flat()
    .filter(address => address && address.family === 'IPv4' && !address.internal).map(address => address!.address)
    .sort((a, b) => rank(a) - rank(b));
}
