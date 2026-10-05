import type { FC } from 'react';
import type { ThemeId } from '.';
import type { Copy } from '../i18n';
import { useTheme } from './context';
import { classicArt } from './classic';
import { spaceArt } from './space/art';

// Decorative pieces a theme may redraw. A theme that leaves a slot out shows the classic art.
// Art is decoration only: keep it hidden from assistive technology or keep the same label,
// and never let it depend on hidden game state.
export type ThemeArt = {
  BrandMark: FC;
  HomeMap: FC<{ t: Copy }>;
  Avatar: FC<{ color: number; initial: string }>;
  RoleSymbol: FC<{ symbol: string }>;
  RoleCardDecor: FC;
  MeetingBanner: FC;
};

const art: Record<ThemeId, Partial<ThemeArt>> = {
  classic: classicArt,
  space: spaceArt,
};

function useArt<Slot extends keyof ThemeArt>(slot: Slot): ThemeArt[Slot] {
  return art[useTheme()][slot] ?? classicArt[slot];
}

export function BrandMark() { const Art = useArt('BrandMark'); return <Art/>; }
export function HomeMap(props: { t: Copy }) { const Art = useArt('HomeMap'); return <Art {...props}/>; }
export function Avatar(props: { color: number; initial: string }) { const Art = useArt('Avatar'); return <Art {...props}/>; }
export function RoleSymbol(props: { symbol: string }) { const Art = useArt('RoleSymbol'); return <Art {...props}/>; }
export function RoleCardDecor() { const Art = useArt('RoleCardDecor'); return <Art/>; }
export function MeetingBanner() { const Art = useArt('MeetingBanner'); return <Art/>; }
