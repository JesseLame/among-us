import { afterEach, describe, expect, it } from 'vitest';
import { io } from 'socket.io-client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Lobby } from '../../shared/protocol.js';
import { cleanup, stop, onCleanup, start, roundInput } from './helpers.js';

afterEach(cleanup);

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
    onCleanup(() => { socket.disconnect(); });
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    const update = new Promise<Lobby>(resolve => socket.on('lobby:updated', state => { if (state.players.length === 2) resolve(state); }));
    await app.post('/api/games/join', { name: 'Guest', code: lobby.code });
    const state = await update;
    expect(state.you.id).toBe(lobby.you.id);
    expect(state.players.map(p => p.name)).toEqual(['Host', 'Guest']);
    const anonymous = io(app.url, { reconnection: false });
    onCleanup(() => { anonymous.disconnect(); });
    const rejected = await new Promise<Error>(resolve => anonymous.once('connect_error', resolve));
    expect(rejected.message).toBe('NO_SESSION');
  });

  it('restores identity and lobby after the server restarts', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'home-game-test-'));
    onCleanup(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, 'game.sqlite');
    const first = await start(path);
    const response = await first.post('/api/games', { name: 'Persistent host' });
    const cookie = response.headers.get('set-cookie')!;
    const original = await response.json();
    await stop(first);
    const second = await start(path);
    const restored = await (await fetch(`${second.url}/api/session`, { headers: { Cookie: cookie } })).json();
    expect(restored).toEqual(original);
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
