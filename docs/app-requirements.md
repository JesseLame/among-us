# App requirements

[Project overview](../README.md)

Requirements for a personal phone web app used at home with family. The confirmed stack now supports a bilingual lobby, private roles and organiser-controlled round lifecycle, including paused restart recovery; tasks and the full game loop are still to be implemented. There is no current plan for public release: prioritise easy setup, clear screens and practical organiser controls over accounts, competitive enforcement or a general-purpose game platform.

English and Dutch are both first-version requirements. Each player chooses independently and can switch at any time without losing their session. Persist that preference, set the page language, and translate labels, instructions, validation and server errors. Keep player-entered names and codes unchanged.

The [game rules](game-rules.md) give default behaviour, [task mechanics](tasks-and-control-room.md) describe puzzles, and [organiser controls](organiser-controls.md) define configuration and recovery. Defaults are starting points, not hard-coded rules.

Accessibility, ease of use and performance are core requirements. Internet access is acceptable, with easy setup taking priority over offline operation. The [app plan](app-plan.md) specifies the proposed stack, accessibility criteria, performance targets and build stages.

## First playable version

- Lobby and setup: join without an account, configure rooms, select puzzles and starting settings, assign secret roles, and start or end a round.
- Player screen: task list, room scanner, shared progress, private role reveal, body report and emergency meeting.
- Tasks: phone puzzles, answer entry for physical puzzles and believable fake tasks for the Impostor.
- Game control: elimination recording and cooldown, body and ghost states, meeting pause, physical vote-result entry and victory checks.
- Organiser controls: configure how much the app handles, adjust supported settings during a round, pause and resume, correct mistakes, bypass broken tasks and handle departures. These are first-version requirements.
- Recovery: reconnect to the same player with role, progress and timers intact. A temporary disconnect must not remove a player or reassign a role.

## Adjustable app involvement

Allow independent choices for completion entry, station access, meeting timing, elimination recording and victory announcements, as detailed in [organiser controls](organiser-controls.md). Default to app-checked tasks and game state with face-to-face discussion and voting. Support more organiser-led play, including untimed discussion and organiser-entered outcomes.

The app still needs recorded outcomes to keep the round consistent. Turning off automatic handling must show who records the outcome and how. Simple controls are enough; a visual rule editor or plugin system is not required.

## Clear player states

Every screen should answer “What do I do now?”

| State | What the player needs |
| --- | --- |
| Lobby | Join status and a prompt to wait for the organiser. |
| Alive | Tasks and available actions; opening protection or private cooldown where relevant. |
| Body awaiting discovery | Stay nearby with a body marker, remain silent and wait for a meeting. |
| Ghost | Complete remaining tasks; do not discuss or vote. |
| Meeting | Gather in the meeting area; living players discuss and vote physically. |
| Organiser pause | Stop play and wait; preserve the previous state for resumption. |
| Round over | Winner or organiser-ended result, role reveal and a way to prepare another round. |

Use clear labels and comfortable buttons. Keep role reveal deliberate and easy to hide. Provide manual station selection if scanning fails; players must still physically visit the station.

## An organiser who also plays

Normal organiser screens must not expose secret roles, unreported deaths, individual true task contributions or private Impostor cooldowns. Player pickers, including vote entry and correction controls, must not silently filter out undiscovered bodies or reveal their state through labels or validation messages. Record physical outcomes without displaying hidden status.

Announce only public rule changes and public outcomes to the group. Never announce a private elimination. Revealing all roles is a clearly labelled action that ends the round, with confirmation to avoid an accidental reveal.

## Later — outside the first build

- Control-room activity display and session tracking.
- Communications sabotage, dependent on the control room being useful.
- Reactor sabotage, countdowns and repair panels.
- Trust-based task types with a normal player-facing Completed button. An organiser bypass for a broken task is still required in the first version.
- In-app voting, paired tasks, multi-room tasks and additional roles or Impostors.

Keep these ideas documented without implementing their infrastructure ahead of the first playtest. If added, give them organiser enable/disable controls and adjustable timings.
