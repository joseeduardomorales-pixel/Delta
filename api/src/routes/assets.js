// GET /api/assets, GET /api/assets/:unit, GET /api/assets/:unit/work-orders
// --------------------------------------------------------------------------
// Read-only views into the catalog + per-asset kardex. All authenticated
// roles can read; tighter filtering may come later.

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';
import { signedReadUrl } from '../services/storage.js';

export const assetsRouter = Router();

assetsRouter.get('/api/assets', requireAuth, async (req, res) => {
  const admin = getSupabaseAdmin();
  const { type, active, search } = req.query;
  let q = admin
    .from('assets')
    .select('unit_number, type, make, model, year, vin, active')
    .order('unit_number');
  if (type) q = q.eq('type', type);
  if (active !== 'all') q = q.eq('active', true);
  if (search) q = q.ilike('unit_number', `%${search}%`);
  const { data, error } = await q.limit(200);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ assets: data });
});

assetsRouter.get('/api/assets/:unit', requireAuth, async (req, res) => {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('assets')
    .select('id, unit_number, type, make, model, year, vin, intangles_device_id, monarch_device_id, trackfleet_device_id, active, metadata')
    .ilike('unit_number', req.params.unit)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'asset_not_found' });
  res.json({ asset: data });
});

// Per-asset work-order history. Returns approved + pending separately so
// the kardex page can render two clear sections. Photos come back as
// short-lived signed URLs the client can <img src=…/>.
assetsRouter.get(
  '/api/assets/:unit/work-orders',
  requireAuth,
  async (req, res) => {
    const admin = getSupabaseAdmin();
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    const { data: rows, error } = await admin
      .from('work_orders')
      .select(
        `id, asset_unit_number, type, status, title, description,
         raw_input, parsed_data, started_at, completed_at,
         approval_status, approved_at, voided_at,
         action_photos ( id, storage_path, caption, uploaded_at ),
         user:users!work_orders_user_id_fkey ( id, full_name )`,
      )
      .ilike('asset_unit_number', req.params.unit)
      .order('started_at', { ascending: false })
      .limit(limit);
    if (error) return res.status(500).json({ error: error.message });

    // Resolve signed URLs for every photo, in parallel.
    const allPhotos = (rows ?? []).flatMap((w) => w.action_photos ?? []);
    const urlMap = new Map();
    await Promise.all(
      allPhotos.map(async (p) => {
        try {
          urlMap.set(p.id, await signedReadUrl(p.storage_path, 60));
        } catch {
          urlMap.set(p.id, null);
        }
      }),
    );

    const decorated = (rows ?? []).map((w) => ({
      ...w,
      action_photos: (w.action_photos ?? []).map((p) => ({
        ...p,
        url: urlMap.get(p.id) ?? null,
      })),
    }));

    const approved = decorated.filter((w) => w.approval_status === 'approved');
    const pending = decorated.filter((w) => w.approval_status === 'pending_review');
    const rejected = decorated.filter((w) => w.approval_status === 'rejected');

    res.json({ asset_unit_number: req.params.unit, approved, pending, rejected });
  },
);
