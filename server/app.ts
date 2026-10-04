import express from 'express';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { networkInterfaces } from 'node:os';
import { Server } from 'socket.io';
import { completeTask, createGame, joinGame, roomCommand, roundCommand, settingsCommand, stationCommand, type ClientEvents, type ServerEvents, type SessionEndReason } from '../shared/protocol.js';
import { createStore, GameError } from './store.js';

export function sessionToken(cookie = '') {
  return cookie.split(';').map(part => part.trim()).find(part => part.startsWith('home_session='))?.slice('home_session='.length);
}

export function createApp(options: { databasePath: string; production?: boolean; clientPath?: string; now?: () => number }) {
  const store = createStore(options.databasePath, options.now);
  const app = express();
  const http = createServer(app);
  const sameOrigin = (origin: string | undefined, host: string | undefined) => {
    if (!origin) return true;
    try { return new URL(origin).host === host; } catch { return false; }
  };
  const io = new Server<ClientEvents, ServerEvents>(http, {
    allowRequest: (req, done) => done(null, sameOrigin(req.headers.origin, req.headers.host)),
  });
  app.disable('x-powered-by');
  app.use(express.json({ limit: '4kb' }));
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET' && !sameOrigin(req.headers.origin, req.headers.host)) {
      res.status(403).json({ error: 'INVALID_INPUT' });
      return;
    }
    next();
  });
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/session', (req, res) => {
    const lobby = store.lobby(sessionToken(req.headers.cookie));
    if (!lobby) res.clearCookie('home_session', { path: '/' });
    res.json({ lobby });
  });
  app.get('/api/role', (req, res, next) => {
    try {
      if (typeof req.query.roundId !== 'string') throw new GameError('INVALID_INPUT');
      res.json(store.role(sessionToken(req.headers.cookie), req.query.roundId));
    } catch (error) { next(error); }
  });

  function broadcast(code: string, reason: SessionEndReason = 'removed') {
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.gameCode !== code) continue;
      const lobby = store.lobby(sessionToken(socket.request.headers.cookie));
      if (lobby?.code === code) socket.emit('lobby:updated', lobby);
      else {
        socket.emit('session:ended', reason);
        socket.disconnect(true);
      }
    }
  }

  app.post(['/api/games', '/api/games/join'], (req, res, next) => {
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
      res.cookie('home_session', result.token, {
        httpOnly: true, secure: Boolean(options.production), sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000, path: '/',
      });
      res.status(201).json({ lobby: result.lobby });
      broadcast(result.lobby.code);
    } catch (error) { next(error); }
  });

  app.post('/api/round/commands', (req, res, next) => {
    try {
      const parsed = roundCommand.safeParse(req.body);
      if (!parsed.success) throw new GameError('INVALID_INPUT');
      const lobby = store.command(sessionToken(req.headers.cookie), parsed.data);
      res.json({ lobby });
      broadcast(lobby.code);
    } catch (error) { next(error); }
  });

  // Only the player's own sockets learn about their task, unless it ended the round.
  function syncPlayer(playerId: string) {
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.playerId !== playerId) continue;
      const lobby = store.lobby(sessionToken(socket.request.headers.cookie));
      if (lobby) socket.emit('lobby:updated', lobby);
    }
  }

  app.post('/api/tasks/complete', (req, res, next) => {
    try {
      const parsed = completeTask.safeParse(req.body);
      if (!parsed.success) throw new GameError('INVALID_INPUT');
      const result = store.completeTask(sessionToken(req.headers.cookie), parsed.data);
      res.json({ lobby: result.lobby });
      if (result.ended) broadcast(result.lobby.code);
      else syncPlayer(result.lobby.you.id);
    } catch (error) { next(error); }
  });

  app.post('/api/stations/commands', (req, res, next) => {
    try {
      const parsed = stationCommand.safeParse(req.body);
      if (!parsed.success) throw new GameError('INVALID_INPUT');
      const lobby = store.manageStations(sessionToken(req.headers.cookie), parsed.data);
      res.json({ lobby });
      broadcast(lobby.code);
    } catch (error) { next(error); }
  });

  app.post('/api/settings/commands', (req, res, next) => {
    try {
      const parsed = settingsCommand.safeParse(req.body);
      if (!parsed.success) throw new GameError('INVALID_INPUT');
      const lobby = store.changeSettings(sessionToken(req.headers.cookie), parsed.data);
      res.json({ lobby });
      broadcast(lobby.code);
    } catch (error) { next(error); }
  });

  app.get('/api/stations/print', (req, res, next) => {
    try {
      const stations = store.printableStations(sessionToken(req.headers.cookie));
      // Lets the print page suggest a phone-reachable address when opened via localhost.
      const lanAddresses = Object.values(networkInterfaces()).flat()
        .filter(address => address && address.family === 'IPv4' && !address.internal).map(address => address!.address);
      res.json({ stations, lanAddresses });
    }
    catch (error) { next(error); }
  });

  app.post('/api/room/commands', (req, res, next) => {
    try {
      const parsed = roomCommand.safeParse(req.body);
      if (!parsed.success) throw new GameError('INVALID_INPUT');
      const result = store.manageRoom(sessionToken(req.headers.cookie), parsed.data);
      if (!result.lobby) res.clearCookie('home_session', { path: '/' });
      res.json({ lobby: result.lobby });
      broadcast(result.code, parsed.data.action === 'destroy' ? 'destroyed' : 'removed');
    } catch (error) { next(error); }
  });

  io.use((socket, next) => {
    const lobby = store.lobby(sessionToken(socket.request.headers.cookie));
    if (!lobby) return next(new Error('NO_SESSION'));
    socket.data.gameCode = lobby.code;
    socket.data.playerId = lobby.you.id;
    next();
  });
  io.on('connection', socket => {
    const sync = () => {
      const lobby = store.lobby(sessionToken(socket.request.headers.cookie));
      if (lobby) socket.emit('lobby:updated', lobby);
      else { socket.emit('session:ended', 'unavailable'); socket.disconnect(true); }
    };
    sync();
    socket.on('lobby:sync', sync);
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'INVALID_INPUT' }));
  if (options.clientPath) {
    app.use(express.static(options.clientPath));
    app.get('/{*path}', (_req, res) => res.sendFile(resolve(options.clientPath!, 'index.html')));
  }
  const errorHandler: express.ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof GameError) res.status(error.status).json({ error: error.code });
    else if (error instanceof SyntaxError || error?.type === 'entity.too.large') res.status(400).json({ error: 'INVALID_INPUT' });
    else {
      console.error('Request failed:', error instanceof Error ? error.message : 'Unknown error');
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  };
  app.use(errorHandler);
  const tick = () => { for (const code of store.tick()) broadcast(code); };
  const ticker = setInterval(tick, 1000);
  ticker.unref();
  return { http, store, tick, close: () => new Promise<void>(resolve => { clearInterval(ticker); io.close(() => { store.close(); resolve(); }); }) };
}
