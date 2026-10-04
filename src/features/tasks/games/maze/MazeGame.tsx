import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Button } from 'react-aria-components';
import { mazeStep } from '../../../../../shared/protocol';
import TaskFrame from '../TaskFrame';
import type { TaskGameProps } from '../types';
import games from '../games.module.css';
import styles from './maze.module.css';

// Up, right, down, left: the move numbers the server checks.
const MOVES = [
  { key: 'ArrowUp', label: 'mazeUp', glyph: '▲' },
  { key: 'ArrowRight', label: 'mazeRight', glyph: '▶' },
  { key: 'ArrowDown', label: 'mazeDown', glyph: '▼' },
  { key: 'ArrowLeft', label: 'mazeLeft', glyph: '◀' },
] as const;
// Open sides of a cell (1 up, 2 right, 4 down, 8 left) as the walls it draws.
const WALLS = ['up', 'right', 'down', 'left'] as const;
const SWIPE = 24;

// Maze: walk the marker from the start to the exit with the arrows, arrow keys or a swipe.
// Walking back over the route undoes those steps, so the answer is always the direct route.
export default function MazeGame({ puzzle, t, disabled, solved, rejected, onSubmit }: TaskGameProps<'maze'>) {
  const { size, open, start, exit } = puzzle;
  const [route, setRoute] = useState<number[]>([start]);
  const [moves, setMoves] = useState<number[]>([]);
  const [bumped, setBumped] = useState(0);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const cell = route[route.length - 1];
  const done = solved || cell === exit;
  // The server turned the answer down (not expected): back to the start.
  useEffect(() => { if (rejected) { setRoute([start]); setMoves([]); } }, [rejected]);

  function move(direction: number) {
    if (disabled || done) return;
    const next = mazeStep(size, open, cell, direction);
    if (next === null) { setBumped(count => count + 1); return; }
    setBumped(0);
    const back = route.length > 1 && next === route[route.length - 2];
    const nextRoute = back ? route.slice(0, -1) : [...route, next];
    const nextMoves = back ? moves.slice(0, -1) : [...moves, direction];
    setRoute(nextRoute); setMoves(nextMoves);
    if (next === exit) onSubmit(nextMoves);
  }

  function onKeyDown(event: KeyboardEvent) {
    const direction = MOVES.findIndex(entry => entry.key === event.key);
    if (direction < 0) return;
    event.preventDefault();
    move(direction);
  }
  function onPointerUp(event: PointerEvent) {
    const from = swipe.current;
    swipe.current = null;
    if (!from) return;
    const dx = event.clientX - from.x, dy = event.clientY - from.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE) return;
    move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0));
  }

  const place = (index: number) => `${t.mazeRow} ${Math.floor(index / size) + 1}, ${t.mazeColumn} ${index % size + 1}`;
  const status = done ? t.mazeDone : bumped ? t.mazeWall : `${t.mazeYouAre} ${place(cell)}. ${t.mazeExitAt} ${place(exit)}.`;
  const onRoute = new Set(route);
  return <TaskFrame instructions={t.mazeInstructions} error={Boolean(bumped) && !done} status={status}>
    <div className={`${games.board} ${styles.mazeBoard}`} data-complete={solved || undefined}>
      <div className={styles.maze} style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }} data-bumped={bumped % 2 || undefined}
        data-bump-again={bumped && bumped % 2 === 0 || undefined}
        tabIndex={disabled || done ? -1 : 0} role="group" aria-label={t.mazeBoard}
        onKeyDown={onKeyDown} onPointerDown={event => { swipe.current = { x: event.clientX, y: event.clientY }; }}
        onPointerUp={onPointerUp} onPointerCancel={() => { swipe.current = null; }}>
        {open.map((sides, index) => <div key={index} className={styles.cell} aria-hidden="true"
          data-route={onRoute.has(index) || undefined}
          {...Object.fromEntries(WALLS.map((wall, side) => [`data-${wall}`, sides & (1 << side) ? undefined : '']))}>
          {index === exit && <span className={styles.exit}>⚑</span>}
          {index === cell && <span className={styles.marker}/>}
        </div>)}
      </div>
      <div className={styles.pad} role="group" aria-label={t.mazeControls}>
        {MOVES.map((entry, direction) => <Button key={entry.key} className={styles.arrow} data-direction={entry.label}
          aria-label={t[entry.label]} isDisabled={disabled || done} onPress={() => move(direction)}>
          <span aria-hidden="true">{entry.glyph}</span>
        </Button>)}
      </div>
    </div>
  </TaskFrame>;
}
