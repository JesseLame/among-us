import { randomInt, randomUUID } from 'node:crypto';
import type { CompleteTask, Eliminate, Lobby, Role, RoleInfo, RoundCommand, RoundResult, TaskPuzzle } from '../../shared/protocol.js';
import { advance, puzzle, shuffle, solved, type Codebook } from '../tasks/index.js';
import type { Base } from './base.js';
import type { Rules } from './rules.js';
import { GameError, taskContext, taskKindsFor, type Game, type Player, type TaskRow } from './shared.js';
import type { View } from './view.js';

// A round: starting and running it, private roles, eliminations, tasks and the progress tick.
export function createRound({ db, now, playerFor, gameFor, alreadyApplied, recordCommand, organiserFor }: Base, { progress, elapsed, settle }: Rules, { lobby }: View) {
  function assignTasks(game: Game, roundId: string, players: { id: string; role: Role }[]) {
    const stations = shuffle(db.prepare('SELECT id FROM stations WHERE game_code = ?').all(game.code) as { id: string }[]);
    const insert = db.prepare('INSERT INTO tasks (id, game_code, round_id, player_id, station_id, fake, puzzle, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const player of players) {
      // Spread each list across stations, with a mix of puzzle kinds. With more games than
      // tasks, each player gets a different random selection of them.
      const offset = randomInt(stations.length);
      const available = shuffle(taskKindsFor(game));
      const kinds = shuffle(Array.from({ length: game.tasks_per_player }, (_, index) => available[index % available.length]));
      kinds.forEach((kind, index) => insert.run(
        randomUUID(), game.code, roundId, player.id, stations[(offset + index) % stations.length].id,
        Number(player.role === 'impostor'), JSON.stringify(puzzle(kind, taskContext(game, stations[(offset + index) % stations.length].id, stations.map(entry => entry.id)))), index,
      ));
    }
  }
  // A role is fetched only when its owner explicitly reveals it. Public snapshots,
  // including the organiser's view, contain no roles until the round has ended.
  function role(token: string | undefined, roundId: string) {
    const player = playerFor(token);
    if (!player) throw new GameError('NO_SESSION', 401);
    const game = gameFor(player.game_code)!;
    if (game.round_id !== roundId) throw new GameError('STALE_COMMAND', 409);
    if (game.phase !== 'active' && game.phase !== 'paused' && game.phase !== 'meeting') throw new GameError('INVALID_PHASE', 409);
    if (!player.playing) throw new GameError('NOT_PLAYING', 409);
    const info: RoleInfo = { roundId, role: player.role! };
    if (player.role === 'impostor' && game.eliminations) {
      const ready = game.eliminate_ready_ms;
      const targets = db.prepare("SELECT id, name FROM players WHERE game_code = ? AND playing = 1 AND removed = 0 AND status = 'alive' AND id != ? ORDER BY joined_at, rowid")
        .all(game.code, player.id) as { id: string; name: string }[];
      info.elimination = { readyInMs: Math.max(0, ready - elapsed(game)), running: game.phase === 'active', targets };
    }
    return info;
  }
  // The Impostor records an elimination after the physical signal. Only the victim's
  // phone changes (to the body screen); nobody else is told, so no revision bump.
  const eliminatePlayer = db.transaction((token: string | undefined, input: Eliminate) => {
    const player = playerFor(token);
    if (!player) throw new GameError('NO_SESSION', 401);
    const game = gameFor(player.game_code)!;
    if (game.round_id !== input.roundId) throw new GameError('STALE_COMMAND', 409);
    if (player.role !== 'impostor' || !player.playing) throw new GameError('FORBIDDEN', 403);
    const payload = JSON.stringify(input);
    if (alreadyApplied(input.commandId, player.id, payload)) return { code: game.code, victim: input.targetId, ended: false };
    if (game.phase !== 'active') throw new GameError('INVALID_PHASE', 409);
    if (!game.eliminations) throw new GameError('ELIMINATIONS_OFF', 409);
    const at = elapsed(game);
    if (at < game.eliminate_ready_ms) throw new GameError('NOT_READY', 409);
    const target = db.prepare("SELECT * FROM players WHERE id = ? AND game_code = ? AND playing = 1 AND removed = 0 AND status = 'alive' AND id != ?")
      .get(input.targetId, game.code, player.id) as Player | undefined;
    if (!target) throw new GameError('PLAYER_NOT_FOUND', 404);
    db.prepare("UPDATE players SET status = 'body' WHERE id = ?").run(target.id);
    db.prepare('UPDATE games SET eliminate_ready_ms = ? WHERE code = ?').run(at + game.kill_cooldown * 1000, game.code);
    recordCommand(input.commandId, game.code, player.id, payload);
    const ended = settle(game.code);
    return { code: game.code, victim: target.id, ended };
  });
  const command = db.transaction((token: string | undefined, input: RoundCommand) => {
    const { player, game } = organiserFor(token);
    const payload = JSON.stringify(input);
    if (alreadyApplied(input.commandId, player.id, payload)) return lobby(token)!;
    if (input.expectedRevision !== game.revision || input.roundId !== game.round_id) throw new GameError('STALE_COMMAND', 409);

    let phase = game.phase;
    let roundId = game.round_id;
    let pauseReason: Lobby['pauseReason'] = null;
    let endReason: RoundResult['reason'] | null = null;
    switch (input.action) {
      case 'start': {
        if (phase !== 'lobby') throw new GameError('INVALID_PHASE', 409);
        const players = db.prepare('SELECT id, test FROM players WHERE game_code = ? AND removed = 0 AND playing = 1 ORDER BY rowid').all(game.code) as { id: string; test: number }[];
        // Test players are always Crewmates, so the Impostor is one of the real players.
        const real = players.filter(p => !p.test);
        if (real.length < 1) throw new GameError('NOT_ENOUGH_PLAYERS');
        if (!db.prepare('SELECT 1 FROM stations WHERE game_code = ?').get(game.code)) throw new GameError('NO_STATIONS');
        const impostor = real[randomInt(real.length)].id;
        const assign = db.prepare('UPDATE players SET role = ? WHERE id = ?');
        const roles = players.map(p => ({ id: p.id, role: (p.id === impostor ? 'impostor' : 'crewmate') as Role }));
        roles.forEach(p => assign.run(p.role, p.id));
        roundId = randomUUID(); phase = 'active';
        // Test players get no tasks, so the shared goal depends only on real players.
        assignTasks(game, roundId, roles.filter(p => !players.find(other => other.id === p.id)!.test));
        db.prepare("UPDATE players SET status = 'alive', emergency_used = 0 WHERE game_code = ?").run(game.code);
        db.prepare('UPDATE games SET winner = NULL, progress_shown = 0, progress_shown_at = ?, clock_ms = 0, clock_at = ?, eliminate_ready_ms = opening_protection * 1000 WHERE code = ?')
          .run(now(), now(), game.code);
        break;
      }
      case 'pause':
        if (phase !== 'active') throw new GameError('INVALID_PHASE', 409);
        db.prepare('UPDATE games SET clock_ms = ? WHERE code = ?').run(elapsed(game), game.code);
        phase = 'paused'; pauseReason = 'organiser'; break;
      case 'resume':
        // A detected win must be confirmed or rejected first.
        if (phase !== 'paused' || game.pause_reason === 'victory') throw new GameError('INVALID_PHASE', 409);
        db.prepare('UPDATE games SET clock_at = ? WHERE code = ?').run(now(), game.code);
        phase = 'active'; break;
      case 'endMeeting':
        // Discussion and the physical vote are over: play (and its clock) continues.
        if (phase !== 'meeting') throw new GameError('INVALID_PHASE', 409);
        db.prepare(`UPDATE games SET clock_at = ?, meeting_kind = NULL, meeting_by = NULL, meeting_at = NULL, meeting_ghosts = NULL,
          meeting_stage = NULL, meeting_votes = NULL, meeting_result = NULL WHERE code = ?`).run(now(), game.code);
        phase = 'active'; break;
      case 'end':
        if (phase !== 'active' && phase !== 'paused' && phase !== 'meeting') throw new GameError('INVALID_PHASE', 409);
        db.prepare('UPDATE games SET winner = ? WHERE code = ?').run(input.winner ?? null, game.code);
        phase = 'ended'; endReason = 'organiser'; break;
      case 'confirmResult':
        if (phase !== 'paused' || game.pause_reason !== 'victory' || !game.proposed_winner) throw new GameError('INVALID_PHASE', 409);
        db.prepare('UPDATE games SET winner = ? WHERE code = ?').run(game.proposed_winner, game.code);
        phase = 'ended'; endReason = game.proposed_reason; break;
      // Play stays paused so the organiser can correct the cause; resuming checks again.
      case 'rejectResult':
        if (phase !== 'paused' || game.pause_reason !== 'victory') throw new GameError('INVALID_PHASE', 409);
        pauseReason = 'organiser'; break;
      case 'reset':
        if (phase !== 'ended') throw new GameError('INVALID_PHASE', 409);
        phase = 'lobby'; roundId = null;
        db.prepare('DELETE FROM changes WHERE game_code = ?').run(game.code);
        db.prepare('DELETE FROM tasks WHERE game_code = ?').run(game.code);
        db.prepare('DELETE FROM players WHERE game_code = ? AND removed = 1').run(game.code);
        db.prepare('UPDATE players SET role = NULL WHERE game_code = ?').run(game.code);
        break;
    }
    db.prepare('UPDATE games SET phase = ?, round_id = ?, pause_reason = ?, end_reason = ?, proposed_winner = NULL, proposed_reason = NULL, revision = revision + 1 WHERE code = ?')
      .run(phase, roundId, pauseReason, endReason, game.code);
    // Resuming into a state that is still won stops again for confirmation (or ends it).
    if (input.action === 'resume') settle(game.code);
    recordCommand(input.commandId, game.code, player.id, payload);
    return lobby(token)!;
  });
  // Completing a task changes only the player's own list unless it wins the round.
  // Retrying a completed task is harmless, so no command receipt is needed.
  const completeTask = db.transaction((token: string | undefined, input: CompleteTask) => {
    const player = playerFor(token);
    if (!player) throw new GameError('NO_SESSION', 401);
    const game = gameFor(player.game_code)!;
    if (game.round_id !== input.roundId) throw new GameError('STALE_COMMAND', 409);
    if (game.phase !== 'active') throw new GameError('INVALID_PHASE', 409);
    if (player.status === 'body') throw new GameError('NOT_ALIVE', 409);
    const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND player_id = ? AND round_id = ?').get(input.taskId, player.id, game.round_id) as TaskRow | undefined;
    if (!task) throw new GameError('TASK_NOT_FOUND', 404);
    if (task.done_at !== null) return { lobby: lobby(token)!, ended: false };
    const current = JSON.parse(task.puzzle) as TaskPuzzle;
    // A step of a game with several steps: only this player's task changes, to its next step.
    const next = advance(current, input.answer);
    if (next) {
      db.prepare('UPDATE tasks SET puzzle = ?, station_id = COALESCE(?, station_id) WHERE id = ?').run(JSON.stringify(next.puzzle), next.station, task.id);
      return { lobby: lobby(token)!, ended: false };
    }
    const station = db.prepare('SELECT codebook FROM stations WHERE id = ?').get(task.station_id) as { codebook: string } | undefined;
    if (!solved(current, input.answer, station && JSON.parse(station.codebook) as Codebook)) throw new GameError('WRONG_ANSWER', 422);
    db.prepare('UPDATE tasks SET done_at = ? WHERE id = ?').run(now(), task.id);
    // A fake task never changes the result, so it never stops the round either.
    const ended = !task.fake && settle(game.code);
    return { lobby: lobby(token)!, ended };
  });
  // Publishes shared progress on a fixed cadence while play is active, whether or
  // not it changed, so the publication time does not hint at a recent completion.
  // Returns the games whose public progress changed.
  function tick() {
    const changed: string[] = [];
    // Keep the play clock current so a crash loses at most one tick of active time.
    db.prepare("UPDATE games SET clock_ms = clock_ms + MAX(0, ? - clock_at), clock_at = ? WHERE phase = 'active'").run(now(), now());
    const due = db.prepare("SELECT * FROM games WHERE phase = 'active' AND ? - progress_shown_at >= progress_interval * 1000").all(now()) as Game[];
    for (const game of due) {
      const { done } = progress(game);
      db.prepare('UPDATE games SET progress_shown = ?, progress_shown_at = ? WHERE code = ?').run(done, now(), game.code);
      if (done !== game.progress_shown) changed.push(game.code);
    }
    return changed;
  }

  return { command, role, eliminatePlayer, completeTask, tick };
}
