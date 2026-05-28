// GET /api/drivers — read-only directory of drivers synced from Alvys.
// All authenticated roles can read; mirrors /api/assets in shape.

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';

export const driversRouter = Router();

driversRouter.get('/api/drivers', requireAuth, async (req, res) => {
  const admin = getSupabaseAdmin();
  const { active, search } = req.query;
  let q = admin
    .from('drivers')
    .select('id, full_name, alvys_id, phone, email, active, created_at, updated_at')
    .order('full_name');
  if (active !== 'all') q = q.eq('active', true);
  if (search) q = q.ilike('full_name', `%${search}%`);
  const { data, error } = await q.limit(500);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ drivers: data });
});
