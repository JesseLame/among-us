# Decisions and playtesting

[Project overview](../README.md)

Use this file to resolve open questions and record changes after family trial rounds. No playtest has been recorded yet.

## Agreed direction

- The proposed app stack is confirmed; the lobby, private role reveal and round lifecycle are implemented. Existing lobby sessions survive the database upgrade. Active rounds recover paused after a server restart.
- Small-group testing may start with 1–5 players, including a solo organiser. Keep one Impostor; 6–8 players remains the recommendation for real rounds.
- English and Dutch are both available, with a persistent language preference per phone.
- A personal game for the organiser and family, with no current public-release plan.
- Internet access is acceptable; easiest setup takes priority over local-network-only operation.
- Accessibility, ease of use and performance are core priorities. The [app plan](app-plan.md) translates these into implementation and verification requirements.
- First build: joining, one secret Impostor, tasks, eliminations, reports, meetings, physical vote recording and victory checks.
- Organiser configuration and mid-round recovery are part of the first build. Choose how much the app handles, adjust settings, pause, fix mistakes and bypass broken puzzles without code changes.
- The organiser can also play; ordinary controls must not disclose secret roles or unreported deaths.
- Begin with app-checked phone puzzles and physical answers. Test task duration rather than imposing the original 45–90 seconds on every puzzle.
- Preserve later ideas in the project, clearly outside the first build.

## Decisions before implementation

- Hosting: playing from a laptop on the home Wi-Fi works without deployment (see the README). A hosted deployment remains optional.
- The family's phone/browser baseline (both interface languages are already supported).
- ~~Small initial puzzle library~~: number order, wiring and printable codebooks. Physical materials beyond the printed sheets and station placement remain open.
- Exact screens for private elimination entry, reconnecting and organiser recovery.
- Shared-progress batch interval: 30 seconds to start; tune in playtests. How to explain organiser settings clearly on a phone remains open.

The default elimination flow remains Impostor self-recording. The settings and timing rules in [organiser controls](organiser-controls.md) are requirements; screen design and implementation are still open.

## First practice and playtest

Practise scanning, solving, body reporting and voting without secret roles, then reset. Play a full round with six players and one Impostor, using tasks, eliminations and meetings only. Start with the [default settings](game-rules.md), then tune as needed.

Observe:

- How long the round lasts and whether either side has a realistic chance to win.
- Time spent staring at phones versus walking, observing and talking.
- Time spent alone, station queues, sightlines and travel distances.
- Whether puzzles are clear, resettable and enjoyable for the family.
- How long bodies remain undiscovered and whether ghosts stay involved.
- Whether accusations come from real observations or accidental information exposed by the app.
- Whether everyone understands what to do when alive, a body, a ghost or in a meeting.
- Whether the organiser can change a timer, replace a broken task, correct a mistake and handle a disconnect without losing the round's state or learning secret roles.

Note settings changed during the round and what happened afterward. Adjust task count, task goal, timings and station placement before adding mechanics.

## Later backlog — not first-build requirements

| Idea | When to reconsider |
| --- | --- |
| Anonymous control room | If players lack useful clues; test whether recent task activity actually helps. |
| Communications sabotage | Only after the control room proves useful. |
| Trust-based task types | If more physical variety is needed beyond answer-based puzzles. |
| In-app voting | If physical voting repeatedly causes problems. |
| Paired and multi-room tasks | Once basic puzzles and station flow work well. |
| Extra roles or multiple Impostors | After the one-Impostor game is balanced; not a first-version role-setting requirement. |
| Named scan history | Parked and not recommended; revisit only with evidence that outweighs its deduction risks. |

Later questions include the control-room activity-expiry window, repair-station placement, sabotage balance and controls for enabling/disabling each feature. Do not let these block the first playable version.

## Playtest record template

- Date and player count:
- Starting settings and app-involvement choices:
- Puzzles and station layout:
- Duration and winning team, or reason for ending without a winner:
- Phone time, movement and body-wait observations:
- Confusing moments, accidental disclosures or broken tasks:
- Mid-round settings changes and corrections, with their effects:
- Disconnects/departures and whether recovery worked:
- Proposed changes for the next round:
