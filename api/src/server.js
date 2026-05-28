import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { syncAllMeters } from './sync/meters_sync.js';

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info(
    { port: config.port, env: config.env },
    'Delta API listening',
  );
});

// ── Background meter sync ────────────────────────────────────────────────
// Pull fresh odometer (Intangles) and reefer hours (TrackFleet) into our
// meter_readings table. Without this, the tool returns last_known data
// stale by however long since the last manual sync — which is exactly
// the bug that made Delta say "from a month ago" when telematics had
// the value from this afternoon.
//
// - Fires once on boot to catch up after Render redeploys.
// - Re-fires every 15 min thereafter.
// - On Render's free/starter dyno, this pauses while the instance is
//   spun down (no traffic). The next request wakes it and the boot tick
//   runs again, so we self-heal.
// - Errors are logged and swallowed; sync must NEVER crash the server.
const METER_SYNC_INTERVAL_MS = 15 * 60 * 1000;
async function runMeterSync(reason) {
  try {
    const t0 = Date.now();
    const result = await syncAllMeters();
    logger.info(
      { reason, ms: Date.now() - t0, result },
      'meter sync: tick complete',
    );
  } catch (e) {
    logger.error({ reason, err: e.message }, 'meter sync: tick failed');
  }
}

// Don't block server startup on the boot sync — fire and forget.
// Skip in test env so vitest runs don't poke external services.
if (config.env !== 'test') {
  runMeterSync('boot').catch(() => {});
  const meterTimer = setInterval(
    () => runMeterSync('interval'),
    METER_SYNC_INTERVAL_MS,
  );
  meterTimer.unref(); // don't keep the process alive just for the timer
}

function shutdown(signal) {
  logger.info({ signal }, 'Delta API shutting down');
  server.close(() => process.exit(0));
  // Force exit if graceful shutdown stalls.
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
