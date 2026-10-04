import express from 'express';
import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { resolve } from 'node:path';
import { Server } from 'socket.io';
import type { ClientEvents, ServerEvents, SessionEndReason } from '../shared/protocol.js';
import { createStore, GameError } from './store/index.js';
import { practiceRoutes } from './practice.js';
import type { RouteContext } from './routes/context.js';
import { gamesRoutes } from './routes/games.js';
import { meetingsRoutes } from './routes/meetings.js';
import { organiserRoutes } from './routes/organiser.js';
import { roundRoutes } from './routes/round.js';
import { sessionToken } from './session.js';

export function createApp(options: { databasePath: string; production?: boolean; clientPath?: string; now?: () => number; tls?: { key: string; cert: string; ca?: string } }) {
  const store = createStore(options.databasePath, options.now);
  const app = express();
  const http = options.tls ? createSecureServer({ key: options.tls.key, cert: options.tls.cert }, app) : createServer(app);
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
  // The local certificate authority, for devices to install once so HTTPS needs no warning.
  if (options.tls?.ca) {
    const ca = options.tls.ca;
    app.get('/ca.crt', (_req, res) => {
      res.setHeader('Content-Disposition', 'attachment; filename="among-us-at-home-ca.crt"');
      res.setHeader('Content-Type', 'application/x-x509-ca-cert');
      res.send(Buffer.from(ca));
    });
  }
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

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

  const setSession = (res: express.Response, token: string) => res.cookie('home_session', token, {
    httpOnly: true, secure: Boolean(options.production || options.tls), sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, path: '/',
  });

  // Only the player's own sockets learn about their task, unless it ended the round.
  function syncPlayer(playerId: string) {
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.playerId !== playerId) continue;
      const lobby = store.lobby(sessionToken(socket.request.headers.cookie));
      if (lobby) socket.emit('lobby:updated', lobby);
    }
  }

  const routes: RouteContext = { store, broadcast, syncPlayer, setSession };
  app.use(gamesRoutes(routes));
  app.use(roundRoutes(routes));
  app.use(meetingsRoutes(routes));
  app.use(organiserRoutes(routes));

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

  app.use('/api/practice', practiceRoutes());
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
