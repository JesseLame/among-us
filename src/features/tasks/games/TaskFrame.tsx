import type { ReactNode } from 'react';
import ui from '../../../styles/ui.module.css';

// What every task game shares around its board: instructions above, a live status line below.
export default function TaskFrame({ instructions, status, error = false, children }: { instructions: string; status?: ReactNode; error?: boolean; children: ReactNode }) {
  return <>
    <p>{instructions}</p>
    {children}
    {status !== undefined && <p className={error ? ui.error : ui.note} role="status">{status}</p>}
  </>;
}
