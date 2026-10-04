import { useState, type FormEvent } from 'react';
import { Button, Input, Label, TextField } from 'react-aria-components';
import type { ErrorCode } from '../../../shared/protocol';
import { codeFor } from '../../lib/api';
import { errorMessages, translations, type Language } from '../../i18n';
import styles from './tasks.module.css';
import ui from '../../styles/ui.module.css';

type Props = { language: Language; disabled?: boolean; lookUp: (code: string) => Promise<{ unlock: string }> };

// Help someone with a two-keys task: enter the pairing code on their screen, then read out
// the unlock code shown here. Used during a round and on the practice page.
export default function HelpPanel({ language, disabled = false, lookUp }: Props) {
  const t = translations[language];
  const [code, setCode] = useState('');
  const [unlock, setUnlock] = useState<string | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [busy, setBusy] = useState(false);

  async function show(event: FormEvent) {
    event.preventDefault();
    if (busy || disabled || code.length !== 3) return;
    setBusy(true); setError(null);
    try { setUnlock((await lookUp(code)).unlock); }
    catch (failure) { setError(codeFor(failure)); }
    finally { setBusy(false); }
  }

  if (unlock) return <div className={styles.help}>
    <p className={styles.unlockCode}><small>{t.helpUnlockLabel}</small><span aria-label={unlock.split('').join(' ')}>{unlock}</span></p>
    <p className={ui.note} role="status">{t.helpReadOut}</p>
    <Button className={ui.secondary} onPress={() => { setUnlock(null); setCode(''); }}>{t.helpAnother}</Button>
  </div>;
  return <form className={styles.help} onSubmit={show}>
    <p className={ui.note}>{t.helpIntro}</p>
    <TextField className={ui.field} value={code} onChange={value => setCode(value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3))}
      isDisabled={disabled} autoComplete="off">
      <Label>{t.helpCodeLabel}</Label>
      <Input autoCapitalize="characters" spellCheck={false}/>
    </TextField>
    <Button type="submit" className={ui.primary} isDisabled={busy || disabled || code.length !== 3}>{t.helpShow}</Button>
    {error && <p className={ui.error} role="alert">{errorMessages[language][error]}</p>}
  </form>;
}
