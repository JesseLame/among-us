import { useEffect, useState, type ReactNode } from 'react';
import { Button } from 'react-aria-components';
import { symbolGlyphs, symbols, type ErrorCode, type PrintableStation } from '../shared/protocol';
import { codeFor, request } from './api';
import { errorMessages, translations, type Language } from './i18n';
import styles from './App.module.css';
import ui from './styles/ui.module.css';

// Organiser-only printable codebook sheets, one page per station.
export default function PrintSheets({ language, languageControl }: { language: Language; languageControl: ReactNode }) {
  const t = translations[language];
  const [stations, setStations] = useState<PrintableStation[] | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  useEffect(() => {
    request<{ stations: PrintableStation[] }>('/api/stations/print')
      .then(result => setStations(result.stations))
      .catch(failure => setError(codeFor(failure)));
  }, []);

  return <main className={styles.print}>
    <header className={styles.printHeader}>
      <h1>{t.printTitle}</h1>
      <p className={ui.note}>{t.printIntro}</p>
      <div className={styles.printActions}>
        <Button className={ui.primary} isDisabled={!stations?.length} onPress={() => window.print()}>{t.printButton}<span aria-hidden="true">⎙</span></Button>
        <a className={ui.secondary} href="/">{t.backToGame}</a>
        {languageControl}
      </div>
      {error && <p className={ui.error} role="alert">{errorMessages[language][error]}</p>}
    </header>
    {stations?.map(station => <section key={station.id} className={styles.sheet} aria-labelledby={`sheet-${station.id}`}>
      <p className={styles.eyebrow}>{t.sheetLabel}</p>
      <h2 id={`sheet-${station.id}`}>{station.name}</h2>
      <p>{t.sheetHow}</p>
      <dl className={styles.codebook}>
        {symbols.map(symbol => <div key={symbol}>
          <dt><span aria-hidden="true">{symbolGlyphs[symbol]}</span><small>{t[`symbol_${symbol}` as keyof typeof t]}</small></dt>
          <dd>{station.codebook[symbol]}</dd>
        </div>)}
      </dl>
    </section>)}
  </main>;
}
