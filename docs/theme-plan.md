# Theme plan: classic and space

Status: implemented (phases 1–6). The maintained reference is the Themes section of [design-system.md](design-system.md).

[Project overview](../README.md) · [Design system](design-system.md)

Players can choose how the app looks on their own device. The current warm house-map look stays as **Classic** (the default). A second theme, **Space**, gives the whole app a spaceship/Among Us feel. The structure must make a third theme a small, checked addition.

## Decisions

- **Personal choice.** The theme is a per-device display preference stored in `localStorage` (`home-theme`), like the language. It is not a game mechanic, so it has no organiser setting and no server state. Default: `classic`.
- **Available everywhere the language control is**, including the private role card during a round.
- **Full vibe for Space**: palette, fonts and background, plus theme-specific decorative art (brand mark, ship map, crewmate avatars, role card decor, meeting banner).
- **No changes** to game rules, server contracts, privacy, sounds or wording. QR codes stay on a plain white background. Wire colours stay distinguishable and named.
- All art is original (a bean with a visor, our own ship map). No copied Among Us assets or fonts.

## Architecture

### Tokens

- `src/styles/theme.css` holds every token with the classic values on `:root`.
- `src/styles/themes/<id>.css` overrides tokens under `[data-theme='<id>']`. Classic needs no override file.
- A theme may only change tokens. When a theme needs a new knob (background image, glow, heading case), add the token to `theme.css` with the value classic already uses, then override it in the theme file.

### Registry

`src/themes/index.ts` lists the themes and their metadata (colour scheme, browser toolbar colour, preview swatch, optional font stylesheet). Typed records make a theme missing metadata or translations fail the build. Theme names live in `src/i18n/en.ts` and `nl.ts`.

### Applying a theme

- `initialTheme()` reads `localStorage`, falling back to `classic`.
- An inline script in `index.html` sets `<html data-theme>` before React loads, so the page does not flash the wrong colours.
- On change: set `data-theme` and `color-scheme`, update the `theme-color` meta tag, load the theme's fonts if any, store the choice.

### Swappable art

A `useTheme()` hook gives components the active theme. Decorative pieces are looked up per theme with a classic fallback:

| Slot | Classic | Space |
| --- | --- | --- |
| `BrandMark` | ⌂ | small spaceship / visor |
| `HomeMap` | house floor plan | ship map (galley, cafeteria, corridor, navigation) |
| `Avatar` | coloured dot | crewmate bean in the same colour |
| `RoleCardDecor` | none | visor glass, HUD corner brackets |
| `MeetingBanner` | none | "emergency meeting" header |

Art keeps the same accessible labels or is hidden from assistive technology, so tests and screen readers are unaffected.

### Control

`ThemeControl` is a React Aria `RadioGroup` with a swatch per theme, styled in `src/styles/ui.module.css`, shown beside the language control. Beyond about five themes it should become a `Select`.

## Phases

1. **Token audit.** Move look decisions still written into feature CSS modules (backgrounds, shadows, borders, letter case, fonts) into tokens. Classic must look identical.
2. **Theme switching.** Registry, `data-theme`, persistence, no-flash script, toolbar colour, control, translations, art slots with classic art.
3. **Space tokens.** Palette, fonts, starfield background (static under reduced motion), glow and HUD panel styling, task board colours. AA contrast.
4. **Space art.** Brand mark, ship map, crewmate avatars, role card decor, meeting banner.
5. **Tests.** Switch, reload, persists; keyboard use; axe checks in both themes; full e2e and build.
6. **Docs.** Replace the "second theme" note in `design-system.md` with an "Adding a theme" checklist; update `AGENTS.md` and `README.md`.

## Adding a theme later

1. Add its id to the theme list and fill in its metadata.
2. Write `src/styles/themes/<id>.css` with token overrides.
3. Add its name to both dictionaries.
4. Optionally provide art for any slot; the rest falls back to classic.
