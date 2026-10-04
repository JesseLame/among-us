import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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

type Point = { x: number; y: number };
type Drag = { left: number; start: Point; at: Point; moved: boolean; over: number | null };
// A gentle horizontal S-curve, like a cable hanging between two plugs.
const cable = (from: Point, to: Point) => {
  const bend = Math.max(40, Math.abs(to.x - from.x) / 2);
  return `M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`;
};

// Drag a wire onto the socket of the same colour. Tapping (or keyboard: Enter on
// a wire, then on a socket) does the same, so dragging is never required.
function WiresPuzzle({ puzzle, t, disabled, onSolved }: { puzzle: Extract<TaskPuzzle, { kind: 'wires' }>; t: Copy; disabled: boolean; onSolved: (answer: number[]) => void }) {
  const board = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [pairs, setPairs] = useState<Record<number, number>>({});
  const [wrong, setWrong] = useState<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [anchors, setAnchors] = useState<{ left: Point[]; right: Point[] }>({ left: [], right: [] });
  const colour = (name: string) => t[`colour_${name}` as keyof Copy];
  const complete = Object.keys(pairs).length === puzzle.left.length;

  // Measure plug and socket centres so cables follow the layout at any width or text size.
  useLayoutEffect(() => {
    const element = board.current;
    if (!element) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      const centres = (selector: string) => [...element.querySelectorAll(selector)].map(node => {
        const rect = node.getBoundingClientRect();
        return { x: rect.left + rect.width / 2 - box.left, y: rect.top + rect.height / 2 - box.top };
      });
      setAnchors({ left: centres('[data-plug]'), right: centres('[data-socket-dot]') });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (wrong === null) return;
    const timer = setTimeout(() => setWrong(null), 700);
    return () => clearTimeout(timer);
  }, [wrong]);
  useEffect(() => {
    if (!complete) return;
    // Let the last cable land before the task closes.
    const timer = setTimeout(() => onSolved(puzzle.left.map((_, index) => pairs[index])), 500);
    return () => clearTimeout(timer);
  }, [complete]);

  function connect(left: number, right: number) {
    setSelected(null);
    if (left in pairs || Object.values(pairs).includes(right)) return;
    if (puzzle.right[right] !== puzzle.left[left]) { setWrong(right); return; }
    setWrong(null);
    setPairs({ ...pairs, [left]: right });
  }
  const point = (event: React.PointerEvent): Point => {
    const box = board.current!.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const socketAt = (event: React.PointerEvent) => {
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-socket]');
    return target ? Number(target.dataset.socket) : null;
  };

  function startDrag(event: React.PointerEvent, left: number) {
    if (disabled || left in pairs || event.button !== 0) return;
    board.current!.setPointerCapture(event.pointerId);
    const at = point(event);
    setDrag({ left, start: at, at, moved: false, over: null });
  }
  function moveDrag(event: React.PointerEvent) {
    if (!drag) return;
    const at = point(event);
    const moved = drag.moved || Math.hypot(at.x - drag.start.x, at.y - drag.start.y) > 8;
    setDrag({ ...drag, at, moved, over: moved ? socketAt(event) : null });
  }
  function endDrag(event: React.PointerEvent) {
    if (!drag) return;
    setDrag(null);
    if (!drag.moved) { setSelected(drag.left); return; }
    const right = socketAt(event);
    if (right !== null) connect(drag.left, right);
  }

  const linkedRight = new Set(Object.values(pairs));
  return <>
    <p>{t.wiresInstructions}</p>
    <div ref={board} className={styles.wireBoard} data-complete={complete || undefined}
      onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={() => setDrag(null)}>
      <svg className={styles.wireLayer} aria-hidden="true">
        {Object.entries(pairs).map(([left, right]) => anchors.left[+left] && anchors.right[right] &&
          <path key={left} d={cable(anchors.left[+left], anchors.right[right])} style={{ stroke: `var(--color-wire-${puzzle.left[+left]})` }}/>)}
        {drag?.moved && anchors.left[drag.left] &&
          <path data-live d={cable(anchors.left[drag.left], drag.at)} style={{ stroke: `var(--color-wire-${puzzle.left[drag.left]})` }}/>}
      </svg>
      <div role="group" aria-label={t.wiresLeft} className={styles.wireColumn}>
        {puzzle.left.map((name, index) => <button key={name} type="button" className={styles.wireEnd} data-wire={name}
          aria-pressed={selected === index} data-connected={index in pairs || undefined} data-dragging={drag?.left === index || undefined}
          aria-label={index in pairs ? `${colour(name)}, ${t.wireConnected}` : colour(name)}
          disabled={disabled || index in pairs}
          onPointerDown={event => startDrag(event, index)}
          onClick={event => { if (event.detail === 0) setSelected(selected === index ? null : index); }}>
          <span>{colour(name)}</span><i data-plug aria-hidden="true"/>
        </button>)}
      </div>
      <div role="group" aria-label={t.wiresRight} className={styles.wireColumn}>
        {puzzle.right.map((name, index) => <button key={name} type="button" className={styles.wireSocket} data-wire={name} data-socket={index}
          data-connected={linkedRight.has(index) || undefined} data-wrong={wrong === index || undefined}
          data-over={drag?.over === index || undefined}
          aria-label={linkedRight.has(index) ? `${colour(name)}, ${t.wireConnected}` : colour(name)}
          disabled={disabled || linkedRight.has(index)}
          onClick={() => { if (selected !== null) connect(selected, index); }}>
          <i data-socket-dot aria-hidden="true"/><span>{colour(name)}</span>
        </button>)}
      </div>
    </div>
    <p className={wrong !== null ? ui.error : ui.note} role="status">
      {wrong !== null ? t.wiresWrong : selected !== null ? `${colour(puzzle.left[selected])} · ${t.wiresPickSocket}` : `${Object.keys(pairs).length} / ${puzzle.left.length}`}
    </p>
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
