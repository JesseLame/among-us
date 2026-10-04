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

// Phones cannot reach "localhost". When this page was opened that way, link to the
// same page on the computer's network address (organiser only: it uses the print endpoint).
export function LanHint({ message, path }: { message: string; path: string }) {
  const [addresses, setAddresses] = useState<string[]>([]);
  useEffect(() => {
    if (!onLocalhost()) return;
    fetch('/api/stations/print').then(response => response.ok ? response.json() : null)
      .then(result => setAddresses(result?.lanAddresses ?? [])).catch(() => undefined);
  }, []);
  if (!onLocalhost()) return null;
  return <div className={ui.sessionNotice} role="note">
    <p>{message}</p>
    {addresses.length > 0 && <ul className={styles.lanLinks}>{addresses.map(address => {
      const url = `${location.protocol}//${address}${location.port ? `:${location.port}` : ''}${path}`;
      return <li key={address}><a href={url}>{url}</a></li>;
    })}</ul>}
  </div>;
}
