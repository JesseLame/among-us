import { useRef, useState } from 'react';
import { Switch } from 'react-aria-components';
import type { ErrorCode, Lobby, SettingsCommand } from '../shared/protocol';
import { codeFor, commandId, request } from './api';
import { errorMessages, translations, type Language } from './i18n';
import styles from './App.module.css';
import ui from './styles/ui.module.css';

type Props = { lobby: Lobby; language: Language; connected: boolean; onUpdate: (lobby: Lobby) => void };
type Change = Omit<SettingsCommand, 'commandId' | 'expectedRevision' | 'roundId'>;

// Organiser switches for how much the app handles. They apply immediately on every phone.
export default function GameSettings({ lobby, language, connected, onUpdate }: Props) {
  const t = translations[language];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const inFlight = useRef(false);

  async function change(settings: Change) {
    if (inFlight.current || !connected) return;
    inFlight.current = true; setBusy(true); setError(null);
    const input: SettingsCommand = { commandId: commandId(), expectedRevision: lobby.revision, roundId: lobby.roundId, ...settings };
    try {
      const result = await request('/api/settings/commands', input);
      if (result.lobby) onUpdate(result.lobby);
    } catch (failure) { setError(codeFor(failure)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  const { stationAccess, eliminations, bodyReports, emergencyMeetings } = lobby.settings;
  const setting = (label: string, selected: boolean, help: string, onChange: (selected: boolean) => void) => <div className={styles.setting}>
    <Switch className={ui.switch} isSelected={selected} isDisabled={busy || !connected} onChange={onChange}>
      <span className={ui.switchTrack} aria-hidden="true"><span/></span>{label}
    </Switch>
    <p className={ui.note}>{help}</p>
  </div>;
  return <>
    {setting(t.manualAccess, stationAccess === 'manual', stationAccess === 'manual' ? t.manualAccessOn : t.manualAccessOff,
      manual => void change({ stationAccess: manual ? 'manual' : 'qr' }))}
    {setting(t.eliminationsSetting, eliminations, eliminations ? t.eliminationsOn : t.eliminationsOffHelp,
      on => void change({ eliminations: on }))}
    {setting(t.bodyReportsSetting, bodyReports, bodyReports ? t.bodyReportsOn : t.bodyReportsOff, on => void change({ bodyReports: on }))}
    {setting(t.emergencySetting, emergencyMeetings, emergencyMeetings ? t.emergencyOn : t.emergencyOff, on => void change({ emergencyMeetings: on }))}
    {error && <p className={ui.error} role="alert">{errorMessages[language][error]}</p>}
  </>;
}
