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

// Per-asset history — the kardex view.
//
// Returns three sections aligned with the new model:
//   - issues:        open/acknowledged/in_progress issues on this asset
//   - active_work_orders: WOs with status='open' or 'in_progress'
//   - completed_work_orders: WOs with status='completed' (any approval_status)
//
// Each WO includes its items + photos. Photos come back as short-lived
// signed URLs.
assetsRouter.get(
  '/api/assets/:unit/work-orders',
  requireAuth,
  async (req, res) => {
    const admin = getSupabaseAdmin();
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const unit = req.params.unit;

    const [woRes, issuesRes] = await Promise.all([
      admin
        .from('work_orders')
        .select(
          `id, asset_unit_number, status, summary, started_at, completed_at,
           approval_status, approved_at, approval_notes, voided_at, void_reason,
           opening_meter:meter_readings!work_orders_opening_meter_reading_id_fkey
             ( value, unit, source, recorded_at ),
           action_photos ( id, storage_path, caption, uploaded_at ),
           user:users!work_orders_user_id_fkey ( id, full_name, role ),
           items:work_order_items (
             id, sequence, source, source_issue_id, source_pm_schedule_id,
             source_campaign_assignment_id, type, title, description, raw_input,
             status, notes, skipped_reason, completed_at, completed_by_user_id
           )`,
        )
        .ilike('asset_unit_number', unit)
        .order('started_at', { ascending: false })
        .limit(limit),
      admin
        .from('issues')
        .select(
          `id, asset_unit_number, title, description, raw_input, status,
           reported_at, resolved_at, dismissed_at, dismiss_reason,
           resolved_by_work_order_item_id,
           reporter:users!issues_reported_by_fkey ( id, full_name, role )`,
        )
        .ilike('asset_unit_number', unit)
        .order('reported_at', { ascending: false })
        .limit(limit),
    ]);

    if (woRes.error) return res.status(500).json({ error: woRes.error.message });
    if (issuesRes.error) return res.status(500).json({ error: issuesRes.error.message });

    const rows = woRes.data ?? [];
    const issues = issuesRes.data ?? [];

    // Sign photo URLs in parallel.
    const allPhotos = rows.flatMap((w) => w.action_photos ?? []);
    const urlMap = new Map();
    await Promise.all(
      allPhotos.map(async (p) => {
        try {
          urlMap.set(p.id, await signedReadUrl(p.storage_path, 120));
        } catch {
          urlMap.set(p.id, null);
        }
      }),
    );

    const decorated = rows.map((w) => ({
      ...w,
      items: (w.items ?? []).sort((a, b) => a.sequence - b.sequence),
      action_photos: (w.action_photos ?? []).map((p) => ({
        ...p,
        url: urlMap.get(p.id) ?? null,
      })),
    }));

    const openIssues = issues.filter((i) =>
      ['open', 'acknowledged', 'in_progress'].includes(i.status),
    );
    const closedIssues = issues.filter((i) =>
      ['resolved', 'dismissed'].includes(i.status),
    );
    const active = decorated.filter((w) =>
      ['open', 'in_progress'].includes(w.status),
    );
    const completed = decorated.filter((w) => w.status === 'completed');
    const voided = decorated.filter((w) => w.status === 'voided');

    res.json({
      asset_unit_number: unit,
      open_issues: openIssues,
      closed_issues: closedIssues,
      active_work_orders: active,
      completed_work_orders: completed,
      voided_work_orders: voided,
    });
  },
);
