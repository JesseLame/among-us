import { randomInt, randomUUID } from 'node:crypto';
import type { ChangePreview, Correction, RoomCommand } from '../../shared/protocol.js';
import { puzzle } from '../tasks/index.js';
import type { Base } from './base.js';
import type { Rooms } from './rooms.js';
import type { Rules } from './rules.js';
import { GameError, taskContext, taskKindsFor, type ChangeRow, type Game, type Player, type TaskRow } from './shared.js';

const TASK_COLUMNS = 'id, game_code, round_id, player_id, station_id, fake, puzzle, position, done_at';
type FullTask = TaskRow & { game_code: string; round_id: string; position: number };
// Thrown to roll back a preview after measuring its effect.
class DryRun extends Error { constructor(public preview: ChangePreview) { super('DRY_RUN'); } }

// Organiser corrections, their undo, and previews of a correction or a player removal.
export function createCorrections({ db, now, gameFor, alreadyApplied, recordCommand, organiserFor, logChange }: Base, { progress, settle }: Rules, { manageRoom }: Rooms) {
  // Organiser corrections. Each is applied to the whole room and returns no detail
  // about the hidden state it touched; win conditions are checked afterwards. Each is
  // logged with what is needed to undo it, which stays on the server.
  const correct = db.transaction((token: string | undefined, input: Correction) => {
    const { player: organiser, game } = organiserFor(token);
    const payload = JSON.stringify(input);
    if (alreadyApplied(input.commandId, organiser.id, payload)) return game.code;
    if (game.round_id !== input.roundId || game.revision !== input.expectedRevision) throw new GameError('STALE_COMMAND', 409);
    if (game.phase !== 'active' && game.phase !== 'paused' && game.phase !== 'meeting') throw new GameError('INVALID_PHASE', 409);
    const stations = db.prepare('SELECT id, name FROM stations WHERE game_code = ? ORDER BY position').all(game.code) as { id: string; name: string }[];
    const stationNamed = (id: string) => {
      const station = stations.find(entry => entry.id === id);
      if (!station) throw new GameError('INVALID_INPUT');
      return station.name;
    };
    const unfinished = (stationId: string) => db.prepare(`SELECT ${TASK_COLUMNS} FROM tasks WHERE station_id = ? AND round_id = ? AND done_at IS NULL`)
      .all(stationId, game.round_id) as FullTask[];
    switch (input.action) {
      case 'creditStation': {
        const station = stationNamed(input.stationId);
        const at = now();
        const credited = unfinished(input.stationId).map(task => task.id);
        db.prepare('UPDATE tasks SET done_at = ? WHERE station_id = ? AND round_id = ? AND done_at IS NULL').run(at, input.stationId, game.round_id);
        logChange(game, 'creditStation', { station }, { tasks: credited, at });
        break;
      }
      case 'removeStationTasks': {
        const station = stationNamed(input.stationId);
        const removed = unfinished(input.stationId);
        db.prepare('DELETE FROM tasks WHERE station_id = ? AND round_id = ? AND done_at IS NULL').run(input.stationId, game.round_id);
        logChange(game, 'removeStationTasks', { station }, { tasks: removed });
        break;
      }
      case 'replaceStationTasks': {
        // Fake tasks are replaced the same way, so the change reveals nothing.
        const station = stationNamed(input.stationId);
        const target = input.targetStationId ? stationNamed(input.targetStationId) : undefined;
        const others = stations.filter(entry => entry.id !== input.stationId).map(entry => entry.id);
        const old = unfinished(input.stationId);
        db.prepare('DELETE FROM tasks WHERE station_id = ? AND round_id = ? AND done_at IS NULL').run(input.stationId, game.round_id);
        const insert = db.prepare('INSERT INTO tasks (id, game_code, round_id, player_id, station_id, fake, puzzle, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        const available = taskKindsFor(game);
        const pairs = old.map(task => {
          const stationId = input.targetStationId ?? (others.length ? others[randomInt(others.length)] : input.stationId);
          const replacement = randomUUID();
          insert.run(replacement, game.code, game.round_id, task.player_id, stationId, task.fake, JSON.stringify(puzzle(available[randomInt(available.length)], taskContext(game, stationId, stations.map(entry => entry.id)))), task.position);
          return { old: task, replacement };
        });
        logChange(game, 'replaceStationTasks', { station, ...(target ? { target } : {}) }, { pairs });
        break;
      }
      case 'setStatus': {
        const target = db.prepare('SELECT * FROM players WHERE id = ? AND game_code = ? AND playing = 1 AND removed = 0').get(input.playerId, game.code) as Player | undefined;
        if (!target) throw new GameError('PLAYER_NOT_FOUND', 404);
        // Marking the Impostor out records a catch the app missed: the crew wins.
        db.prepare('UPDATE players SET status = ? WHERE id = ?').run(input.status, target.id);
        logChange(game, 'setStatus', { player: target.name, status: input.status }, { player: target.id, from: target.status, to: input.status });
        break;
      }
      case 'restoreEmergency': {
        const used = db.prepare('SELECT id, emergency_used FROM players WHERE game_code = ? AND emergency_used > 0').all(game.code) as { id: string; emergency_used: number }[];
        db.prepare('UPDATE players SET emergency_used = 0 WHERE game_code = ?').run(game.code);
        logChange(game, 'restoreEmergency', {}, { used: used.map(player => [player.id, player.emergency_used]) });
        break;
      }
      case 'undo':
        undo(game, input.changeId);
        break;
    }
    if (!settle(game.code)) db.prepare('UPDATE games SET revision = revision + 1 WHERE code = ?').run(game.code);
    recordCommand(input.commandId, game.code, organiser.id, payload);
    return game.code;
  });
  // Reverts the latest change still in effect. Each step only touches what the correction
  // itself changed and has not changed since: a credited task is reopened only if it still
  // has the credit's time, a replacement only if nobody completed it yet, a player state only
  // if it is still the one the correction set.
  function undo(game: Game, changeId: number) {
    if (!game.change_history) throw new GameError('UNDO_UNAVAILABLE', 409);
    const row = db.prepare('SELECT * FROM changes WHERE game_code = ? AND round_id = ? AND undone = 0 ORDER BY id DESC LIMIT 1').get(game.code, game.round_id) as ChangeRow | undefined;
    if (!row || row.id !== changeId || !row.undo) throw new GameError('UNDO_UNAVAILABLE', 409);
    const data = JSON.parse(row.undo);
    const restore = (task: FullTask) => {
      // Tasks of a player who has since left stay gone, like their other unfinished tasks.
      if (!db.prepare('SELECT 1 FROM players WHERE id = ? AND removed = 0').get(task.player_id)) return;
      db.prepare(`INSERT INTO tasks (${TASK_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(task.id, task.game_code, task.round_id, task.player_id, task.station_id, task.fake, task.puzzle, task.position, task.done_at);
    };
    switch (row.action) {
      case 'creditStation': {
        const reopen = db.prepare('UPDATE tasks SET done_at = NULL WHERE id = ? AND done_at = ?');
        for (const id of data.tasks as string[]) reopen.run(id, data.at);
        break;
      }
      case 'removeStationTasks':
        (data.tasks as FullTask[]).forEach(restore);
        break;
      case 'replaceStationTasks':
        for (const pair of data.pairs as { old: FullTask; replacement: string }[]) {
          if (db.prepare('DELETE FROM tasks WHERE id = ? AND done_at IS NULL').run(pair.replacement).changes) restore(pair.old);
        }
        break;
      case 'setStatus':
        db.prepare('UPDATE players SET status = ? WHERE id = ? AND status = ?').run(data.from, data.player, data.to);
        break;
      case 'restoreEmergency': {
        const add = db.prepare('UPDATE players SET emergency_used = emergency_used + ? WHERE id = ?');
        for (const [id, used] of data.used as [string, number][]) add.run(used, id);
        break;
      }
    }
    db.prepare('UPDATE changes SET undone = 1 WHERE id = ?').run(row.id);
  }
  // Previews run the real change inside a transaction that is always rolled back, so a
  // preview and the change itself cannot disagree. The answer says only whether the round
  // would end (or stop for confirmation) and the resulting task goal.
  function dryRun(token: string | undefined, apply: () => string): ChangePreview {
    const { game } = organiserFor(token);
    if (!game.change_previews) throw new GameError('PREVIEWS_OFF', 409);
    const attempt = db.transaction(() => {
      const after = gameFor(apply());
      throw new DryRun({
        outcome: !after || after.phase === 'ended' ? 'ends' : after.pause_reason === 'victory' ? 'proposes' : 'continues',
        goal: after?.round_id ? progress(after).goal : null,
      });
    });
    try { attempt(); }
    catch (error) {
      if (error instanceof DryRun) return error.preview;
      throw error;
    }
    throw new Error('Preview did not finish');
  }
  const previewCorrection = (token: string | undefined, input: Correction) => dryRun(token, () => correct(token, input));
  const previewRemoval = (token: string | undefined, input: RoomCommand) => {
    if (input.action !== 'remove') throw new GameError('INVALID_INPUT');
    return dryRun(token, () => manageRoom(token, input).code);
  };

  return { correct, previewCorrection, previewRemoval };
}
