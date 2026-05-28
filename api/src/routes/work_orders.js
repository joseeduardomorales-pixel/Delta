// /api/work-orders — sessions of work on an asset.
//
//   POST   /api/work-orders                        open a new WO
//   GET    /api/work-orders/:id                    fetch incl. items
//   POST   /api/work-orders/:id/items              add a line item
//   PATCH  /api/work-orders/:id/items/:itemId      update an item (complete/skip/edit)
//   POST   /api/work-orders/:id/close              mark WO completed
//   POST   /api/work-orders/:id/void               void (within grace)
//
// Helper:
//   GET    /api/work-orders/pending-for/:unit      pending issues + due PMs +
//                                                   applicable campaigns for an asset
//                                                   (used by the chat picker)

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';
import { attachStagingToWorkOrder } from '../services/storage.js';
import {
  resolveAssetWithMeter,
  insertManualMeter,
  cascadeCompleteItem,
  computePmDue,
} from '../services/workOrderHelpers.js';
import { logger } from '../logger.js';

export const workOrdersRouter = Router();

const VALID_ITEM_SOURCES = new Set(['issue', 'pm_schedule', 'campaign_assignment', 'ad_hoc']);
const VALID_ITEM_TYPES = new Set(['pm', 'repair', 'inspection', 'other']);
const VALID_ITEM_STATUSES = new Set(['pending', 'done', 'skipped']);

// ----- POST /api/work-orders ---------------------------------------------
// Open a new WO. Body:
//   {
//     asset_unit_number: string,
//     manual_meter_value?: number,    // when telematics is stale
//     manual_meter_unit?: 'miles'|'hours'
//   }
//
// Behavior:
//   1. Resolve the asset + figure out which meter unit applies.
//   2. If telematics has a fresh reading, use it.
//   3. If not and the caller didn't provide a manual_meter_value,
//      respond 409 needs_meter with the last-known reading so the
//      caller (chat or UI) can prompt for a value.
//   4. Otherwise, insert a meter_readings row (source='manual') and link.
workOrdersRouter.post('/api/work-orders', requireAuth, async (req, res) => {
  try {
    const { asset_unit_number, manual_meter_value, manual_meter_unit } = req.body || {};
    if (typeof asset_unit_number !== 'string' || !asset_unit_number.trim()) {
      return res.status(400).json({ error: 'asset_unit_number_required' });
    }
    if (req.user.role === 'dispatcher') {
      return res.status(403).json({ error: 'dispatchers_dont_open_work_orders' });
    }

    const admin = getSupabaseAdmin();
    const unit = asset_unit_number.trim().toUpperCase();
    const { asset, meter, meter_unit, last_known, needs_meter } =
      await resolveAssetWithMeter(admin, unit);
    if (!asset) return res.status(404).json({ error: 'asset_not_found' });

    let opening_meter_reading_id = meter?.id ?? null;

    if (needs_meter) {
      if (manual_meter_value == null) {
        return res.status(409).json({
          error: 'needs_meter',
          meter_unit,
          last_known: last_known
            ? {
                value: last_known.value,
                recorded_at: last_known.recorded_at,
                source: last_known.source,
              }
            : null,
          message:
            meter_unit === 'miles'
              ? `No fresh odometer for ${unit}. What's the current mileage?`
              : `No fresh reefer hours for ${unit}. What's the engine hour meter?`,
        });
      }
      const u = manual_meter_unit || meter_unit;
      if (u !== meter_unit) {
        return res.status(400).json({
          error: 'meter_unit_mismatch',
          expected: meter_unit,
          got: u,
        });
      }
      try {
        const mr = await insertManualMeter({
          admin,
          assetId: asset.id,
          unit: meter_unit,
          value: manual_meter_value,
          userId: req.user.id,
        });
        opening_meter_reading_id = mr.id;
      } catch (e) {
        if (e.message === 'invalid_meter_value') {
          return res.status(400).json({ error: 'invalid_manual_meter_value' });
        }
        logger.error({ err: e.message }, 'open WO: manual meter insert failed');
        return res.status(500).json({ error: e.message });
      }
    }

    const { data: wo, error: woErr } = await admin
      .from('work_orders')
      .insert({
        asset_id: asset.id,
        asset_unit_number: asset.unit_number,
        user_id: req.user.id,
        status: 'open',
        approval_status: 'pending_review',
        opening_meter_reading_id,
      })
      .select(
        'id, asset_id, asset_unit_number, status, started_at, opening_meter_reading_id',
      )
      .single();
    if (woErr) return res.status(500).json({ error: woErr.message });

    res.status(201).json({
      work_order: { ...wo, short_id: wo.id.slice(0, 8) },
      opening_meter: meter
        ? {
            value: meter.value,
            unit: meter_unit,
            source: meter.source,
            recorded_at: meter.recorded_at,
          }
        : { value: Number(manual_meter_value), unit: meter_unit, source: 'manual' },
    });
  } catch (e) {
    logger.error({ err: e.message }, 'open WO: unhandled');
    res.status(500).json({ error: 'open_failed' });
  }
});

// ----- GET /api/work-orders ----------------------------------------------
// Paginated WO list with filters.
//   ?status=open,in_progress,completed,voided  (default: open + in_progress)
//   ?mine=1     restrict to caller's own WOs (default for non-admin)
//   ?limit=50
//
// Admins see all WOs; tech/dispatcher see their own.
workOrdersRouter.get('/api/work-orders', requireAuth, async (req, res) => {
  const admin = getSupabaseAdmin();
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const statuses = req.query.status
    ? String(req.query.status).split(',').map((s) => s.trim()).filter(Boolean)
    : ['open', 'in_progress'];
  const forceMine = req.query.mine === '1';
  const isAdmin = req.user.role === 'admin';

  let q = admin
    .from('work_orders')
    .select(
      `id, asset_unit_number, status, summary, started_at, completed_at,
       approval_status, voided_at, display_seq,
       user:users!work_orders_user_id_fkey ( id, full_name, role, handle ),
       opening_meter:meter_readings!work_orders_opening_meter_reading_id_fkey
         ( value, unit ),
       items:work_order_items ( id, status, inspection_result )`,
    )
    .in('status', statuses)
    .order('started_at', { ascending: false })
    .limit(limit);

  // Non-admins only see their own WOs. Admins can opt in via ?mine=1.
  if (!isAdmin || forceMine) {
    q = q.eq('user_id', req.user.id);
  }

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Compute compact per-WO counts.
  const decorated = (data || []).map((wo) => {
    const items = wo.items || [];
    let done = 0, pending = 0, fail = 0;
    for (const it of items) {
      if (it.status === 'done') done += 1;
      if (it.status === 'pending') pending += 1;
      if (it.inspection_result === 'fail' || it.inspection_result === 'no') fail += 1;
    }
    return {
      ...wo,
      items: undefined,
      item_count: items.length,
      done_count: done,
      pending_count: pending,
      fail_count: fail,
    };
  });
  res.json({ work_orders: decorated, count: decorated.length });
});

// ----- GET /api/work-orders/:id ------------------------------------------
workOrdersRouter.get('/api/work-orders/:id', requireAuth, async (req, res) => {
  const admin = getSupabaseAdmin();
  const { data: wo, error } = await admin
    .from('work_orders')
    .select(
      `id, asset_id, asset_unit_number, user_id, status,
       opening_meter_reading_id, summary, started_at, completed_at,
       voided_at, void_reason, approval_status, approval_notes, display_seq,
       opening_meter:meter_readings!work_orders_opening_meter_reading_id_fkey
         ( value, unit, source, recorded_at ),
       user:users!work_orders_user_id_fkey ( id, full_name, role, handle ),
       items:work_order_items (
         id, sequence, source, source_issue_id, source_pm_schedule_id,
         source_campaign_assignment_id, type, title, description,
         status, notes, completed_at, completed_by_user_id
       )`,
    )
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!wo) return res.status(404).json({ error: 'not_found' });
  res.json({ work_order: wo });
});

// ----- GET /api/work-orders/pending-for/:unit ----------------------------
// Returns the pick-list for a given asset: open issues + due/overdue PMs +
// applicable open campaign_assignments. Each entry has a `pick_token` the
// caller passes back when adding it as a WO item.
workOrdersRouter.get(
  '/api/work-orders/pending-for/:unit',
  requireAuth,
  async (req, res) => {
    const admin = getSupabaseAdmin();
    const unit = req.params.unit.toUpperCase();
    const { data: asset } = await admin
      .from('assets')
      .select('id, unit_number, type, metadata')
      .ilike('unit_number', unit)
      .maybeSingle();
    if (!asset) return res.status(404).json({ error: 'asset_not_found' });

    // Open issues for this asset
    const { data: issues } = await admin
      .from('issues')
      .select('id, title, description, status, reported_at, reporter:users!issues_reported_by_fkey(full_name)')
      .eq('asset_id', asset.id)
      .in('status', ['open', 'acknowledged', 'in_progress'])
      .order('reported_at', { ascending: false });

    // PM schedules for this asset (active only)
    const { data: pms } = await admin
      .from('pm_schedules')
      .select(
        `id, name, scope, cadence_type, interval_miles, interval_hours, interval_months,
         last_completed_at, last_completed_miles, last_completed_hours`,
      )
      .eq('asset_id', asset.id)
      .eq('active', true);

    // Latest meter readings for status calc
    const { data: meters } = await admin
      .from('meter_readings')
      .select('unit, value, recorded_at')
      .eq('asset_id', asset.id)
      .order('recorded_at', { ascending: false })
      .limit(20);
    const latestMiles = meters?.find((m) => m.unit === 'miles')?.value ?? null;
    const latestHours = meters?.find((m) => m.unit === 'hours')?.value ?? null;

    // Compute status for each PM
    const pmList = (pms || []).map((pm) => {
      const { due, next_at } = computePmDue(pm, latestMiles, latestHours);
      return {
        ...pm,
        due,
        next_at,
        current_miles: latestMiles,
        current_hours: latestHours,
      };
    });

    // Applicable open campaign_assignments
    const { data: assignments } = await admin
      .from('campaign_assignments')
      .select(
        `id, status, campaign:campaigns ( id, name, description, status, ends_at )`,
      )
      .eq('asset_id', asset.id)
      .eq('status', 'open');
    const applicableCampaigns = (assignments || []).filter(
      (a) => a.campaign?.status === 'active',
    );

    res.json({
      asset_unit_number: asset.unit_number,
      issues: issues || [],
      pm_schedules: pmList.filter((p) => p.due === 'overdue' || p.due === 'due_soon'),
      pm_schedules_all: pmList,
      campaigns: applicableCampaigns,
    });
  },
);

// ----- POST /api/work-orders/:id/items -----------------------------------
// Add a line item. Body:
//   {
//     source: 'issue' | 'pm_schedule' | 'campaign_assignment' | 'ad_hoc',
//     source_id?: uuid,    // required when source != 'ad_hoc'
//     type: 'pm' | 'repair' | 'inspection' | 'other',
//     title: string,
//     description?: string,
//     raw_input?: string,
//   }
workOrdersRouter.post('/api/work-orders/:id/items', requireAuth, async (req, res) => {
  try {
    const { source, source_id, type, title, description, raw_input } = req.body || {};
    if (!VALID_ITEM_SOURCES.has(source)) {
      return res.status(400).json({ error: 'invalid_source' });
    }
    if (!VALID_ITEM_TYPES.has(type)) {
      return res.status(400).json({ error: 'invalid_type' });
    }
    if (typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'title_required' });
    }
    if (source !== 'ad_hoc' && !source_id) {
      return res.status(400).json({ error: 'source_id_required_for_non_ad_hoc' });
    }

    const admin = getSupabaseAdmin();
    // Confirm WO exists and is open
    const { data: wo } = await admin
      .from('work_orders')
      .select('id, user_id, status')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!wo) return res.status(404).json({ error: 'work_order_not_found' });
    if (wo.status !== 'open' && wo.status !== 'in_progress') {
      return res.status(409).json({ error: `wo_status_${wo.status}` });
    }

    // Compute next sequence
    const { data: maxSeq } = await admin
      .from('work_order_items')
      .select('sequence')
      .eq('work_order_id', req.params.id)
      .order('sequence', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextSeq = (maxSeq?.sequence ?? -1) + 1;

    const insert = {
      work_order_id: req.params.id,
      sequence: nextSeq,
      source,
      source_issue_id: source === 'issue' ? source_id : null,
      source_pm_schedule_id: source === 'pm_schedule' ? source_id : null,
      source_campaign_assignment_id: source === 'campaign_assignment' ? source_id : null,
      type,
      title: title.trim(),
      description: description?.trim() || null,
      raw_input: raw_input?.trim() || null,
      status: 'pending',
    };

    const { data, error } = await admin
      .from('work_order_items')
      .insert(insert)
      .select(
        'id, sequence, source, source_issue_id, source_pm_schedule_id, source_campaign_assignment_id, type, title, status',
      )
      .single();
    if (error) return res.status(500).json({ error: error.message });

    // Side effect: if linking to an issue, acknowledge it.
    if (source === 'issue') {
      await admin
        .from('issues')
        .update({ status: 'in_progress' })
        .eq('id', source_id)
        .eq('status', 'open');
    }

    // Bump WO status from 'open' to 'in_progress' on first item.
    if (wo.status === 'open') {
      await admin
        .from('work_orders')
        .update({ status: 'in_progress' })
        .eq('id', req.params.id);
    }

    res.status(201).json({ item: data });
  } catch (e) {
    logger.error({ err: e.message }, 'add WO item: unhandled');
    res.status(500).json({ error: 'add_failed' });
  }
});

// ----- PATCH /api/work-orders/:id/items/:itemId --------------------------
// Update item — typically: status='done' with notes. Side effects:
//   - If status flips to 'done' and source='pm_schedule' → update the
//     pm_schedule's last_completed_* fields from the WO's opening meter.
//   - If status flips to 'done' and source='issue' → mark issue resolved
//     and back-point to this item.
//   - If status flips to 'done' and source='campaign_assignment' → mark
//     assignment completed.
workOrdersRouter.patch(
  '/api/work-orders/:id/items/:itemId',
  requireAuth,
  async (req, res) => {
    try {
      const { status, notes, title, description, skipped_reason, attachments } =
        req.body || {};
      const admin = getSupabaseAdmin();
      const update = {};
      if (status && VALID_ITEM_STATUSES.has(status)) update.status = status;
      if (typeof notes === 'string') update.notes = notes.trim();
      if (typeof title === 'string' && title.trim()) update.title = title.trim();
      if (typeof description === 'string') update.description = description.trim();
      if (status === 'skipped' && typeof skipped_reason === 'string') {
        update.skipped_reason = skipped_reason.trim();
      }
      if (Object.keys(update).length === 0) {
        return res.status(400).json({ error: 'no_fields_to_update' });
      }

      const { data: before } = await admin
        .from('work_order_items')
        .select(
          'id, work_order_id, source, source_issue_id, source_pm_schedule_id, source_campaign_assignment_id, status',
        )
        .eq('id', req.params.itemId)
        .eq('work_order_id', req.params.id)
        .maybeSingle();
      if (!before) return res.status(404).json({ error: 'item_not_found' });

      // If transitioning to 'done', stamp completion fields.
      if (status === 'done') {
        update.completed_at = new Date().toISOString();
        update.completed_by_user_id = req.user.id;

        // Snapshot the WO's opening meter to the item if not already linked.
        const { data: wo } = await admin
          .from('work_orders')
          .select('opening_meter_reading_id')
          .eq('id', req.params.id)
          .maybeSingle();
        if (wo?.opening_meter_reading_id) {
          update.meter_reading_id = wo.opening_meter_reading_id;
        }
      }

      const { data: after, error } = await admin
        .from('work_order_items')
        .update(update)
        .eq('id', req.params.itemId)
        .select(
          'id, work_order_id, source, source_issue_id, source_pm_schedule_id, source_campaign_assignment_id, status, completed_at, meter_reading_id',
        )
        .single();
      if (error) return res.status(500).json({ error: error.message });

      // ---- Side-effect cascade for "done" transitions ----
      if (status === 'done' && before.status !== 'done') {
        let openingMeter = null;
        if (after.meter_reading_id) {
          const { data: mr } = await admin
            .from('meter_readings')
            .select('value, unit, recorded_at')
            .eq('id', after.meter_reading_id)
            .maybeSingle();
          openingMeter = mr ?? null;
        }
        await cascadeCompleteItem({
          admin,
          item: {
            id: after.id,
            source: before.source,
            source_issue_id: before.source_issue_id,
            source_pm_schedule_id: before.source_pm_schedule_id,
            source_campaign_assignment_id: before.source_campaign_assignment_id,
          },
          openingMeterReading: openingMeter,
        });
      }

      // ---- Photos: attach any new staged photos to this WO ----
      const attachedPhotos = [];
      if (Array.isArray(attachments) && attachments.length > 0) {
        for (const a of attachments) {
          if (!a?.staging_path) continue;
          try {
            const photo = await attachStagingToWorkOrder({
              stagingPath: a.staging_path,
              workOrderId: req.params.id,
              uploadedBy: req.user.id,
              caption: a.caption || null,
            });
            attachedPhotos.push({ id: photo.id });
          } catch (e) {
            logger.warn(
              { err: e.message, staging_path: a.staging_path },
              'WO item: photo attach failed',
            );
          }
        }
      }

      res.json({ item: after, attachedPhotos });
    } catch (e) {
      logger.error({ err: e.message }, 'patch WO item: unhandled');
      res.status(500).json({ error: 'patch_failed' });
    }
  },
);

// ----- POST /api/work-orders/:id/close -----------------------------------
// Closes the WO. Any items still 'pending' at close time are marked
// 'skipped' with reason 'wo_closed_with_pending', AND their upstream
// links (issue / pm_schedule / campaign_assignment) are reverted to
// their pre-WO state so another tech can pick them up:
//   - issue.status: 'in_progress' → 'open'  (the issue was bumped to
//     in_progress when the item was added; revert it now)
//   - pm_schedule: no change (PM doesn't have a per-WO state)
//   - campaign_assignment.status: 'open' (it was never flipped, so no-op
//     here unless we added that on item-add — we didn't)
workOrdersRouter.post(
  '/api/work-orders/:id/close',
  requireAuth,
  async (req, res) => {
    const { summary } = req.body || {};
    const admin = getSupabaseAdmin();
    const { data: wo } = await admin
      .from('work_orders')
      .select('id, user_id, status')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!wo) return res.status(404).json({ error: 'not_found' });
    if (wo.status === 'completed') {
      return res.status(409).json({ error: 'already_completed' });
    }

    // 1) Find pending items on this WO.
    const { data: pendingItems } = await admin
      .from('work_order_items')
      .select('id, source, source_issue_id')
      .eq('work_order_id', req.params.id)
      .eq('status', 'pending');

    const revertedIssueIds = [];
    if (pendingItems?.length) {
      // 2) Skip the items.
      const ids = pendingItems.map((it) => it.id);
      await admin
        .from('work_order_items')
        .update({
          status: 'skipped',
          skipped_reason: 'wo_closed_with_pending',
        })
        .in('id', ids);

      // 3) Revert linked issues back to 'open' so they re-appear in the
      //    asset's open-issues list. Only flip issues currently
      //    'in_progress' (don't touch ones that were already manually
      //    moved to a different state by an admin).
      const issueIds = pendingItems
        .filter((it) => it.source === 'issue' && it.source_issue_id)
        .map((it) => it.source_issue_id);
      if (issueIds.length) {
        const { data: reverted } = await admin
          .from('issues')
          .update({ status: 'open' })
          .in('id', issueIds)
          .eq('status', 'in_progress')
          .select('id');
        for (const r of reverted || []) revertedIssueIds.push(r.id);
      }
    }

    // 4) Close the WO itself.
    const { data, error } = await admin
      .from('work_orders')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        summary: summary?.trim() || null,
      })
      .eq('id', req.params.id)
      .select('id, status, completed_at, summary')
      .single();
    if (error) return res.status(500).json({ error: error.message });

    res.json({
      work_order: data,
      skipped_item_count: pendingItems?.length || 0,
      reverted_issue_ids: revertedIssueIds,
    });
  },
);

// ----- POST /api/work-orders/:id/void ------------------------------------
const GRACE_MS = 5 * 60 * 1000;
workOrdersRouter.post('/api/work-orders/:id/void', requireAuth, async (req, res) => {
  const { reason } = req.body || {};
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('work_orders')
    .update({
      status: 'voided',
      voided_at: new Date().toISOString(),
      voided_by: req.user.id,
      void_reason: reason?.trim() || 'undo',
    })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .gt('started_at', new Date(Date.now() - GRACE_MS).toISOString())
    .neq('status', 'voided')
    .select('id, status, voided_at, void_reason')
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) {
    return res
      .status(409)
      .json({ error: 'cannot_void_outside_grace_or_not_owner' });
  }
  res.json({ work_order: data });
});
