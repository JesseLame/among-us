import type { CSSProperties } from 'react';
import type { ThemeArt } from '../art';
import styles from './space.module.css';

// Space art: crew in suits and visors, and the house drawn as a ship's deck plan.
// All drawings are original; colours come from the theme tokens.

/** A crew member in a suit. `suit` is any CSS colour, normally a token. */
function Crewmate({ suit, initial, className }: { suit: string; initial?: string; className: string }) {
  return <svg className={className} style={{ '--suit': suit } as CSSProperties} viewBox="0 0 40 44" width="40" height="44" aria-hidden="true" focusable="false">
    <rect className={styles.pack} x="2" y="16" width="9" height="16" rx="3"/>
    <path className={styles.suit} d="M9 20C9 8 14 3 21 3s13 5 13 16v18q0 4-4 4h-3q-3 0-3-3v-3h-5v3q0 3-3 3h-3q-4 0-4-4Z"/>
    <rect className={styles.visor} x="17" y="10" width="21" height="12" rx="6"/>
    {initial ? <text className={styles.initial} x="27.5" y="19.6" textAnchor="middle">{initial}</text>
      : <rect className={styles.shine} x="22" y="12.5" width="9" height="3" rx="1.5"/>}
  </svg>;
}

export const spaceArt: Partial<ThemeArt> = {
  BrandMark: () => <Crewmate className={styles.brandMark} suit="var(--color-accent)"/>,
  Avatar: ({ color, initial }) => <Crewmate className={styles.avatar} suit={`var(--color-avatar-${color + 1})`} initial={initial}/>,
  RoleSymbol: ({ symbol }) => <div className={styles.helmet} aria-hidden="true"><span className={styles.helmetVisor}>{symbol}</span></div>,
  RoleCardDecor: () => <span className={styles.corners} aria-hidden="true"/>,
  MeetingBanner: () => <div className={styles.alarm} aria-hidden="true"><span className={styles.beacon}/></div>,
  HomeMap: ({ t }) => <div className={styles.map} role="img" aria-label={`${t.spaceMapTitle} ${t.kitchen}, ${t.living}, ${t.hallway}, ${t.study}.`}>
    <span className={styles.mapLabel} aria-hidden="true">{t.spaceMapLabel}</span>
    <svg viewBox="0 0 440 226" aria-hidden="true" focusable="false">
      <rect className={styles.engine} x="6" y="62" width="20" height="26" rx="4"/>
      <rect className={styles.engine} x="6" y="134" width="20" height="26" rx="4"/>
      <rect className={styles.flame} x="0" y="68" width="6" height="14" rx="3"/>
      <rect className={styles.flame} x="0" y="140" width="6" height="14" rx="3"/>
      <path className={styles.hull} d="M42 36h276c62 0 108 42 114 75-6 33-52 75-114 75H42q-16 0-16-16V52q0-16 16-16Z"/>
      <rect className={styles.room} x="44" y="52" width="124" height="54" rx="6"/>
      <rect className={styles.room} x="44" y="114" width="124" height="56" rx="6"/>
      <rect className={styles.corridor} x="176" y="52" width="74" height="118" rx="6"/>
      <path className={styles.room} d="M258 60h60c40 0 72 24 80 51-8 27-40 51-80 51h-60Z"/>
      <path className={styles.window} d="M372 86q18 12 18 25t-18 25"/>
      <polyline className={styles.route} points="154,152 234,152 234,98 300,98"/>
      <text className={styles.roomNumber} x="56" y="70">01</text>
      <text className={styles.roomName} x="56" y="86">{t.kitchen}</text>
      <text className={styles.roomNumber} x="56" y="132">02</text>
      <text className={styles.roomName} x="56" y="148">{t.living}</text>
      <text className={styles.roomName} x="198" y="111" textAnchor="middle" transform="rotate(-90 198 111)">{t.hallway}</text>
      <text className={styles.roomNumber} x="272" y="120">03</text>
      <text className={styles.roomName} x="272" y="136">{t.study}</text>
      <g transform="translate(141 136) scale(.62)"><Crewmate className={styles.pawn} suit="var(--color-accent)"/></g>
      <text className={styles.here} x="213" y="214" textAnchor="middle">↑ {t.youAreHere}</text>
    </svg>
    <p aria-hidden="true">{t.spaceMapCaption}</p>
  </div>,
};
