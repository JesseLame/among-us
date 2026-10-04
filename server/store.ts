import Database from 'better-sqlite3';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { ErrorCode, Lobby, Phase, Role, RoundCommand, RoomCommand } from '../shared/protocol.js';

export class GameError extends Error {
  constructor(public code: ErrorCode, public status = 400) { super(code); }
}
type Player = { id: string; game_code: string; name: string; organiser: number; role: Role | null; removed: number };
type Game = { code: string; phase: Phase; round_id: string | null; revision: number; pause_reason: Lobby['pauseReason'] };
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export function createStore(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS games (code TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY, game_code TEXT NOT NULL REFERENCES games(code),
      name TEXT NOT NULL, organiser INTEGER NOT NULL DEFAULT 0,
      session_hash TEXT NOT NULL UNIQUE, joined_at INTEGER NOT NULL
    );
  `);

  // Upgrade existing lobby databases in place without losing player cookies or names.
  const migrate = db.transaction(() => {
    const version = db.pragma('user_version', { simple: true }) as number;
    if (version < 1) {
      db.exec(`
        ALTER TABLE games ADD COLUMN phase TEXT NOT NULL DEFAULT 'lobby';
        ALTER TABLE games ADD COLUMN round_id TEXT;
        ALTER TABLE games ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE games ADD COLUMN pause_reason TEXT;
        ALTER TABLE players ADD COLUMN role TEXT;
        CREATE TABLE command_receipts (
          id TEXT PRIMARY KEY, game_code TEXT NOT NULL REFERENCES games(code),
          player_id TEXT NOT NULL REFERENCES players(id), payload TEXT NOT NULL
        );
        PRAGMA user_version = 1;
      `);
    }
    if (version < 2) {
      db.exec('ALTER TABLE players ADD COLUMN removed INTEGER NOT NULL DEFAULT 0; PRAGMA user_version = 2;');
    }
  });
  migrate();
  db.prepare("UPDATE games SET phase = 'paused', pause_reason = 'restart', revision = revision + 1 WHERE phase = 'active'").run();

  const playerFor = (token: string | undefined) => token
    ? db.prepare('SELECT * FROM players WHERE session_hash = ? AND removed = 0').get(hash(token)) as Player | undefined
    : undefined;
  const gameFor = (code: string) => db.prepare('SELECT * FROM games WHERE code = ?').get(code) as Game | undefined;

  function lobby(token: string | undefined): Lobby | null {
    const player = playerFor(token);
    if (!player) return null;
    const game = gameFor(player.game_code)!;
    const players = db.prepare('SELECT id, name, organiser, role, removed FROM players WHERE game_code = ? AND (removed = 0 OR ? = 1) ORDER BY joined_at, rowid').all(player.game_code, Number(game.phase === 'ended')) as Player[];
    return {
      code: player.game_code, phase: game.phase, roundId: game.round_id,
      revision: game.revision, pauseReason: game.pause_reason,
      players: players.map(p => ({ id: p.id, name: p.name, organiser: Boolean(p.organiser), ...(p.removed ? { removed: true } : {}) })),
      you: { id: player.id, organiser: Boolean(player.organiser) },
      ...(game.phase === 'ended' ? { revealedRoles: players.map(p => ({ id: p.id, role: p.role! })) } : {}),
    };
  }

  function addPlayer(code: string, name: string, organiser: boolean) {
    const token = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO players (id, game_code, name, organiser, session_hash, joined_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), code, name, Number(organiser), hash(token), Date.now());
    db.prepare('UPDATE games SET revision = revision + 1 WHERE code = ?').run(code);
    return { token, lobby: lobby(token)! };
  }

  const create = db.transaction((name: string) => {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code: string;
    do { code = Array.from({ length: 5 }, () => alphabet[randomInt(alphabet.length)]).join(''); }
    while (db.prepare('SELECT code FROM games WHERE code = ?').get(code));
    db.prepare('INSERT INTO games (code) VALUES (?)').run(code);
    return addPlayer(code, name, true);
  });

  const join = db.transaction((code: string, name: string) => {
    const game = gameFor(code);
    if (!game) throw new GameError('GAME_NOT_FOUND', 404);
    if (game.phase !== 'lobby') throw new GameError('ROUND_IN_PROGRESS', 409);
    const players = db.prepare('SELECT name FROM players WHERE game_code = ? AND removed = 0').all(code) as { name: string }[];
    if (players.length >= 8) throw new GameError('GAME_FULL');
    if (players.some(p => p.name.toLocaleLowerCase('en') === name.toLocaleLowerCase('en'))) throw new GameError('NAME_TAKEN');
    return addPlayer(code, name, false);
  });

  // A role is fetched only when its owner explicitly reveals it. Public snapshots,
  // including the organiser's view, contain no roles until the round has ended.
  function role(token: string | undefined, roundId: string) {
    const player = playerFor(token);
    if (!player) throw new GameError('NO_SESSION', 401);
    const game = gameFor(player.game_code)!;
    if (game.round_id !== roundId) throw new GameError('STALE_COMMAND', 409);
    if (game.phase !== 'active' && game.phase !== 'paused') throw new GameError('INVALID_PHASE', 409);
    return { roundId, role: player.role! };
  }

  const command = db.transaction((token: string | undefined, input: RoundCommand) => {
    const player = playerFor(token);
    if (!player) throw new GameError('NO_SESSION', 401);
    if (!player.organiser) throw new GameError('FORBIDDEN', 403);
    const game = gameFor(player.game_code)!;
    const payload = JSON.stringify(input);
    const receipt = db.prepare('SELECT player_id, payload FROM command_receipts WHERE id = ?').get(input.commandId) as { player_id: string; payload: string } | undefined;
    if (receipt) {
      if (receipt.player_id !== player.id || receipt.payload !== payload) throw new GameError('INVALID_INPUT');
      return lobby(token)!;
    }
    if (input.expectedRevision !== game.revision || input.roundId !== game.round_id) throw new GameError('STALE_COMMAND', 409);

    let phase = game.phase;
    let roundId = game.round_id;
    let pauseReason: Lobby['pauseReason'] = null;
    switch (input.action) {
      case 'start': {
        if (phase !== 'lobby') throw new GameError('INVALID_PHASE', 409);
        const players = db.prepare('SELECT id FROM players WHERE game_code = ? AND removed = 0 ORDER BY rowid').all(game.code) as { id: string }[];
        if (players.length < 1) throw new GameError('NOT_ENOUGH_PLAYERS');
        const impostor = randomInt(players.length);
        const assign = db.prepare('UPDATE players SET role = ? WHERE id = ?');
        players.forEach((p, index) => assign.run(index === impostor ? 'impostor' : 'crewmate', p.id));
        roundId = randomUUID(); phase = 'active';
        break;
      }
      case 'pause':
        if (phase !== 'active') throw new GameError('INVALID_PHASE', 409);
        phase = 'paused'; pauseReason = 'organiser'; break;
      case 'resume':
        if (phase !== 'paused') throw new GameError('INVALID_PHASE', 409);
        phase = 'active'; break;
      case 'end':
        if (phase !== 'active' && phase !== 'paused') throw new GameError('INVALID_PHASE', 409);
        phase = 'ended'; break;
      case 'reset':
        if (phase !== 'ended') throw new GameError('INVALID_PHASE', 409);
        phase = 'lobby'; roundId = null;
        db.prepare('DELETE FROM players WHERE game_code = ? AND removed = 1').run(game.code);
        db.prepare('UPDATE players SET role = NULL WHERE game_code = ?').run(game.code);
        break;
    }
    db.prepare('UPDATE games SET phase = ?, round_id = ?, pause_reason = ?, revision = revision + 1 WHERE code = ?')
      .run(phase, roundId, pauseReason, game.code);
    db.prepare('INSERT INTO command_receipts (id, game_code, player_id, payload) VALUES (?, ?, ?, ?)')
      .run(input.commandId, game.code, player.id, payload);
    return lobby(token)!;
  });

  const manageRoom = db.transaction((token: string | undefined, input: RoomCommand) => {
    const organiser = playerFor(token);
    if (!organiser) throw new GameError('NO_SESSION', 401);
    if (!organiser.organiser) throw new GameError('FORBIDDEN', 403);
    const game = gameFor(organiser.game_code)!;
    if (input.code !== game.code) throw new GameError('STALE_COMMAND', 409);
    const payload = JSON.stringify(input);
    const receipt = db.prepare('SELECT player_id, payload FROM command_receipts WHERE id = ?').get(input.commandId) as { player_id: string; payload: string } | undefined;
    if (receipt) {
      if (receipt.player_id !== organiser.id || receipt.payload !== payload) throw new GameError('INVALID_INPUT');
      return { code: game.code, lobby: lobby(token) };
    }
    if (game.revision !== input.expectedRevision || game.round_id !== input.roundId) throw new GameError('STALE_COMMAND', 409);
    if (input.action === 'destroy') {
      db.prepare('DELETE FROM command_receipts WHERE game_code = ?').run(game.code);
      db.prepare('DELETE FROM players WHERE game_code = ?').run(game.code);
      db.prepare('DELETE FROM games WHERE code = ?').run(game.code);
      return { code: game.code, lobby: null };
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
    }
    let phase = game.phase;
    let pauseReason = game.pause_reason;
    if (phase === 'active' || phase === 'paused') {
      phase = target.role === 'impostor' ? 'ended' : 'paused';
      pauseReason = phase === 'paused' ? 'organiser' : null;
    }
    db.prepare('UPDATE games SET phase = ?, pause_reason = ?, revision = revision + 1 WHERE code = ?').run(phase, pauseReason, game.code);
    db.prepare('INSERT INTO command_receipts (id, game_code, player_id, payload) VALUES (?, ?, ?, ?)').run(input.commandId, game.code, organiser.id, payload);
    return { code: game.code, lobby: lobby(token) };
  });

  return { lobby, create, join, role, command, manageRoom, close: () => db.close() };
}
