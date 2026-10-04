import { Router } from 'express';
import { completeTask, eliminate, roundCommand } from '../../shared/protocol.js';
import { sessionToken } from '../session.js';
import { GameError } from '../store/index.js';
import type { RouteContext } from './context.js';

// The round: private roles, organiser round commands, task answers and eliminations.
export function roundRoutes({ store, broadcast, syncPlayer }: RouteContext) {
  const router = Router();
  router.get('/api/role', (req, res, next) => {
    try {
      if (typeof req.query.roundId !== 'string') throw new GameError('INVALID_INPUT');
      res.json(store.role(sessionToken(req.headers.cookie), req.query.roundId));
    } catch (error) { next(error); }
  });

  router.post('/api/round/commands', (req, res, next) => {
    try {
      const parsed = roundCommand.safeParse(req.body);
      if (!parsed.success) throw new GameError('INVALID_INPUT');
      const lobby = store.command(sessionToken(req.headers.cookie), parsed.data);
      res.json({ lobby });
      broadcast(lobby.code);
    } catch (error) { next(error); }
  });

  router.post('/api/tasks/complete', (req, res, next) => {
    try {
      const parsed = completeTask.safeParse(req.body);
      if (!parsed.success) throw new GameError('INVALID_INPUT');
      const result = store.completeTask(sessionToken(req.headers.cookie), parsed.data);
      res.json({ lobby: result.lobby });
      if (result.ended) broadcast(result.lobby.code);
      else syncPlayer(result.lobby.you.id);
    } catch (error) { next(error); }
  });

  router.post('/api/eliminate', (req, res, next) => {
    try {
      const parsed = eliminate.safeParse(req.body);
      if (!parsed.success) throw new GameError('INVALID_INPUT');
      const token = sessionToken(req.headers.cookie);
      const result = store.eliminatePlayer(token, parsed.data);
      // The Impostor's refreshed private view (new cooldown, remaining targets), unless the round just ended.
      res.json(result.ended ? { ended: true } : { ended: false, role: store.role(token, parsed.data.roundId) });
      if (result.ended) broadcast(result.code);
      else syncPlayer(result.victim);
    } catch (error) { next(error); }
  });
  return router;
}
