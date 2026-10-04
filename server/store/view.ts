import type { HistoryEntry, Lobby, Task, TaskPuzzle } from '../../shared/protocol.js';
import type { Base } from './base.js';
import type { Rules } from './rules.js';
import { taskKindsFor, type ChangeRow, type Game, type Player, type TaskRow } from './shared.js';

// The lobby snapshot each player receives: only what that player may see.
export function createView({ db, now, playerFor, gameFor }: Base, { progress, votesOf, voters }: Rules) {
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
        confirmVictory: Boolean(game.confirm_victory), changePreviews: Boolean(game.change_previews), changeHistory: Boolean(game.change_history), taskGames: taskKindsFor(game),
        deliveryMode: game.delivery_mode, deliveryObject: game.delivery_object,
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
  // Only the latest change that is still in effect can be undone, and only if it is a correction.
  function history(game: Game): HistoryEntry[] {
    const rows = db.prepare('SELECT * FROM changes WHERE game_code = ? AND round_id = ? ORDER BY id DESC').all(game.code, game.round_id) as ChangeRow[];
    const latest = rows.find(row => !row.undone);
    return rows.map(row => ({
      ...JSON.parse(row.detail) as Partial<HistoryEntry>, id: row.id, at: row.at, action: row.action,
      undone: Boolean(row.undone), canUndo: row === latest && row.undo !== null,
    }));
  }

  return { lobby };
}
export type View = ReturnType<typeof createView>;
