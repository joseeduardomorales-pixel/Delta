// start_inspection — opens (or reuses) a WO on an asset and materializes an
// inspection template onto it.
//
// Examples this handles:
//   - "start a reefer inspection on T05"
//   - "do a reefer trailer inspection on BF1701"
//   - "open an inspection for trailer 1234"
//
// Behavior:
//   1. Resolves the asset + meter (same rules as open_work_order). If
//      telematics is stale and no manual_meter_value, returns needs_meter.
//   2. Picks the inspection template by name match (case-insensitive
//      substring) or by template_id.
//   3. If there's already an open/in_progress WO from this user on this
//      asset, reuses it. Otherwise opens a fresh one.
//   4. Materializes one work_order_item per template item.
//   5. Returns inspection_id + a URL the assistant should give the user
//      so they can walk through the checklist.

import {
  resolveAssetWithMeter,
  insertManualMeter,
} from '../services/workOrderHelpers.js';
import { formatInspection } from '../lib/numbers.js';

export const startInspection = {
  name: 'start_inspection',
  description:
    'Open (or reuse) a work order on an asset and materialize an inspection ' +
    'checklist onto it. Use when the tech says "start a reefer inspection ' +
    'on T05", "do a reefer trailer inspection", or similar.\n\n' +
    'Like open_work_order, may return { needs_meter: true } if telematics ' +
    'is stale on this asset. Ask the user for the current meter, then ' +
    're-call with manual_meter_value set.\n\n' +
    'After this tool returns, ALWAYS include the `confirmation` field ' +
    'verbatim and tell the user to open the inspection link to fill out ' +
    'each item.',
  input_schema: {
    type: 'object',
    properties: {
      asset_unit_number: { type: 'string' },
      template_name: {
        type: 'string',
        description:
          'OPTIONAL. Substring of the template name to match (e.g. "reefer"). ' +
          'If the user didn\'t specify a template explicitly, leave this empty ' +
          'and we\'ll pick the only template matching the asset type.',
      },
      manual_meter_value: {
        type: 'number',
        description:
          'OPTIONAL. Pass on the second call after a needs_meter response.',
      },
    },
    required: ['asset_unit_number'],
  },
  allowedRoles: ['admin', 'tech'],
  async handler(input, ctx) {
    const { admin, user } = ctx;
    if (user.role === 'dispatcher') {
      return {
        ok: false,
        error: 'dispatcher_cannot_start_inspection',
        message: 'Dispatchers cannot start inspections — only techs and admins.',
      };
    }

    const unit = input.asset_unit_number.trim().toUpperCase();
    const resolved = await resolveAssetWithMeter(admin, unit);
    if (!resolved.asset) {
      return { ok: false, error: 'asset_not_found' };
    }
    const { asset, meter, meter_unit, last_known, needs_meter } = resolved;

    // Pick a template. If user said "reefer", match templates by substring.
    let templateQuery = admin
      .from('inspection_templates')
      .select('id, name, scope, active')
      .eq('active', true);
    if (input.template_name) {
      templateQuery = templateQuery.ilike('name', `%${input.template_name}%`);
    }
    const { data: tpls } = await templateQuery;
    if (!tpls?.length) {
      return {
        ok: false,
        error: 'no_template_match',
        message: input.template_name
          ? `No inspection template matches "${input.template_name}".`
          : 'No inspection templates available.',
      };
    }
    // If still ambiguous, prefer templates whose scope matches the asset type.
    let template = tpls[0];
    if (tpls.length > 1) {
      const isReefer =
        asset.type === 'reefer' ||
        (asset.type === 'trailer' &&
          String(asset.metadata?.equipment_type || '').toLowerCase() === 'reefer');
      const targetScope = isReefer
        ? 'reefer_trailer'
        : asset.type === 'truck'
          ? 'truck'
          : 'trailer';
      template = tpls.find((t) => t.scope === targetScope) || tpls[0];
    }

    // Handle meter requirement (same as open_work_order).
    let openingMeter = meter;
    if (needs_meter) {
      if (input.manual_meter_value == null) {
        return {
          needs_meter: true,
          asset_unit_number: asset.unit_number,
          meter_unit,
          last_known: last_known
            ? { value: last_known.value, recorded_at: last_known.recorded_at }
            : null,
          message:
            meter_unit === 'hours'
              ? `Need current hour meter for ${asset.unit_number}.`
              : `Need current odometer for ${asset.unit_number}.`,
        };
      }
      try {
        openingMeter = await insertManualMeter({
          admin,
          assetId: asset.id,
          unit: meter_unit,
          value: input.manual_meter_value,
          userId: user.id,
        });
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }

    // Reuse this user's open WO on this asset if one exists, else open a new one.
    let woId;
    const { data: existing } = await admin
      .from('work_orders')
      .select('id, status')
      .eq('asset_id', asset.id)
      .eq('user_id', user.id)
      .in('status', ['open', 'in_progress'])
      .order('started_at', { ascending: false })
      .limit(1);
    if (existing?.length) {
      woId = existing[0].id;
    } else {
      const { data: wo, error } = await admin
        .from('work_orders')
        .insert({
          asset_id: asset.id,
          asset_unit_number: asset.unit_number,
          user_id: user.id,
          status: 'in_progress',
          approval_status: 'pending_review',
          opening_meter_reading_id: openingMeter?.id ?? null,
        })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      woId = wo.id;
    }

    // Refuse if this template was already started on this WO.
    const { data: dup } = await admin
      .from('work_order_inspections')
      .select('id')
      .eq('work_order_id', woId)
      .eq('template_id', template.id)
      .maybeSingle();
    if (dup) {
      return {
        ok: false,
        error: 'inspection_already_started',
        inspection_id: dup.id,
        message: `An inspection of "${template.name}" is already in progress on this WO. Continue at /work-orders/${woId}/inspect/${dup.id}.`,
      };
    }

    // Materialize one work_order_item per template item.
    const { data: tplItems } = await admin
      .from('inspection_template_items')
      .select('id, text, section_sequence, item_sequence')
      .eq('template_id', template.id)
      .order('section_sequence', { ascending: true })
      .order('item_sequence', { ascending: true });

    // Compute starting sequence (so we don't collide with existing items).
    const { data: maxSeq } = await admin
      .from('work_order_items')
      .select('sequence')
      .eq('work_order_id', woId)
      .order('sequence', { ascending: false })
      .limit(1)
      .maybeSingle();
    let nextSeq = (maxSeq?.sequence ?? -1) + 1;

    // Insert the inspection row first.
    const { data: insp, error: inspErr } = await admin
      .from('work_order_inspections')
      .insert({
        work_order_id: woId,
        template_id: template.id,
        started_by: user.id,
      })
      .select('id, display_seq')
      .single();
    if (inspErr) throw new Error(inspErr.message);

    const rows = (tplItems || []).map((ti) => ({
      work_order_id: woId,
      sequence: nextSeq++,
      source: 'inspection_template',
      source_inspection_template_item_id: ti.id,
      inspection_template_id: template.id,
      type: 'inspection',
      title: ti.text,
      status: 'pending',
    }));
    if (rows.length) {
      const { error: itemsErr } = await admin.from('work_order_items').insert(rows);
      if (itemsErr) {
        await admin.from('work_order_inspections').delete().eq('id', insp.id);
        throw new Error(itemsErr.message);
      }
    }

    const { data: profile } = await admin
      .from('users')
      .select('handle')
      .eq('id', user.id)
      .maybeSingle();
    const label =
      formatInspection(profile?.handle, insp.display_seq) ||
      `INS-${insp.id.slice(0, 8)}`;
    return {
      work_order: { id: woId, asset_unit_number: asset.unit_number },
      inspection: {
        id: insp.id,
        label,
        display_seq: insp.display_seq,
        user_handle: profile?.handle ?? null,
        template_name: template.name,
        item_count: rows.length,
        url: `/work-orders/${woId}/inspect/${insp.id}`,
      },
      confirmation:
        `Started ${template.name} on ${asset.unit_number} (${label}, ${rows.length} items). ` +
        `Open the inspection screen to walk through it.`,
    };
  },
};
