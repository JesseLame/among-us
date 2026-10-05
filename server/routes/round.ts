import { Router } from 'express';
import { completeTask, eliminate, helpTask, repairReactor, reportLocation, roundCommand, sabotage, useSecurity } from '../../shared/protocol.js';
import { sessionToken } from '../session.js';
import { GameError } from '../store/index.js';
import type { RouteContext } from './context.js';

// The round: private roles, organiser round commands, task answers, eliminations, sabotage and Security.
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

  // Two keys: the helper's own phone is told the unlock code; nothing else changes.
  router.post('/api/tasks/help', (req, res, next) => {
    try {
      const parsed = helpTask.safeParse(req.body);
      if (!parsed.success) throw new GameError('INVALID_INPUT');
      res.json(store.help(sessionToken(req.headers.cookie), parsed.data));
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

  // The meltdown alarm is public, so every phone gets it; the reply refreshes the Impostor's role card.
  router.post('/api/sabotage', (req, res, next) => {
    try {
      const parsed = sabotage.safeParse(req.body);
      if (!parsed.success) throw new GameError('INVALID_INPUT');
      const token = sessionToken(req.headers.cookie);
      const code = store.startSabotage(token, parsed.data);
      res.json({ lobby: store.lobby(token), role: store.role(token, parsed.data.roundId) });
      broadcast(code);
    } catch (error) { next(error); }
  });

  // A scanned (or, with manual access, opened) station. Nothing is broadcast.
  router.post('/api/round/location', (req, res, next) => {
    try {
      const parsed = reportLocation.safeParse(req.body);
      if (!parsed.success) throw new GameError('INVALID_INPUT');
      store.reportLocation(sessionToken(req.headers.cookie), parsed.data);
      res.status(204).end();
    } catch (error) { next(error); }
  });

  // Security opens their live view; only their own role card changes.
  router.post('/api/security', (req, res, next) => {
    try {
      const parsed = useSecurity.safeParse(req.body);
      if (!parsed.success) throw new GameError('INVALID_INPUT');
      const token = sessionToken(req.headers.cookie);
      store.startSecurity(token, parsed.data);
      res.json({ role: store.role(token, parsed.data.roundId), view: store.securityView(token, parsed.data.roundId) });
    } catch (error) { next(error); }
  });

  router.get('/api/security', (req, res, next) => {
    try {
      if (typeof req.query.roundId !== 'string') throw new GameError('INVALID_INPUT');
      res.json(store.securityView(sessionToken(req.headers.cookie), req.query.roundId));
    } catch (error) { next(error); }
  });

  router.post('/api/reactor/repair', (req, res, next) => {
    try {
      const parsed = repairReactor.safeParse(req.body);
      if (!parsed.success) throw new GameError('INVALID_INPUT');
      const token = sessionToken(req.headers.cookie);
      const result = store.repairReactor(token, parsed.data);
      res.json({ lobby: store.lobby(token), repaired: result.repaired });
      broadcast(result.code);
    } catch (error) { next(error); }
  });
  return router;
}
