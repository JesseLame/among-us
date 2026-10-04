import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import type { ErrorCode, Lobby, RoundCommand, SessionEndReason } from '../../../shared/protocol';
import { codeFor, commandId, request } from '../../lib/api';
import { errorMessages, translations, type Language } from '../../i18n';
import styles from './round.module.css';
import ui from '../../styles/ui.module.css';
import MeetingControls from '../meeting/MeetingControls';
import Corrections from './Corrections';
import RoomControls from './RoomControls';

type Props = { lobby: Lobby; language: Language; connected: boolean; onUpdate: (lobby: Lobby) => void; onExit: (reason: SessionEndReason) => void };

// Starting, pausing and ending rounds. Players see only a waiting note.
export default function RoundControls({ lobby, language, connected, onUpdate, onExit }: Props) {
  const t = translations[language];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [endWinner, setEndWinner] = useState<'' | 'crew' | 'impostor'>('');
  const inFlight = useRef(false);
  // Retain the original command ID after an ambiguous network failure. A manual
  // retry cannot apply the same command twice, even if its first response was lost.
  const pending = useRef<RoundCommand | null>(null);

  useEffect(() => { setConfirmEnd(false); setError(null); pending.current = null; }, [lobby.revision]);

  async function act(action: RoundCommand['action'], extra: Pick<RoundCommand, 'winner'> = {}) {
    if (inFlight.current || !connected) return;
    inFlight.current = true; setBusy(true); setError(null);
    const input: RoundCommand = pending.current?.action === action ? pending.current : {
      commandId: commandId(), action, expectedRevision: lobby.revision, roundId: lobby.roundId, ...extra,
    };
    pending.current = input;
    try {
      const result = await request('/api/round/commands', input);
      pending.current = null;
      if (result.lobby) onUpdate(result.lobby);
      setConfirmEnd(false);
    } catch (failure) {
      const error = codeFor(failure);
      setError(error);
      if (error !== 'CONNECTION_ERROR') pending.current = null;
      // Fetch current permitted state; never automatically replay a game action.
      try { const latest = await request('/api/session'); if (latest.lobby) onUpdate(latest.lobby); else onExit('unavailable'); } catch { /* Socket reconnect will resynchronise. */ }
    } finally { inFlight.current = false; setBusy(false); }
  }

  // The organiser can always start a meeting, e.g. after someone shouts "Body found!".
  async function callMeeting() {
    if (inFlight.current || !connected || !lobby.roundId) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const result = await request('/api/meetings', { commandId: commandId(), roundId: lobby.roundId, kind: 'organiser' });
      if (result.lobby) onUpdate(result.lobby);
    } catch (failure) { setError(codeFor(failure)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  if (!lobby.you.organiser) return <p className={ui.note}>{lobby.phase === 'ended' ? t.waitForNextRound : lobby.phase === 'lobby' ? t.waitForStart : t.organiserHandlesRound}</p>;
  const disabled = busy || !connected;
  const ControlsHeading = lobby.phase === 'lobby' ? 'h3' : 'h2';
  return <section className={styles.roundControls} aria-label={t.organiserControls}>
    <ControlsHeading>{t.organiserControls}</ControlsHeading>
    {lobby.phase === 'lobby' && <>
      <p className={ui.note}>{lobby.players.filter(player => player.playing).length < 6 ? t.smallGroupTest : t.readyToStart}</p>
      <Button className={ui.primary} isDisabled={disabled} onPress={() => void act('start')}>{busy ? t.working : t.startRound}<span aria-hidden="true">→</span></Button>
    </>}
    {lobby.phase === 'active' && <Button className={ui.primary} isDisabled={disabled} onPress={() => void act('pause')}>{busy ? t.working : t.pauseRound}<span aria-hidden="true">Ⅱ</span></Button>}
    {lobby.phase === 'active' && <Button className={ui.secondary} isDisabled={disabled} onPress={() => void callMeeting()}>{t.callMeeting}<span aria-hidden="true">◎</span></Button>}
    {lobby.phase === 'meeting' && lobby.meeting && <MeetingControls lobby={lobby} language={language} connected={connected} onUpdate={onUpdate} ending={busy} onEndMeeting={() => void act('endMeeting')}/>}
    {lobby.phase === 'paused' && lobby.pauseReason === 'victory' && lobby.proposedResult && <section className={styles.proposal} aria-labelledby="proposal-title">
      <h3 id="proposal-title">{t.proposedTitle}: {lobby.proposedResult.winner === 'crew' ? t.crewWins : t.impostorWins}</h3>
      <p>{lobby.proposedResult.winner === 'impostor' ? lobby.proposedResult.reason === 'reactor' ? t.proposedImpostorReactor : t.proposedImpostor : lobby.proposedResult.reason === 'tasks' ? t.proposedCrewTasks : t.proposedCrewEjected}</p>
      <p className={ui.note}>{t.proposedHelp}</p>
      <Button className={ui.primary} isDisabled={disabled} onPress={() => void act('confirmResult')}>{busy ? t.working : t.confirmResult}<span aria-hidden="true">→</span></Button>
      <Button className={ui.secondary} isDisabled={disabled} onPress={() => void act('rejectResult')}>{t.rejectResult}</Button>
    </section>}
    {lobby.phase === 'paused' && lobby.pauseReason !== 'victory' && <Button className={ui.primary} isDisabled={disabled} onPress={() => void act('resume')}>{busy ? t.working : t.resumeRound}<span aria-hidden="true">→</span></Button>}
    {lobby.phase === 'ended' && <Button className={ui.primary} isDisabled={disabled} onPress={() => void act('reset')}>{busy ? t.working : t.prepareRound}<span aria-hidden="true">→</span></Button>}
    {(lobby.phase === 'active' || lobby.phase === 'paused' || lobby.phase === 'meeting') && <Button className={ui.endButton} isDisabled={disabled} onPress={() => setConfirmEnd(true)}>{t.endRound}</Button>}
    {!connected && <p className={ui.note} role="status">{t.controlsOffline}</p>}
    {error && !confirmEnd && <p className={ui.error} role="alert">{errorMessages[language][error]}</p>}
    <ModalOverlay className={ui.modalOverlay} isOpen={confirmEnd} onOpenChange={setConfirmEnd} isDismissable={!busy} isKeyboardDismissDisabled={busy}>
      <Modal className={ui.modal}>
        <Dialog aria-describedby="end-description">
          <Heading slot="title">{t.endTitle}</Heading>
          <p id="end-description">{t.endDescription}</p>
          <fieldset className={ui.choices}>
            <legend>{t.endResult}</legend>
            {([['', t.noWinner], ['crew', t.crewWins], ['impostor', t.impostorWins]] as const).map(([value, label]) => <label key={value || 'none'}>
              <input type="radio" name="end-winner" value={value} checked={endWinner === value} onChange={() => setEndWinner(value)}/><span>{label}</span>
            </label>)}
          </fieldset>
          {error && <p className={ui.error} role="alert">{errorMessages[language][error]}</p>}
          <div className={ui.dialogActions}>
            <Button className={ui.secondary} autoFocus isDisabled={busy} onPress={() => setConfirmEnd(false)}>{t.keepPlaying}</Button>
            <Button className={ui.dangerButton} isDisabled={disabled} onPress={() => void act('end', { winner: endWinner || null })}>{busy ? t.working : t.confirmEnd}</Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
    <div className={styles.printLink}>
      <a className={ui.secondary} href="/print" target="_blank" rel="noopener">{t.printSheets}<span aria-hidden="true">↗</span></a>
      <p className={ui.note}>{t.printSheetsHelp}</p>
    </div>
    {(lobby.phase === 'active' || lobby.phase === 'paused' || lobby.phase === 'meeting') && <Corrections lobby={lobby} language={language} connected={connected} onUpdate={onUpdate}/>}
    <RoomControls lobby={lobby} language={language} connected={connected} onUpdate={onUpdate} onExit={onExit}/>
  </section>;
}
