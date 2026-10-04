import type { RoundResult } from '../../shared/protocol.js';
import type { Base } from './base.js';
import type { Game, Win } from './shared.js';

// Progress, the play clock, votes and win conditions.
export function createRules({ db, now, gameFor }: Base) {
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
  // A reactor meltdown whose countdown ran out in active play.
  const meltedDown = (game: Game) => game.reactor_ends_ms !== null && elapsed(game) >= game.reactor_ends_ms;
  // A caught Impostor (a ghost after an ejection or correction) wins for the crew first.
  // During a meltdown a task win waits until the reactor is repaired.
  function winFor(game: Game): Win | null {
    if (db.prepare("SELECT 1 FROM players WHERE game_code = ? AND playing = 1 AND removed = 0 AND role = 'impostor' AND status = 'ghost'").get(game.code)) return { winner: 'crew', reason: 'ejected' };
    if (meltedDown(game)) return { winner: 'impostor', reason: 'reactor' };
    if (game.reactor_ends_ms === null && tasksWon(game)) return { winner: 'crew', reason: 'tasks' };
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

  return { progress, votesOf, voters, elapsed, endRound, settle };
}
export type Rules = ReturnType<typeof createRules>;
