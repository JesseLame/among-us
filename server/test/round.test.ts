import { afterEach, describe, expect, it } from 'vitest';
import { io } from 'socket.io-client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Lobby } from '../../shared/protocol.js';
import { createHash, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { cleanup, stop, onCleanup, start, roundInput, crew } from './helpers.js';

afterEach(cleanup);

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
    onCleanup(() => { socket.disconnect(); });
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
    onCleanup(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, 'game.sqlite');
    const first = await start(path);
    const game = await crew(first);
    const input = roundInput(game.lobby, 'start');
    const active = (await (await first.post('/api/round/commands', input, game.cookies[0])).json()).lobby;
    const roles = await Promise.all(game.cookies.map(async cookie => (await (await fetch(`${first.url}/api/role?roundId=${active.roundId}`, { headers: { Cookie: cookie } })).json()).role));
    await stop(first);
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
    onCleanup(() => rmSync(directory, { recursive: true, force: true }));
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
    expect(originalSession.settings).toEqual({ stationAccess: 'qr', eliminations: true, bodyReports: true, emergencyMeetings: true, phoneVoting: false, openingProtection: 60, killCooldown: 60, discussionTime: 90, emergencyAllowance: 1, progressInterval: 30, tasksPerPlayer: 4, taskGoalPercent: 80, confirmVictory: false, changePreviews: true, changeHistory: true, taskGames: ['codebook', 'order', 'wires', 'simon', 'maze'] });
    expect(originalSession.stations.map((station: { name: string }) => station.name)).toEqual(['Kitchen', 'Living room', 'Hallway', 'Study']);
  });

  it('keeps Simon says off for a room that switched it off before the task game list', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'home-migration-test-'));
    onCleanup(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, 'simon.sqlite');
    const app = await start(path);
    const created = await app.post('/api/games', { name: 'Host' });
    const { code } = (await created.json()).lobby;
    const cookie = created.headers.get('set-cookie')!;
    await stop(app);
    // Back to the version with the Simon says switch, switched off.
    const old = new Database(path);
    old.exec(`ALTER TABLE games DROP COLUMN task_games_off; ALTER TABLE games ADD COLUMN simon_tasks INTEGER NOT NULL DEFAULT 1;
      UPDATE games SET simon_tasks = 0; PRAGMA user_version = 14;`);
    old.close();
    const reopened = await start(path);
    const lobby = (await (await fetch(`${reopened.url}/api/session`, { headers: { Cookie: cookie } })).json()).lobby;
    expect(lobby.code).toBe(code);
    expect(lobby.settings.taskGames).toEqual(['codebook', 'order', 'wires', 'maze']);
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
    onCleanup(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, 'game.sqlite');
    let clock = 9_000_000;
    const first = await start(path, () => clock);
    const game = await crew(first);
    const lobby: Lobby = (await (await first.post('/api/round/commands', roundInput(game.lobby, 'start'), game.cookies[0])).json()).lobby;
    clock += 20_000; first.tick();
    await stop(first);
    clock += 3_600_000;
    const second = await start(path, () => clock);
    const roles = await Promise.all(game.cookies.map(async cookie => (await (await fetch(`${second.url}/api/role?roundId=${lobby.roundId}`, { headers: { Cookie: cookie } })).json())));
    expect(roles.find(info => info.role === 'impostor').elimination).toMatchObject({ readyInMs: 40_000, running: false });
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
