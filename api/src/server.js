import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info(
    { port: config.port, env: config.env },
    'Delta API listening',
  );
});

function shutdown(signal) {
  logger.info({ signal }, 'Delta API shutting down');
  server.close(() => process.exit(0));
  // Force exit if graceful shutdown stalls.
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
