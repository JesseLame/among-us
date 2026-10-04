import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from 'react-aria-components';
import { symbolGlyphs, symbols, taskKinds, type CompleteTask, type ErrorCode, type PracticePuzzle, type TaskKind } from '../shared/protocol';
import { codeFor, request } from './api';
import { kindLabel, PuzzleView } from './Tasks';
import { errorMessages, translations, type Language } from './i18n';
import styles from './App.module.css';
import ui from './styles/ui.module.css';

type Copy = typeof translations.en;
const kindFromUrl = (): TaskKind => {
  const game = new URLSearchParams(location.search).get('game');
  return taskKinds.includes(game as TaskKind) ? game as TaskKind : taskKinds[0];
};

// /practice: try every task game on any phone, without a room or round. Puzzles come from
// and are checked by the server, exactly like real tasks; nothing here affects a game.
export default function Practice({ language, languageControl }: { language: Language; languageControl: ReactNode }) {
  const t = translations[language];
  const [kind, setKind] = useState<TaskKind>(kindFromUrl);
  const [current, setCurrent] = useState<PracticePuzzle | null>(null);
  const [busy, setBusy] = useState(false);
  const [solved, setSolved] = useState(false);
  const [rejected, setRejected] = useState(0);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [count, setCount] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const generation = useRef(0);

  async function load(next: TaskKind) {
    const mine = ++generation.current;
    setCurrent(null); setSolved(false); setError(null); setRejected(0);
    try {
      const result = await request<PracticePuzzle>(`/api/practice/${next}`);
      if (mine === generation.current) setCurrent(result);
    } catch (failure) { if (mine === generation.current) setError(codeFor(failure)); }
  }
  useEffect(() => { void load(kind); }, [kind]);

  function choose(next: TaskKind) {
    const params = new URLSearchParams(location.search);
    params.set('game', next);
    window.history.replaceState(null, '', `${location.pathname}?${params}`);
    setKind(next);
    heading.current?.focus();
  }
  async function submit(answer: CompleteTask['answer']) {
    if (!current || busy) return;
    setBusy(true); setError(null);
    try {
      await request('/api/practice/check', { id: current.id, answer });
      setSolved(true); setCount(value => value + 1);
    } catch (failure) {
      const code = codeFor(failure);
      setError(code);
      if (code === 'WRONG_ANSWER') setRejected(value => value + 1);
    } finally { setBusy(false); }
  }

  return <>
    <header className={styles.header}>
      <a className={styles.brand} href="/" aria-label={`Among Us ${t.home}`}><span className={styles.brandMark} aria-hidden="true">⌂</span><span>AMONG US <em>{t.home}</em></span></a>
      {languageControl}
    </header>
    <main className={styles.practice}>
      <div className={styles.practiceIntro}>
        <p className={styles.eyebrow}>{t.practiceEyebrow}</p>
        <h1>{t.practiceTitle}</h1>
        <p className={ui.note}>{t.practiceIntro}</p>
      </div>
      <nav aria-label={t.practiceGames}>
        <ul className={styles.practiceGames}>
          {taskKinds.map(option => <li key={option}>
            <button type="button" aria-pressed={option === kind} onClick={() => choose(option)}>{kindLabel(t, option)}</button>
          </li>)}
        </ul>
      </nav>
      <section className={`${ui.card} ${styles.taskCard}`} aria-labelledby="practice-title">
        <p className={styles.eyebrow}>{t.practiceEyebrow}{count > 0 && ` · ${t.practiceSolvedCount} ${count}`}</p>
        <h2 id="practice-title" ref={heading} tabIndex={-1}>{kindLabel(t, kind)}</h2>
        {current
          ? <PuzzleView key={current.id} puzzle={current.puzzle} t={t} disabled={busy || solved} solved={solved} rejected={rejected} onSubmit={answer => void submit(answer)}/>
          : !error && <p className={ui.note} role="status">{t.loading}</p>}
        {current?.codebook && <PracticeSheet book={current.codebook} t={t}/>}
        {solved && <p className={ui.note} role="status">{t.practiceSolved}</p>}
        {error && <p className={ui.error} role="alert">{error === 'WRONG_ANSWER' ? t.practiceWrong : errorMessages[language][error]}</p>}
        <Button className={solved ? ui.primary : ui.secondary} isDisabled={busy} onPress={() => void load(kind)}>
          {solved ? t.practiceNext : t.practiceNew}<span aria-hidden="true">↻</span>
        </Button>
      </section>
    </main>
  </>;
}

// Stands in for the printed station sheet, so codebook tasks work without printing.
function PracticeSheet({ book, t }: { book: Record<string, number>; t: Copy }) {
  return <details className={styles.practiceSheet}>
    <summary>{t.practiceSheet}</summary>
    <dl className={styles.codebook}>
      {symbols.map(symbol => <div key={symbol}>
        <dt><span aria-hidden="true">{symbolGlyphs[symbol]}</span><small>{t[`symbol_${symbol}` as keyof Copy]}</small></dt>
        <dd>{book[symbol]}</dd>
      </div>)}
    </dl>
  </details>;
}
