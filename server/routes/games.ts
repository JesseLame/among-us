import { Router } from 'express';
import { createGame, rejoin, joinGame } from '../../shared/protocol.js';
import { lanAddresses } from '../network.js';
import { sessionToken } from '../session.js';
import { GameError } from '../store/index.js';
import type { RouteContext } from './context.js';

// Sessions: creating, joining and rejoining a room.
export function gamesRoutes({ store, broadcast, setSession }: RouteContext) {
  const router = Router();
  router.get('/api/session', (req, res) => {
    const lobby = store.lobby(sessionToken(req.headers.cookie));
    if (!lobby) res.clearCookie('home_session', { path: '/' });
    res.json({ lobby });
  });

  router.post(['/api/games', '/api/games/join'], (req, res, next) => {
    try {
      if (store.lobby(sessionToken(req.headers.cookie))) throw new GameError('ALREADY_JOINED', 409);
      const joining = req.path.endsWith('/join');
      const result = (() => {
        if (joining) {
          const parsed = joinGame.safeParse(req.body);
          if (!parsed.success) throw new GameError('INVALID_INPUT');
          return store.join(parsed.data.code, parsed.data.name);
        }
        const parsed = createGame.safeParse(req.body);
        if (!parsed.success) throw new GameError('INVALID_INPUT');
        return store.create(parsed.data.name, parsed.data.language, parsed.data.playing);
      })();
      setSession(res, result.token);
      res.status(201).json({ lobby: result.lobby });
      broadcast(result.lobby.code);
    } catch (error) { next(error); }
  });

  // Rejoining replaces whatever session this browser had: the phone becomes that player again.
  router.post('/api/games/rejoin', (req, res, next) => {
    try {
      const parsed = rejoin.safeParse(req.body);
      if (!parsed.success) throw new GameError('INVALID_INPUT');
      const result = store.rejoinPlayer(parsed.data.code);
      setSession(res, result.token);
      res.json({ lobby: result.lobby });
      // The player's old phone, if still connected, is signed out.
      broadcast(result.lobby.code, 'unavailable');
    } catch (error) { next(error); }
  });

  // The computer's addresses on the home network, home-Wi-Fi ranges first. A screen
  // opened via localhost uses these in QR codes so phones can reach the game.
  router.get('/api/network', (req, res, next) => {
    try {
      if (!store.lobby(sessionToken(req.headers.cookie))) throw new GameError('NO_SESSION', 401);
      res.json({ lanAddresses: lanAddresses() });
    } catch (error) { next(error); }
  });
  return router;
}
