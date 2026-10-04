import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Lobby, RoleInfo, SettingsCommand } from '../../shared/protocol.js';
import { cleanup, crew, roundInput, start } from './helpers.js';

afterEach(cleanup);

// A started six-player round on a controllable clock, with the Impostor and the crew sorted out.
async function round(settings: Partial<SettingsCommand> = {}) {
  let clock = 9_000_000;
  const app = await start(':memory:', () => clock);
  const game = await crew(app);
  const host = game.cookies[0];
  const change = async (lobby: Lobby, values: Partial<SettingsCommand>) => (await (await app.post('/api/settings/commands',
    { commandId: randomUUID(), expectedRevision: lobby.revision, roundId: lobby.roundId, ...values }, host)).json()).lobby as Lobby;
  let lobby = game.lobby;
  if (Object.keys(settings).length) lobby = await change(lobby, settings);
  lobby = (await (await app.post('/api/round/commands', roundInput(lobby, 'start'), host)).json()).lobby;
  const roundId = lobby.roundId!;
  const roleOf = async (cookie: string): Promise<RoleInfo> => (await fetch(`${app.url}/api/role?roundId=${roundId}`, { headers: { Cookie: cookie } })).json();
  const infos = await Promise.all(game.cookies.map(roleOf));
  const impostor = game.cookies[infos.findIndex(info => info.role === 'impostor')];
  const crewCookies = game.cookies.filter(cookie => cookie !== impostor);
  const sabotage = (cookie = impostor) => app.post('/api/sabotage', { commandId: randomUUID(), roundId }, cookie);
  const repair = (cookie: string, stationId: string) => app.post('/api/reactor/repair', { roundId, stationId }, cookie);
  const advance = (ms: number) => { clock += ms; app.tick(); };
  return { app, game, host, impostor, crewCookies, roundId, lobby, roleOf, sabotage, repair, advance, change };
}

describe('reactor meltdown sabotage', () => {
  it('lets only the Impostor start it once, after opening protection, without saying who did', async () => {
    const { game, impostor, crewCookies, roleOf, sabotage, advance, lobby } = await round();
    expect(lobby.settings).toMatchObject({ sabotage: true, reactorTime: 90 });
    expect((await roleOf(impostor)).sabotage).toEqual({ used: false, readyInMs: 60_000, running: true });
    expect((await roleOf(crewCookies[0])).sabotage).toBeUndefined();
    expect((await (await sabotage(crewCookies[0])).json()).error).toBe('FORBIDDEN');
    expect((await (await sabotage()).json()).error).toBe('NOT_READY');

    advance(60_000);
    const before = (await game.snapshot()).revision;
    const started = await (await sabotage()).json();
    expect(started.role.sabotage).toMatchObject({ used: true });
    const impostorId = (await game.snapshot(impostor)).you.id;
    for (const cookie of game.cookies) {
      const state = await game.snapshot(cookie);
      expect(state.revision).toBeGreaterThan(before);
      expect(state.reactor).toEqual({ msLeft: 90_000, running: true, panel: null });
      expect(JSON.stringify(state.reactor)).not.toContain(impostorId);
    }
    expect((await (await sabotage()).json()).error).toBe('SABOTAGE_USED');
  });

  it('is repaired by two different players at two different stations within the window', async () => {
    const { app, game, impostor, crewCookies, roundId, lobby, roleOf, sabotage, repair, advance } = await round();
    const [kitchen, living] = lobby.stations.map(station => station.id);
    advance(60_000);
    await sabotage();
    expect((await (await app.post('/api/meetings', { commandId: randomUUID(), roundId, kind: 'emergency' }, crewCookies[0])).json()).error).toBe('REACTOR_ACTIVE');

    // One player alone cannot repair it from two stations.
    await repair(crewCookies[0], kitchen);
    expect((await game.snapshot(crewCookies[0])).reactor?.panel).toMatchObject({ stationId: kitchen, msLeft: 10_000, yours: true });
    expect((await game.snapshot(crewCookies[1])).reactor?.panel).toMatchObject({ stationId: kitchen, yours: false });
    expect((await (await repair(crewCookies[0], living)).json()).repaired).toBe(false);
    // Two players at the same station do not repair it either.
    expect((await (await repair(crewCookies[1], living)).json()).repaired).toBe(false);
    // A lapsed activation does not count.
    advance(11_000);
    expect((await game.snapshot()).reactor?.panel).toBeNull();
    expect((await (await repair(crewCookies[2], kitchen)).json()).repaired).toBe(false);
    advance(5_000);
    // The Impostor may help, so repairing proves nothing.
    expect((await (await repair(impostor, living)).json()).repaired).toBe(true);
    const state = await game.snapshot();
    expect(state.reactor).toBeUndefined();
    expect(state.phase).toBe('active');
    expect((await roleOf(impostor)).sabotage).toMatchObject({ used: true });
    expect((await (await repair(crewCookies[0], kitchen)).json()).repaired).toBe(false);
  });

  it('melts down for an Impostor win, with the countdown stopped by meetings and pauses', async () => {
    const { app, game, host, crewCookies, roundId, lobby, sabotage, repair, advance } = await round();
    const [kitchen] = lobby.stations.map(station => station.id);
    advance(60_000);
    await sabotage();
    advance(30_000);
    await repair(crewCookies[0], kitchen);
    // A body report stops the countdown and clears the repair activation.
    await app.post('/api/meetings', { commandId: randomUUID(), roundId, kind: 'report' }, crewCookies[1]);
    advance(600_000);
    let state = await game.snapshot();
    expect(state.reactor).toEqual({ msLeft: 60_000, running: false, panel: null });
    state = (await (await app.post('/api/round/commands', roundInput(state, 'endMeeting'), host)).json()).lobby;
    state = (await (await app.post('/api/round/commands', roundInput(state, 'pause'), host)).json()).lobby;
    advance(600_000);
    expect((await game.snapshot()).phase).toBe('paused');
    state = (await (await app.post('/api/round/commands', roundInput(state, 'resume'), host)).json()).lobby;
    advance(59_000);
    expect((await game.snapshot()).phase).toBe('active');
    advance(1_000);
    const ended = await game.snapshot();
    expect(ended.phase).toBe('ended');
    expect(ended.result).toEqual({ winner: 'impostor', reason: 'reactor' });
  });

  it('holds a task win until the repair, and switching sabotage off stops a meltdown without a loss', async () => {
    const { app, game, impostor, crewCookies, roundId, lobby, sabotage, advance, change } = await round({ taskGames: ['order'], taskGoalPercent: 10 });
    advance(60_000);
    await sabotage();
    // The goal is 2 of 20 real tasks: two Crewmates each finish one.
    for (const cookie of crewCookies.slice(0, 2)) {
      const task = (await game.snapshot(cookie)).you.tasks[0];
      if (task.puzzle.kind !== 'order') throw new Error('Expected a number order task');
      const answer = [...task.puzzle.numbers].sort((a, b) => a - b);
      expect((await app.post('/api/tasks/complete', { roundId, taskId: task.id, answer }, cookie)).status).toBe(200);
    }
    expect((await game.snapshot()).phase).toBe('active');

    const state = await change(await game.snapshot(), { sabotage: false });
    expect(state.settings.sabotage).toBe(false);
    expect(state.reactor).toBeUndefined();
    // The task win that waited for the reactor counts now.
    expect(state.phase).toBe('ended');
    expect(state.result).toEqual({ winner: 'crew', reason: 'tasks' });
    expect(lobby.settings.sabotage).toBe(true);
    expect((await (await app.post('/api/sabotage', { commandId: randomUUID(), roundId }, impostor)).json()).error).toBe('INVALID_PHASE');
  });

  it('refuses sabotage when the organiser switched it off', async () => {
    const { impostor, roleOf, sabotage, advance } = await round({ sabotage: false, reactorTime: 45 });
    advance(60_000);
    expect((await roleOf(impostor)).sabotage).toBeUndefined();
    expect((await (await sabotage()).json()).error).toBe('SABOTAGE_OFF');
  });

  it('switches off a meltdown the organiser rejects when victories need confirming', async () => {
    const { app, game, host, sabotage, advance } = await round({ confirmVictory: true, reactorTime: 30 });
    advance(60_000);
    await sabotage();
    advance(30_000);
    let state = await game.snapshot();
    expect(state).toMatchObject({ phase: 'paused', pauseReason: 'victory', proposedResult: { winner: 'impostor', reason: 'reactor' } });
    state = (await (await app.post('/api/round/commands', roundInput(state, 'rejectResult'), host)).json()).lobby;
    expect(state.reactor).toBeUndefined();
    state = (await (await app.post('/api/round/commands', roundInput(state, 'resume'), host)).json()).lobby;
    advance(5_000);
    expect((await game.snapshot()).phase).toBe('active');
  });
});
