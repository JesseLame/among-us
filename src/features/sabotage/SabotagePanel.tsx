import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import type { ErrorCode, Lobby, RoleInfo, Sabotage } from '../../../shared/protocol';
import { codeFor, commandId, request } from '../../lib/api';
import { errorMessages, translations, type Language } from '../../i18n';
import { clock } from './clock';
import styles from './sabotage.module.css';
import ui from '../../styles/ui.module.css';

type Props = {
  roundId: string; sabotage: NonNullable<RoleInfo['sabotage']>; language: Language; connected: boolean;
  onInfo: (info: RoleInfo) => void; onUpdate: (lobby: Lobby) => void;
};

// Shown only inside the Impostor's revealed role card: the one reactor meltdown of the round.
// The timer counts active play time; the server re-checks it.
export default function SabotagePanel({ roundId, sabotage, language, connected, onInfo, onUpdate }: Props) {
  const t = translations[language];
  const [received, setReceived] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  // Keep the command ID after an ambiguous network failure so a retry applies once.
  const pending = useRef<Sabotage | null>(null);
  useEffect(() => { setReceived(Date.now()); setNow(Date.now()); }, [sabotage]);
  const remaining = sabotage.running ? Math.max(0, sabotage.readyInMs - (now - received)) : sabotage.readyInMs;
  useEffect(() => {
    if (!sabotage.running || remaining <= 0) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [sabotage, remaining > 0]);

  async function start() {
    if (busy || !connected) return;
    setBusy(true); setError(null);
    const input: Sabotage = pending.current ?? { commandId: commandId(), roundId };
    pending.current = input;
    try {
      const result = await request<{ lobby: Lobby | null; role: RoleInfo }>('/api/sabotage', input);
      pending.current = null;
      setConfirming(false);
      onInfo(result.role);
      if (result.lobby) onUpdate(result.lobby);
    } catch (failure) {
      const code = codeFor(failure);
      setError(code);
      if (code !== 'CONNECTION_ERROR') pending.current = null;
    } finally { setBusy(false); }
  }

  return <section className={styles.sabotage} aria-labelledby="sabotage-title">
    <h3 id="sabotage-title">{t.sabotageTitle}</h3>
    {sabotage.used ? <p className={ui.note}>{t.sabotageUsed}</p>
      : !sabotage.running ? <p className={ui.note}>{t.sabotagePaused}</p>
      : remaining > 0 ? <p className={styles.timer} role="timer" aria-live="off">{t.sabotageIn} <strong>{clock(remaining)}</strong></p>
      : <>
        <p className={ui.note}>{t.sabotageHelp}</p>
        <Button className={ui.dangerButton} isDisabled={!connected || busy} onPress={() => { setConfirming(true); setError(null); }}>{t.sabotageReactor}</Button>
      </>}
    {error && !confirming && <p className={ui.error} role="alert">{errorMessages[language][error]}</p>}
    <ModalOverlay className={ui.modalOverlay} isOpen={confirming} onOpenChange={open => { if (!open && !busy) setConfirming(false); }} isDismissable={!busy}>
      <Modal className={ui.modal}>
        <Dialog aria-describedby="sabotage-description">
          <Heading slot="title">{t.sabotageConfirmTitle}</Heading>
          <p id="sabotage-description">{t.sabotageConfirmText}</p>
          {error && <p className={ui.error} role="alert">{errorMessages[language][error]}</p>}
          <div className={ui.dialogActions}>
            <Button className={ui.secondary} autoFocus isDisabled={busy} onPress={() => setConfirming(false)}>{t.notYet}</Button>
            <Button className={ui.dangerButton} isDisabled={busy || !connected} onPress={() => void start()}>{busy ? t.working : t.sabotageConfirm}</Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  </section>;
}
