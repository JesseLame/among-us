import { useEffect, useRef, useState } from 'react';
import { Button, Input, Label, TextField } from 'react-aria-components';
import { stationName, type ErrorCode, type Lobby, type StationCommand } from '../../../shared/protocol';
import { codeFor, commandId, request } from '../../lib/api';
import { errorMessages, translations, type Language } from '../../i18n';
import shared from '../../App.module.css';
import styles from './lobby.module.css';
import ui from '../../styles/ui.module.css';

type Props = { lobby: Lobby; language: Language; connected: boolean; onUpdate: (lobby: Lobby) => void };
type Change = { action: 'add'; name: string } | { action: 'remove'; stationId: string };

// Organiser-only lobby setup for the rooms that hold task stations.
export default function Stations({ lobby, language, connected, onUpdate }: Props) {
  const t = translations[language];
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const inFlight = useRef(false);
  // Keep a command's ID after an ambiguous network failure so a retry applies once.
  const pending = useRef<StationCommand | null>(null);
  useEffect(() => { pending.current = null; }, [lobby.revision]);

  async function change(next: Change) {
    if (inFlight.current || !connected) return;
    if (next.action === 'add' && !stationName.safeParse(next.name).success) { setError('INVALID_INPUT'); return; }
    inFlight.current = true; setBusy(true); setError(null);
    const previous = pending.current;
    const same = previous?.action === next.action && (next.action === 'add'
      ? previous.action === 'add' && previous.name === next.name.trim()
      : previous.action === 'remove' && previous.stationId === next.stationId);
    const input: StationCommand = same && previous ? previous
      : next.action === 'add' ? { ...next, name: next.name.trim(), commandId: commandId(), expectedRevision: lobby.revision, roundId: lobby.roundId }
      : { ...next, commandId: commandId(), expectedRevision: lobby.revision, roundId: lobby.roundId };
    pending.current = input;
    try {
      const result = await request('/api/stations/commands', input);
      pending.current = null;
      if (result.lobby) onUpdate(result.lobby);
      if (next.action === 'add') setName('');
    } catch (failure) {
      const code = codeFor(failure);
      setError(code);
      if (code !== 'CONNECTION_ERROR') pending.current = null;
    } finally { inFlight.current = false; setBusy(false); }
  }

  const disabled = busy || !connected;
  return <section className={styles.stations} aria-labelledby="stations-title">
    <h3 id="stations-title">{t.stations}</h3>
    <p className={ui.note}>{t.stationsHelp}</p>
    <ul className={`${shared.managePlayers} ${styles.managePlayers}`}>
      {lobby.stations.map(station => <li key={station.id}>
        <span>{station.name}</span>
        <Button className={ui.removeButton} isDisabled={disabled} aria-label={`${t.removeStation} ${station.name}`}
          onPress={() => void change({ action: 'remove', stationId: station.id })}>{t.removeStation}</Button>
      </li>)}
    </ul>
    {lobby.stations.length < 8 && <form className={styles.addStation} noValidate onSubmit={event => { event.preventDefault(); void change({ action: 'add', name }); }}>
      <TextField className={ui.field} value={name} onChange={setName} maxLength={24} autoComplete="off">
        <Label>{t.stationName}</Label><Input placeholder={t.stationPlaceholder}/>
      </TextField>
      <Button type="submit" className={ui.secondary} isDisabled={disabled}>{t.addStation}</Button>
    </form>}
    {error && <p className={ui.error} role="alert">{error === 'INVALID_INPUT' ? t.stationNameInvalid : errorMessages[language][error]}</p>}
  </section>;
}
