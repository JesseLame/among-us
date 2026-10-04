# Game rules

[Project overview](../README.md)

Default house rules for the first playable version. This is a family game: timings and app involvement are adjustable before and during play through [organiser controls](organiser-controls.md). Task mechanics are in [Tasks and the control room](tasks-and-control-room.md).

## Players and approach

Start with 6–8 players and one Impostor. For testing, the app also allows starting with 1–5 players; a solo tester is the Impostor. Everyone can play, including the organiser. Aim for rounds of about 15–25 minutes, then adjust based on playtests. Keep movement and conversation central; use clear puzzles without fiddly controls or fast reactions.

The first version has tasks, eliminations and meetings. Reactor sabotage is built and can be switched off by the organiser; the control room and communications sabotage remain later ideas, below and in the task document.

| Setting | Starting value, adjustable by the organiser |
| --- | --- |
| Roles | 1 Impostor; everyone else a Crewmate |
| Tasks | 4 per Crewmate; mostly short interactions, with a few longer physical puzzles |
| Shared task target | 80% of assigned real tasks, rounded up |
| Opening protection / elimination cooldown | 60 seconds / 60 seconds |
| Meeting discussion | 90 seconds, then a physical vote; untimed discussion also available |
| Emergency meetings | 1 per living player per round |

Task duration is a playtest question, not a fixed 45–90-second requirement. Observe total phone time, walking and opportunities to see other players.

## Prepare the house

Set up 4–6 task stations with a printed QR code, room name and recognisable symbol. Choose a central meeting area. Control and repair stations are for later mechanics only.

Spread stations so players move between rooms, with a mix of shared sightlines and quieter spots. Avoid putting every task in one place or creating long queues. Check walking distances and provide duplicate or resettable materials for shared puzzles.

Prepare visible body and ghost markers and the game lobby. Explain boundaries and the elimination signal. Walk rather than run; stairs and bathrooms are off limits for eliminations.

Before the first real round, practise scanning, solving, reporting and physical voting without secret roles. Then clear the practice state and assign roles for a fresh round.

## Start the round

Players join through a shared link or QR code, enter a name and privately view their role. Crewmates receive tasks; the Impostor gets a believable fake list. The organiser starts the round and opening protection.

Explain any changes from the default rules before starting. Mid-round public rule changes appear on everyone's phone; private role and elimination information stays private.

## Eliminating a player

The Impostor discreetly shows their role screen to a nearby living Crewmate and quietly says “You're out”. No touching is required. One player can be eliminated per configured cooldown, never during opening protection, a meeting or an organiser pause.

By default, the Impostor records the victim in the app to start the cooldown and update the game state. *(Implemented: the Eliminate panel appears only in the Impostor's revealed role card; opening protection and cooldown count active play time only. Organiser-entered eliminations are not built yet.)* No public announcement is made. The physical signal tells the victim they are out. Organiser-entered eliminations are an optional mode, with the information-sharing tradeoff described in [organiser controls](organiser-controls.md).

The victim stays nearby, safely seated or standing, with a body marker. They remain silent and cannot point, reveal the Impostor or give clues. At the next meeting, all bodies become marked ghosts and can resume tasks after the meeting. Ejected Crewmates become ghosts immediately but wait for the meeting to end before doing tasks.

## Reporting and discussion

A living player finding a body calls “Body found!” and uses Report body, or the organiser records the out-loud report when organiser-led meetings are selected. Everyone gathers in the meeting area. Task actions, eliminations and all game timers pause except the discussion timer.

Each living player also has the configured emergency meeting allowance. Ghosts cannot call meetings. Discuss for the configured duration or until the organiser moves an untimed discussion to voting. Living players can describe observations, question others and bluff. Ghosts cannot discuss or vote.

## Voting

On a countdown, all living players simultaneously point at a player or cross their arms to skip. The unique highest vote total determines the result. If a player wins the vote, they are ejected. If skip wins or the highest totals tie, nobody is ejected.

The organiser records the physical result and resumes play if nobody has won. *(Implemented, including an optional in-app phone vote whose results appear on the host screen.)* In the default automatic mode, ejecting the Impostor ends the round. Organiser-confirmed results are also available. In-app voting is for later.

## Win conditions

| Team | Default win condition |
| --- | --- |
| Crewmates | The Impostor is ejected, or the shared task target is reached. |
| Impostor | At most one living Crewmate remains alongside them. |

With six players, five Crewmates receive 20 tasks and need to complete 16 at the default target. Ghost completions count; fake tasks do not. Check wins after recorded game events. Automatic announcements are the default; organiser-confirmed mode pauses at a win condition for confirmation or correction.

The organiser can adjust the goal or end the round manually, including without a winner. Task removal, departures and corrections follow [organiser controls](organiser-controls.md), so the goal stays reachable. A temporary disconnect never counts as death or departure.

## Sabotage

**Built: reactor meltdown, once per round** (organiser switch, on by default; countdown adjustable). The repair window is fixed at 10 seconds and there is no sabotage cooldown, because the Impostor gets one meltdown per round. Any two different stations work as repair panels. If the organiser rejects a proposed meltdown win, that meltdown is switched off. Communications sabotage depends on adding the control room and remains a later idea.

| Setting | Value |
| --- | --- |
| Reactor countdown | 90 seconds of active play (organiser: 30–600) |
| Reactor repair activation window | 10 seconds (fixed) |
| Sabotage cooldown | Not needed while there is one meltdown per round |

The Impostor secretly triggers sabotage. Everyone sees the same alert without learning who caused it. Only one sabotage can be active; none starts during opening protection, meetings or an organiser pause.

| Sabotage | Effect | Repair |
| --- | --- | --- |
| Communications failure | Control-room display unavailable; tasks continue. | Solve a short puzzle at the designated repair station. |
| Reactor emergency | If its countdown expires, the Impostor wins. | Two different living players activate repair panels in separate rooms within the configured window. |

Players must physically remain at repair stations while using them. A missed activation window can be retried while time remains. The Impostor may repair, so helping does not prove innocence. Ghosts cannot repair. Eliminations remain possible during active sabotage when cooldown permits.

**Body reports still start a meeting during reactor sabotage.** Pause the reactor countdown along with gameplay; resume its remaining time after the meeting if the round continues. Clear partial repair activations on entering a meeting so players must return to the stations and activate again. Emergency meetings are unavailable during a reactor emergency. This replaces the earlier idea of delaying body-report meetings until repair.

Task completions can still be recorded during an active reactor emergency, but task victory waits until repair. Check the pending task win when the reactor is repaired or the organiser disables it. Ejecting the Impostor still ends the round. An organiser pause freezes all sabotage timers, and disabling an active sabotage clears its effect without causing a reactor loss.
