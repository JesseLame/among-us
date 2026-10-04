import { createBase } from './base.js';
import { createCorrections } from './corrections.js';
import { openDatabase } from './db.js';
import { createMeetings } from './meetings.js';
import { createRooms } from './rooms.js';
import { createRound } from './round.js';
import { createRules } from './rules.js';
import { createView } from './view.js';

export { GameError } from './shared.js';

// The authoritative game state in SQLite. Every command checks permissions and is
// persisted before the caller responds or broadcasts.
export function createStore(path: string, now: () => number = Date.now) {
  const db = openDatabase(path);
  // An active round survives a server restart paused, never silently resumed.
  db.prepare("UPDATE games SET phase = 'paused', pause_reason = 'restart', revision = revision + 1 WHERE phase = 'active'").run();

  const base = createBase(db, now);
  const rules = createRules(base);
  const view = createView(base, rules);
  const rooms = createRooms(base, rules, view);
  const round = createRound(base, rules, view);
  const meetings = createMeetings(base, rules);
  const corrections = createCorrections(base, rules, rooms);
  return { lobby: view.lobby, ...rooms, ...round, ...meetings, ...corrections, close: () => db.close() };
}
export type Store = ReturnType<typeof createStore>;
