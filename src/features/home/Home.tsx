import { useEffect, useRef, useState } from 'react';
import { Button, Input, Label, Tab, TabList, TabPanel, Tabs, TextField } from 'react-aria-components';
import { createGame, joinGame, type ErrorCode, type Lobby, type SessionEndReason } from '../../../shared/protocol';
import { codeFor, request } from '../../lib/api';
import { errorMessages, translations, type Language } from '../../i18n';
import styles from '../../App.module.css';
import ui from '../../styles/ui.module.css';

type Props = {
  language: Language;
  // Why the previous session ended, shown above the form.
  sessionNotice: SessionEndReason | null;
  // A failed rejoin link, shown as the form's first error.
  initialError: ErrorCode | null;
  // Kept by the app so a player who has to join again finds their name filled in.
  name: string; onNameChange: (name: string) => void;
  onEntered: (lobby: Lobby | null) => void;
};

// The start page: what the game is, and the form to join or host a room.
export default function Home({ language, sessionNotice, initialError, name, onNameChange, onEntered }: Props) {
  const t = translations[language];
  const [mode, setMode] = useState('join');
  const [hostMode, setHostMode] = useState<'host' | 'play'>('host');
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('code')?.toUpperCase().slice(0, 5) || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(initialError);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (sessionNotice) heading.current?.focus(); }, [sessionNotice]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const data = mode === 'join' ? { name, code } : { name, language, playing: hostMode === 'play' };
    if (!(mode === 'join' ? joinGame : createGame).safeParse(data).success) { setError('INVALID_INPUT'); return; }
    setBusy(true); setError(null);
    try { onEntered((await request(mode === 'join' ? '/api/games/join' : '/api/games', data)).lobby); }
    catch (error) { setError(codeFor(error)); setBusy(false); }
  }

  return <main>
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
        <h2 id="entry-title" ref={heading} tabIndex={-1}>{t.entryTitle}</h2><p>{t.entryIntro}</p>
        {sessionNotice && <p className={ui.sessionNotice} role="status">{sessionNotice === 'removed' ? t.youWereRemoved : sessionNotice === 'destroyed' ? t.roomWasDeleted : t.roomUnavailable}</p>}
        <Tabs selectedKey={mode} onSelectionChange={key => { setMode(String(key)); setError(null); }}>
          <TabList aria-label={t.entryTitle} className={ui.tabs}><Tab id="join">{t.join}</Tab><Tab id="create">{t.create}</Tab></TabList>
          {(['join', 'create'] as const).map(tab => <TabPanel id={tab} key={tab}>
            <form onSubmit={submit} noValidate>
              <TextField className={ui.field} value={name} onChange={onNameChange} isRequired maxLength={24} autoComplete="nickname">
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
        <a className={styles.practiceLink} href="/practice">{t.practiceLink}<span aria-hidden="true"> →</span></a>
        <div className={styles.entryBottom}><span aria-hidden="true">✳</span><span>{t.edition}</span><span aria-hidden="true">✳</span></div>
      </section>
    </div>
    <section className={styles.how} aria-label={t.how}>
      {[['01', t.step1, t.step1Text], ['02', t.step2, t.step2Text], ['03', t.step3, t.step3Text]].map(([number, title, body]) => <article key={number}><span>{number}</span><div><h2>{title}</h2><p>{body}</p></div></article>)}
    </section>
  </main>;
}
