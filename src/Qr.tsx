import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import styles from './App.module.css';
import ui from './styles/ui.module.css';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
export const onLocalhost = () => LOCAL_HOSTS.includes(location.hostname);

export function QrCode({ value, label, className }: { value: string; label: string; className?: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let current = true;
    void QRCode.toString(value, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then(result => { if (current) setSvg(result); });
    return () => { current = false; };
  }, [value]);
  // The SVG markup comes from the QR library, not from user input.
  return <div className={`${styles.qr} ${className ?? ''}`} role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }}/>;
}

// The address phones should use in links and QR codes. Phones cannot reach "localhost",
// so a screen opened that way uses the computer's network address instead.
// undefined while loading; null when this computer has no network address.
// The address needs a session, so pass the room code to fetch it again after joining.
export function usePhoneOrigin(room?: string) {
  const [origin, setOrigin] = useState<string | null | undefined>(() => onLocalhost() ? undefined : location.origin);
  useEffect(() => {
    if (!onLocalhost() || room === undefined) return;
    fetch('/api/network').then(response => response.ok ? response.json() : null)
      .then((result: { lanAddresses?: string[] } | null) => {
        const address = result?.lanAddresses?.[0];
        setOrigin(address ? `${location.protocol}//${address}${location.port ? `:${location.port}` : ''}` : null);
      })
      .catch(() => setOrigin(null));
  }, [room]);
  return origin;
}

// Shown only on localhost: which address the QR codes use, or why phones cannot connect.
export function PhoneAddressNote({ origin, usesAddress, noNetwork }: { origin: string | null | undefined; usesAddress: string; noNetwork: string }) {
  if (!onLocalhost() || origin === undefined) return null;
  return <p className={origin ? ui.note : ui.error} role="note">
    {origin ? <>{usesAddress} <strong className={styles.phoneAddress}>{origin}</strong></> : noNetwork}
  </p>;
}
