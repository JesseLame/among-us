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
      // Only the Impostor's own reply carries elimination details.
      expect(Object.keys(ownRole).sort()).toEqual(ownRole.role === 'impostor' ? ['elimination', 'role', 'roundId'] : ['role', 'roundId']);
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
    expect(originalSession.you).toEqual({ id: 'original', organiser: true, playing: true, status: 'alive', emergencyLeft: 1, tasks: [] });
    expect(originalSession.settings).toEqual({ stationAccess: 'qr', eliminations: true, bodyReports: true, emergencyMeetings: true, phoneVoting: false, openingProtection: 60, killCooldown: 60, discussionTime: 90, emergencyAllowance: 1, progressInterval: 30, tasksPerPlayer: 4, taskGoalPercent: 80, confirmVictory: false, changePreviews: true, changeHistory: true });
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
    expect(lobby.settings).toEqual({ stationAccess: 'qr', eliminations: true, bodyReports: true, emergencyMeetings: true, phoneVoting: false, openingProtection: 60, killCooldown: 60, discussionTime: 90, emergencyAllowance: 1, progressInterval: 30, tasksPerPlayer: 4, taskGoalPercent: 80, confirmVictory: false, changePreviews: true, changeHistory: true });
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

describe('host-only organiser', () => {
  it('hosts without a role, tasks or a player place', async () => {
    const app = await start();
    const created = await app.post('/api/games', { name: 'Laptop', playing: false });
    const host = created.headers.get('set-cookie')!;
    let lobby: Lobby = (await created.json()).lobby;
    expect(lobby.you).toMatchObject({ organiser: true, playing: false });
    expect((await app.post('/api/round/commands', roundInput(lobby, 'start'), host)).status).toBe(400);
    const guests: string[] = [];
    for (let index = 1; index <= 8; index++) {
      const response = await app.post('/api/games/join', { name: `Guest ${index}`, code: lobby.code });
      expect(response.status).toBe(201);
      guests.push(response.headers.get('set-cookie')!);
    }
    expect((await (await app.post('/api/games/join', { name: 'Extra', code: lobby.code })).json()).error).toBe('GAME_FULL');
    lobby = (await (await fetch(`${app.url}/api/session`, { headers: { Cookie: host } })).json()).lobby;
    lobby = (await (await app.post('/api/round/commands', roundInput(lobby, 'start'), host)).json()).lobby;
    expect(lobby.phase).toBe('active');
    expect(lobby.you.tasks).toEqual([]);
    expect(lobby.progress).toEqual({ done: 0, goal: Math.ceil(7 * 4 * 0.8) });
    expect(JSON.stringify(lobby)).not.toMatch(/crewmate|impostor|"role"/);
    expect((await (await fetch(`${app.url}/api/role?roundId=${lobby.roundId}`, { headers: { Cookie: host } })).json()).error).toBe('NOT_PLAYING');
    const roles = await Promise.all(guests.map(async cookie => (await (await fetch(`${app.url}/api/role?roundId=${lobby.roundId}`, { headers: { Cookie: cookie } })).json()).role));
    expect(roles.filter(role => role === 'impostor')).toHaveLength(1);
    lobby = (await (await app.post('/api/round/commands', roundInput(lobby, 'end'), host)).json()).lobby;
    expect(lobby.revealedRoles).toHaveLength(8);
    expect(lobby.revealedRoles!.some(role => role.id === lobby.you.id)).toBe(false);
  });
});

describe('eliminations', () => {
  it('waits for protection and cooldown in active play, keeps bodies private, and lets the Impostor win', async () => {
    let clock = 5_000_000;
    const app = await start(':memory:', () => clock);
    const game = await crew(app);
    let lobby: Lobby = (await (await app.post('/api/round/commands', roundInput(game.lobby, 'start'), game.cookies[0])).json()).lobby;
    const roleOf = async (cookie: string) => (await (await fetch(`${app.url}/api/role?roundId=${lobby.roundId}`, { headers: { Cookie: cookie } })).json());
    const infos = await Promise.all(game.cookies.map(roleOf));
    const impostor = game.cookies[infos.findIndex(info => info.role === 'impostor')];
    const crewCookies = game.cookies.filter(cookie => cookie !== impostor);
    const crewIds = await Promise.all(crewCookies.map(async cookie => (await game.snapshot(cookie)).you.id));
    const kill = (targetId: string, cookie = impostor) => app.post('/api/eliminate', { commandId: randomUUID(), roundId: lobby.roundId, targetId }, cookie);

    const opening = (await roleOf(impostor)).elimination;
    expect(opening).toMatchObject({ readyInMs: 60_000, running: true });
    expect(opening.targets).toHaveLength(5);
    expect((await (await kill(crewIds[0], crewCookies[1])).json()).error).toBe('FORBIDDEN');
    expect((await (await kill(crewIds[0])).json()).error).toBe('NOT_READY');

    // Paused time does not count towards opening protection.
    clock += 30_000; app.tick();
    lobby = (await (await app.post('/api/round/commands', roundInput(lobby, 'pause'), game.cookies[0])).json()).lobby;
    clock += 600_000; app.tick();
    expect((await roleOf(impostor)).elimination).toMatchObject({ readyInMs: 30_000, running: false });
    expect((await (await kill(crewIds[0])).json()).error).toBe('INVALID_PHASE');
    lobby = (await (await app.post('/api/round/commands', roundInput(lobby, 'resume'), game.cookies[0])).json()).lobby;
    clock += 30_000;

    const revision = (await game.snapshot()).revision;
    const first = await (await kill(crewIds[0])).json();
    expect(first.ended).toBe(false);
    expect(first.role.elimination).toMatchObject({ readyInMs: 60_000 });
    expect(first.role.elimination.targets.map((target: { id: string }) => target.id)).not.toContain(crewIds[0]);
    const victim = await game.snapshot(crewCookies[0]);
    expect(victim.you.status).toBe('body');
    // Nobody else learns about the body, and no shared revision changes.
    for (const cookie of game.cookies.filter(cookie => cookie !== crewCookies[0])) {
      const state = await game.snapshot(cookie);
      expect(state.you.status).toBe('alive');
      expect(state.revision).toBe(revision);
      expect(JSON.stringify(state.players)).not.toMatch(/body|status/);
    }
    const task = victim.you.tasks[0];
    expect((await (await app.post('/api/tasks/complete', { roundId: lobby.roundId, taskId: task.id, answer: '0000' }, crewCookies[0])).json()).error).toBe('NOT_ALIVE');
    expect((await (await kill(crewIds[1])).json()).error).toBe('NOT_READY');
    expect((await (await kill(crewIds[0])).json()).error).toBe('NOT_READY');

    // A changed cooldown applies to the next timer, not the one already running.
    lobby = await game.snapshot();
    lobby = (await (await app.post('/api/settings/commands', { commandId: randomUUID(), expectedRevision: lobby.revision, roundId: lobby.roundId, killCooldown: 600 }, game.cookies[0])).json()).lobby;
    expect(lobby.settings.killCooldown).toBe(600);
    expect((await roleOf(impostor)).elimination.readyInMs).toBe(60_000);
    lobby = (await (await app.post('/api/settings/commands', { commandId: randomUUID(), expectedRevision: lobby.revision, roundId: lobby.roundId, killCooldown: 60 }, game.cookies[0])).json()).lobby;
    for (const id of crewIds.slice(1, 3)) {
      clock += 60_000;
      expect((await (await kill(id)).json()).ended).toBe(false);
    }
    clock += 60_000;
    expect((await (await kill(crewIds[0])).json()).error).toBe('PLAYER_NOT_FOUND');
    // With recording switched off, the Impostor sees no panel and the server refuses.
    lobby = await game.snapshot();
    lobby = (await (await app.post('/api/settings/commands', { commandId: randomUUID(), expectedRevision: lobby.revision, roundId: lobby.roundId, eliminations: false }, game.cookies[0])).json()).lobby;
    expect(lobby.settings.eliminations).toBe(false);
    expect((await roleOf(impostor)).elimination).toBeUndefined();
    expect((await (await kill(crewIds[3])).json()).error).toBe('ELIMINATIONS_OFF');
    lobby = (await (await app.post('/api/settings/commands', { commandId: randomUUID(), expectedRevision: lobby.revision, roundId: lobby.roundId, eliminations: true }, game.cookies[0])).json()).lobby;
    const last = await (await kill(crewIds[3])).json();
    expect(last).toEqual({ ended: true });
    const ended = await game.snapshot();
    expect(ended.phase).toBe('ended');
    expect(ended.result).toEqual({ winner: 'impostor', reason: 'eliminations' });
  });

  it('pauses the round clock across a server restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'home-clock-test-'));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, 'game.sqlite');
    let clock = 9_000_000;
    const first = await start(path, () => clock);
    const game = await crew(first);
    const lobby: Lobby = (await (await first.post('/api/round/commands', roundInput(game.lobby, 'start'), game.cookies[0])).json()).lobby;
    clock += 20_000; first.tick();
    cleanups.pop(); await first.close();
    clock += 3_600_000;
    const second = await start(path, () => clock);
    const roles = await Promise.all(game.cookies.map(async cookie => (await (await fetch(`${second.url}/api/role?roundId=${lobby.roundId}`, { headers: { Cookie: cookie } })).json())));
    expect(roles.find(info => info.role === 'impostor').elimination).toMatchObject({ readyInMs: 40_000, running: false });
  });
});

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

describe('test players', () => {
  it('adds Crewmate test players without tasks that the Impostor can eliminate', async () => {
    const app = await start();
    const created = await app.post('/api/games', { name: 'Laptop', playing: false });
    const host = created.headers.get('set-cookie')!;
    let lobby: Lobby = (await created.json()).lobby;
    const add = () => app.post('/api/room/commands', { action: 'addTestPlayer', commandId: randomUUID(), code: lobby.code, expectedRevision: lobby.revision, roundId: lobby.roundId }, host);
    expect((await (await add()).json()).error).toBeUndefined();
    lobby = (await (await fetch(`${app.url}/api/session`, { headers: { Cookie: host } })).json()).lobby;
    // Only test players: nobody real could be the Impostor.
    expect((await (await app.post('/api/round/commands', roundInput(lobby, 'start'), host)).json()).error).toBe('NOT_ENOUGH_PLAYERS');
    const phone = (await app.post('/api/games/join', { name: 'Phone', code: lobby.code })).headers.get('set-cookie')!;
    lobby = (await (await fetch(`${app.url}/api/session`, { headers: { Cookie: host } })).json()).lobby;
    for (let index = 0; index < 2; index++) lobby = (await (await add()).json()).lobby;
    expect(lobby.players.filter(player => player.test).map(player => player.name)).toEqual(['Test 1', 'Test 2', 'Test 3']);
    lobby = (await (await app.post('/api/settings/commands', { commandId: randomUUID(), expectedRevision: lobby.revision, roundId: null, openingProtection: 0, killCooldown: 0 }, host)).json()).lobby;
    lobby = (await (await app.post('/api/round/commands', roundInput(lobby, 'start'), host)).json()).lobby;
    expect((await add()).status).toBe(409);
    const role = await (await fetch(`${app.url}/api/role?roundId=${lobby.roundId}`, { headers: { Cookie: phone } })).json();
    expect(role.role).toBe('impostor');
    expect(role.elimination.targets.map((target: { name: string }) => target.name)).toEqual(['Test 1', 'Test 2', 'Test 3']);
    expect(lobby.progress).toEqual({ done: 0, goal: 0 });
    const kill = (targetId: string) => app.post('/api/eliminate', { commandId: randomUUID(), roundId: lobby.roundId, targetId }, phone);
    expect((await (await kill(role.elimination.targets[0].id)).json()).ended).toBe(false);
    expect((await (await kill(role.elimination.targets[1].id)).json()).ended).toBe(true);
    const ended: Lobby = (await (await fetch(`${app.url}/api/session`, { headers: { Cookie: host } })).json()).lobby;
    expect(ended.result).toEqual({ winner: 'impostor', reason: 'eliminations' });
    expect(ended.revealedRoles!.filter(entry => entry.role === 'crewmate')).toHaveLength(3);
  });
});

describe('game settings', () => {
  it('changes numbers within limits, keeps task settings for the lobby, and applies them to the next round or meeting', async () => {
    const clock = 3_000_000;
    const app = await start(':memory:', () => clock);
    const game = await crew(app);
    const change = async (lobby: Lobby, settings: object) => (await app.post('/api/settings/commands', { commandId: randomUUID(), expectedRevision: lobby.revision, roundId: lobby.roundId, ...settings }, game.cookies[0])).json();
    expect((await app.post('/api/settings/commands', { commandId: randomUUID(), expectedRevision: game.lobby.revision, roundId: null, tasksPerPlayer: 9 }, game.cookies[0])).status).toBe(400);
    let lobby: Lobby = (await change(game.lobby, { tasksPerPlayer: 2, taskGoalPercent: 50, discussionTime: 0, emergencyAllowance: 2, openingProtection: 0 })).lobby;
    expect(lobby.settings).toMatchObject({ tasksPerPlayer: 2, taskGoalPercent: 50, discussionTime: 0, emergencyAllowance: 2 });
    lobby = (await (await app.post('/api/round/commands', roundInput(lobby, 'start'), game.cookies[0])).json()).lobby;
    expect(lobby.progress).toEqual({ done: 0, goal: 5 });
    expect((await change(lobby, { tasksPerPlayer: 3 })).error).toBe('INVALID_PHASE');
    const guest = await game.snapshot(game.cookies[1]);
    expect(guest.you.tasks).toHaveLength(2);
    expect(guest.you.emergencyLeft).toBe(2);
    // An untimed discussion; changing the time mid-meeting only affects the next meeting.
    const startMeeting = async (current: Lobby) => {
      const called: Lobby = (await (await app.post('/api/meetings', { commandId: randomUUID(), roundId: current.roundId, kind: 'organiser' }, game.cookies[0])).json()).lobby;
      return (await (await app.post('/api/meeting/commands', { action: 'start', out: [], commandId: randomUUID(), roundId: called.roundId, expectedRevision: called.revision }, game.cookies[0])).json()).lobby as Lobby;
    };
    lobby = await startMeeting(lobby);
    expect(lobby.meeting!.discussionMs).toBeNull();
    lobby = (await change(lobby, { discussionTime: 45 })).lobby;
    expect(lobby.meeting!.discussionMs).toBeNull();
    lobby = (await (await app.post('/api/round/commands', roundInput(lobby, 'endMeeting'), game.cookies[0])).json()).lobby;
    lobby = await startMeeting(lobby);
    expect(lobby.meeting!.discussionMs).toBe(45_000);
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
    return { app, game, lobby, roles, ids, fix };
  }

  it('credits or removes a broken station for everyone and rechecks the task goal', async () => {
    const { game, lobby, fix } = await round();
    expect((await fix({ action: 'restoreEmergency' }, game.cookies[1])).error).toBe('FORBIDDEN');
    const [first, ...others] = lobby.stations;
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
    const { app, game, roles, ids, lobby } = await round();
    const preview = async (path: string, body: object, cookie = game.cookies[0]) => {
      const current = await game.snapshot();
      return (await app.post(path, { ...body, commandId: randomUUID(), roundId: current.roundId, expectedRevision: current.revision, code: current.code }, cookie)).json();
    };
    const impostor = ids[roles.indexOf('impostor')];
    const crewmate = ids[roles.indexOf('crewmate', 1)];
    const revision = (await game.snapshot()).revision;
    expect(await preview('/api/corrections/preview', { action: 'setStatus', playerId: impostor, status: 'ghost' })).toEqual({ preview: { outcome: 'ends', goal: lobby.progress!.goal } });
    expect(await preview('/api/corrections/preview', { action: 'setStatus', playerId: crewmate, status: 'ghost' })).toEqual({ preview: { outcome: 'continues', goal: lobby.progress!.goal } });
    expect((await preview('/api/room/preview', { action: 'remove', playerId: impostor })).preview.outcome).toBe('ends');
    expect((await preview('/api/room/preview', { action: 'remove', playerId: crewmate })).preview.goal).toBeLessThan(lobby.progress!.goal);
    const removeStation = await preview('/api/corrections/preview', { action: 'removeStationTasks', stationId: lobby.stations[0].id });
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
