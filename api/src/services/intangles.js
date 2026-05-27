// Delta — Intangles telematics wrapper.
// ---------------------------------------
// Auth: single static `vendor-access-token` header on every request.
// Base URL: configurable via INTANGLES_BASE_URL (US region by default).
//
// CRITICAL: Intangles' `odo` field is in KILOMETERS even though the
// field has no unit suffix in the JSON. The Intangles web dashboard
// converts to miles for display. We convert at this boundary so the
// rest of Delta only ever sees miles. There is a unit test that
// pins this conversion — if it ever stops applying, the test fails.
//
// Discovered during foundation validation when API values came back
// ~1.61× higher than the official Intangles odometer report (which
// is in miles). See docs/foundation-v4-plan.md "Risk register".

import { logger } from '../logger.js';

// Public for use in unit tests.
export const KM_PER_MI = 1.609344;
export const KM_TO_MI = 1 / KM_PER_MI; // ≈ 0.621371

/**
 * Convert kilometers to miles, rounded to 2 decimal places.
 * Round-trips cleanly: kmToMi(KM_PER_MI) ≈ 1.0 (within rounding).
 */
export function kmToMi(km) {
  if (km == null || Number.isNaN(km)) return null;
  return Math.round(Number(km) * KM_TO_MI * 100) / 100;
}

const REQUEST_TIMEOUT_MS = 10_000;

function getEnv() {
  const base = process.env.INTANGLES_BASE_URL;
  const token = process.env.INTANGLES_VENDOR_ACCESS_TOKEN;
  if (!base) throw new Error('intangles: INTANGLES_BASE_URL missing');
  if (!token) throw new Error('intangles: INTANGLES_VENDOR_ACCESS_TOKEN missing');
  return { base, token };
}

async function fetchJson(url, { timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const { token } = getEnv();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      headers: { 'vendor-access-token': token, Accept: 'application/json' },
      signal: controller.signal,
    });
    const ms = Date.now() - t0;
    if (!res.ok) {
      const body = await res.text();
      logger.error(
        { url, status: res.status, ms, body: body.slice(0, 200) },
        'intangles: request failed',
      );
      throw new Error(`intangles ${res.status} ${url}`);
    }
    const body = await res.json();
    logger.debug({ url, ms }, 'intangles: request ok');
    return body;
  } finally {
    clearTimeout(t);
  }
}

/**
 * GET /api/v1/vendor/vehicle/list — returns every vehicle the vendor token
 * can see. Normalizes the `odo` (km) and `engine_hours.engine_hour` (hours)
 * into the meter_readings shape on the way out.
 */
export async function listVehicles() {
  const { base } = getEnv();
  const raw = await fetchJson(`${base}/api/v1/vendor/vehicle/list`);
  const vehicles = raw?.result?.vehicles ?? [];
  return vehicles.map((v) => ({
    intangles_id: v.id,
    plate: v.plate,
    vin: v.vin || null,
    odo_km: v.odo ?? null,
    odo_mi: kmToMi(v.odo),
    engine_hours: v.engine_hours?.engine_hour ?? null,
    engine_hours_time: v.engine_hours?.timestamp
      ? new Date(v.engine_hours.timestamp)
      : null,
    state: v.status?.state || null,
    last_update: v.status?.last_update
      ? new Date(v.status.last_update)
      : null,
    health: v.health_info?.health || null,
    raw: v,
  }));
}

/**
 * GET /api/v1/vendor/vehicle/{plate}/{ts_ms}/odometer
 * Fetch odometer at a specific timestamp (or now). Returns miles + raw km
 * + the time of the underlying reading.
 *
 * Note: in practice, Intangles often returns an empty result for exact
 * timestamps it doesn't have a sample for. Prefer listVehicles for
 * "what is X at right now" queries.
 */
export async function getOdometerAt(plate, ts = Date.now()) {
  const { base } = getEnv();
  const url = `${base}/api/v1/vendor/vehicle/${encodeURIComponent(plate)}/${ts}/odometer`;
  const raw = await fetchJson(url);
  const o = raw?.result?.odometer ?? {};
  if (!o.value) return null;
  return {
    plate,
    odo_km: o.value,
    odo_mi: kmToMi(o.value),
    time: o.time ? new Date(o.time) : null,
    raw,
  };
}

/**
 * Distance traveled between two timestamps. Result is in MILES.
 * Intangles returns meters (yes, meters — different unit from `odo`).
 */
export async function getDistance(plate, start, end) {
  const { base } = getEnv();
  const url = `${base}/api/v1/vendor/vehicle/${encodeURIComponent(plate)}/${start}/${end}/distance`;
  const raw = await fetchJson(url);
  const meters = raw?.result?.distance;
  if (meters == null) return null;
  const miles = Math.round((meters / 1000) * KM_TO_MI * 100) / 100;
  return { plate, distance_meters: meters, distance_mi: miles, raw };
}
