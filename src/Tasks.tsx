import { useEffect, useRef, useState } from 'react';
import { Button, Input, Label, ProgressBar, TextField } from 'react-aria-components';
import { symbolGlyphs, type CompleteTask, type ErrorCode, type Lobby, type Task, type TaskPuzzle } from '../shared/protocol';
import { codeFor, request } from './api';
import { errorMessages, translations, type Language } from './i18n';
import styles from './App.module.css';
import ui from './styles/ui.module.css';

type Copy = typeof translations.en;
type Props = { lobby: Lobby; language: Language; connected: boolean; onUpdate: (lobby: Lobby) => void };
const kindLabel = (t: Copy, kind: TaskPuzzle['kind']) => kind === 'order' ? t.kindOrder : kind === 'wires' ? t.kindWires : t.kindCodebook;

export function SharedProgress({ lobby, language }: Pick<Props, 'lobby' | 'language'>) {
  const t = translations[language];
  if (!lobby.progress || lobby.progress.goal === 0) return null;
  const { done, goal } = lobby.progress;
  return <ProgressBar className={styles.progress} value={done} maxValue={goal} valueLabel={`${done} / ${goal}`}>
    {({ percentage }) => <>
      <div className={styles.progressTop}><Label>{t.crewProgress}</Label><span>{done} / {goal}</span></div>
      <div className={styles.progressTrack}><div style={{ width: `${percentage}%` }}/></div>
      {lobby.phase !== 'ended' && <p className={ui.note}>{t.progressNote}</p>}
    </>}
  </ProgressBar>;
}

export default function Tasks({ lobby, language, connected, onUpdate }: Props) {
  const t = translations[language];
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [notice, setNotice] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const open = lobby.you.tasks.find(task => task.id === openId && !task.done);
  const stationName = (task: Task) => lobby.stations.find(station => station.id === task.stationId)?.name ?? '';
  const active = lobby.phase === 'active';
  // Move focus between the list and an opened task, but not on first render.
  const previousOpen = useRef(openId);
  useEffect(() => { if (previousOpen.current !== openId) heading.current?.focus(); previousOpen.current = openId; }, [openId]);

  async function submit(task: Task, answer: CompleteTask['answer']) {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const result = await request('/api/tasks/complete', { roundId: lobby.roundId, taskId: task.id, answer });
      if (result.lobby) onUpdate(result.lobby);
      setOpenId(null); setNotice(true);
    } catch (failure) { setError(codeFor(failure)); }
    finally { setBusy(false); }
  }

  if (lobby.you.tasks.length === 0) return null;
  if (open) return <section className={`${ui.card} ${styles.taskCard}`} aria-labelledby="task-title">
    <p className={styles.eyebrow}>{t.doTaskAt} · {stationName(open)}</p>
    <h2 id="task-title" ref={heading} tabIndex={-1}>{kindLabel(t, open.puzzle.kind)}</h2>
    {open.puzzle.kind === 'order' && <OrderPuzzle puzzle={open.puzzle} t={t} disabled={busy || !connected || !active} onSolved={answer => void submit(open, answer)}/>}
    {open.puzzle.kind === 'wires' && <WiresPuzzle puzzle={open.puzzle} t={t} disabled={busy || !connected || !active} onSolved={answer => void submit(open, answer)}/>}
    {open.puzzle.kind === 'codebook' && <CodebookPuzzle puzzle={open.puzzle} t={t} busy={busy} disabled={busy || !connected || !active} onSubmit={answer => void submit(open, answer)}/>}
    {error && <p className={ui.error} role="alert">{errorMessages[language][error]}</p>}
    <Button className={ui.secondary} isDisabled={busy} onPress={() => { setOpenId(null); setError(null); }}>{t.backToTasks}</Button>
  </section>;

  const allDone = lobby.you.tasks.every(task => task.done);
  return <section className={`${ui.card} ${styles.taskCard}`} aria-labelledby="tasks-title">
    <h2 id="tasks-title" ref={heading} tabIndex={-1}>{t.yourTasks}</h2>
    <p className={ui.note} role="status">{notice ? allDone ? t.allTasksDone : t.taskComplete : allDone ? t.allTasksDone : t.tasksHelp}</p>
    <ul className={styles.taskList}>
      {lobby.you.tasks.map(task => <li key={task.id} data-done={task.done}>
        <span><strong>{stationName(task)}</strong><small>{kindLabel(t, task.puzzle.kind)}</small></span>
        {task.done
          ? <span className={ui.badge}>✓ {t.taskDone}</span>
          : <Button className={ui.secondary} isDisabled={!active || !connected} aria-label={`${t.openTask}: ${kindLabel(t, task.puzzle.kind)}, ${stationName(task)}`}
            onPress={() => { setOpenId(task.id); setNotice(false); setError(null); }}>{t.openTask}</Button>}
      </li>)}
    </ul>
  </section>;
}

function OrderPuzzle({ puzzle, t, disabled, onSolved }: { puzzle: Extract<TaskPuzzle, { kind: 'order' }>; t: Copy; disabled: boolean; onSolved: (answer: number[]) => void }) {
  const [tapped, setTapped] = useState<number[]>([]);
  const [wrong, setWrong] = useState(false);
  const sorted = [...puzzle.numbers].sort((a, b) => a - b);
  function tap(value: number) {
    if (value !== sorted[tapped.length]) { setTapped([]); setWrong(true); return; }
    const next = [...tapped, value];
    setTapped(next); setWrong(false);
    if (next.length === sorted.length) onSolved(next);
  }
  return <>
    <p>{t.orderInstructions}</p>
    <div className={styles.numberGrid}>
      {puzzle.numbers.map(value => <Button key={value} className={styles.puzzleButton} data-selected={tapped.includes(value) || undefined}
        isDisabled={disabled || tapped.includes(value)} onPress={() => tap(value)}>{value}</Button>)}
    </div>
    <p className={wrong ? ui.error : ui.note} role="status">{wrong ? t.orderWrong : `${tapped.length} / ${sorted.length}`}</p>
  </>;
}

function WiresPuzzle({ puzzle, t, disabled, onSolved }: { puzzle: Extract<TaskPuzzle, { kind: 'wires' }>; t: Copy; disabled: boolean; onSolved: (answer: number[]) => void }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [pairs, setPairs] = useState<Record<number, number>>({});
  const [wrong, setWrong] = useState(false);
  const colour = (name: string) => t[`colour_${name}` as keyof Copy];
  function connect(right: number) {
    if (selected === null) return;
    if (puzzle.right[right] !== puzzle.left[selected]) { setWrong(true); setSelected(null); return; }
    const next = { ...pairs, [selected]: right };
    setPairs(next); setSelected(null); setWrong(false);
    if (Object.keys(next).length === puzzle.left.length) onSolved(puzzle.left.map((_, index) => next[index]));
  }
  const linkedRight = new Set(Object.values(pairs));
  return <>
    <p>{t.wiresInstructions}</p>
    <div className={styles.wires}>
      <div role="group" aria-label={t.wiresLeft}>
        {puzzle.left.map((name, index) => <Button key={name} className={styles.puzzleButton} data-wire={name}
          aria-pressed={selected === index} data-selected={index in pairs || selected === index || undefined}
          aria-label={index in pairs ? `${colour(name)}, ${t.wireConnected}` : undefined}
          isDisabled={disabled || index in pairs} onPress={() => { setSelected(index); setWrong(false); }}>
          <i aria-hidden="true"/>{colour(name)}{index in pairs && <span aria-hidden="true">✓</span>}
        </Button>)}
      </div>
      <div role="group" aria-label={t.wiresRight}>
        {puzzle.right.map((name, index) => <Button key={name} className={styles.puzzleButton} data-wire={name}
          data-selected={linkedRight.has(index) || undefined}
          isDisabled={disabled || selected === null || linkedRight.has(index)} onPress={() => connect(index)}>
          <i aria-hidden="true"/>{colour(name)}
        </Button>)}
      </div>
    </div>
    <p className={wrong ? ui.error : ui.note} role="status">{wrong ? t.wiresWrong : `${Object.keys(pairs).length} / ${puzzle.left.length}`}</p>
  </>;
}

function CodebookPuzzle({ puzzle, t, busy, disabled, onSubmit }: { puzzle: Extract<TaskPuzzle, { kind: 'codebook' }>; t: Copy; busy: boolean; disabled: boolean; onSubmit: (answer: string) => void }) {
  const [code, setCode] = useState('');
  const complete = code.length === puzzle.symbols.length;
  return <form onSubmit={event => { event.preventDefault(); if (complete && !disabled) onSubmit(code); }}>
    <p>{t.codebookInstructions}</p>
    <ol className={styles.symbolRow}>
      {puzzle.symbols.map(symbol => <li key={symbol}><span aria-hidden="true">{symbolGlyphs[symbol]}</span>{t[`symbol_${symbol}` as keyof Copy]}</li>)}
    </ol>
    <TextField className={ui.field} value={code} onChange={value => setCode(value.replace(/\D/g, '').slice(0, puzzle.symbols.length))} autoComplete="off">
      <Label>{t.codeAnswer}</Label><Input className={ui.codeInput} inputMode="numeric" pattern="[0-9]*"/>
    </TextField>
    <Button type="submit" className={ui.primary} isDisabled={disabled || !complete}>{busy ? t.working : t.checkCode}<span aria-hidden="true">→</span></Button>
  </form>;
}
