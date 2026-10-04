import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import type { CallMeeting, ErrorCode, Lobby } from '../../../shared/protocol';
import { codeFor, commandId, request } from '../../lib/api';
import { errorMessages, translations, type Language } from '../../i18n';
import shared from '../../App.module.css';
import styles from './meeting.module.css';
import ui from '../../styles/ui.module.css';

type Props = { lobby: Lobby; language: Language; connected: boolean; onUpdate: (lobby: Lobby) => void };
const clock = (ms: number) => {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

// Shown to everyone during a meeting. Gathering: wait for the host. Discussion: who was
// found out and the countdown. Voting: phone ballot (living players) or progress. Result:
// who was ejected; the host screen also lists the votes.
export function MeetingCard({ lobby, language, connected = true, onUpdate, className }: Pick<Props, 'lobby' | 'language'> & Partial<Pick<Props, 'connected' | 'onUpdate'>> & { className?: string }) {
  const t = translations[language];
  const meeting = lobby.meeting;
  const [received, setReceived] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { setReceived(Date.now()); setNow(Date.now()); }, [meeting?.discussionMs]);
  const discussing = meeting?.stage === 'discussion';
  const untimed = discussing && meeting?.discussionMs === null;
  const remaining = discussing && !untimed ? Math.max(0, meeting!.discussionMs! - (now - received)) : 0;
  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [remaining > 0, meeting?.discussionMs]);
  if (!meeting) return null;
  const name = (id: string | null) => lobby.players.find(player => player.id === id)?.name;
  const caller = name(meeting.calledBy);
  const title = meeting.kind === 'report' ? t.meetingReport : meeting.kind === 'emergency' ? t.meetingEmergency : t.meetingOrganiser;
  const ghosts = meeting.newGhosts.map(name).filter(Boolean);
  const ghost = lobby.you.status !== 'alive' && lobby.you.playing;
  return <section className={`${ui.card} ${styles.meetingCard} ${className ?? ''}`} aria-labelledby="meeting-title">
    <p className={shared.eyebrow}>{t.meetingEyebrow}</p>
    <h2 id="meeting-title">{title}</h2>
    {caller && <p>{meeting.kind === 'report' ? t.reportedBy : t.calledBy} <strong>{caller}</strong></p>}
    {meeting.stage === 'gathering' && <p className={styles.meetingVote} role="status">{t.gatherWait}</p>}
    {meeting.stage !== 'gathering' && <p className={styles.meetingGhosts}>{ghosts.length ? <>{t.newGhostsText} <strong>{ghosts.join(', ')}</strong></> : t.noNewGhosts}</p>}
    {discussing && (untimed ? <p className={styles.meetingVote} role="status">{lobby.settings.phoneVoting ? t.voteOnPhoneSoon : t.discussionUntimed}</p>
      : remaining > 0
      ? <p className={styles.meetingTimer} role="timer" aria-live="off">{t.discussionLeft} <strong>{clock(remaining)}</strong></p>
      : <p className={styles.meetingVote} role="status">{lobby.settings.phoneVoting ? t.voteOnPhoneSoon : t.voteNow}</p>)}
    {meeting.stage === 'voting' && <>
      {lobby.you.playing && !ghost && onUpdate ? <VotePanel lobby={lobby} language={language} connected={connected} onUpdate={onUpdate}/> : null}
      <p className={ui.note} role="status">{t.votesCast} {meeting.votes?.cast ?? 0} / {meeting.votes?.eligible ?? 0}</p>
    </>}
    {meeting.stage === 'result' && meeting.result && <>
      <p className={styles.meetingVote} role="status">{meeting.result.ejected ? `${name(meeting.result.ejected)} ${t.wasEjected}` : t.nobodyEjected}</p>
      {meeting.result.tally && (lobby.you.organiser
        ? <ul className={styles.tally} aria-label={t.voteResults}>
          {meeting.result.tally.map(entry => <li key={entry.target} data-ejected={entry.target === meeting.result!.ejected || undefined}>
            <strong>{entry.target === 'skip' ? t.skipVote : name(entry.target)}</strong>
            <span>{entry.voters.length}</span>
            <small>{entry.voters.map(name).join(', ')}</small>
          </li>)}
        </ul>
        : <p className={ui.note}>{t.seeHostScreen}</p>)}
    </>}
    {ghost && meeting.stage !== 'gathering' && <p className={ui.note}>{t.ghostMeeting}</p>}
  </section>;
}

// The phone ballot: any living player, or skip. A vote can change until voting closes.
function VotePanel({ lobby, language, connected, onUpdate }: Props) {
  const t = translations[language];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const candidates = lobby.players.filter(player => player.playing && !player.out && !player.removed);
  async function vote(target: string) {
    if (busy || !connected || !lobby.roundId) return;
    setBusy(true); setError(null);
    try {
      const result = await request('/api/vote', { roundId: lobby.roundId, target });
      if (result.lobby) onUpdate(result.lobby);
    } catch (failure) { setError(codeFor(failure)); }
    finally { setBusy(false); }
  }
  return <div className={styles.ballot}>
    <p>{lobby.you.vote ? <>{t.youVotedFor} <strong>{lobby.you.vote === 'skip' ? t.skipVote : candidates.find(player => player.id === lobby.you.vote)?.name}</strong>. {t.changeVote}</> : t.castYourVote}</p>
    <div role="group" aria-label={t.castYourVote} className={styles.ballotOptions}>
      {candidates.map(player => <Button key={player.id} className={ui.secondary} aria-pressed={lobby.you.vote === player.id} isDisabled={busy || !connected} onPress={() => void vote(player.id)}>
        {player.name}{player.id === lobby.you.id && <small> · {t.you}</small>}
      </Button>)}
      <Button className={ui.secondary} aria-pressed={lobby.you.vote === 'skip'} isDisabled={busy || !connected} onPress={() => void vote('skip')}>{t.skipVote}</Button>
    </div>
    {error && <p className={ui.error} role="alert">{errorMessages[language][error]}</p>}
  </div>;
}

type Kind = Exclude<CallMeeting['kind'], 'organiser'>;

// Report body and emergency meeting buttons for living players during active play.
export function CallMeetingButtons({ lobby, language, connected, onUpdate }: Props) {
  const t = translations[language];
  const [confirm, setConfirm] = useState<Kind | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const pending = useRef<CallMeeting | null>(null);
  const { bodyReports, emergencyMeetings } = lobby.settings;
  const canReport = bodyReports;
  // No emergency meetings during a reactor meltdown: players must repair it.
  const canEmergency = emergencyMeetings && lobby.you.emergencyLeft > 0 && !lobby.reactor;
  if (!lobby.you.playing || lobby.you.status !== 'alive' || lobby.phase !== 'active' || (!canReport && !canEmergency)) return null;

  async function call(kind: Kind) {
    if (busy || !connected || !lobby.roundId) return;
    setBusy(true); setError(null);
    const input: CallMeeting = pending.current?.kind === kind ? pending.current : { commandId: commandId(), roundId: lobby.roundId, kind };
    pending.current = input;
    try {
      const result = await request('/api/meetings', input);
      pending.current = null;
      setConfirm(null);
      if (result.lobby) onUpdate(result.lobby);
    } catch (failure) {
      const code = codeFor(failure);
      setError(code);
      if (code !== 'CONNECTION_ERROR') pending.current = null;
    } finally { setBusy(false); }
  }

  return <section className={styles.callMeeting} aria-label={t.meetingEyebrow}>
    {canReport && <Button className={ui.dangerButton} isDisabled={!connected} onPress={() => { setConfirm('report'); setError(null); }}>{t.reportBody}</Button>}
    {canEmergency && <Button className={ui.secondary} isDisabled={!connected} onPress={() => { setConfirm('emergency'); setError(null); }}>
      {t.emergencyMeeting} <small>({lobby.you.emergencyLeft} {t.emergencyLeft})</small>
    </Button>}
    {error && !confirm && <p className={ui.error} role="alert">{errorMessages[language][error]}</p>}
    <ModalOverlay className={ui.modalOverlay} isOpen={Boolean(confirm)} onOpenChange={open => { if (!open && !busy) setConfirm(null); }} isDismissable={!busy}>
      <Modal className={ui.modal}>
        <Dialog aria-describedby="call-meeting-description">
          <Heading slot="title">{confirm === 'report' ? t.reportConfirmTitle : t.emergencyConfirmTitle}</Heading>
          <p id="call-meeting-description">{confirm === 'report' ? t.reportConfirmText : t.emergencyConfirmText}</p>
          {error && <p className={ui.error} role="alert">{errorMessages[language][error]}</p>}
          <div className={ui.dialogActions}>
            <Button className={ui.secondary} autoFocus isDisabled={busy} onPress={() => setConfirm(null)}>{t.cancel}</Button>
            <Button className={ui.dangerButton} isDisabled={busy || !connected} onPress={() => void call(confirm!)}>{busy ? t.working : confirm === 'report' ? t.reportBody : t.emergencyConfirm}</Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  </section>;
}
