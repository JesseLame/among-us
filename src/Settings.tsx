import { useRef, useState } from 'react';
import { Switch } from 'react-aria-components';
import type { ErrorCode, Lobby, SettingsCommand } from '../shared/protocol';
import { codeFor, commandId, request } from './api';
import { errorMessages, translations, type Language } from './i18n';
import styles from './App.module.css';
import ui from './styles/ui.module.css';

type Props = { lobby: Lobby; language: Language; connected: boolean; onUpdate: (lobby: Lobby) => void };

// Organiser switch: by default tasks open only after scanning a station's QR code.
export default function StationAccessSwitch({ lobby, language, connected, onUpdate }: Props) {
  const t = translations[language];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const inFlight = useRef(false);

  async function change(manual: boolean) {
    if (inFlight.current || !connected) return;
    inFlight.current = true; setBusy(true); setError(null);
    const input: SettingsCommand = { commandId: commandId(), expectedRevision: lobby.revision, roundId: lobby.roundId, stationAccess: manual ? 'manual' : 'qr' };
    try {
      const result = await request('/api/settings/commands', input);
      if (result.lobby) onUpdate(result.lobby);
    } catch (failure) { setError(codeFor(failure)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <div className={styles.setting}>
    <Switch className={ui.switch} isSelected={lobby.settings.stationAccess === 'manual'} isDisabled={busy || !connected} onChange={manual => void change(manual)}>
      <span className={ui.switchTrack} aria-hidden="true"><span/></span>{t.manualAccess}
    </Switch>
    <p className={ui.note}>{lobby.settings.stationAccess === 'manual' ? t.manualAccessOn : t.manualAccessOff}</p>
    {error && <p className={ui.error} role="alert">{errorMessages[language][error]}</p>}
  </div>;
}
