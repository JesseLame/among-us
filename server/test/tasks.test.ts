import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import type { Lobby, PrintableStation, Task, TaskPuzzle } from '../../shared/protocol.js';
import { randomUUID } from 'node:crypto';
import { cleanup, start, roundInput, roomInput, crew, stationInput, answerFor, mazeRoute, waterwaysTurns } from './helpers.js';

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
    expect(JSON.stringify(lobby)).not.toMatch(/"codebook":|"star":/);
    for (const station of lobby.stations) {
      lobby = (await (await app.post('/api/stations/commands', stationInput(lobby, { action: 'remove', stationId: station.id }), host)).json()).lobby;
    }
    expect(lobby.stations).toEqual([]);
    expect((await (await app.post('/api/round/commands', roundInput(lobby, 'start'), host)).json()).error).toBe('NO_STATIONS');
    lobby = (await (await app.post('/api/stations/commands', stationInput(lobby, { action: 'add', name: 'Hal' }), host)).json()).lobby;
    lobby = (await (await app.post('/api/round/commands', roundInput(lobby, 'start'), host)).json()).lobby;
    expect((await (await app.post('/api/stations/commands', stationInput(lobby, { action: 'add', name: 'Tuin' }), host)).json()).error).toBe('INVALID_PHASE');
    // Station access defaults to QR-only; only the organiser can change it, also mid-round.
    expect(lobby.settings).toEqual({ stationAccess: 'qr', eliminations: true, bodyReports: true, emergencyMeetings: true, phoneVoting: false, openingProtection: 60, killCooldown: 60, discussionTime: 90, emergencyAllowance: 1, progressInterval: 30, tasksPerPlayer: 4, taskGoalPercent: 80, confirmVictory: false, changePreviews: true, changeHistory: true, taskGames: ['codebook', 'order', 'wires', 'simon', 'maze', 'waterways', 'delivery', 'twokeys'], deliveryMode: 'app', deliveryObject: '', sabotage: true, reactorTime: 90 });
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
    const post = (cookie: string, task: Task, answer: unknown) => app.post('/api/tasks/complete', { roundId: active.roundId, taskId: task.id, answer }, cookie);
    const complete = async (cookie: string, task: Task, answer?: unknown) => {
      if (answer === undefined && task.puzzle.kind === 'delivery' && task.puzzle.stage === 'pickup') expect((await post(cookie, task, [0])).status).toBe(200);
      // Two keys: another player looks up the unlock code.
      if (answer === undefined && task.puzzle.kind === 'twokeys') {
        const helper = players.find(player => player.cookie !== cookie)!.cookie;
        answer = (await (await app.post('/api/tasks/help', { roundId: active.roundId, code: task.puzzle.pair }, helper)).json()).unlock;
      }
      return post(cookie, task, answer ?? answerFor(task, stations));
    };

    const impostor = players.find(player => player.role === 'impostor')!;
    const crewmates = players.filter(player => player !== impostor);
    const [first] = crewmates[0].lobby.you.tasks;
    // Someone else's task is not found, whatever the answer.
    expect((await post(crewmates[1].cookie, first, [0])).status).toBe(404);
    expect((await (await complete(crewmates[0].cookie, first, first.puzzle.kind === 'codebook' ? '9999' : [0, 0, 0, 0])).json()).error).toBe('WRONG_ANSWER');
    for (const task of impostor.lobby.you.tasks) expect((await complete(impostor.cookie, task)).status).toBe(200);
    expect((await game.snapshot(impostor.cookie)).you.tasks.every(task => task.done)).toBe(true);
    const done = await (await complete(crewmates[0].cookie, first)).json();
    expect(done.lobby.you.tasks[0].done).toBe(true);
    // Retrying a finished task is harmless, whatever the answer (a two-keys code is gone by now).
    expect((await post(crewmates[0].cookie, first, [0])).status).toBe(200);

    // Progress is published on the batch cadence, never immediately, and fake tasks never count.
    app.tick();
    expect((await game.snapshot()).progress).toEqual({ done: 0, goal: 16 });
    clock += 30_000; app.tick();
    expect((await game.snapshot()).progress).toEqual({ done: 1, goal: 16 });

    const paused: Lobby = (await (await app.post('/api/round/commands', roundInput(await game.snapshot(), 'pause'), game.cookies[0])).json()).lobby;
    const second = crewmates[0].lobby.you.tasks[1];
    // Posted directly: a delivery's pickup step would be refused too. The phase is checked before the answer.
    expect((await (await post(crewmates[0].cookie, second, [0])).json()).error).toBe('INVALID_PHASE');
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

describe('task game choice', () => {
  it('hands out every game by default and only the games the organiser leaves on', async () => {
    const app = await start();
    const game = await crew(app);
    expect(game.lobby.settings.taskGames).toEqual(['codebook', 'order', 'wires', 'simon', 'maze', 'waterways', 'delivery', 'twokeys']);
    const kinds = async () => (await Promise.all(game.cookies.map(async cookie => (await game.snapshot(cookie)).you.tasks))).flat().map(task => task.puzzle.kind);
    const settings = (lobby: Lobby, taskGames: unknown) => app.post('/api/settings/commands', { commandId: randomUUID(), expectedRevision: lobby.revision, roundId: lobby.roundId, taskGames }, game.cookies[0]);
    // At least one game stays on, each listed once.
    expect((await (await settings(game.lobby, [])).json()).error).toBe('INVALID_INPUT');
    expect((await (await settings(game.lobby, ['maze', 'maze'])).json()).error).toBe('INVALID_INPUT');
    expect((await (await settings(game.lobby, ['chess'])).json()).error).toBe('INVALID_INPUT');

    // Only mazes: everyone gets four, fake tasks included, and a maze is checked by its walls.
    let lobby: Lobby = (await (await settings(game.lobby, ['maze'])).json()).lobby;
    expect(lobby.settings.taskGames).toEqual(['maze']);
    lobby = (await (await app.post('/api/round/commands', roundInput(lobby, 'start'), game.cookies[0])).json()).lobby;
    expect(await kinds()).toEqual(Array(game.cookies.length * 4).fill('maze'));
    const maze = (await game.snapshot(game.cookies[1])).you.tasks[0];
    if (maze.puzzle.kind !== 'maze') throw new Error('Expected a maze');
    const route = mazeRoute(maze.puzzle);
    const complete = (answer: number[]) => app.post('/api/tasks/complete', { roundId: lobby.roundId, taskId: maze.id, answer }, game.cookies[1]);
    expect((await (await complete(route.slice(0, -1))).json()).error).toBe('WRONG_ANSWER');
    // A route straight to the right runs into a wall somewhere unless that is the direct route.
    const straight = Array(maze.puzzle.size - 1).fill(1);
    if (route.join() !== straight.join()) expect((await (await complete(straight)).json()).error).toBe('WRONG_ANSWER');
    expect((await complete(route)).status).toBe(200);

    // Changes apply to the next tasks handed out.
    lobby = (await (await app.post('/api/round/commands', roundInput(await game.snapshot(), 'end'), game.cookies[0])).json()).lobby;
    lobby = (await (await app.post('/api/round/commands', roundInput(lobby, 'reset'), game.cookies[0])).json()).lobby;
    lobby = (await (await settings(lobby, ['simon', 'order'])).json()).lobby;
    expect(lobby.settings.taskGames).toEqual(['order', 'simon']);
    await app.post('/api/round/commands', roundInput(lobby, 'start'), game.cookies[0]);
    const later = await kinds();
    expect(later.length).toBeGreaterThan(0);
    expect(new Set(later)).toEqual(new Set(['order', 'simon']));
  });
});

describe('delivery tasks', () => {
  it('moves an app delivery to its drop-off station for that player only, and hands out the real object when named', async () => {
    const app = await start();
    const game = await crew(app);
    const settings = (lobby: Lobby, change: object) => app.post('/api/settings/commands', { commandId: randomUUID(), expectedRevision: lobby.revision, roundId: lobby.roundId, ...change }, game.cookies[0]);
    let lobby: Lobby = (await (await settings(game.lobby, { taskGames: ['delivery'] })).json()).lobby;
    lobby = (await (await app.post('/api/round/commands', roundInput(lobby, 'start'), game.cookies[0])).json()).lobby;
    const before = await game.snapshot(game.cookies[2]);
    const [task] = (await game.snapshot(game.cookies[1])).you.tasks;
    if (task.puzzle.kind !== 'delivery') throw new Error('Expected a delivery');
    expect(task.puzzle).toMatchObject({ stage: 'pickup', object: null });
    expect(task.puzzle.to).not.toBe(task.stationId);
    expect(lobby.stations.map(station => station.id)).toContain(task.puzzle.to);
    const complete = (answer: number[]) => app.post('/api/tasks/complete', { roundId: lobby.roundId, taskId: task.id, answer }, game.cookies[1]);
    // Dropping off before picking up is wrong; picking up moves the task, and a retried pickup is harmless.
    expect((await (await complete([1])).json()).error).toBe('WRONG_ANSWER');
    const picked = ((await (await complete([0])).json()).lobby as Lobby).you.tasks.find(entry => entry.id === task.id)!;
    expect(picked).toMatchObject({ done: false, stationId: task.puzzle.to, puzzle: { ...task.puzzle, stage: 'dropoff' } });
    expect((await complete([0])).status).toBe(200);
    expect((await game.snapshot(game.cookies[1])).you.tasks.find(entry => entry.id === task.id)!.stationId).toBe(task.puzzle.to);
    // Nobody else learns about the step.
    const after = await game.snapshot(game.cookies[2]);
    expect(after.revision).toBe(before.revision);
    expect(after.you.tasks).toEqual(before.you.tasks);
    const delivered = ((await (await complete([1])).json()).lobby as Lobby).you.tasks.find(entry => entry.id === task.id)!;
    expect(delivered.done).toBe(true);

    lobby = (await (await app.post('/api/round/commands', roundInput(await game.snapshot(), 'end'), game.cookies[0])).json()).lobby;
    lobby = (await (await app.post('/api/round/commands', roundInput(lobby, 'reset'), game.cookies[0])).json()).lobby;
    // A real object without a name still delivers in the app.
    lobby = (await (await settings(lobby, { deliveryMode: 'object' })).json()).lobby;
    expect(lobby.settings).toMatchObject({ deliveryMode: 'object', deliveryObject: '' });
    lobby = (await (await settings(lobby, { deliveryObject: '  wooden spoon ' })).json()).lobby;
    expect(lobby.settings.deliveryObject).toBe('wooden spoon');
    lobby = (await (await app.post('/api/round/commands', roundInput(lobby, 'start'), game.cookies[0])).json()).lobby;
    const real = (await game.snapshot(game.cookies[1])).you.tasks;
    expect(real.every(entry => entry.puzzle.kind === 'delivery' && entry.puzzle.stage === 'dropoff' && entry.puzzle.object === 'wooden spoon' && entry.puzzle.to === null)).toBe(true);
    const finished = (await (await app.post('/api/tasks/complete', { roundId: lobby.roundId, taskId: real[0].id, answer: [1] }, game.cookies[1])).json()).lobby as Lobby;
    expect(finished.you.tasks[0].done).toBe(true);
  });
});

describe('two keys tasks', () => {
  it('lets only another player look up the unlock code, which never reaches the task owner', async () => {
    const app = await start();
    const game = await crew(app);
    let lobby: Lobby = (await (await app.post('/api/settings/commands', { commandId: randomUUID(), expectedRevision: game.lobby.revision, roundId: null, taskGames: ['twokeys'] }, game.cookies[0])).json()).lobby;
    lobby = (await (await app.post('/api/round/commands', roundInput(lobby, 'start'), game.cookies[0])).json()).lobby;
    const views = await Promise.all(game.cookies.map(cookie => game.snapshot(cookie)));
    const codes = views.flatMap(view => view.you.tasks.map(task => task.puzzle.kind === 'twokeys' ? task.puzzle.pair : ''));
    expect(codes.every(code => /^[A-Z]{3}$/.test(code))).toBe(true);
    // Every open task in the room has its own pairing code, and no phone ever gets an unlock code.
    expect(new Set(codes).size).toBe(codes.length);
    for (const view of views) expect(JSON.stringify(view)).not.toMatch(/unlock/);

    const [task] = views[1].you.tasks;
    if (task.puzzle.kind !== 'twokeys') throw new Error('Expected two keys');
    const help = (cookie: string, code: string) => app.post('/api/tasks/help', { roundId: lobby.roundId, code }, cookie);
    expect((await (await help(game.cookies[1], task.puzzle.pair)).json()).error).toBe('OWN_TASK');
    const unused = ['ABC', 'XYZ', 'QRS'].find(code => !codes.includes(code))!;
    expect((await (await help(game.cookies[2], unused)).json()).error).toBe('HELP_CODE_NOT_FOUND');
    const reply = await (await help(game.cookies[2], task.puzzle.pair.toLowerCase())).json();
    expect(Object.keys(reply)).toEqual(['unlock']);
    expect(reply.unlock).toMatch(/^\d{4}$/);
    // Looking up changes nothing for anyone.
    expect((await game.snapshot(game.cookies[3])).revision).toBe(views[3].revision);

    const complete = (answer: string) => app.post('/api/tasks/complete', { roundId: lobby.roundId, taskId: task.id, answer }, game.cookies[1]);
    const wrong = String((Number(reply.unlock) + 1) % 10_000).padStart(4, '0');
    expect((await (await complete(wrong)).json()).error).toBe('WRONG_ANSWER');
    expect(((await (await complete(reply.unlock)).json()).lobby as Lobby).you.tasks[0].done).toBe(true);
    // A finished task's code no longer works.
    expect((await (await help(game.cookies[2], task.puzzle.pair)).json()).error).toBe('HELP_CODE_NOT_FOUND');
  });

  it('is left out when only one real player plays', async () => {
    const app = await start();
    const created = await app.post('/api/games', { name: 'Solo' });
    const cookie = created.headers.get('set-cookie')!;
    let lobby: Lobby = (await created.json()).lobby;
    lobby = (await (await app.post('/api/settings/commands', { commandId: randomUUID(), expectedRevision: lobby.revision, roundId: null, taskGames: ['twokeys', 'maze'] }, cookie)).json()).lobby;
    lobby = (await (await app.post('/api/room/commands', { commandId: randomUUID(), code: lobby.code, expectedRevision: lobby.revision, roundId: null, action: 'addTestPlayer' }, cookie)).json()).lobby;
    lobby = (await (await app.post('/api/round/commands', roundInput(lobby, 'start'), cookie)).json()).lobby;
    expect(lobby.you.tasks.map(task => task.puzzle.kind)).toEqual(['maze', 'maze', 'maze', 'maze']);
  });
});

describe('practice page', () => {
  it('serves every task game without a session and checks answers with the task rules', async () => {
    const app = await start();
    for (const kind of ['order', 'wires', 'codebook', 'simon', 'maze', 'waterways', 'delivery', 'twokeys']) {
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
    const maze = await (await fetch(`${app.url}/api/practice/maze`)).json() as { id: string; puzzle: { size: number; open: number[]; start: number; exit: number } };
    expect(maze.puzzle.open).toHaveLength(maze.puzzle.size ** 2);
    expect(await (await app.post('/api/practice/check', { id: maze.id, answer: mazeRoute(maze.puzzle) })).json()).toEqual({ solved: true });
    // Waterways: the starting turns never let the water out; any turns that do are accepted.
    const water = await (await fetch(`${app.url}/api/practice/waterways`)).json() as { id: string; puzzle: Extract<TaskPuzzle, { kind: 'waterways' }> };
    expect((await (await app.post('/api/practice/check', { id: water.id, answer: water.puzzle.turns })).json()).error).toBe('WRONG_ANSWER');
    expect(await (await app.post('/api/practice/check', { id: water.id, answer: waterwaysTurns(water.puzzle) })).json()).toEqual({ solved: true });
    // Delivery: the pickup returns the drop-off step under the same id, then the drop-off solves it.
    const parcel = await (await fetch(`${app.url}/api/practice/delivery`)).json() as { id: string; puzzle: Extract<TaskPuzzle, { kind: 'delivery' }> };
    expect(parcel.puzzle).toMatchObject({ stage: 'pickup', object: null, to: null });
    expect((await (await app.post('/api/practice/check', { id: parcel.id, answer: [1] })).json()).error).toBe('WRONG_ANSWER');
    expect(await (await app.post('/api/practice/check', { id: parcel.id, answer: [0] })).json()).toEqual({ solved: false, puzzle: { ...parcel.puzzle, stage: 'dropoff' } });
    expect(await (await app.post('/api/practice/check', { id: parcel.id, answer: [1] })).json()).toEqual({ solved: true });
    // Two keys: the unlock code only comes from the help lookup.
    const keys = await (await fetch(`${app.url}/api/practice/twokeys`)).json() as { id: string; puzzle: { pair: string } };
    expect(Object.keys(keys.puzzle).sort()).toEqual(['kind', 'pair']);
    expect((await (await app.post('/api/practice/help', { code: 'ZZZZ' })).json()).error).toBe('INVALID_INPUT');
    const { unlock } = await (await app.post('/api/practice/help', { code: keys.puzzle.pair.toLowerCase() })).json() as { unlock: string };
    expect(await (await app.post('/api/practice/check', { id: keys.id, answer: unlock })).json()).toEqual({ solved: true });
    // Practice never creates a room or session.
    expect((await (await fetch(`${app.url}/api/session`)).json()).lobby).toBeNull();
  });
});
