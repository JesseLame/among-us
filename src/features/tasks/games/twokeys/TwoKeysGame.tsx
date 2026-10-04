import { useEffect, useState, type FormEvent } from 'react';
import { Button, Input, Label, TextField } from 'react-aria-components';
import TaskFrame from '../TaskFrame';
import type { TaskGameProps } from '../types';
import games from '../games.module.css';
import ui from '../../../../styles/ui.module.css';
import styles from './twokeys.module.css';

// Two keys: show the pairing code to another player, who enters it under Help someone on
// their own phone and reads out the unlock code it shows. Type that code here.
export default function TwoKeysGame({ puzzle, t, disabled, solved, rejected, onSubmit }: TaskGameProps<'twokeys'>) {
  const [code, setCode] = useState('');
  const [wrong, setWrong] = useState(false);
  useEffect(() => { if (rejected) { setCode(''); setWrong(true); } }, [rejected]);

  function check(event: FormEvent) {
    event.preventDefault();
    if (disabled || code.length !== 4) return;
    setWrong(false);
    onSubmit(code);
  }

  const status = solved ? t.twoKeysDone : wrong ? t.twoKeysWrong : t.twoKeysWaiting;
  return <TaskFrame instructions={t.twoKeysInstructions} error={wrong && !solved} status={status}>
    <div className={`${games.board} ${styles.keysBoard}`} data-complete={solved || undefined}>
      <p className={styles.pair}>
        <small>{t.twoKeysPairLabel}</small>
        <span aria-label={puzzle.pair.split('').join(' ')}>{puzzle.pair}</span>
      </p>
      <form className={styles.unlock} onSubmit={check}>
        <TextField className={ui.field} value={code} onChange={value => setCode(value.replace(/\D/g, '').slice(0, 4))}
          isDisabled={disabled || solved} inputMode="numeric" autoComplete="off">
          <Label>{t.twoKeysUnlockLabel}</Label>
          <Input/>
        </TextField>
        <Button type="submit" className={ui.primary} isDisabled={disabled || solved || code.length !== 4}>{t.checkCode}</Button>
      </form>
    </div>
  </TaskFrame>;
}
