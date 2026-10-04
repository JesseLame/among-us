import { useEffect, useRef, useState } from 'react';
import { Button } from 'react-aria-components';
import type { CompleteTask, ErrorCode, Lobby, Task } from '../../../shared/protocol';
import { codeFor, request } from '../../lib/api';
import StationScanner from './Scanner';
import { kindLabel, PuzzleView } from './games/registry';
import { errorMessages, translations, type Language } from '../../i18n';
import shared from '../../App.module.css';
import styles from './tasks.module.css';
import ui from '../../styles/ui.module.css';

export type Scan = { stationId: string; fresh: boolean };
type Props = {
  lobby: Lobby; language: Language; connected: boolean; onUpdate: (lobby: Lobby) => void;
  scan?: Scan | null; onScanHandled?: () => void; onStationScanned?: (stationId: string) => void;
};

export default function Tasks({ lobby, language, connected, onUpdate, scan, onScanHandled, onStationScanned }: Props) {
  const t = translations[language];
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [notice, setNotice] = useState(false);
  const [scanning, setScanning] = useState(false);
  // After a correct answer the solved puzzle stays on screen briefly before closing.
  const [solved, setSolved] = useState(false);
  const [rejected, setRejected] = useState(0);
  const closing = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(closing.current), []);
  const heading = useRef<HTMLHeadingElement>(null);
  const open = lobby.you.tasks.find(task => task.id === openId);
  const stationName = (task: Task) => lobby.stations.find(station => station.id === task.stationId)?.name ?? '';
  const active = lobby.phase === 'active';
  // The scanned station: its tasks are listed first and, in QR-only mode, are the only ones that open.
  // A fresh scan opens the only open task there directly.
  const here = scan && lobby.stations.some(station => station.id === scan.stationId) ? scan.stationId : null;
  const qrOnly = lobby.settings.stationAccess === 'qr';
  useEffect(() => {
    if (!scan?.fresh || !active) return;
    onScanHandled?.();
    const open = lobby.you.tasks.filter(task => task.stationId === here && !task.done);
    if (open.length === 1) setOpenId(open[0].id);
  }, [scan, active]);
  // Move focus between the list, the scanner and an opened task, but not on first render.
  const view = scanning ? 'scanner' : openId ?? 'list';
  const previousView = useRef(view);
  useEffect(() => { if (previousView.current !== view) heading.current?.focus(); previousView.current = view; }, [view]);

  async function submit(task: Task, answer: CompleteTask['answer']) {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const result = await request('/api/tasks/complete', { roundId: lobby.roundId, taskId: task.id, answer });
      setSolved(true);
      closing.current = setTimeout(() => {
        if (result.lobby) onUpdate(result.lobby);
        setOpenId(null); setSolved(false); setNotice(true);
      }, 800);
    } catch (failure) {
      const code = codeFor(failure);
      setError(code);
      if (code === 'WRONG_ANSWER') setRejected(count => count + 1);
    } finally { setBusy(false); }
  }
  const locked = busy || solved || !connected || !active;

  // An eliminated player waits silently as a body until a meeting; no tasks meanwhile.
  if (lobby.you.status === 'body') return <section className={`${ui.card} ${styles.taskCard} ${styles.bodyCard}`} aria-labelledby="body-title">
    <div className={styles.bodySymbol} aria-hidden="true">✕</div>
    <h2 id="body-title" ref={heading} tabIndex={-1}>{t.bodyTitle}</h2>
    <p>{t.bodyText}</p>
  </section>;
  if (lobby.you.tasks.length === 0) return null;
  if (open) return <section className={`${ui.card} ${styles.taskCard}`} aria-labelledby="task-title">
    <p className={shared.eyebrow}>{t.doTaskAt} · {stationName(open)}</p>
    <h2 id="task-title" ref={heading} tabIndex={-1}>{kindLabel(t, open.puzzle.kind)}</h2>
    <PuzzleView key={open.id} puzzle={open.puzzle} t={t} disabled={locked} solved={solved} rejected={rejected} onSubmit={answer => void submit(open, answer)}/>
    {error && <p className={ui.error} role="alert">{errorMessages[language][error]}</p>}
    <Button className={ui.secondary} isDisabled={busy || solved} onPress={() => { setOpenId(null); setError(null); }}>{t.backToTasks}</Button>
  </section>;

  if (scanning) return <section className={`${ui.card} ${styles.taskCard}`} aria-labelledby="scanner-title">
    <h2 id="scanner-title" ref={heading} tabIndex={-1}>{t.scanStation}</h2>
    <StationScanner stations={lobby.stations} t={t} onClose={() => setScanning(false)}
      onScanned={stationId => { setScanning(false); setNotice(false); onStationScanned?.(stationId); }}/>
  </section>;

  const allDone = lobby.you.tasks.every(task => task.done);
  const hereName = here && lobby.stations.find(station => station.id === here)?.name;
  const hereOpen = here ? lobby.you.tasks.some(task => task.stationId === here && !task.done) : false;
  const ordered = here ? [...lobby.you.tasks].sort((a, b) => Number(b.stationId === here) - Number(a.stationId === here)) : lobby.you.tasks;
  const status = notice ? allDone ? t.allTasksDone : t.taskComplete
    : hereName ? `${t.arrivedAt} ${hereName}.${hereOpen ? '' : ` ${t.noTasksHere}`}`
    : allDone ? t.allTasksDone : qrOnly ? t.tasksHelpQr : t.tasksHelp;
  return <section className={`${ui.card} ${styles.taskCard}`} aria-labelledby="tasks-title">
    <h2 id="tasks-title" ref={heading} tabIndex={-1}>{t.yourTasks}</h2>
    <p className={ui.note} role="status">{status}</p>
    {lobby.you.status === 'ghost' && <p className={styles.ghostNote}>{t.ghostNote}</p>}
    {!allDone && onStationScanned && <Button className={ui.primary} isDisabled={!active || !connected} onPress={() => { setScanning(true); setError(null); }}>
      {t.scanStation}<span aria-hidden="true">⌗</span>
    </Button>}
    <ul className={styles.taskList}>
      {ordered.map(task => <li key={task.id} data-done={task.done} data-here={task.stationId === here || undefined}>
        <span><strong>{stationName(task)}</strong><small>{kindLabel(t, task.puzzle.kind)}</small></span>
        {task.done
          ? <span className={ui.badge}>✓ {t.taskDone}</span>
          : qrOnly && task.stationId !== here
          ? <span className={styles.scanBadge}><span aria-hidden="true">⌗ </span>{t.scanToOpen}</span>
          : <Button className={ui.secondary} isDisabled={!active || !connected} aria-label={`${t.openTask}: ${kindLabel(t, task.puzzle.kind)}, ${stationName(task)}`}
            onPress={() => { setOpenId(task.id); setNotice(false); setError(null); }}>{t.openTask}</Button>}
      </li>)}
    </ul>
  </section>;
}
