// POST /api/work-orders — fast-path WO creation, bypasses Claude.
// Used by the "Report Issue" button flow and (later) any structured
// form like Inspections.
//
// Same RLS + approval gate as the chat tool path: the row lands as
// approval_status='pending_review' and shows up in /admin/work-orders/pending.
//
// Body:
//   {
//     asset_unit_number: string,
//     type: 'issue' | 'repair' | 'pm' | 'inspection' | 'other',
//     title: string,
//     description?: string,
//     raw_input?: string,                     // for parity w/ chat-created WOs
//     parsed_data?: object,                   // structured data (e.g., checklist)
//     attachments?: [{ staging_path: string }] // photos uploaded to staging
//   }

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';
import { attachStagingToWorkOrder } from '../services/storage.js';
import { logger } from '../logger.js';

export const workOrdersRouter = Router();

const VALID_TYPES = new Set(['issue', 'repair', 'pm', 'inspection', 'other']);

workOrdersRouter.post('/api/work-orders', requireAuth, async (req, res) => {
  try {
    const {
      asset_unit_number,
      type,
      title,
      description,
      raw_input,
      parsed_data,
      attachments,
    } = req.body || {};

    if (typeof asset_unit_number !== 'string' || !asset_unit_number.trim()) {
      return res.status(400).json({ error: 'asset_unit_number_required' });
    }
    if (!VALID_TYPES.has(type)) {
      return res.status(400).json({ error: 'invalid_type' });
    }
    if (typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'title_required' });
    }
    // Dispatcher gate (same as Claude tool layer)
    if (req.user.role === 'dispatcher' && type !== 'issue') {
      return res.status(403).json({
        error: 'dispatcher_can_only_create_issue',
        message: 'Dispatchers can only report issues, not open other work orders.',
      });
    }

    const admin = getSupabaseAdmin();

    // Resolve asset_id (denormalized unit_number preserved either way).
    const unit = asset_unit_number.trim().toUpperCase();
    const { data: assetRow } = await admin
      .from('assets')
      .select('id, unit_number')
      .ilike('unit_number', unit)
      .maybeSingle();

    const defaultStatus = type === 'issue' ? 'open' : 'completed';
    const { data, error } = await admin
      .from('work_orders')
      .insert({
        asset_id: assetRow?.id ?? null,
        asset_unit_number: unit,
        user_id: req.user.id,
        type,
        status: defaultStatus,
        title: title.trim(),
        description: description?.trim() || null,
        raw_input: raw_input?.trim() || null,
        parsed_data: parsed_data || {},
        approval_status: 'pending_review',
      })
      .select('id, asset_unit_number, type, status, title, started_at, approval_status')
      .single();
    if (error) {
      logger.error({ err: error.message, userId: req.user.id }, 'work_orders insert failed');
      return res.status(500).json({ error: error.message });
    }

    // Attach any photos that were uploaded to staging.
    const attachedPhotos = [];
    if (Array.isArray(attachments) && attachments.length > 0) {
      for (const a of attachments) {
        if (!a?.staging_path) continue;
        try {
          const photo = await attachStagingToWorkOrder({
            stagingPath: a.staging_path,
            workOrderId: data.id,
            uploadedBy: req.user.id,
            caption: a.caption || null,
          });
          attachedPhotos.push({ id: photo.id, storage_path: photo.storage_path });
        } catch (e) {
          logger.warn(
            { err: e.message, staging_path: a.staging_path, woId: data.id },
            'work_orders: failed to attach staging photo',
          );
        }
      }
    }

    const short_id = data.id.slice(0, 8);
    res.status(201).json({
      work_order: { ...data, short_id },
      attachedPhotos,
      message: `Logged WO-${short_id} on ${data.asset_unit_number} (${data.type}, ${data.status}, pending review).`,
    });
  } catch (e) {
    logger.error(
      { err: e.message, userId: req.user?.id },
      'work_orders: unhandled error',
    );
    res.status(500).json({ error: 'create_failed' });
  }
});
