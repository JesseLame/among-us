import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import styles from '../App.module.css';
import ui from '../styles/ui.module.css';

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
// A usable origin is a string other than 'unavailable'; see usableOrigin().
// undefined while loading; null when this computer has no network address;
// 'unavailable' when the lookup failed (for example a server started before an update).
// The address needs a session, so pass the room code to fetch it again after joining.
export type PhoneOrigin = string | null | undefined | 'unavailable';
export function usePhoneOrigin(room?: string): PhoneOrigin {
  const [origin, setOrigin] = useState<string | null | undefined>(() => onLocalhost() ? undefined : location.origin);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!onLocalhost() || room === undefined) return;
    setFailed(false);
    fetch('/api/network').then(response => { if (!response.ok) throw new Error(String(response.status)); return response.json(); })
      .then((result: { lanAddresses?: string[] }) => {
        const address = result.lanAddresses?.[0];
        setOrigin(address ? `${location.protocol}//${address}${location.port ? `:${location.port}` : ''}` : null);
      })
      .catch(() => { setOrigin(null); setFailed(true); });
  }, [room]);
  return failed ? 'unavailable' as const : origin;
}

// Shown only on localhost: which address the QR codes use, or why phones cannot connect.
export function PhoneAddressNote({ origin, usesAddress, noNetwork, lookupFailed }: { origin: PhoneOrigin; usesAddress: string; noNetwork: string; lookupFailed: string }) {
  if (!onLocalhost() || origin === undefined) return null;
  const known = origin !== null && origin !== 'unavailable';
  return <p className={known ? ui.note : ui.error} role="note">
    {known ? <>{usesAddress} <strong className={styles.phoneAddress}>{origin}</strong></> : origin === 'unavailable' ? lookupFailed : noNetwork}
  </p>;
}

export const usableOrigin = (origin: PhoneOrigin) => origin && origin !== 'unavailable' ? origin : null;
