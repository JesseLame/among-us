import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import type { ErrorCode, Lobby, RoomCommand, SessionEndReason } from '../../../shared/protocol';
import { codeFor, commandId, request } from '../../lib/api';
import { errorMessages, translations, type Language } from '../../i18n';
import shared from '../../App.module.css';
import styles from './round.module.css';
import { QrCode, usableOrigin, usePhoneOrigin } from '../../components/Qr';
import ui from '../../styles/ui.module.css';
import { PreviewNote, usePreview } from '../lobby/Preview';

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
  const [rejoin, setRejoin] = useState<{ name: string; code: string } | null>(null);
  const origin = usableOrigin(usePhoneOrigin(lobby.code)) ?? location.origin;
  const { preview, check, clear } = usePreview(lobby);
  useEffect(() => { setSelection(null); setError(null); clear(); }, [lobby.revision]);
  if (!lobby.you.organiser) return null;
  const duringRound = lobby.phase === 'active' || lobby.phase === 'paused' || lobby.phase === 'meeting';

  function choose(player?: Lobby['players'][number]) {
    const base = { commandId: commandId(), code: lobby.code, expectedRevision: lobby.revision, roundId: lobby.roundId };
    setError(null);
    setSelection(player
      ? { input: { ...base, action: 'remove', playerId: player.id }, name: player.name }
      : { input: { ...base, action: 'destroy' } });
    // During a round, a removal can end it; preview that without saying why.
    if (player && duringRound) void check('/api/room/preview', { action: 'remove', playerId: player.id, code: lobby.code });
    else clear();
  }

  // A one-time code (shown as a QR code) puts a player who lost their session back in their place.
  async function rejoinCode(player: Lobby['players'][number]) {
    if (inFlight.current || !connected) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const result = await request<{ lobby: Lobby | null; rejoin?: string }>('/api/room/commands', { action: 'rejoinCode', playerId: player.id, commandId: commandId(), code: lobby.code, expectedRevision: lobby.revision, roundId: lobby.roundId });
      if (result.rejoin) setRejoin({ name: player.name, code: result.rejoin });
    } catch (failure) { setError(codeFor(failure)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  // Adding a test player needs no confirmation; it is undone with Remove.
  async function addTestPlayer() {
    if (inFlight.current || !connected) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const result = await request('/api/room/commands', { action: 'addTestPlayer', commandId: commandId(), code: lobby.code, expectedRevision: lobby.revision, roundId: lobby.roundId });
      if (result.lobby) onUpdate(result.lobby);
    } catch (failure) { setError(codeFor(failure)); }
    finally { inFlight.current = false; setBusy(false); }
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
  return <details className={styles.roomControls} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>{t.roomManagement}</summary>
    {expanded && <>
    <p className={ui.note}>{t.managePlayersHelp}</p>
    <ul className={shared.managePlayers}>
      {lobby.players.filter(player => !player.removed).map(player => <li key={player.id}>
        <span>{player.name}{player.test && <small> · {t.testBadge}</small>}</span>
        {!player.organiser && !player.test && <Button className={ui.secondary} isDisabled={busy || !connected} aria-label={`${t.rejoin}: ${player.name}`} onPress={() => void rejoinCode(player)}>{t.rejoin}</Button>}
        {player.organiser ? <small>{t.you}</small> : <Button className={ui.removeButton} isDisabled={busy || !connected} aria-label={`${t.removePlayer} ${player.name}`} onPress={() => choose(player)}>{t.removePlayer}</Button>}
      </li>)}
    </ul>
    {lobby.phase === 'lobby' && lobby.players.filter(player => player.playing).length < 8 && <div className={styles.testPlayers}>
      <Button className={ui.secondary} isDisabled={busy || !connected} onPress={() => void addTestPlayer()}>{t.addTestPlayer}<span aria-hidden="true">+</span></Button>
      <p className={ui.note}>{t.testPlayersHelp}</p>
    </div>}
    {error && !selection && <p className={ui.error} role="alert">{errorMessages[language][error]}</p>}
    <Button className={ui.endButton} isDisabled={busy || !connected} onPress={() => choose()}>{t.deleteRoom}</Button>
    <ModalOverlay className={ui.modalOverlay} isOpen={Boolean(rejoin)} onOpenChange={open => { if (!open) setRejoin(null); }} isDismissable>
      <Modal className={ui.modal}>
        <Dialog aria-describedby="rejoin-description">
          <Heading slot="title">{t.rejoinTitle} {rejoin?.name}</Heading>
          <p id="rejoin-description">{t.rejoinText}</p>
          {rejoin && <QrCode className={styles.rejoinQr} value={`${origin}/?rejoin=${rejoin.code}`} label={`${t.rejoinTitle} ${rejoin.name}`}/>}
          <p className={ui.note}>{t.rejoinCodeLabel} <strong className={shared.phoneAddress}>{origin}/?rejoin={rejoin?.code}</strong></p>
          <div className={ui.dialogActions}><Button className={ui.secondary} autoFocus onPress={() => setRejoin(null)}>{t.cancel}</Button></div>
        </Dialog>
      </Modal>
    </ModalOverlay>
    <ModalOverlay className={ui.modalOverlay} isOpen={Boolean(selection)} onOpenChange={open => { if (!open && !busy) setSelection(null); }} isDismissable={!busy} isKeyboardDismissDisabled={busy}>
      <Modal className={ui.modal}>
        <Dialog aria-describedby="room-action-description">
          <Heading slot="title">{destroying ? t.deleteRoomTitle : `${t.removePlayerTitle} ${selection?.name}?`}</Heading>
          <p id="room-action-description">{destroying ? t.deleteRoomDescription : duringRound ? t.removeDuringRound : t.removePlayerDescription}</p>
          {destroying ? <p className={styles.roomCode}>{t.code}: {lobby.code}</p> : <PreviewNote preview={preview} lobby={lobby} language={language}/>}
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
