import { useRef, useState } from 'react';
import type { ChangePreview, Lobby } from '../../../shared/protocol';
import { commandId, request } from '../../lib/api';
import { translations, type Language } from '../../i18n';
import styles from '../../App.module.css';
import ui from '../../styles/ui.module.css';

// Asks the server what a correction or removal would do, when the organiser has previews on.
// A newer check or clearing it discards an older answer.
export function usePreview(lobby: Lobby) {
  const [preview, setPreview] = useState<ChangePreview | 'checking' | null>(null);
  const generation = useRef(0);
  async function check(path: string, change: object) {
    const current = ++generation.current;
    if (!lobby.settings.changePreviews) { setPreview(null); return; }
    setPreview('checking');
    try {
      const result = await request<{ preview: ChangePreview }>(path, { ...change, commandId: commandId(), roundId: lobby.roundId, expectedRevision: lobby.revision });
      if (current === generation.current) setPreview(result.preview);
    } catch { if (current === generation.current) setPreview(null); }
  }
  const clear = () => { generation.current++; setPreview(null); };
  return { preview, check, clear };
}

// Says only whether the round would end or stop for confirmation, and the new task goal.
export function PreviewNote({ preview, lobby, language }: { preview: ChangePreview | 'checking' | null; lobby: Lobby; language: Language }) {
  const t = translations[language];
  if (!preview) return null;
  if (preview === 'checking') return <p className={ui.note} role="status">{t.previewChecking}</p>;
  const goal = preview.outcome === 'continues' && preview.goal !== null && preview.goal !== lobby.progress?.goal ? ` ${t.previewGoal} ${preview.goal}.` : '';
  return <p className={preview.outcome === 'continues' ? ui.note : styles.previewWarning} role="status">
    {preview.outcome === 'ends' ? t.previewEnds : preview.outcome === 'proposes' ? t.previewProposes : t.previewContinues}{goal}
  </p>;
}
