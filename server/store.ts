import Database from 'better-sqlite3';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { CallMeeting, CastVote, ChangePreview, Correction, HistoryEntry, CompleteTask, Eliminate, MeetingCommand, MeetingKind, MeetingStage, ErrorCode, Lobby, PlayerStatus, RoleInfo, Phase, PrintableStation, Role, RoundCommand, RoomCommand, RoundResult, SettingsCommand, StationAccess, StationCommand, Task, TaskPuzzle } from '../shared/protocol.js';
import { taskKinds } from '../shared/protocol.js';
import { codebook, puzzle, shuffle, solved, type Codebook, type TaskKind } from './puzzles.js';

export class GameError extends Error {
  constructor(public code: ErrorCode, public status = 400) { super(code); }
}
type Player = { id: string; game_code: string; name: string; organiser: number; playing: number; role: Role | null; removed: number; status: PlayerStatus; emergency_used: number; test: number };
type Game = {
  code: string; phase: Phase; round_id: string | null; revision: number; pause_reason: Lobby['pauseReason'];
  winner: RoundResult['winner']; end_reason: RoundResult['reason'] | null;
  tasks_per_player: number; task_goal_percent: number;
  progress_interval: number; progress_shown: number; progress_shown_at: number;
  station_access: StationAccess; eliminations: number; body_reports: number; emergency_meetings: number; discussion_time: number;
  meeting_kind: MeetingKind | null; meeting_by: string | null; meeting_at: number | null; meeting_ghosts: string | null;
  // The discussion length fixed when the meeting started, so later edits affect the next meeting.
  meeting_discussion: number | null; emergency_allowance: number;
  phone_voting: number; meeting_stage: MeetingStage | null; meeting_votes: string | null; meeting_result: string | null;
  opening_protection: number; kill_cooldown: number;
  // Active play time: clock_ms plus, while active, the time since clock_at.
  // The play-clock time from which the Impostor may eliminate (protection, then cooldown).
  clock_ms: number; clock_at: number; eliminate_ready_ms: number;
  confirm_victory: number; change_previews: number; change_history: number;
  // The win the app detected while waiting for the organiser to confirm it (pause_reason 'victory').
  proposed_winner: 'crew' | 'impostor' | null; proposed_reason: RoundResult['reason'] | null;
};
type Win = { winner: 'crew' | 'impostor'; reason: RoundResult['reason'] };
// `undo` holds what is needed to revert a correction; it never leaves the server.
type ChangeRow = { id: number; at: number; action: HistoryEntry['action']; detail: string; undo: string | null; undone: number };
const TASK_COLUMNS = 'id, game_code, round_id, player_id, station_id, fake, puzzle, position, done_at';
type FullTask = TaskRow & { game_code: string; round_id: string; position: number };
// Thrown to roll back a preview after measuring its effect.
class DryRun extends Error { constructor(public preview: ChangePreview) { super('DRY_RUN'); } }
type TaskRow = { id: string; player_id: string; station_id: string; fake: number; puzzle: string; done_at: number | null };
const MAX_STATIONS = 8;
const TASK_KINDS: TaskKind[] = [...taskKinds];
const DEFAULT_STATIONS = {
  en: ['Kitchen', 'Living room', 'Hallway', 'Study'],
  nl: ['Keuken', 'Woonkamer', 'Gang', 'Werkkamer'],
};
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export function createStore(path: string, now: () => number = Date.now) {
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
    if (version < 3) {
      db.exec(`
        ALTER TABLE games ADD COLUMN winner TEXT;
        ALTER TABLE games ADD COLUMN end_reason TEXT;
        ALTER TABLE games ADD COLUMN tasks_per_player INTEGER NOT NULL DEFAULT 4;
        ALTER TABLE games ADD COLUMN task_goal_percent INTEGER NOT NULL DEFAULT 80;
        ALTER TABLE games ADD COLUMN progress_interval INTEGER NOT NULL DEFAULT 30;
        ALTER TABLE games ADD COLUMN progress_shown INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE games ADD COLUMN progress_shown_at INTEGER NOT NULL DEFAULT 0;
        CREATE TABLE stations (
          id TEXT PRIMARY KEY, game_code TEXT NOT NULL REFERENCES games(code),
          name TEXT NOT NULL, position INTEGER NOT NULL, codebook TEXT NOT NULL
        );
        CREATE TABLE tasks (
          id TEXT PRIMARY KEY, game_code TEXT NOT NULL REFERENCES games(code), round_id TEXT NOT NULL,
          player_id TEXT NOT NULL REFERENCES players(id), station_id TEXT NOT NULL REFERENCES stations(id),
          fake INTEGER NOT NULL, puzzle TEXT NOT NULL, position INTEGER NOT NULL, done_at INTEGER
        );
        PRAGMA user_version = 3;
      `);
      // Existing lobbies receive the default stations so they can start a round with tasks.
      for (const { code } of db.prepare('SELECT code FROM games').all() as { code: string }[]) addStations(code, DEFAULT_STATIONS.en);
    }
    if (version < 4) {
      db.exec("ALTER TABLE games ADD COLUMN station_access TEXT NOT NULL DEFAULT 'qr'; PRAGMA user_version = 4;");
    }
    if (version < 5) {
      // Existing organisers keep playing; a host-only organiser has playing = 0.
      db.exec('ALTER TABLE players ADD COLUMN playing INTEGER NOT NULL DEFAULT 1; PRAGMA user_version = 5;');
    }
    if (version < 6) {
      db.exec(`
        ALTER TABLE players ADD COLUMN status TEXT NOT NULL DEFAULT 'alive';
        ALTER TABLE games ADD COLUMN opening_protection INTEGER NOT NULL DEFAULT 60;
        ALTER TABLE games ADD COLUMN kill_cooldown INTEGER NOT NULL DEFAULT 60;
        ALTER TABLE games ADD COLUMN clock_ms INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE games ADD COLUMN clock_at INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE games ADD COLUMN eliminate_ready_ms INTEGER NOT NULL DEFAULT 0;
        PRAGMA user_version = 6;
      `);
    }
    if (version < 7) {
      db.exec('ALTER TABLE games ADD COLUMN eliminations INTEGER NOT NULL DEFAULT 1; PRAGMA user_version = 7;');
    }
    if (version < 8) {
      db.exec(`
        ALTER TABLE games ADD COLUMN body_reports INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE games ADD COLUMN emergency_meetings INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE games ADD COLUMN discussion_time INTEGER NOT NULL DEFAULT 90;
        ALTER TABLE games ADD COLUMN meeting_kind TEXT;
        ALTER TABLE games ADD COLUMN meeting_by TEXT;
        ALTER TABLE games ADD COLUMN meeting_at INTEGER;
        ALTER TABLE games ADD COLUMN meeting_ghosts TEXT;
        ALTER TABLE players ADD COLUMN emergency_used INTEGER NOT NULL DEFAULT 0;
        PRAGMA user_version = 8;
      `);
    }
    if (version < 9) {
      db.exec('ALTER TABLE players ADD COLUMN test INTEGER NOT NULL DEFAULT 0; PRAGMA user_version = 9;');
    }
    if (version < 10) {
      db.exec(`
        ALTER TABLE games ADD COLUMN emergency_allowance INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE games ADD COLUMN meeting_discussion INTEGER;
        UPDATE games SET meeting_discussion = discussion_time WHERE phase = 'meeting';
        PRAGMA user_version = 10;
      `);
    }
    if (version < 11) {
      db.exec(`
        ALTER TABLE games ADD COLUMN phone_voting INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE games ADD COLUMN meeting_stage TEXT;
        ALTER TABLE games ADD COLUMN meeting_votes TEXT;
        ALTER TABLE games ADD COLUMN meeting_result TEXT;
        UPDATE games SET meeting_stage = 'discussion' WHERE phase = 'meeting';
        PRAGMA user_version = 11;
      `);
    }
    if (version < 12) {
      db.exec(`
        ALTER TABLE players ADD COLUMN rejoin_code TEXT;
        ALTER TABLE players ADD COLUMN rejoin_expires INTEGER;
        PRAGMA user_version = 12;
      `);
    }
    if (version < 13) {
      db.exec(`
        ALTER TABLE games ADD COLUMN confirm_victory INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE games ADD COLUMN change_previews INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE games ADD COLUMN change_history INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE games ADD COLUMN proposed_winner TEXT;
        ALTER TABLE games ADD COLUMN proposed_reason TEXT;
        CREATE TABLE changes (
          id INTEGER PRIMARY KEY AUTOINCREMENT, game_code TEXT NOT NULL REFERENCES games(code), round_id TEXT NOT NULL,
          at INTEGER NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, undo TEXT, undone INTEGER NOT NULL DEFAULT 0
        );
        PRAGMA user_version = 13;
      `);
    }
  });
  function addStations(code: string, names: string[]) {
    const insert = db.prepare('INSERT INTO stations (id, game_code, name, position, codebook) VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM stations WHERE game_code = ?), ?)');
    for (const name of names) insert.run(randomUUID(), code, name, code, JSON.stringify(codebook()));
  }
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
    const players = db.prepare('SELECT id, name, organiser, playing, role, removed, status, test FROM players WHERE game_code = ? AND (removed = 0 OR ? = 1) ORDER BY joined_at, rowid').all(player.game_code, Number(game.phase === 'ended')) as Player[];
    const playing = game.phase === 'active' || game.phase === 'paused' || game.phase === 'meeting';
    const tasks = playing
      ? (db.prepare('SELECT * FROM tasks WHERE player_id = ? AND round_id = ? ORDER BY position').all(player.id, game.round_id) as TaskRow[])
        // The fake flag never leaves the server; fake tasks look identical to real ones.
        .map((task): Task => ({ id: task.id, stationId: task.station_id, done: task.done_at !== null, puzzle: JSON.parse(task.puzzle) as TaskPuzzle }))
      : [];
    const totals = game.round_id ? progress(game) : null;
    return {
      code: player.game_code, phase: game.phase, roundId: game.round_id,
      revision: game.revision, pauseReason: game.pause_reason,
      players: players.map(p => ({
        id: p.id, name: p.name, organiser: Boolean(p.organiser), playing: Boolean(p.playing), ...(p.test ? { test: true } : {}),
        ...(playing && p.status === 'ghost' ? { out: true } : {}), ...(p.removed ? { removed: true } : {}),
      })),
      stations: db.prepare('SELECT id, name FROM stations WHERE game_code = ? ORDER BY position').all(game.code) as Lobby['stations'],
      settings: {
        stationAccess: game.station_access, eliminations: Boolean(game.eliminations),
        bodyReports: Boolean(game.body_reports), emergencyMeetings: Boolean(game.emergency_meetings), phoneVoting: Boolean(game.phone_voting),
        openingProtection: game.opening_protection, killCooldown: game.kill_cooldown, discussionTime: game.discussion_time,
        emergencyAllowance: game.emergency_allowance, progressInterval: game.progress_interval,
        tasksPerPlayer: game.tasks_per_player, taskGoalPercent: game.task_goal_percent,
        confirmVictory: Boolean(game.confirm_victory), changePreviews: Boolean(game.change_previews), changeHistory: Boolean(game.change_history),
      },
      // The proposed winning team and the change history are for the organiser only.
      ...(player.organiser && game.pause_reason === 'victory' && game.proposed_winner ? { proposedResult: { winner: game.proposed_winner, reason: game.proposed_reason ?? 'organiser' } } : {}),
      ...(player.organiser && game.change_history && playing ? { history: history(game) } : {}),
      ...(game.phase === 'meeting' ? { meeting: {
        kind: game.meeting_kind!, calledBy: game.meeting_by, stage: game.meeting_stage ?? 'discussion',
        discussionMs: game.meeting_at && game.meeting_discussion ? Math.max(0, game.meeting_at + game.meeting_discussion * 1000 - now()) : null,
        newGhosts: JSON.parse(game.meeting_ghosts ?? '[]') as string[],
        ...(game.meeting_stage === 'voting' ? { votes: { cast: Object.keys(votesOf(game)).length, eligible: voters(game).length } } : {}),
        ...(game.meeting_result ? { result: JSON.parse(game.meeting_result) as NonNullable<NonNullable<Lobby['meeting']>['result']> } : {}),
      } } : {}),
      progress: totals && { done: game.phase === 'ended' ? totals.done : Math.min(game.progress_shown, totals.goal), goal: totals.goal },
      // Status is private to its owner: an undiscovered body looks alive to everyone else.
      you: {
        id: player.id, organiser: Boolean(player.organiser), playing: Boolean(player.playing), status: playing ? player.status : 'alive',
        emergencyLeft: Math.max(0, game.emergency_allowance - player.emergency_used), tasks,
        ...(game.phase === 'meeting' && game.meeting_stage === 'voting' && votesOf(game)[player.id] ? { vote: votesOf(game)[player.id] } : {}),
      },
      ...(game.phase === 'ended' ? {
        revealedRoles: players.filter(p => p.playing && p.role).map(p => ({ id: p.id, role: p.role! })),
        result: { winner: game.winner, reason: game.end_reason ?? 'organiser' },
      } : {}),
    };
  }

  // Real-task totals for the current round. Fake tasks never count.
  function progress(game: Game) {
    const { total, done } = db.prepare('SELECT COUNT(*) AS total, COUNT(done_at) AS done FROM tasks WHERE game_code = ? AND round_id = ? AND fake = 0')
      .get(game.code, game.round_id) as { total: number; done: number };
    return { done, goal: Math.ceil(total * game.task_goal_percent / 100) };
  }
  // With no real tasks (for example a solo Impostor) the round never ends by tasks.
  const tasksWon = (game: Game) => { const { done, goal } = progress(game); return goal > 0 && done >= goal; };
  const votesOf = (game: Game) => JSON.parse(game.meeting_votes ?? '{}') as Record<string, string>;
  // Living real players may vote; test players and ghosts may not.
  const voters = (game: Game) => db.prepare("SELECT id FROM players WHERE game_code = ? AND playing = 1 AND removed = 0 AND test = 0 AND status = 'alive'")
    .all(game.code) as { id: string }[];

  // Active play time in this round, excluding pauses and meetings.
  const elapsed = (game: Game) => game.clock_ms + (game.phase === 'active' ? Math.max(0, now() - game.clock_at) : 0);
  // The Impostor wins when at most one living Crewmate remains.
  const impostorWon = (game: Game) => (db.prepare("SELECT COUNT(*) AS living FROM players WHERE game_code = ? AND playing = 1 AND removed = 0 AND role = 'crewmate' AND status = 'alive'")
    .get(game.code) as { living: number }).living <= 1;
  function endRound(code: string, winner: RoundResult['winner'], reason: RoundResult['reason']) {
    db.prepare("UPDATE games SET phase = 'ended', pause_reason = NULL, proposed_winner = NULL, proposed_reason = NULL, winner = ?, end_reason = ?, revision = revision + 1 WHERE code = ?").run(winner, reason, code);
  }
  // A caught Impostor (a ghost after an ejection or correction) wins for the crew first.
  function winFor(game: Game): Win | null {
    if (db.prepare("SELECT 1 FROM players WHERE game_code = ? AND playing = 1 AND removed = 0 AND role = 'impostor' AND status = 'ghost'").get(game.code)) return { winner: 'crew', reason: 'ejected' };
    if (tasksWon(game)) return { winner: 'crew', reason: 'tasks' };
    if (impostorWon(game)) return { winner: 'impostor', reason: 'eliminations' };
    return null;
  }
  // Ends the round on a detected win or, when the organiser confirms victories, stops play
  // (and any meeting) until they confirm it. Returns whether either happened. A waiting
  // result that no longer holds, for example after a correction, is withdrawn.
  function settle(code: string) {
    const game = gameFor(code)!;
    const win = winFor(game);
    if (!win) {
      if (game.pause_reason === 'victory') {
        db.prepare("UPDATE games SET pause_reason = 'organiser', proposed_winner = NULL, proposed_reason = NULL, revision = revision + 1 WHERE code = ?").run(code);
      }
      return false;
    }
    if (!game.confirm_victory) { endRound(code, win.winner, win.reason); return true; }
    db.prepare(`UPDATE games SET phase = 'paused', pause_reason = 'victory', proposed_winner = ?, proposed_reason = ?, clock_ms = ?,
      meeting_kind = NULL, meeting_by = NULL, meeting_at = NULL, meeting_ghosts = NULL, meeting_stage = NULL, meeting_votes = NULL, meeting_result = NULL,
      revision = revision + 1 WHERE code = ?`).run(win.winner, win.reason, elapsed(game), code);
    return true;
  }

  function logChange(game: Game, action: HistoryEntry['action'], detail: Partial<HistoryEntry>, undo: unknown = null) {
    db.prepare('INSERT INTO changes (game_code, round_id, at, action, detail, undo) VALUES (?, ?, ?, ?, ?, ?)')
      .run(game.code, game.round_id, now(), action, JSON.stringify(detail), undo === null ? null : JSON.stringify(undo));
  }
  // Only the latest change that is still in effect can be undone, and only if it is a correction.
  function history(game: Game): HistoryEntry[] {
    const rows = db.prepare('SELECT * FROM changes WHERE game_code = ? AND round_id = ? ORDER BY id DESC').all(game.code, game.round_id) as ChangeRow[];
    const latest = rows.find(row => !row.undone);
    return rows.map(row => ({
      ...JSON.parse(row.detail) as Partial<HistoryEntry>, id: row.id, at: row.at, action: row.action,
      undone: Boolean(row.undone), canUndo: row === latest && row.undo !== null,
    }));
  }

  function assignTasks(game: Game, roundId: string, players: { id: string; role: Role }[]) {
    const stations = shuffle(db.prepare('SELECT id FROM stations WHERE game_code = ?').all(game.code) as { id: string }[]);
    const insert = db.prepare('INSERT INTO tasks (id, game_code, round_id, player_id, station_id, fake, puzzle, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const player of players) {
      // Spread each list across stations, with a mix of puzzle kinds.
      const offset = randomInt(stations.length);
      const kinds = shuffle(Array.from({ length: game.tasks_per_player }, (_, index) => TASK_KINDS[index % TASK_KINDS.length]));
      kinds.forEach((kind, index) => insert.run(
        randomUUID(), game.code, roundId, player.id, stations[(offset + index) % stations.length].id,
        Number(player.role === 'impostor'), JSON.stringify(puzzle(kind)), index,
      ));
    }
  }

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
    addStations(code, DEFAULT_STATIONS[language]);
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
      addStations(game.code, [input.name]);
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
      change_previews = COALESCE(?, change_previews), change_history = COALESCE(?, change_history), revision = revision + 1 WHERE code = ?`)
      .run(input.stationAccess ?? null, flag(input.eliminations), flag(input.bodyReports), flag(input.emergencyMeetings), flag(input.phoneVoting),
        input.openingProtection ?? null, input.killCooldown ?? null, input.discussionTime ?? null, input.emergencyAllowance ?? null,
        input.progressInterval ?? null, input.tasksPerPlayer ?? null, input.taskGoalPercent ?? null,
        flag(input.confirmVictory), flag(input.changePreviews), flag(input.changeHistory), game.code);
    recordCommand(input.commandId, game.code, organiser.id, payload);
    return lobby(token)!;
  });

  // Station sheets contain the codebook answers, so only the organiser may print them.
  function printableStations(token: string | undefined): PrintableStation[] {
    const { game } = organiserFor(token);
    return (db.prepare('SELECT id, name, codebook FROM stations WHERE game_code = ? ORDER BY position').all(game.code) as { id: string; name: string; codebook: string }[])
      .map(station => ({ id: station.id, name: station.name, codebook: JSON.parse(station.codebook) as Codebook }));
  }

  // A living player reports a body or calls an emergency meeting; the organiser may
  // always call one. Play and its clock stop while everyone gathers; the organiser then
  // starts the meeting itself.
  const startMeeting = db.transaction((token: string | undefined, input: CallMeeting) => {
    const player = playerFor(token);
    if (!player) throw new GameError('NO_SESSION', 401);
    const game = gameFor(player.game_code)!;
    if (game.round_id !== input.roundId) throw new GameError('STALE_COMMAND', 409);
    const payload = JSON.stringify(input);
    if (alreadyApplied(input.commandId, player.id, payload)) return game.code;
    if (game.phase !== 'active') throw new GameError('INVALID_PHASE', 409);
    if (input.kind === 'organiser') {
      if (!player.organiser) throw new GameError('FORBIDDEN', 403);
    } else {
      if (!player.playing) throw new GameError('NOT_PLAYING', 409);
      if (player.status !== 'alive') throw new GameError('NOT_ALIVE', 409);
      if (input.kind === 'report' && !game.body_reports) throw new GameError('REPORTS_OFF', 409);
      if (input.kind === 'emergency') {
        if (!game.emergency_meetings) throw new GameError('EMERGENCY_OFF', 409);
        if (player.emergency_used >= game.emergency_allowance) throw new GameError('NO_EMERGENCY_LEFT', 409);
        db.prepare('UPDATE players SET emergency_used = emergency_used + 1 WHERE id = ?').run(player.id);
      }
    }
    db.prepare(`UPDATE games SET phase = 'meeting', clock_ms = ?, meeting_kind = ?, meeting_by = ?, meeting_stage = 'gathering', meeting_at = NULL,
      meeting_ghosts = '[]', meeting_discussion = NULL, meeting_votes = NULL, meeting_result = NULL, revision = revision + 1 WHERE code = ?`)
      .run(elapsed(game), input.kind, input.kind === 'organiser' ? null : player.id, game.code);
    recordCommand(input.commandId, game.code, player.id, payload);
    return game.code;
  });

  // The result of a vote: an ejected player becomes a ghost. Ejecting the Impostor wins
  // the round for the crew; otherwise the Impostor may now have enough eliminations.
  function eject(game: Game, ejected: string | null, tally: { target: string; voters: string[] }[] | null) {
    db.prepare("UPDATE games SET meeting_stage = 'result', meeting_result = ? WHERE code = ?").run(JSON.stringify({ ejected, tally }), game.code);
    if (!ejected) return;
    db.prepare("UPDATE players SET status = 'ghost' WHERE id = ?").run(ejected);
    settle(game.code);
  }

  // The organiser starts the gathered meeting, opens and closes phone voting, or records
  // the outcome of a physical vote.
  const runMeeting = db.transaction((token: string | undefined, input: MeetingCommand) => {
    const { player: organiser, game } = organiserFor(token);
    const payload = JSON.stringify(input);
    if (alreadyApplied(input.commandId, organiser.id, payload)) return game.code;
    if (game.round_id !== input.roundId || game.revision !== input.expectedRevision) throw new GameError('STALE_COMMAND', 409);
    if (game.phase !== 'meeting') throw new GameError('INVALID_PHASE', 409);
    const stage = game.meeting_stage ?? 'discussion';
    switch (input.action) {
      case 'start': {
        if (stage !== 'gathering') throw new GameError('INVALID_PHASE', 409);
        // Recorded bodies and the players the organiser marks as found all become ghosts.
        // The list the organiser chooses from never shows who the app already knows is dead.
        const mark = db.prepare("UPDATE players SET status = 'ghost' WHERE id = ? AND game_code = ? AND playing = 1 AND removed = 0 AND status != 'ghost'");
        const bodies = (db.prepare("SELECT id FROM players WHERE game_code = ? AND status = 'body' AND removed = 0").all(game.code) as { id: string }[]).map(p => p.id);
        const found = [...new Set([...bodies, ...input.out])].filter(id => mark.run(id, game.code).changes > 0);
        db.prepare("UPDATE games SET meeting_stage = 'discussion', meeting_at = ?, meeting_discussion = discussion_time, meeting_ghosts = ? WHERE code = ?")
          .run(now(), JSON.stringify(found), game.code);
        settle(game.code);
        break;
      }
      case 'openVote':
        if (stage !== 'discussion') throw new GameError('INVALID_PHASE', 409);
        if (!game.phone_voting) throw new GameError('PHONE_VOTING_OFF', 409);
        db.prepare("UPDATE games SET meeting_stage = 'voting', meeting_votes = '{}' WHERE code = ?").run(game.code);
        break;
      case 'closeVote': {
        if (stage !== 'voting') throw new GameError('INVALID_PHASE', 409);
        // The unique highest total is ejected; a tie or a winning Skip ejects nobody.
        const votes = votesOf(game);
        const groups = new Map<string, string[]>();
        for (const [voter, target] of Object.entries(votes)) groups.set(target, [...(groups.get(target) ?? []), voter]);
        const tally = [...groups].map(([target, voters]) => ({ target, voters })).sort((a, b) => b.voters.length - a.voters.length);
        const top = tally[0];
        const unique = top && (tally.length === 1 || tally[1].voters.length < top.voters.length);
        eject(game, unique && top.target !== 'skip' ? top.target : null, tally);
        break;
      }
      case 'record':
        if (stage !== 'discussion' && stage !== 'voting') throw new GameError('INVALID_PHASE', 409);
        if (input.ejected && !db.prepare("SELECT 1 FROM players WHERE id = ? AND game_code = ? AND playing = 1 AND removed = 0 AND status = 'alive'").get(input.ejected, game.code)) {
          throw new GameError('PLAYER_NOT_FOUND', 404);
        }
        eject(game, input.ejected, null);
        break;
    }
    db.prepare('UPDATE games SET revision = revision + 1 WHERE code = ?').run(game.code);
    recordCommand(input.commandId, game.code, organiser.id, payload);
    return game.code;
  });

  // A living player votes on their phone while voting is open; they can change their mind
  // until the organiser closes the vote. Everyone sees only how many have voted.
  const vote = db.transaction((token: string | undefined, input: CastVote) => {
    const player = playerFor(token);
    if (!player) throw new GameError('NO_SESSION', 401);
    const game = gameFor(player.game_code)!;
    if (game.round_id !== input.roundId) throw new GameError('STALE_COMMAND', 409);
    if (game.phase !== 'meeting' || game.meeting_stage !== 'voting') throw new GameError('VOTING_CLOSED', 409);
    if (!voters(game).some(voter => voter.id === player.id)) throw new GameError('NOT_ALIVE', 409);
    if (input.target !== 'skip' && !db.prepare("SELECT 1 FROM players WHERE id = ? AND game_code = ? AND playing = 1 AND removed = 0 AND status = 'alive'").get(input.target, game.code)) {
      throw new GameError('PLAYER_NOT_FOUND', 404);
    }
    db.prepare('UPDATE games SET meeting_votes = ? WHERE code = ?').run(JSON.stringify({ ...votesOf(game), [player.id]: input.target }), game.code);
    return game.code;
  });

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
        const pairs = old.map(task => {
          const stationId = input.targetStationId ?? (others.length ? others[randomInt(others.length)] : input.stationId);
          const replacement = randomUUID();
          insert.run(replacement, game.code, game.round_id, task.player_id, stationId, task.fake, JSON.stringify(puzzle(TASK_KINDS[randomInt(TASK_KINDS.length)])), task.position);
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

  // A player who lost their session (phone died, browser closed) takes their place again
  // with a one-time code from the organiser. Their old session stops working.
  const rejoinPlayer = db.transaction((code: string) => {
    const player = db.prepare('SELECT * FROM players WHERE rejoin_code = ? AND removed = 0').get(code) as (Player & { rejoin_expires: number }) | undefined;
    if (!player || player.rejoin_expires < now()) throw new GameError('REJOIN_EXPIRED', 404);
    const token = randomBytes(32).toString('hex');
    db.prepare('UPDATE players SET session_hash = ?, rejoin_code = NULL, rejoin_expires = NULL WHERE id = ?').run(hash(token), player.id);
    return { token, lobby: lobby(token)! };
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
    const station = db.prepare('SELECT codebook FROM stations WHERE id = ?').get(task.station_id) as { codebook: string } | undefined;
    if (!solved(JSON.parse(task.puzzle) as TaskPuzzle, input.answer, station && JSON.parse(station.codebook) as Codebook)) throw new GameError('WRONG_ANSWER', 422);
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

  return { lobby, create, join, role, eliminatePlayer, startMeeting, runMeeting, vote, correct, previewCorrection, previewRemoval, rejoinPlayer, command, manageRoom, manageStations, changeSettings, printableStations, completeTask, tick, close: () => db.close() };
}
