# Among Us at home

A social deduction game for our family, played throughout the house and supported by a simple phone web app. Crewmates move between rooms to complete tasks while a secret Impostor blends in and eliminates players. Discussion and detective work happen face to face.

Start with **6–8 players and one Impostor**, combining phone puzzles with physical puzzles whose answers the app can verify. QR codes open room tasks. Sabotage and a control room are ideas for later.

## Project status

The app scaffold is implemented with the confirmed React/TypeScript + Vite, React Aria, CSS Modules, Node/Express, Socket.IO, SQLite and Zod stack. English and Dutch are available per phone, with a persistent language switch and translated errors.

Working now: create a lobby, either as a host-only screen (for example a laptop that runs the game without playing) or as an organiser who also plays, share an invitation link or five-letter code, join with up to eight players, receive live roster updates, and restore the same identity after refresh or server restart. With 1–8 players, the organiser can start a round with one random Impostor, pause/resume it, end it with a confirmed role reveal, and return everyone to the same lobby for another round. SQLite persists lobbies, roles, tasks and hashed session credentials; players receive HttpOnly session cookies. The organiser joins as a player with a separate organiser flag.

**Tasks (stage 3, first slice):** the organiser edits the task stations (house rooms) in the lobby. **Print materials** in the organiser controls generates everything to print, or save as PDF from the print dialog: a join poster with QR code, one A4 sheet per station with its QR code and codebook, and cut-out body/ghost markers. Scanning a station QR code with the phone camera opens that player's task at the station. By default tasks open **only** by scanning; the organiser can switch on **Open tasks without scanning**. Starting a round gives every player four tasks spread over the stations: *Number order*, *Fix the wiring* and *Simon says* on the phone (Simon says can be switched off), and *Codebook*, where the player looks up four symbols on that room's printed sheet. The Impostor receives identical-looking fake tasks that never count. Shared crew progress is published every 30 seconds rather than after each task, and the crew wins automatically once 80% of real tasks (rounded up) are done.

**Eliminations (stage 3, second slice):** after opening protection (60 s of active play), the Impostor reveals their role card, gives the physical signal and records the victim there; a cooldown (60 s) follows. Timers count only active play, so pauses and server restarts stop them. The victim's phone switches to a body screen; nobody else, including the organiser, is told. The Impostor wins when at most one living Crewmate remains. The organiser can switch **Record eliminations in the app** off to play eliminations with the physical signal only.

**Meetings and voting (stage 3, third slice):** living players can **Report body** or call an **Emergency meeting**; the organiser can always **Call meeting**. Play stops, a siren sounds and everyone gathers. The host then taps **Start meeting**, ticking who was found eliminated (recorded bodies are included automatically, and the list never shows who the app knows is dead); those players become ghosts, shown to everyone, and the discussion countdown starts. With **Vote on phones** on, the host starts the vote, living players vote on their phones (changeable until closed), and closing the vote shows who voted for whom on the host screen. Otherwise everyone votes by pointing and the host records the result. The unique highest vote is ejected (tie or Skip: nobody); ejecting the Impostor wins for the crew. Ghosts may do tasks after the meeting but not talk, vote or call meetings. Body reports and emergency meetings each have an organiser on/off switch. A meeting sounds a short siren on every open phone and the host screen (and vibrates Android phones). Browsers only allow sound after someone has tapped the page once, and a locked phone or an iPhone on silent stays quiet.

A full round is now playable. **Stage 4 (organiser flexibility):** under **Fix a problem** the organiser can credit, remove or replace a broken station's tasks for everyone (replacement gives every unfinished task there a new puzzle at another station), mark a player back in the game or out, and restore emergency meetings, without seeing roles or hidden states; **End round** can declare a winner; and **Rejoin** in Room management shows a one-time QR code that puts a player who lost their phone or session back in their place. Three **Organiser help** switches in Settings: **Confirm wins before they end the round** (off by default) stops play when the app detects a win and shows only the organiser the proposed result to confirm or reject; **Preview fixes** (on) says in each fix or removal confirmation whether it would end the round and what the task goal becomes; **Change history and undo** (on) lists this round's fixes and removals and undoes the latest fix. No hosting has been purchased or deployment performed.

Roles stay out of public updates and ordinary organiser views. Each phone fetches only its own role after an explicit reveal, and hides it when focus/visibility is lost, the connection drops, or the phase changes. Ending the round reveals all roles to everyone and prevents resuming that round. After a server restart, active rounds recover paused with the same roles; the organiser decides when to resume. Existing lobby databases are migrated automatically, preserving sessions.

Organisers can open **Room management / Kamerbeheer** in any phase to remove a player or delete the whole room. Both actions require confirmation. Removing a player revokes their session; during a round, a Crewmate departure pauses play and an Impostor departure ends the round without a winner. Confirmation wording does not disclose the departing role. Departed players appear as removed in the final role reveal, then are excluded from the next lobby. Removing a player is not a ban: they may join again with a new session when the lobby is open. The organiser cannot remove themselves; deleting the room returns everyone to the join screen and deletes its players, round and command history. Offline players lose access when they reconnect.

This is a personal home game, not a product being prepared for public release. The organiser should be able to change settings and fix problems during play, including choosing how much the app manages.

## Documentation

| File | Purpose |
| --- | --- |
| [Game rules](docs/game-rules.md) | Default rules, setup, roles, meetings, winning and later sabotage ideas. |
| [Tasks and the control room](docs/tasks-and-control-room.md) | First-version puzzles and ghost tasks; later control-room and task ideas. |
| [App requirements](docs/app-requirements.md) | Scope and interaction requirements for the first app version. |
| [App plan and recommended stack](docs/app-plan.md) | Proposed stack, accessibility and performance requirements, hosting and build stages. |
| [Organiser controls](docs/organiser-controls.md) | Adjustable settings, app involvement, mid-round changes and recovery. |
| [Decisions and playtesting](docs/decisions-and-playtesting.md) | Open questions, later backlog and trial-round notes. |
| [Design system](docs/design-system.md) | Where and how to change colours, typography, shared controls and layouts. |
| [Agent setup](docs/agent-setup.md) | Shared project instructions for Codex and Claude Code. |

## First playable version and later ideas

The first version covers joining, secret roles, tasks, eliminations, body reports, meetings, physical vote recording and victory checks. Organiser settings, manual assistance and recovery controls are part of this version, so a broken puzzle or awkward timer does not spoil the evening.

**Later, outside the first build:** the control room, communications and reactor sabotage, trust-based task types, in-app voting, paired and multi-room tasks, and additional roles. These ideas remain documented under clearly labelled later sections. Named scan history is parked and not recommended unless playtests establish a need.

## Next steps

1. ~~Choose a small puzzle set and initial rooms.~~ Done: number order, wiring and printable codebooks; stations are edited in the lobby.
2. ~~Build the first phone puzzle and physical-answer puzzle, with assignments, believable fake tasks and shared progress.~~ Done.
3. ~~Eliminations, bodies, the Impostor win, body reports, emergency meetings, discussion timer and ghosts~~ done. ~~Vote entry and ejection~~ done. ~~Core corrections and rejoining~~ done. ~~Task replacement, confirmed victory, previews and change history~~ done. Next: a family playtest. New mechanics from here on each get an organiser on/off switch.
4. Build the first playable version, run a practice round and tune it through family playtests.
5. Use those playtests to decide whether the control room or sabotage would improve the game.

## Play on your home network (no hosting needed)

The game runs fine from a laptop on your own Wi-Fi; nothing has to be deployed.

1. Put the laptop and all phones on the same Wi-Fi (not a guest network that isolates devices).
2. Stop `npm run dev` if it is running (both use port 3001). Run `npm ci` once, then `npm run play`. It builds the app and serves it on port 3001, printing addresses such as `On your network: http://192.168.1.18:3001`. On macOS, allow incoming connections if the firewall asks.
3. On the laptop, open `http://localhost:3001` or the network address. On `localhost`, QR codes and invite links automatically use the laptop's network address so phones can open them; the screen shows which address. Choose **Host a game → Just host on this screen**, and keep this screen as the organiser view. It does not get a role or tasks.
4. Players scan the QR code on the laptop screen (or the printed join poster) with their phone camera. At stations they use **Scan station QR** in the app; on the home network this takes a photo of the code, because browsers only allow live camera scanning over HTTPS.
5. Open **Print materials** from the same address and print the station sheets.
6. Keep the laptop awake and plugged in, for example `caffeinate -i npm run play` on macOS. Give the laptop a fixed IP address in your router (a DHCP reservation); the printed QR codes contain this address and stop working if it changes.

**Live QR scanning on phones (optional HTTPS):** phone browsers only allow live camera scanning over HTTPS. Run `npm run play:https` instead to serve the game at `https://<laptop address>:3001`. The first run creates a local certificate authority in `data/tls/` (`ca.pem`, valid 10 years) and signs the server certificate with it; the server certificate is renewed automatically when the laptop's address changes or it nears expiry. Trust the authority once per device and the game opens without a "not private" warning, also after renewals:

- **Mac (laptop):** `security add-trusted-cert -r trustRoot -k ~/Library/Keychains/login.keychain-db data/tls/ca.pem` (asks for your password), then restart the browser. Firefox uses its own store: *Settings → Privacy & Security → Certificates → View Certificates → Authorities → Import*.
- **iPhone/iPad:** open `https://<laptop address>:3001/ca.crt` in Safari (continue past the warning this one time) and allow the profile download. Install it in *Settings → General → VPN & Device Management*, then switch it on in *Settings → General → About → Certificate Trust Settings*.
- **Android:** open the same `/ca.crt` link in Chrome to download it, then install it via *Settings → Security → More security settings → Encryption & credentials → Install a certificate → CA certificate* (menu names vary by brand).

Skipping this still works: each device then shows the warning once (*Show details → visit this website* on iPhone, *Advanced → Proceed* on Android). Keep `data/tls/ca-key.pem` private; anyone with it could impersonate websites to devices that trust the authority. Delete `data/tls/` and remove the trusted certificate from devices to revoke it. Without HTTPS, scanning in the app takes a photo instead.

Lobbies, roles and progress are saved in `data/game.sqlite`; if the laptop restarts, run `npm start` (or `npm run play`) again and the round resumes paused. The connection is plain HTTP, which is fine on a home network.

## Working locally

Use Node.js 24 LTS (`.nvmrc`); the scaffold also supports Node 22.12+. Install and start:

```sh
npm ci
npm run dev
```

Open `http://localhost:5173`. Vite proxies API and Socket.IO traffic to Express on port 3001. On the same Wi-Fi, use the computer's LAN address with port 5173 on each phone. Each browser profile has its own player session; use separate profiles or private windows for local multiplayer checks. Station QR codes are scanned with the phone's own camera app; there is no in-app scanner.

```sh
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
npm start
```

The built app is served by Express at `http://localhost:3001`. Set `NODE_ENV=production` behind HTTPS to enable secure cookies. Environment variables `PORT` and `DATABASE_PATH` configure the server; `.env.example` documents defaults (the scripts do not automatically load `.env`). SQLite defaults to `data/game.sqlite`; keep this on a persistent disk when deploying. E2E tests always use separate ports (5174/3002) and `data/e2e.sqlite` so they do not alter your development game. No automatic lobby expiry or lost-session recovery UI is implemented yet.

### Test the task games on your phone

`/practice` plays every task game on its own, without a room, round or printed sheets: pick a game, solve it, and the server checks the answer with the same code as real tasks. Codebook puzzles show a practice station sheet on screen. Nothing here touches lobbies or the database. A link on the home screen opens it, and `?game=wires` (or `order`, `codebook`) opens one game directly.

1. Run `npm run dev` with the phone on the same Wi-Fi as the computer.
2. The terminal prints `Test on your phone (same Wi-Fi): http://<computer address>:5173/practice` with a QR code. Scan it with the phone camera.
3. Saved code changes reload on the phone automatically.

`npm run play` prints the same practice link for the built app. New task games appear on the practice page automatically once they are in `taskKinds` (`shared/protocol.ts`), the server rules registry (`server/tasks/index.ts`) and the game registry (`src/features/tasks/games/registry.tsx`).

### Try the round flow

1. As organiser, review **Task stations / Taakstations** in the lobby, then open **Print materials / Printmateriaal** and place each station sheet in its room. Open the app through the computer's network address (not `localhost`) before printing, so the QR codes work on phones; the print page warns and links to that address.
2. Start alone or join a few players using separate phones/browser profiles. Testing supports 1–5 players; 6–8 remains the recommendation for a full game. A solo tester is always the Impostor. To fill the roster, use **Room management → Add test player** in the lobby: test players are Crewmates without tasks that the Impostor can eliminate. Several tabs or private windows in the same browser can share a session, so they do not necessarily represent separate players.
3. The organiser selects **Start round / Start de ronde**. Each player can reveal and hide their own role. Refreshing keeps their identity and role but hides the role card again.
4. Each phone lists its tasks. Walk to the station, open the task and solve it; codebook tasks need that room's printed sheet. Shared progress updates every 30 seconds. Completing enough real tasks ends the round with a crew win.
5. Pause and resume from the organiser's phone; everyone should see the change. Stop and restart `npm run dev` during an active round to check paused recovery.
6. Select **End round / Beëindig de ronde**, then confirm to reveal everyone. Prepare another round to keep the same players and invite code; roles are assigned anew only when starting.
7. Expand **Room management / Kamerbeheer** to remove a player. To start over completely, choose **Delete room / Verwijder kamer**, review the confirmation, and delete it for everyone. You can then create a fresh lobby immediately.

For an automated multiplayer check without six phones, `npm run test:e2e` creates six isolated player sessions and exercises this flow automatically, along with both languages and accessibility checks. The backend tests also check role privacy, permissions, duplicate/stale commands, restart recovery and migration from the original database format.

Source layout:

- `src/`: React screens, CSS Modules and typed EN/NL translations. `App.tsx` holds the session, live updates and routing; each screen lives in a folder under `features/` (`home`, `lobby`, `round`, `meeting`, `tasks`, `practice`, `print`). `features/tasks/games/` has one folder per task game (component and CSS) on a shared `TaskFrame`. Shared helpers are in `lib/` (API, sound) and `components/` (QR codes).
- `src/styles/theme.css`: central visual theme; `ui.module.css` contains shared controls and card surfaces, and `fonts.css` handles font loading.
- `server/`: Express API, authenticated Socket.IO updates and SQLite store. `app.ts` sets up the server and live updates; `routes/` holds the API handlers by area; `store/` holds the game state (`db.ts` opens and migrates the database, then one module each for rooms, rounds, meetings, corrections, win rules and the per-player lobby view); `tasks/` generates and checks puzzles, one module per task game; `test/` holds the integration tests by area.
- `shared/`: shared protocol types and Zod input schemas.
- `tests/`: browser flows and axe accessibility checks; server integration tests live alongside the server.
- `docs/`: game rules, requirements and remaining implementation plan.
- `AGENTS.md`: shared coding-agent guidance; `CLAUDE.md` imports it for Claude Code.

The language initially follows the browser (Dutch for `nl`, English otherwise), can be changed at any time, and is saved locally. Server errors use stable codes translated on the phone. New UI text must be added to both dictionaries; TypeScript enforces matching keys. Player names and game codes are never translated.

Source is on GitHub at `https://github.com/JesseLame/among-us`. Work on feature branches, merge to `main` when `npm test` and `npm run test:e2e` pass, and tag completed build stages (for example `stage-2`) as rollback points. Local databases in `data/` are not versioned; copy `data/game.sqlite` before trying schema changes.

## Design priorities

- Keep movement, observation and conversation central.
- Use clear phone controls and puzzles without dependence on quick reactions.
- Track progress without a host inspecting every physical task.
- Let the organiser tune the game and recover from mistakes while playing.
- Support more app assistance or more face-to-face coordination through simple settings.
- Keep ordinary organiser controls usable without exposing secret roles or unreported deaths.
- Test the basic round before adding later mechanics.

Initial outline: 3 October 2026. Revised scope: a flexible family game with a smaller first playable version.
