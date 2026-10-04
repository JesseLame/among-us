import { Router } from 'express';
import { callMeeting, castVote, meetingCommand } from '../../shared/protocol.js';
import { sessionToken } from '../session.js';
import { GameError } from '../store/index.js';
import type { RouteContext } from './context.js';

// Meetings: calling one, the organiser's meeting commands and phone votes.
export function meetingsRoutes({ store, broadcast }: RouteContext) {
  const router = Router();
  router.post('/api/meetings', (req, res, next) => {
    try {
      const parsed = callMeeting.safeParse(req.body);
      if (!parsed.success) throw new GameError('INVALID_INPUT');
      const token = sessionToken(req.headers.cookie);
      const code = store.startMeeting(token, parsed.data);
      res.json({ lobby: store.lobby(token) });
      broadcast(code);
    } catch (error) { next(error); }
  });

  router.post('/api/meeting/commands', (req, res, next) => {
    try {
      const parsed = meetingCommand.safeParse(req.body);
      if (!parsed.success) throw new GameError('INVALID_INPUT');
      const token = sessionToken(req.headers.cookie);
      const code = store.runMeeting(token, parsed.data);
      res.json({ lobby: store.lobby(token) });
      broadcast(code);
    } catch (error) { next(error); }
  });

  // A vote changes no revision; every phone gets the new vote count.
  router.post('/api/vote', (req, res, next) => {
    try {
      const parsed = castVote.safeParse(req.body);
      if (!parsed.success) throw new GameError('INVALID_INPUT');
      const token = sessionToken(req.headers.cookie);
      const code = store.vote(token, parsed.data);
      res.json({ lobby: store.lobby(token) });
      broadcast(code);
    } catch (error) { next(error); }
  });
  return router;
}
