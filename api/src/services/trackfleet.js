// Delta — TrackFleet (tracking.lt) telematics wrapper.
// ----------------------------------------------------
// Provides reefer engine_hours + work_hours for trailers.
//
// Auth:  POST /auth/{usercode}/authenticate with HTTP Basic
//          header `Authorization: Basic base64(user:pass)`
//        Returns { Authentication: "<JWT>" } with 15-min TTL.
//        Subsequent requests use Authorization: <jwt> (raw, no Bearer).
//
// Token cache: 12 min (3-min safety buffer before the 15-min server TTL).
// On 408 ("Token has expired") from any endpoint: invalidate, re-auth,
// retry once.
//
// Base URL (white-labeled): https://fleet.tracking.lt/api_rest

import { logger } from '../logger.js';

const TOKEN_TTL_MS = 12 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 30_000;
// reeferPeriod pulls historical telemetry and can take 20–40s per
// trailer even on small windows. Give it more headroom.
const REEFER_TIMEOUT_MS = 90_000;

let cached = null; // { token, expiresAt }
let inflight = null;

function getEnv() {
  const base = 'https://fleet.tracking.lt/api_rest';
  const usercode = process.env.TRACKFLEET_USERCODE;
  const username = process.env.TRACKFLEET_USERNAME;
  const password = process.env.TRACKFLEET_PASSWORD;
  if (!usercode || !username || !password) {
    throw new Error(
      'trackfleet: TRACKFLEET_USERCODE / _USERNAME / _PASSWORD missing',
    );
  }
  return { base, usercode, username, password };
}

function fetchWithTimeout(url, opts = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: controller.signal }).finally(() =>
    clearTimeout(t),
  );
}

async function authenticate() {
  const { base, usercode, username, password } = getEnv();
  const basic = Buffer.from(`${username}:${password}`).toString('base64');
  const url = `${base}/auth/${usercode}/authenticate/`;
  const t0 = Date.now();
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text();
    logger.error(
      { status: res.status, body: body.slice(0, 200) },
      'trackfleet: auth failed',
    );
    throw new Error(`trackfleet auth ${res.status}`);
  }
  const body = await res.json();
  const token = body.Authentication;
  if (!token) throw new Error('trackfleet auth: no Authentication field');
  cached = { token, expiresAt: Date.now() + TOKEN_TTL_MS };
  logger.info({ ms: Date.now() - t0 }, 'trackfleet: token acquired');
  return token;
}

async function getToken() {
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  if (inflight) return inflight;
  inflight = authenticate().finally(() => {
    inflight = null;
  });
  return inflight;
}

export function invalidateToken() {
  cached = null;
}

async function request(method, path, body, { timeoutMs } = {}) {
  const { base } = getEnv();
  const url = `${base}${path}`;

  async function attempt() {
    const token = await getToken();
    return fetchWithTimeout(
      url,
      {
        method,
        headers: {
          Authorization: token, // raw JWT — TrackFleet does NOT use "Bearer "
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
      timeoutMs,
    );
  }

  const t0 = Date.now();
  let res = await attempt();
  if (res.status === 408 || res.status === 403) {
    logger.warn({ path, status: res.status }, 'trackfleet: token rejected, retrying');
    invalidateToken();
    res = await attempt();
  }
  const ms = Date.now() - t0;

  if (!res.ok) {
    const text = await res.text();
    logger.error(
      { path, status: res.status, ms, body: text.slice(0, 200) },
      'trackfleet: request failed',
    );
    throw new Error(`trackfleet ${method} ${path} → ${res.status}`);
  }
  logger.debug({ path, ms }, 'trackfleet: request ok');
  return res.json();
}

// ---- Public surface --------------------------------------------------------

/**
 * /cars/{usercode}/carlist — full list of items (cars, trailers, trucks).
 * Each item: { hwid, licence, type, fuel_type, gas_tank, gas_tank2 }
 */
export async function listCarlist() {
  const { usercode } = getEnv();
  const list = await request('GET', `/cars/${usercode}/carlist`);
  return list;
}

/**
 * Fetch reefer telemetry for one or more trailers over a time window.
 * Returns the LATEST reading per trailer with normalized fields:
 *   { licence, work_hours, engine_hours, continues_mode, diesel_mode,
 *     time: Date }
 */
export async function getLatestReeferData(licences, { hoursBack = 48 } = {}) {
  if (!Array.isArray(licences) || licences.length === 0) return [];
  const { usercode } = getEnv();
  const dateTo = new Date().toISOString();
  const dateFrom = new Date(Date.now() - hoursBack * 3600 * 1000).toISOString();
  const requestBody = licences.map((licence) => ({
    licence,
    date_from: dateFrom,
    date_to: dateTo,
  }));
  const data = await request(
    'POST',
    `/trailers/${usercode}/reeferPeriod`,
    requestBody,
    { timeoutMs: REEFER_TIMEOUT_MS },
  );

  return (data || []).map((entry) => {
    const points = Array.isArray(entry.reefer) ? entry.reefer : [];
    if (points.length === 0) {
      return {
        licence: entry.trailer,
        truck: entry.truck || null,
        latest: null,
        points_in_window: 0,
      };
    }
    // The API returns points newest-first by inspection — but defensive sort.
    const sorted = [...points].sort((a, b) => {
      const ta = a.time ? new Date(a.time).getTime() : 0;
      const tb = b.time ? new Date(b.time).getTime() : 0;
      return tb - ta;
    });
    const latest = sorted[0];
    return {
      licence: entry.trailer,
      truck: entry.truck || null,
      latest: {
        time: latest.time ? new Date(latest.time + ' UTC') : null,
        work_hours:
          latest.work_hours != null ? Number(latest.work_hours) : null,
        engine_hours:
          latest.engine_hours != null ? Number(latest.engine_hours) : null,
        continues_mode: latest.continues_mode ?? null,
        diesel_mode: latest.diesel_mode ?? null,
        engine_rpm: latest.engine_rpm ?? null,
      },
      points_in_window: points.length,
    };
  });
}
