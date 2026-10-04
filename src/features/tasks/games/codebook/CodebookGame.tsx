import { useEffect, useState } from 'react';
import { symbolGlyphs } from '../../../../../shared/protocol';
import type { Copy } from '../../../../i18n';
import { useFlash } from '../../../../lib/useFlash';
import TaskFrame from '../TaskFrame';
import type { TaskGameProps } from '../types';
import games from '../games.module.css';
import styles from './codebook.module.css';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'enter'] as const;

// A safe: each symbol has a slot on the display, filled from the keypad (or a keyboard).
// The digits come from the station's printed codebook, so a wrong code is only known
// once the server checks it.
export default function CodebookGame({ puzzle, t, disabled, solved, rejected, onSubmit }: TaskGameProps<'codebook'>) {
  const [code, setCode] = useState('');
  const [shake, flashShake] = useFlash<true>(600);
  const length = puzzle.symbols.length;
  useEffect(() => {
    if (!rejected) return;
    setCode(''); flashShake(true);
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
  // The safe's own display is the status line.
  return <TaskFrame instructions={t.codebookInstructions}>
    <div className={`${games.board} ${styles.safe}`} data-wrong={shake || undefined} data-complete={solved || undefined}>
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
  </TaskFrame>;
}
