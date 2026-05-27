// Express app factory. Server bootstrap lives in server.js so tests
// can import the app without binding a port.

import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { httpLogger, logger } from './logger.js';
import { healthRouter } from './routes/health.js';
import { meRouter } from './routes/me.js';
import { chatRouter } from './routes/chat.js';
import { uploadsRouter } from './routes/uploads.js';
import { assetsRouter } from './routes/assets.js';
import { adminWorkOrdersRouter } from './routes/admin_work_orders.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // CORS allowlist — single origin, never '*' (charter §6).
  app.use(
    cors({
      origin: (origin, cb) => {
        // Allow same-origin / curl (no Origin header) and exact match.
        if (!origin || origin === config.frontendOrigin) return cb(null, true);
        return cb(new Error(`CORS rejected: ${origin}`));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    }),
  );

  app.use(express.json({ limit: '256kb' }));
  app.use(httpLogger);

  app.use(healthRouter);
  app.use(meRouter);
  app.use(chatRouter);
  app.use(uploadsRouter);
  app.use(assetsRouter);
  app.use(adminWorkOrdersRouter);

  // 404 — explicit, logged.
  app.use((req, res) => {
    res.status(404).json({ error: 'not_found', path: req.path });
  });

  // Final error handler. Never swallow — log structured, return shape.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    logger.error(
      {
        err,
        path: req.path,
        method: req.method,
      },
      'Delta API: unhandled error',
    );
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
