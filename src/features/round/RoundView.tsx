import { useEffect, useRef, type ReactNode } from 'react';
import type { Lobby, SessionEndReason } from '../../../shared/protocol';
import { translations, type Language } from '../../i18n';
import shared from '../../App.module.css';
import styles from './round.module.css';
import ui from '../../styles/ui.module.css';
import Tasks, { type Scan } from '../tasks/Tasks';
import SharedProgress from '../tasks/SharedProgress';
import GameSettings from '../lobby/Settings';
import { CallMeetingButtons, MeetingCard } from '../meeting/Meeting';
import PrivateRole from './PrivateRole';
import RoundControls from './RoundControls';
import ReactorCard from '../sabotage/ReactorCard';
import { roleCards } from '../roles/registry';

type Props = {
  lobby: Lobby; language: Language; connected: boolean; onUpdate: (lobby: Lobby) => void; onExit: (reason: SessionEndReason) => void;
  languageControl?: ReactNode; scan?: Scan | null; onScanHandled?: () => void; onStationScanned?: (stationId: string) => void;
};

export default function RoundView(props: Props) {
  const { lobby, language, connected } = props;
  const t = translations[language];
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [lobby.phase]);
  const winner = lobby.result?.winner;
  const title = lobby.phase === 'meeting' ? t.meetingTitle : lobby.phase === 'paused' ? t.pausedTitle : lobby.phase === 'ended' ? winner === 'crew' ? t.crewWonTitle : winner === 'impostor' ? t.impostorWonTitle : winner === 'jester' ? t.jesterWonTitle : t.endedTitle : t.roundTitle;
  const declared = lobby.result?.reason === 'organiser';
  const endedMessage = declared && winner ? winner === 'crew' ? t.declaredCrewMessage : t.declaredImpostorMessage
    : winner === 'jester' ? t.jesterWonMessage : winner === 'crew' ? lobby.result?.reason === 'ejected' ? t.crewWonEjectMessage : t.crewWonMessage : winner === 'impostor' ? lobby.result?.reason === 'reactor' ? t.impostorWonReactorMessage : t.impostorWonMessage : lobby.result?.reason === 'departure' ? t.departureMessage : t.endedMessage;
  const tasks = <Tasks key={`tasks:${lobby.roundId}:${lobby.phase}`} lobby={lobby} language={language} connected={connected} onUpdate={props.onUpdate} scan={props.scan} onScanHandled={props.onScanHandled} onStationScanned={props.onStationScanned}/>;

  // An eliminated player sees that first; everyone else starts with their role card.
  // A meeting comes first for everyone.
  const body = lobby.you.status === 'body';
  const meeting = <MeetingCard lobby={lobby} language={language} connected={connected} onUpdate={props.onUpdate} className={styles.meetingCard}/>;
  const reactor = <ReactorCard lobby={lobby} language={language} connected={connected} onUpdate={props.onUpdate}
    here={props.scan?.stationId ?? null} onStationScanned={props.onStationScanned} className={styles.meetingCard}/>;
  const calls = <CallMeetingButtons lobby={lobby} language={language} connected={connected} onUpdate={props.onUpdate}/>;
  if (!lobby.you.organiser && lobby.phase !== 'ended') return <main className={styles.playerRound}>
    {meeting}
    {reactor}
    {body && tasks}
    <PrivateRole key={`${lobby.roundId}:${lobby.phase}`} lobby={lobby} language={language} connected={connected} onUpdate={props.onUpdate} languageControl={props.languageControl}/>
    <SharedProgress lobby={lobby} language={language} className={styles.progress}/>
    {calls}
    {!body && tasks}
  </main>;

  return <main className={`${shared.lobby} ${styles.hostRound}`}>
    <section>
      <p className={shared.eyebrow}>{t.invite} · {lobby.code}</p>
      <h1 ref={heading} tabIndex={-1}>{title}</h1>
      {lobby.phase !== 'meeting' && <p className={shared.intro} role="status">{lobby.phase === 'paused' ? lobby.pauseReason === 'restart' ? t.restartMessage : lobby.pauseReason === 'victory' ? t.checkingResult : t.pausedMessage : lobby.phase === 'ended' ? endedMessage : lobby.you.playing ? t.roundMessage : t.hostRoundMessage}</p>}
      {meeting}
      {lobby.phase !== 'ended' && !lobby.you.playing && reactor}
      <p className={shared.connection} role="status"><i data-connected={connected}/>{connected ? t.connected : t.reconnecting}</p>
      <SharedProgress lobby={lobby} language={language} className={styles.progress}/>
      <RoundControls lobby={lobby} language={language} connected={connected} onUpdate={props.onUpdate} onExit={props.onExit}/>
      {lobby.phase !== 'ended' && <aside className={shared.buildNote}><h2>{t.nextTitle}</h2><p>{t.nextText}</p></aside>}
    </section>
    {lobby.phase === 'ended' ? <section className={`${ui.card} ${shared.lobbyCard}`} aria-labelledby="revealed-title">
      <p className={shared.eyebrow}>{t.allRevealed}</p><h2 id="revealed-title">{t.whoWasWho}</h2>
      <ul className={shared.roster}>{lobby.players.map((player, index) => <li key={player.id}>
        <span className={shared.avatar} data-color={index % 4} aria-hidden="true">{player.name.charAt(0).toUpperCase()}</span>
        <span className={shared.playerName}>{player.name}{player.id === lobby.you.id && <small> · {t.you}</small>}{player.removed && <small> · {t.removedPlayer}</small>}</span>
        <span className={ui.badge}>{!player.playing ? t.hostBadge : roleCards[lobby.revealedRoles?.find(role => role.id === player.id)?.role ?? 'crewmate'].name(t)}</span>
      </li>)}</ul>
      {winner === 'impostor' && lobby.revealedRoles?.some(entry => entry.role === 'accomplice') && <p className={ui.note}>{t.accompliceWonNote}</p>}
      <p className={ui.note}>{t.newRoundNote}</p>
    </section> : !lobby.you.playing ? <section className={`${ui.card} ${shared.lobbyCard} ${styles.hostRoster}`} aria-labelledby="playing-title">
      <div className={shared.cardTop}><h2 id="playing-title">{t.playingNow}</h2><span>{lobby.players.filter(player => player.playing).length}</span></div>
      <ul className={shared.roster}>{lobby.players.filter(player => player.playing).map((player, index) => <li key={player.id}>
        <span className={shared.avatar} data-color={index % 4} aria-hidden="true">{player.name.charAt(0).toUpperCase()}</span>
        <span className={shared.playerName}>{player.name}</span>
        {player.test && <span className={ui.badge}>{t.testBadge}</span>}
        {player.out && <span className={ui.badge}>{t.ghostBadge}</span>}
      </li>)}</ul>
    </section> : <div className={styles.roundColumn}>
      {reactor}
      <PrivateRole key={`${lobby.roundId}:${lobby.phase}`} lobby={lobby} language={language} connected={connected} onUpdate={props.onUpdate}/>
      {calls}
      {tasks}
    </div>}
    {lobby.phase !== 'ended' && <GameSettings lobby={lobby} language={language} connected={connected} onUpdate={props.onUpdate}/>}
  </main>;
}
