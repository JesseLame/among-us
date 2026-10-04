import { z } from 'zod';

export const playerName = z.string().trim().min(1).max(24);
export const gameCode = z.string().trim().toUpperCase().regex(/^[A-Z]{5}$/);
export const language = z.enum(['en', 'nl']);
// `playing: false` creates a host-only organiser (for example on a laptop) with no role or tasks.
export const createGame = z.object({ name: playerName, language: language.optional(), playing: z.boolean().optional() });
export const joinGame = z.object({ name: playerName, code: gameCode });

export const errors = ['INVALID_INPUT', 'GAME_NOT_FOUND', 'GAME_FULL', 'NAME_TAKEN', 'NO_SESSION', 'SERVER_ERROR', 'CONNECTION_ERROR', 'ALREADY_JOINED', 'FORBIDDEN', 'NOT_ENOUGH_PLAYERS', 'ROUND_IN_PROGRESS', 'STALE_COMMAND', 'INVALID_PHASE', 'PLAYER_NOT_FOUND', 'CANNOT_REMOVE_ORGANISER', 'NO_STATIONS', 'TOO_MANY_STATIONS', 'STATION_EXISTS', 'TASK_NOT_FOUND', 'WRONG_ANSWER', 'NOT_PLAYING'] as const;
export type ErrorCode = typeof errors[number];
export type Role = 'crewmate' | 'impostor';
export type Phase = 'lobby' | 'active' | 'paused' | 'ended';
export const roundCommand = z.object({
  commandId: z.uuid(),
  action: z.enum(['start', 'pause', 'resume', 'end', 'reset']),
  expectedRevision: z.number().int().nonnegative(),
  roundId: z.uuid().nullable(),
});
export type RoundCommand = z.infer<typeof roundCommand>;
const roomCommandBase = roundCommand.omit({ action: true }).extend({ code: gameCode });
export const roomCommand = z.discriminatedUnion('action', [
  roomCommandBase.extend({ action: z.literal('remove'), playerId: z.uuid() }),
  roomCommandBase.extend({ action: z.literal('destroy') }),
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
export const settingsCommand = roundCommand.omit({ action: true }).extend({ stationAccess });
export type SettingsCommand = z.infer<typeof settingsCommand>;

// Order: numbers in the tapped order. Wires: for each left wire, the index of
// its right-hand match. Codebook: the digits read from the printed station sheet.
export const completeTask = z.object({
  roundId: z.uuid(),
  taskId: z.uuid(),
  answer: z.union([z.array(z.number().int().min(0).max(99)).max(8), z.string().regex(/^\d{1,8}$/)]),
});
export type CompleteTask = z.infer<typeof completeTask>;

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
  | { kind: 'codebook'; symbols: SymbolId[] };
export type Task = { id: string; stationId: string; done: boolean; puzzle: TaskPuzzle };
export type Station = { id: string; name: string };
export type PrintableStation = Station & { codebook: Record<SymbolId, number> };
export type RoundResult = { winner: 'crew' | null; reason: 'tasks' | 'organiser' | 'departure' };

export type SessionEndReason = 'removed' | 'destroyed' | 'unavailable';
export type Lobby = {
  code: string;
  phase: Phase;
  roundId: string | null;
  revision: number;
  pauseReason: 'organiser' | 'restart' | null;
  revealedRoles?: { id: string; role: Role }[];
  players: { id: string; name: string; organiser: boolean; playing: boolean; removed?: boolean }[];
  stations: Station[];
  settings: { stationAccess: StationAccess };
  // Shared progress is published in batches during a round so a single
  // completion cannot prove innocence. It is exact once the round has ended.
  progress: { done: number; goal: number } | null;
  result?: RoundResult;
  you: { id: string; organiser: boolean; playing: boolean; tasks: Task[] };
};

export interface ServerEvents {
  'lobby:updated': (lobby: Lobby) => void;
  'session:ended': (reason: SessionEndReason) => void;
}
export interface ClientEvents { 'lobby:sync': () => void }
