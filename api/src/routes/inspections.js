// /api/inspections + /api/work-orders/:id/inspections
// --------------------------------------------------------------------------
// Templates are admin-managed (CRUD lives under /api/admin/inspection-templates
// in a later iteration; for now we ship one seeded template). Techs CONSUME
// templates by starting an inspection on an open WO, which materializes one
// work_order_items row per template item, then PATCHing each item with a
// pass/fail/na result as they walk the asset.
//
// Endpoints:
//   GET    /api/inspection-templates                      list active templates
//   GET    /api/inspection-templates/:id                  template + items
//   POST   /api/work-orders/:woId/inspections             start inspection on a WO
//   GET    /api/work-orders/:woId/inspections             list inspections on a WO
//   GET    /api/inspections/:id                           full inspection state
//   PATCH  /api/inspections/:id/items/:itemId             mark one item's result
//   POST   /api/inspections/:id/complete                  finalize + tech signature
//
// Fail cascade: when an item is set to inspection_result='fail' (or yes_no
// with the WRONG answer), the patch handler auto-creates an issue on the
// parent WO's asset so it shows up in future pending-pickers.

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';
import { attachStagingToWorkOrder, signedReadUrl, deletePhotoById } from '../services/storage.js';
import { logger } from '../logger.js';

export const inspectionsRouter = Router();

// ───── GET /api/inspections/mine ────────────────────────────────────────────
// Returns the caller's IN-PROGRESS inspections (completed_at IS NULL) so the
// Chat screen can render a "Resume" banner. Includes progress counts.
inspectionsRouter.get('/api/inspections/mine', requireAuth, async (req, res) => {
  const admin = getSupabaseAdmin();
  const onlyOpen = req.query.open !== '0';

  let q = admin
    .from('work_order_inspections')
    .select(
      `id, work_order_id, template_id, started_at, completed_at, display_seq,
       template:inspection_templates ( id, name, scope ),
       work_order:work_orders ( id, asset_unit_number, status, display_seq,
         user:users!work_orders_user_id_fkey ( handle ) )`,
    )
    .eq('started_by', req.user.id)
    .order('started_at', { ascending: false })
    .limit(20);
  if (onlyOpen) q = q.is('completed_at', null);

  const { data: insps, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  if (!insps?.length) return res.json({ inspections: [] });

  // Per-inspection progress: count items by status/result.
  const woIds = [...new Set(insps.map((i) => i.work_order_id))];
  const tplIds = [...new Set(insps.map((i) => i.template_id))];
  const { data: items } = await admin
    .from('work_order_items')
    .select('work_order_id, inspection_template_id, status, inspection_result')
    .in('work_order_id', woIds)
    .in('inspection_template_id', tplIds);

  const decorated = insps.map((i) => {
    const own = (items || []).filter(
      (it) =>
        it.work_order_id === i.work_order_id &&
        it.inspection_template_id === i.template_id,
    );
    const total = own.length;
    const done = own.filter((it) => it.status === 'done').length;
    const fail = own.filter(
      (it) => it.inspection_result === 'fail' || it.inspection_result === 'no',
    ).length;
    return { ...i, total, done, fail };
  });

  res.json({ inspections: decorated });
});

// ───── GET /api/inspection-templates ─────────────────────────────────────────
inspectionsRouter.get('/api/inspection-templates', requireAuth, async (req, res) => {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('inspection_templates')
    .select('id, name, description, scope, active, created_at')
    .eq('active', true)
    .order('name', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ templates: data });
});

// ───── GET /api/inspection-templates/:id ─────────────────────────────────────
// Returns the template + all items grouped by section.
inspectionsRouter.get('/api/inspection-templates/:id', requireAuth, async (req, res) => {
  const admin = getSupabaseAdmin();
  const [{ data: tpl, error: e1 }, { data: items, error: e2 }] = await Promise.all([
    admin
      .from('inspection_templates')
      .select('id, name, description, scope, active')
      .eq('id', req.params.id)
      .maybeSingle(),
    admin
      .from('inspection_template_items')
      .select(
        'id, section, section_sequence, item_sequence, text, kind, good_answer, measurement_unit, measurement_min, measurement_max, required',
      )
      .eq('template_id', req.params.id)
      .order('section_sequence', { ascending: true })
      .order('item_sequence', { ascending: true }),
  ]);
  if (e1) return res.status(500).json({ error: e1.message });
  if (!tpl) return res.status(404).json({ error: 'template_not_found' });
  if (e2) return res.status(500).json({ error: e2.message });
  res.json({ template: tpl, items });
});

// ───── POST /api/work-orders/:woId/inspections ───────────────────────────────
// Materialize one work_order_item per template item.
inspectionsRouter.post(
  '/api/work-orders/:woId/inspections',
  requireAuth,
  async (req, res) => {
    try {
      const { template_id } = req.body || {};
      if (!template_id) return res.status(400).json({ error: 'template_id_required' });
      const admin = getSupabaseAdmin();

      // Verify WO is open / in_progress.
      const { data: wo, error: woErr } = await admin
        .from('work_orders')
        .select('id, status, asset_id, asset_unit_number, user_id')
        .eq('id', req.params.woId)
        .maybeSingle();
      if (woErr) return res.status(500).json({ error: woErr.message });
      if (!wo) return res.status(404).json({ error: 'work_order_not_found' });
      if (!['open', 'in_progress'].includes(wo.status)) {
        return res.status(409).json({ error: `wo_status_${wo.status}` });
      }

      // Refuse if this template was already started on this WO.
      const { data: existing } = await admin
        .from('work_order_inspections')
        .select('id')
        .eq('work_order_id', wo.id)
        .eq('template_id', template_id)
        .maybeSingle();
      if (existing) {
        return res.status(409).json({ error: 'inspection_already_started', inspection_id: existing.id });
      }

      // Fetch template + items.
      const [{ data: tpl }, { data: tplItems }] = await Promise.all([
        admin
          .from('inspection_templates')
          .select('id, name, scope, active')
          .eq('id', template_id)
          .maybeSingle(),
        admin
          .from('inspection_template_items')
          .select('id, section, section_sequence, item_sequence, text, kind')
          .eq('template_id', template_id)
          .order('section_sequence', { ascending: true })
          .order('item_sequence', { ascending: true }),
      ]);
      if (!tpl || !tpl.active) {
        return res.status(404).json({ error: 'template_not_found_or_inactive' });
      }
      if (!tplItems?.length) {
        return res.status(409).json({ error: 'template_has_no_items' });
      }

      // Create the inspection row.
      const { data: insp, error: inspErr } = await admin
        .from('work_order_inspections')
        .insert({
          work_order_id: wo.id,
          template_id: tpl.id,
          started_by: req.user.id,
        })
        .select('id, started_at')
        .single();
      if (inspErr) {
        logger.error({ err: inspErr.message }, 'start inspection: insert insp failed');
        return res.status(500).json({ error: inspErr.message });
      }

      // Compute next sequence for WO items (so we don't collide with ad-hoc ones).
      const { data: maxSeq } = await admin
        .from('work_order_items')
        .select('sequence')
        .eq('work_order_id', wo.id)
        .order('sequence', { ascending: false })
        .limit(1)
        .maybeSingle();
      let nextSeq = (maxSeq?.sequence ?? -1) + 1;

      // Materialize one work_order_item per template item.
      const rows = tplItems.map((ti) => ({
        work_order_id: wo.id,
        sequence: nextSeq++,
        source: 'inspection_template',
        source_inspection_template_item_id: ti.id,
        inspection_template_id: tpl.id,
        type: 'inspection',
        title: ti.text,
        status: 'pending',
      }));
      const { error: itemsErr } = await admin.from('work_order_items').insert(rows);
      if (itemsErr) {
        logger.error({ err: itemsErr.message }, 'start inspection: insert items failed');
        // Roll back the inspection row to keep state consistent.
        await admin.from('work_order_inspections').delete().eq('id', insp.id);
        return res.status(500).json({ error: itemsErr.message });
      }

      // Bump WO to in_progress if it was just 'open'.
      if (wo.status === 'open') {
        await admin
          .from('work_orders')
          .update({ status: 'in_progress' })
          .eq('id', wo.id);
      }

      res.status(201).json({
        inspection: {
          id: insp.id,
          work_order_id: wo.id,
          template_id: tpl.id,
          template_name: tpl.name,
          started_at: insp.started_at,
          item_count: rows.length,
        },
      });
    } catch (e) {
      logger.error({ err: e.message }, 'start inspection: unhandled');
      res.status(500).json({ error: 'start_failed' });
    }
  },
);

// ───── GET /api/work-orders/:woId/inspections ────────────────────────────────
inspectionsRouter.get(
  '/api/work-orders/:woId/inspections',
  requireAuth,
  async (req, res) => {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('work_order_inspections')
      .select(
        `id, template_id, started_at, completed_at, technician_signed_at,
         supervisor_signed_at, notes,
         template:inspection_templates ( id, name, scope )`,
      )
      .eq('work_order_id', req.params.woId)
      .order('started_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ inspections: data });
  },
);

// ───── GET /api/inspections/:id ──────────────────────────────────────────────
// Returns the inspection + all its work_order_items joined with the
// template's section metadata, ready for the form UI.
inspectionsRouter.get('/api/inspections/:id', requireAuth, async (req, res) => {
  const admin = getSupabaseAdmin();
  const { data: insp, error: e1 } = await admin
    .from('work_order_inspections')
    .select(
      `id, work_order_id, template_id, started_at, completed_at,
       technician_signed_at, supervisor_signed_at, notes, display_seq,
       template:inspection_templates ( id, name, description, scope ),
       work_order:work_orders ( id, asset_unit_number, status, started_at, user_id, display_seq,
         user:users!work_orders_user_id_fkey ( handle ) ),
       started_by_user:users!work_order_inspections_started_by_fkey ( id, full_name, handle )`,
    )
    .eq('id', req.params.id)
    .maybeSingle();
  if (e1) return res.status(500).json({ error: e1.message });
  if (!insp) return res.status(404).json({ error: 'inspection_not_found' });

  // Get the WO items materialized for this inspection joined with template
  // metadata (section, kind, etc) AND any photos attached to each item.
  const { data: items, error: e2 } = await admin
    .from('work_order_items')
    .select(
      `id, sequence, title, status, inspection_result, notes, measurement_value,
       measurement_text, completed_at, completed_by_user_id,
       source_inspection_template_item_id,
       template_item:inspection_template_items!work_order_items_source_inspection_template_item_id_fkey
         ( id, section, section_sequence, item_sequence, kind, good_answer,
           measurement_unit, measurement_min, measurement_max, required ),
       photos:action_photos!action_photos_work_order_item_id_fkey
         ( id, storage_path, caption, uploaded_at )`,
    )
    .eq('work_order_id', insp.work_order_id)
    .eq('inspection_template_id', insp.template_id)
    .order('sequence', { ascending: true });
  if (e2) return res.status(500).json({ error: e2.message });

  // Sign photo URLs (120s TTL — plenty for the modal flow).
  const allPhotos = (items || []).flatMap((it) => it.photos || []);
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

  // Group by section in the response so the client doesn't have to.
  const sections = new Map();
  for (const it of items || []) {
    const tpl = it.template_item;
    const key = `${tpl?.section_sequence ?? 999}|${tpl?.section ?? '?'}`;
    if (!sections.has(key)) {
      sections.set(key, {
        section: tpl?.section ?? '?',
        section_sequence: tpl?.section_sequence ?? 999,
        items: [],
      });
    }
    const itemWithPhotoUrls = {
      ...it,
      photos: (it.photos || []).map((p) => ({
        ...p,
        url: urlMap.get(p.id) ?? null,
      })),
    };
    sections.get(key).items.push(itemWithPhotoUrls);
  }
  const grouped = [...sections.values()].sort(
    (a, b) => a.section_sequence - b.section_sequence,
  );

  res.json({ inspection: insp, sections: grouped });
});

// ───── PATCH /api/inspections/:id/items/:itemId ──────────────────────────────
// Set a single item's result + optional notes/measurement. Fails auto-create
// an issue on the parent WO's asset.
inspectionsRouter.patch(
  '/api/inspections/:id/items/:itemId',
  requireAuth,
  async (req, res) => {
    try {
      const {
        inspection_result,
        notes,
        measurement_value,
        measurement_text,
        attachments, // optional array of { staging_path } — new photos to add
        remove_photo_ids, // optional array of action_photos.id to delete
      } = req.body || {};
      if (!['pass', 'fail', 'na', 'yes', 'no'].includes(inspection_result)) {
        return res.status(400).json({ error: 'invalid_inspection_result' });
      }
      const admin = getSupabaseAdmin();

      // Sanity: the item must belong to this inspection.
      const { data: insp } = await admin
        .from('work_order_inspections')
        .select('id, work_order_id, template_id')
        .eq('id', req.params.id)
        .maybeSingle();
      if (!insp) return res.status(404).json({ error: 'inspection_not_found' });

      const { data: item } = await admin
        .from('work_order_items')
        .select(
          `id, work_order_id, inspection_template_id, source_inspection_template_item_id, title,
           template_item:inspection_template_items!work_order_items_source_inspection_template_item_id_fkey
             ( id, kind, good_answer )`,
        )
        .eq('id', req.params.itemId)
        .eq('work_order_id', insp.work_order_id)
        .eq('inspection_template_id', insp.template_id)
        .maybeSingle();
      if (!item) return res.status(404).json({ error: 'item_not_found' });

      const update = {
        inspection_result,
        status: 'done',
        completed_at: new Date().toISOString(),
        completed_by_user_id: req.user.id,
      };
      if (typeof notes === 'string') update.notes = notes.trim() || null;
      if (measurement_value != null && Number.isFinite(Number(measurement_value))) {
        update.measurement_value = Number(measurement_value);
      }
      if (typeof measurement_text === 'string') {
        update.measurement_text = measurement_text.trim() || null;
      }

      const { data: after, error } = await admin
        .from('work_order_items')
        .update(update)
        .eq('id', item.id)
        .select('id, inspection_result, status, completed_at, notes')
        .single();
      if (error) return res.status(500).json({ error: error.message });

      // Did we just fail this item? (pass/fail OR yes_no with wrong answer)
      const tk = item.template_item;
      const isFail =
        inspection_result === 'fail' ||
        (tk?.kind === 'yes_no' &&
          tk?.good_answer &&
          inspection_result !== tk.good_answer);

      // Fails REQUIRE a description (notes) AND at least one photo attached
      // (after applying removals + additions). Cap total photos at 4.
      const removeIds = Array.isArray(remove_photo_ids)
        ? remove_photo_ids.filter((id) => typeof id === 'string')
        : [];
      const newPhotoList = Array.isArray(attachments)
        ? attachments.filter((a) => a?.staging_path).slice(0, 4)
        : [];

      // Count what would survive after removals + how many adds bring us to.
      let existingCount = 0;
      if (isFail || removeIds.length) {
        const { data: existingRows } = await admin
          .from('action_photos')
          .select('id')
          .eq('work_order_item_id', item.id);
        const existingIds = (existingRows || []).map((r) => r.id);
        // Sanity: only allow removal of photos that actually belong to THIS item.
        const validRemoves = removeIds.filter((id) => existingIds.includes(id));
        existingCount = existingIds.length - validRemoves.length;
        if (existingCount + newPhotoList.length > 4) {
          return res.status(400).json({
            error: 'too_many_photos',
            message: 'Max 4 photos per issue.',
          });
        }
        // Apply removals up front so we have a clean state if anything fails later.
        for (const pid of validRemoves) {
          try {
            await deletePhotoById(pid);
          } catch (e) {
            logger.warn({ err: e.message, pid }, 'inspection: photo delete failed');
          }
        }
      }

      if (isFail) {
        if (typeof notes !== 'string' || notes.trim().length < 3) {
          return res.status(400).json({
            error: 'description_required',
            message: 'A description of the issue is required (3+ chars).',
          });
        }
        if (existingCount + newPhotoList.length < 1) {
          return res.status(400).json({
            error: 'photo_required',
            message: 'At least one photo is required for an issue.',
          });
        }
      }

      let createdIssue = null;
      const attachedPhotos = [];
      if (isFail) {
        // If this item already produced an issue (e.g. tech is editing the
        // existing fail), update its description instead of creating a duplicate.
        const { data: existingIssue } = await admin
          .from('issues')
          .select('id, title, status')
          .eq('raw_input', `inspection_item:${item.id}`)
          .maybeSingle();
        if (existingIssue) {
          await admin
            .from('issues')
            .update({ description: notes?.trim() || null })
            .eq('id', existingIssue.id);
          createdIssue = {
            id: existingIssue.id,
            short_id: existingIssue.id.slice(0, 8),
            title: existingIssue.title,
            updated: true,
          };
        } else {
          // Resolve asset_unit_number for the parent WO.
          const { data: wo } = await admin
            .from('work_orders')
            .select('asset_id, asset_unit_number')
            .eq('id', insp.work_order_id)
            .maybeSingle();
          const { data: iss } = await admin
            .from('issues')
            .insert({
              asset_id: wo?.asset_id ?? null,
              asset_unit_number: wo?.asset_unit_number,
              reported_by: req.user.id,
              title: `[Inspection fail] ${item.title}`,
              description: notes?.trim() || null,
              raw_input: `inspection_item:${item.id}`,
              parsed_data: {
                source: 'inspection',
                inspection_id: insp.id,
                work_order_item_id: item.id,
              },
              status: 'open',
            })
            .select('id, title, status')
            .single();
          createdIssue = iss
            ? { id: iss.id, short_id: iss.id.slice(0, 8), title: iss.title }
            : null;
        }

        // Move each staged photo to permanent storage on the parent WO,
        // tagged with the work_order_item_id so re-edits know which photos
        // belong to this item. Skips silently on per-photo errors so a
        // single bad upload doesn't lose the inspection state we saved.
        for (const a of newPhotoList) {
          try {
            const photo = await attachStagingToWorkOrder({
              stagingPath: a.staging_path,
              workOrderId: insp.work_order_id,
              workOrderItemId: item.id,
              uploadedBy: req.user.id,
              caption: `Inspection issue — ${item.title}`,
            });
            attachedPhotos.push({ id: photo.id });
          } catch (e) {
            logger.warn(
              { err: e.message, staging_path: a.staging_path, item_id: item.id },
              'inspection fail: photo attach failed',
            );
          }
        }
      }

      res.json({ item: after, created_issue: createdIssue, attached_photos: attachedPhotos });
    } catch (e) {
      logger.error({ err: e.message }, 'patch inspection item: unhandled');
      res.status(500).json({ error: 'patch_failed' });
    }
  },
);

// ───── POST /api/inspections/:id/complete ────────────────────────────────────
// Finalize the inspection: stamp completed_at + technician_signed_at and
// optionally a supervisor signature when the caller is admin.
inspectionsRouter.post(
  '/api/inspections/:id/complete',
  requireAuth,
  async (req, res) => {
    const { notes, supervisor_signature } = req.body || {};
    const admin = getSupabaseAdmin();
    const { data: before } = await admin
      .from('work_order_inspections')
      .select('id, work_order_id, completed_at, technician_signed_at')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!before) return res.status(404).json({ error: 'inspection_not_found' });
    if (before.completed_at) {
      return res.status(409).json({ error: 'already_completed' });
    }

    // Verify no items are still pending.
    const { data: pendingItems } = await admin
      .from('work_order_items')
      .select('id')
      .eq('work_order_id', before.work_order_id)
      .eq('inspection_template_id',
          (await admin.from('work_order_inspections').select('template_id').eq('id', before.id).single()).data.template_id)
      .eq('status', 'pending')
      .limit(1);
    if (pendingItems?.length) {
      return res.status(409).json({ error: 'items_still_pending', remaining: pendingItems.length });
    }

    const update = {
      completed_at: new Date().toISOString(),
      technician_signed_at: new Date().toISOString(),
    };
    if (typeof notes === 'string') update.notes = notes.trim() || null;
    if (supervisor_signature && req.user.role === 'admin') {
      update.supervisor_signed_by = req.user.id;
      update.supervisor_signed_at = new Date().toISOString();
    }

    const { data, error } = await admin
      .from('work_order_inspections')
      .update(update)
      .eq('id', req.params.id)
      .select('id, completed_at, technician_signed_at, supervisor_signed_at, notes')
      .single();
    if (error) return res.status(500).json({ error: error.message });

    // Count results for the confirmation message.
    const { data: items } = await admin
      .from('work_order_items')
      .select('inspection_result')
      .eq('work_order_id', before.work_order_id)
      .eq('inspection_template_id',
          (await admin.from('work_order_inspections').select('template_id').eq('id', before.id).single()).data.template_id);
    const counts = {};
    for (const it of items || []) {
      counts[it.inspection_result] = (counts[it.inspection_result] || 0) + 1;
    }

    res.json({ inspection: data, counts });
  },
);
