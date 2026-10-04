# Project guidance — Codex and Claude Code

This is the shared project instruction file. `CLAUDE.md` imports it; keep shared rules here rather than maintaining two copies. Follow the user's current request when it changes an earlier project decision.

## Context and starting points

- A personal, mobile-first family game played around the house. Conversation and movement happen face to face; the phone supports play.
- Read `README.md` for implemented features and commands. Consult the relevant file in `docs/` for game rules or requirements; the build plan also contains features that are not implemented yet.
- Confirmed stack: React + TypeScript + Vite, React Aria, CSS Modules, Express, Socket.IO, SQLite (`better-sqlite3`), Zod, Vitest and Playwright + axe. Use npm and preserve `package-lock.json`.
- `src/` owns UI and translations; `shared/protocol.ts` owns input schemas and public types; `server/` owns authoritative state, permissions, persistence and private data.
- The normal recommendation is 6–8 players. Starting with 1–5 is intentionally allowed for testing, including a solo organiser. Keep exactly one Impostor.

## Visual changes

- Read `docs/design-system.md` before changing the look and feel.
- Start with `src/styles/theme.css` for colours, typography, shared spacing, radii, shadows and sizing. Use semantic CSS variables; do not scatter new palette literals through components.
- Shared buttons, inputs, tabs, language controls, cards and dialogs live in `src/styles/ui.module.css`. Screen layouts and decorative geometry live in `src/App.module.css`; new features should import the shared styles.
- Keep `src/global.css` limited to imports, base styles and accessibility defaults. Font loading is in `src/styles/fonts.css`.
- Keep ordinary joined-player screens minimal during a round: the private role card, its language control, and only necessary pause/disconnection feedback. Organiser controls belong to the organiser view.
- Use native controls or React Aria for interaction, preserving focus, keyboard behaviour and semantic labels. Keep controls at least 44px tall, normally 48px, and support 320px screens, text zoom and reduced motion. Maintain readable contrast when changing a theme.
- A visual redesign should not change game rules, session behaviour or server contracts unless requested. Explain any intentional interaction changes separately.

## Game state and privacy

- Both English and Dutch are required. Add every user-facing string and error translation to both dictionaries in `src/i18n.ts`. Do not translate player names or codes.
- The server authorises actions and persists accepted changes before responding/broadcasting. Keep revision checks, round identity checks and command retry protections intact.
- Never send other players' secret roles, session credentials or hidden state to a player's or ordinary organiser's view. CSS hiding is not privacy. Role reveal is deliberate and private until the round ends.
- Preserve players' identities and roles through reconnect. Restore active rounds paused after a server restart; never silently reshuffle roles or resume after a public reveal.
- Player removal revokes the session. A Crewmate removal during a round pauses it; an Impostor removal ends it without a winner. Keep role-dependent details out of removal previews.
- Room deletion is organiser-only, confirmed in the UI, revokes all room sessions and affects only that room. The organiser cannot remove themselves individually.
- Evolve the SQLite schema with forward migrations in `server/store.ts`; preserve existing lobbies/sessions. Never reset a user's database as an implementation shortcut.

## Development and verification

- Node 24 LTS is the preferred runtime (`.nvmrc`); the package also supports Node 22.12+. Use `npm ci` to install the locked dependencies.
- `npm run dev`: Vite on 5173 and Express on 3001. `npm run build`: typecheck and build client/server. `npm start`: serve the built app on 3001.
- `npm test`: server integration tests, including privacy, permissions and recovery. Run for server/shared-protocol changes.
- `npm run test:e2e`: browser workflows and axe checks. Run the relevant spec(s) for UI changes, or the whole suite when shared styles/controls change. Install Chromium with `npx playwright install chromium` if missing.
- Browser tests own ports 5174/3002 and `data/e2e.sqlite`; do not point tests at the user's running game or `data/game.sqlite`.
- For shared styling changes, run the build and existing browser tests, then visually inspect mobile and desktop views in both languages as relevant. A passing axe check does not replace visual/keyboard checks. Do not add tests that merely duplicate CSS declarations.
- There is currently no lint script. Do not report linting, tests, deployment or real-phone verification that you did not perform.
- Keep generated output (`dist/`, `test-results/`, `playwright-report/`) and local databases out of source control. Do not expose secrets from `.env` or local sessions.
- Update relevant docs when behaviour or project structure changes, and report what changed, how it was checked, and any remaining limitation.
