// /api/admin/pm-schedules/* — PM schedule CRUD.
//
//   GET    /api/admin/pm-schedules            list w/ status (overdue / due_soon / ok)
//   POST   /api/admin/pm-schedules            create
//   PATCH  /api/admin/pm-schedules/:id        update
//   DELETE /api/admin/pm-schedules/:id        delete
//
// Admin-only via requireAuth + requireAdmin.

import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';

export const adminPmSchedulesRouter = Router();
adminPmSchedulesRouter.use(requireAuth, requireAdmin);

const VALID_SCOPES = new Set(['truck', 'trailer_body', 'reefer_unit', 'other']);
const VALID_CADENCES = new Set(['miles', 'hours', 'months']);

// Status thresholds for "due soon" by cadence.
const DUE_SOON_MILES = 500;
const DUE_SOON_HOURS = 100;
const DUE_SOON_DAYS = 14;

function monthsBetween(fromIso, toDate = new Date()) {
  const from = new Date(fromIso);
  const ms = toDate.getTime() - from.getTime();
  return ms / (1000 * 60 * 60 * 24 * 30.44); // average month length
}

function statusFor({ cadence_type, interval_miles, interval_hours, interval_months,
                     last_completed_miles, last_completed_hours, last_completed_at,
                     current_miles, current_hours }) {
  // If we have no "last completed" yet, the schedule is "new" — surface
  // it as due_soon so admins seed it.
  if (cadence_type === 'miles') {
    if (last_completed_miles == null) return { status: 'unseeded', units_remaining: null };
    if (current_miles == null) return { status: 'unknown', units_remaining: null };
    const next = last_completed_miles + interval_miles;
    const remaining = next - current_miles;
    return {
      status: remaining < 0 ? 'overdue' : remaining < DUE_SOON_MILES ? 'due_soon' : 'ok',
      next_due_value: next,
      current_value: current_miles,
      units_remaining: remaining,
    };
  }
  if (cadence_type === 'hours') {
    if (last_completed_hours == null) return { status: 'unseeded', units_remaining: null };
    if (current_hours == null) return { status: 'unknown', units_remaining: null };
    const next = last_completed_hours + interval_hours;
    const remaining = next - current_hours;
    return {
      status: remaining < 0 ? 'overdue' : remaining < DUE_SOON_HOURS ? 'due_soon' : 'ok',
      next_due_value: next,
      current_value: current_hours,
      units_remaining: remaining,
    };
  }
  // months
  if (last_completed_at == null) return { status: 'unseeded', units_remaining: null };
  const elapsedMonths = monthsBetween(last_completed_at);
  const remainingMonths = interval_months - elapsedMonths;
  const remainingDays = remainingMonths * 30.44;
  const nextDueDate = new Date(last_completed_at);
  nextDueDate.setMonth(nextDueDate.getMonth() + interval_months);
  return {
    status:
      remainingDays < 0 ? 'overdue' : remainingDays < DUE_SOON_DAYS ? 'due_soon' : 'ok',
    next_due_at: nextDueDate.toISOString(),
    units_remaining: Math.round(remainingDays),
  };
}

// ---- GET /api/admin/pm-schedules -------------------------------------------
adminPmSchedulesRouter.get('/api/admin/pm-schedules', async (req, res) => {
  const admin = getSupabaseAdmin();

  // 1. All active schedules + their asset
  const { data: rows, error } = await admin
    .from('pm_schedules')
    .select(
      `id, asset_id, scope, name, cadence_type,
       interval_miles, interval_hours, interval_months,
       last_completed_at, last_completed_miles, last_completed_hours,
       last_completed_work_order_id,
       anchor_mode, active, notes, created_at, updated_at,
       asset:assets ( id, unit_number, type )`,
    )
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) return res.status(500).json({ error: error.message });

  // 2. Latest meter_readings per asset to compute status. Single query
  // pulled across all assets, then bucketed in JS.
  const assetIds = Array.from(new Set((rows ?? []).map((r) => r.asset_id))).filter(Boolean);
  const latestByAsset = new Map(); // assetId -> { miles?, hours? }
  if (assetIds.length > 0) {
    const { data: meters } = await admin
      .from('meter_readings')
      .select('asset_id, unit, value, recorded_at')
      .in('asset_id', assetIds)
      .order('recorded_at', { ascending: false });
    for (const m of meters ?? []) {
      const bucket = latestByAsset.get(m.asset_id) || {};
      if (m.unit === 'miles' && bucket.miles == null) bucket.miles = m.value;
      if (m.unit === 'hours' && bucket.hours == null) bucket.hours = m.value;
      latestByAsset.set(m.asset_id, bucket);
    }
  }

  const decorated = (rows ?? []).map((r) => {
    const latest = latestByAsset.get(r.asset_id) || {};
    return {
      ...r,
      ...statusFor({
        cadence_type: r.cadence_type,
        interval_miles: r.interval_miles,
        interval_hours: r.interval_hours,
        interval_months: r.interval_months,
        last_completed_miles: r.last_completed_miles,
        last_completed_hours: r.last_completed_hours,
        last_completed_at: r.last_completed_at,
        current_miles: latest.miles ?? null,
        current_hours: latest.hours ?? null,
      }),
    };
  });

  res.json({ pm_schedules: decorated, count: decorated.length });
});

// ---- POST /api/admin/pm-schedules ------------------------------------------
adminPmSchedulesRouter.post('/api/admin/pm-schedules', async (req, res) => {
  const {
    asset_unit_number,
    scope,
    name,
    cadence_type,
    interval_miles,
    interval_hours,
    interval_months,
    last_completed_at,
    last_completed_miles,
    last_completed_hours,
    anchor_mode,
    notes,
  } = req.body || {};

  if (!VALID_SCOPES.has(scope)) return res.status(400).json({ error: 'invalid_scope' });
  if (!VALID_CADENCES.has(cadence_type)) return res.status(400).json({ error: 'invalid_cadence' });
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name_required' });
  }

  const admin = getSupabaseAdmin();
  const { data: asset } = await admin
    .from('assets')
    .select('id, unit_number')
    .ilike('unit_number', asset_unit_number || '')
    .maybeSingle();
  if (!asset) return res.status(400).json({ error: 'asset_not_found' });

  // Exactly one interval column matches cadence_type (DB trigger enforces too)
  const insert = {
    asset_id: asset.id,
    scope,
    name: name.trim(),
    cadence_type,
    interval_miles: cadence_type === 'miles' ? Number(interval_miles) : null,
    interval_hours: cadence_type === 'hours' ? Number(interval_hours) : null,
    interval_months: cadence_type === 'months' ? Number(interval_months) : null,
    last_completed_at: last_completed_at || null,
    last_completed_miles: last_completed_miles ?? null,
    last_completed_hours: last_completed_hours ?? null,
    anchor_mode: anchor_mode || 'anchored',
    notes: notes || null,
  };

  const { data, error } = await admin
    .from('pm_schedules')
    .insert(insert)
    .select('id, name')
    .single();
  if (error) return res.status(500).json({ error: error.message });

  await admin.from('audit_log').insert({
    actor_user_id: req.user.id,
    action: 'pm_schedule_create',
    target_table: 'pm_schedules',
    target_id: data.id,
    after: { asset_unit_number: asset.unit_number, name, cadence_type },
  });

  res.status(201).json({ pm_schedule: data });
});

// ---- PATCH /api/admin/pm-schedules/:id -------------------------------------
const PATCH_FIELDS = new Set([
  'name',
  'interval_miles',
  'interval_hours',
  'interval_months',
  'last_completed_at',
  'last_completed_miles',
  'last_completed_hours',
  'anchor_mode',
  'active',
  'notes',
]);

adminPmSchedulesRouter.patch('/api/admin/pm-schedules/:id', async (req, res) => {
  const update = {};
  for (const k of Object.keys(req.body || {})) {
    if (PATCH_FIELDS.has(k)) update[k] = req.body[k];
  }
  if (Object.keys(update).length === 0) {
    return res.status(400).json({ error: 'no_fields_to_update' });
  }
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('pm_schedules')
    .update(update)
    .eq('id', req.params.id)
    .select('id')
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'not_found' });

  await admin.from('audit_log').insert({
    actor_user_id: req.user.id,
    action: 'pm_schedule_update',
    target_table: 'pm_schedules',
    target_id: req.params.id,
    after: update,
  });

  res.json({ pm_schedule: data });
});

// ---- DELETE /api/admin/pm-schedules/:id ------------------------------------
adminPmSchedulesRouter.delete('/api/admin/pm-schedules/:id', async (req, res) => {
  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from('pm_schedules')
    .delete()
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });

  await admin.from('audit_log').insert({
    actor_user_id: req.user.id,
    action: 'pm_schedule_delete',
    target_table: 'pm_schedules',
    target_id: req.params.id,
  });

  res.status(204).end();
});
