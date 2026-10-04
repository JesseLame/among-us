import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input, Label, Radio, RadioGroup, Tab, TabList, TabPanel, Tabs, TextField } from 'react-aria-components';
import { io, type Socket } from 'socket.io-client';
import { createGame, joinGame, type ClientEvents, type ErrorCode, type Lobby, type ServerEvents, type SessionEndReason } from '../shared/protocol';
import { errorMessages, initialLanguage, translations, type Language } from './i18n';
import styles from './App.module.css';
import ui from './styles/ui.module.css';
import { codeFor, request } from './api';
import RoundView, { RoundControls } from './RoundView';
import type { Scan } from './Tasks';
import Stations from './Stations';
import PrintSheets from './PrintSheets';
import { PhoneAddressNote, QrCode, usableOrigin, usePhoneOrigin } from './Qr';

export default function App() {
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const t = translations[language];
  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ErrorCode | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [mode, setMode] = useState('join');
  const [hostMode, setHostMode] = useState<'host' | 'play'>('host');
  const [name, setName] = useState('');
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('code')?.toUpperCase().slice(0, 5) || '');
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [sessionNotice, setSessionNotice] = useState<SessionEndReason | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
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
    if (lobby.phase !== 'active' && lobby.phase !== 'paused') setScan(null);
    else if (scannedRound.current && scannedRound.current !== lobby.roundId) setScan(null);
    if (lobby.roundId) scannedRound.current = lobby.roundId;
  }, [lobby?.phase, lobby?.roundId]);
  const lobbyHeading = useRef<HTMLHeadingElement>(null);
  const entryHeading = useRef<HTMLHeadingElement>(null);
  const sessionRequest = useRef(0);
  const lobbyCode = lobby?.code;
  const playingCount = lobby?.players.filter(player => player.playing).length ?? 0;
  const phoneOriginState = usePhoneOrigin(lobbyCode ?? undefined);
  const phoneOrigin = usableOrigin(phoneOriginState);
  const privatePlayerScreen = lobby && !lobby.you.organiser && (lobby.phase === 'active' || lobby.phase === 'paused');
  const updateLobby = useCallback((next: Lobby) => {
    // Ignore late responses from a removed session or a previously visited room.
    setLobby(current => !current || current.you.id !== next.you.id || current.code !== next.code || current.revision > next.revision ? current : next);
  }, []);
  const exitLobby = useCallback((reason: SessionEndReason) => {
    sessionRequest.current++;
    setLobby(null); setConnected(false); setSessionNotice(reason); setError(null); setCode(''); setCopyState('idle');
    window.history.replaceState(null, '', location.pathname);
  }, []);
  useEffect(() => { if (sessionNotice && !lobby) entryHeading.current?.focus(); }, [sessionNotice, lobby]);

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = `Among Us ${t.home}`;
    try { localStorage.setItem('home-language', language); } catch { /* Optional preference storage. */ }
  }, [language, t.home]);

  async function restore() {
    const current = ++sessionRequest.current;
    setLoading(true); setLoadError(null);
    try {
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
    lobbyHeading.current?.focus();
    return () => { socket.disconnect(); document.removeEventListener('visibilitychange', resync); };
  }, [lobbyCode, updateLobby, exitLobby]);
  useEffect(() => { if (lobby?.phase === 'lobby') lobbyHeading.current?.focus(); }, [lobby?.phase]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const data = mode === 'join' ? { name, code } : { name, language, playing: hostMode === 'play' };
    if (!(mode === 'join' ? joinGame : createGame).safeParse(data).success) { setError('INVALID_INPUT'); return; }
    sessionRequest.current++;
    setBusy(true); setError(null);
    try { setLobby((await request(mode === 'join' ? '/api/games/join' : '/api/games', data)).lobby); setSessionNotice(null); }
    catch (error) { setError(codeFor(error)); }
    finally { setBusy(false); }
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(`${phoneOrigin ?? location.origin}/?code=${lobby!.code}`);
      setCopyState('copied');
    } catch { setCopyState('failed'); }
  }

  const languageControl = <RadioGroup className={ui.languages} aria-label={t.language} value={language} onChange={value => setLanguage(value as Language)} orientation="horizontal">
    <Radio value="en" lang="en" aria-label="English">EN</Radio><Radio value="nl" lang="nl" aria-label="Nederlands">NL</Radio>
  </RadioGroup>;

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
    </main> : lobby && lobby.phase !== 'lobby' ? <RoundView lobby={lobby} language={language} connected={connected} onUpdate={updateLobby} onExit={exitLobby} languageControl={privatePlayerScreen ? languageControl : undefined} scan={scan} onScanHandled={() => setScan(current => current && { ...current, fresh: false })}/> : lobby ? <main className={styles.lobby}>
      <section className={styles.lobbyIntro}>
        <p className={styles.eyebrow}>{t.edition}</p>
        <h1 ref={lobbyHeading} tabIndex={-1}>{t.lobbyTitle}</h1>
        <p className={styles.intro}>{t.lobbyIntro}</p>
        <div className={styles.inviteRow}>
          <div className={styles.invite}>
            <span className={styles.eyebrow}>{t.invite}</span><strong>{lobby.code}</strong>
            <Button className={ui.secondary} onPress={() => void copyInvite()}>{copyState === 'copied' ? t.copied : t.copy} <span aria-hidden="true">↗</span></Button>
            <span role="status">{copyState === 'failed' ? t.copyFailed : copyState === 'copied' ? t.copied : ''}</span>
          </div>
          {lobby.you.organiser && phoneOrigin && <div className={styles.joinQr}>
            <QrCode value={`${phoneOrigin}/?code=${lobby.code}`} label={`${t.scanToJoin}: ${lobby.code}`}/>
            <p>{t.scanToJoin}</p>
          </div>}
        </div>
        {lobby.you.organiser && <PhoneAddressNote origin={phoneOriginState} usesAddress={t.qrUsesAddress} noNetwork={t.qrNoNetwork} lookupFailed={t.qrLookupFailed}/>}
        <p className={ui.note}>{lobby.you.organiser ? lobby.you.playing ? t.hostNote : t.hostOnlyNote : t.playerNote}</p>
      </section>
      <section className={`${ui.card} ${styles.lobbyCard}`} aria-labelledby="roster">
        <div className={styles.cardTop}><h2 id="roster">{t.roster}</h2><span>{playingCount} / 8</span></div>
        <p className={styles.connection} role="status"><i data-connected={connected} />{connected ? t.connected : t.reconnecting}</p>
        <ul className={styles.roster}>{lobby.players.map((player, i) => <li key={player.id}>
          <span className={styles.avatar} data-color={i % 4} aria-hidden="true">{player.name.charAt(0).toUpperCase()}</span>
          <span className={styles.playerName}>{player.name}{player.id === lobby.you.id && <small> · {t.you}</small>}</span>
          {player.organiser && <span className={ui.badge}>{player.playing ? t.organiser : t.hostBadge}</span>}
        </li>)}</ul>
        {playingCount < 8 && <p className={styles.waiting}><span aria-hidden="true">+ </span>{t.waiting}</p>}
        <p className={ui.note}>{t.lobbyHint}</p>
        {lobby.you.organiser && <Stations lobby={lobby} language={language} connected={connected} onUpdate={updateLobby}/>}
        <RoundControls lobby={lobby} language={language} connected={connected} onUpdate={updateLobby} onExit={exitLobby}/>
        <aside className={styles.buildNote}><h3>{t.nextTitle}</h3><p>{t.nextText}</p></aside>
      </section>
    </main> : <main>
      <div className={styles.hero}>
        <section className={styles.story}>
          <p className={styles.eyebrow}>{t.eyebrow}</p>
          <h1>{t.title}<br/><em>{t.titleAccent}</em></h1>
          <p className={styles.intro}>{t.intro}</p>
          <ul className={styles.facts}><li>{t.players}</li><li>{t.duration}</li><li>{t.devices}</li></ul>
          <div className={styles.house} role="img" aria-label={`${t.mapTitle} ${t.kitchen}, ${t.living}, ${t.hallway}, ${t.study}.`}>
            <span className={styles.mapNumber} aria-hidden="true">{t.mapLabel}</span>
            <div className={styles.floorplan} aria-hidden="true">
              <div className={styles.kitchen}><span>01</span>{t.kitchen}<i className={styles.counter}/></div>
              <div className={styles.living}><span>02</span>{t.living}<i className={styles.sofa}/><b className={styles.pawn}>?</b></div>
              <div className={styles.hallway}>{t.hallway}<i className={styles.path}/></div>
              <div className={styles.study}><span>03</span>{t.study}<i className={styles.desk}/></div>
              <div className={styles.here}>{t.youAreHere}<span>↑</span></div>
            </div>
            <p aria-hidden="true">{t.mapCaption}</p>
          </div>
        </section>
        <section className={`${ui.card} ${styles.entry}`} aria-labelledby="entry-title">
          <span className={styles.cardIndex} aria-hidden="true">01 — {t.checkIn}</span>
          <h2 id="entry-title" ref={entryHeading} tabIndex={-1}>{t.entryTitle}</h2><p>{t.entryIntro}</p>
          {sessionNotice && <p className={ui.sessionNotice} role="status">{sessionNotice === 'removed' ? t.youWereRemoved : sessionNotice === 'destroyed' ? t.roomWasDeleted : t.roomUnavailable}</p>}
          <Tabs selectedKey={mode} onSelectionChange={key => { setMode(String(key)); setError(null); }}>
            <TabList aria-label={t.entryTitle} className={ui.tabs}><Tab id="join">{t.join}</Tab><Tab id="create">{t.create}</Tab></TabList>
            {(['join', 'create'] as const).map(tab => <TabPanel id={tab} key={tab}>
              <form onSubmit={submit} noValidate>
                <TextField className={ui.field} value={name} onChange={setName} isRequired maxLength={24} autoComplete="nickname">
                  <Label>{t.name}</Label><Input placeholder={t.namePlaceholder} name="name" />
                </TextField>
                {tab === 'join' ? <TextField className={ui.field} value={code} onChange={value => setCode(value.toUpperCase())} isRequired maxLength={5} autoComplete="off">
                  <Label>{t.code}</Label><Input className={ui.codeInput} placeholder={t.codePlaceholder} name="code" autoCapitalize="characters" spellCheck={false} aria-describedby="code-help"/>
                  <small id="code-help">{t.codeHelp}</small>
                </TextField> : <>
                  <fieldset className={ui.choices}>
                    <legend>{t.hostChoice}</legend>
                    {([['host', t.hostOnly, t.hostOnlyHelp], ['play', t.hostAndPlay, t.hostAndPlayHelp]] as const).map(([value, label, help]) => <label key={value}>
                      <input type="radio" name="host-mode" value={value} checked={hostMode === value} onChange={() => setHostMode(value)}/>
                      <span><strong>{label}</strong><small>{help}</small></span>
                    </label>)}
                  </fieldset>
                  <p className={styles.createHelp}>{t.createHelp}</p>
                </>}
                {error && <p className={ui.error} role="alert">{errorMessages[language][error]}</p>}
                <Button type="submit" className={ui.primary} isDisabled={busy}>{busy ? t.working : tab === 'join' ? t.joinButton : t.createButton}<span aria-hidden="true">→</span></Button>
              </form>
            </TabPanel>)}
          </Tabs>
          <div className={styles.privacy}><span aria-hidden="true">◇</span>{t.privacy}</div>
          <div className={styles.entryBottom}><span aria-hidden="true">✳</span><span>{t.edition}</span><span aria-hidden="true">✳</span></div>
        </section>
      </div>
      <section className={styles.how} aria-label={t.how}>
        {[['01', t.step1, t.step1Text], ['02', t.step2, t.step2Text], ['03', t.step3, t.step3Text]].map(([number, title, body]) => <article key={number}><span>{number}</span><div><h2>{title}</h2><p>{body}</p></div></article>)}
      </section>
    </main>}
    {!privatePlayerScreen && <footer className={styles.footer}><span>{t.footer}</span><span>{t.scaffold}</span></footer>}
  </div>;
}
