// /api/admin/work-orders/* — review queue endpoints.
// Admin-only (verified via requireAdmin in addition to requireAuth).
//
//   GET    /api/admin/work-orders/pending     list pending_review WOs
//   PATCH  /api/admin/work-orders/:id         edit fields (audit_log diff)
//   POST   /api/admin/work-orders/:id/approve flip approval_status='approved'
//   POST   /api/admin/work-orders/:id/reject  flip to 'rejected' + notes

import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';
import { signedReadUrl } from '../services/storage.js';
import { logger } from '../logger.js';

export const adminWorkOrdersRouter = Router();
// Scope the admin gate to this router's path prefix. Using
// router.use(middleware) WITHOUT a path makes it fire for every request
// that flows through, which silently 403s non-admin endpoints mounted
// AFTER this router in app.js. The path-prefixed form below limits the
// middleware to /api/admin/work-orders/* only.
adminWorkOrdersRouter.use('/api/admin/work-orders', requireAuth, requireAdmin);

const PHOTO_URL_TTL_S = 120;

// ---- GET /api/admin/work-orders/pending ------------------------------------
// Returns completed-and-pending-review WOs with their items + photos. Open or
// in_progress WOs are not yet reviewable (the tech hasn't closed them).
adminWorkOrdersRouter.get('/api/admin/work-orders/pending', async (req, res) => {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('work_orders')
    .select(
      `id, asset_id, asset_unit_number, status, summary,
       started_at, completed_at, approval_status, approval_notes, display_seq,
       opening_meter:meter_readings!work_orders_opening_meter_reading_id_fkey
         ( value, unit, source, recorded_at ),
       action_photos ( id, storage_path, caption, uploaded_at ),
       user:users!work_orders_user_id_fkey ( id, full_name, role, handle ),
       items:work_order_items (
         id, sequence, source, source_issue_id, source_pm_schedule_id,
         source_campaign_assignment_id, type, title, description, raw_input,
         status, notes, skipped_reason, completed_at,
         inspection_template_id, inspection_result
       )`,
    )
    .eq('approval_status', 'pending_review')
    // Only show closed WOs (or in_progress legacy rows). Voided are excluded.
    .in('status', ['completed', 'in_progress'])
    .order('completed_at', { ascending: false })
    .limit(200);
  if (error) return res.status(500).json({ error: error.message });

  // Sign photo URLs in parallel.
  const allPhotos = (data ?? []).flatMap((w) => w.action_photos ?? []);
  const urlMap = new Map();
  await Promise.all(
    allPhotos.map(async (p) => {
      try {
        urlMap.set(p.id, await signedReadUrl(p.storage_path, PHOTO_URL_TTL_S));
      } catch {
        urlMap.set(p.id, null);
      }
    }),
  );
  const decorated = (data ?? []).map((w) => ({
    ...w,
    items: (w.items ?? []).sort((a, b) => a.sequence - b.sequence),
    action_photos: (w.action_photos ?? []).map((p) => ({
      ...p,
      url: urlMap.get(p.id) ?? null,
    })),
  }));

  res.json({ work_orders: decorated, count: decorated.length });
});

// ---- POST /api/admin/work-orders/:id/approve -------------------------------
adminWorkOrdersRouter.post('/api/admin/work-orders/:id/approve', async (req, res) => {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('work_orders')
    .update({
      approval_status: 'approved',
      approved_at: new Date().toISOString(),
      approved_by: req.user.id,
    })
    .eq('id', req.params.id)
    .eq('approval_status', 'pending_review')
    .select('id, approval_status, approved_at, approved_by, summary, asset_unit_number')
    .maybeSingle();
  if (error) {
    logger.error({ err: error.message, id: req.params.id }, 'approve: update failed');
    return res.status(500).json({ error: error.message });
  }
  if (!data) {
    return res.status(404).json({ error: 'not_found_or_already_processed' });
  }

  await admin.from('audit_log').insert({
    actor_user_id: req.user.id,
    action: 'work_order_approve',
    target_table: 'work_orders',
    target_id: req.params.id,
    after: { approval_status: 'approved' },
  });

  res.json({ work_order: data });
});

// ---- POST /api/admin/work-orders/:id/reject --------------------------------
adminWorkOrdersRouter.post('/api/admin/work-orders/:id/reject', async (req, res) => {
  const { notes } = req.body || {};
  if (typeof notes !== 'string' || !notes.trim()) {
    return res.status(400).json({ error: 'reject_requires_notes' });
  }
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('work_orders')
    .update({
      approval_status: 'rejected',
      approval_notes: notes.trim().slice(0, 500),
      approved_at: new Date().toISOString(),
      approved_by: req.user.id,
    })
    .eq('id', req.params.id)
    .eq('approval_status', 'pending_review')
    .select('id, approval_status, approval_notes, summary, asset_unit_number')
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) {
    return res.status(404).json({ error: 'not_found_or_already_processed' });
  }

  await admin.from('audit_log').insert({
    actor_user_id: req.user.id,
    action: 'work_order_reject',
    target_table: 'work_orders',
    target_id: req.params.id,
    after: { approval_status: 'rejected', notes: notes.trim() },
  });

  res.json({ work_order: data });
});

// ---- PATCH /api/admin/work-orders/:id (edit) -------------------------------
// Post-redesign the WO header has very few editable fields — title/type/
// description moved down to work_order_items. The only WO-level field worth
// fixing pre-approval is `summary`. Item-level fixes go through
// /api/work-orders/:id/items/:itemId (already authed for admin).
const ALLOWED_FIELDS = new Set(['summary', 'asset_unit_number']);

adminWorkOrdersRouter.patch('/api/admin/work-orders/:id', async (req, res) => {
  const update = {};
  for (const k of Object.keys(req.body || {})) {
    if (ALLOWED_FIELDS.has(k) && typeof req.body[k] === 'string') {
      update[k] = req.body[k];
    }
  }
  if (Object.keys(update).length === 0) {
    return res.status(400).json({ error: 'no_allowed_fields' });
  }
  const admin = getSupabaseAdmin();

  const { data: before, error: bErr } = await admin
    .from('work_orders')
    .select('id, summary, asset_unit_number')
    .eq('id', req.params.id)
    .maybeSingle();
  if (bErr) return res.status(500).json({ error: bErr.message });
  if (!before) return res.status(404).json({ error: 'not_found' });

  const { data: after, error } = await admin
    .from('work_orders')
    .update(update)
    .eq('id', req.params.id)
    .select('id, summary, asset_unit_number, approval_status')
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });

  const diff = {};
  for (const k of Object.keys(update)) {
    if (before[k] !== update[k]) diff[k] = { before: before[k], after: update[k] };
  }
  if (Object.keys(diff).length > 0) {
    await admin.from('audit_log').insert({
      actor_user_id: req.user.id,
      action: 'work_order_edit',
      target_table: 'work_orders',
      target_id: req.params.id,
      before,
      after: update,
    });
  }

  res.json({ work_order: after, changed_fields: Object.keys(diff) });
});
