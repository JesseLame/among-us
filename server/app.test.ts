import { afterEach, describe, expect, it } from 'vitest';
import { io } from 'socket.io-client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from './app.js';
import type { Lobby, PrintableStation, RoundCommand, RoomCommand, StationCommand, Task } from '../shared/protocol.js';
import { createHash, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); cleanups.length = 0; });
async function start(databasePath = ':memory:', now?: () => number) {
  const app = createApp({ databasePath, now });
  await new Promise<void>((resolve, reject) => { app.http.once('error', reject); app.http.listen(0, '127.0.0.1', resolve); });
  cleanups.push(app.close);
  const url = `http://127.0.0.1:${(app.http.address() as AddressInfo).port}`;
  const post = async (path: string, body: unknown, cookie = '') => fetch(`${url}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body),
  });
  return { ...app, url, post };
}

describe('durable bilingual-lobby foundation', () => {
  it('creates a private session, validates joins, and restricts the roster to eight', async () => {
    const app = await start();
    const created = await app.post('/api/games', { name: 'Jesse' });
    expect(created.status).toBe(201);
    const cookie = created.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    const { lobby } = await created.json() as { lobby: Lobby };
    expect(lobby.you.organiser).toBe(true);
    expect(JSON.stringify(lobby)).not.toMatch(/session_hash|token|role/);
    expect((await app.post('/api/games', { name: 'Again' }, cookie)).status).toBe(409);
    expect((await app.post('/api/games/join', { name: 'jesse', code: lobby.code })).status).toBe(400);
    expect((await app.post('/api/games/join', { name: '', code: lobby.code })).status).toBe(400);
    expect((await app.post('/api/games/join', { name: 'A', code: '12345' })).status).toBe(400);
    for (let index = 1; index <= 7; index++) {
      const response = await app.post('/api/games/join', { name: `Player ${index}`, code: lobby.code.toLowerCase() });
      expect(response.status).toBe(201);
      expect((await response.json()).lobby.you.organiser).toBe(false);
    }
    expect((await (await app.post('/api/games/join', { name: 'Extra', code: lobby.code })).json()).error).toBe('GAME_FULL');
    expect((await (await fetch(`${app.url}/api/session`)).json()).lobby).toBeNull();
    expect((await (await fetch(`${app.url}/api/session`, { headers: { Cookie: cookie } })).json()).lobby.players).toHaveLength(8);
  });

  it('sends personalised live updates and rejects anonymous sockets', async () => {
    const app = await start();
    const created = await app.post('/api/games', { name: 'Host' });
    const cookie = created.headers.get('set-cookie')!;
    const { lobby } = await created.json();
    const socket = io(app.url, { extraHeaders: { Cookie: cookie }, transports: ['websocket'] });
    cleanups.push(() => { socket.disconnect(); });
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    const update = new Promise<Lobby>(resolve => socket.on('lobby:updated', state => { if (state.players.length === 2) resolve(state); }));
    await app.post('/api/games/join', { name: 'Guest', code: lobby.code });
    const state = await update;
    expect(state.you.id).toBe(lobby.you.id);
    expect(state.players.map(p => p.name)).toEqual(['Host', 'Guest']);
    const anonymous = io(app.url, { reconnection: false });
    cleanups.push(() => { anonymous.disconnect(); });
    const rejected = await new Promise<Error>(resolve => anonymous.once('connect_error', resolve));
    expect(rejected.message).toBe('NO_SESSION');
  });

  it('restores identity and lobby after the server restarts', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'home-game-test-'));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, 'game.sqlite');
    const first = await start(path);
    const response = await first.post('/api/games', { name: 'Persistent host' });
    const cookie = response.headers.get('set-cookie')!;
    const original = await response.json();
    cleanups.pop(); await first.close();
    const second = await start(path);
    const restored = await (await fetch(`${second.url}/api/session`, { headers: { Cookie: cookie } })).json();
    expect(restored).toEqual(original);
  });
});

function roundInput(lobby: Lobby, action: RoundCommand['action']): RoundCommand {
  return { action, commandId: randomUUID(), expectedRevision: lobby.revision, roundId: lobby.roundId };
}

function roomInput(lobby: Lobby, playerId?: string): RoomCommand {
  const base = { commandId: randomUUID(), code: lobby.code, expectedRevision: lobby.revision, roundId: lobby.roundId };
  return playerId ? { ...base, action: 'remove', playerId } : { ...base, action: 'destroy' };
}

async function crew(app: Awaited<ReturnType<typeof start>>) {
  const host = await app.post('/api/games', { name: 'Host' });
  const cookies = [host.headers.get('set-cookie')!];
  let lobby: Lobby = (await host.json()).lobby;
  for (let index = 1; index < 6; index++) {
    const guest = await app.post('/api/games/join', { name: `Guest ${index}`, code: lobby.code });
    cookies.push(guest.headers.get('set-cookie')!);
    lobby = (await guest.json()).lobby;
  }
  const snapshot = async (cookie = cookies[0]): Promise<Lobby> => (await (await fetch(`${app.url}/api/session`, { headers: { Cookie: cookie } })).json()).lobby;
  return { cookies, snapshot, lobby: await snapshot() };
}

describe('private roles and round lifecycle', () => {
  it('allows solo testing, requires an organiser, and assigns exactly one private Impostor', async () => {
    const app = await start();
    const created = await app.post('/api/games', { name: 'Solo' });
    const soloCookie = created.headers.get('set-cookie')!;
    const solo = (await created.json()).lobby;
    const soloResponse = await app.post('/api/round/commands', roundInput(solo, 'start'), soloCookie);
    expect(soloResponse.status).toBe(200);
    const soloRound: Lobby = (await soloResponse.json()).lobby;
    expect(soloRound.phase).toBe('active');
    expect((await (await fetch(`${app.url}/api/role?roundId=${soloRound.roundId}`, { headers: { Cookie: soloCookie } })).json()).role).toBe('impostor');
    const game = await crew(app);
    expect((await app.post('/api/round/commands', roundInput(game.lobby, 'start'), game.cookies[1])).status).toBe(403);
    expect((await app.post('/api/round/commands', roundInput(game.lobby, 'start'))).status).toBe(401);
    const startCommand = roundInput(game.lobby, 'start');
    const response = await app.post('/api/round/commands', startCommand, game.cookies[0]);
    const active: Lobby = (await response.json()).lobby;
    expect(active.phase).toBe('active');
    expect(active.revealedRoles).toBeUndefined();
    expect((await app.post('/api/games/join', { name: 'Late arrival', code: active.code })).status).toBe(409);
    const roles = [];
    for (const cookie of game.cookies) {
      const state = await game.snapshot(cookie);
      expect(JSON.stringify(state)).not.toMatch(/crewmate|impostor|"role"|revealedRoles/);
      const ownRole = await (await fetch(`${app.url}/api/role?roundId=${active.roundId}&playerId=${active.you.id}`, { headers: { Cookie: cookie } })).json();
      expect(Object.keys(ownRole).sort()).toEqual(['role', 'roundId']);
      roles.push(ownRole.role);
    }
    expect(roles.filter(role => role === 'impostor')).toHaveLength(1);
    expect(roles.filter(role => role === 'crewmate')).toHaveLength(5);
    expect((await fetch(`${app.url}/api/role?roundId=${active.roundId}`)).status).toBe(401);
    expect((await fetch(`${app.url}/api/role?roundId=${active.roundId}`, { headers: { Cookie: soloCookie } })).status).toBe(409);
    const repeated = await (await app.post('/api/round/commands', startCommand, game.cookies[0])).json();
    expect(repeated.lobby).toEqual(active);
    for (const [index, cookie] of game.cookies.entries()) {
      expect((await (await fetch(`${app.url}/api/role?roundId=${active.roundId}`, { headers: { Cookie: cookie } })).json()).role).toBe(roles[index]);
    }
  });

  it('broadcasts phase changes without roles, rejects stale commands, and only reveals roles after ending', async () => {
    const app = await start();
    const game = await crew(app);
    const socket = io(app.url, { extraHeaders: { Cookie: game.cookies[1] }, transports: ['websocket'] });
    cleanups.push(() => { socket.disconnect(); });
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    const update = new Promise<Lobby>(resolve => socket.on('lobby:updated', state => { if (state.phase === 'active') resolve(state); }));
    let lobby = (await (await app.post('/api/round/commands', roundInput(game.lobby, 'start'), game.cookies[0])).json()).lobby as Lobby;
    const message = await update;
    expect(message.you.organiser).toBe(false);
    expect(JSON.stringify(message)).not.toMatch(/crewmate|impostor|"role"|revealedRoles/);
    const staleEnd = roundInput(lobby, 'end');
    lobby = (await (await app.post('/api/round/commands', roundInput(lobby, 'pause'), game.cookies[0])).json()).lobby;
    expect(lobby.phase).toBe('paused');
    expect(lobby.pauseReason).toBe('organiser');
    expect((await (await app.post('/api/round/commands', staleEnd, game.cookies[0])).json()).error).toBe('STALE_COMMAND');
    const resumeCommand = roundInput(lobby, 'resume');
    lobby = (await (await app.post('/api/round/commands', resumeCommand, game.cookies[0])).json()).lobby;
    expect(lobby.phase).toBe('active');
    const oldRound = lobby.roundId;
    lobby = (await (await app.post('/api/round/commands', roundInput(lobby, 'end'), game.cookies[0])).json()).lobby;
    expect(lobby.phase).toBe('ended');
    expect(lobby.revealedRoles).toHaveLength(6);
    expect((await game.snapshot(game.cookies[1])).revealedRoles).toEqual(lobby.revealedRoles);
    expect((await (await app.post('/api/round/commands', roundInput(lobby, 'resume'), game.cookies[0])).json()).error).toBe('INVALID_PHASE');
    lobby = (await (await app.post('/api/round/commands', roundInput(lobby, 'reset'), game.cookies[0])).json()).lobby;
    expect(lobby.phase).toBe('lobby');
    expect(lobby.roundId).toBeNull();
    expect(lobby.revealedRoles).toBeUndefined();
    expect(lobby.players).toHaveLength(6);
    lobby = (await (await app.post('/api/round/commands', roundInput(lobby, 'start'), game.cookies[0])).json()).lobby;
    expect(lobby.roundId).not.toBe(oldRound);
    expect((await (await app.post('/api/round/commands', staleEnd, game.cookies[0])).json()).error).toBe('STALE_COMMAND');
    const replayed = (await (await app.post('/api/round/commands', resumeCommand, game.cookies[0])).json()).lobby;
    expect(replayed).toEqual(lobby);
  });

  it('preserves roles and commands across restart while pausing an active round', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'home-round-test-'));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, 'game.sqlite');
    const first = await start(path);
    const game = await crew(first);
    const input = roundInput(game.lobby, 'start');
    const active = (await (await first.post('/api/round/commands', input, game.cookies[0])).json()).lobby;
    const roles = await Promise.all(game.cookies.map(async cookie => (await (await fetch(`${first.url}/api/role?roundId=${active.roundId}`, { headers: { Cookie: cookie } })).json()).role));
    cleanups.pop(); await first.close();
    const second = await start(path);
    const restored: Lobby = (await (await fetch(`${second.url}/api/session`, { headers: { Cookie: game.cookies[0] } })).json()).lobby;
    expect(restored.phase).toBe('paused');
    expect(restored.pauseReason).toBe('restart');
    expect(restored.roundId).toBe(active.roundId);
    expect(restored.revision).toBe(active.revision + 1);
    const after = await Promise.all(game.cookies.map(async cookie => (await (await fetch(`${second.url}/api/role?roundId=${active.roundId}`, { headers: { Cookie: cookie } })).json()).role));
    expect(after).toEqual(roles);
    expect((await (await second.post('/api/round/commands', input, game.cookies[0])).json()).lobby).toEqual(restored);
    const resumed = (await (await second.post('/api/round/commands', roundInput(restored, 'resume'), game.cookies[0])).json()).lobby;
    expect(resumed.phase).toBe('active');
  });

  it('migrates the original lobby database without losing player sessions', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'home-migration-test-'));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, 'old.sqlite');
    const old = new Database(path);
    old.exec(`CREATE TABLE games (code TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE players (id TEXT PRIMARY KEY, game_code TEXT NOT NULL REFERENCES games(code), name TEXT NOT NULL, organiser INTEGER NOT NULL DEFAULT 0, session_hash TEXT NOT NULL UNIQUE, joined_at INTEGER NOT NULL);
      INSERT INTO games (code) VALUES ('HOUSE');`);
    old.prepare('INSERT INTO players VALUES (?, ?, ?, ?, ?, ?)').run('original', 'HOUSE', 'Original host', 1, createHash('sha256').update('old-session').digest('hex'), 1);
    old.close();
    const app = await start(path);
    const joined = await app.post('/api/games/join', { code: 'HOUSE', name: 'New guest' });
    const lobby = (await joined.json()).lobby;
    expect(lobby.players.map((p: { name: string }) => p.name)).toEqual(['Original host', 'New guest']);
    expect(lobby.phase).toBe('lobby');
    expect(lobby.roundId).toBeNull();
    const originalSession = (await (await fetch(`${app.url}/api/session`, { headers: { Cookie: 'home_session=old-session' } })).json()).lobby;
    expect(originalSession.you).toEqual({ id: 'original', organiser: true, tasks: [] });
    expect(originalSession.stations.map((station: { name: string }) => station.name)).toEqual(['Kitchen', 'Living room', 'Hallway', 'Study']);
  });
});

describe('organiser room management', () => {
  it('removes a lobby player, revokes their session and socket, and protects the organiser and other rooms', async () => {
    const app = await start();
    const game = await crew(app);
    const outsider = await crew(app);
    const target = game.lobby.players[1];
    const input = roomInput(game.lobby, target.id);
    expect((await app.post('/api/room/commands', input, game.cookies[1])).status).toBe(403);
    expect((await app.post('/api/room/commands', input)).status).toBe(401);
    expect((await (await app.post('/api/room/commands', roomInput(game.lobby, game.lobby.you.id), game.cookies[0])).json()).error).toBe('CANNOT_REMOVE_ORGANISER');
    expect((await (await app.post('/api/room/commands', roomInput(game.lobby, outsider.lobby.players[1].id), game.cookies[0])).json()).error).toBe('PLAYER_NOT_FOUND');
    const socket = io(app.url, { extraHeaders: { Cookie: game.cookies[1] }, transports: ['websocket'] });
    cleanups.push(() => { socket.disconnect(); });
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    const revoked = new Promise<string>(resolve => socket.once('session:ended', resolve));
    const result = await app.post('/api/room/commands', input, game.cookies[0]);
    expect(result.status).toBe(200);
    const remaining: Lobby = (await result.json()).lobby;
    expect(remaining.players).toHaveLength(5);
    expect(remaining.players.some(player => player.id === target.id)).toBe(false);
    expect(await revoked).toBe('removed');
    expect(await game.snapshot(game.cookies[1])).toBeNull();
    expect((await (await app.post('/api/room/commands', input, game.cookies[0])).json()).lobby).toEqual(remaining);
    expect((await outsider.snapshot()).players).toHaveLength(6);
    // Removing someone is not a ban. Joining again creates a different identity.
    const rejoin = await app.post('/api/games/join', { code: remaining.code, name: target.name }, game.cookies[1]);
    expect(rejoin.status).toBe(201);
    expect((await rejoin.json()).lobby.you.id).not.toBe(target.id);
    expect(await game.snapshot(game.cookies[1])).toBeNull();
  });

  it('pauses for a departed Crewmate without exposing roles and ends if the Impostor leaves', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'home-departure-test-'));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, 'game.sqlite');
    const app = await start(path);
    const game = await crew(app);
    let lobby: Lobby = (await (await app.post('/api/round/commands', roundInput(game.lobby, 'start'), game.cookies[0])).json()).lobby;
    // Set a deterministic role fixture; random assignment is covered separately.
    const fixture = new Database(path);
    fixture.prepare("UPDATE players SET role = 'crewmate' WHERE game_code = ?").run(lobby.code);
    fixture.prepare("UPDATE players SET role = 'impostor' WHERE id = ?").run(lobby.players[2].id);
    fixture.close();
    const crewId = lobby.players[1].id;
    const impostorId = lobby.players[2].id;
    lobby = (await (await app.post('/api/room/commands', roomInput(lobby, crewId), game.cookies[0])).json()).lobby;
    expect(lobby.phase).toBe('paused');
    expect(lobby.players).toHaveLength(5);
    expect(JSON.stringify(lobby)).not.toMatch(/crewmate|impostor|"role"|revealedRoles/);
    expect(await game.snapshot(game.cookies[1])).toBeNull();
    expect((await (await fetch(`${app.url}/api/role?roundId=${lobby.roundId}`, { headers: { Cookie: game.cookies[2] } })).json()).role).toBe('impostor');
    lobby = (await (await app.post('/api/room/commands', roomInput(lobby, impostorId), game.cookies[0])).json()).lobby;
    expect(lobby.phase).toBe('ended');
    expect(lobby.revealedRoles?.find(player => player.id === impostorId)?.role).toBe('impostor');
    expect(lobby.players.filter(player => player.removed).map(player => player.id)).toEqual([crewId, impostorId]);
    expect((await fetch(`${app.url}/api/role?roundId=${lobby.roundId}`, { headers: { Cookie: game.cookies[2] } })).status).toBe(401);
    lobby = (await (await app.post('/api/round/commands', roundInput(lobby, 'reset'), game.cookies[0])).json()).lobby;
    expect(lobby.players).toHaveLength(4);
    expect(lobby.revealedRoles).toBeUndefined();
    expect((await (await app.post('/api/round/commands', roundInput(lobby, 'start'), game.cookies[0])).json()).lobby.phase).toBe('active');
  });

  it('deletes only the authorised room and its saved state, revoking every session across restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'home-destroy-test-'));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, 'game.sqlite');
    const app = await start(path);
    const game = await crew(app);
    const other = await crew(app);
    const beforeStart = roomInput(game.lobby);
    const lobby: Lobby = (await (await app.post('/api/round/commands', roundInput(game.lobby, 'start'), game.cookies[0])).json()).lobby;
    expect((await (await app.post('/api/room/commands', beforeStart, game.cookies[0])).json()).error).toBe('STALE_COMMAND');
    const input = roomInput(lobby);
    expect((await app.post('/api/room/commands', input, game.cookies[1])).status).toBe(403);
    expect((await (await app.post('/api/room/commands', input, other.cookies[0])).json()).error).toBe('STALE_COMMAND');
    const response = await app.post('/api/room/commands', input, game.cookies[0]);
    expect(response.status).toBe(200);
    expect((await response.json()).lobby).toBeNull();
    expect(response.headers.get('set-cookie')).toContain('home_session=;');
    for (const cookie of game.cookies) expect(await game.snapshot(cookie)).toBeNull();
    expect((await app.post('/api/games/join', { code: lobby.code, name: 'Late player' })).status).toBe(404);
    expect((await app.post('/api/room/commands', input, game.cookies[0])).status).toBe(401);
    expect((await other.snapshot()).players).toHaveLength(6);
    const fixture = new Database(path);
    for (const table of ['games', 'players', 'command_receipts']) {
      const key = table === 'games' ? 'code' : 'game_code';
      expect(fixture.prepare(`SELECT count(*) AS total FROM ${table} WHERE ${key} = ?`).get(lobby.code)).toEqual({ total: 0 });
    }
    fixture.close();
    cleanups.pop(); await app.close();
    const restarted = await start(path);
    const restored = await (await fetch(`${restarted.url}/api/session`, { headers: { Cookie: game.cookies[0] } })).json();
    expect(restored.lobby).toBeNull();
    const replacement = await restarted.post('/api/games', { name: 'New host' }, game.cookies[0]);
    expect(replacement.status).toBe(201);
    // A delayed delete must not target a newly created lobby with the same revision.
    const replacementCookie = replacement.headers.get('set-cookie')!;
    expect((await (await restarted.post('/api/room/commands', beforeStart, replacementCookie)).json()).error).toBe('STALE_COMMAND');
  });
});

function stationInput(lobby: Lobby, change: { action: 'add'; name: string } | { action: 'remove'; stationId: string }): StationCommand {
  return { ...change, commandId: randomUUID(), expectedRevision: lobby.revision, roundId: lobby.roundId };
}

function answerFor(task: Task, stations: PrintableStation[]) {
  const { puzzle } = task;
  if (puzzle.kind === 'order') return [...puzzle.numbers].sort((a, b) => a - b);
  if (puzzle.kind === 'wires') return puzzle.left.map(colour => puzzle.right.indexOf(colour));
  const book = stations.find(station => station.id === task.stationId)!.codebook;
  return puzzle.symbols.map(symbol => book[symbol]).join('');
}

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
    const printed = await (await fetch(`${app.url}/api/stations/print`, { headers: { Cookie: host } })).json();
    expect(Array.isArray(printed.lanAddresses)).toBe(true);
    const printable: PrintableStation[] = printed.stations;
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
