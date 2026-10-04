import type Database from 'better-sqlite3';
import type { HistoryEntry } from '../../shared/protocol.js';
import { GameError, hash, type Game, type Player } from './shared.js';

// What every part of the store shares: the database, the clock, sessions, command receipts
// and the change log.
export function createBase(db: Database.Database, now: () => number) {
  const playerFor = (token: string | undefined) => token
    ? db.prepare('SELECT * FROM players WHERE session_hash = ? AND removed = 0').get(hash(token)) as Player | undefined
    : undefined;
  const gameFor = (code: string) => db.prepare('SELECT * FROM games WHERE code = ?').get(code) as Game | undefined;
  // Returns true when the command was already applied by the same player.
  function alreadyApplied(commandId: string, playerId: string, payload: string) {
    const receipt = db.prepare('SELECT player_id, payload FROM command_receipts WHERE id = ?').get(commandId) as { player_id: string; payload: string } | undefined;
    if (!receipt) return false;
    if (receipt.player_id !== playerId || receipt.payload !== payload) throw new GameError('INVALID_INPUT');
    return true;
  }
  const recordCommand = (commandId: string, code: string, playerId: string, payload: string) =>
    db.prepare('INSERT INTO command_receipts (id, game_code, player_id, payload) VALUES (?, ?, ?, ?)').run(commandId, code, playerId, payload);
  function organiserFor(token: string | undefined) {
    const player = playerFor(token);
    if (!player) throw new GameError('NO_SESSION', 401);
    if (!player.organiser) throw new GameError('FORBIDDEN', 403);
    return { player, game: gameFor(player.game_code)! };
  }
  function logChange(game: Game, action: HistoryEntry['action'], detail: Partial<HistoryEntry>, undo: unknown = null) {
    db.prepare('INSERT INTO changes (game_code, round_id, at, action, detail, undo) VALUES (?, ?, ?, ?, ?, ?)')
      .run(game.code, game.round_id, now(), action, JSON.stringify(detail), undo === null ? null : JSON.stringify(undo));
  }

  return { db, now, playerFor, gameFor, alreadyApplied, recordCommand, organiserFor, logChange };
}
export type Base = ReturnType<typeof createBase>;
