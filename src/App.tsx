import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Radio, RadioGroup } from 'react-aria-components';
import { io, type Socket } from 'socket.io-client';
import type { ClientEvents, ErrorCode, Lobby as LobbyState, ServerEvents, SessionEndReason } from '../shared/protocol';
import { errorMessages, initialLanguage, translations, type Language } from './i18n';
import styles from './App.module.css';
import ui from './styles/ui.module.css';
import { codeFor, reportLocation, request } from './lib/api';
import Home from './features/home/Home';
import Lobby from './features/lobby/Lobby';
import RoundView from './features/round/RoundView';
import type { Scan } from './features/tasks/Tasks';
import PrintSheets from './features/print/PrintSheets';
import Practice from './features/practice/Practice';
import { playMeetingAlarm, playReactorAlarm, unlockAudio } from './lib/sound';

// Started once per page load (React may run start-up effects twice in development), and
// before the session check so the new session cookie is in place.
const rejoinRequest = (() => {
  const params = new URLSearchParams(location.search);
  const code = params.get('rejoin');
  if (!code) return null;
  params.delete('rejoin');
  window.history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}`);
  const pending = request('/api/games/rejoin', { code });
  pending.catch(() => undefined);
  return pending;
})();

export default function App() {
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const t = translations[language];
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ErrorCode | null>(null);
  const [rejoinError, setRejoinError] = useState<ErrorCode | null>(null);
  const [name, setName] = useState('');
  const [connected, setConnected] = useState(false);
  const [sessionNotice, setSessionNotice] = useState<SessionEndReason | null>(null);
  // A scanned station QR code opens the app with ?station=…. The player stays "at" that
  // station until another scan or the round ends; `fresh` opens its task once.
  const [scan, setScan] = useState<Scan | null>(() => {
    const stationId = new URLSearchParams(location.search).get('station');
    return stationId ? { stationId, fresh: true } : null;
  });
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (!params.has('station')) return;
    params.delete('station');
    window.history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}`);
  }, []);
  // Only the current round uses a scan; forget it rather than opening a task in a later round.
  const scannedRound = useRef<string | null>(null);
  useEffect(() => {
    if (!lobby) return;
    if (lobby.phase !== 'active' && lobby.phase !== 'paused' && lobby.phase !== 'meeting') setScan(null);
    else if (scannedRound.current && scannedRound.current !== lobby.roundId) setScan(null);
    if (lobby.roundId) scannedRound.current = lobby.roundId;
  }, [lobby?.phase, lobby?.roundId]);
  // Each scan in a round is reported once (kept only for a Security player's live view).
  const roundOn = lobby?.phase === 'active' || lobby?.phase === 'paused' || lobby?.phase === 'meeting';
  const playingRound = roundOn && lobby?.you.playing ? lobby.roundId : null;
  useEffect(() => {
    if (playingRound && scan?.stationId) reportLocation(playingRound, scan.stationId);
  }, [playingRound, scan?.stationId]);
  // Sound needs a first tap before browsers allow it; then a meeting starting sounds the alarm.
  // Listen in the capture phase (React Aria stops press events from bubbling) and on the
  // events browsers accept as permission for sound: on touch screens that is lifting the finger.
  useEffect(() => {
    const events = ['pointerup', 'touchend', 'mousedown', 'keydown'] as const;
    for (const event of events) document.addEventListener(event, unlockAudio, { capture: true });
    return () => { for (const event of events) document.removeEventListener(event, unlockAudio, { capture: true }); };
  }, []);
  const previousPhase = useRef(lobby?.phase);
  useEffect(() => {
    if (lobby?.phase === 'meeting' && previousPhase.current && previousPhase.current !== 'meeting') playMeetingAlarm();
    previousPhase.current = lobby?.phase;
  }, [lobby?.phase]);
  // A reactor meltdown is public: every phone sounds its alarm when it starts.
  const reactorOn = Boolean(lobby?.reactor);
  const previousReactor = useRef(reactorOn);
  useEffect(() => {
    if (reactorOn && !previousReactor.current) playReactorAlarm();
    previousReactor.current = reactorOn;
  }, [reactorOn]);
  const sessionRequest = useRef(0);
  const lobbyCode = lobby?.code;
  const privatePlayerScreen = lobby && !lobby.you.organiser && (lobby.phase === 'active' || lobby.phase === 'paused' || lobby.phase === 'meeting');
  const updateLobby = useCallback((next: LobbyState) => {
    // Ignore late responses from a removed session or a previously visited room.
    setLobby(current => !current || current.you.id !== next.you.id || current.code !== next.code || current.revision > next.revision ? current : next);
  }, []);
  const exitLobby = useCallback((reason: SessionEndReason) => {
    sessionRequest.current++;
    setLobby(null); setConnected(false); setSessionNotice(reason); setRejoinError(null);
    window.history.replaceState(null, '', location.pathname);
  }, []);
  const entered = useCallback((next: LobbyState | null) => {
    sessionRequest.current++;
    setLobby(next); setSessionNotice(null);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = `Among Us ${t.home}`;
    try { localStorage.setItem('home-language', language); } catch { /* Optional preference storage. */ }
  }, [language, t.home]);

  async function restore() {
    const current = ++sessionRequest.current;
    setLoading(true); setLoadError(null);
    try {
      // A rejoin link from the organiser replaces this browser's session with that player's place.
      if (rejoinRequest) {
        try {
          const rejoined = await rejoinRequest;
          if (current === sessionRequest.current) { setLobby(rejoined.lobby); setSessionNotice(null); }
          return;
        } catch (failure) { if (current === sessionRequest.current) setRejoinError(codeFor(failure)); }
      }
      const result = await request('/api/session');
      if (current === sessionRequest.current) setLobby(result.lobby);
    }
    catch (error) { if (current === sessionRequest.current) setLoadError(codeFor(error)); }
    finally { if (current === sessionRequest.current) setLoading(false); }
  }
  useEffect(() => { void restore(); }, []);
  useEffect(() => {
    if (!lobbyCode) return;
    const socket: Socket<ServerEvents, ClientEvents> = io();
    socket.on('connect', () => { socket.emit('lobby:sync'); });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', error => { setConnected(false); if (error.message === 'NO_SESSION') exitLobby('unavailable'); });
    socket.on('lobby:updated', state => { updateLobby(state); setConnected(true); });
    socket.on('session:ended', exitLobby);
    const resync = () => { if (document.visibilityState === 'visible' && socket.connected) socket.emit('lobby:sync'); };
    document.addEventListener('visibilitychange', resync);
    return () => { socket.disconnect(); document.removeEventListener('visibilitychange', resync); };
  }, [lobbyCode, updateLobby, exitLobby]);

  const languageControl = <RadioGroup className={ui.languages} aria-label={t.language} value={language} onChange={value => setLanguage(value as Language)} orientation="horizontal">
    <Radio value="en" lang="en" aria-label="English">EN</Radio><Radio value="nl" lang="nl" aria-label="Nederlands">NL</Radio>
  </RadioGroup>;

  if (location.pathname === '/practice') return <div className={styles.shell}><Practice language={language} languageControl={languageControl}/></div>;
  if (location.pathname === '/print') return <div className={styles.shell}><PrintSheets language={language} languageControl={languageControl}/></div>;

  return <div className={styles.shell}>
    {!privatePlayerScreen && <>
    <header className={styles.header}>
      <a className={styles.brand} href="/" aria-label={`Among Us ${t.home}`}><span className={styles.brandMark} aria-hidden="true">⌂</span><span>AMONG US <em>{t.home}</em></span></a>
      {languageControl}
    </header>
    </>}

    {loading || loadError ? <main className={styles.loading} aria-live="polite">
      <h1>{loading ? t.loading : errorMessages[language][loadError!]}</h1>
      {loadError && <Button className={ui.primary} onPress={() => void restore()}>{t.retry}</Button>}
    </main>
    : !lobby ? <Home language={language} sessionNotice={sessionNotice} initialError={rejoinError} name={name} onNameChange={setName} onEntered={entered}/>
    : lobby.phase === 'lobby' ? <Lobby lobby={lobby} language={language} connected={connected} onUpdate={updateLobby} onExit={exitLobby}/>
    : <RoundView lobby={lobby} language={language} connected={connected} onUpdate={updateLobby} onExit={exitLobby}
      languageControl={privatePlayerScreen ? languageControl : undefined} scan={scan}
      onScanHandled={() => setScan(current => current && { ...current, fresh: false })} onStationScanned={stationId => setScan({ stationId, fresh: true })}/>}
    {!privatePlayerScreen && <footer className={styles.footer}><span>{t.footer}</span><span>{t.scaffold}</span></footer>}
  </div>;
}
