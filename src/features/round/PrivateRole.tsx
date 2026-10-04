import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from 'react-aria-components';
import type { ErrorCode, Lobby, RoleInfo } from '../../../shared/protocol';
import { codeFor, request } from '../../lib/api';
import { errorMessages, translations, type Language } from '../../i18n';
import shared from '../../App.module.css';
import styles from './round.module.css';
import ui from '../../styles/ui.module.css';
import EliminatePanel from './Eliminate';

type Props = { lobby: Lobby; language: Language; connected: boolean; languageControl?: ReactNode };

// The player's own role, fetched only on request and hidden again when the phone is put away.
export default function PrivateRole({ lobby, language, connected, languageControl }: Props) {
  const t = translations[language];
  const [info, setInfo] = useState<RoleInfo | null>(null);
  const role = info?.role ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const generation = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const RoleHeading = lobby.you.organiser ? 'h2' : 'h1';
  const RevealedHeading = lobby.you.organiser ? 'h3' : 'h2';
  useEffect(() => { if (!lobby.you.organiser) heading.current?.focus(); }, [lobby.you.organiser]);

  function hide() { generation.current++; setInfo(null); setBusy(false); setError(null); }
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

  async function reveal(quiet = false) {
    if ((busy && !quiet) || !connected) return;
    const current = ++generation.current;
    if (!quiet) { setBusy(true); setError(null); }
    try {
      const result = await request<RoleInfo>(`/api/role?roundId=${lobby.roundId}`);
      if (current === generation.current && result.roundId === lobby.roundId) setInfo(result);
    } catch (error) { if (current === generation.current && !quiet) setError(codeFor(error)); }
    finally { if (current === generation.current) setBusy(false); }
  }
  // While revealed, refresh private details (such as who can be eliminated) after shared changes.
  const shown = useRef(false);
  shown.current = Boolean(info);
  useEffect(() => { if (shown.current) void reveal(true); }, [lobby.revision]);

  return <section className={`${ui.card} ${styles.roleCard}`} aria-labelledby="private-role-title">
    <p className={shared.eyebrow}>{t.onlyYou}</p>
    {!lobby.you.organiser && (lobby.phase === 'paused' || !connected) && <p className={ui.note} role="status">{!connected ? t.reconnecting : lobby.pauseReason === 'victory' ? t.checkingResult : t.roundPaused}</p>}
    <div className={styles.roleSymbol} aria-hidden="true">{role ? role === 'impostor' ? '?' : '✳' : '◇'}</div>
    <RoleHeading id="private-role-title" ref={heading} tabIndex={-1} className={styles.roleHeading}>{t.yourRole}</RoleHeading>
    <div role="status" className={styles.roleContent}>
      {role ? <><RevealedHeading>{role === 'impostor' ? t.impostor : t.crewmate}</RevealedHeading><p>{role === 'impostor' ? t.impostorBrief : t.crewmateBrief}</p></> : <p>{t.roleHidden}</p>}
    </div>
    {role === 'impostor' && !lobby.settings.eliminations && <p className={`${ui.note} ${styles.eliminationsOff}`}>{t.eliminationsOffImpostor}</p>}
    {info?.elimination && lobby.roundId && <EliminatePanel roundId={lobby.roundId} elimination={info.elimination} language={language} connected={connected} onInfo={setInfo}/>}
    <Button className={ui.primary} isDisabled={!connected || busy} onPress={() => { if (role) hide(); else void reveal(); }}>{busy ? t.working : role ? t.hideRole : t.revealRole}<span aria-hidden="true">{role ? '×' : '→'}</span></Button>
    {error && <p className={ui.error} role="alert">{errorMessages[language][error]}</p>}
    <p className={ui.note}>{t.autoHide}</p>
    {languageControl && <div className={styles.roleLanguage}>{languageControl}</div>}
  </section>;
}
