# Organiser controls

[Project overview](../README.md)

This is our home game. The organiser should be able to say “that puzzle isn't working” or “let's discuss for longer” and adjust the round immediately. Flexibility is a core first-version requirement. Keep the controls practical enough to use on a phone while also playing.

## Room management — implemented

The organiser has a **Room management / Kamerbeheer** panel in the lobby and during every round phase.

- **Remove player:** confirm the named player before revoking their session. Ordinary players cannot use this action; the organiser cannot remove themselves. Before a round, the player disappears from the roster. During a round, removing a Crewmate pauses play without reshuffling roles; removing the Impostor ends without a winner. The same confirmation explains the possible pause or round end for every player, without disclosing a role. Removed participants appear in the final role reveal and are excluded when preparing the next lobby.
- **Delete room:** confirm that everyone, including the organiser, will lose the room. Delete its player records, round state and command history, invalidate the invitation and return connected players to the join screen. An offline player's session is rejected on return. No role reveal is sent as part of deletion.
- These are server-authorised actions tied to the current room and revision. An old confirmation cannot remove someone or delete a different/newer room. Retried player removals apply once.
- Removal revokes a session, not the person's ability to join. They can join as a new player with the code while the lobby is open. Lost-session recovery and organiser transfer remain unimplemented.

Task recalculation and departure-triggered victory checks below remain requirements for the future game loop; there are no tasks or victory rules to recalculate in the current scaffold.

## Choose how much happens in the app

These choices are independent rather than one all-or-nothing mode.

| Area | Default | Organiser option |
| --- | --- | --- |
| Station access | Scan the room QR; manual fallback available. | Use manual room selection throughout. Physical presence still applies. |
| Task completion | App checks a puzzle or physical answer. | Organiser records an announced completion or grants completion for a broken task. Fake tasks still never count. |
| Eliminations | Impostor records the victim after the physical signal. | Organiser records a privately communicated outcome; this can disclose information to an organiser who is playing. |
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
