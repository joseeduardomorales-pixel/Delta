// Delta — meter_readings sync.
// ----------------------------
// Pulls current mileage (Intangles, in miles) for trucks and current
// reefer hours (TrackFleet) for trailers, inserts new rows into
// public.meter_readings.
//
// Match strategy:
//   - Trucks: Intangles `plate` == assets.unit_number (verified during
//     foundation: both use CC01..CC17).
//   - Trailers: TrackFleet `licence` == assets.unit_number. If a
//     trailer in TrackFleet doesn't match a known asset, it's skipped
//     and logged (not an error — we may have trailers in TrackFleet
//     that aren't yet in Alvys, or vice versa).
//
// Idempotency: we insert a new meter_readings row every time. The
// table is append-only; queries always pull "latest by recorded_at".
// Running sync 5 times in a row creates 5 rows, all valid history.

import { listVehicles as intanglesVehicles } from '../services/intangles.js';
import {
  listCarlist as trackfleetCars,
  getLatestReeferData,
} from '../services/trackfleet.js';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';
import { logger } from '../logger.js';

export async function syncTruckOdometers() {
  const admin = getSupabaseAdmin();
  const result = { source: 'intangles', seen: 0, inserted: 0, skipped: [], errors: [] };

  const vehicles = await intanglesVehicles();
  result.seen = vehicles.length;

  // Cross-reference with assets table to get asset_id.
  const plates = vehicles.map((v) => v.plate).filter(Boolean);
  const { data: assets, error } = await admin
    .from('assets')
    .select('id, unit_number')
    .in('unit_number', plates);
  if (error) {
    result.errors.push(`assets lookup: ${error.message}`);
    return result;
  }
  const byPlate = new Map(
    (assets || []).map((a) => [a.unit_number.toLowerCase(), a.id]),
  );

  const rows = [];
  for (const v of vehicles) {
    if (v.odo_mi == null) {
      result.skipped.push(`${v.plate}: no odo_mi`);
      continue;
    }
    const assetId = byPlate.get((v.plate || '').toLowerCase());
    if (!assetId) {
      result.skipped.push(`${v.plate}: no matching asset`);
      continue;
    }
    rows.push({
      asset_id: assetId,
      unit: 'miles',
      value: Math.round(v.odo_mi),
      source: 'intangles',
      recorded_at: v.last_update?.toISOString() ?? new Date().toISOString(),
      raw_payload: { intangles_id: v.intangles_id, odo_km: v.odo_km, odo_mi: v.odo_mi },
    });
  }

  if (rows.length) {
    const { data, error: insErr } = await admin
      .from('meter_readings')
      .insert(rows)
      .select('id');
    if (insErr) {
      result.errors.push(`meter_readings insert: ${insErr.message}`);
    } else {
      result.inserted = data?.length ?? rows.length;
    }
  }

  return result;
}

export async function syncReeferHours() {
  const admin = getSupabaseAdmin();
  const result = { source: 'trackfleet', seen: 0, inserted: 0, skipped: [], errors: [] };

  // 1. Get TrackFleet trailer licences
  const cars = await trackfleetCars();
  const trailers = cars.filter((c) => c.type === 'trailer');
  result.seen = trailers.length;
  if (trailers.length === 0) return result;

  // 2. Cross-reference with our assets table by unit_number == licence
  const licences = trailers.map((t) => t.licence).filter(Boolean);
  const { data: assets, error: aErr } = await admin
    .from('assets')
    .select('id, unit_number')
    .in('unit_number', licences);
  if (aErr) {
    result.errors.push(`assets lookup: ${aErr.message}`);
    return result;
  }
  const byLicence = new Map(
    (assets || []).map((a) => [a.unit_number.toLowerCase(), a.id]),
  );

  // 3. Pull reefer data for matched trailers only (in chunks of 10
  //    to keep request bodies reasonable).
  const matched = licences.filter((l) => byLicence.has(l.toLowerCase()));
  const unmatched = licences.filter((l) => !byLicence.has(l.toLowerCase()));
  for (const u of unmatched) result.skipped.push(`${u}: no matching asset`);

  if (matched.length === 0) return result;

  // reeferPeriod is slow (~20–40s per trailer batch). Process one
  // trailer at a time with a small window so each call has its own
  // 90s timeout budget. ~30s per trailer × 22 trailers ≈ 11 min worst
  // case — acceptable for a periodic sync, not for a chat turn.
  const CHUNK = 1;
  const rows = [];
  for (let i = 0; i < matched.length; i += CHUNK) {
    const batch = matched.slice(i, i + CHUNK);
    let reeferData;
    try {
      reeferData = await getLatestReeferData(batch, { hoursBack: 24 });
    } catch (e) {
      result.errors.push(`reeferPeriod ${batch.join(',')}: ${e.message}`);
      continue;
    }
    for (const r of reeferData) {
      if (!r.latest) {
        result.skipped.push(`${r.licence}: no reefer data in window`);
        continue;
      }
      const assetId = byLicence.get((r.licence || '').toLowerCase());
      if (!assetId) continue;
      // Prefer engine_hours; fall back to work_hours.
      const value = r.latest.engine_hours ?? r.latest.work_hours;
      if (value == null) {
        result.skipped.push(`${r.licence}: no hours data`);
        continue;
      }
      rows.push({
        asset_id: assetId,
        unit: 'hours',
        value: Math.round(value),
        source: 'trackfleet',
        recorded_at: r.latest.time?.toISOString() ?? new Date().toISOString(),
        raw_payload: {
          work_hours: r.latest.work_hours,
          engine_hours: r.latest.engine_hours,
          continues_mode: r.latest.continues_mode,
          diesel_mode: r.latest.diesel_mode,
          points_in_window: r.points_in_window,
        },
      });
    }
  }

  if (rows.length) {
    const { data, error: insErr } = await admin
      .from('meter_readings')
      .insert(rows)
      .select('id');
    if (insErr) {
      result.errors.push(`meter_readings insert: ${insErr.message}`);
    } else {
      result.inserted = data?.length ?? rows.length;
    }
  }

  return result;
}

export async function syncAllMeters() {
  const t0 = Date.now();
  logger.info('meters-sync: starting');
  const [trucks, reefers] = await Promise.allSettled([
    syncTruckOdometers(),
    syncReeferHours(),
  ]);
  const result = {
    duration_ms: Date.now() - t0,
    trucks: trucks.status === 'fulfilled' ? trucks.value : { error: trucks.reason?.message },
    reefers:
      reefers.status === 'fulfilled' ? reefers.value : { error: reefers.reason?.message },
  };
  logger.info(result, 'meters-sync: complete');
  return result;
}
