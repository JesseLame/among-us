import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import type { ErrorCode, Lobby, RoomCommand, SessionEndReason } from '../shared/protocol';
import { codeFor, commandId, request } from './api';
import { errorMessages, translations, type Language } from './i18n';
import styles from './App.module.css';
import ui from './styles/ui.module.css';

type Props = {
  lobby: Lobby; language: Language; connected: boolean;
  onUpdate: (lobby: Lobby) => void; onExit: (reason: SessionEndReason) => void;
};
type Selection = { input: RoomCommand; name?: string };

export default function RoomControls({ lobby, language, connected, onUpdate, onExit }: Props) {
  const t = translations[language];
  const [selection, setSelection] = useState<Selection | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const inFlight = useRef(false);
  useEffect(() => { setSelection(null); setError(null); }, [lobby.revision]);
  if (!lobby.you.organiser) return null;

  function choose(player?: Lobby['players'][number]) {
    const base = { commandId: commandId(), code: lobby.code, expectedRevision: lobby.revision, roundId: lobby.roundId };
    setError(null);
    setSelection(player
      ? { input: { ...base, action: 'remove', playerId: player.id }, name: player.name }
      : { input: { ...base, action: 'destroy' } });
  }

  async function confirm() {
    if (!selection || inFlight.current || !connected) return;
    inFlight.current = true; setBusy(true); setError(null);
    const { input } = selection;
    try {
      const result = await request('/api/room/commands', input);
      if (result.lobby) onUpdate(result.lobby);
      else onExit('destroyed');
      setSelection(null);
    } catch (failure) {
      setError(codeFor(failure));
      try {
        const current = await request('/api/session');
        if (current.lobby) onUpdate(current.lobby);
        else onExit(input.action === 'destroy' ? 'destroyed' : 'unavailable');
      } catch { /* Keep the same command ID for an explicit retry after reconnection. */ }
    } finally { inFlight.current = false; setBusy(false); }
  }

  const destroying = selection?.input.action === 'destroy';
  const duringRound = lobby.phase === 'active' || lobby.phase === 'paused' || lobby.phase === 'meeting';
  return <details className={styles.roomControls} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>{t.roomManagement}</summary>
    {expanded && <>
    <p className={ui.note}>{t.managePlayersHelp}</p>
    <ul className={styles.managePlayers}>
      {lobby.players.filter(player => !player.removed).map(player => <li key={player.id}>
        <span>{player.name}</span>
        {player.organiser ? <small>{t.you}</small> : <Button className={ui.removeButton} isDisabled={busy || !connected} aria-label={`${t.removePlayer} ${player.name}`} onPress={() => choose(player)}>{t.removePlayer}</Button>}
      </li>)}
    </ul>
    <Button className={ui.endButton} isDisabled={busy || !connected} onPress={() => choose()}>{t.deleteRoom}</Button>
    <ModalOverlay className={ui.modalOverlay} isOpen={Boolean(selection)} onOpenChange={open => { if (!open && !busy) setSelection(null); }} isDismissable={!busy} isKeyboardDismissDisabled={busy}>
      <Modal className={ui.modal}>
        <Dialog aria-describedby="room-action-description">
          <Heading slot="title">{destroying ? t.deleteRoomTitle : `${t.removePlayerTitle} ${selection?.name}?`}</Heading>
          <p id="room-action-description">{destroying ? t.deleteRoomDescription : duringRound ? t.removeDuringRound : t.removePlayerDescription}</p>
          {destroying && <p className={styles.roomCode}>{t.code}: {lobby.code}</p>}
          {error && <p className={ui.error} role="alert">{errorMessages[language][error]}</p>}
          {!connected && <p role="status" className={ui.note}>{t.controlsOffline}</p>}
          <div className={ui.dialogActions}>
            <Button autoFocus className={ui.secondary} isDisabled={busy} onPress={() => setSelection(null)}>{t.cancel}</Button>
            <Button className={ui.dangerButton} isDisabled={busy || !connected} onPress={() => void confirm()}>{busy ? t.working : destroying ? t.confirmDeleteRoom : t.confirmRemovePlayer}</Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
    </>}
  </details>;
}
