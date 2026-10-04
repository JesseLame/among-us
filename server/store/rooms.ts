import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { PrintableStation, RoomCommand, SettingsCommand, StationCommand } from '../../shared/protocol.js';
import type { Codebook } from '../tasks/index.js';
import type { Base } from './base.js';
import { addStations } from './db.js';
import type { Rules } from './rules.js';
import { DEFAULT_STATIONS, GameError, hash, MAX_STATIONS, type Player } from './shared.js';
import type { View } from './view.js';

// Rooms and their people: creating, joining and rejoining, removing players, deleting the
// room, stations and settings.
export function createRooms({ db, now, gameFor, alreadyApplied, recordCommand, organiserFor, logChange }: Base, { elapsed, endRound, settle }: Rules, { lobby }: View) {
  function addPlayer(code: string, name: string, organiser: boolean, playing = true) {
    const token = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO players (id, game_code, name, organiser, playing, session_hash, joined_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), code, name, Number(organiser), Number(playing), hash(token), Date.now());
    db.prepare('UPDATE games SET revision = revision + 1 WHERE code = ?').run(code);
    return { token, lobby: lobby(token)! };
  }
  const create = db.transaction((name: string, language: keyof typeof DEFAULT_STATIONS = 'en', playing = true) => {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code: string;
    do { code = Array.from({ length: 5 }, () => alphabet[randomInt(alphabet.length)]).join(''); }
    while (db.prepare('SELECT code FROM games WHERE code = ?').get(code));
    db.prepare('INSERT INTO games (code) VALUES (?)').run(code);
    addStations(db, code, DEFAULT_STATIONS[language]);
    return addPlayer(code, name, true, playing);
  });
  const join = db.transaction((code: string, name: string) => {
    const game = gameFor(code);
    if (!game) throw new GameError('GAME_NOT_FOUND', 404);
    if (game.phase !== 'lobby') throw new GameError('ROUND_IN_PROGRESS', 409);
    const players = db.prepare('SELECT name, playing FROM players WHERE game_code = ? AND removed = 0').all(code) as { name: string; playing: number }[];
    // A host-only organiser does not take one of the eight player places.
    if (players.filter(p => p.playing).length >= 8) throw new GameError('GAME_FULL');
    if (players.some(p => p.name.toLocaleLowerCase('en') === name.toLocaleLowerCase('en'))) throw new GameError('NAME_TAKEN');
    return addPlayer(code, name, false);
  });
  // A player who lost their session (phone died, browser closed) takes their place again
  // with a one-time code from the organiser. Their old session stops working.
  const rejoinPlayer = db.transaction((code: string) => {
    const player = db.prepare('SELECT * FROM players WHERE rejoin_code = ? AND removed = 0').get(code) as (Player & { rejoin_expires: number }) | undefined;
    if (!player || player.rejoin_expires < now()) throw new GameError('REJOIN_EXPIRED', 404);
    const token = randomBytes(32).toString('hex');
    db.prepare('UPDATE players SET session_hash = ?, rejoin_code = NULL, rejoin_expires = NULL WHERE id = ?').run(hash(token), player.id);
    return { token, lobby: lobby(token)! };
  });
  const manageRoom = db.transaction((token: string | undefined, input: RoomCommand) => {
    const { player: organiser, game } = organiserFor(token);
    if (input.code !== game.code) throw new GameError('STALE_COMMAND', 409);
    const payload = JSON.stringify(input);
    if (alreadyApplied(input.commandId, organiser.id, payload)) return { code: game.code, lobby: lobby(token) };
    if (game.revision !== input.expectedRevision || game.round_id !== input.roundId) throw new GameError('STALE_COMMAND', 409);
    if (input.action === 'destroy') {
      db.prepare('DELETE FROM command_receipts WHERE game_code = ?').run(game.code);
      db.prepare('DELETE FROM changes WHERE game_code = ?').run(game.code);
      db.prepare('DELETE FROM tasks WHERE game_code = ?').run(game.code);
      db.prepare('DELETE FROM stations WHERE game_code = ?').run(game.code);
      db.prepare('DELETE FROM players WHERE game_code = ?').run(game.code);
      db.prepare('DELETE FROM games WHERE code = ?').run(game.code);
      return { code: game.code, lobby: null };
    }
    if (input.action === 'addTestPlayer') {
      if (game.phase !== 'lobby') throw new GameError('INVALID_PHASE', 409);
      const players = db.prepare('SELECT name, playing FROM players WHERE game_code = ? AND removed = 0').all(game.code) as { name: string; playing: number }[];
      if (players.filter(p => p.playing).length >= 8) throw new GameError('GAME_FULL');
      let number = 1;
      while (players.some(p => p.name.toLocaleLowerCase('en') === `test ${number}`)) number++;
      // The session token is never handed out: nobody can sign in as a test player.
      db.prepare('INSERT INTO players (id, game_code, name, organiser, playing, test, session_hash, joined_at) VALUES (?, ?, ?, 0, 1, 1, ?, ?)')
        .run(randomUUID(), game.code, `Test ${number}`, hash(randomBytes(32).toString('hex')), Date.now());
      db.prepare('UPDATE games SET revision = revision + 1 WHERE code = ?').run(game.code);
      recordCommand(input.commandId, game.code, organiser.id, payload);
      return { code: game.code, lobby: lobby(token) };
    }
    if (input.action === 'rejoinCode') {
      const player = db.prepare('SELECT * FROM players WHERE id = ? AND game_code = ? AND removed = 0 AND test = 0 AND organiser = 0').get(input.playerId, game.code) as Player | undefined;
      if (!player) throw new GameError('PLAYER_NOT_FOUND', 404);
      // Unambiguous characters only; valid for one use within ten minutes.
      const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
      const code = Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join('');
      db.prepare('UPDATE players SET rejoin_code = ?, rejoin_expires = ? WHERE id = ?').run(code, now() + 10 * 60 * 1000, player.id);
      recordCommand(input.commandId, game.code, organiser.id, payload);
      return { code: game.code, lobby: lobby(token), rejoin: code };
    }
    const target = db.prepare('SELECT * FROM players WHERE id = ? AND game_code = ? AND removed = 0').get(input.playerId, game.code) as Player | undefined;
    if (!target) throw new GameError('PLAYER_NOT_FOUND', 404);
    if (target.organiser) throw new GameError('CANNOT_REMOVE_ORGANISER');
    if (game.phase === 'lobby') {
      db.prepare('DELETE FROM players WHERE id = ?').run(target.id);
    } else {
      // Keep the departed player's role for the eventual public reveal. Their
      // session is revoked immediately and their identity is never reclaimable.
      db.prepare('UPDATE players SET removed = 1 WHERE id = ?').run(target.id);
      // Unfinished tasks leave with the player so the shared goal stays reachable;
      // completed work still counts.
      db.prepare('DELETE FROM tasks WHERE player_id = ? AND done_at IS NULL').run(target.id);
    }
    if (game.phase === 'active' || game.phase === 'paused' || game.phase === 'meeting') {
      logChange(game, 'removePlayer', { player: target.name });
      // A departure is not a win, so it never waits for confirmation.
      if (target.role === 'impostor') endRound(game.code, null, 'departure');
      else if (settle(game.code)) { /* Ended, or stopped for the organiser to confirm the result. */ }
      // A meeting simply continues without them; its clock is already stopped.
      else if (game.phase === 'meeting') db.prepare('UPDATE games SET revision = revision + 1 WHERE code = ?').run(game.code);
      else {
        // Pausing stops the play clock where it is.
        db.prepare("UPDATE games SET phase = 'paused', pause_reason = 'organiser', clock_ms = ?, revision = revision + 1 WHERE code = ?").run(elapsed(game), game.code);
      }
    } else db.prepare('UPDATE games SET revision = revision + 1 WHERE code = ?').run(game.code);
    recordCommand(input.commandId, game.code, organiser.id, payload);
    return { code: game.code, lobby: lobby(token) };
  });
  const manageStations = db.transaction((token: string | undefined, input: StationCommand) => {
    const { player: organiser, game } = organiserFor(token);
    const payload = JSON.stringify(input);
    if (alreadyApplied(input.commandId, organiser.id, payload)) return lobby(token)!;
    if (game.revision !== input.expectedRevision || game.round_id !== input.roundId) throw new GameError('STALE_COMMAND', 409);
    if (game.phase !== 'lobby') throw new GameError('INVALID_PHASE', 409);
    const stations = db.prepare('SELECT id, name FROM stations WHERE game_code = ?').all(game.code) as { id: string; name: string }[];
    if (input.action === 'add') {
      if (stations.length >= MAX_STATIONS) throw new GameError('TOO_MANY_STATIONS');
      if (stations.some(station => station.name.toLocaleLowerCase('en') === input.name.toLocaleLowerCase('en'))) throw new GameError('STATION_EXISTS');
      addStations(db, game.code, [input.name]);
    } else {
      if (!stations.some(station => station.id === input.stationId)) throw new GameError('INVALID_INPUT');
      db.prepare('DELETE FROM stations WHERE id = ?').run(input.stationId);
    }
    db.prepare('UPDATE games SET revision = revision + 1 WHERE code = ?').run(game.code);
    recordCommand(input.commandId, game.code, organiser.id, payload);
    return lobby(token)!;
  });
  // Settings can change in any phase; every phone receives them with the next update.
  const changeSettings = db.transaction((token: string | undefined, input: SettingsCommand) => {
    const { player: organiser, game } = organiserFor(token);
    const payload = JSON.stringify(input);
    if (alreadyApplied(input.commandId, organiser.id, payload)) return lobby(token)!;
    if (game.revision !== input.expectedRevision || game.round_id !== input.roundId) throw new GameError('STALE_COMMAND', 409);
    if ((input.tasksPerPlayer !== undefined || input.taskGoalPercent !== undefined) && game.phase !== 'lobby') throw new GameError('INVALID_PHASE', 409);
    const flag = (value: boolean | undefined) => value === undefined ? null : Number(value);
    db.prepare(`UPDATE games SET station_access = COALESCE(?, station_access), eliminations = COALESCE(?, eliminations),
      body_reports = COALESCE(?, body_reports), emergency_meetings = COALESCE(?, emergency_meetings), phone_voting = COALESCE(?, phone_voting),
      opening_protection = COALESCE(?, opening_protection), kill_cooldown = COALESCE(?, kill_cooldown),
      discussion_time = COALESCE(?, discussion_time), emergency_allowance = COALESCE(?, emergency_allowance),
      progress_interval = COALESCE(?, progress_interval), tasks_per_player = COALESCE(?, tasks_per_player),
      task_goal_percent = COALESCE(?, task_goal_percent), confirm_victory = COALESCE(?, confirm_victory),
      change_previews = COALESCE(?, change_previews), change_history = COALESCE(?, change_history), simon_tasks = COALESCE(?, simon_tasks), revision = revision + 1 WHERE code = ?`)
      .run(input.stationAccess ?? null, flag(input.eliminations), flag(input.bodyReports), flag(input.emergencyMeetings), flag(input.phoneVoting),
        input.openingProtection ?? null, input.killCooldown ?? null, input.discussionTime ?? null, input.emergencyAllowance ?? null,
        input.progressInterval ?? null, input.tasksPerPlayer ?? null, input.taskGoalPercent ?? null,
        flag(input.confirmVictory), flag(input.changePreviews), flag(input.changeHistory), flag(input.simonTasks), game.code);
    recordCommand(input.commandId, game.code, organiser.id, payload);
    return lobby(token)!;
  });
  // Station sheets contain the codebook answers, so only the organiser may print them.
  function printableStations(token: string | undefined): PrintableStation[] {
    const { game } = organiserFor(token);
    return (db.prepare('SELECT id, name, codebook FROM stations WHERE game_code = ? ORDER BY position').all(game.code) as { id: string; name: string; codebook: string }[])
      .map(station => ({ id: station.id, name: station.name, codebook: JSON.parse(station.codebook) as Codebook }));
  }

  return { create, join, rejoinPlayer, manageRoom, manageStations, changeSettings, printableStations };
}
export type Rooms = ReturnType<typeof createRooms>;
