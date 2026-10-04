import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import type { CallMeeting, ErrorCode, Lobby } from '../shared/protocol';
import { codeFor, commandId, request } from './api';
import { errorMessages, translations, type Language } from './i18n';
import styles from './App.module.css';
import ui from './styles/ui.module.css';

type Props = { lobby: Lobby; language: Language; connected: boolean; onUpdate: (lobby: Lobby) => void };
const clock = (ms: number) => {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

// Shown to everyone during a meeting: who called it, who was found out, and the discussion countdown.
export function MeetingCard({ lobby, language }: Pick<Props, 'lobby' | 'language'>) {
  const t = translations[language];
  const meeting = lobby.meeting;
  const [received, setReceived] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { setReceived(Date.now()); setNow(Date.now()); }, [meeting?.discussionMs]);
  const remaining = meeting ? Math.max(0, meeting.discussionMs - (now - received)) : 0;
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
  return <section className={`${ui.card} ${styles.meetingCard}`} aria-labelledby="meeting-title">
    <p className={styles.eyebrow}>{t.meetingEyebrow}</p>
    <h2 id="meeting-title">{title}</h2>
    {caller && <p>{meeting.kind === 'report' ? t.reportedBy : t.calledBy} <strong>{caller}</strong></p>}
    <p>{t.gatherText}</p>
    <p className={styles.meetingGhosts}>{ghosts.length ? <>{t.newGhostsText} <strong>{ghosts.join(', ')}</strong></> : t.noNewGhosts}</p>
    {remaining > 0
      ? <p className={styles.meetingTimer} role="timer" aria-live="off">{t.discussionLeft} <strong>{clock(remaining)}</strong></p>
      : <p className={styles.meetingVote} role="status">{t.voteNow}</p>}
    {lobby.you.status === 'ghost' && <p className={ui.note}>{t.ghostMeeting}</p>}
  </section>;
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
  const canEmergency = emergencyMeetings && lobby.you.emergencyLeft > 0;
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
