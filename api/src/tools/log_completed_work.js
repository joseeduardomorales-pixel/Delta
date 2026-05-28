// log_completed_work — fast-path for the common case: tech narrates work
// they ALREADY DID, in one sentence, and we capture the whole thing
// (open + add item + complete + close) in a single tool call.
//
// Example user messages this handles:
//   - "I just changed the oil on CC07, current odo 145,200"
//   - "Replaced front left brake pads on T05 at 89,400 mi"
//   - "Fixed coolant leak on CC12, current odo 112,000"
//
// Behavior:
//   1. Resolves the asset + meter (same rules as open_work_order).
//   2. If telematics is stale and no manual_meter_value, returns
//      needs_meter so the assistant can ask.
//   3. Otherwise opens a WO, adds one ad_hoc item, marks it done,
//      and closes the WO — all atomic-ish (best-effort; failure of
//      a later step leaves earlier steps in place, which is the safer
//      direction for partial work).
//
// Use this for narrated past-tense work. For "open a work order to do X",
// use open_work_order instead.

import {
  resolveAssetWithMeter,
  insertManualMeter,
} from '../services/workOrderHelpers.js';
import { formatWo } from '../lib/numbers.js';

export const logCompletedWork = {
  name: 'log_completed_work',
  description:
    'Fast-path: tech narrates work they JUST DID. Captures opening a WO, ' +
    'adding the line item, completing it, and closing the WO in one shot. ' +
    'Echo the confirmation verbatim.\n\n' +
    'Use when the tech describes COMPLETED work in past tense ' +
    '("I changed the oil", "replaced the filter", "fixed the leak"). \n' +
    'Use open_work_order instead when the tech says "open a WO" / "start ' +
    'working on" (future tense — they want a session).\n\n' +
    'Like open_work_order, may return { needs_meter: true } if telematics ' +
    'is stale. Ask the user for the current meter, then re-call with ' +
    'manual_meter_value.',
  input_schema: {
    type: 'object',
    properties: {
      asset_unit_number: { type: 'string' },
      type: {
        type: 'string',
        enum: ['pm', 'repair', 'inspection', 'other'],
      },
      title: {
        type: 'string',
        description: 'Short headline (3–10 words). E.g. "Oil change", "Replaced front brake pads".',
      },
      description: { type: 'string' },
      raw_input: {
        type: 'string',
        description: "User's exact original message, verbatim.",
      },
      manual_meter_value: {
        type: 'number',
        description:
          'OPTIONAL. Pass on the second call after a needs_meter response.',
      },
    },
    required: ['asset_unit_number', 'type', 'title', 'raw_input'],
  },
  allowedRoles: ['admin', 'tech'],
  async handler(input, ctx) {
    const { admin, user } = ctx;
    if (user.role === 'dispatcher') {
      return {
        ok: false,
        error: 'dispatcher_cannot_log_completed_work',
        message: 'Dispatchers can only report issues, not log completed work.',
      };
    }

    const unit = input.asset_unit_number.trim().toUpperCase();
    const { asset, meter, meter_unit, last_known, needs_meter } =
      await resolveAssetWithMeter(admin, unit);
    if (!asset) {
      return { ok: false, error: 'asset_not_found' };
    }

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
            meter_unit === 'miles'
              ? `Need current odometer for ${asset.unit_number}.`
              : `Need current hour meter for ${asset.unit_number}.`,
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

    // 1. Open WO
    const { data: wo, error: woErr } = await admin
      .from('work_orders')
      .insert({
        asset_id: asset.id,
        asset_unit_number: asset.unit_number,
        user_id: user.id,
        status: 'in_progress',
        approval_status: 'pending_review',
        opening_meter_reading_id: openingMeter?.id ?? null,
      })
      .select('id, asset_unit_number, opening_meter_reading_id, display_seq')
      .single();
    if (woErr) throw new Error(woErr.message);

    // 2. Add ad_hoc item
    const { data: item, error: itemErr } = await admin
      .from('work_order_items')
      .insert({
        work_order_id: wo.id,
        sequence: 0,
        source: 'ad_hoc',
        type: input.type,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        raw_input: input.raw_input,
        status: 'done',
        completed_at: new Date().toISOString(),
        completed_by_user_id: user.id,
        meter_reading_id: wo.opening_meter_reading_id,
      })
      .select('id, sequence, title, status')
      .single();
    if (itemErr) throw new Error(itemErr.message);

    // 3. Close WO
    const { error: closeErr } = await admin
      .from('work_orders')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', wo.id);
    if (closeErr) throw new Error(closeErr.message);

    const { data: profile } = await admin
      .from('users')
      .select('handle')
      .eq('id', user.id)
      .maybeSingle();
    const label = formatWo(profile?.handle, wo.display_seq) || `WO-${wo.id.slice(0, 8)}`;
    const meterText = openingMeter
      ? meter_unit === 'miles'
        ? ` @ ${openingMeter.value.toLocaleString()} mi`
        : ` @ ${openingMeter.value.toLocaleString()} hr`
      : '';
    return {
      work_order: {
        id: wo.id,
        label,
        display_seq: wo.display_seq,
        user_handle: profile?.handle ?? null,
        asset_unit_number: wo.asset_unit_number,
        status: 'completed',
      },
      item,
      confirmation:
        `Logged ${label} — ${input.title} on ${wo.asset_unit_number}${meterText} ` +
        `(${input.type}, completed, pending review). Say "undo" within 5 min to remove.`,
    };
  },
};
