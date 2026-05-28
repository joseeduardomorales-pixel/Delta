// /api/admin/sync/* — admin-triggered data sync endpoints.
//
//   POST /api/admin/sync/meters   Pull fresh odometer + reefer hours
//                                 from Intangles + TrackFleet.
//
// Background tick lives in server.js and runs every 15 min; this
// endpoint exists so an admin can force a refresh on demand without
// waiting for the next tick.

import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { syncAllMeters } from '../sync/meters_sync.js';
import { logger } from '../logger.js';

export const adminSyncRouter = Router();
adminSyncRouter.use('/api/admin/sync', requireAuth, requireAdmin);

adminSyncRouter.post('/api/admin/sync/meters', async (req, res) => {
  try {
    const result = await syncAllMeters();
    res.json({ ok: true, result });
  } catch (e) {
    logger.error({ err: e.message }, 'admin sync meters failed');
    res.status(500).json({ ok: false, error: e.message });
  }
});
