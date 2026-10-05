import type { CallMeeting, CastVote, MeetingCommand } from '../../shared/protocol.js';
import type { Base } from './base.js';
import type { Rules } from './rules.js';
import { GameError, type Game } from './shared.js';

// Meetings: gathering, discussion, phone or physical votes and their result.
export function createMeetings({ db, now, playerFor, gameFor, alreadyApplied, recordCommand, organiserFor }: Base, { votesOf, voters, elapsed, settle }: Rules) {
  // A living player reports a body or calls an emergency meeting; the organiser may
  // always call one. Play and its clock stop while everyone gathers; the organiser then
  // starts the meeting itself. A reactor meltdown's countdown stops with the clock, and
  // its repair activation is cleared so players must return to the stations. An open
  // Security live view closes.
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
        // Players must fix the reactor rather than call everyone together.
        if (game.reactor_ends_ms !== null) throw new GameError('REACTOR_ACTIVE', 409);
        db.prepare('UPDATE players SET emergency_used = emergency_used + 1 WHERE id = ?').run(player.id);
      }
    }
    db.prepare(`UPDATE games SET phase = 'meeting', clock_ms = ?, meeting_kind = ?, meeting_by = ?, meeting_stage = 'gathering', meeting_at = NULL,
      meeting_ghosts = '[]', meeting_discussion = NULL, meeting_votes = NULL, meeting_result = NULL, reactor_panel = NULL, security_ends_ms = NULL, revision = revision + 1 WHERE code = ?`)
      .run(elapsed(game), input.kind, input.kind === 'organiser' ? null : player.id, game.code);
    recordCommand(input.commandId, game.code, player.id, payload);
    return game.code;
  });
  // The result of a vote: an ejected player becomes a ghost. Ejecting the Impostor wins
  // the round for the crew; otherwise the Impostor may now have enough eliminations.
  // `unanimous`: every other voter chose the ejected player on their phone, which wins
  // the round for a Jester.
  function eject(game: Game, ejected: string | null, tally: { target: string; voters: string[] }[] | null, unanimous = false) {
    db.prepare("UPDATE games SET meeting_stage = 'result', meeting_result = ? WHERE code = ?").run(JSON.stringify({ ejected, tally }), game.code);
    if (!ejected) return;
    db.prepare("UPDATE players SET status = 'ghost' WHERE id = ?").run(ejected);
    if (unanimous && db.prepare("SELECT 1 FROM players WHERE id = ? AND role = 'jester'").get(ejected)) {
      db.prepare('UPDATE games SET jester_out = ? WHERE code = ?').run(ejected, game.code);
    }
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
        const eligible = voters(game).map(voter => voter.id);
        const groups = new Map<string, string[]>();
        for (const [voter, target] of Object.entries(votes)) groups.set(target, [...(groups.get(target) ?? []), voter]);
        const tally = [...groups].map(([target, voters]) => ({ target, voters })).sort((a, b) => b.voters.length - a.voters.length);
        const top = tally[0];
        const unique = top && (tally.length === 1 || tally[1].voters.length < top.voters.length);
        const ejected = unique && top.target !== 'skip' ? top.target : null;
        // Unanimous: every living voter besides the ejected player voted for them (their own vote does not matter).
        const others = eligible.filter(id => id !== ejected);
        eject(game, ejected, tally, ejected !== null && others.length > 0 && others.every(id => votes[id] === ejected));
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

  return { startMeeting, runMeeting, vote };
}
