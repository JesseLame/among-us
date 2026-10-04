import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Lobby, PrintableStation, RoomCommand, RoundCommand, StationCommand, Task } from '../../shared/protocol.js';
import { createApp } from '../app.js';
import { mazeRoute, waterwaysTurns } from './solvers.js';

export { mazeRoute, waterwaysTurns };

// Shared by the server integration tests: a test server per test, closed afterwards,
// and builders for common commands.
const cleanups: (() => Promise<void> | void)[] = [];
export async function cleanup() { for (const close of cleanups.reverse()) await close(); cleanups.length = 0; }
// Runs after the current test, before the servers it started are closed.
export const onCleanup = (close: () => Promise<void> | void) => { cleanups.push(close); };
// Closes a test server before the test ends, for example to restart it on the same database.
export async function stop(app: { close: () => Promise<void> }) {
  cleanups.splice(cleanups.indexOf(app.close), 1);
  await app.close();
}

export async function start(databasePath = ':memory:', now?: () => number) {
  const app = createApp({ databasePath, now });
  await new Promise<void>((resolve, reject) => { app.http.once('error', reject); app.http.listen(0, '127.0.0.1', resolve); });
  cleanups.push(app.close);
  const url = `http://127.0.0.1:${(app.http.address() as AddressInfo).port}`;
  const post = async (path: string, body: unknown, cookie = '') => fetch(`${url}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body),
  });
  return { ...app, url, post };
}

export function roundInput(lobby: Lobby, action: RoundCommand['action']): RoundCommand {
  return { action, commandId: randomUUID(), expectedRevision: lobby.revision, roundId: lobby.roundId };
}

export function roomInput(lobby: Lobby, playerId?: string): RoomCommand {
  const base = { commandId: randomUUID(), code: lobby.code, expectedRevision: lobby.revision, roundId: lobby.roundId };
  return playerId ? { ...base, action: 'remove', playerId } : { ...base, action: 'destroy' };
}

export async function crew(app: Awaited<ReturnType<typeof start>>) {
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

export function stationInput(lobby: Lobby, change: { action: 'add'; name: string } | { action: 'remove'; stationId: string }): StationCommand {
  return { ...change, commandId: randomUUID(), expectedRevision: lobby.revision, roundId: lobby.roundId };
}

export function answerFor(task: Task, stations: PrintableStation[]) {
  const { puzzle } = task;
  if (puzzle.kind === 'order') return [...puzzle.numbers].sort((a, b) => a - b);
  if (puzzle.kind === 'wires') return puzzle.left.map(colour => puzzle.right.indexOf(colour));
  if (puzzle.kind === 'simon') return puzzle.sequence;
  if (puzzle.kind === 'maze') return mazeRoute(puzzle);
  if (puzzle.kind === 'waterways') return waterwaysTurns(puzzle);
  const book = stations.find(station => station.id === task.stationId)!.codebook;
  return puzzle.symbols.map(symbol => book[symbol]).join('');
}
