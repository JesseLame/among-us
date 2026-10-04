import { useEffect, useState } from 'react';
import { valveSides, waterFlow } from '../../../../../shared/protocol';
import TaskFrame from '../TaskFrame';
import type { TaskGameProps } from '../types';
import games from '../games.module.css';
import styles from './waterways.module.css';

// Each valve's pipe before turning: straight joins left and right, a bend joins left and up.
const PIPES = { straight: 'M0 50 H100', bend: 'M0 50 H20 Q50 50 50 20 V0' } as const;
const SIDES = ['mazeUp', 'mazeRight', 'mazeDown', 'mazeLeft'] as const;

// Open waterways: tap valves to turn them a quarter turn until water flows from the source on
// the left to the drain on the right. Water fills every valve it reaches as you go.
export default function WaterwaysGame({ puzzle, t, disabled, solved, rejected, onSubmit }: TaskGameProps<'waterways'>) {
  const { size, valves, source, drain } = puzzle;
  // Quarter turns so far, counting up, so a valve always animates clockwise.
  const [spins, setSpins] = useState(puzzle.turns);
  // The server turned the answer down (not expected): back to the starting turns.
  useEffect(() => { if (rejected) setSpins(puzzle.turns); }, [rejected]);
  const turns = spins.map(spin => spin % 4);
  const { filled, out } = waterFlow(puzzle, turns);
  const done = solved || out;

  function turn(index: number) {
    if (disabled || done) return;
    const next = spins.map((spin, other) => other === index ? spin + 1 : spin);
    setSpins(next);
    const nextTurns = next.map(spin => spin % 4);
    if (waterFlow(puzzle, nextTurns).out) onSubmit(nextTurns);
  }

  const label = (index: number) => {
    const sides = valveSides(valves[index], turns[index]);
    const open = SIDES.filter((_, side) => sides & (1 << side)).map(side => t[side].toLocaleLowerCase()).join(` ${t.and} `);
    return `${t.waterwaysValve} ${t.mazeRow} ${Math.floor(index / size) + 1}, ${t.mazeColumn} ${index % size + 1}: ${t.waterwaysOpen} ${open}${filled.has(index) ? `, ${t.waterwaysWet}` : ''}`;
  };
  const status = done ? t.waterwaysDone : `${t.waterwaysProgress} ${filled.size} / ${valves.length}`;
  return <TaskFrame instructions={t.waterwaysInstructions} status={status}>
    <div className={`${games.board} ${styles.waterBoard}`} data-complete={solved || undefined}>
      <div className={styles.grid} role="group" aria-label={t.kindWaterways} style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}>
        <span className={styles.source} style={{ top: `${(source + .5) / size * 100}%` }} data-wet={filled.size > 0 || undefined} aria-hidden="true"/>
        <span className={styles.drain} style={{ top: `${(drain + .5) / size * 100}%` }} data-wet={out || undefined} aria-hidden="true"/>
        {valves.map((shape, index) => <button key={index} type="button" className={styles.valve} data-wet={filled.has(index) || undefined}
          aria-label={label(index)} aria-disabled={done || undefined} disabled={disabled && !done} onClick={() => turn(index)}>
          <svg viewBox="0 0 100 100" aria-hidden="true" style={{ transform: `rotate(${spins[index] * 90}deg)` }}>
            <path className={styles.pipe} d={PIPES[shape]}/>
            <path className={styles.water} d={PIPES[shape]}/>
          </svg>
        </button>)}
      </div>
    </div>
  </TaskFrame>;
}
