import { useState } from 'react';
import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import type { Correction, ErrorCode, HistoryEntry, Lobby } from '../../../shared/protocol';
import { codeFor, commandId, request } from '../../lib/api';
import { errorMessages, translations, type Language } from '../../i18n';
import { PreviewNote, usePreview } from '../lobby/Preview';
import styles from '../../App.module.css';
import ui from '../../styles/ui.module.css';

type Props = { lobby: Lobby; language: Language; connected: boolean; onUpdate: (lobby: Lobby) => void };
type Change = Correction extends infer C ? C extends Correction ? Omit<C, 'commandId' | 'roundId' | 'expectedRevision'> : never : never;

// Organiser fixes during a round. Lists show every station and player alike, so nothing
// here reveals roles, bodies or whose tasks are real. With the matching settings on, each
// confirmation previews its effect and the change history allows undoing the latest fix.
export default function Corrections({ lobby, language, connected, onUpdate }: Props) {
  const t = translations[language];
  const [expanded, setExpanded] = useState(false);
  const [stationId, setStationId] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [targetId, setTargetId] = useState('');
  const { preview, check, clear } = usePreview(lobby);
  const [confirm, setConfirm] = useState<{ change: Change; title: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [done, setDone] = useState(false);
  const players = lobby.players.filter(player => player.playing && !player.removed);
  const station = lobby.stations.find(entry => entry.id === stationId);
  const player = players.find(entry => entry.id === playerId);

  async function apply() {
    if (!confirm || busy || !connected || !lobby.roundId) return;
    setBusy(true); setError(null);
    try {
      const result = await request('/api/corrections', { ...confirm.change, commandId: commandId(), roundId: lobby.roundId, expectedRevision: lobby.revision });
      if (result.lobby) onUpdate(result.lobby);
      setConfirm(null); clear(); setDone(true);
    } catch (failure) { setError(codeFor(failure)); }
    finally { setBusy(false); }
  }
  const ask = (change: Change, title: string, text: string) => {
    setError(null); setDone(false); setConfirm({ change, title, text });
    void check('/api/corrections/preview', change);
  };
  const close = () => { setConfirm(null); clear(); };
  const describe = (entry: HistoryEntry) => {
    switch (entry.action) {
      case 'creditStation': return `${t.historyCredit} ${entry.station}`;
      case 'removeStationTasks': return `${t.historyRemove} ${entry.station}`;
      case 'replaceStationTasks': return `${t.historyReplace} ${entry.station}${entry.target ? ` → ${entry.target}` : ''}`;
      case 'setStatus': return `${entry.player}: ${entry.status === 'alive' ? t.markAlive : t.markOut}`;
      case 'restoreEmergency': return t.restoreEmergency;
      case 'removePlayer': return `${t.historyRemovedPlayer} ${entry.player}`;
    }
  };
  const time = (at: number) => new Date(at).toLocaleTimeString(language === 'nl' ? 'nl-NL' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
  const disabled = busy || !connected;

  return <details className={styles.roomControls} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>{t.fixProblem}</summary>
    {expanded && <div className={styles.corrections}>
      <p className={ui.note}>{t.fixProblemHelp}</p>
      {done && <p className={ui.note} role="status">{t.correctionApplied}</p>}

      <section aria-labelledby="fix-station">
        <h3 id="fix-station">{t.fixStation}</h3>
        <div className={styles.selectField}>
          <label htmlFor="fix-station-select">{t.chooseStation}</label>
          <select id="fix-station-select" value={stationId} onChange={event => setStationId(event.target.value)}>
            <option value="">—</option>
            {lobby.stations.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
        </div>
        <div className={styles.correctionActions}>
          <Button className={ui.secondary} isDisabled={disabled || !station} onPress={() => ask({ action: 'creditStation', stationId }, `${t.creditStation}: ${station?.name}?`, t.creditStationText)}>{t.creditStation}</Button>
          <Button className={ui.secondary} isDisabled={disabled || !station} onPress={() => ask({ action: 'removeStationTasks', stationId }, `${t.removeStationTasks}: ${station?.name}?`, t.removeStationTasksText)}>{t.removeStationTasks}</Button>
        </div>
        <div className={styles.selectField}>
          <label htmlFor="fix-target-select">{t.replaceTarget}</label>
          <select id="fix-target-select" value={targetId} onChange={event => setTargetId(event.target.value)}>
            <option value="">{t.replaceSpread}</option>
            {lobby.stations.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
        </div>
        <Button className={ui.secondary} isDisabled={disabled || !station} onPress={() => ask({ action: 'replaceStationTasks', stationId, targetStationId: targetId || null },
          `${t.replaceStationTasks}: ${station?.name}?`, t.replaceStationTasksText)}>{t.replaceStationTasks}</Button>
      </section>

      <section aria-labelledby="fix-player">
        <h3 id="fix-player">{t.fixPlayer}</h3>
        <div className={styles.selectField}>
          <label htmlFor="fix-player-select">{t.choosePlayer}</label>
          <select id="fix-player-select" value={playerId} onChange={event => setPlayerId(event.target.value)}>
            <option value="">—</option>
            {players.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
        </div>
        <div className={styles.correctionActions}>
          <Button className={ui.secondary} isDisabled={disabled || !player} onPress={() => ask({ action: 'setStatus', playerId, status: 'alive' }, `${player?.name}: ${t.markAlive}?`, t.markAliveText)}>{t.markAlive}</Button>
          <Button className={ui.secondary} isDisabled={disabled || !player} onPress={() => ask({ action: 'setStatus', playerId, status: 'ghost' }, `${player?.name}: ${t.markOut}?`, t.markOutText)}>{t.markOut}</Button>
        </div>
      </section>

      <section aria-labelledby="fix-emergency">
        <h3 id="fix-emergency">{t.emergencySetting}</h3>
        <Button className={ui.secondary} isDisabled={disabled} onPress={() => ask({ action: 'restoreEmergency' }, `${t.restoreEmergency}?`, t.restoreEmergencyText)}>{t.restoreEmergency}</Button>
      </section>

      {lobby.history && <section aria-labelledby="fix-history">
        <h3 id="fix-history">{t.historyTitle}</h3>
        {lobby.history.length ? <ol className={styles.history}>
          {lobby.history.map(entry => <li key={entry.id} data-undone={entry.undone || undefined}>
            <time dateTime={new Date(entry.at).toISOString()}>{time(entry.at)}</time>
            <span>{describe(entry)}</span>
            {entry.undone && <small>{t.undone}</small>}
            {entry.canUndo && <Button className={ui.secondary} isDisabled={disabled} aria-label={`${t.undo}: ${describe(entry)}`}
              onPress={() => ask({ action: 'undo', changeId: entry.id }, t.undoTitle, `${describe(entry)}. ${t.undoText}`)}>{t.undo}</Button>}
          </li>)}
        </ol> : <p className={ui.note}>{t.historyEmpty}</p>}
      </section>}
    </div>}
    <ModalOverlay className={ui.modalOverlay} isOpen={Boolean(confirm)} onOpenChange={open => { if (!open && !busy) close(); }} isDismissable={!busy}>
      <Modal className={ui.modal}>
        <Dialog aria-describedby="correction-description">
          <Heading slot="title">{confirm?.title}</Heading>
          <p id="correction-description">{confirm?.text}</p>
          <PreviewNote preview={preview} lobby={lobby} language={language}/>
          {error && <p className={ui.error} role="alert">{errorMessages[language][error]}</p>}
          <div className={ui.dialogActions}>
            <Button className={ui.secondary} autoFocus isDisabled={busy} onPress={close}>{t.cancel}</Button>
            <Button className={ui.primary} isDisabled={disabled} onPress={() => void apply()}>{busy ? t.working : t.applyCorrection}</Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  </details>;
}
