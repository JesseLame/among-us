import { createHash } from 'node:crypto';
import { taskKinds, type ErrorCode, type HistoryEntry, type Lobby, type MeetingKind, type MeetingStage, type Phase, type PlayerStatus, type Role, type RoundResult, type StationAccess, type TaskKind, type DeliveryMode } from '../../shared/protocol.js';

export class GameError extends Error {
  constructor(public code: ErrorCode, public status = 400) { super(code); }
}
export type Player = { id: string; game_code: string; name: string; organiser: number; playing: number; role: Role | null; removed: number; status: PlayerStatus; emergency_used: number; test: number };
export type Game = {
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
  // JSON list of the task games the organiser switched off, so a newly added game starts on.
  task_games_off: string;
  // Delivery tasks: carried in the app, or the named real object.
  delivery_mode: DeliveryMode; delivery_object: string;
  // The win the app detected while waiting for the organiser to confirm it (pause_reason 'victory').
  proposed_winner: 'crew' | 'impostor' | null; proposed_reason: RoundResult['reason'] | null;
  // Reactor meltdown: the setting and countdown length, whether this round's one meltdown was
  // used, the play-clock time it melts down (null when none is on) and the latest repair activation.
  sabotage: number; reactor_time: number; reactor_used: number; reactor_ends_ms: number | null; reactor_panel: string | null;
};
export type ReactorPanel = { player: string; station: string; at: number };
export type Win = { winner: 'crew' | 'impostor'; reason: RoundResult['reason'] };
// `undo` holds what is needed to revert a correction; it never leaves the server.
export type ChangeRow = { id: number; at: number; action: HistoryEntry['action']; detail: string; undo: string | null; undone: number };
export type TaskRow = { id: string; player_id: string; station_id: string; fake: number; puzzle: string; done_at: number | null };
export const MAX_STATIONS = 8;
// The task games the organiser left on.
export const enabledKinds = (game: Game): TaskKind[] => {
  const off = JSON.parse(game.task_games_off) as string[];
  return taskKinds.filter(kind => !off.includes(kind));
};
// The task games handed out in this room. Two keys needs a second real player to help; if it
// was the only game on, every other game stands in for it.
export const taskKindsFor = (game: Game, realPlayers: number): TaskKind[] => {
  const kinds = enabledKinds(game).filter(kind => kind !== 'twokeys' || realPlayers >= 2);
  return kinds.length ? kinds : taskKinds.filter(kind => kind !== 'twokeys');
};
// What a new puzzle needs to know about the room. A real object only counts once it is named.
export const taskContext = (game: Game, station: string | null, stations: string[], pairCodes: Set<string>) => ({
  station, stations, deliveryObject: game.delivery_mode === 'object' && game.delivery_object ? game.delivery_object : null, pairCodes,
});
export const DEFAULT_STATIONS = {
  en: ['Kitchen', 'Living room', 'Hallway', 'Study'],
  nl: ['Keuken', 'Woonkamer', 'Gang', 'Werkkamer'],
};
export const hash = (token: string) => createHash('sha256').update(token).digest('hex');
