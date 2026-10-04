import type express from 'express';
import type { SessionEndReason } from '../../shared/protocol.js';
import type { Store } from '../store/index.js';

// What every route needs from the app: the store, live updates and the session cookie.
export type RouteContext = {
  store: Store;
  // Sends every connected phone in the room its own new snapshot, or signs it out.
  broadcast: (code: string, reason?: SessionEndReason) => void;
  // Updates only one player's phones.
  syncPlayer: (playerId: string) => void;
  setSession: (res: express.Response, token: string) => void;
};
