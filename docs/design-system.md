# Changing the look and feel

[Project overview](../README.md)

The UI uses a small CSS-based design system. A new colour palette, type treatment, corner style or shared control design can be applied without changing game logic. Two themes exist: **Classic** (the warm house-map look, the default) and **Space** (a dark spaceship look). Each device picks its own with the theme switch beside the language switch; see [Themes](#themes).

## Where to make a change

| Change | File | Purpose |
| --- | --- | --- |
| Colours, fonts, type sizes, shared spacing, corners, shadows, page/card sizing | [`src/styles/theme.css`](../src/styles/theme.css) | Every token, with the Classic values, using semantic CSS custom properties. |
| Another theme's look | `src/styles/themes/<id>.css` | Overrides only the tokens that differ from Classic. |
| Theme list, switch and decorative art | [`src/themes/`](../src/themes) | `index.ts` lists themes; `art.tsx` holds the art slots; `classic.tsx` and `space/` draw them. |
| Downloaded fonts | [`src/styles/fonts.css`](../src/styles/fonts.css) | Optional Google Fonts import. Change or remove it alongside the font-family tokens; fallbacks keep the app usable. |
| Buttons, form fields, tabs, language switch, cards, feedback and dialogs | [`src/styles/ui.module.css`](../src/styles/ui.module.css) | Shared control styling, including hover/selected states. |
| Page shell, header/footer, lobby and round layout, roster and connection line | [`src/App.module.css`](../src/App.module.css) | Layout that several screens share. |
| One screen's layout: house illustration and join form, lobby, role card and organiser controls, meetings, task list, practice and print sheets | `src/features/<screen>/<screen>.module.css` | Each screen's own styles, beside its components. |
| Task game boards (order, wiring, codebook safe, Simon pads, maze, waterways valves, delivery hold button, two-keys codes) | `src/features/tasks/games/` | `games.module.css` holds the shared dark board and solved glow; each game folder has its own CSS module. |
| Reset, page defaults, focus, minimum control height, reduced motion | [`src/global.css`](../src/global.css) | Global foundation. Imports fonts and theme once. |
| Visible wording | [`src/i18n/en.ts`](../src/i18n/en.ts), [`src/i18n/nl.ts`](../src/i18n/nl.ts) | Matched English/Dutch dictionaries, one file per language. |
| Structure and interaction | `src/App.tsx` and the screen folders in `src/features/` (`home`, `lobby`, `round`, `meeting`, `tasks`, `practice`, `print`) | React markup and behaviour. Edit for a structural redesign, not merely to change colours. |

The browser toolbar colour starts as the `theme-color` meta tag in `index.html` (Classic's page colour) and then follows the active theme's `--color-page`. An inline script in `index.html` applies the saved theme before the app loads, so the page does not flash.

## Common changes

### A different palette

For Classic, edit the values in `theme.css`; for another theme, its file in `src/styles/themes/`. Begin with:

```css
--color-page: #f5f3e9;
--color-surface: #fffcf4;
--color-text: #263d35;
--color-text-muted: #636b61;
--color-accent: #b94426;
```

These are the current values, not an additional theme. Update the surrounding semantic tokens as a group: a new surface needs suitable text and borders, while primary/secondary/danger actions each need readable foregrounds and hover states. `--color-primary` currently aliases `--color-text`; replace that alias if buttons should have an independent brand colour.

All app CSS colour literals live in `theme.css`. House-diagram and avatar colours have their own section so they can follow a redesign without changing unrelated controls. Use semantic names such as `--color-danger`, not palette names such as “orange”, when introducing new tokens.

### Typography

Change `--font-body`, `--font-heading` and `--font-accent`, and update the font import in `fonts.css` if needed. Set the `--text-*` tokens for common text sizes, titles and display text. Fonts can also be system-only: remove the external import and choose system stacks. Check both languages; Dutch labels are often longer.

The smallest type tokens are intended for secondary labels or decorative map annotations, not primary instructions. Do not reduce the readability of the role card or buttons to fit a layout.

### Corners, spacing and surfaces

- `--radius-card`, `--radius-control` and `--radius-small` control shared surface shapes.
- `--shadow-card` and `--shadow-symbol` control the main decorative shadows; set them to `none` for a flat style.
- `--space-*` is the shared spacing scale. Local offsets that place furniture, symbols or other illustrations remain in the layout CSS.
- `--layout-*` controls page width, gutters, main column gaps and private-player card sizing.
- `--control-height` is normally 48px. Keep language options and other controls at least 44px tall; preserve visible focus and reduced-motion support.

The exact layout is still CSS, not a fully configurable page builder. Reordering sections, changing the house illustration or adding different navigation will require layout or React changes. One-off positioning values are intentionally not all exposed as global theme settings.

## Reusing shared controls

React screens import shared styles alongside their layout module:

```tsx
import { Button } from 'react-aria-components';
import ui from '../../styles/ui.module.css';
import shared from '../../App.module.css';
import styles from './round.module.css';

<Button className={ui.primary}>Action label</Button>
<section className={`${ui.card} ${shared.lobbyCard}`}>...</section>
<section className={`${ui.card} ${styles.roleCard}`}>...</section>
```

Paths in this example assume a component in `src/features/round/`. The shared `card` class supplies the surface, border and radius; screen classes supply padding and layout. Import shared classes directly rather than duplicating them or using cross-file CSS `composes` (which currently triggers a build-plugin warning).

Change a shared button or dialog once in `ui.module.css` to update every screen. Avoid overriding shared colours in a feature module or inline JSX; add a semantic variant if a distinct control really needs one. Keep React Aria's state selectors such as `[data-hovered]`, `[data-selected]` and `[data-focus-visible]` working.

## Responsive behaviour

Each screen module contains its own responsive rules, using the same breakpoints; `ui.module.css` contains shared-control responsive rules. Breakpoint values are deliberately literal because ordinary CSS custom properties cannot serve as media-query thresholds:

- 1500px and wider: extra desktop breathing room.
- 1050px and narrower: smaller gutters and column gaps.
- 760px and narrower: single-column layouts and mobile typography.
- 360px and narrower: compact gutters and small label adjustments.

Keep the joined-player view minimal during active/paused rounds: the private role card and language control, with a short status message only when needed. Its simplified layout is an explicit product decision. Organiser views retain the management controls. Role secrecy must remain enforced by the server, regardless of visual changes.

## Workflow for a future redesign

1. Run `npm run dev` and identify whether the change is a theme adjustment, a shared-control change or a structural redesign.
2. Edit the smallest appropriate layer above. For an experiment, temporarily change token values in browser developer tools before saving them in `theme.css`.
3. For shared theme/control changes, run `npm run build` and `npm run test:e2e`. For a narrow feature layout, use the relevant browser spec. Server tests are needed if behaviour, schemas or permissions change, not for a palette change alone.
4. Inspect the join screen, organiser lobby, hidden/revealed player role card, paused state, results, and a destructive confirmation. Check English and Dutch, mobile and desktop, keyboard focus and zoom. The browser tests save example mobile role and dialog screenshots in `test-results/`; those files are temporary.
5. Check normal/hover/selected/disabled/error/disconnected states and text contrast. Automated axe checks are useful but do not prove accessibility or real-phone usability.
6. Update this guide if the styling structure changes. Do not edit or reset saved games just to preview a new style; browser tests use their own database and ports.

## Themes

A theme is a set of token overrides plus optional art. It never changes game rules, server data, sounds or wording, and it never gets its own copy of a screen.

- **Choosing.** Each device chooses its look (`ThemeControl`, saved in `localStorage` as `home-theme`, default `classic`). It is a personal display preference, so it has no organiser setting and never reaches the server. `/print` always uses Classic: printed sheets are plain paper.
- **Tokens.** `theme.css` declares every token on `:root, [data-theme='classic']`; `themes/<id>.css` overrides on `[data-theme='<id>']`. Because the selector is an attribute, an element can preview another theme (the switch's swatches carry `data-theme`). When a theme needs a new knob, add the token to `theme.css` with the value Classic already uses, so Classic does not change. Tokens used only by one theme's art (such as Space's `--color-visor`) may live in that theme's file.
- **Art.** `src/themes/art.tsx` lists the decorative slots: `BrandMark`, `HomeMap`, `Avatar`, `RoleSymbol`, `RoleCardDecor` and `MeetingBanner`. A theme may draw any of them; missing slots fall back to Classic. Art is decoration only: hide it from assistive technology or keep the same accessible label, and never let it depend on hidden game state. The role symbol and role name look the same for every role in a theme.
- **Fonts.** A theme can name a Google Fonts stylesheet in `themeMeta`; it loads only while that theme is active. Font stacks keep the UI usable without it.
- **Kept fixed.** QR codes keep a white background, wire colours stay distinct and named, and controls keep their sizes and focus styles.

### Adding a theme

1. Add its id to `themes` in `src/themes/index.ts` and fill in `themeMeta` (its name key and optional fonts).
2. Add the name to both dictionaries (`theme<Name>` in `en.ts` and `nl.ts`).
3. Write `src/styles/themes/<id>.css` with token overrides and import it in `src/global.css`.
4. Optionally draw art in `src/themes/<id>/` and register it in `art.tsx`.
5. Add a Playwright project for it in `playwright.config.ts` (as `space` does), so every spec's axe checks also cover it, then check text contrast, both languages, mobile and desktop.

TypeScript fails the build when a theme lacks metadata, a name or an art entry.
