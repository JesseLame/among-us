import type { ThemeArt } from './art';
import shared from '../App.module.css';
import home from '../features/home/home.module.css';
import round from '../features/round/round.module.css';

// The original house-party art. Other themes fall back to these pieces.
export const classicArt: ThemeArt = {
  BrandMark: () => <span className={shared.brandMark} aria-hidden="true">⌂</span>,
  HomeMap: ({ t }) => <div className={home.house} role="img" aria-label={`${t.mapTitle} ${t.kitchen}, ${t.living}, ${t.hallway}, ${t.study}.`}>
    <span className={home.mapNumber} aria-hidden="true">{t.mapLabel}</span>
    <div className={home.floorplan} aria-hidden="true">
      <div className={home.kitchen}><span>01</span>{t.kitchen}<i className={home.counter}/></div>
      <div className={home.living}><span>02</span>{t.living}<i className={home.sofa}/><b className={home.pawn}>?</b></div>
      <div className={home.hallway}>{t.hallway}<i className={home.path}/></div>
      <div className={home.study}><span>03</span>{t.study}<i className={home.desk}/></div>
      <div className={home.here}>{t.youAreHere}<span>↑</span></div>
    </div>
    <p aria-hidden="true">{t.mapCaption}</p>
  </div>,
  Avatar: ({ color, initial }) => <span className={shared.avatar} data-color={color} aria-hidden="true">{initial}</span>,
  RoleSymbol: ({ symbol }) => <div className={round.roleSymbol} aria-hidden="true">{symbol}</div>,
  RoleCardDecor: () => null,
  MeetingBanner: () => null,
};
