import { useEffect, useRef, useState } from 'react';
import { Button } from 'react-aria-components';
import type { ErrorCode, Lobby } from '../../../shared/protocol';
import { codeFor, request } from '../../lib/api';
import { useFlash } from '../../lib/useFlash';
import { errorMessages, translations, type Language } from '../../i18n';
import StationScanner from '../tasks/Scanner';
import shared from '../../App.module.css';
import { clock } from './clock';
import styles from './sabotage.module.css';
import ui from '../../styles/ui.module.css';

type Props = {
  lobby: Lobby; language: Language; connected: boolean; onUpdate: (lobby: Lobby) => void;
  // The station this phone last scanned, and how to scan another (players only).
  here?: string | null; onStationScanned?: (stationId: string) => void; className?: string;
};

// Shown to everyone during a reactor meltdown: the countdown and the repair panel. A living
// player repairs at the station they are at: the scanned one, or any station when tasks open
// without scanning. Nothing here says who set it off.
export default function ReactorCard({ lobby, language, connected, onUpdate, here, onStationScanned, className }: Props) {
  const t = translations[language];
  const reactor = lobby.reactor;
  const [received, setReceived] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [repaired, flashRepaired] = useFlash<true>(5000);
  useEffect(() => { setReceived(Date.now()); setNow(Date.now()); }, [reactor]);
  const elapsed = now - received;
  const left = reactor ? reactor.running ? Math.max(0, reactor.msLeft - elapsed) : reactor.msLeft : 0;
  const panelLeft = reactor?.panel && reactor.running ? Math.max(0, reactor.panel.msLeft - elapsed) : 0;
  useEffect(() => {
    if (!reactor?.running) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [reactor]);
  // A meltdown that ends while the round goes on (and sabotage stays on) was repaired.
  const wasOn = useRef(Boolean(reactor));
  useEffect(() => {
    if (wasOn.current && !reactor && lobby.phase !== 'ended' && lobby.settings.sabotage) flashRepaired(true);
    if (!reactor) setScanning(false);
    wasOn.current = Boolean(reactor);
  }, [reactor, lobby.phase]);

  if (!reactor) return repaired && lobby.phase !== 'ended'
    ? <p className={`${styles.repaired} ${className ?? ''}`} role="status">{t.reactorRepaired}</p> : null;

  const nameOf = (id: string) => lobby.stations.find(station => station.id === id)?.name ?? '';
  const active = lobby.phase === 'active';
  const canRepair = lobby.you.playing && lobby.you.status === 'alive';
  const qrOnly = lobby.settings.stationAccess === 'qr';
  const atStation = here && lobby.stations.some(station => station.id === here) ? here : null;

  async function repair(stationId: string) {
    if (busy || !connected || !lobby.roundId) return;
    setBusy(true); setError(null);
    try {
      const result = await request('/api/reactor/repair', { roundId: lobby.roundId, stationId });
      if (result.lobby) onUpdate(result.lobby);
    } catch (failure) { setError(codeFor(failure)); }
    finally { setBusy(false); }
  }

  const panel = reactor.panel && panelLeft > 0 ? reactor.panel : null;
  return <section className={`${ui.card} ${styles.reactorCard} ${className ?? ''}`} aria-labelledby="reactor-title">
    <p className={shared.eyebrow}>{t.reactorEyebrow}</p>
    <h2 id="reactor-title">{t.reactorTitle}</h2>
    <p className={styles.reactorTimer} role="timer" aria-live="off">{t.reactorLeft} <strong>{clock(left)}</strong></p>
    {!reactor.running && <p className={ui.note} role="status">{t.reactorPausedNote}</p>}
    <p>{t.reactorHelp}</p>
    {panel && <p className={styles.panel} role="status">
      {panel.yours ? t.reactorPanelYours : t.reactorPanelAt} <strong>{nameOf(panel.stationId)}</strong>. {t.reactorPanelNeed} <strong>{clock(panelLeft)}</strong>
    </p>}
    {lobby.you.playing && lobby.you.status === 'ghost' && <p className={ui.note}>{t.reactorGhost}</p>}
    {canRepair && active && (scanning && onStationScanned
      ? <StationScanner stations={lobby.stations} t={t} onClose={() => setScanning(false)}
        onScanned={stationId => { setScanning(false); onStationScanned(stationId); }}/>
      : qrOnly
      ? <div className={styles.repairActions}>
        {atStation ? <Button className={ui.dangerButton} isDisabled={busy || !connected} onPress={() => void repair(atStation)}>
          {t.reactorRepairHere} · {nameOf(atStation)}
        </Button> : <p className={ui.note}>{t.reactorScanFirst}</p>}
        {onStationScanned && <Button className={ui.secondary} isDisabled={busy || !connected} onPress={() => { setScanning(true); setError(null); }}>
          {t.scanStation}<span aria-hidden="true">⌗</span>
        </Button>}
      </div>
      : <ul className={styles.repairStations}>
        {lobby.stations.map(station => <li key={station.id}>
          <Button className={ui.dangerButton} isDisabled={busy || !connected} aria-label={`${t.reactorRepairAt} ${station.name}`}
            onPress={() => void repair(station.id)}>{station.name}</Button>
        </li>)}
      </ul>)}
    {error && <p className={ui.error} role="alert">{errorMessages[language][error]}</p>}
  </section>;
}
