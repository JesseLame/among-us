import { Label, ProgressBar } from 'react-aria-components';
import type { Lobby } from '../../../shared/protocol';
import { translations, type Language } from '../../i18n';
import styles from './tasks.module.css';
import ui from '../../styles/ui.module.css';

// The crew's task progress, published on a fixed cadence rather than per completion.
export default function SharedProgress({ lobby, language, className }: { lobby: Lobby; language: Language; className?: string }) {
  const t = translations[language];
  if (!lobby.progress || lobby.progress.goal === 0) return null;
  const { done, goal } = lobby.progress;
  return <ProgressBar className={`${styles.progress} ${className ?? ''}`} value={done} maxValue={goal} valueLabel={`${done} / ${goal}`}>
    {({ percentage }) => <>
      <div className={styles.progressTop}><Label>{t.crewProgress}</Label><span>{done} / {goal}</span></div>
      <div className={styles.progressTrack}><div style={{ width: `${percentage}%` }}/></div>
      {lobby.phase !== 'ended' && <p className={ui.note}>{t.progressNote}</p>}
    </>}
  </ProgressBar>;
}
