import { useEffect, useRef, useState } from 'react';
import { Button } from 'react-aria-components';
import type { ErrorCode, Lobby, MeetingCommand } from '../../../shared/protocol';
import { codeFor, commandId, request } from '../../lib/api';
import { errorMessages, translations, type Language } from '../../i18n';
import styles from './meeting.module.css';
import ui from '../../styles/ui.module.css';

type Props = { lobby: Lobby; language: Language; connected: boolean; onUpdate: (lobby: Lobby) => void; onEndMeeting: () => void; ending: boolean };
type Step = MeetingCommand extends infer C ? C extends MeetingCommand ? Omit<C, 'commandId' | 'roundId' | 'expectedRevision'> : never : never;

// Organiser steps through a meeting: start it once everyone has gathered (marking who was
// found), run the phone vote or record the physical one, then continue play.
export default function MeetingControls({ lobby, language, connected, onUpdate, onEndMeeting, ending }: Props) {
  const t = translations[language];
  const meeting = lobby.meeting!;
  const [found, setFound] = useState<string[]>([]);
  const [ejected, setEjected] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const inFlight = useRef(false);
  useEffect(() => { setError(null); }, [meeting.stage]);
  // Every living-looking player is listed alike: the list never shows who the app knows is dead.
  const living = lobby.players.filter(player => player.playing && !player.out && !player.removed);

  async function step(input: Step) {
    if (inFlight.current || !connected || !lobby.roundId) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const result = await request('/api/meeting/commands', { ...input, commandId: commandId(), roundId: lobby.roundId, expectedRevision: lobby.revision });
      if (result.lobby) onUpdate(result.lobby);
    } catch (failure) { setError(codeFor(failure)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const disabled = busy || ending || !connected;

  return <div className={styles.meetingControls}>
    {meeting.stage === 'gathering' && <>
      <fieldset className={ui.choices}>
        <legend>{t.whoWasFound}</legend>
        {living.map(player => <label key={player.id}>
          <input type="checkbox" checked={found.includes(player.id)} onChange={event => setFound(current => event.target.checked ? [...current, player.id] : current.filter(id => id !== player.id))}/>
          <span>{player.name}</span>
        </label>)}
        <small className={styles.choicesHelp}>{t.whoWasFoundHelp}</small>
      </fieldset>
      <Button className={ui.primary} isDisabled={disabled} onPress={() => void step({ action: 'start', out: found })}>{busy ? t.working : t.startMeeting}<span aria-hidden="true">→</span></Button>
    </>}
    {meeting.stage === 'discussion' && lobby.settings.phoneVoting && <Button className={ui.primary} isDisabled={disabled} onPress={() => void step({ action: 'openVote' })}>{busy ? t.working : t.openVote}<span aria-hidden="true">→</span></Button>}
    {(meeting.stage === 'discussion' && !lobby.settings.phoneVoting) && <>
      <fieldset className={ui.choices}>
        <legend>{t.recordVote}</legend>
        {[...living.map(player => ({ id: player.id, name: player.name })), { id: '', name: t.nobodyEjectedOption }].map(option => <label key={option.id || 'nobody'}>
          <input type="radio" name="ejected" value={option.id} checked={ejected === option.id} onChange={() => setEjected(option.id)}/>
          <span>{option.name}</span>
        </label>)}
      </fieldset>
      <Button className={ui.primary} isDisabled={disabled} onPress={() => void step({ action: 'record', ejected: ejected || null })}>{busy ? t.working : t.recordResult}<span aria-hidden="true">→</span></Button>
    </>}
    {meeting.stage === 'voting' && <>
      <p className={ui.note}>{t.votesCast} {meeting.votes?.cast ?? 0} / {meeting.votes?.eligible ?? 0}</p>
      <Button className={ui.primary} isDisabled={disabled} onPress={() => void step({ action: 'closeVote' })}>{busy ? t.working : t.closeVote}<span aria-hidden="true">→</span></Button>
    </>}
    {meeting.stage === 'result' && <Button className={ui.primary} isDisabled={disabled} onPress={onEndMeeting}>{ending ? t.working : t.endMeeting}<span aria-hidden="true">→</span></Button>}
    {meeting.stage !== 'result' && <Button className={ui.secondary} isDisabled={disabled} onPress={onEndMeeting}>{t.skipToContinue}</Button>}
    {error && <p className={ui.error} role="alert">{errorMessages[language][error]}</p>}
  </div>;
}
