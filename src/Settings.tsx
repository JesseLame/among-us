import { useEffect, useRef, useState } from 'react';
import { Button, Group, Input, Label, NumberField, Switch, Text } from 'react-aria-components';
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
    if (!connected) return;
    if (inFlight.current) { setTimeout(() => void change(settings), 300); return; }
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
  // Number fields save shortly after the last change, so tapping + several times sends one update.
  type NumberKey = 'openingProtection' | 'killCooldown' | 'discussionTime' | 'emergencyAllowance' | 'tasksPerPlayer' | 'taskGoalPercent' | 'progressInterval';
  const [draft, setDraft] = useState<Partial<Record<NumberKey, number>>>({});
  // Always save with the latest room revision, not the one from when the timer started.
  const latestChange = useRef(change);
  latestChange.current = change;
  useEffect(() => {
    if (!Object.keys(draft).length) return;
    const timer = setTimeout(() => { void latestChange.current(draft).then(() => setDraft({})); }, 600);
    return () => clearTimeout(timer);
  }, [draft]);
  const inLobby = lobby.phase === 'lobby';
  const number = (key: NumberKey, label: string, help: string, min: number, max: number, step: number, lobbyOnly = false) =>
    <NumberField className={ui.numberField} value={draft[key] ?? lobby.settings[key]} minValue={min} maxValue={max} step={step}
      isDisabled={!connected || (lobbyOnly && !inLobby)} onChange={value => { if (!Number.isNaN(value)) setDraft(current => ({ ...current, [key]: value })); }}>
      <Label>{label}</Label>
      <Group><Button slot="decrement">−</Button><Input/><Button slot="increment">+</Button></Group>
      <Text slot="description">{help}</Text>
    </NumberField>;

  return <>
    {setting(t.manualAccess, stationAccess === 'manual', stationAccess === 'manual' ? t.manualAccessOn : t.manualAccessOff,
      manual => void change({ stationAccess: manual ? 'manual' : 'qr' }))}
    {setting(t.eliminationsSetting, eliminations, eliminations ? t.eliminationsOn : t.eliminationsOffHelp,
      on => void change({ eliminations: on }))}
    {setting(t.bodyReportsSetting, bodyReports, bodyReports ? t.bodyReportsOn : t.bodyReportsOff, on => void change({ bodyReports: on }))}
    {setting(t.emergencySetting, emergencyMeetings, emergencyMeetings ? t.emergencyOn : t.emergencyOff, on => void change({ emergencyMeetings: on }))}
    <details className={styles.gameSettings}>
      <summary>{t.gameSettings}</summary>
      <p className={ui.note}>{t.gameSettingsHelp}</p>
      {number('openingProtection', t.settingOpening, t.settingOpeningHelp, 0, 600, 5)}
      {number('killCooldown', t.settingCooldown, t.settingCooldownHelp, 0, 600, 5)}
      {number('discussionTime', t.settingDiscussion, t.settingDiscussionHelp, 0, 600, 15)}
      {number('emergencyAllowance', t.settingEmergency, t.settingEmergencyHelp, 0, 5, 1)}
      {number('tasksPerPlayer', t.settingTasks, t.settingNextRoundHelp, 1, 8, 1, true)}
      {number('taskGoalPercent', t.settingGoal, t.settingNextRoundHelp, 10, 100, 5, true)}
      {number('progressInterval', t.settingProgress, t.settingProgressHelp, 5, 300, 5)}
    </details>
    {error && <p className={ui.error} role="alert">{errorMessages[language][error]}</p>}
  </>;
}
