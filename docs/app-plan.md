# App plan and recommended stack

[Project overview](../README.md)

Status: stack confirmed; bilingual lobby and round lifecycle implemented, updated 4 October 2026. Internet access is acceptable; the organiser prioritises the easiest setup. Accessibility, ease of use and performance are core requirements. Joining, durable sessions, private role reveal, start/pause/resume/end/reset, paused restart recovery, player removal and whole-room deletion now work. Tasks, meetings, timers and the remaining organiser settings are still to come; the stages below are not complete. No app has been deployed and no hosting has been purchased.

## Recommended approach

Build a mobile-first browser app at one stable HTTPS address. Players open a link or scan a QR code, enter their name and join without accounts or installation. The organiser uses the same app with additional controls. Host the game online so the organiser does not need to keep a laptop running during play.

Use one small server for the website, game rules, live updates and storage. Target one family game with 6–8 players first. Keep the core game rules separate from the interface so settings, corrections and later mechanics do not require rewriting screens.

## Stack recommendation

| Part | Recommendation | Why it fits this game |
| --- | --- | --- |
| Interface | React + TypeScript, built with Vite | A practical foundation for the different player states, puzzles and organiser screens; shared types reduce mismatches with the server. |
| Accessible controls | Native HTML first; React Aria Components for dialogs, selects and other complex controls | Reuse keyboard, touch, screen-reader and focus behaviour instead of building every interaction ourselves. |
| Styling | CSS Modules and shared CSS variables | Consistent text sizes, spacing, contrast and touch targets with a small, custom visual design. |
| Game server | Node.js current supported LTS + Express + TypeScript | One long-running process handles game commands and serves the built app. |
| Live updates | Socket.IO | Send game changes to connected phones and support reconnection; implement explicit state resynchronisation and command acknowledgements. |
| Storage | SQLite, stored on a persistent disk | Save setups, player sessions, the active round and corrections without operating a separate database service. |
| Input validation | Zod | Validate settings and commands on the server, with shared schemas for helpful form errors. |
| Verification | Vitest for game rules; Playwright + axe for browser flows | Test timing, hidden information, recovery and multi-player behaviour, alongside manual accessibility and real-phone checks. |
| Hosting | Proposed: one paid Render web service with a persistent disk, in a nearby European region | One HTTPS address and one deployment for both the app and game server; final provider and cost remain to be chosen. |

[Vite](https://vite.dev/guide/) provides development tooling and a production build. [React Aria](https://react-aria.adobe.com/) provides accessible interaction primitives; it does not automatically make our puzzles or finished app accessible. [Express](https://expressjs.com/) supplies the small web server and [Zod](https://zod.dev/) supplies runtime validation.

[SQLite's guidance](https://www.sqlite.org/whentouse.html) supports application-server use where the database resides with the server. This plan deliberately uses a single server instance. Reconsider the database only if the project later needs multiple app instances or substantially different usage.

### Alternatives considered

- **SvelteKit:** a reasonable alternative if the organiser prefers Svelte. The recommendation favours React's fit with React Aria for the interaction work this app needs, not a claim that React is inherently faster.
- **Next.js with Supabase:** worth revisiting for a broader hosted product. For this family game, the proposed single server keeps rules, live messages and storage together without introducing an additional database/realtime service or rendering model.
- **Native mobile apps:** defer. A browser link is the simpler distribution path for the family; app-store delivery is not required.

No framework choice guarantees accessibility or speed. The acceptance criteria below are part of the work regardless of stack.

## Player and organiser experience

Player flow: join → wait in lobby → privately reveal role → task list → room/puzzle → meeting when called → resume or see the result. Body, ghost, paused and disconnected states give an explicit next instruction. A reconnect returns to the current state rather than starting again.

Organiser flow: reuse the last setup or start with defaults → choose rooms and puzzles → adjust a few visible settings → invite players → start. During play, keep Pause and a compact game-controls panel easy to reach. Put less common configuration in an expandable section.

Follow [organiser controls](organiser-controls.md) for adjustable app involvement, timing changes, manual outcomes, task bypasses and correction limits. Settings are data with validation and documented timing semantics. Each change states whether it applies now, to the next timer or to the next round.

No separate settings framework is needed. Build a small reusable set of labelled number fields, switches, summaries and confirmation dialogs. Ordinary edits should be quick; preview consequences when a change could end the round.

## Accessibility requirements

Use WCAG 2.2 AA as the design and testing target, not a claim of conformance before verification. The [W3C reference](https://www.w3.org/WAI/WCAG22/quickref/) covers contrast, keyboard access, focus, resizing, status messages and input behaviour.

- Aim for controls at least 44 × 44 CSS pixels, preferably 48 for primary actions. This is our usability target, not a statement of the AA minimum.
- Use readable body text, strong contrast, visible focus, clear labels and layouts that remain usable at 200% text size and a 320-CSS-pixel viewport.
- Support keyboard navigation and screen readers. Move and restore focus deliberately when meetings, dialogs and errors appear.
- Never rely on colour, sound, motion or icons alone. Pair room symbols and colours with names; use text for alerts.
- Avoid drag-only, rapid-tap and precision interactions. Matching and ordering puzzles need tap/select or button-based alternatives. Avoid timed puzzle input; discussion and game timings remain organiser-adjustable.
- Permit reduced motion. Keep animations brief and decorative; no flashing alerts.
- Make camera access optional. Offer room selection or a printed station code, and readable alternatives for physical clues. Players can also ask for organiser assistance.
- Announce meaningful status changes to assistive technology without reading every countdown tick. Make role reveal an explicit action, including for screen-reader users.
- Keep interface language in one place so family wording can be changed easily. Support both English and Dutch from the start, selected independently per phone. Persist preferences, set the document language and translate errors as well as screen copy. Typed dictionaries in `src/i18n/` (one file per language) enforce matching translation keys.

Automated checks find only some accessibility issues. Use [Playwright's accessibility workflow](https://playwright.dev/docs/accessibility-testing/) together with keyboard testing, VoiceOver/TalkBack checks and testing on the family's actual phones.

## Performance and reliability requirements

Proposed targets to measure during implementation, not promises from the stack:

- The join screen should become usable within about two seconds on a representative family phone over a healthy home internet connection.
- Button presses give immediate visual feedback. Under the same conditions, aim for accepted game changes to appear on other phones within 500 ms at the 95th percentile in an eight-player test.
- Load scanner code and individual puzzle implementations when needed. Use system fonts initially, small assets and minimal animation.
- Send state changes rather than refreshing pages or polling every second. Render countdowns locally from server-provided timing information and resynchronise after a phone wakes.
- Stop the camera when leaving the scanner. Avoid unnecessary background work and whole-screen redraws for countdown ticks.
- Test screen locking, tab switching, refresh, Wi-Fi/mobile-data changes and duplicate taps. Show “Reconnecting” and disable actions that cannot currently be confirmed.

The server decides what happened. Phones request actions; they never decide privately that a kill, task or win succeeded. Persist an accepted action before acknowledging and broadcasting it. Use command identifiers so retries cannot apply an action twice, and reject commands that no longer fit the current round or phase.

[Socket.IO delivery](https://socket.io/docs/v4/delivery-guarantees/) is at-most-once by default. Its [connection recovery](https://socket.io/docs/v4/connection-state-recovery/) is not guaranteed to succeed, so reconnecting must obtain the latest permitted state from storage. Do not silently replay an old elimination or report after the round has changed.

Save the round, settings and session identities to SQLite. A service restart should restore an interrupted round into an organiser-controlled paused recovery state, with timer correction available before resuming. Test this explicitly; database persistence alone does not implement recovery.

Internet-free play is outside the initial scope. A disconnected phone can show its last known screen with a clear connection notice, but cannot independently advance the shared game. A whole-house internet outage may require waiting or continuing the physical game and reconciling it afterward.

## Hidden information and sessions

Keep the authoritative game state on the server. Produce separate public, player-private and organiser views; send each connection only what it is allowed to see. Hiding a role with CSS is insufficient. Validate role permissions and organiser actions server-side, including during reconnect.

Players join with a game code and name, then receive an unguessable session stored in a secure cookie. A game code admits a new player; it must not let someone reclaim another player's identity by entering their name. Provide an organiser-assisted recovery flow for a lost session. Keep organiser access separate from the shared player invitation, without introducing family member accounts.

Ordinary organiser views follow the privacy rules in [app requirements](app-requirements.md). Keep correction history redacted in the interface; avoid logging secrets. Actual outcomes, rather than hidden state shown to the organiser, drive manual corrections.

## Hosting and QR codes

The proposed Render setup supports [web services and HTTPS](https://render.com/docs/web-services) and [WebSockets](https://render.com/docs/websocket). SQLite must live under the [persistent disk](https://render.com/docs/disks) mount path. Render disks require a paid service, are attached to one instance and prevent zero-downtime deployment; schedule updates between games. Its [free service](https://render.com/docs/free) can sleep and loses local file changes on restart, so it is not the proposed setup for persistent game nights.

Keep a stable site address so printed room QR codes remain usable. Room codes identify a station; they contain no role or session secret. An in-app camera scanner needs permission and a secure context such as HTTPS, as documented by [MDN](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia). Keep manual station access available if scanning is inconvenient.

Prepare a repeatable deployment configuration and a simple SQLite backup/restore procedure. Choosing this plan does not create a hosting account or authorise a purchase. Confirm the actual provider and price when deployment is ready.

## Build sequence and completion checks

| Stage | Deliverable | Complete when |
| --- | --- | --- |
| 1. Screen flow and accessible foundation | Join, lobby, role reveal, task list, meeting and organiser-panel prototypes using shared controls. | Main flows work on a small phone screen, with keyboard navigation, readable zoom and clear player-state instructions. |
| 2. Connected lobby and durable sessions | App/server scaffold, game creation, joining, private roles, saved setup, reconnect and pause. | Multiple phones join; refreshing preserves identity; other players' roles never appear in their responses; a restart restores a recoverable round. |
| 3. One complete playable round | One phone puzzle and one physical-answer puzzle, assignments, fake tasks, eliminations, reports, ghosts, physical vote entry and win checks. | Six simulated players can complete a round through both crew and Impostor victories, including paused timers and ghost contributions. |
| 4. Organiser flexibility | All first-version controls: adjustable app involvement, live settings, manual outcomes, task recovery, corrections, departures and reusable setup. | A broken puzzle, mistaken elimination, changed target and departing player can be handled without resetting the whole round or exposing hidden states. |
| 5. Phone and deployment readiness | QR scanning and printable stations, a small varied puzzle set, complete accessibility checks, performance measurement and deployment configuration. | Real iPhone/Android checks, eight-player updates, duplicate-command handling, reconnect and restart tests pass; hosting requirements and cost are reviewable. |
| 6. Family playtest | Practice round followed by a real game using the core mechanics. | Record observations in the playtest document and fix the problems seen before selecting a later mechanic. |

Test game rules with a controllable clock, including pause/resume, simultaneous requests and win checks after corrections. Browser tests should use independent player sessions and verify hidden data in responses as well as visible screens. Physical puzzle accessibility and actual camera behaviour require real-device checks, beyond browser emulation.

Stage 3 progress: tasks are done — stations, printable materials (station QR codes, codebooks, join poster, markers), two phone puzzles, fake tasks, batched shared progress and the task victory. Station QR codes and an in-app scanner from stage 5 are in place (live scanning needs HTTPS, available locally via `npm run play:https`); real-phone scanning still needs checking. Eliminations (opening protection, cooldown, private bodies) and the Impostor win are done too. Body reports, emergency and organiser meetings, discussion countdown and ghosts are done. Physical vote entry, optional phone voting and ejection are done, so a full round is playable.

Stage 4 progress: station credit/removal/replacement, player state corrections, emergency restore, declared winners, rejoin codes, organiser-confirmed victory, change previews and a change history with undo are done. Not built: adjusting an active timer, changing the task goal mid-round, organiser-recorded eliminations and hiding shared progress.

Keep organiser controls present from stage 1 and implement their behaviour alongside each relevant rule; stage 4 completes the matrix. Stages 1–3 are development milestones, not a finished version without the promised flexibility.

## Decisions remaining

- Stack confirmed; the initial scaffold and dependencies are installed. Continue the screen flow and game implementation from the working lobby.
- Choose hosting provider and acceptable running cost before deployment.
- Both English and Dutch are required and available in the scaffold. Choose initial rooms and the first physical puzzle materials. Real family devices will determine the browser support baseline.

The control room, sabotage, trust-based task types, in-app ballots and other [later ideas](decisions-and-playtesting.md) remain outside this build plan.
