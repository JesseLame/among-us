import { afterEach, describe, expect, it } from 'vitest';
import { io } from 'socket.io-client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Lobby } from '../../shared/protocol.js';
import Database from 'better-sqlite3';
import { cleanup, stop, onCleanup, start, roundInput, roomInput, crew } from './helpers.js';

afterEach(cleanup);

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
    onCleanup(() => { socket.disconnect(); });
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
    onCleanup(() => rmSync(directory, { recursive: true, force: true }));
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
    onCleanup(() => rmSync(directory, { recursive: true, force: true }));
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
    await stop(app);
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
