# Tasks and the control room

[Project overview](../README.md)

## First version — the task loop

Choose an assigned task, go to its room and scan the station QR code. Scanning opens the task; solving it completes it. Stay at the station while doing the task. The app records completion and updates shared progress according to the organiser's display settings.

Manual room selection is available when scanning fails or the organiser prefers it. Physical presence still applies. This family game relies on agreed house rules rather than trying to prove a phone's location.

| First-version type | Example | Default completion |
| --- | --- | --- |
| Phone puzzle | Solve a sequence or matching puzzle after scanning the room QR. | App checks the solution. |
| Physical puzzle with an answer | Use printed clues or arrange pieces to discover a code. | Enter the answer; app checks it. |

### Implemented puzzle set

| Puzzle | Type | How it works |
| --- | --- | --- |
| Number order | Phone | Six numbered lights are scattered over a panel; switch them on from smallest to largest and a line joins them. A wrong tap makes the lights flicker off and restarts without penalty. |
| Fix the wiring | Phone | Drag each of four wires to the socket of the same colour; a cable follows the finger and a wrong socket shakes. Tapping a wire then its socket, or the keyboard, works too. Colour names are always shown, not only swatches. |
| Simon says | Phone | Four coloured pads, each with its own shape. After **Start** the phone lights a sequence with a soft tone per pad; the player repeats it. Each round adds one pad, up to five. A wrong pad flickers and replays the same round. |
| Maze | Phone | A 6 × 6 maze with one route from the left edge to the flag on the right edge. The player moves a light with the arrow pad, the arrow keys or a swipe; a wall stops the light and says so. Walking back over the route undoes those steps, so the answer sent is the direct route, which the server checks against the walls. |
| Codebook | Physical answer | Each station has a printed sheet of 12 symbols, each with a digit. The task shows a safe with four symbol slots; the player keys in the digits on the keypad (or keyboard) to open it. A wrong code shakes and clears the display. Players share one sheet but get different symbols. |

The organiser chooses which games are handed out in the **Task games** list (all on by default, at least one stays on; see `organiser-controls.md`).

Every game can be tried without a room at `/practice` (see the README). Solved puzzles stay on screen briefly in their finished state before returning to the task list.

Each player receives four tasks spread across the stations, cycling through a random order of the games that are on: with four or more games on, all four are different. The organiser prints the materials from **Print materials** in the organiser controls: a join poster, one A4 sheet per station (QR code plus codebook) and cut-out body/ghost markers. A sheet stays valid until that station is removed or the room is deleted, so reprint only after adding a station. Scanning a station's QR code with the phone camera opens the app at that station: the only open task there opens directly, otherwise that station's tasks are listed first.

**In-app scanner:** **Scan station QR** in the task list scans inside the app, so the session and browser always match. Browsers allow live camera video only over HTTPS (or `localhost`); on the home network over plain HTTP the button opens the phone camera to take a photo of the code, which the app reads. `npm run play:https` serves the game over HTTPS with a self-signed certificate so live scanning works on phones too, after a one-time browser warning per phone. Taking a photo is also offered next to live scanning. Scanning with the phone's own camera app keeps working.

**Station access is QR-only by default:** the task list shows where each task is, but a task only opens after scanning its station. The player stays at the last scanned station (also through a pause) until scanning another or the round ends. The organiser can switch on **Open tasks without scanning** in the organiser controls at any time; then every task opens from the list. When scanning with the phone's own camera app instead, players must have joined in the phone's default browser, because the camera app opens QR links there.

Start with a small puzzle set, mostly short interactions and some longer physical puzzles. Do not require every task to last 45–90 seconds. Give players different questions using shared materials where practical. Make tasks easy to reset or provide duplicate materials to avoid queues.

No host needs to inspect each task by default. The organiser can choose manual completion entry, or credit, replace or exclude a broken task during a round. These recovery controls belong in the first version; a general player-facing trust-based task type is for later. See [organiser controls](organiser-controls.md).

## Fake tasks and shared progress

The Impostor can open and appear to complete fake tasks, but they never increase the crew total. Fake task screens and organiser correction pickers must not identify which tasks contribute to victory.

Avoid public per-player completion indicators. By default, show shared progress in occasional batches so one tap cannot prove innocence; the organiser can change the interval or hide progress. Implemented: progress publishes every 30 seconds of active play on a fixed cadence, whether or not it changed; the interval and hiding controls are not built yet. Internal victory checks still happen after each completion, even when the visible progress display is delayed.

## Ghost activity

Ghosts can complete remaining tasks after the meeting ends. Their completions count toward the shared target. They cannot discuss, vote or call meetings. A body waiting for discovery cannot do tasks yet.

Observe how long eliminated players wait before becoming ghosts during playtests. If waiting is consistently boring, revisit the body rule before adding more mechanics. A ghost who leaves is handled through the explicit departure controls so their unfinished tasks do not make the goal unreachable.

## Later — control room, outside the first build

Evaluate this only after testing whether movement and discussion already create useful clues. It is optional; no activity-tracking infrastructure is required for the first version.

Scanning the control-room QR opens a proposed 20-second view of anonymous recent task activity by room, for example “Kitchen: 2 recent task sessions”. Fake tasks appear in the same way as real tasks. Viewing duration and activity expiry are configurable if this feature is built.

This is a clue, not live location tracking. Scans and open tasks cannot prove someone is still in a room. Old activity expires, and the display clearly indicates how recent it is. Decide the expiry window through playtesting.

Players remain at the control station to view it and scan again when the session ends. Using it costs time that could be spent completing tasks. It does not show names, roles, individual completion or whether someone has been eliminated.

Ghosts cannot use the control room or create new sightings through their task activity. Death must not create a public notification or an immediate special change in the display; existing sightings expire normally. If later sabotage is enabled, ghosts cannot repair it either.

## Later — other task and information ideas

| Idea | Status and rationale |
| --- | --- |
| Trust-based physical tasks | Later. Sorting supplies or stacking objects with a player-facing Completed button; first test app-checked answers and organiser recovery. |
| Paired tasks | Later. Two players cooperate; assess after ordinary tasks work well. |
| Multi-room tasks | Later. Find information in one room and use it elsewhere; assess walking time first. |
| Named scan history | Parked, not recommended for now. Retained as an idea, but it could make accusations depend on app logs rather than observations. Revisit only if playtests demonstrate a need. |
