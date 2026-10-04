import { useEffect, useRef, useState } from 'react';
import { Button } from 'react-aria-components';
import type { Copy } from '../../../../i18n';
import { playPadTone, unlockAudio } from '../../../../sound';
import TaskFrame from '../TaskFrame';
import type { TaskGameProps } from '../types';
import games from '../games.module.css';
import ui from '../../../../styles/ui.module.css';
import styles from './simon.module.css';

// Classic Simon colours, each with its own shape so colour is never the only cue.
const PADS = [{ colour: 'green', shape: '▲' }, { colour: 'red', shape: '●' }, { colour: 'yellow', shape: '■' }, { colour: 'blue', shape: '◆' }] as const;
const SIMON_STEP = 650;
type SimonPhase = 'ready' | 'showing' | 'input' | 'done';

// Simon says: watch the pads light up, then repeat them. Each round adds one more pad
// until the whole sequence is repeated. A mistake replays the same round.
export default function SimonGame({ puzzle, t, disabled, solved, rejected, onSubmit }: TaskGameProps<'simon'>) {
  const { sequence } = puzzle;
  const [phase, setPhase] = useState<SimonPhase>('ready');
  const [stage, setStage] = useState(1);
  const [entered, setEntered] = useState(0);
  const [lit, setLit] = useState<number | null>(null);
  const [wrong, setWrong] = useState(false);
  const colour = (pad: number) => t[`colour_${PADS[pad].colour}` as keyof Copy];
  const flash = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(flash.current), []);
  // The server turned the answer down (not expected): start again from the beginning.
  useEffect(() => { if (rejected) { setPhase('ready'); setStage(1); setEntered(0); } }, [rejected]);

  // Play the first `stage` pads, then hand over to the player.
  useEffect(() => {
    if (phase !== 'showing') return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const lead = 700;
    sequence.slice(0, stage).forEach((pad, index) => {
      timers.push(setTimeout(() => { setLit(pad); playPadTone(pad); }, lead + index * SIMON_STEP));
      timers.push(setTimeout(() => setLit(null), lead + index * SIMON_STEP + SIMON_STEP * 0.65));
    });
    timers.push(setTimeout(() => { setPhase('input'); setEntered(0); setWrong(false); }, lead + stage * SIMON_STEP));
    return () => timers.forEach(clearTimeout);
  }, [phase, stage]);

  function press(pad: number) {
    if (disabled || phase !== 'input') return;
    clearTimeout(flash.current);
    setLit(pad); playPadTone(pad, 0.2);
    flash.current = setTimeout(() => setLit(null), 220);
    if (pad !== sequence[entered]) { setWrong(true); setPhase('showing'); return; }
    if (entered + 1 < stage) { setEntered(entered + 1); return; }
    if (stage === sequence.length) { setPhase('done'); onSubmit(sequence); return; }
    setStage(stage + 1); setPhase('showing');
  }

  const status = solved || phase === 'done' ? t.simonDone
    : phase === 'ready' ? t.simonReady
    : phase === 'showing' ? `${wrong ? `${t.simonWrong} ` : ''}${t.simonWatch}${lit !== null ? `: ${colour(lit)}` : ''}`
    : `${t.simonYourTurn} ${entered} / ${stage}`;
  return <TaskFrame instructions={t.simonInstructions} error={wrong && phase === 'showing'} status={status}>
    <div className={`${games.board} ${styles.simonBoard}`} data-wrong={wrong || undefined} data-complete={solved || undefined} data-phase={phase}>
      <div className={styles.simonPads}>
        {PADS.map((pad, index) => <button key={pad.colour} type="button" className={styles.simonPad} data-pad={pad.colour}
          data-lit={lit === index || undefined} aria-label={colour(index)}
          aria-disabled={phase !== 'input' || undefined} disabled={disabled && phase !== 'done'}
          onClick={() => press(index)}><span aria-hidden="true">{pad.shape}</span></button>)}
        {phase === 'ready' && <Button className={`${ui.secondary} ${styles.simonStart}`} isDisabled={disabled} onPress={() => { unlockAudio(); setPhase('showing'); }}>
          {t.simonStart}<span aria-hidden="true">▶</span>
        </Button>}
      </div>
      <p className={styles.simonRound}>{t.simonRound} {Math.min(stage, sequence.length)} / {sequence.length}</p>
    </div>
  </TaskFrame>;
}
