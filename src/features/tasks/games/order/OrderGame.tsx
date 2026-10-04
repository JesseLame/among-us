import { useState } from 'react';
import { useFlash } from '../../../../lib/useFlash';
import TaskFrame from '../TaskFrame';
import type { TaskGameProps } from '../types';
import games from '../games.module.css';
import styles from './order.module.css';

type Point = { x: number; y: number };

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

// Switch the lights on from the lowest number to the highest.
export default function OrderGame({ puzzle, t, disabled, solved, onSubmit }: TaskGameProps<'order'>) {
  const [tapped, setTapped] = useState<number[]>([]);
  const [wrong, flashWrong, clearWrong] = useFlash<true>(500);
  const sorted = [...puzzle.numbers].sort((a, b) => a - b);
  const positions = lightPositions(puzzle.numbers);
  const at = (value: number) => positions[puzzle.numbers.indexOf(value)];
  function tap(value: number) {
    if (value !== sorted[tapped.length]) { setTapped([]); flashWrong(true); return; }
    const next = [...tapped, value];
    setTapped(next); clearWrong();
    if (next.length === sorted.length) onSubmit(next);
  }
  return <TaskFrame instructions={t.orderInstructions} error={Boolean(wrong)} status={wrong ? t.orderWrong : `${tapped.length} / ${sorted.length}`}>
    <div className={`${games.board} ${styles.lightBoard}`} data-wrong={wrong || undefined} data-complete={solved || tapped.length === sorted.length || undefined}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={tapped.map(value => `${at(value).x},${at(value).y}`).join(' ')}/>
      </svg>
      {puzzle.numbers.map((value, index) => <button key={value} type="button" className={styles.light}
        style={{ left: `${positions[index].x}%`, top: `${positions[index].y}%` }}
        data-lit={tapped.includes(value) || undefined} aria-pressed={tapped.includes(value)}
        disabled={disabled || tapped.includes(value)} onClick={() => tap(value)}>{value}</button>)}
    </div>
  </TaskFrame>;
}
