import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import type { ErrorCode, Lobby, RoleInfo, SecurityView, UseSecurity } from '../../../../shared/protocol';
import { codeFor, commandId, request } from '../../../lib/api';
import { errorMessages, translations, type Language } from '../../../i18n';
import { clock } from '../../sabotage/clock';
import styles from './security.module.css';
import ui from '../../../styles/ui.module.css';

type Props = {
  lobby: Lobby; roundId: string; security: NonNullable<RoleInfo['security']>; language: Language; connected: boolean;
  onInfo: (info: RoleInfo) => void;
};
const POLL_MS = 2000;

// Shown only inside Security's revealed role card: the one live view of the round. While it is
// open the phone asks for fresh locations every couple of seconds; the server decides when it closes.
export default function SecurityPanel({ lobby, roundId, security, language, connected, onInfo }: Props) {
  const t = translations[language];
  const [view, setView] = useState<SecurityView | null>(null);
  const [received, setReceived] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  // Keep the command ID after an ambiguous network failure so a retry applies once.
  const pending = useRef<UseSecurity | null>(null);
  const msLeft = view?.msLeft ?? security.msLeft;
  const running = view?.running ?? security.running;
  const remaining = running ? Math.max(0, msLeft - (now - received)) : msLeft;
  const open = remaining > 0;

  const show = (next: SecurityView) => { setView(next); setReceived(Date.now()); setNow(Date.now()); };
  useEffect(() => { setView(null); setReceived(Date.now()); setNow(Date.now()); }, [security]);
  // Refresh while open (and running); also counts the timer down between replies.
  useEffect(() => {
    if (!open || !running || !connected) return;
    const tick = setInterval(() => setNow(Date.now()), 250);
    const poll = setInterval(() => {
      request<SecurityView>(`/api/security?roundId=${roundId}`).then(show).catch(() => undefined);
    }, POLL_MS);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [open, running, connected, roundId]);

  async function start() {
    if (busy || !connected) return;
    setBusy(true); setError(null);
    const input: UseSecurity = pending.current ?? { commandId: commandId(), roundId };
    pending.current = input;
    try {
      const result = await request<{ role: RoleInfo; view: SecurityView }>('/api/security', input);
      pending.current = null;
      setConfirming(false);
      onInfo(result.role);
      show(result.view);
    } catch (failure) {
      const code = codeFor(failure);
      setError(code);
      if (code !== 'CONNECTION_ERROR') pending.current = null;
    } finally { setBusy(false); }
  }

  const nameOf = (id: string) => lobby.players.find(player => player.id === id)?.name ?? '';
  const stationOf = (id: string | null) => id ? lobby.stations.find(station => station.id === id)?.name ?? null : null;
  const meeting = lobby.phase === 'meeting';
  return <section className={styles.security} aria-labelledby="security-title">
    <h3 id="security-title">{t.securityTitle}</h3>
    {open && !meeting ? <>
      {running
        ? <p className={styles.timer} role="timer" aria-live="off">{t.securityCloses} <strong>{clock(remaining)}</strong></p>
        : <p className={ui.note}>{t.securityPaused}</p>}
      {view && view.players.length > 0 && <table className={styles.list}>
        <thead><tr><th scope="col">{t.securityPlayer}</th><th scope="col">{t.securityLastSeen}</th></tr></thead>
        <tbody>{view.players.map(player => {
          const station = stationOf(player.stationId);
          return <tr key={player.id}>
            <th scope="row">{nameOf(player.id)}</th>
            <td>{station ? <>{station}<small>{t.securityAgo.replace('{seconds}', String(player.secondsAgo ?? 0))}</small></> : <span className={styles.unknown}>{t.securityNever}</span>}</td>
          </tr>;
        })}</tbody>
      </table>}
    </> : security.used ? <p className={ui.note}>{t.securityUsed}</p>
      : meeting ? <p className={ui.note}>{t.securityMeeting}</p>
      : !running ? <p className={ui.note}>{t.securityPaused}</p>
      : <>
        <p className={ui.note}>{t.securityHelp.replace('{seconds}', String(lobby.settings.securityTime))}</p>
        <Button className={ui.secondary} isDisabled={!connected || busy} onPress={() => { setConfirming(true); setError(null); }}>{t.securityOpen}</Button>
      </>}
    {error && !confirming && <p className={ui.error} role="alert">{errorMessages[language][error]}</p>}
    <ModalOverlay className={ui.modalOverlay} isOpen={confirming} onOpenChange={value => { if (!value && !busy) setConfirming(false); }} isDismissable={!busy}>
      <Modal className={ui.modal}>
        <Dialog aria-describedby="security-description">
          <Heading slot="title">{t.securityConfirmTitle}</Heading>
          <p id="security-description">{t.securityConfirmText}</p>
          {error && <p className={ui.error} role="alert">{errorMessages[language][error]}</p>}
          <div className={ui.dialogActions}>
            <Button className={ui.secondary} autoFocus isDisabled={busy} onPress={() => setConfirming(false)}>{t.notYet}</Button>
            <Button className={ui.primary} isDisabled={busy || !connected} onPress={() => void start()}>{busy ? t.working : t.securityConfirm}</Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  </section>;
}
