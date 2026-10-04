# Project restructure plan

Status: done (October 2026). Kept as a record of why the project is laid out this way; `AGENTS.md` and `README.md` describe the current layout.

Goal: replace the flat `src/` folder with feature folders, and give every task game a shared base so a new game is one folder instead of edits spread over five files. Every step is a refactor only: no change to game rules, server contracts, payloads or the SQLite schema, and no organiser setting needed.

## Problems before the restructure

- `src/Tasks.tsx` holds the task list, shared progress and all four games.
- Adding a game touches `shared/protocol.ts`, `server/puzzles.ts`, the `PuzzleView` switch, `kindLabels`, and `App.module.css`.
- `src/App.module.css` (~2100 lines) holds every screen, every game and the print sheets.
- `server/store.ts` (~900 lines) and `server/app.test.ts` (~1000 lines) are single files.
- About 20 files sit side by side in `src/`, covering organiser, player, meeting and practice screens.

## 1. Task base

- **`TaskGameProps<K>`**: one props type for every game (`puzzle`, `t`, `disabled`, `solved`, `rejected`, `onSubmit`).
- **`<TaskFrame>`**: the frame every game repeats: an instructions paragraph, a board with `data-wrong`/`data-complete`, and a `role="status"` line that switches between error and note styles.
- **`useFlash(ms)`**: the "wrong for a moment, then reset" timer that order, wires and codebook each wrote out separately.
- **Client registry** (`src/features/tasks/games/registry.tsx`): a mapped type over `TaskKind`, so the build fails when a kind is missing. It holds the label key and component and replaces `PuzzleView`'s switch and `kindLabels`.
- **Server registry** (`server/tasks/`): one module per kind exporting `{ generate, check }`. This replaces both switches in `server/puzzles.ts`.

## 2. Target folder structure

```
src/
  main.tsx, App.tsx            # shell, socket, routing only
  lib/        api.ts, sound.ts, useFlash.ts
  i18n/       index.ts, en.ts, nl.ts
  styles/     theme.css, ui.module.css, fonts.css, global.css
  components/ Qr.tsx
  features/
    home/       Home.tsx, home.module.css
    lobby/      Lobby.tsx, Stations.tsx, Settings.tsx, Preview.tsx, lobby.module.css
    print/      PrintSheets.tsx, print.module.css
    round/      RoundView.tsx, RoundControls.tsx, PrivateRole.tsx,
                RoomControls.tsx, Corrections.tsx, Eliminate.tsx, round.module.css
    meeting/    Meeting.tsx, MeetingControls.tsx, meeting.module.css
    tasks/      Tasks.tsx, SharedProgress.tsx, Scanner.tsx, tasks.module.css
      games/    types.ts, registry.tsx, TaskFrame.tsx, games.module.css
        order/     OrderGame.tsx, order.module.css
        wires/     WiresGame.tsx, wires.module.css
        codebook/  CodebookGame.tsx, codebook.module.css
        simon/     SimonGame.tsx, simon.module.css
    practice/   Practice.tsx, practice.module.css
server/
  index.ts, app.ts (setup, sockets, broadcast), session.ts, tls.ts, network.ts, practice.ts
  routes/     context.ts, games.ts, round.ts, meetings.ts, organiser.ts
  store/      index.ts, db.ts (open + migrations), shared.ts, base.ts, rules.ts, view.ts,
              rooms.ts, round.ts, meetings.ts, corrections.ts
  tasks/      index.ts, random.ts, types.ts, order.ts, wires.ts, codebook.ts, simon.ts
  test/       helpers.ts, lobby, round, room, tasks, meetings, corrections (.test.ts)
shared/protocol.ts
```

Each feature owns its CSS module. `App.module.css` keeps only the decorative geometry and layout the screens share. `theme.css` and `ui.module.css` stay as they are.

## 3. Steps (one commit each)

1. ✅ Task base and registries; one folder per game with its own CSS; server `tasks/` modules.
2. ✅ Move the remaining files into feature folders with `git mv`, and take `Home`, `Lobby`, `RoundControls`, `PrivateRole` and `SharedProgress` out of their current files.
3. ✅ Split the rest of `App.module.css` into feature modules.
4. ✅ Split i18n into one file per language.
5. ✅ Split the server into routes, store modules and test files.
6. ✅ Update `AGENTS.md`, `README.md` and `docs/design-system.md`.

Check after each step: `npm run build`, `npm test`, the full `npm run test:e2e`, and a look at `/practice` at mobile width.

## Adding a task game

1. Add its puzzle type to `TaskPuzzle` and its kind to `taskKinds` in `shared/protocol.ts`.
2. Add `server/tasks/<kind>.ts` with `generate` and `check`, and register it in `server/tasks/index.ts`.
3. Add `src/features/tasks/games/<kind>/` with the component and its CSS module, built on `TaskFrame`, and register it in `registry.tsx`.
4. Add its EN and NL texts in `src/i18n/en.ts` and `src/i18n/nl.ts`, and an organiser on/off setting.
