import { afterEach, describe, expect, it } from 'vitest';
import type { Lobby } from '../../shared/protocol.js';
import { randomUUID } from 'node:crypto';
import { cleanup, start, roundInput, crew } from './helpers.js';

afterEach(cleanup);

describe('meetings', () => {
  it('reports bodies and emergency meetings, turns bodies into public ghosts, and stops play', async () => {
    let clock = 7_000_000;
    const app = await start(':memory:', () => clock);
    const game = await crew(app);
    let lobby: Lobby = game.lobby;
    lobby = (await (await app.post('/api/settings/commands', { commandId: randomUUID(), expectedRevision: lobby.revision, roundId: null, openingProtection: 0 }, game.cookies[0])).json()).lobby;
    lobby = (await (await app.post('/api/round/commands', roundInput(lobby, 'start'), game.cookies[0])).json()).lobby;
    const roles = await Promise.all(game.cookies.map(async cookie => (await (await fetch(`${app.url}/api/role?roundId=${lobby.roundId}`, { headers: { Cookie: cookie } })).json()).role));
    const impostor = game.cookies[roles.indexOf('impostor')];
    const crewCookies = game.cookies.filter(cookie => cookie !== impostor);
    const victimId = (await game.snapshot(crewCookies[0])).you.id;
    const call = (kind: string, cookie: string) => app.post('/api/meetings', { commandId: randomUUID(), roundId: lobby.roundId, kind }, cookie);

    expect((await (await call('organiser', crewCookies[1])).json()).error).toBe('FORBIDDEN');
    expect((await app.post('/api/eliminate', { commandId: randomUUID(), roundId: lobby.roundId, targetId: victimId }, impostor)).status).toBe(200);
    expect((await (await call('report', crewCookies[0])).json()).error).toBe('NOT_ALIVE');

    // A body report stops play while everyone gathers; the body stays private until the
    // organiser starts the meeting, which turns it into a public ghost.
    clock += 5_000;
    const reported = await (await call('report', crewCookies[1])).json();
    expect(reported.lobby.phase).toBe('meeting');
    const reporter = (await game.snapshot(crewCookies[1])).you.id;
    expect(reported.lobby.meeting).toEqual({ kind: 'report', calledBy: reporter, stage: 'gathering', discussionMs: null, newGhosts: [] });
    expect(JSON.stringify((await game.snapshot(game.cookies[0])).players)).not.toMatch(/"out"/);
    const gathered = await game.snapshot(game.cookies[0]);
    const started = await (await app.post('/api/meeting/commands', { action: 'start', out: [], commandId: randomUUID(), roundId: lobby.roundId, expectedRevision: gathered.revision }, game.cookies[0])).json();
    expect(started.lobby.meeting).toMatchObject({ stage: 'discussion', discussionMs: 90_000, newGhosts: [victimId] });
    const seen = await game.snapshot(game.cookies[0]);
    expect(seen.players.find(player => player.id === victimId)!.out).toBe(true);
    expect((await game.snapshot(crewCookies[0])).you.status).toBe('ghost');
    expect((await app.post('/api/eliminate', { commandId: randomUUID(), roundId: lobby.roundId, targetId: reporter }, impostor)).status).toBe(409);
    const task = (await game.snapshot(crewCookies[1])).you.tasks[0];
    expect((await (await app.post('/api/tasks/complete', { roundId: lobby.roundId, taskId: task.id, answer: '0000' }, crewCookies[1])).json()).error).toBe('INVALID_PHASE');
    clock += 30_000;
    expect((await game.snapshot()).meeting!.discussionMs).toBe(60_000);

    // Meeting time is not play time; the organiser ends the meeting to continue.
    lobby = (await (await app.post('/api/round/commands', roundInput(seen, 'endMeeting'), game.cookies[0])).json()).lobby;
    expect(lobby.phase).toBe('active');
    expect(lobby.meeting).toBeUndefined();
    const info = (await (await fetch(`${app.url}/api/role?roundId=${lobby.roundId}`, { headers: { Cookie: impostor } })).json()).elimination;
    expect(info.readyInMs).toBe(55_000);

    // Each living player has one emergency meeting; ghosts cannot call one.
    expect((await (await call('emergency', crewCookies[0])).json()).error).toBe('NOT_ALIVE');
    const emergency = await (await call('emergency', crewCookies[2])).json();
    expect(emergency.lobby.meeting).toMatchObject({ kind: 'emergency', stage: 'gathering', newGhosts: [] });
    expect(emergency.lobby.you.emergencyLeft).toBe(0);
    lobby = (await (await app.post('/api/round/commands', roundInput(emergency.lobby, 'endMeeting'), game.cookies[0])).json()).lobby;
    expect((await (await call('emergency', crewCookies[2])).json()).error).toBe('NO_EMERGENCY_LEFT');

    // Organiser switches turn each kind off; the organiser can still call a meeting.
    lobby = (await (await app.post('/api/settings/commands', { commandId: randomUUID(), expectedRevision: lobby.revision, roundId: lobby.roundId, bodyReports: false, emergencyMeetings: false }, game.cookies[0])).json()).lobby;
    expect(lobby.settings).toMatchObject({ bodyReports: false, emergencyMeetings: false });
    expect((await (await call('report', crewCookies[1])).json()).error).toBe('REPORTS_OFF');
    expect((await (await call('emergency', crewCookies[1])).json()).error).toBe('EMERGENCY_OFF');
    const organiserMeeting = await (await call('organiser', game.cookies[0])).json();
    expect(organiserMeeting.lobby.meeting).toMatchObject({ kind: 'organiser', calledBy: null });
    lobby = (await (await app.post('/api/round/commands', roundInput(organiserMeeting.lobby, 'end'), game.cookies[0])).json()).lobby;
    expect(lobby.phase).toBe('ended');
  });
});

describe('voting', () => {
  async function meetingGame(phoneVoting: boolean) {
    const app = await start();
    const game = await crew(app);
    let lobby: Lobby = (await (await app.post('/api/settings/commands', { commandId: randomUUID(), expectedRevision: game.lobby.revision, roundId: null, phoneVoting }, game.cookies[0])).json()).lobby;
    lobby = (await (await app.post('/api/round/commands', roundInput(lobby, 'start'), game.cookies[0])).json()).lobby;
    const roles = await Promise.all(game.cookies.map(async cookie => (await (await fetch(`${app.url}/api/role?roundId=${lobby.roundId}`, { headers: { Cookie: cookie } })).json()).role));
    const ids = await Promise.all(game.cookies.map(async cookie => (await game.snapshot(cookie)).you.id));
    const step = async (action: object) => {
      const current = await game.snapshot();
      return (await app.post('/api/meeting/commands', { ...action, commandId: randomUUID(), roundId: current.roundId, expectedRevision: current.revision }, game.cookies[0])).json();
    };
    lobby = (await (await app.post('/api/meetings', { commandId: randomUUID(), roundId: lobby.roundId, kind: 'organiser' }, game.cookies[0])).json()).lobby;
    return { app, game, roles, ids, step, lobby };
  }

  it('lets the organiser mark found players, runs a phone vote, and ejects the unique highest', async () => {
    const { app, game, roles, ids, step, lobby } = await meetingGame(true);
    const crewIndexes = roles.map((role, index) => role === 'crewmate' ? index : -1).filter(index => index >= 0);
    const found = ids[crewIndexes[0]];
    // Marked as found: becomes a public ghost and can no longer vote.
    expect((await step({ action: 'openVote' })).error).toBe('INVALID_PHASE');
    expect((await step({ action: 'start', out: [found] })).lobby.meeting.newGhosts).toEqual([found]);
    const vote = (cookie: string, target: string) => app.post('/api/vote', { roundId: lobby.roundId, target }, cookie);
    expect((await (await vote(game.cookies[1], 'skip')).json()).error).toBe('VOTING_CLOSED');
    expect((await step({ action: 'openVote' })).lobby.meeting).toMatchObject({ stage: 'voting', votes: { cast: 0, eligible: 5 } });
    expect((await (await vote(game.cookies[crewIndexes[0]], 'skip')).json()).error).toBe('NOT_ALIVE');
    const suspect = ids[crewIndexes[1]];
    const voters = [0, 1, 2, 3, 4, 5].filter(index => index !== crewIndexes[0]);
    // Three for the suspect, one skip, one changes their mind; votes stay secret until closed.
    await vote(game.cookies[voters[0]], suspect);
    await vote(game.cookies[voters[1]], suspect);
    await vote(game.cookies[voters[2]], 'skip');
    await vote(game.cookies[voters[3]], 'skip');
    const changed = await (await vote(game.cookies[voters[3]], suspect)).json();
    expect(changed.lobby.you.vote).toBe(suspect);
    expect(changed.lobby.meeting).toMatchObject({ votes: { cast: 4, eligible: 5 } });
    expect(JSON.stringify(changed.lobby.meeting)).not.toContain('tally');
    const closed = (await step({ action: 'closeVote' })).lobby;
    expect(closed.meeting.result.ejected).toBe(suspect);
    expect(closed.meeting.result.tally[0]).toEqual({ target: suspect, voters: expect.arrayContaining([ids[voters[0]], ids[voters[1]], ids[voters[3]]]) });
    expect(closed.players.find((player: { id: string }) => player.id === suspect).out).toBe(true);
    expect(closed.phase).toBe(roles[crewIndexes[1]] === 'impostor' ? 'ended' : 'meeting');
  });

  it('records a physical vote: ejecting the Impostor wins for the crew, a tie ejects nobody', async () => {
    const { roles, ids, step, game, app } = await meetingGame(false);
    await step({ action: 'start', out: [] });
    expect((await step({ action: 'openVote' })).error).toBe('PHONE_VOTING_OFF');
    expect((await step({ action: 'record', ejected: null })).lobby.meeting.result).toEqual({ ejected: null, tally: null });
    let lobby = (await (await app.post('/api/round/commands', roundInput(await game.snapshot(), 'endMeeting'), game.cookies[0])).json()).lobby as Lobby;
    lobby = (await (await app.post('/api/meetings', { commandId: randomUUID(), roundId: lobby.roundId, kind: 'organiser' }, game.cookies[0])).json()).lobby;
    await step({ action: 'start', out: [] });
    const ended = (await step({ action: 'record', ejected: ids[roles.indexOf('impostor')] })).lobby as Lobby;
    expect(ended.phase).toBe('ended');
    expect(ended.result).toEqual({ winner: 'crew', reason: 'ejected' });
  });
});
