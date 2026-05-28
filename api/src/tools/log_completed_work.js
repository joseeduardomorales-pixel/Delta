// log_completed_work — fast-path for the common case: tech narrates work
// they ALREADY DID, in one sentence, and we capture the whole thing
// (open + add item(s) + complete + close) in a single tool call.
//
// Example user messages this handles:
//   - "I just changed the oil on CC07, current odo 145,200"
//   - "Replaced front left brake pads on T05 at 89,400 mi"
//   - "Fixed coolant leak on CC12, current odo 112,000"
//   - MULTI-ACTION: "Fixed CC09 — air leak, replaced valve, also greased
//     fifth wheel and topped oil." → ONE call with items=[…3 items…].
//
// Behavior:
//   1. Resolves the asset + meter (same rules as open_work_order).
//   2. If telematics is stale and no manual_meter_value, returns
//      needs_meter so the assistant can ask.
//   3. Otherwise opens a WO, adds 1..N ad_hoc items (all marked done),
//      and closes the WO — best-effort; failure of a later step leaves
//      earlier steps in place, which is the safer direction for partial
//      work.
//
// Use this for narrated past-tense work. For "open a work order to do X",
// use open_work_order instead.
//
// Input shape:
//   - Single item (legacy, still supported):
//       { asset_unit_number, type, title, description?, raw_input }
//   - Multi-item (preferred for 2+ actions on same asset in one message):
//       { asset_unit_number, raw_input, items: [{type, title, description?}] }

import {
  resolveAssetWithMeter,
  insertManualMeter,
} from '../services/workOrderHelpers.js';
import { formatWo } from '../lib/numbers.js';

export const logCompletedWork = {
  name: 'log_completed_work',
  description:
    'Fast-path: tech narrates work they JUST DID. Opens a WO, adds 1+ ' +
    'line items (all marked done), and closes the WO in one shot. Echo ' +
    'the confirmation verbatim.\n\n' +
    'Use when the tech describes COMPLETED work in past tense ' +
    '("I changed the oil", "replaced the filter", "fixed the leak"). \n' +
    'Use open_work_order instead when the tech says "open a WO" / "start ' +
    'working on" (future tense — they want a session).\n\n' +
    'MULTI-ACTION RULE: If the tech narrates 2+ completed actions on the ' +
    'SAME asset in one message ("fixed leak, greased fifth wheel, topped ' +
    'oil"), make ONE call with the `items` array — do NOT call this tool ' +
    'multiple times for the same asset. Each item gets its own type/title/' +
    'description, all close on the same WO with the same opening meter.\n\n' +
    'If the tech also mentions a PENDING problem in the same message ' +
    '("still need to check the steering jiggle"), make a SEPARATE ' +
    'report_issue call for it after this returns.\n\n' +
    'Like open_work_order, may return { needs_meter: true } if telematics ' +
    'is stale. Ask the user for the current meter, then re-call with ' +
    'manual_meter_value.',
  input_schema: {
    type: 'object',
    properties: {
      asset_unit_number: { type: 'string' },
      // Legacy single-item shape (still works) ---
      type: {
        type: 'string',
        enum: ['pm', 'repair', 'inspection', 'other'],
        description:
          'Single-item shape: the type for the one item. Omit if using `items`.',
      },
      title: {
        type: 'string',
        description:
          'Single-item shape: short headline (3–10 words). Omit if using `items`.',
      },
      description: {
        type: 'string',
        description: 'Single-item shape: optional longer detail. Omit if using `items`.',
      },
      // Multi-item shape (preferred for 2+ actions) ---
      items: {
        type: 'array',
        description:
          'Preferred for 2+ completed actions on the same asset. Each ' +
          'entry becomes one done item on the WO.',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['pm', 'repair', 'inspection', 'other'] },
            title: { type: 'string' },
            description: { type: 'string' },
          },
          required: ['type', 'title'],
        },
      },
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
    required: ['asset_unit_number', 'raw_input'],
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

    // Normalize input into a single items[] array regardless of which
    // shape the caller used.
    const items = Array.isArray(input.items) && input.items.length > 0
      ? input.items
      : input.type && input.title
        ? [{ type: input.type, title: input.title, description: input.description }]
        : null;
    if (!items) {
      return {
        ok: false,
        error: 'missing_items',
        message:
          'Provide either { type, title } for a single item, or items: [...] for multi-action.',
      };
    }
    // Validate each item has type + title.
    for (const it of items) {
      if (!it?.type || !it?.title) {
        return {
          ok: false,
          error: 'invalid_item',
          message: 'Every items[] entry needs type and title.',
        };
      }
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
            ? {
                value: last_known.value,
                recorded_at: last_known.recorded_at,
                recorded_human: last_known.recorded_human,
              }
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

    // 2. Add N ad_hoc items (all done).
    const nowIso = new Date().toISOString();
    const rows = items.map((it, idx) => ({
      work_order_id: wo.id,
      sequence: idx,
      source: 'ad_hoc',
      type: it.type,
      title: it.title.trim(),
      description: it.description?.trim() || null,
      // raw_input goes on the FIRST item only — it's the whole original message.
      raw_input: idx === 0 ? input.raw_input : null,
      status: 'done',
      completed_at: nowIso,
      completed_by_user_id: user.id,
      meter_reading_id: wo.opening_meter_reading_id,
    }));
    const { data: insertedItems, error: itemErr } = await admin
      .from('work_order_items')
      .insert(rows)
      .select('id, sequence, title, type, status');
    if (itemErr) throw new Error(itemErr.message);

    // 3. Close WO
    const { error: closeErr } = await admin
      .from('work_orders')
      .update({
        status: 'completed',
        completed_at: nowIso,
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

    // Build a confirmation that reads naturally for 1 or N items.
    let confirmation;
    if (items.length === 1) {
      const it = items[0];
      confirmation =
        `Logged ${label} — ${it.title} on ${wo.asset_unit_number}${meterText} ` +
        `(${it.type}, completed, pending review). Say "undo" within 5 min to remove.`;
    } else {
      const titles = items.map((it) => it.title.trim()).join(', ');
      confirmation =
        `Logged ${label} on ${wo.asset_unit_number}${meterText} with ` +
        `${items.length} items (${titles}) — all completed, pending review. ` +
        `Say "undo" within 5 min to remove.`;
    }

    return {
      work_order: {
        id: wo.id,
        label,
        display_seq: wo.display_seq,
        user_handle: profile?.handle ?? null,
        asset_unit_number: wo.asset_unit_number,
        status: 'completed',
      },
      // Keep `item` (singular) populated for legacy callers that expected
      // it; add `items` (plural) for the multi case.
      item: insertedItems[0],
      items: insertedItems,
      confirmation,
    };
  },
};
