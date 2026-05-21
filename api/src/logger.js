// Structured logging via pino.
// REDACTS authorization headers and known secret env shapes.
// No log line should ever surface an API key or bearer token.

import pino from 'pino';
import pinoHttp from 'pino-http';
import { config } from './config.js';

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  '*.apiKey',
  '*.api_key',
  '*.clientSecret',
  '*.client_secret',
  '*.serviceRoleKey',
  '*.service_role_key',
];

export const logger = pino({
  level: config.env === 'production' ? 'info' : 'debug',
  base: { service: 'delta-api', env: config.env, v: config.version },
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export const httpLogger = pinoHttp({
  logger,
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  customLogLevel: (req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
});
