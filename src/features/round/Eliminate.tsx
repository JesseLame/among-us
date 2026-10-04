import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import type { Eliminate, ErrorCode, RoleInfo } from '../../../shared/protocol';
import { codeFor, commandId, request } from '../../lib/api';
import { errorMessages, translations, type Language } from '../../i18n';
import styles from './round.module.css';
import ui from '../../styles/ui.module.css';

type Elimination = NonNullable<RoleInfo['elimination']>;
type Props = { roundId: string; elimination: Elimination; language: Language; connected: boolean; onInfo: (info: RoleInfo) => void };

const clock = (ms: number) => {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

// Shown only inside the Impostor's revealed role card. The timer counts active play time;
// the server re-checks it, so a local countdown only needs to be approximately right.
export default function EliminatePanel({ roundId, elimination, language, connected, onInfo }: Props) {
  const t = translations[language];
  const [received, setReceived] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [target, setTarget] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  // Keep the command ID after an ambiguous network failure so a retry applies once.
  const pending = useRef<Eliminate | null>(null);
  useEffect(() => { setReceived(Date.now()); setNow(Date.now()); }, [elimination]);
  const remaining = elimination.running ? Math.max(0, elimination.readyInMs - (now - received)) : elimination.readyInMs;
  useEffect(() => {
    if (!elimination.running || remaining <= 0) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [elimination, remaining > 0]);

  async function confirm() {
    if (!target || busy || !connected) return;
    setBusy(true); setError(null);
    const input: Eliminate = pending.current?.targetId === target.id ? pending.current : { commandId: commandId(), roundId, targetId: target.id };
    pending.current = input;
    try {
      const result = await request<{ ended: boolean; role?: RoleInfo }>('/api/eliminate', input);
      pending.current = null;
      setTarget(null);
      if (result.role) onInfo(result.role);
    } catch (failure) {
      const code = codeFor(failure);
      setError(code);
      if (code !== 'CONNECTION_ERROR') pending.current = null;
    } finally { setBusy(false); }
  }

  const ready = elimination.running && remaining <= 0;
  return <section className={styles.eliminate} aria-labelledby="eliminate-title">
    <h3 id="eliminate-title">{t.eliminateTitle}</h3>
    {!elimination.running ? <p className={ui.note}>{t.eliminatePaused}</p>
      : !ready ? <p className={styles.eliminateTimer} role="timer" aria-live="off">{t.eliminateIn} <strong>{clock(remaining)}</strong></p>
      : elimination.targets.length === 0 ? <p className={ui.note}>{t.eliminateNone}</p>
      : <>
        <p className={ui.note}>{t.eliminateHelp}</p>
        <ul className={styles.eliminateTargets}>
          {elimination.targets.map(player => <li key={player.id}>
            <Button className={ui.removeButton} isDisabled={!connected || busy} onPress={() => { setTarget(player); setError(null); }}>{player.name}</Button>
          </li>)}
        </ul>
      </>}
    {error && !target && <p className={ui.error} role="alert">{errorMessages[language][error]}</p>}
    <ModalOverlay className={ui.modalOverlay} isOpen={Boolean(target)} onOpenChange={open => { if (!open && !busy) setTarget(null); }} isDismissable={!busy}>
      <Modal className={ui.modal}>
        <Dialog aria-describedby="eliminate-description">
          <Heading slot="title">{t.eliminateConfirmTitle} {target?.name}?</Heading>
          <p id="eliminate-description">{t.eliminateConfirmText}</p>
          {error && <p className={ui.error} role="alert">{errorMessages[language][error]}</p>}
          <div className={ui.dialogActions}>
            <Button className={ui.secondary} autoFocus isDisabled={busy} onPress={() => setTarget(null)}>{t.notYet}</Button>
            <Button className={ui.dangerButton} isDisabled={busy || !connected} onPress={() => void confirm()}>{busy ? t.working : t.eliminateConfirm}</Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  </section>;
}
