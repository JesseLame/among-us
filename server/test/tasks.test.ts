import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import type { Lobby, PrintableStation, Task } from '../../shared/protocol.js';
import { randomUUID } from 'node:crypto';
import { cleanup, start, roundInput, roomInput, crew, stationInput, answerFor } from './helpers.js';

afterEach(cleanup);

describe('stations and tasks', () => {
  it('lets only the organiser edit stations in the lobby and print codebooks', async () => {
    const app = await start();
    const created = await app.post('/api/games', { name: 'Host', language: 'nl' });
    const host = created.headers.get('set-cookie')!;
    let lobby: Lobby = (await created.json()).lobby;
    expect(lobby.stations.map(station => station.name)).toEqual(['Keuken', 'Woonkamer', 'Gang', 'Werkkamer']);
    const guest = (await app.post('/api/games/join', { name: 'Guest', code: lobby.code })).headers.get('set-cookie')!;
    lobby = (await (await fetch(`${app.url}/api/session`, { headers: { Cookie: host } })).json()).lobby;
    expect((await app.post('/api/stations/commands', stationInput(lobby, { action: 'add', name: 'Attic' }), guest)).status).toBe(403);
    expect((await fetch(`${app.url}/api/stations/print`, { headers: { Cookie: guest } })).status).toBe(403);
    expect((await (await app.post('/api/stations/commands', stationInput(lobby, { action: 'add', name: 'keuken' }), host)).json()).error).toBe('STATION_EXISTS');
    const add = stationInput(lobby, { action: 'add', name: 'Zolder' });
    lobby = (await (await app.post('/api/stations/commands', add, host)).json()).lobby;
    expect((await (await app.post('/api/stations/commands', add, host)).json()).lobby).toEqual(lobby);
    expect(lobby.stations).toHaveLength(5);
    const printable: PrintableStation[] = (await (await fetch(`${app.url}/api/stations/print`, { headers: { Cookie: host } })).json()).stations;
    expect(Array.isArray((await (await fetch(`${app.url}/api/network`, { headers: { Cookie: guest } })).json()).lanAddresses)).toBe(true);
    expect((await fetch(`${app.url}/api/network`)).status).toBe(401);
    expect(printable.map(station => station.name)).toEqual(lobby.stations.map(station => station.name));
    expect(Object.values(printable[0].codebook).every(digit => Number.isInteger(digit) && digit >= 0 && digit <= 9)).toBe(true);
    expect(JSON.stringify(lobby)).not.toMatch(/codebook"|"star":/);
    for (const station of lobby.stations) {
      lobby = (await (await app.post('/api/stations/commands', stationInput(lobby, { action: 'remove', stationId: station.id }), host)).json()).lobby;
    }
    expect(lobby.stations).toEqual([]);
    expect((await (await app.post('/api/round/commands', roundInput(lobby, 'start'), host)).json()).error).toBe('NO_STATIONS');
    lobby = (await (await app.post('/api/stations/commands', stationInput(lobby, { action: 'add', name: 'Hal' }), host)).json()).lobby;
    lobby = (await (await app.post('/api/round/commands', roundInput(lobby, 'start'), host)).json()).lobby;
    expect((await (await app.post('/api/stations/commands', stationInput(lobby, { action: 'add', name: 'Tuin' }), host)).json()).error).toBe('INVALID_PHASE');
    // Station access defaults to QR-only; only the organiser can change it, also mid-round.
    expect(lobby.settings).toEqual({ stationAccess: 'qr', eliminations: true, bodyReports: true, emergencyMeetings: true, phoneVoting: false, openingProtection: 60, killCooldown: 60, discussionTime: 90, emergencyAllowance: 1, progressInterval: 30, tasksPerPlayer: 4, taskGoalPercent: 80, confirmVictory: false, changePreviews: true, changeHistory: true, simonTasks: true });
    const settings = { commandId: randomUUID(), expectedRevision: lobby.revision, roundId: lobby.roundId, stationAccess: 'manual' };
    expect((await app.post('/api/settings/commands', settings, guest)).status).toBe(403);
    expect((await app.post('/api/settings/commands', { ...settings, stationAccess: 'anything' }, host)).status).toBe(400);
    lobby = (await (await app.post('/api/settings/commands', settings, host)).json()).lobby;
    expect(lobby.settings.stationAccess).toBe('manual');
    expect((await (await fetch(`${app.url}/api/session`, { headers: { Cookie: guest } })).json()).lobby.settings.stationAccess).toBe('manual');
    expect((await (await app.post('/api/settings/commands', { ...settings, commandId: randomUUID() }, host)).json()).error).toBe('STALE_COMMAND');
  });

  it('assigns private tasks, keeps fake tasks out of progress, batches progress, and ends on the task goal', async () => {
    let clock = 1_000_000;
    const app = await start(':memory:', () => clock);
    const game = await crew(app);
    const active: Lobby = (await (await app.post('/api/round/commands', roundInput(game.lobby, 'start'), game.cookies[0])).json()).lobby;
    const stations: PrintableStation[] = (await (await fetch(`${app.url}/api/stations/print`, { headers: { Cookie: game.cookies[0] } })).json()).stations;
    const players = await Promise.all(game.cookies.map(async cookie => ({
      cookie,
      role: (await (await fetch(`${app.url}/api/role?roundId=${active.roundId}`, { headers: { Cookie: cookie } })).json()).role as string,
      lobby: await game.snapshot(cookie),
    })));
    for (const player of players) {
      expect(player.lobby.you.tasks).toHaveLength(4);
      expect(player.lobby.progress).toEqual({ done: 0, goal: 16 });
      expect(JSON.stringify(player.lobby)).not.toMatch(/fake|crewmate|impostor|"role"/);
      expect(new Set(player.lobby.you.tasks.map(task => task.puzzle.kind)).size).toBeGreaterThan(1);
    }
    const complete = (cookie: string, task: Task, answer: unknown = answerFor(task, stations)) =>
      app.post('/api/tasks/complete', { roundId: active.roundId, taskId: task.id, answer }, cookie);

    const impostor = players.find(player => player.role === 'impostor')!;
    const crewmates = players.filter(player => player !== impostor);
    const [first] = crewmates[0].lobby.you.tasks;
    expect((await complete(crewmates[1].cookie, first)).status).toBe(404);
    expect((await (await complete(crewmates[0].cookie, first, first.puzzle.kind === 'codebook' ? '9999' : [0, 0, 0, 0])).json()).error).toBe('WRONG_ANSWER');
    for (const task of impostor.lobby.you.tasks) expect((await complete(impostor.cookie, task)).status).toBe(200);
    expect((await game.snapshot(impostor.cookie)).you.tasks.every(task => task.done)).toBe(true);
    const done = await (await complete(crewmates[0].cookie, first)).json();
    expect(done.lobby.you.tasks[0].done).toBe(true);
    expect((await complete(crewmates[0].cookie, first)).status).toBe(200);

    // Progress is published on the batch cadence, never immediately, and fake tasks never count.
    app.tick();
    expect((await game.snapshot()).progress).toEqual({ done: 0, goal: 16 });
    clock += 30_000; app.tick();
    expect((await game.snapshot()).progress).toEqual({ done: 1, goal: 16 });

    const paused: Lobby = (await (await app.post('/api/round/commands', roundInput(await game.snapshot(), 'pause'), game.cookies[0])).json()).lobby;
    const second = crewmates[0].lobby.you.tasks[1];
    expect((await (await complete(crewmates[0].cookie, second)).json()).error).toBe('INVALID_PHASE');
    await app.post('/api/round/commands', roundInput(paused, 'resume'), game.cookies[0]);

    const remaining = crewmates.flatMap(player => player.lobby.you.tasks.filter(task => task.id !== first.id).map(task => ({ player, task })));
    for (const [index, { player, task }] of remaining.slice(0, 14).entries()) {
      const result = (await (await complete(player.cookie, task)).json()).lobby as Lobby;
      expect(result.phase).toBe('active');
    }
    const winning = remaining[14];
    const ended: Lobby = (await (await complete(winning.player.cookie, winning.task)).json()).lobby;
    expect(ended.phase).toBe('ended');
    expect(ended.result).toEqual({ winner: 'crew', reason: 'tasks' });
    expect(ended.progress).toEqual({ done: 16, goal: 16 });
    expect(ended.you.tasks).toEqual([]);
  });

  it('drops a departing Crewmate\'s unfinished tasks from the goal', async () => {
    const app = await start();
    const game = await crew(app);
    const active: Lobby = (await (await app.post('/api/round/commands', roundInput(game.lobby, 'start'), game.cookies[0])).json()).lobby;
    const roles = await Promise.all(game.cookies.map(async cookie => (await (await fetch(`${app.url}/api/role?roundId=${active.roundId}`, { headers: { Cookie: cookie } })).json()).role));
    const index = roles.findIndex((role, position) => position > 0 && role === 'crewmate');
    const target = (await game.snapshot(game.cookies[index])).you.id;
    const paused: Lobby = (await (await app.post('/api/room/commands', roomInput(active, target), game.cookies[0])).json()).lobby;
    expect(paused.phase).toBe('paused');
    expect(paused.progress?.goal).toBe(Math.ceil(16 * 0.8));
  });
});

describe('Simon says tasks', () => {
  it('hands out Simon says by default and none once the organiser switches it off', async () => {
    const app = await start();
    const game = await crew(app);
    expect(game.lobby.settings.simonTasks).toBe(true);
    const kinds = async () => (await Promise.all(game.cookies.map(async cookie => (await game.snapshot(cookie)).you.tasks))).flat().map(task => task.puzzle.kind);
    let lobby: Lobby = (await (await app.post('/api/round/commands', roundInput(game.lobby, 'start'), game.cookies[0])).json()).lobby;
    // Four tasks each: one of every game, fake tasks included.
    const handedOut = await kinds();
    expect(handedOut.filter(kind => kind === 'simon')).toHaveLength(game.cookies.length);
    const simon = (await game.snapshot(game.cookies[1])).you.tasks.find(task => task.puzzle.kind === 'simon')!;
    expect((await (await app.post('/api/tasks/complete', { roundId: lobby.roundId, taskId: simon.id, answer: [9] }, game.cookies[1])).json()).error).toBe('WRONG_ANSWER');
    const sequence = (simon.puzzle as { sequence: number[] }).sequence;
    expect((await app.post('/api/tasks/complete', { roundId: lobby.roundId, taskId: simon.id, answer: sequence }, game.cookies[1])).status).toBe(200);

    lobby = (await (await app.post('/api/round/commands', roundInput(await game.snapshot(), 'end'), game.cookies[0])).json()).lobby;
    lobby = (await (await app.post('/api/round/commands', roundInput(lobby, 'reset'), game.cookies[0])).json()).lobby;
    lobby = (await (await app.post('/api/settings/commands', { commandId: randomUUID(), expectedRevision: lobby.revision, roundId: lobby.roundId, simonTasks: false }, game.cookies[0])).json()).lobby;
    expect(lobby.settings.simonTasks).toBe(false);
    await app.post('/api/round/commands', roundInput(lobby, 'start'), game.cookies[0]);
    const later = await kinds();
    expect(later.length).toBeGreaterThan(0);
    expect(later).not.toContain('simon');
  });
});

describe('practice page', () => {
  it('serves every task game without a session and checks answers with the task rules', async () => {
    const app = await start();
    for (const kind of ['order', 'wires', 'codebook', 'simon']) {
      const practice = await (await fetch(`${app.url}/api/practice/${kind}`)).json() as { puzzle: { kind: string }; codebook?: Record<string, number> };
      expect(practice.puzzle.kind).toBe(kind);
      expect(Boolean(practice.codebook)).toBe(kind === 'codebook');
    }
    expect((await fetch(`${app.url}/api/practice/nope`)).status).toBe(400);

    const { id, puzzle } = await (await fetch(`${app.url}/api/practice/order`)).json() as { id: string; puzzle: { numbers: number[] } };
    expect((await (await app.post('/api/practice/check', { id, answer: [...puzzle.numbers].sort((a, b) => b - a) })).json()).error).toBe('WRONG_ANSWER');
    const sorted = [...puzzle.numbers].sort((a, b) => a - b);
    expect(await (await app.post('/api/practice/check', { id, answer: sorted })).json()).toEqual({ solved: true });
    // A solved practice puzzle is forgotten.
    expect((await app.post('/api/practice/check', { id, answer: sorted })).status).toBe(404);

    const book = await (await fetch(`${app.url}/api/practice/codebook`)).json() as { id: string; puzzle: { symbols: string[] }; codebook: Record<string, number> };
    const code = book.puzzle.symbols.map(symbol => book.codebook[symbol]).join('');
    expect(await (await app.post('/api/practice/check', { id: book.id, answer: code })).json()).toEqual({ solved: true });
    const simon = await (await fetch(`${app.url}/api/practice/simon`)).json() as { id: string; puzzle: { sequence: number[] } };
    expect(simon.puzzle.sequence).toHaveLength(5);
    expect(simon.puzzle.sequence.every(pad => pad >= 0 && pad <= 3)).toBe(true);
    expect((await (await app.post('/api/practice/check', { id: simon.id, answer: simon.puzzle.sequence.slice(0, 4) })).json()).error).toBe('WRONG_ANSWER');
    expect(await (await app.post('/api/practice/check', { id: simon.id, answer: simon.puzzle.sequence })).json()).toEqual({ solved: true });
    // Practice never creates a room or session.
    expect((await (await fetch(`${app.url}/api/session`)).json()).lobby).toBeNull();
  });
});
