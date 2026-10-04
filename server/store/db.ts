import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { newCodebook } from '../tasks/index.js';
import { DEFAULT_STATIONS } from './shared.js';

// Opens the database and upgrades it in place. Schema changes are forward migrations
// only: existing rooms, players and sessions survive every upgrade.
export function openDatabase(path: string) {
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
      for (const { code } of db.prepare('SELECT code FROM games').all() as { code: string }[]) addStations(db, code, DEFAULT_STATIONS.en);
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
    if (version < 14) {
      // Simon says starts on in every room, existing ones included.
      db.exec(`
        ALTER TABLE games ADD COLUMN simon_tasks INTEGER NOT NULL DEFAULT 1;
        PRAGMA user_version = 14;
      `);
    }
    if (version < 15) {
      // One list of switched-off task games replaces the Simon says switch; every other game stays on.
      db.exec(`
        ALTER TABLE games ADD COLUMN task_games_off TEXT NOT NULL DEFAULT '[]';
        UPDATE games SET task_games_off = '["simon"]' WHERE simon_tasks = 0;
        ALTER TABLE games DROP COLUMN simon_tasks;
        PRAGMA user_version = 15;
      `);
    }
  });
  migrate();
  return db;
}

export function addStations(db: Database.Database, code: string, names: string[]) {
  const insert = db.prepare('INSERT INTO stations (id, game_code, name, position, codebook) VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM stations WHERE game_code = ?), ?)');
  for (const name of names) insert.run(randomUUID(), code, name, code, JSON.stringify(newCodebook()));
}
