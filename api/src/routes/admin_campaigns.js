// /api/admin/campaigns — CRUD + materialize assignments
//
// Filter shapes accepted in asset_filter:
//   { "all": true }
//   { "type": "truck" }    // or "trailer", "reefer"
//   { "unit_numbers": ["CC01", "CC02"] }
//
// When a campaign goes active, the server materializes one
// campaign_assignments row per matching asset (status='open').

import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';
import { logger } from '../logger.js';

export const adminCampaignsRouter = Router();
adminCampaignsRouter.use(requireAuth, requireAdmin);

async function resolveMatchingAssets(admin, filter) {
  let q = admin.from('assets').select('id, unit_number, type').eq('active', true);
  if (filter?.unit_numbers && Array.isArray(filter.unit_numbers) && filter.unit_numbers.length) {
    q = q.in(
      'unit_number',
      filter.unit_numbers.map((u) => String(u).toUpperCase()),
    );
  } else if (filter?.type) {
    q = q.eq('type', filter.type);
  }
  // 'all' → no further filter
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

async function materializeAssignments(admin, campaignId, filter) {
  const assets = await resolveMatchingAssets(admin, filter);
  if (assets.length === 0) return { matched: 0, created: 0 };

  // Bulk insert (UNIQUE constraint dedups by (campaign_id, asset_id) on conflict)
  const rows = assets.map((a) => ({
    campaign_id: campaignId,
    asset_id: a.id,
    status: 'open',
  }));
  const { data, error } = await admin
    .from('campaign_assignments')
    .upsert(rows, { onConflict: 'campaign_id,asset_id', ignoreDuplicates: true })
    .select('id');
  if (error) throw new Error(error.message);
  return { matched: assets.length, created: data?.length ?? 0 };
}

// ---- GET /api/admin/campaigns ---------------------------------------------
adminCampaignsRouter.get('/api/admin/campaigns', async (req, res) => {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('campaigns')
    .select(
      `id, name, description, status, asset_filter, starts_at, ends_at,
       created_at, updated_at`,
    )
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return res.status(500).json({ error: error.message });

  // Per-campaign progress: count open/completed/skipped assignments
  const ids = data.map((c) => c.id);
  let progress = new Map();
  if (ids.length > 0) {
    const { data: agg } = await admin
      .from('campaign_assignments')
      .select('campaign_id, status')
      .in('campaign_id', ids);
    for (const a of agg || []) {
      const cur = progress.get(a.campaign_id) || { open: 0, completed: 0, skipped: 0 };
      cur[a.status] = (cur[a.status] || 0) + 1;
      progress.set(a.campaign_id, cur);
    }
  }
  const decorated = data.map((c) => ({
    ...c,
    progress: progress.get(c.id) || { open: 0, completed: 0, skipped: 0 },
  }));
  res.json({ campaigns: decorated, count: decorated.length });
});

// ---- POST /api/admin/campaigns --------------------------------------------
adminCampaignsRouter.post('/api/admin/campaigns', async (req, res) => {
  const { name, description, asset_filter, starts_at, ends_at, activate } =
    req.body || {};
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name_required' });
  }
  const filter = asset_filter || {};
  const admin = getSupabaseAdmin();
  const { data: created, error } = await admin
    .from('campaigns')
    .insert({
      name: name.trim(),
      description: description?.trim() || null,
      asset_filter: filter,
      starts_at: starts_at || new Date().toISOString(),
      ends_at: ends_at || null,
      status: activate ? 'active' : 'draft',
      created_by: req.user.id,
    })
    .select('id, name, status, asset_filter')
    .single();
  if (error) return res.status(500).json({ error: error.message });

  let materialize = { matched: 0, created: 0 };
  if (activate) {
    try {
      materialize = await materializeAssignments(admin, created.id, filter);
    } catch (e) {
      logger.error({ err: e.message }, 'materialize on create failed');
    }
  }

  await admin.from('audit_log').insert({
    actor_user_id: req.user.id,
    action: 'campaign_create',
    target_table: 'campaigns',
    target_id: created.id,
    after: { name: created.name, status: created.status, materialize },
  });

  res.status(201).json({ campaign: created, materialize });
});

// ---- PATCH /api/admin/campaigns/:id ---------------------------------------
const PATCH_FIELDS = new Set(['name', 'description', 'asset_filter', 'starts_at', 'ends_at']);

adminCampaignsRouter.patch('/api/admin/campaigns/:id', async (req, res) => {
  const admin = getSupabaseAdmin();
  const update = {};
  for (const k of Object.keys(req.body || {})) {
    if (PATCH_FIELDS.has(k)) update[k] = req.body[k];
  }
  const newStatus = req.body?.status;
  const VALID_STATUS = new Set(['draft', 'active', 'closed']);
  if (typeof newStatus === 'string' && VALID_STATUS.has(newStatus)) {
    update.status = newStatus;
  }
  if (Object.keys(update).length === 0) {
    return res.status(400).json({ error: 'no_fields' });
  }

  const { data, error } = await admin
    .from('campaigns')
    .update(update)
    .eq('id', req.params.id)
    .select('id, name, status, asset_filter')
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'not_found' });

  // If status just flipped to 'active', materialize new assignments.
  let materialize = null;
  if (update.status === 'active') {
    try {
      materialize = await materializeAssignments(admin, req.params.id, data.asset_filter || {});
    } catch (e) {
      logger.error({ err: e.message }, 'materialize on activate failed');
    }
  }

  await admin.from('audit_log').insert({
    actor_user_id: req.user.id,
    action: 'campaign_update',
    target_table: 'campaigns',
    target_id: req.params.id,
    after: update,
  });

  res.json({ campaign: data, materialize });
});

// ---- DELETE /api/admin/campaigns/:id --------------------------------------
adminCampaignsRouter.delete('/api/admin/campaigns/:id', async (req, res) => {
  const admin = getSupabaseAdmin();
  const { error } = await admin.from('campaigns').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  await admin.from('audit_log').insert({
    actor_user_id: req.user.id,
    action: 'campaign_delete',
    target_table: 'campaigns',
    target_id: req.params.id,
  });
  res.status(204).end();
});

// ---- GET /api/admin/campaigns/:id/assignments -----------------------------
adminCampaignsRouter.get(
  '/api/admin/campaigns/:id/assignments',
  async (req, res) => {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('campaign_assignments')
      .select(
        `id, status, completed_at, skipped_reason,
         completed_by_work_order_item_id,
         asset:assets ( id, unit_number, type )`,
      )
      .eq('campaign_id', req.params.id)
      .order('status', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ assignments: data });
  },
);
