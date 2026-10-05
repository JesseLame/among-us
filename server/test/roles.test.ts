import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Lobby, Role, RoleInfo, SecurityView, SettingsCommand } from '../../shared/protocol.js';
import { cleanup, crew, roomInput, roundInput, start } from './helpers.js';

afterEach(cleanup);

// A started round on a controllable clock with the given settings and, optionally, fewer than
// six players. Every player's role is looked up so the tests can act as any of them.
async function round(settings: Partial<SettingsCommand> = {}, players = 6) {
  let clock = 7_000_000;
  const app = await start(':memory:', () => clock);
  const game = await crew(app);
  const host = game.cookies[0];
  let lobby = game.lobby;
  for (const id of lobby.players.slice(players).map(player => player.id)) {
    lobby = (await (await app.post('/api/room/commands', roomInput(lobby, id), host)).json()).lobby;
  }
  const cookies = game.cookies.slice(0, players);
  if (Object.keys(settings).length) {
    lobby = (await (await app.post('/api/settings/commands', { commandId: randomUUID(), expectedRevision: lobby.revision, roundId: null, ...settings }, host)).json()).lobby;
  }
  lobby = (await (await app.post('/api/round/commands', roundInput(lobby, 'start'), host)).json()).lobby;
  const roundId = lobby.roundId!;
  const roleOf = async (cookie: string): Promise<RoleInfo> => (await fetch(`${app.url}/api/role?roundId=${roundId}`, { headers: { Cookie: cookie } })).json();
  const infos = await Promise.all(cookies.map(roleOf));
  const ids = await Promise.all(cookies.map(async cookie => (await game.snapshot(cookie)).you.id));
  const as = (role: Role) => infos.flatMap((info, index) => info.role === role ? [{ cookie: cookies[index], id: ids[index] }] : []);
  const advance = (ms: number) => { clock += ms; app.tick(); };
  const step = async (action: object) => {
    const current = await game.snapshot();
    return (await app.post('/api/meeting/commands', { ...action, commandId: randomUUID(), roundId, expectedRevision: current.revision }, host)).json();
  };
  const meeting = async () => {
    await app.post('/api/meetings', { commandId: randomUUID(), roundId, kind: 'organiser' }, host);
    await step({ action: 'start', out: [] });
  };
  const vote = (cookie: string, target: string) => app.post('/api/vote', { roundId, target }, cookie);
  return { app, game, host, cookies, ids, infos, as, roundId, lobby, roleOf, advance, step, meeting, vote };
}
const allRoles = { roles: ['security', 'jester', 'accomplice'], phoneVoting: true } satisfies Partial<SettingsCommand>;

describe('extra roles', () => {
  it('hands out none by default', async () => {
    const { infos, lobby } = await round();
    expect(lobby.settings).toMatchObject({ roles: [], securityTime: 15 });
    expect(infos.map(info => info.role).sort()).toEqual(['crewmate', 'crewmate', 'crewmate', 'crewmate', 'crewmate', 'impostor']);
  });

  it('hands out each switched-on role once, privately, with fake tasks for Jester and Accomplice', async () => {
    const { game, cookies, infos, as, lobby } = await round(allRoles);
    expect(infos.map(info => info.role).sort()).toEqual(['accomplice', 'crewmate', 'crewmate', 'impostor', 'jester', 'security']);
    for (const cookie of cookies) {
      const snapshot = await game.snapshot(cookie);
      expect(JSON.stringify(snapshot)).not.toMatch(/"role"/);
      expect(snapshot.revealedRoles).toBeUndefined();
    }
    // Only crewmates and Security have real tasks: three players with four tasks, an 80% goal.
    expect(lobby.progress).toEqual({ done: 0, goal: 10 });
    // Neither the Impostor nor the Accomplice is told who the other is.
    const [impostor] = as('impostor'), [accomplice] = as('accomplice');
    const impostorInfo = infos.find(info => info.role === 'impostor')!;
    expect(impostorInfo.elimination!.targets.map(target => target.id)).toContain(accomplice.id);
    expect(JSON.stringify(impostorInfo)).not.toContain('accomplice');
    const accompliceInfo = infos.find(info => info.role === 'accomplice')!;
    expect(accompliceInfo).toEqual({ roundId: lobby.roundId, role: 'accomplice' });
    expect(JSON.stringify(accompliceInfo)).not.toContain(impostor.id);
    expect(infos.find(info => info.role === 'jester')).toEqual({ roundId: lobby.roundId, role: 'jester' });
  });

  it('leaves out roles below their player minimum, and the Jester without phone voting', async () => {
    const four = await round(allRoles, 4);
    expect(four.infos.map(info => info.role).sort()).toEqual(['crewmate', 'crewmate', 'impostor', 'security']);
    const noPhones = await round({ ...allRoles, phoneVoting: false });
    expect(noPhones.infos.map(info => info.role).sort()).toEqual(['accomplice', 'crewmate', 'crewmate', 'crewmate', 'impostor', 'security']);
  });
});

describe('Jester', () => {
  it('wins alone when every other voter votes them out on their phone', async () => {
    const { game, cookies, as, meeting, step, vote } = await round(allRoles);
    const [jester] = as('jester');
    await meeting();
    await step({ action: 'openVote' });
    // The Jester's own vote does not matter.
    for (const cookie of cookies) await vote(cookie, cookie === jester.cookie ? 'skip' : jester.id);
    const closed = await step({ action: 'closeVote' });
    expect(closed.lobby.phase).toBe('ended');
    expect(closed.lobby.result).toEqual({ winner: 'jester', reason: 'jester' });
    expect((await game.snapshot()).revealedRoles).toContainEqual({ id: jester.id, role: 'jester' });
  });

  it('is simply out after a vote that was not unanimous, or not on phones', async () => {
    const split = await round(allRoles);
    const [jester] = split.as('jester');
    const holdout = split.cookies.find(cookie => cookie !== jester.cookie)!;
    await split.meeting();
    await split.step({ action: 'openVote' });
    for (const cookie of split.cookies) await split.vote(cookie, cookie === holdout ? 'skip' : jester.id);
    const closed = await split.step({ action: 'closeVote' });
    expect(closed.lobby.meeting.result.ejected).toBe(jester.id);
    expect(closed.lobby.phase).toBe('meeting');

    // A physical vote recorded by the organiser never counts as unanimous.
    const physical = await round(allRoles);
    await physical.meeting();
    const recorded = await physical.step({ action: 'record', ejected: physical.as('jester')[0].id });
    expect(recorded.lobby.phase).toBe('meeting');
  });
});

describe('Accomplice', () => {
  it('does not end the round when ejected and counts for neither side of the majority', async () => {
    const { app, game, host, as, meeting, step, roundId, advance } = await round(allRoles);
    const [accomplice] = as('accomplice');
    const [impostor] = as('impostor');
    await meeting();
    expect((await step({ action: 'record', ejected: accomplice.id })).lobby.phase).toBe('meeting');
    let lobby: Lobby = (await (await app.post('/api/round/commands', roundInput(await game.snapshot(), 'endMeeting'), host)).json()).lobby;
    expect(lobby.phase).toBe('active');
    // Crew and Jester: Security, Jester and two crewmates. The Impostor wins with one of them left.
    const others = [...as('security'), ...as('jester'), ...as('crewmate')];
    for (const [index, target] of others.slice(0, 3).entries()) {
      advance(60_000);
      const result = await (await app.post('/api/eliminate', { commandId: randomUUID(), roundId, targetId: target.id }, impostor.cookie)).json();
      expect(result.ended).toBe(index === 2);
    }
    lobby = await game.snapshot();
    expect(lobby.result).toEqual({ winner: 'impostor', reason: 'eliminations' });
  });
});

describe('Security', () => {
  it('keeps locations only with Security in the round, and shows them only to Security', async () => {
    const plain = await round();
    const station = plain.lobby.stations[0].id;
    expect((await plain.app.post('/api/round/location', { roundId: plain.roundId, stationId: station }, plain.cookies[1])).status).toBe(204);
    expect((await (await fetch(`${plain.app.url}/api/security?roundId=${plain.roundId}`, { headers: { Cookie: plain.cookies[1] } })).json()).error).toBe('FORBIDDEN');

    const { app, game, cookies, as, roundId, lobby, roleOf } = await round({ roles: ['security'] });
    const [security] = as('security');
    const [kitchen, living] = lobby.stations.map(entry => entry.id);
    const before = (await game.snapshot()).revision;
    const others = cookies.filter(cookie => cookie !== security.cookie);
    await app.post('/api/round/location', { roundId, stationId: kitchen }, others[0]);
    await app.post('/api/round/location', { roundId, stationId: living }, others[1]);
    // Reporting a location changes nothing anyone can see.
    const snapshot = await game.snapshot(others[2]);
    expect(snapshot.revision).toBe(before);
    expect(JSON.stringify(snapshot)).not.toMatch(/stationAt|station_at|secondsAgo/);
    expect((await (await fetch(`${app.url}/api/security?roundId=${roundId}`, { headers: { Cookie: others[0] } })).json()).error).toBe('FORBIDDEN');
    expect((await roleOf(security.cookie)).security).toEqual({ used: false, msLeft: 0, running: true });
    expect((await roleOf(others[0])).security).toBeUndefined();
  });

  it('opens once for the configured time, outside meetings, and closes when a meeting is called', async () => {
    const { app, game, cookies, ids, as, roundId, lobby, advance, host } = await round({ roles: ['security'], securityTime: 20 });
    const [security] = as('security');
    const use = () => app.post('/api/security', { commandId: randomUUID(), roundId }, security.cookie);
    const view = async (): Promise<SecurityView> => (await fetch(`${app.url}/api/security?roundId=${roundId}`, { headers: { Cookie: security.cookie } })).json();
    const other = cookies.find(cookie => cookie !== security.cookie)!;
    await app.post('/api/round/location', { roundId, stationId: lobby.stations[1].id }, other);
    expect((await (await app.post('/api/security', { commandId: randomUUID(), roundId }, other)).json()).error).toBe('FORBIDDEN');

    // Not during a meeting; the view stays unused.
    await app.post('/api/meetings', { commandId: randomUUID(), roundId, kind: 'organiser' }, host);
    expect((await (await use()).json()).error).toBe('INVALID_PHASE');
    await app.post('/api/round/commands', roundInput(await game.snapshot(), 'endMeeting'), host);

    advance(5_000);
    const opened = await (await use()).json();
    expect(opened.role.security).toEqual({ used: true, msLeft: 20_000, running: true });
    const otherId = ids[cookies.indexOf(other)];
    expect(opened.view.players).toHaveLength(5);
    expect(opened.view.players).toContainEqual({ id: otherId, stationId: lobby.stations[1].id, secondsAgo: 5 });
    expect(opened.view.players.map((entry: { id: string }) => entry.id)).not.toContain(security.id);
    expect((await (await use()).json()).error).toBe('SECURITY_USED');

    advance(10_000);
    expect((await view()).msLeft).toBe(10_000);
    // Calling a meeting closes the view; it does not come back afterwards.
    await app.post('/api/meetings', { commandId: randomUUID(), roundId, kind: 'organiser' }, host);
    await app.post('/api/round/commands', roundInput(await game.snapshot(), 'endMeeting'), host);
    expect(await view()).toEqual({ msLeft: 0, running: true, players: [] });
  });

  it('closes after its time runs out in active play', async () => {
    const { app, as, roundId, advance } = await round({ roles: ['security'] });
    const [security] = as('security');
    await app.post('/api/security', { commandId: randomUUID(), roundId }, security.cookie);
    advance(15_000);
    const closed: SecurityView = await (await fetch(`${app.url}/api/security?roundId=${roundId}`, { headers: { Cookie: security.cookie } })).json();
    expect(closed).toEqual({ msLeft: 0, running: true, players: [] });
  });
});
