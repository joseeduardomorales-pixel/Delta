// Shared business logic for work orders. Used by both HTTP routes
// (api/src/routes/work_orders.js) and Claude tools (api/src/tools/*).
//
// The two main concerns here:
//   - resolveAssetWithMeter: figure out the right meter unit for an asset
//     and fetch the latest fresh reading.
//   - cascadeCompleteItem: encapsulate the side-effect cascade when an
//     item flips to status='done' (resolve issue / snap PM / mark campaign).
//
// Keeping these as pure functions (admin client passed in) makes them
// trivially testable and reusable from the chat tool dispatch path.

const FRESH_MS = 24 * 60 * 60 * 1000;

export async function resolveAssetWithMeter(admin, unit) {
  if (!unit || typeof unit !== 'string') {
    return { asset: null, meter: null, meter_unit: null, needs_meter: false };
  }
  const { data: asset } = await admin
    .from('assets')
    .select('id, unit_number, type, metadata')
    .ilike('unit_number', unit.trim())
    .maybeSingle();
  if (!asset) return { asset: null, meter: null, meter_unit: null, needs_meter: false };

  const isReefer =
    asset.type === 'reefer' ||
    (asset.type === 'trailer' &&
      String(asset.metadata?.equipment_type || '').toLowerCase() === 'reefer');
  const meterUnit = asset.type === 'truck' ? 'miles' : isReefer ? 'hours' : null;

  if (!meterUnit) return { asset, meter: null, meter_unit: null, needs_meter: false };

  const { data: rows } = await admin
    .from('meter_readings')
    .select('id, value, recorded_at, source')
    .eq('asset_id', asset.id)
    .eq('unit', meterUnit)
    .order('recorded_at', { ascending: false })
    .limit(1);
  const latest = rows?.[0] ?? null;
  const fresh =
    latest && Date.now() - new Date(latest.recorded_at).getTime() < FRESH_MS;

  return {
    asset,
    meter_unit: meterUnit,
    meter: fresh ? latest : null,
    last_known: latest,
    needs_meter: !fresh,
  };
}

// Insert a manual meter reading and return its id.
export async function insertManualMeter({
  admin,
  assetId,
  unit,
  value,
  userId,
}) {
  const v = Number(value);
  if (!Number.isFinite(v) || v < 0) throw new Error('invalid_meter_value');
  const { data, error } = await admin
    .from('meter_readings')
    .insert({
      asset_id: assetId,
      unit,
      value: Math.round(v),
      source: 'manual',
      recorded_by: userId,
      recorded_at: new Date().toISOString(),
    })
    .select('id, value, unit, recorded_at')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// Cascade side-effects when a work_order_item flips to 'done'.
// Returns a small object describing what was linked, for confirmation msgs.
export async function cascadeCompleteItem({ admin, item, openingMeterReading }) {
  const linked = {};

  // Linked issue → resolved
  if (item.source === 'issue' && item.source_issue_id) {
    await admin
      .from('issues')
      .update({
        status: 'resolved',
        resolved_at: new Date().toISOString(),
        resolved_by_work_order_item_id: item.id,
      })
      .eq('id', item.source_issue_id);
    linked.resolved_issue_id = item.source_issue_id;
  }

  // Linked PM schedule → snap last_completed_* from opening meter
  if (item.source === 'pm_schedule' && item.source_pm_schedule_id) {
    const snap = { last_completed_work_order_item_id: item.id };
    if (openingMeterReading) {
      if (openingMeterReading.unit === 'miles') {
        snap.last_completed_miles = openingMeterReading.value;
      }
      if (openingMeterReading.unit === 'hours') {
        snap.last_completed_hours = openingMeterReading.value;
      }
      snap.last_completed_at = openingMeterReading.recorded_at;
    } else {
      snap.last_completed_at = new Date().toISOString();
    }
    await admin
      .from('pm_schedules')
      .update(snap)
      .eq('id', item.source_pm_schedule_id);
    linked.snapped_pm_schedule_id = item.source_pm_schedule_id;
  }

  // Linked campaign_assignment → completed
  if (
    item.source === 'campaign_assignment' &&
    item.source_campaign_assignment_id
  ) {
    await admin
      .from('campaign_assignments')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        completed_by_work_order_item_id: item.id,
      })
      .eq('id', item.source_campaign_assignment_id);
    linked.completed_campaign_assignment_id = item.source_campaign_assignment_id;
  }

  return linked;
}

// PM-due calculator — also used by the picker.
export function computePmDue(pm, latestMiles, latestHours) {
  let due = 'unseeded';
  let nextAt = null;
  if (pm.cadence_type === 'miles' && pm.last_completed_miles != null && latestMiles != null) {
    nextAt = pm.last_completed_miles + pm.interval_miles;
    due = latestMiles >= nextAt ? 'overdue' : nextAt - latestMiles < 500 ? 'due_soon' : 'ok';
  } else if (pm.cadence_type === 'hours' && pm.last_completed_hours != null && latestHours != null) {
    nextAt = pm.last_completed_hours + pm.interval_hours;
    due = latestHours >= nextAt ? 'overdue' : nextAt - latestHours < 100 ? 'due_soon' : 'ok';
  } else if (pm.cadence_type === 'months' && pm.last_completed_at) {
    const d = new Date(pm.last_completed_at);
    d.setMonth(d.getMonth() + (pm.interval_months || 0));
    nextAt = d.toISOString();
    const remainingDays = (d.getTime() - Date.now()) / (24 * 3600 * 1000);
    due = remainingDays < 0 ? 'overdue' : remainingDays < 14 ? 'due_soon' : 'ok';
  }
  return { due, next_at: nextAt };
}
