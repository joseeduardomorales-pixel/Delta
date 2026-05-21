// GET /health
//
// Foundation contract: returns within 200ms with the following shape:
//   { status, uptime, env, version,
//     db: 'unchecked' | 'ok' | 'error',
//     claude: 'unchecked' | 'ok' | 'error',
//     intangles: 'unchecked' | 'ok' | 'error',
//     lastSync: null }
//
// Real db / claude / intangles checks land in Phase 3 (with a hard
// 200ms cap and parallel execution).

import { Router } from 'express';
import { config } from '../config.js';

const startedAt = Date.now();

export const healthRouter = Router();

healthRouter.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: (Date.now() - startedAt) / 1000,
    env: config.env,
    version: config.version,
    db: 'unchecked',
    claude: 'unchecked',
    intangles: 'unchecked',
    lastSync: null,
  });
});
