# Organiser controls

[Project overview](../README.md)

This is our home game. The organiser should be able to say “that puzzle isn't working” or “let's discuss for longer” and adjust the round immediately. Flexibility is a core first-version requirement. Keep the controls practical enough to use on a phone while also playing.

## Room management — implemented

The organiser has a **Room management / Kamerbeheer** panel in the lobby and during every round phase.

- **Remove player:** confirm the named player before revoking their session. Ordinary players cannot use this action; the organiser cannot remove themselves. Before a round, the player disappears from the roster. During a round, removing a Crewmate pauses play without reshuffling roles; removing the Impostor ends without a winner. The same confirmation explains the possible pause or round end for every player, without disclosing a role. Removed participants appear in the final role reveal and are excluded when preparing the next lobby.
- **Delete room:** confirm that everyone, including the organiser, will lose the room. Delete its player records, round state and command history, invalidate the invitation and return connected players to the join screen. An offline player's session is rejected on return. No role reveal is sent as part of deletion.
- These are server-authorised actions tied to the current room and revision. An old confirmation cannot remove someone or delete a different/newer room. Retried player removals apply once.
- Removal revokes a session, not the person's ability to join. They can join as a new player with the code while the lobby is open. Lost-session recovery and organiser transfer remain unimplemented.

Removing a Crewmate during a round now removes their unfinished tasks from the shared goal (completed work still counts) and rechecks the task victory. With **Preview fixes** on, the confirmation says whether the removal would end the round and what the task goal becomes.

## Host-only organiser — implemented

When creating a game, the organiser chooses **Just host on this screen** (default, for a laptop or tablet) or **Host and play**. A host-only organiser has no role or tasks, does not take one of the eight player places, and sees a join QR code in the lobby plus the list of players during a round. Roles stay hidden on this screen until the round ends, because a laptop screen is often visible to everyone.

## Recording eliminations — implemented

**Record eliminations in the app** (organiser controls, any phase, on by default). On: the Impostor records eliminations, victims see the body screen and the app can declare an Impostor win. Off: eliminations happen only with the physical signal; the Impostor's card says so, the server refuses elimination requests, and the organiser ends the round. Bodies already recorded stay.

## Test players — implemented

In the lobby, **Room management → Add test player** adds "Test 1", "Test 2"… up to the eight player places. Test players are always Crewmates (so the Impostor is one of the real players), get no tasks (the task goal counts real players only), cannot sign in, report or call meetings, and can be eliminated, which allows testing an Impostor win with one real phone. Remove them like any player.

## Meetings — implemented

**Body reports** and **Emergency meetings** (organiser controls, any phase, both on by default) control the players' Report body and Emergency meeting buttons; when off, the buttons disappear and the server refuses those calls. **Call meeting** is always available to the organiser during play, for example after an out-loud report. A call only gathers everyone; the organiser then: (1) **Start meeting**, ticking who was found eliminated (recorded bodies are added automatically; every living-looking player is listed alike); (2) with **Vote on phones** (off by default) **Start voting on phones** and **Close voting and show results**, which lists who voted for whom on the host screen, or otherwise records the physical result (a player or nobody); (3) **End meeting and continue**. **Continue without a result** skips the vote. An ejected player becomes a ghost; ejecting the Impostor ends the round with a crew win. 

## Game settings — implemented

**Game settings** in the organiser controls holds number fields that save automatically:

| Setting | Default | Range | Takes effect |
| --- | --- | --- | --- |
| Time before the first elimination | 60 s | 0–600 | next round start |
| Time between eliminations | 60 s | 0–600 | next elimination |
| Discussion time (0 = no limit) | 90 s | 0–600 | next meeting |
| Emergency meetings per player | 1 | 0–5 | immediately |
| Tasks per player | 4 | 1–8 | next round; lobby only |
| Task goal (% of real tasks) | 80 % | 10–100 | next round; lobby only |
| Progress update interval | 30 s | 5–300 | immediately |

**Task games** (a checklist, every game on by default) decides which games are handed out as tasks. At least one stays on: the last checked game cannot be unchecked. It applies whenever tasks are handed out: at the next round start, and when replacing a station's tasks; tasks already handed out stay. The server stores the games switched *off*, so a newly added game starts on in every room. (This list replaced the earlier **Simon says tasks** switch; a room that had it off keeps Simon says off.)

**Delivery tasks** (shown while Delivery is on): **In the app** (default) or **A real object** with its name (up to 40 characters, saved when the field is left). Until the object has a name, deliveries use the app. Like the game list, it applies to tasks handed out afterwards.

Task count and goal can only change in the lobby, so a change cannot end a running round. Timer changes never alter a timer already running.

## Station access — implemented

**Open tasks without scanning** (organiser controls, any phase) switches between QR-only access, the default, and opening tasks from the list. It applies immediately on every phone and is saved with the room.

## Task stations — implemented

In the lobby, the organiser adds (up to eight) or removes task stations; new games start with Kitchen, Living room, Hallway and Study in the organiser's language. A round cannot start without a station. **Print materials** (in the organiser controls, in every phase) opens an organiser-only `/print` page: choose the join poster, station sheets (QR code + codebook) and/or body/ghost markers, then print or save as PDF. Opened via `localhost`, QR codes use the computer's network address instead (home-Wi-Fi ranges first), and the page shows which address. Stations cannot be edited during a round. Disabling or replacing a broken station or task mid-round is still to be built (stage 4).

## Choose how much happens in the app

These choices are independent rather than one all-or-nothing mode.

| Area | Default | Organiser option |
| --- | --- | --- |
| Station access | Scan the room QR (implemented: QR-only by default). | Switch on opening tasks from the list (implemented). Physical presence still applies. |
| Task completion | App checks a puzzle or physical answer. | Organiser records an announced completion or grants completion for a broken task. Fake tasks still never count. |
| Eliminations | Impostor records the victim after the physical signal (implemented). | Switch recording off: physical signal only (implemented). Organiser-recorded outcomes are not built. |
| Meetings | Players report or call a meeting in the app; timed discussion. | Organiser starts meetings after an out-loud call, or runs untimed discussion. |
| Voting | Physical vote; organiser records the result. | Correct the result or resume with no ejection. In-app ballots are for later. |
| Victory | Announce automatically when a condition is met. | Organiser confirms the app's proposed result, or ends the round with a chosen winner or no winner. |
| Shared progress | Show combined progress in batches. | Hide progress or change its update interval. Never show individual contributions. |

Organiser-led handling can disclose information through private communication. Make that tradeoff clear when selecting it; do not expose secret information in ordinary app controls. Keep Impostor self-recording as the default when the organiser also plays.

## Settings and when they apply

| Setting | Before the round | During the round |
| --- | --- | --- |
| Rooms, puzzles and tasks per player | Configure freely; start with four tasks per Crewmate. | Disable a broken station/task or replace unfinished tasks. Full reassignment waits for the next round. |
| Shared task target | Set the percentage; start at 80%, rounded up. | Preview the resulting total and whether the change would end the round, then apply it. |
| Opening protection and elimination cooldown | Set durations; start at 60 seconds each. | Duration edits apply to future timers. A separate explicit control can adjust/reset an active timer without displaying private remaining time. |
| Discussion time | Start at 90 seconds, or choose untimed. | Extend, shorten or remove the current discussion timer; organiser decides when to move to voting. |
| Emergency meeting allowance | Start at one per living player. | Change the round-wide allowance or restore a used meeting without displaying hidden player states. |
| App involvement and progress display | Choose the options above. | Change at a pause or meeting; retain recorded tasks, roles and outcomes. |
| Roles and player roster | First version uses one Impostor; choose participants before assigning roles. | Preserve roles. Handle departures explicitly; new players and role reassignment wait for the next round. |

Each control must say whether it affects the current round, an active timer or the next round. Store these as settings rather than requiring code edits. Allow reusing the last setup and resetting to recommended defaults for the next round.

## Change things while playing

- Let the organiser pause immediately. Pause task actions, eliminations and all game timers together; resume from the saved state. Pausing alone does not discover bodies or turn them into ghosts.
- Allow safe numeric edits during play. Use a pause or meeting for changes to assignments, player states or who records outcomes.
- Apply changes to connected phones together and restore current settings on reconnect.
- Show a short public notice for a public rule change, such as “Discussion is now untimed”. Do not broadcast private corrections or hidden timers.
- Preview changes that could immediately end the round. Confirm the change and its consequence together; routine adjustments should not require repeated confirmations. Previews must not disclose a secret role or the winning team before the change is applied.
- Keep a small organiser change history without secret roles or hidden-state details. Allow undoing the latest correction where consistent; do not silently resume a round after roles have been revealed.

## Corrections and recovery — implemented

- **Fix a problem** (organiser controls, during a round): give everyone credit for, or remove, all unfinished tasks at a station (real and fake alike); mark a player back in the game or out (ghost), from a list that never shows current states; restore everyone's emergency meetings. Each needs a confirmation and rechecks the win conditions. Marking the Impostor out counts as catching them (crew wins).
- **End round** lets the organiser choose no winner, a crew win or an Impostor win.
- **Rejoin** (Room management, any phase): shows a one-time QR code and link, valid for 10 minutes, that puts a phone back in a player's place with the same role and tasks; the old session stops working.

- **Replace with new tasks** (Fix a problem): every unfinished task at the chosen station, real and fake alike, gets a new random puzzle, either spread over the other stations or at a station the organiser picks. Task counts and the goal stay the same.

## Organiser help — implemented

Three switches in **Settings → Organiser help**, each saved with the room and usable in any phase:

| Setting | Default | On | Off |
| --- | --- | --- | --- |
| Confirm wins before they end the round | Off | A detected win (task goal, Impostor out, too few Crewmates) pauses the round and clears any meeting. Players see “The organiser is checking the result”; only the organiser sees the proposed team and reason. **Confirm and reveal roles** ends it; **Not right, keep paused** leaves it paused for corrections. Resuming rechecks, and a correction or undo that removes the cause withdraws the proposal. | The round ends as soon as a win is detected, as before. |
| Preview fixes | On | Each Fix a problem confirmation and each player removal during a round runs the change in a rolled-back transaction and says whether the round would continue, end, or stop for confirmation, plus the new task goal. It never says which team or why, but the organiser who also plays may infer something from it. | Confirmations only describe possible effects. |
| Change history and undo | On | Fix a problem lists this round's fixes and player removals with times, without hidden states. **Undo** reverts the latest fix still in effect: credited tasks reopen, removed or replaced tasks return (unless a replacement was already completed), a player state returns only if nothing changed it since, and used emergency meetings are counted again. Removals are logged but cannot be undone and block undoing earlier fixes. A round that has ended cannot be undone. | No list and no undo. Changes are still recorded on the server. |

A departing Impostor still ends the round without a winner immediately; that is not a win, so it never waits for confirmation.

Still to build: adjusting or resetting an active timer, changing the task goal mid-round, organiser-recorded eliminations and hiding shared progress.

## Rescue a round

The organiser needs controls to:

- Credit, replace or exclude broken unfinished tasks, and disable an unusable station. Apply equivalent fake-list changes without identifying the Impostor.
- Correct accidental completion, elimination, meeting calls or recorded ejection. Use explicit outcome entry without displaying secret current states; pause affected play while correcting it.
- Adjust an active timer, restore an emergency meeting or resume after a mistaken report.
- Help a returning player reconnect to their existing place in the round.
- Mark someone as having left, adjust the remaining task goal and continue if the game still makes sense, or end without a winner.
- End a round manually and prepare a fresh one. A full role reveal ends the round.

Removing unfinished real tasks recalculates the percentage target against the retained real task set, preserving completed work. Show the resulting shared goal without exposing whose tasks contributed. Ghost tasks remain in the goal unless the ghost leaves or the organiser excludes a task. Replacing a task preserves the task count. Recheck victory after adjustments; if no real tasks remain, ask the organiser to end the round or supply replacement tasks rather than automatically award a task victory.

A temporary disconnect does not count as leaving or dying. Pause if someone cannot continue. An explicit departure removes the player from active participation. If a Crewmate leaves, remove their unfinished tasks, recalculate the goal and recheck victory. If the Impostor leaves, end without a winner; role disclosure happens only after the round ends. Preview a resulting round end without revealing its cause or team before applying the departure.

With organiser-confirmed victory, a detected win condition pauses the round for confirmation or correction. Do not continue normal play in a won state. A proposed result can disclose the winning team; full roles remain hidden until the result is confirmed. Once hidden information has been disclosed, restarting may be preferable to undoing a mistake.

## Later controls

If later mechanics are added, expose enable/disable switches, control-room viewing and activity-expiry times, sabotage cooldown, reactor duration and repair activation window. Disabling an active sabotage should clear its effect and countdown consistently. Do not build these controls before their mechanics exist.
