import { useEffect, useRef, useState } from 'react';
import { Button } from 'react-aria-components';
import type { Cargo } from '../../../../../shared/protocol';
import type { Copy } from '../../../../i18n';
import TaskFrame from '../TaskFrame';
import type { Puzzle, TaskGameProps } from '../types';
import games from '../games.module.css';
import styles from './delivery.module.css';

const HOLD_MS = 1500;
const CARGO: Record<Cargo, string> = { fuel: '⛽', battery: '🔋', parcel: '📦', samples: '🧪', water: '💧' };
const cargoName = (t: Copy, cargo: Cargo) => t[`cargo_${cargo}` as keyof Copy];

// The task list line: what to fetch or where the cargo goes, so players know before they arrive.
export function deliverySummary(puzzle: Puzzle<'delivery'>, t: Copy, stationName: TaskGameProps['stationName']) {
  if (puzzle.object) return `${t.deliveryBring}: ${puzzle.object}`;
  const to = puzzle.to ? stationName(puzzle.to) : undefined;
  return puzzle.stage === 'pickup'
    ? `${t.deliveryLoadHere}: ${cargoName(t, puzzle.cargo)}${to ? ` → ${to}` : ''}`
    : `${t.deliveryCarrying}: ${cargoName(t, puzzle.cargo)}`;
}

// Delivery: hold the button to load the cargo here, carry it (in the app) to the other station
// and hold again to unload it there. With a real object, bring it here and hold to confirm.
export default function DeliveryGame({ puzzle, t, disabled, solved, rejected, onSubmit, stationName }: TaskGameProps<'delivery'>) {
  const { stage, object, cargo } = puzzle;
  const [held, setHeld] = useState(0);
  const [done, setDone] = useState(false);
  const start = useRef<number | null>(null);
  const frame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  // A new step (practice moves on in place) or a rejected answer starts the hold again.
  useEffect(() => { setHeld(0); setDone(false); }, [stage, rejected]);

  function tick() {
    if (start.current === null) return;
    const progress = Math.min(1, (performance.now() - start.current) / HOLD_MS);
    setHeld(progress);
    if (progress < 1) { frame.current = requestAnimationFrame(tick); return; }
    start.current = null;
    setDone(true);
    onSubmit([stage === 'pickup' ? 0 : 1]);
  }
  function press() {
    if (disabled || done) return;
    start.current = performance.now();
    frame.current = requestAnimationFrame(tick);
  }
  function release() {
    if (start.current === null) return;
    start.current = null;
    cancelAnimationFrame(frame.current);
    setHeld(0);
  }

  const to = puzzle.to ? stationName(puzzle.to) : undefined;
  const instructions = object ? t.deliveryObjectInstructions
    : stage === 'pickup' ? `${t.deliveryPickupInstructions} ${to ? `${t.deliveryTo} ${to}.` : t.deliveryToAnother}`
    : t.deliveryDropoffInstructions;
  const action = object ? t.deliveryPutDown : stage === 'pickup' ? t.deliveryLoad : t.deliveryUnload;
  const finished = solved || done;
  const status = finished ? (stage === 'pickup' ? `${t.deliveryLoaded} ${to ? `${t.deliveryTo} ${to}.` : t.deliveryToAnother}` : t.deliveryDone)
    : held > 0 ? t.deliveryKeepHolding : t.deliveryHoldHelp;
  return <TaskFrame instructions={instructions} status={status}>
    <div className={`${games.board} ${styles.deliveryBoard}`} data-complete={(solved && stage === 'dropoff') || undefined}>
      <div className={styles.cargo} data-stage={stage}>
        {object
          ? <p className={styles.object}><small>{t.deliveryObject}</small>{object}</p>
          : <><span className={styles.crate} aria-hidden="true">{CARGO[cargo]}</span><p className={styles.object}><small>{t.deliveryCargo}</small>{cargoName(t, cargo)}</p></>}
      </div>
      <Button className={styles.hold} isDisabled={disabled || finished} data-finished={finished || undefined} onPressStart={press} onPressEnd={release}
        style={{ '--held': held } as React.CSSProperties}>
        <span>{finished ? '✓' : action}</span>
      </Button>
    </div>
  </TaskFrame>;
}
