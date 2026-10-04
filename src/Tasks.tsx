import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, Label, ProgressBar } from 'react-aria-components';
import { symbolGlyphs, type CompleteTask, type ErrorCode, type Lobby, type Task, type TaskPuzzle } from '../shared/protocol';
import { codeFor, request } from './api';
import StationScanner from './Scanner';
import { errorMessages, translations, type Language } from './i18n';
import styles from './App.module.css';
import ui from './styles/ui.module.css';

type Copy = typeof translations.en;
export type Scan = { stationId: string; fresh: boolean };
type Props = {
  lobby: Lobby; language: Language; connected: boolean; onUpdate: (lobby: Lobby) => void;
  scan?: Scan | null; onScanHandled?: () => void; onStationScanned?: (stationId: string) => void;
};
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
    <p className={styles.eyebrow}>{t.doTaskAt} · {stationName(open)}</p>
    <h2 id="task-title" ref={heading} tabIndex={-1}>{kindLabel(t, open.puzzle.kind)}</h2>
    {open.puzzle.kind === 'order' && <OrderPuzzle puzzle={open.puzzle} t={t} disabled={locked} solved={solved} onSolved={answer => void submit(open, answer)}/>}
    {open.puzzle.kind === 'wires' && <WiresPuzzle puzzle={open.puzzle} t={t} disabled={locked} onSolved={answer => void submit(open, answer)}/>}
    {open.puzzle.kind === 'codebook' && <CodebookPuzzle puzzle={open.puzzle} t={t} disabled={locked} solved={solved} rejected={rejected} onSubmit={answer => void submit(open, answer)}/>}
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

// Spread the lights over a 3×3 panel, the same way every time for a given puzzle.
function lightPositions(numbers: number[]): Point[] {
  let seed = numbers.reduce((sum, value, index) => sum + value * (index + 7), 0);
  const random = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const cells = Array.from({ length: 9 }, (_, cell) => cell);
  for (let index = cells.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [cells[index], cells[other]] = [cells[other], cells[index]];
  }
  const jitter = () => (random() - .5) * .2;
  return numbers.map((_, index) => ({
    x: (cells[index] % 3 + .5 + jitter()) / 3 * 100,
    y: (Math.floor(cells[index] / 3) + .5 + jitter()) / 3 * 100,
  }));
}

function OrderPuzzle({ puzzle, t, disabled, solved, onSolved }: { puzzle: Extract<TaskPuzzle, { kind: 'order' }>; t: Copy; disabled: boolean; solved: boolean; onSolved: (answer: number[]) => void }) {
  const [tapped, setTapped] = useState<number[]>([]);
  const [wrong, setWrong] = useState(0);
  const sorted = [...puzzle.numbers].sort((a, b) => a - b);
  const positions = lightPositions(puzzle.numbers);
  const at = (value: number) => positions[puzzle.numbers.indexOf(value)];
  useEffect(() => {
    if (!wrong) return;
    const timer = setTimeout(() => setWrong(0), 500);
    return () => clearTimeout(timer);
  }, [wrong]);
  function tap(value: number) {
    if (value !== sorted[tapped.length]) { setTapped([]); setWrong(count => count + 1); return; }
    const next = [...tapped, value];
    setTapped(next); setWrong(0);
    if (next.length === sorted.length) onSolved(next);
  }
  return <>
    <p>{t.orderInstructions}</p>
    <div className={styles.lightBoard} data-wrong={wrong > 0 || undefined} data-complete={solved || tapped.length === sorted.length || undefined}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={tapped.map(value => `${at(value).x},${at(value).y}`).join(' ')}/>
      </svg>
      {puzzle.numbers.map((value, index) => <button key={value} type="button" className={styles.light}
        style={{ left: `${positions[index].x}%`, top: `${positions[index].y}%` }}
        data-lit={tapped.includes(value) || undefined} aria-pressed={tapped.includes(value)}
        disabled={disabled || tapped.includes(value)} onClick={() => tap(value)}>{value}</button>)}
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
    if (complete) onSolved(puzzle.left.map((_, index) => pairs[index]));
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

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'enter'] as const;

// A safe: each symbol has a slot on the display, filled from the keypad (or a keyboard).
function CodebookPuzzle({ puzzle, t, disabled, solved, rejected, onSubmit }: { puzzle: Extract<TaskPuzzle, { kind: 'codebook' }>; t: Copy; disabled: boolean; solved: boolean; rejected: number; onSubmit: (answer: string) => void }) {
  const [code, setCode] = useState('');
  const [shake, setShake] = useState(false);
  const length = puzzle.symbols.length;
  useEffect(() => {
    if (!rejected) return;
    setCode(''); setShake(true);
    const timer = setTimeout(() => setShake(false), 600);
    return () => clearTimeout(timer);
  }, [rejected]);
  function press(key: typeof KEYS[number]) {
    if (disabled) return;
    if (key === 'back') setCode(current => current.slice(0, -1));
    else if (key === 'enter') { if (code.length === length) onSubmit(code); }
    else setCode(current => current.length < length ? current + key : current);
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (/^\d$/.test(event.key)) press(event.key as typeof KEYS[number]);
      else if (event.key === 'Backspace') press('back');
      // Enter on a focused keypad button already presses that button.
      else if (event.key === 'Enter' && !(document.activeElement instanceof HTMLButtonElement)) press('enter');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return <>
    <p>{t.codebookInstructions}</p>
    <div className={styles.safe} data-wrong={shake || undefined} data-open={solved || undefined}>
      <ol className={styles.safeSlots} aria-label={t.codeAnswer}>
        {puzzle.symbols.map((symbol, index) => <li key={symbol} data-filled={index < code.length || undefined}>
          <span aria-hidden="true">{symbolGlyphs[symbol]}</span>
          <small>{t[`symbol_${symbol}` as keyof Copy]}</small>
          <b>{code[index] ?? <span aria-hidden="true">–</span>}</b>
        </li>)}
      </ol>
      <p className={styles.safeDisplay} role="status">{solved ? t.safeOpen : `${code.length} / ${length}`}</p>
      <div className={styles.keypad}>
        {KEYS.map(key => <button key={key} type="button" data-key={key}
          aria-label={key === 'back' ? t.deleteDigit : key === 'enter' ? t.checkCode : undefined}
          disabled={disabled || (key === 'enter' && code.length < length) || (key === 'back' && !code)}
          onClick={() => press(key)}>
          {key === 'back' ? '⌫' : key === 'enter' ? '✓' : key}
        </button>)}
      </div>
    </div>
  </>;
}
