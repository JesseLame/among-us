import { useEffect, useRef, useState } from 'react';
import { Button } from 'react-aria-components';
import jsQR from 'jsqr';
import type { Station } from '../../../shared/protocol';
import { translations, type Copy } from '../../i18n';
import styles from './tasks.module.css';
import ui from '../../styles/ui.module.css';

type Props = { stations: Station[]; t: Copy; onScanned: (stationId: string) => void; onClose: () => void };
type Problem = 'notFound' | 'wrongCode' | 'denied' | null;

// Browsers only allow live camera video on HTTPS (or localhost). Over plain HTTP on the
// home network, the phone's camera takes a photo instead, which is decoded here.
const liveCamera = () => window.isSecureContext && Boolean(navigator.mediaDevices?.getUserMedia);

function read(source: CanvasImageSource, width: number, height: number, canvas: HTMLCanvasElement) {
  const scale = Math.min(1, 1024 / Math.max(width, height));
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(image.data, image.width, image.height)?.data ?? null;
}

export default function StationScanner({ stations, t, onScanned, onClose }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [live, setLive] = useState(liveCamera);
  const [problem, setProblem] = useState<Problem>(null);

  // Accept only this game's station codes, e.g. http://192.168.1.19:3001/?station=<id>.
  // The host part is ignored, so codes keep working when opened on another address.
  function stationIn(text: string) {
    try {
      const stationId = new URL(text, location.origin).searchParams.get('station');
      return stationId && stations.some(station => station.id === stationId) ? stationId : null;
    } catch { return null; }
  }
  function accept(text: string | null) {
    if (!text) { setProblem('notFound'); return; }
    const stationId = stationIn(text);
    if (stationId) onScanned(stationId);
    else setProblem('wrongCode');
  }

  useEffect(() => {
    if (!live) return;
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;
    const stop = () => { stopped = true; cancelAnimationFrame(frame); stream?.getTracks().forEach(track => track.stop()); };
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(media => {
      if (stopped) { media.getTracks().forEach(track => track.stop()); return; }
      stream = media;
      const element = video.current!;
      element.srcObject = media;
      void element.play();
      let last = 0;
      const scan = (time: number) => {
        if (stopped) return;
        // Decoding every frame is wasteful on phones; a few times per second is plenty.
        if (time - last > 200 && element.readyState >= 2) {
          last = time;
          const text = read(element, element.videoWidth, element.videoHeight, canvas.current!);
          const stationId = text && stationIn(text);
          if (stationId) { stop(); onScanned(stationId); return; }
          if (text) setProblem('wrongCode');
        }
        frame = requestAnimationFrame(scan);
      };
      frame = requestAnimationFrame(scan);
    }).catch(() => { if (!stopped) { setProblem('denied'); setLive(false); } });
    return stop;
  }, [live]);

  async function photo(file: File | undefined) {
    if (!file) return;
    setProblem(null);
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      accept(read(image, image.naturalWidth, image.naturalHeight, canvas.current!));
    } catch { setProblem('notFound'); }
    finally { URL.revokeObjectURL(url); }
  }

  const message = problem === 'notFound' ? t.scannerNotFound : problem === 'wrongCode' ? t.scannerWrongCode : problem === 'denied' ? t.scannerDenied : null;
  return <div className={styles.scanner}>
    {live
      ? <>
        <p>{t.scannerLive}</p>
        <div className={styles.viewfinder}><video ref={video} muted playsInline aria-label={t.scannerLive}/><span aria-hidden="true"/></div>
      </>
      : <p>{t.scannerPhotoHelp}</p>}
    <canvas ref={canvas} hidden/>
    {message && <p className={ui.error} role="alert">{message}</p>}
    <label className={`${live ? ui.secondary : ui.primary} ${styles.photoButton}`}>
      <input className={styles.fileInput} type="file" accept="image/*" capture="environment" onChange={event => { void photo(event.target.files?.[0]); event.target.value = ''; }}/>
      {t.scannerPhoto}<span aria-hidden="true">◉</span>
    </label>
    <Button className={ui.secondary} onPress={onClose}>{t.cancel}</Button>
  </div>;
}
