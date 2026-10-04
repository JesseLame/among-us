import { z } from 'zod';

export const playerName = z.string().trim().min(1).max(24);
export const gameCode = z.string().trim().toUpperCase().regex(/^[A-Z]{5}$/);
export const language = z.enum(['en', 'nl']);
// `playing: false` creates a host-only organiser (for example on a laptop) with no role or tasks.
export const createGame = z.object({ name: playerName, language: language.optional(), playing: z.boolean().optional() });
export const joinGame = z.object({ name: playerName, code: gameCode });

export const errors = ['INVALID_INPUT', 'GAME_NOT_FOUND', 'GAME_FULL', 'NAME_TAKEN', 'NO_SESSION', 'SERVER_ERROR', 'CONNECTION_ERROR', 'ALREADY_JOINED', 'FORBIDDEN', 'NOT_ENOUGH_PLAYERS', 'ROUND_IN_PROGRESS', 'STALE_COMMAND', 'INVALID_PHASE', 'PLAYER_NOT_FOUND', 'CANNOT_REMOVE_ORGANISER', 'NO_STATIONS', 'TOO_MANY_STATIONS', 'STATION_EXISTS', 'TASK_NOT_FOUND', 'WRONG_ANSWER', 'NOT_PLAYING', 'NOT_READY', 'NOT_ALIVE', 'ELIMINATIONS_OFF', 'REPORTS_OFF', 'EMERGENCY_OFF', 'NO_EMERGENCY_LEFT', 'VOTING_CLOSED', 'PHONE_VOTING_OFF', 'REJOIN_EXPIRED', 'UNDO_UNAVAILABLE', 'PREVIEWS_OFF'] as const;
export type ErrorCode = typeof errors[number];
// Every task game. Adding a game: its puzzle type below, its rules in server/tasks/<kind>.ts
// (registered in server/tasks/index.ts), its game in src/features/tasks/games/<kind>/
// (registered in registry.tsx, built on TaskFrame) and its EN/NL texts.
// The practice page (/practice) lists every kind automatically. A new game also needs an
// organiser on/off choice, which `taskGames` gives every kind automatically (on by default).
export const taskKinds = ['codebook', 'order', 'wires', 'simon', 'maze', 'waterways', 'delivery'] as const;
export type TaskKind = typeof taskKinds[number];
export type Role = 'crewmate' | 'impostor';
export type Phase = 'lobby' | 'active' | 'paused' | 'meeting' | 'ended';
export const roundCommand = z.object({
  commandId: z.uuid(),
  // confirmResult/rejectResult: answer the result the app proposes when the organiser confirms victories.
  action: z.enum(['start', 'pause', 'resume', 'endMeeting', 'end', 'reset', 'confirmResult', 'rejectResult']),
  // Only for 'end': the organiser may declare a winner; otherwise the round ends without one.
  winner: z.enum(['crew', 'impostor']).nullable().optional(),
  expectedRevision: z.number().int().nonnegative(),
  roundId: z.uuid().nullable(),
});
export type RoundCommand = z.infer<typeof roundCommand>;
const roomCommandBase = roundCommand.omit({ action: true }).extend({ code: gameCode });
export const roomCommand = z.discriminatedUnion('action', [
  roomCommandBase.extend({ action: z.literal('remove'), playerId: z.uuid() }),
  roomCommandBase.extend({ action: z.literal('destroy') }),
  // A test player for trying rounds with few phones: always a Crewmate, without tasks.
  roomCommandBase.extend({ action: z.literal('addTestPlayer') }),
  // A one-time code that lets a player who lost their session take their place again.
  roomCommandBase.extend({ action: z.literal('rejoinCode'), playerId: z.uuid() }),
]);
export type RoomCommand = z.infer<typeof roomCommand>;
export const stationName = z.string().trim().min(1).max(24);
const stationCommandBase = roundCommand.omit({ action: true });
export const stationCommand = z.discriminatedUnion('action', [
  stationCommandBase.extend({ action: z.literal('add'), name: stationName }),
  stationCommandBase.extend({ action: z.literal('remove'), stationId: z.uuid() }),
]);
export type StationCommand = z.infer<typeof stationCommand>;
// QR: a task opens only after scanning its station's QR code. Manual: open from the task list.
export const stationAccess = z.enum(['qr', 'manual']);
export type StationAccess = z.infer<typeof stationAccess>;
export const deliveryMode = z.enum(['app', 'object']);
export type DeliveryMode = z.infer<typeof deliveryMode>;
// Each change sends only the settings it changes. Timer durations are in seconds and
// apply to future timers (an elimination cooldown already running keeps its end).
const seconds = z.number().int().min(0).max(600);
export const settingsCommand = roundCommand.omit({ action: true }).extend({
  stationAccess: stationAccess.optional(), eliminations: z.boolean().optional(),
  bodyReports: z.boolean().optional(), emergencyMeetings: z.boolean().optional(), discussionTime: seconds.optional(),
  phoneVoting: z.boolean().optional(),
  emergencyAllowance: z.number().int().min(0).max(5).optional(), progressInterval: z.number().int().min(5).max(300).optional(),
  // These two change the next round only and can be set in the lobby.
  tasksPerPlayer: z.number().int().min(1).max(8).optional(), taskGoalPercent: z.number().int().min(10).max(100).optional(),
  openingProtection: seconds.optional(), killCooldown: seconds.optional(),
  // Organiser help: confirm a detected win before it ends the round, preview a change's
  // effect before applying it, and keep a change history with undo.
  confirmVictory: z.boolean().optional(), changePreviews: z.boolean().optional(), changeHistory: z.boolean().optional(),
  // The task games handed out whenever tasks are handed out or replaced: at least one, each once.
  taskGames: z.array(z.enum(taskKinds)).min(1).refine(games => new Set(games).size === games.length).optional(),
  // Delivery: carried in the app, or a real object from the house that players carry around.
  deliveryMode: deliveryMode.optional(), deliveryObject: z.string().trim().max(40).optional(),
});
export type SettingsCommand = z.infer<typeof settingsCommand>;

// Order: numbers in the tapped order. Wires: for each left wire, the index of
// its right-hand match. Codebook: the digits read from the printed station sheet.
// Maze: the moves from start to exit (0 up, 1 right, 2 down, 3 left).
// Waterways: every valve's quarter turns (0–3), row by row. Delivery: [0] to pick up, [1] to drop off.
const MAX_ANSWER = 64;
export const completeTask = z.object({
  roundId: z.uuid(),
  taskId: z.uuid(),
  answer: z.union([z.array(z.number().int().min(0).max(99)).max(MAX_ANSWER), z.string().regex(/^\d{1,8}$/)]),
});
export type CompleteTask = z.infer<typeof completeTask>;
// Practice: try any task game outside a round, checked by the same server code.
export const practiceCheck = z.object({ id: z.uuid(), answer: completeTask.shape.answer });
export type PracticePuzzle = { id: string; puzzle: TaskPuzzle; codebook?: Record<SymbolId, number> };

export const symbols = ['star', 'circle', 'triangle', 'square', 'diamond', 'heart', 'club', 'spade', 'sun', 'moon', 'cross', 'note'] as const;
export type SymbolId = typeof symbols[number];
// U+FE0E keeps card-suit and sun glyphs as text rather than emoji on phones.
export const symbolGlyphs: Record<SymbolId, string> = {
  star: '★', circle: '●', triangle: '▲', square: '■', diamond: '◆', heart: '♥\uFE0E',
  club: '♣\uFE0E', spade: '♠\uFE0E', sun: '☀\uFE0E', moon: '☾', cross: '✚', note: '♪',
};
export const wireColours = ['red', 'blue', 'yellow', 'green', 'purple', 'orange'] as const;
export type WireColour = typeof wireColours[number];
export type TaskPuzzle =
  | { kind: 'order'; numbers: number[] }
  | { kind: 'wires'; left: WireColour[]; right: WireColour[] }
  | { kind: 'codebook'; symbols: SymbolId[] }
  // Four coloured pads (0–3); repeat a growing part of the sequence until it is complete.
  | { kind: 'simon'; sequence: number[] }
  // A size × size grid, row by row. Each cell lists its open sides: 1 up, 2 right, 4 down, 8 left.
  | { kind: 'maze'; size: number; open: number[]; start: number; exit: number }
  // A size × size grid of valves, row by row, each turned 0–3 quarter turns clockwise.
  // Water enters the `source` row from the left and must leave the `drain` row on the right.
  | { kind: 'waterways'; size: number; valves: ValveShape[]; turns: number[]; source: number; drain: number }
  // In the app: load the cargo at this station, then the task moves to `to` to drop it off.
  // With a real object (`object` set) only the drop-off is left: bring the object to this station.
  | { kind: 'delivery'; cargo: Cargo; object: string | null; stage: 'pickup' | 'dropoff'; to: string | null };
export type ValveShape = 'straight' | 'bend';
export const cargos = ['fuel', 'battery', 'parcel', 'samples', 'water'] as const;
export type Cargo = typeof cargos[number];
// The sides a valve opens (1 up, 2 right, 4 down, 8 left): a straight one joins left and right,
// a bend joins left and up, both before turning. Each quarter turn moves every side clockwise.
export function valveSides(shape: ValveShape, turn: number) {
  let sides = shape === 'straight' ? 8 | 2 : 8 | 1;
  for (let step = 0; step < ((turn % 4) + 4) % 4; step++) sides = ((sides << 1) | (sides >> 3)) & 15;
  return sides;
}
// Where the water gets to with these turns, shared by the server check and the phone:
// the valves it fills, and whether it flows out at the drain.
export function waterFlow(puzzle: { size: number; valves: ValveShape[]; source: number; drain: number }, turns: number[]) {
  const { size, valves } = puzzle;
  const sides = valves.map((shape, index) => valveSides(shape, turns[index] ?? 0));
  const filled = new Set<number>();
  const first = puzzle.source * size;
  if (sides[first] & 8) filled.add(first);
  const queue = [...filled];
  while (queue.length) {
    const cell = queue.shift()!;
    for (let move = 0; move < 4; move++) {
      const next = mazeStep(size, sides, cell, move);
      // Both valves must open towards each other.
      if (next !== null && !filled.has(next) && sides[next] & (1 << ((move + 2) % 4))) { filled.add(next); queue.push(next); }
    }
  }
  const last = puzzle.drain * size + size - 1;
  return { filled, out: filled.has(last) && Boolean(sides[last] & 2) };
}
// Maze moves, shared by the server check and the phone: the cell one move away
// (0 up, 1 right, 2 down, 3 left), or null when a wall or the edge is in the way.
const mazeSides = [[1, 0, -1], [2, 1, 0], [4, 0, 1], [8, -1, 0]] as const;
export function mazeStep(size: number, open: number[], cell: number, move: number): number | null {
  const side = mazeSides[move];
  if (!side || !(open[cell] & side[0])) return null;
  const x = cell % size + side[1], y = Math.floor(cell / size) + side[2];
  return x < 0 || y < 0 || x >= size || y >= size ? null : y * size + x;
}
export type Task = { id: string; stationId: string; done: boolean; puzzle: TaskPuzzle };
export type Station = { id: string; name: string };
export type PrintableStation = Station & { codebook: Record<SymbolId, number> };
export type RoundResult = { winner: 'crew' | 'impostor' | null; reason: 'tasks' | 'eliminations' | 'ejected' | 'organiser' | 'departure' };
// A body waits silently to be found; it becomes a ghost at the next meeting.
export type PlayerStatus = 'alive' | 'body' | 'ghost';
export type MeetingKind = 'report' | 'emergency' | 'organiser';
// Living players report a body or call an emergency meeting; the organiser can always call one.
export const callMeeting = z.object({ commandId: z.uuid(), roundId: z.uuid(), kind: z.enum(['report', 'emergency', 'organiser']) });
export type CallMeeting = z.infer<typeof callMeeting>;
export type MeetingStage = 'gathering' | 'discussion' | 'voting' | 'result';
const meetingCommandBase = z.object({ commandId: z.uuid(), roundId: z.uuid(), expectedRevision: z.number().int().nonnegative() });
// Organiser steps through a meeting. `out`: players found eliminated (besides recorded bodies).
export const meetingCommand = z.discriminatedUnion('action', [
  meetingCommandBase.extend({ action: z.literal('start'), out: z.array(z.uuid()).max(8) }),
  meetingCommandBase.extend({ action: z.literal('openVote') }),
  meetingCommandBase.extend({ action: z.literal('closeVote') }),
  meetingCommandBase.extend({ action: z.literal('record'), ejected: z.uuid().nullable() }),
]);
export type MeetingCommand = z.infer<typeof meetingCommand>;
// Organiser corrections during a round. None of them reveals roles or hidden states:
// station fixes apply to everyone's tasks there, real and fake alike.
const correctionBase = z.object({ commandId: z.uuid(), roundId: z.uuid(), expectedRevision: z.number().int().nonnegative() });
export const correction = z.discriminatedUnion('action', [
  correctionBase.extend({ action: z.literal('creditStation'), stationId: z.uuid() }),
  correctionBase.extend({ action: z.literal('removeStationTasks'), stationId: z.uuid() }),
  // Every unfinished task at the station gets a new puzzle, at the chosen station or spread
  // over the other stations, so everyone keeps the same number of tasks.
  correctionBase.extend({ action: z.literal('replaceStationTasks'), stationId: z.uuid(), targetStationId: z.uuid().nullable() }),
  correctionBase.extend({ action: z.literal('setStatus'), playerId: z.uuid(), status: z.enum(['alive', 'ghost']) }),
  correctionBase.extend({ action: z.literal('restoreEmergency') }),
  // Reverts the latest correction in the change history, where that is still consistent.
  correctionBase.extend({ action: z.literal('undo'), changeId: z.number().int().positive() }),
]);
export type Correction = z.infer<typeof correction>;
// What a correction or player removal would do, without applying it. `ends`: the round ends;
// `proposes`: play stops for the organiser to confirm a result. Never says which team or why.
export type ChangePreview = { outcome: 'continues' | 'ends' | 'proposes'; goal: number | null };
// A redacted organiser change history entry: what the organiser did, never hidden state.
export type HistoryEntry = {
  id: number; at: number; undone: boolean; canUndo: boolean;
  action: Exclude<Correction['action'], 'undo'> | 'removePlayer';
  station?: string; target?: string; player?: string; status?: 'alive' | 'ghost';
};
export const rejoin = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{8}$/) });
export const castVote = z.object({ roundId: z.uuid(), target: z.union([z.uuid(), z.literal('skip')]) });
export type CastVote = z.infer<typeof castVote>;
export const eliminate = z.object({ commandId: z.uuid(), roundId: z.uuid(), targetId: z.uuid() });
export type Eliminate = z.infer<typeof eliminate>;
// Returned only to the player who reveals their own role. The Impostor also learns
// when they may eliminate next (active play time) and who they can choose.
export type RoleInfo = {
  roundId: string; role: Role;
  elimination?: { readyInMs: number; running: boolean; targets: { id: string; name: string }[] };
};

export type SessionEndReason = 'removed' | 'destroyed' | 'unavailable';
export type Lobby = {
  code: string;
  phase: Phase;
  roundId: string | null;
  revision: number;
  // victory: the app detected a win and waits for the organiser to confirm it.
  pauseReason: 'organiser' | 'restart' | 'victory' | null;
  revealedRoles?: { id: string; role: Role }[];
  // `out`: a ghost, public once found at a meeting. Undiscovered bodies are never marked.
  players: { id: string; name: string; organiser: boolean; playing: boolean; test?: boolean; out?: boolean; removed?: boolean }[];
  stations: Station[];
  // eliminations: whether the Impostor records eliminations in the app (bodies, Impostor win).
  settings: {
    stationAccess: StationAccess; eliminations: boolean; bodyReports: boolean; emergencyMeetings: boolean; phoneVoting: boolean;
    openingProtection: number; killCooldown: number; discussionTime: number;
    emergencyAllowance: number; progressInterval: number; tasksPerPlayer: number; taskGoalPercent: number;
    confirmVictory: boolean; changePreviews: boolean; changeHistory: boolean; taskGames: TaskKind[];
    deliveryMode: DeliveryMode; deliveryObject: string;
  };
  // Organiser only: the result the app detected, waiting for confirmation (pauseReason 'victory').
  proposedResult?: { winner: 'crew' | 'impostor'; reason: RoundResult['reason'] };
  // Organiser only, with the change history on: this round's changes, newest first.
  history?: HistoryEntry[];
  // Public while a meeting is on: who called it, the discussion time left when this
  // snapshot was made, and who was found out (bodies turned into ghosts) at its start.
  // A meeting first gathers everyone, then the organiser starts the discussion, then the
  // vote (on phones or physical) gives a result. discussionMs is null before the discussion
  // starts or when it is untimed. Votes stay secret until the vote closes.
  meeting?: {
    kind: MeetingKind; calledBy: string | null; stage: MeetingStage; discussionMs: number | null; newGhosts: string[];
    votes?: { cast: number; eligible: number };
    result?: { ejected: string | null; tally: { target: string; voters: string[] }[] | null };
  };
  // Shared progress is published in batches during a round so a single
  // completion cannot prove innocence. It is exact once the round has ended.
  progress: { done: number; goal: number } | null;
  result?: RoundResult;
  // vote: this player's own vote while voting is open ('skip' or a player id).
  you: { id: string; organiser: boolean; playing: boolean; status: PlayerStatus; emergencyLeft: number; tasks: Task[]; vote?: string };
};

export interface ServerEvents {
  'lobby:updated': (lobby: Lobby) => void;
  'session:ended': (reason: SessionEndReason) => void;
}
export interface ClientEvents { 'lobby:sync': () => void }
