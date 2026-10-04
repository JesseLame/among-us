import { z } from 'zod';

export const playerName = z.string().trim().min(1).max(24);
export const gameCode = z.string().trim().toUpperCase().regex(/^[A-Z]{5}$/);
export const createGame = z.object({ name: playerName });
export const joinGame = z.object({ name: playerName, code: gameCode });

export const errors = ['INVALID_INPUT', 'GAME_NOT_FOUND', 'GAME_FULL', 'NAME_TAKEN', 'NO_SESSION', 'SERVER_ERROR', 'CONNECTION_ERROR', 'ALREADY_JOINED', 'FORBIDDEN', 'NOT_ENOUGH_PLAYERS', 'ROUND_IN_PROGRESS', 'STALE_COMMAND', 'INVALID_PHASE', 'PLAYER_NOT_FOUND', 'CANNOT_REMOVE_ORGANISER'] as const;
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
export type SessionEndReason = 'removed' | 'destroyed' | 'unavailable';
export type Lobby = {
  code: string;
  phase: Phase;
  roundId: string | null;
  revision: number;
  pauseReason: 'organiser' | 'restart' | null;
  revealedRoles?: { id: string; role: Role }[];
  players: { id: string; name: string; organiser: boolean; removed?: boolean }[];
  you: { id: string; organiser: boolean };
};

export interface ServerEvents {
  'lobby:updated': (lobby: Lobby) => void;
  'session:ended': (reason: SessionEndReason) => void;
}
export interface ClientEvents { 'lobby:sync': () => void }
