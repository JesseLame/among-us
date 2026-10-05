import { useEffect, useRef, useState } from 'react';
import { Button } from 'react-aria-components';
import type { Lobby as LobbyState, SessionEndReason } from '../../../shared/protocol';
import { translations, type Language } from '../../i18n';
import shared from '../../App.module.css';
import styles from './lobby.module.css';
import ui from '../../styles/ui.module.css';
import { Avatar } from '../../themes/art';
import { PhoneAddressNote, QrCode, usableOrigin, usePhoneOrigin } from '../../components/Qr';
import RoundControls from '../round/RoundControls';
import GameSettings from './Settings';
import Stations from './Stations';

type Props = { lobby: LobbyState; language: Language; connected: boolean; onUpdate: (lobby: LobbyState) => void; onExit: (reason: SessionEndReason) => void };

// Before a round: the invite, the roster and, for the organiser, stations and settings.
export default function Lobby({ lobby, language, connected, onUpdate, onExit }: Props) {
  const t = translations[language];
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const phoneOriginState = usePhoneOrigin(lobby.code);
  const phoneOrigin = usableOrigin(phoneOriginState);
  const playingCount = lobby.players.filter(player => player.playing).length;

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(`${phoneOrigin ?? location.origin}/?code=${lobby.code}`);
      setCopyState('copied');
    } catch { setCopyState('failed'); }
  }

  return <main className={shared.lobby}>
    <section className={styles.lobbyIntro}>
      <p className={shared.eyebrow}>{t.edition}</p>
      <h1 ref={heading} tabIndex={-1}>{t.lobbyTitle}</h1>
      <p className={shared.intro}>{t.lobbyIntro}</p>
      <div className={styles.inviteRow}>
        <div className={styles.invite}>
          <span className={shared.eyebrow}>{t.invite}</span><strong>{lobby.code}</strong>
          <Button className={ui.secondary} onPress={() => void copyInvite()}>{copyState === 'copied' ? t.copied : t.copy} <span aria-hidden="true">↗</span></Button>
          <span role="status">{copyState === 'failed' ? t.copyFailed : copyState === 'copied' ? t.copied : ''}</span>
        </div>
        {lobby.you.organiser && phoneOrigin && <div className={styles.joinQr}>
          <QrCode className={styles.qr} value={`${phoneOrigin}/?code=${lobby.code}`} label={`${t.scanToJoin}: ${lobby.code}`}/>
          <p>{t.scanToJoin}</p>
        </div>}
      </div>
      {lobby.you.organiser && <PhoneAddressNote origin={phoneOriginState} usesAddress={t.qrUsesAddress} noNetwork={t.qrNoNetwork} lookupFailed={t.qrLookupFailed}/>}
      <p className={ui.note}>{lobby.you.organiser ? lobby.you.playing ? t.hostNote : t.hostOnlyNote : t.playerNote}</p>
    </section>
    <section className={`${ui.card} ${shared.lobbyCard}`} aria-labelledby="roster">
      <div className={shared.cardTop}><h2 id="roster">{t.roster}</h2><span>{playingCount} / 8</span></div>
      <p className={shared.connection} role="status"><i data-connected={connected} />{connected ? t.connected : t.reconnecting}</p>
      <ul className={shared.roster}>{lobby.players.map((player, i) => <li key={player.id}>
        <Avatar color={i % 4} initial={player.name.charAt(0).toUpperCase()}/>
        <span className={shared.playerName}>{player.name}{player.id === lobby.you.id && <small> · {t.you}</small>}</span>
        {player.organiser && <span className={ui.badge}>{player.playing ? t.organiser : t.hostBadge}</span>}
        {player.test && <span className={ui.badge}>{t.testBadge}</span>}
      </li>)}</ul>
      {playingCount < 8 && <p className={styles.waiting}><span aria-hidden="true">+ </span>{t.waiting}</p>}
      <p className={ui.note}>{t.lobbyHint}</p>
      {lobby.you.organiser && <Stations lobby={lobby} language={language} connected={connected} onUpdate={onUpdate}/>}
      <RoundControls lobby={lobby} language={language} connected={connected} onUpdate={onUpdate} onExit={onExit}/>
      <aside className={shared.buildNote}><h3>{t.nextTitle}</h3><p>{t.nextText}</p></aside>
    </section>
    {lobby.you.organiser && <GameSettings lobby={lobby} language={language} connected={connected} onUpdate={onUpdate}/>}
  </main>;
}
