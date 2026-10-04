import { useEffect, useState, type ReactNode } from 'react';
import { Button } from 'react-aria-components';
import { PhoneAddressNote, QrCode, usableOrigin, usePhoneOrigin } from '../../components/Qr';
import { symbolGlyphs, symbols, type ErrorCode, type Lobby, type PrintableStation } from '../../../shared/protocol';
import { codeFor, request } from '../../lib/api';
import { errorMessages, translations, type Language, type Copy } from '../../i18n';
import shared from '../../App.module.css';
import styles from './print.module.css';
import ui from '../../styles/ui.module.css';

type Documents = { join: boolean; stations: boolean; markers: boolean };

// Organiser-only print materials: join poster, one sheet per station (QR code and
// codebook), and cut-out body/ghost markers. Print, or save as PDF from the dialog.
export default function PrintSheets({ language, languageControl }: { language: Language; languageControl: ReactNode }) {
  const t = translations[language];
  const [stations, setStations] = useState<PrintableStation[] | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<ErrorCode | null>(null);
  const [documents, setDocuments] = useState<Documents>({ join: true, stations: true, markers: true });
  const originState = usePhoneOrigin('print');
  const origin = usableOrigin(originState);
  useEffect(() => {
    request<{ stations: PrintableStation[]; lanAddresses: string[] }>('/api/stations/print')
      .then(result => setStations(result.stations))
      .catch(failure => setError(codeFor(failure)));
    request<{ lobby: Lobby | null }>('/api/session').then(result => setCode(result.lobby?.code ?? '')).catch(() => undefined);
  }, []);
  const choice = (key: keyof Documents, label: string) => <label>
    <input type="checkbox" checked={documents[key]} onChange={event => setDocuments(current => ({ ...current, [key]: event.target.checked }))}/>{label}
  </label>;
  const nothing = !Object.values(documents).some(Boolean);

  return <main className={styles.print}>
    <header className={styles.printHeader}>
      <h1>{t.printTitle}</h1>
      <p className={ui.note}>{t.printIntro}</p>
      <PhoneAddressNote origin={originState} usesAddress={t.qrUsesAddress} noNetwork={t.qrNoNetwork} lookupFailed={t.qrLookupFailed}/>
      <fieldset className={styles.printChoices}>
        <legend>{t.printChoose}</legend>
        {choice('join', t.docJoin)}
        {choice('stations', t.docStations)}
        {choice('markers', t.docMarkers)}
      </fieldset>
      <div className={styles.printActions}>
        <Button className={ui.primary} isDisabled={!stations || !origin || nothing} onPress={() => window.print()}>{t.printButton}<span aria-hidden="true">⎙</span></Button>
        <a className={ui.secondary} href="/">{t.backToGame}</a>
        {languageControl}
      </div>
      {error && <p className={ui.error} role="alert">{errorMessages[language][error]}</p>}
    </header>

    {documents.join && code && origin && <section className={`${styles.sheet} ${styles.joinPoster}`} aria-labelledby="join-poster">
      <p className={shared.eyebrow}>AMONG US · {t.home}</p>
      <h2 id="join-poster">{t.joinPosterTitle}</h2>
      <QrCode className={styles.qr} value={`${origin}/?code=${code}`} label={t.joinPosterTitle}/>
      <p>{t.joinPosterScan}</p>
      <p className={styles.joinCode}>{code}</p>
      <p className={ui.note}>{t.joinPosterOr} <strong>{origin}</strong></p>
    </section>}

    {documents.stations && origin && stations?.map(station => <StationSheet key={station.id} station={station} origin={origin} t={t}/>)}

    {documents.markers && <section className={`${styles.sheet} ${styles.markerSheet}`} aria-labelledby="markers-title">
      <h2 id="markers-title">{t.docMarkers}</h2>
      <p className={ui.note}>{t.markersCut}</p>
      <div className={styles.markers}>
        {(['body', 'body', 'body', 'body', 'ghost', 'ghost', 'ghost', 'ghost'] as const).map((kind, index) => <div key={index} data-marker={kind}>
          <span aria-hidden="true">{kind === 'body' ? '✕' : '☁︎'}</span>
          <strong>{kind === 'body' ? t.markerBody : t.markerGhost}</strong>
          <small>{kind === 'body' ? t.markerBodyText : t.markerGhostText}</small>
        </div>)}
      </div>
    </section>}
  </main>;
}

function StationSheet({ station, origin, t }: { station: PrintableStation; origin: string; t: Copy }) {
  return <section className={styles.sheet} aria-labelledby={`sheet-${station.id}`}>
    <div className={styles.sheetTop}>
      <div>
        <p className={shared.eyebrow}>{t.sheetLabel}</p>
        <h2 id={`sheet-${station.id}`}>{station.name}</h2>
        <p>{t.sheetScan}</p>
      </div>
      <QrCode className={styles.qr} value={`${origin}/?station=${station.id}`} label={`${t.sheetLabel}: ${station.name}`}/>
    </div>
    <p>{t.sheetHow}</p>
    <dl className={styles.codebook}>
      {symbols.map(symbol => <div key={symbol}>
        <dt><span aria-hidden="true">{symbolGlyphs[symbol]}</span><small>{t[`symbol_${symbol}` as keyof Copy]}</small></dt>
        <dd>{station.codebook[symbol]}</dd>
      </div>)}
    </dl>
  </section>;
}
