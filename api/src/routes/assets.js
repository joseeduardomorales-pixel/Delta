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
    .select('id, unit_number, type, make, model, year, vin, active, metadata')
    .order('unit_number');
  if (type) q = q.eq('type', type);
  if (active !== 'all') q = q.eq('active', true);
  if (search) q = q.ilike('unit_number', `%${search}%`);
  const { data, error } = await q.limit(500);
  if (error) return res.status(500).json({ error: error.message });
  const rows = data || [];

  // Decorate with the per-asset state the fleet UI needs:
  //   - latest_meter (miles for trucks, hours for reefer units)
  //   - open_issue_count
  //   - active_inspection_count
  const assetIds = rows.map((r) => r.id);
  if (assetIds.length === 0) return res.json({ assets: [] });

  const [{ data: meters }, { data: issues }, { data: openWOs }] = await Promise.all([
    admin
      .from('meter_readings')
      .select('asset_id, unit, value, recorded_at')
      .in('asset_id', assetIds)
      .order('recorded_at', { ascending: false }),
    admin
      .from('issues')
      .select('asset_id, status')
      .in('asset_id', assetIds)
      .in('status', ['open', 'acknowledged', 'in_progress']),
    admin
      .from('work_orders')
      .select('id, asset_id, status')
      .in('asset_id', assetIds)
      .in('status', ['open', 'in_progress']),
  ]);

  // Latest meter per (asset, unit) — exploit that we ordered desc above.
  const latestByAsset = new Map();
  for (const m of meters || []) {
    const bucket = latestByAsset.get(m.asset_id) || {};
    if (!bucket[m.unit]) {
      bucket[m.unit] = { value: m.value, recorded_at: m.recorded_at };
      latestByAsset.set(m.asset_id, bucket);
    }
  }

  // Open issue count per asset.
  const issueCount = new Map();
  for (const i of issues || []) {
    issueCount.set(i.asset_id, (issueCount.get(i.asset_id) || 0) + 1);
  }

  // Active inspections per asset (via the WOs we just pulled).
  const woIds = (openWOs || []).map((w) => w.id);
  const insps = woIds.length
    ? (await admin
        .from('work_order_inspections')
        .select('work_order_id')
        .in('work_order_id', woIds)
        .is('completed_at', null)).data || []
    : [];
  const woAsset = new Map((openWOs || []).map((w) => [w.id, w.asset_id]));
  const inspCount = new Map();
  for (const i of insps) {
    const aid = woAsset.get(i.work_order_id);
    if (aid) inspCount.set(aid, (inspCount.get(aid) || 0) + 1);
  }

  const decorated = rows.map((r) => {
    const m = latestByAsset.get(r.id) || {};
    const isReefer =
      r.type === 'reefer' ||
      (r.type === 'trailer' &&
        String(r.metadata?.equipment_type || '').toLowerCase() === 'reefer');
    const meterUnit = r.type === 'truck' ? 'miles' : isReefer ? 'hours' : null;
    const latest = meterUnit ? m[meterUnit] : null;
    return {
      unit_number: r.unit_number,
      type: r.type,
      make: r.make,
      model: r.model,
      year: r.year,
      vin: r.vin,
      active: r.active,
      latest_meter: latest
        ? { value: latest.value, unit: meterUnit, recorded_at: latest.recorded_at }
        : null,
      open_issue_count: issueCount.get(r.id) || 0,
      active_inspection_count: inspCount.get(r.id) || 0,
    };
  });

  res.json({ assets: decorated });
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

    // Resolve asset id first so we can scope inspections by work_order_id.
    const { data: assetRow } = await admin
      .from('assets')
      .select('id')
      .ilike('unit_number', unit)
      .maybeSingle();
    const assetId = assetRow?.id;

    const [woRes, issuesRes, inspRes] = await Promise.all([
      admin
        .from('work_orders')
        .select(
          `id, asset_unit_number, status, summary, started_at, completed_at,
           approval_status, approved_at, approval_notes, voided_at, void_reason,
           display_seq,
           opening_meter:meter_readings!work_orders_opening_meter_reading_id_fkey
             ( value, unit, source, recorded_at ),
           action_photos ( id, storage_path, caption, uploaded_at ),
           user:users!work_orders_user_id_fkey ( id, full_name, role, handle ),
           items:work_order_items (
             id, sequence, source, source_issue_id, source_pm_schedule_id,
             source_campaign_assignment_id, type, title, description, raw_input,
             status, notes, skipped_reason, completed_at, completed_by_user_id,
             inspection_template_id, inspection_result
           )`,
        )
        .ilike('asset_unit_number', unit)
        .order('started_at', { ascending: false })
        .limit(limit),
      admin
        .from('issues')
        .select(
          `id, asset_unit_number, title, description, raw_input, status,
           reported_at, resolved_at, dismissed_at, dismiss_reason, display_seq,
           resolved_by_work_order_item_id,
           reporter:users!issues_reported_by_fkey ( id, full_name, role, handle )`,
        )
        .ilike('asset_unit_number', unit)
        .order('reported_at', { ascending: false })
        .limit(limit),
      assetId
        ? admin
            .from('work_order_inspections')
            .select(
              `id, work_order_id, template_id, started_at, completed_at,
               technician_signed_at, supervisor_signed_at, notes, display_seq,
               template:inspection_templates ( id, name, scope ),
               started_by_user:users!work_order_inspections_started_by_fkey ( id, full_name, handle )`,
            )
            .in(
              'work_order_id',
              (
                await admin
                  .from('work_orders')
                  .select('id')
                  .eq('asset_id', assetId)
                  .order('started_at', { ascending: false })
                  .limit(limit)
              ).data?.map((w) => w.id) || ['00000000-0000-0000-0000-000000000000'],
            )
            .order('started_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (woRes.error) return res.status(500).json({ error: woRes.error.message });
    if (issuesRes.error) return res.status(500).json({ error: issuesRes.error.message });
    if (inspRes.error) return res.status(500).json({ error: inspRes.error.message });

    const rows = woRes.data ?? [];
    const issues = issuesRes.data ?? [];
    const inspections = inspRes.data ?? [];

    // Compute fail count per inspection on the fly from items we already pulled.
    const failsByInsp = new Map();
    const passesByInsp = new Map();
    for (const wo of rows) {
      for (const it of wo.items || []) {
        if (!it.inspection_template_id) continue;
        const key = `${wo.id}|${it.inspection_template_id}`;
        if (it.inspection_result === 'fail' || it.inspection_result === 'no') {
          failsByInsp.set(key, (failsByInsp.get(key) || 0) + 1);
        } else if (it.inspection_result === 'pass' || it.inspection_result === 'yes') {
          passesByInsp.set(key, (passesByInsp.get(key) || 0) + 1);
        }
      }
    }
    const inspectionsDecorated = inspections.map((i) => {
      const k = `${i.work_order_id}|${i.template_id}`;
      return {
        ...i,
        pass_count: passesByInsp.get(k) || 0,
        fail_count: failsByInsp.get(k) || 0,
      };
    });

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
      inspections: inspectionsDecorated,
    });
  },
);
