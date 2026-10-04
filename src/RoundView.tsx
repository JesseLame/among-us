import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import type { ErrorCode, Lobby, Role, RoundCommand, SessionEndReason } from '../shared/protocol';
import { codeFor, commandId, request } from './api';
import { errorMessages, translations, type Language } from './i18n';
import styles from './App.module.css';
import ui from './styles/ui.module.css';
import RoomControls from './RoomControls';
import Tasks, { SharedProgress, type Scan } from './Tasks';
import StationAccessSwitch from './Settings';

type Props = {
  lobby: Lobby; language: Language; connected: boolean; onUpdate: (lobby: Lobby) => void; onExit: (reason: SessionEndReason) => void;
  languageControl?: ReactNode; scan?: Scan | null; onScanHandled?: () => void;
};

export function RoundControls({ lobby, language, connected, onUpdate, onExit }: Props) {
  const t = translations[language];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const inFlight = useRef(false);
  // Retain the original command ID after an ambiguous network failure. A manual
  // retry cannot apply the same command twice, even if its first response was lost.
  const pending = useRef<RoundCommand | null>(null);

  useEffect(() => { setConfirmEnd(false); setError(null); pending.current = null; }, [lobby.revision]);

  async function act(action: RoundCommand['action']) {
    if (inFlight.current || !connected) return;
    inFlight.current = true; setBusy(true); setError(null);
    const input: RoundCommand = pending.current?.action === action ? pending.current : {
      commandId: commandId(), action, expectedRevision: lobby.revision, roundId: lobby.roundId,
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
    {lobby.phase === 'paused' && <Button className={ui.primary} isDisabled={disabled} onPress={() => void act('resume')}>{busy ? t.working : t.resumeRound}<span aria-hidden="true">→</span></Button>}
    {lobby.phase === 'ended' && <Button className={ui.primary} isDisabled={disabled} onPress={() => void act('reset')}>{busy ? t.working : t.prepareRound}<span aria-hidden="true">→</span></Button>}
    {(lobby.phase === 'active' || lobby.phase === 'paused') && <Button className={ui.endButton} isDisabled={disabled} onPress={() => setConfirmEnd(true)}>{t.endRound}</Button>}
    {!connected && <p className={ui.note} role="status">{t.controlsOffline}</p>}
    {error && !confirmEnd && <p className={ui.error} role="alert">{errorMessages[language][error]}</p>}
    <ModalOverlay className={ui.modalOverlay} isOpen={confirmEnd} onOpenChange={setConfirmEnd} isDismissable={!busy} isKeyboardDismissDisabled={busy}>
      <Modal className={ui.modal}>
        <Dialog aria-describedby="end-description">
          <Heading slot="title">{t.endTitle}</Heading>
          <p id="end-description">{t.endDescription}</p>
          {error && <p className={ui.error} role="alert">{errorMessages[language][error]}</p>}
          <div className={ui.dialogActions}>
            <Button className={ui.secondary} autoFocus isDisabled={busy} onPress={() => setConfirmEnd(false)}>{t.keepPlaying}</Button>
            <Button className={ui.dangerButton} isDisabled={disabled} onPress={() => void act('end')}>{busy ? t.working : t.confirmEnd}</Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
    <StationAccessSwitch lobby={lobby} language={language} connected={connected} onUpdate={onUpdate}/>
    <div className={styles.printLink}>
      <a className={ui.secondary} href="/print" target="_blank" rel="noopener">{t.printSheets}<span aria-hidden="true">↗</span></a>
      <p className={ui.note}>{t.printSheetsHelp}</p>
    </div>
    <RoomControls lobby={lobby} language={language} connected={connected} onUpdate={onUpdate} onExit={onExit}/>
  </section>;
}

function PrivateRole({ lobby, language, connected, languageControl }: Pick<Props, 'lobby' | 'language' | 'connected' | 'languageControl'>) {
  const t = translations[language];
  const [role, setRole] = useState<Role | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const generation = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const RoleHeading = lobby.you.organiser ? 'h2' : 'h1';
  const RevealedHeading = lobby.you.organiser ? 'h3' : 'h2';
  useEffect(() => { if (!lobby.you.organiser) heading.current?.focus(); }, [lobby.you.organiser]);

  function hide() { generation.current++; setRole(null); setBusy(false); setError(null); }
  useEffect(() => {
    const conceal = () => hide();
    window.addEventListener('blur', conceal);
    document.addEventListener('visibilitychange', conceal);
    return () => {
      generation.current++;
      window.removeEventListener('blur', conceal);
      document.removeEventListener('visibilitychange', conceal);
    };
  }, []);
  useEffect(() => { if (!connected) hide(); }, [connected]);

  async function reveal() {
    if (busy || !connected) return;
    const current = ++generation.current;
    setBusy(true); setError(null);
    try {
      const result = await request<{ roundId: string; role: Role }>(`/api/role?roundId=${lobby.roundId}`);
      if (current === generation.current && result.roundId === lobby.roundId) setRole(result.role);
    } catch (error) { if (current === generation.current) setError(codeFor(error)); }
    finally { if (current === generation.current) setBusy(false); }
  }

  return <section className={`${ui.card} ${styles.roleCard}`} aria-labelledby="private-role-title">
    <p className={styles.eyebrow}>{t.onlyYou}</p>
    {!lobby.you.organiser && (lobby.phase === 'paused' || !connected) && <p className={ui.note} role="status">{!connected ? t.reconnecting : t.roundPaused}</p>}
    <div className={styles.roleSymbol} aria-hidden="true">{role ? role === 'impostor' ? '?' : '✳' : '◇'}</div>
    <RoleHeading id="private-role-title" ref={heading} tabIndex={-1} className={styles.roleHeading}>{t.yourRole}</RoleHeading>
    <div role="status" className={styles.roleContent}>
      {role ? <><RevealedHeading>{role === 'impostor' ? t.impostor : t.crewmate}</RevealedHeading><p>{role === 'impostor' ? t.impostorBrief : t.crewmateBrief}</p></> : <p>{t.roleHidden}</p>}
    </div>
    <Button className={ui.primary} isDisabled={!connected || busy} onPress={() => role ? hide() : void reveal()}>{busy ? t.working : role ? t.hideRole : t.revealRole}<span aria-hidden="true">{role ? '×' : '→'}</span></Button>
    {error && <p className={ui.error} role="alert">{errorMessages[language][error]}</p>}
    <p className={ui.note}>{t.autoHide}</p>
    {languageControl && <div className={styles.roleLanguage}>{languageControl}</div>}
  </section>;
}

export default function RoundView(props: Props) {
  const { lobby, language, connected } = props;
  const t = translations[language];
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [lobby.phase]);
  const crewWon = lobby.result?.winner === 'crew';
  const title = lobby.phase === 'paused' ? t.pausedTitle : lobby.phase === 'ended' ? crewWon ? t.crewWonTitle : t.endedTitle : t.roundTitle;
  const endedMessage = crewWon ? t.crewWonMessage : lobby.result?.reason === 'departure' ? t.departureMessage : t.endedMessage;
  const tasks = <Tasks key={`tasks:${lobby.roundId}:${lobby.phase}`} lobby={lobby} language={language} connected={connected} onUpdate={props.onUpdate} scan={props.scan} onScanHandled={props.onScanHandled}/>;

  if (!lobby.you.organiser && lobby.phase !== 'ended') return <main className={styles.playerRound}>
    <PrivateRole key={`${lobby.roundId}:${lobby.phase}`} lobby={lobby} language={language} connected={connected} languageControl={props.languageControl}/>
    <SharedProgress lobby={lobby} language={language}/>
    {tasks}
  </main>;

  return <main className={styles.lobby}>
    <section>
      <p className={styles.eyebrow}>{t.invite} · {lobby.code}</p>
      <h1 ref={heading} tabIndex={-1}>{title}</h1>
      <p className={styles.intro} role="status">{lobby.phase === 'paused' ? lobby.pauseReason === 'restart' ? t.restartMessage : t.pausedMessage : lobby.phase === 'ended' ? endedMessage : lobby.you.playing ? t.roundMessage : t.hostRoundMessage}</p>
      <p className={styles.connection} role="status"><i data-connected={connected}/>{connected ? t.connected : t.reconnecting}</p>
      <SharedProgress lobby={lobby} language={language}/>
      <RoundControls {...props}/>
      {lobby.phase !== 'ended' && <aside className={styles.buildNote}><h2>{t.nextTitle}</h2><p>{t.nextText}</p></aside>}
    </section>
    {lobby.phase === 'ended' ? <section className={`${ui.card} ${styles.lobbyCard}`} aria-labelledby="revealed-title">
      <p className={styles.eyebrow}>{t.allRevealed}</p><h2 id="revealed-title">{t.whoWasWho}</h2>
      <ul className={styles.roster}>{lobby.players.map((player, index) => <li key={player.id}>
        <span className={styles.avatar} data-color={index % 4} aria-hidden="true">{player.name.charAt(0).toUpperCase()}</span>
        <span className={styles.playerName}>{player.name}{player.id === lobby.you.id && <small> · {t.you}</small>}{player.removed && <small> · {t.removedPlayer}</small>}</span>
        <span className={ui.badge}>{!player.playing ? t.hostBadge : lobby.revealedRoles?.find(role => role.id === player.id)?.role === 'impostor' ? t.impostor : t.crewmate}</span>
      </li>)}</ul><p className={ui.note}>{t.newRoundNote}</p>
    </section> : !lobby.you.playing ? <section className={`${ui.card} ${styles.lobbyCard} ${styles.hostRoster}`} aria-labelledby="playing-title">
      <div className={styles.cardTop}><h2 id="playing-title">{t.playingNow}</h2><span>{lobby.players.filter(player => player.playing).length}</span></div>
      <ul className={styles.roster}>{lobby.players.filter(player => player.playing).map((player, index) => <li key={player.id}>
        <span className={styles.avatar} data-color={index % 4} aria-hidden="true">{player.name.charAt(0).toUpperCase()}</span>
        <span className={styles.playerName}>{player.name}</span>
      </li>)}</ul>
    </section> : <div className={styles.roundColumn}>
      <PrivateRole key={`${lobby.roundId}:${lobby.phase}`} lobby={lobby} language={language} connected={connected}/>
      {tasks}
    </div>}
  </main>;
}
