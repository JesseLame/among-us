import { Router } from 'express';
import { correction, rejoin, roomCommand, settingsCommand, stationCommand } from '../../shared/protocol.js';
import { sessionToken } from '../session.js';
import { GameError } from '../store/index.js';
import type { RouteContext } from './context.js';

// Organiser-only changes: corrections and their previews, stations, settings, print sheets
// and room management.
export function organiserRoutes({ store, broadcast }: RouteContext) {
  const router = Router();
  router.post('/api/corrections', (req, res, next) => {
    try {
      const parsed = correction.safeParse(req.body);
      if (!parsed.success) throw new GameError('INVALID_INPUT');
      const token = sessionToken(req.headers.cookie);
      const code = store.correct(token, parsed.data);
      res.json({ lobby: store.lobby(token) });
      broadcast(code);
    } catch (error) { next(error); }
  });

  // What a correction or a player removal would do, without applying it (organiser only).
  router.post('/api/corrections/preview', (req, res, next) => {
    try {
      const parsed = correction.safeParse(req.body);
      if (!parsed.success) throw new GameError('INVALID_INPUT');
      res.json({ preview: store.previewCorrection(sessionToken(req.headers.cookie), parsed.data) });
    } catch (error) { next(error); }
  });
  router.post('/api/room/preview', (req, res, next) => {
    try {
      const parsed = roomCommand.safeParse(req.body);
      if (!parsed.success) throw new GameError('INVALID_INPUT');
      res.json({ preview: store.previewRemoval(sessionToken(req.headers.cookie), parsed.data) });
    } catch (error) { next(error); }
  });

  router.post('/api/stations/commands', (req, res, next) => {
    try {
      const parsed = stationCommand.safeParse(req.body);
      if (!parsed.success) throw new GameError('INVALID_INPUT');
      const lobby = store.manageStations(sessionToken(req.headers.cookie), parsed.data);
      res.json({ lobby });
      broadcast(lobby.code);
    } catch (error) { next(error); }
  });

  router.post('/api/settings/commands', (req, res, next) => {
    try {
      const parsed = settingsCommand.safeParse(req.body);
      if (!parsed.success) throw new GameError('INVALID_INPUT');
      const lobby = store.changeSettings(sessionToken(req.headers.cookie), parsed.data);
      res.json({ lobby });
      broadcast(lobby.code);
    } catch (error) { next(error); }
  });

  router.get('/api/stations/print', (req, res, next) => {
    try {
      res.json({ stations: store.printableStations(sessionToken(req.headers.cookie)) });
    }
    catch (error) { next(error); }
  });

  router.post('/api/room/commands', (req, res, next) => {
    try {
      const parsed = roomCommand.safeParse(req.body);
      if (!parsed.success) throw new GameError('INVALID_INPUT');
      const result = store.manageRoom(sessionToken(req.headers.cookie), parsed.data);
      if (!result.lobby) res.clearCookie('home_session', { path: '/' });
      res.json({ lobby: result.lobby, ...('rejoin' in result ? { rejoin: result.rejoin } : {}) });
      broadcast(result.code, parsed.data.action === 'destroy' ? 'destroyed' : 'removed');
    } catch (error) { next(error); }
  });
  return router;
}
