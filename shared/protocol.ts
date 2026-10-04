import { z } from 'zod';

export const playerName = z.string().trim().min(1).max(24);
export const gameCode = z.string().trim().toUpperCase().regex(/^[A-Z]{5}$/);
export const language = z.enum(['en', 'nl']);
// `playing: false` creates a host-only organiser (for example on a laptop) with no role or tasks.
export const createGame = z.object({ name: playerName, language: language.optional(), playing: z.boolean().optional() });
export const joinGame = z.object({ name: playerName, code: gameCode });

export const errors = ['INVALID_INPUT', 'GAME_NOT_FOUND', 'GAME_FULL', 'NAME_TAKEN', 'NO_SESSION', 'SERVER_ERROR', 'CONNECTION_ERROR', 'ALREADY_JOINED', 'FORBIDDEN', 'NOT_ENOUGH_PLAYERS', 'ROUND_IN_PROGRESS', 'STALE_COMMAND', 'INVALID_PHASE', 'PLAYER_NOT_FOUND', 'CANNOT_REMOVE_ORGANISER', 'NO_STATIONS', 'TOO_MANY_STATIONS', 'STATION_EXISTS', 'TASK_NOT_FOUND', 'WRONG_ANSWER', 'NOT_PLAYING', 'NOT_READY', 'NOT_ALIVE', 'ELIMINATIONS_OFF', 'REPORTS_OFF', 'EMERGENCY_OFF', 'NO_EMERGENCY_LEFT', 'VOTING_CLOSED', 'PHONE_VOTING_OFF'] as const;
export type ErrorCode = typeof errors[number];
export type Role = 'crewmate' | 'impostor';
export type Phase = 'lobby' | 'active' | 'paused' | 'meeting' | 'ended';
export const roundCommand = z.object({
  commandId: z.uuid(),
  action: z.enum(['start', 'pause', 'resume', 'endMeeting', 'end', 'reset']),
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
});
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
  pauseReason: 'organiser' | 'restart' | null;
  revealedRoles?: { id: string; role: Role }[];
  // `out`: a ghost, public once found at a meeting. Undiscovered bodies are never marked.
  players: { id: string; name: string; organiser: boolean; playing: boolean; test?: boolean; out?: boolean; removed?: boolean }[];
  stations: Station[];
  // eliminations: whether the Impostor records eliminations in the app (bodies, Impostor win).
  settings: {
    stationAccess: StationAccess; eliminations: boolean; bodyReports: boolean; emergencyMeetings: boolean; phoneVoting: boolean;
    openingProtection: number; killCooldown: number; discussionTime: number;
    emergencyAllowance: number; progressInterval: number; tasksPerPlayer: number; taskGoalPercent: number;
  };
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
