import { afterEach, describe, expect, it } from 'vitest';
import type { Lobby, RoundCommand } from '../../shared/protocol.js';
import { randomUUID } from 'node:crypto';
import { cleanup, start, roundInput, crew } from './helpers.js';

afterEach(cleanup);

describe('organiser corrections and recovery', () => {
  async function round() {
    const app = await start();
    const game = await crew(app);
    let lobby: Lobby = (await (await app.post('/api/settings/commands', { commandId: randomUUID(), expectedRevision: game.lobby.revision, roundId: null, openingProtection: 0 }, game.cookies[0])).json()).lobby;
    lobby = (await (await app.post('/api/round/commands', roundInput(lobby, 'start'), game.cookies[0])).json()).lobby;
    const roles = await Promise.all(game.cookies.map(async cookie => (await (await fetch(`${app.url}/api/role?roundId=${lobby.roundId}`, { headers: { Cookie: cookie } })).json()).role as string));
    const ids = await Promise.all(game.cookies.map(async cookie => (await game.snapshot(cookie)).you.id));
    const fix = async (change: object, cookie = game.cookies[0]) => {
      const current = await game.snapshot();
      return (await app.post('/api/corrections', { ...change, commandId: randomUUID(), roundId: current.roundId, expectedRevision: current.revision }, cookie)).json();
    };
    // Stations get tasks at random, and the goal is rounded up, so removing a station with
    // only one real task can leave the goal unchanged. The busiest station always lowers it.
    const crewTasks = (await Promise.all(game.cookies.filter((_, index) => roles[index] === 'crewmate').map(async cookie => (await game.snapshot(cookie)).you.tasks))).flat();
    const busiest = [...lobby.stations].sort((a, b) => crewTasks.filter(task => task.stationId === b.id).length - crewTasks.filter(task => task.stationId === a.id).length)[0];
    return { app, game, lobby, roles, ids, fix, busiest };
  }

  it('credits or removes a broken station for everyone and rechecks the task goal', async () => {
    const { game, lobby, fix, busiest: first } = await round();
    expect((await fix({ action: 'restoreEmergency' }, game.cookies[1])).error).toBe('FORBIDDEN');
    const others = lobby.stations.filter(station => station.id !== first.id);
    const before = (await game.snapshot()).progress!;
    await fix({ action: 'removeStationTasks', stationId: first.id });
    for (const cookie of game.cookies) expect((await game.snapshot(cookie)).you.tasks.some(task => task.stationId === first.id)).toBe(false);
    const after = (await game.snapshot()).progress!;
    expect(after.goal).toBeLessThan(before.goal);
    // Crediting every other station completes all remaining real tasks: the crew wins.
    let result: { lobby: Lobby } = { lobby };
    for (const station of others) result = await fix({ action: 'creditStation', stationId: station.id });
    expect(result.lobby.phase).toBe('ended');
    expect(result.lobby.result).toEqual({ winner: 'crew', reason: 'tasks' });
  });

  it('corrects player states without revealing them, restores emergency meetings, and ends with a chosen winner', async () => {
    const { app, game, roles, ids, fix } = await round();
    const crewIndex = roles.indexOf('crewmate');
    const impostorIndex = roles.indexOf('impostor');
    const roundId = (await game.snapshot()).roundId;
    await app.post('/api/eliminate', { commandId: randomUUID(), roundId, targetId: ids[crewIndex] }, game.cookies[impostorIndex]);
    expect((await game.snapshot(game.cookies[crewIndex])).you.status).toBe('body');
    // The response looks the same whatever the previous state was.
    const revived = await fix({ action: 'setStatus', playerId: ids[crewIndex], status: 'alive' });
    const unchanged = await fix({ action: 'setStatus', playerId: ids[crewIndex], status: 'alive' });
    expect(Object.keys(revived.lobby).sort()).toEqual(Object.keys(unchanged.lobby).sort());
    expect((await game.snapshot(game.cookies[crewIndex])).you.status).toBe('alive');
    await fix({ action: 'setStatus', playerId: ids[crewIndex], status: 'ghost' });
    expect((await game.snapshot()).players.find(player => player.id === ids[crewIndex])!.out).toBe(true);

    const emergency = await (await app.post('/api/meetings', { commandId: randomUUID(), roundId, kind: 'emergency' }, game.cookies[(crewIndex + 1) % 6 === impostorIndex ? (crewIndex + 2) % 6 : (crewIndex + 1) % 6])).json();
    expect(emergency.lobby.you.emergencyLeft).toBe(0);
    await fix({ action: 'restoreEmergency' });
    expect((await game.snapshot(game.cookies[(crewIndex + 1) % 6 === impostorIndex ? (crewIndex + 2) % 6 : (crewIndex + 1) % 6])).you.emergencyLeft).toBe(1);

    const lobby = await game.snapshot();
    const ended = (await (await app.post('/api/round/commands', { ...roundInput(lobby, 'end'), winner: 'impostor' }, game.cookies[0])).json()).lobby as Lobby;
    expect(ended.result).toEqual({ winner: 'impostor', reason: 'organiser' });
  });

  it('marking the Impostor out counts as catching them', async () => {
    const { roles, ids, fix } = await round();
    const result = await fix({ action: 'setStatus', playerId: ids[roles.indexOf('impostor')], status: 'ghost' });
    expect(result.lobby.result).toEqual({ winner: 'crew', reason: 'ejected' });
  });

  it('replaces a station\'s unfinished tasks with new ones elsewhere, keeping every list and the goal', async () => {
    const { game, lobby, fix } = await round();
    const [broken, other] = lobby.stations;
    const before = await Promise.all(game.cookies.map(cookie => game.snapshot(cookie)));
    await fix({ action: 'replaceStationTasks', stationId: broken.id, targetStationId: null });
    const after = await Promise.all(game.cookies.map(cookie => game.snapshot(cookie)));
    after.forEach((state, index) => {
      expect(state.you.tasks).toHaveLength(before[index].you.tasks.length);
      expect(state.you.tasks.some(task => task.stationId === broken.id)).toBe(false);
    });
    expect(after[0].progress!.goal).toBe(before[0].progress!.goal);
    await fix({ action: 'replaceStationTasks', stationId: other.id, targetStationId: broken.id });
    for (const cookie of game.cookies) expect((await game.snapshot(cookie)).you.tasks.some(task => task.stationId === other.id)).toBe(false);
    expect((await fix({ action: 'replaceStationTasks', stationId: other.id, targetStationId: randomUUID() })).error).toBe('INVALID_INPUT');
  });

  it('keeps a redacted history for the organiser and undoes only the latest correction', async () => {
    const { app, game, lobby, roles, ids, fix } = await round();
    const [first] = lobby.stations;
    const tasksAt = async (cookie: string) => (await game.snapshot(cookie)).you.tasks.filter(task => task.stationId === first.id);
    const before = await Promise.all(game.cookies.map(tasksAt));
    await fix({ action: 'creditStation', stationId: first.id });
    const crewIndex = roles.indexOf('crewmate', 1);
    let state = (await fix({ action: 'setStatus', playerId: ids[crewIndex], status: 'ghost' })).lobby as Lobby;
    expect(state.history!.map(entry => entry.action)).toEqual(['setStatus', 'creditStation']);
    expect(state.history![0]).toMatchObject({ player: (await game.snapshot(game.cookies[crewIndex])).players[crewIndex].name, status: 'ghost', canUndo: true, undone: false });
    expect(state.history![1]).toMatchObject({ station: first.name, canUndo: false });
    // Nothing about hidden state is in the history, and players never receive it.
    expect(JSON.stringify(state.history)).not.toMatch(/impostor|crewmate|body|fake/);
    expect((await game.snapshot(game.cookies[1])).history).toBeUndefined();
    expect((await fix({ action: 'undo', changeId: state.history![1].id })).error).toBe('UNDO_UNAVAILABLE');
    expect((await fix({ action: 'undo', changeId: state.history![0].id }, game.cookies[1])).error).toBe('FORBIDDEN');
    state = (await fix({ action: 'undo', changeId: state.history![0].id })).lobby;
    expect(state.players[crewIndex].out).toBeUndefined();
    state = (await fix({ action: 'undo', changeId: state.history![1].id })).lobby;
    expect(state.history!.every(entry => entry.undone && !entry.canUndo)).toBe(true);
    expect(await Promise.all(game.cookies.map(tasksAt))).toEqual(before);
    // A player removal is logged but cannot be undone; it also blocks undoing earlier changes.
    state = (await fix({ action: 'removeStationTasks', stationId: first.id })).lobby;
    const removeInput = { action: 'remove', playerId: ids[crewIndex], commandId: randomUUID(), code: state.code, expectedRevision: state.revision, roundId: state.roundId };
    state = (await (await app.post('/api/room/commands', removeInput, game.cookies[0])).json()).lobby;
    expect(state.history!.slice(0, 2).map(entry => [entry.action, entry.canUndo])).toEqual([['removePlayer', false], ['removeStationTasks', false]]);
    // With the history switched off there is no list and no undo.
    const off = await (await app.post('/api/settings/commands', { commandId: randomUUID(), expectedRevision: state.revision, roundId: state.roundId, changeHistory: false }, game.cookies[0])).json();
    expect(off.lobby.history).toBeUndefined();
  });

  it('previews whether a change ends the round without applying it or naming a team', async () => {
    const { app, game, roles, ids, lobby, busiest } = await round();
    const preview = async (path: string, body: object, cookie = game.cookies[0]) => {
      const current = await game.snapshot();
      return (await app.post(path, { ...body, commandId: randomUUID(), roundId: current.roundId, expectedRevision: current.revision, code: current.code }, cookie)).json();
    };
    const impostor = ids[roles.indexOf('impostor')];
    const crewmate = ids[roles.indexOf('crewmate', 1)];
    const revision = (await game.snapshot()).revision;
    expect(await preview('/api/corrections/preview', { action: 'setStatus', playerId: impostor, status: 'ghost' })).toEqual({ preview: { outcome: 'ends', goal: lobby.progress!.goal } });
    expect(await preview('/api/corrections/preview', { action: 'setStatus', playerId: crewmate, status: 'ghost' })).toEqual({ preview: { outcome: 'continues', goal: lobby.progress!.goal } });
    // Roles are random: when the organiser is the Impostor they cannot remove themselves.
    const removeImpostor = await preview('/api/room/preview', { action: 'remove', playerId: impostor });
    if (impostor === ids[0]) expect(removeImpostor.error).toBe('CANNOT_REMOVE_ORGANISER');
    else expect(removeImpostor.preview.outcome).toBe('ends');
    expect((await preview('/api/room/preview', { action: 'remove', playerId: crewmate })).preview.goal).toBeLessThan(lobby.progress!.goal);
    const removeStation = await preview('/api/corrections/preview', { action: 'removeStationTasks', stationId: busiest.id });
    expect(removeStation.preview.goal).toBeLessThan(lobby.progress!.goal);
    // Nothing was applied.
    const unchanged = await game.snapshot();
    expect(unchanged.revision).toBe(revision);
    expect(unchanged.phase).toBe('active');
    expect(unchanged.history).toEqual([]);
    expect(unchanged.progress!.goal).toBe(lobby.progress!.goal);
    expect((await preview('/api/corrections/preview', { action: 'restoreEmergency' }, game.cookies[1])).error).toBe('FORBIDDEN');
    expect((await preview('/api/room/preview', { action: 'destroy' })).error).toBe('INVALID_INPUT');
    await app.post('/api/settings/commands', { commandId: randomUUID(), expectedRevision: revision, roundId: unchanged.roundId, changePreviews: false }, game.cookies[0]);
    expect((await preview('/api/corrections/preview', { action: 'restoreEmergency' })).error).toBe('PREVIEWS_OFF');
  });

  it('with confirmed victories, stops play for the organiser to confirm, reject or correct a detected win', async () => {
    const { app, game, roles, ids, fix } = await round();
    const act = async (action: RoundCommand['action']) => (await app.post('/api/round/commands', roundInput(await game.snapshot(), action), game.cookies[0])).json();
    const current = await game.snapshot();
    await app.post('/api/settings/commands', { commandId: randomUUID(), expectedRevision: current.revision, roundId: current.roundId, confirmVictory: true }, game.cookies[0]);
    const impostor = ids[roles.indexOf('impostor')];
    let state = (await fix({ action: 'setStatus', playerId: impostor, status: 'ghost' })).lobby as Lobby;
    expect(state).toMatchObject({ phase: 'paused', pauseReason: 'victory', proposedResult: { winner: 'crew', reason: 'ejected' } });
    expect(state.revealedRoles).toBeUndefined();
    // Players only learn that play stopped, not the proposed result.
    const player = await game.snapshot(game.cookies[1]);
    expect(player.pauseReason).toBe('victory');
    expect(player.proposedResult).toBeUndefined();
    expect((await act('resume')).error).toBe('INVALID_PHASE');
    // Rejecting keeps play paused; resuming while still won stops again.
    state = (await act('rejectResult')).lobby;
    expect(state).toMatchObject({ phase: 'paused', pauseReason: 'organiser' });
    expect(state.proposedResult).toBeUndefined();
    state = (await act('resume')).lobby;
    expect(state).toMatchObject({ phase: 'paused', pauseReason: 'victory' });
    // Undoing the cause withdraws the proposal; play can resume.
    state = (await fix({ action: 'undo', changeId: state.history![0].id })).lobby;
    expect(state).toMatchObject({ phase: 'paused', pauseReason: 'organiser' });
    expect((await act('resume')).lobby.phase).toBe('active');
    await fix({ action: 'setStatus', playerId: impostor, status: 'ghost' });
    state = (await act('confirmResult')).lobby;
    expect(state.phase).toBe('ended');
    expect(state.result).toEqual({ winner: 'crew', reason: 'ejected' });
    expect(state.revealedRoles).toHaveLength(6);
  });

  it('lets a player who lost their session rejoin once with a code from the organiser', async () => {
    const { app, game, ids, lobby } = await round();
    const code = async () => (await (await app.post('/api/room/commands', { action: 'rejoinCode', playerId: ids[2], commandId: randomUUID(), code: lobby.code, expectedRevision: (await game.snapshot()).revision, roundId: lobby.roundId }, game.cookies[0])).json()).rejoin as string;
    expect((await app.post('/api/room/commands', { action: 'rejoinCode', playerId: ids[2], commandId: randomUUID(), code: lobby.code, expectedRevision: (await game.snapshot()).revision, roundId: lobby.roundId }, game.cookies[1])).status).toBe(403);
    const rejoinCode = await code();
    expect(rejoinCode).toMatch(/^[A-Z0-9]{8}$/);
    const response = await app.post('/api/games/rejoin', { code: rejoinCode.toLowerCase() });
    expect(response.status).toBe(200);
    const cookie = response.headers.get('set-cookie')!;
    const restored = await game.snapshot(cookie);
    expect(restored.you.id).toBe(ids[2]);
    expect(restored.you.tasks).toEqual((await game.snapshot(cookie)).you.tasks);
    // The old session no longer works, and the code works only once.
    expect(await game.snapshot(game.cookies[2])).toBeNull();
    expect((await (await app.post('/api/games/rejoin', { code: rejoinCode })).json()).error).toBe('REJOIN_EXPIRED');
  });
});
