import { Radio, RadioGroup } from 'react-aria-components';
import { themeMeta, themes, type ThemeId } from '.';
import type { Copy } from '../i18n';
import ui from '../styles/ui.module.css';

// Each option previews the theme with its own colours, because the swatch carries data-theme.
export default function ThemeControl({ t, value, onChange }: { t: Copy; value: ThemeId; onChange: (theme: ThemeId) => void }) {
  return <RadioGroup className={ui.languages} aria-label={t.theme} value={value} onChange={next => onChange(next as ThemeId)} orientation="horizontal">
    {themes.map(id => <Radio key={id} value={id} aria-label={t[themeMeta[id].name]}>
      <span className={ui.swatch} data-theme={id} title={t[themeMeta[id].name]}/>
    </Radio>)}
  </RadioGroup>;
}
