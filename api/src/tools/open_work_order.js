// open_work_order — start a new work-order session on an asset.
//
// Every WO must have an opening meter reading: miles for trucks, hours
// for reefer units. If telematics has a fresh reading (< 24h old), the
// tool uses it automatically. If not, the tool returns
// { needs_meter: true } and the assistant should ASK the user for the
// current reading, then call open_work_order again with manual_meter_value.
//
// Opening a WO does NOT yet attach work — the next steps are:
//   1. (Optional) call query_pending_for_asset to see open issues / due PMs / campaigns.
//   2. Call add_item_to_work_order for each thing the tech is going to do.
//   3. Call complete_item as each is done.
//   4. Call close_work_order when the tech is finished.

import {
  resolveAssetWithMeter,
  insertManualMeter,
} from '../services/workOrderHelpers.js';
import { formatWo } from '../lib/numbers.js';

export const openWorkOrder = {
  name: 'open_work_order',
  description:
    'Open a new work-order session on an asset. Use when a tech says ' +
    '"open a work order on CC07" or "start a WO on T12". \n\n' +
    'Behavior:\n' +
    '- Asset is resolved by unit_number (case-insensitive).\n' +
    '- A meter reading is required. Trucks → miles. Reefer units → hours.\n' +
    '- If telematics has a fresh reading (< 24h old), it\'s used automatically.\n' +
    '- If NOT, the tool returns { needs_meter: true, meter_unit, last_known }. ' +
    'Ask the user "What\'s the current odometer/hour meter on {unit}?" and ' +
    'then re-call open_work_order with manual_meter_value set.\n\n' +
    'Dispatchers are NOT allowed to open work orders — only tech/admin.',
  input_schema: {
    type: 'object',
    properties: {
      asset_unit_number: {
        type: 'string',
        description: 'Unit number (e.g. "CC07", "BF1701", "T05").',
      },
      manual_meter_value: {
        type: 'number',
        description:
          'OPTIONAL. Only pass this on the SECOND call after a needs_meter ' +
          'response, with the value the user supplied. Integer mileage or ' +
          'hours. Do not pass on the first call — telematics may have a ' +
          'fresh reading.',
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
        error: 'dispatcher_cannot_open_wo',
        message: 'Dispatchers cannot open work orders — only techs and admins.',
      };
    }

    const unit = input.asset_unit_number.trim().toUpperCase();
    const resolved = await resolveAssetWithMeter(admin, unit);
    if (!resolved.asset) {
      return {
        ok: false,
        error: 'asset_not_found',
        message: `No asset found with unit number "${unit}".`,
      };
    }
    const { asset, meter, meter_unit, last_known, needs_meter } = resolved;

    let openingMeterRow = meter; // {id, value, recorded_at, source}
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
                source: last_known.source,
              }
            : null,
          message:
            meter_unit === 'miles'
              ? `Need current odometer for ${asset.unit_number}. Ask the user what it reads.`
              : `Need current hour meter for ${asset.unit_number}. Ask the user what it reads.`,
        };
      }
      try {
        openingMeterRow = await insertManualMeter({
          admin,
          assetId: asset.id,
          unit: meter_unit,
          value: input.manual_meter_value,
          userId: user.id,
        });
      } catch (e) {
        return {
          ok: false,
          error: e.message,
          message: `Invalid meter value: ${input.manual_meter_value}`,
        };
      }
    }

    const { data: wo, error } = await admin
      .from('work_orders')
      .insert({
        asset_id: asset.id,
        asset_unit_number: asset.unit_number,
        user_id: user.id,
        status: 'open',
        approval_status: 'pending_review',
        opening_meter_reading_id: openingMeterRow?.id ?? null,
      })
      .select(
        'id, asset_unit_number, status, started_at, opening_meter_reading_id, display_seq',
      )
      .single();
    if (error) throw new Error(error.message);

    // Pull caller's handle for the human-readable label.
    const { data: profile } = await admin
      .from('users')
      .select('handle')
      .eq('id', user.id)
      .maybeSingle();
    const label = formatWo(profile?.handle, wo.display_seq) || `WO-${wo.id.slice(0, 8)}`;
    const meterText = openingMeterRow
      ? meter_unit === 'miles'
        ? `${openingMeterRow.value.toLocaleString()} mi`
        : `${openingMeterRow.value.toLocaleString()} hr`
      : 'no meter';
    return {
      work_order: {
        id: wo.id,
        label,
        display_seq: wo.display_seq,
        user_handle: profile?.handle ?? null,
        asset_unit_number: wo.asset_unit_number,
        status: wo.status,
        opening_meter: openingMeterRow
          ? {
              value: openingMeterRow.value,
              unit: meter_unit,
              source: openingMeterRow.source,
              recorded_at: openingMeterRow.recorded_at,
            }
          : null,
      },
      confirmation:
        `Opened ${label} on ${wo.asset_unit_number} (${meterText}). ` +
        `What are you working on? I can list pending issues, due PMs, and ` +
        `active campaigns for this asset.`,
    };
  },
};
