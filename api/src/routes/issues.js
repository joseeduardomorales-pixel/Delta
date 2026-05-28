// /api/issues — reported problems, upstream of work orders.
// All authenticated roles can create (tech, dispatcher, admin).
// No approval gate — issues are just visible until a tech addresses them
// or an admin dismisses them.

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';
import { attachStagingToWorkOrder } from '../services/storage.js';
import { formatIssue } from '../lib/numbers.js';
import { logger } from '../logger.js';

export const issuesRouter = Router();

// ---- POST /api/issues ------------------------------------------------------
issuesRouter.post('/api/issues', requireAuth, async (req, res) => {
  try {
    const {
      asset_unit_number,
      title,
      description,
      raw_input,
      parsed_data,
      attachments,
    } = req.body || {};

    if (typeof asset_unit_number !== 'string' || !asset_unit_number.trim()) {
      return res.status(400).json({ error: 'asset_unit_number_required' });
    }
    if (typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'title_required' });
    }

    const admin = getSupabaseAdmin();
    const unit = asset_unit_number.trim().toUpperCase();
    const { data: assetRow } = await admin
      .from('assets')
      .select('id, unit_number')
      .ilike('unit_number', unit)
      .maybeSingle();

    const { data, error } = await admin
      .from('issues')
      .insert({
        asset_id: assetRow?.id ?? null,
        asset_unit_number: unit,
        reported_by: req.user.id,
        title: title.trim(),
        description: description?.trim() || null,
        raw_input: raw_input?.trim() || null,
        parsed_data: parsed_data || {},
        status: 'open',
      })
      .select('id, asset_unit_number, title, status, reported_at, display_seq')
      .single();

    if (error) {
      logger.error({ err: error.message, userId: req.user.id }, 'issues insert failed');
      return res.status(500).json({ error: error.message });
    }

    // Attach any photos that were uploaded to staging. We reuse the
    // work-orders bucket convention but rebase under `issues/{id}/...`.
    const attachedPhotos = [];
    if (Array.isArray(attachments) && attachments.length > 0) {
      for (const a of attachments) {
        if (!a?.staging_path) continue;
        try {
          // We piggyback on the existing storage helper by passing the
          // issue id as the "workOrderId"; the path naming convention
          // becomes work-orders/{issue_id}/… which is acceptable for
          // now. Future refactor: separate "issue-photos" key prefix.
          const photo = await attachStagingToWorkOrder({
            stagingPath: a.staging_path,
            workOrderId: data.id, // misnomer — see comment above
            uploadedBy: req.user.id,
            caption: a.caption || null,
          });
          attachedPhotos.push({ id: photo.id, storage_path: photo.storage_path });
        } catch (e) {
          logger.warn(
            { err: e.message, staging_path: a.staging_path, issueId: data.id },
            'issues: failed to attach staging photo',
          );
        }
      }
    }

    // Look up reporter handle for the human-readable label.
    const { data: profile } = await admin
      .from('users')
      .select('handle')
      .eq('id', req.user.id)
      .maybeSingle();
    const label = formatIssue(profile?.handle, data.display_seq) || `ISS-${data.id.slice(0, 8)}`;
    res.status(201).json({
      issue: {
        ...data,
        label,
        user_handle: profile?.handle ?? null,
        short_id: data.id.slice(0, 8), // legacy fallback
      },
      attachedPhotos,
      message: `Issue logged: ${label} on ${data.asset_unit_number}.`,
    });
  } catch (e) {
    logger.error({ err: e.message, userId: req.user?.id }, 'issues: unhandled');
    res.status(500).json({ error: 'create_failed' });
  }
});

// ---- GET /api/issues -------------------------------------------------------
// Filter by asset_unit_number, status (open|acknowledged|in_progress|resolved|dismissed)
// or fall back to "all open" by default.
issuesRouter.get('/api/issues', requireAuth, async (req, res) => {
  const admin = getSupabaseAdmin();
  let q = admin
    .from('issues')
    .select(
      `id, asset_id, asset_unit_number, title, description, raw_input,
       parsed_data, status, reported_at, resolved_at, display_seq,
       resolved_by_work_order_item_id,
       reporter:users!issues_reported_by_fkey ( id, full_name, role, handle )`,
    )
    .order('reported_at', { ascending: false })
    .limit(200);

  if (req.query.asset_unit_number) {
    q = q.eq('asset_unit_number', String(req.query.asset_unit_number).toUpperCase());
  }
  if (req.query.status) {
    const statuses = String(req.query.status).split(',').map((s) => s.trim());
    q = q.in('status', statuses);
  } else {
    q = q.in('status', ['open', 'acknowledged', 'in_progress']);
  }

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ issues: data, count: data.length });
});

// ---- PATCH /api/issues/:id (admin) — acknowledge / dismiss / edit ----------
issuesRouter.patch('/api/issues/:id', requireAuth, async (req, res) => {
  // Only admin can dismiss or edit status. Reporter within grace can edit
  // title/description.
  const admin = getSupabaseAdmin();
  const { data: before } = await admin
    .from('issues')
    .select('id, reported_by, status, reported_at')
    .eq('id', req.params.id)
    .maybeSingle();
  if (!before) return res.status(404).json({ error: 'not_found' });

  const update = {};
  const isAdmin = req.user.role === 'admin';
  const isOwner = before.reported_by === req.user.id;
  const withinGrace =
    Date.now() - new Date(before.reported_at).getTime() < 5 * 60 * 1000;

  if (typeof req.body?.title === 'string' && (isAdmin || (isOwner && withinGrace))) {
    update.title = req.body.title.trim();
  }
  if (typeof req.body?.description === 'string' && (isAdmin || (isOwner && withinGrace))) {
    update.description = req.body.description.trim();
  }
  if (typeof req.body?.status === 'string' && isAdmin) {
    update.status = req.body.status;
    if (req.body.status === 'dismissed') {
      update.dismissed_by = req.user.id;
      update.dismissed_at = new Date().toISOString();
      if (typeof req.body?.dismiss_reason === 'string') {
        update.dismiss_reason = req.body.dismiss_reason.trim();
      }
    }
  }

  if (Object.keys(update).length === 0) {
    return res.status(400).json({ error: 'no_fields_to_update_or_not_permitted' });
  }

  const { data, error } = await admin
    .from('issues')
    .update(update)
    .eq('id', req.params.id)
    .select('id, status, title, description, dismissed_at, dismiss_reason')
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });

  await admin.from('audit_log').insert({
    actor_user_id: req.user.id,
    action: 'issue_update',
    target_table: 'issues',
    target_id: req.params.id,
    before,
    after: update,
  });

  res.json({ issue: data });
});
