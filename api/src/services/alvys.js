// Delta — Alvys API service wrapper
// ---------------------------------
// Auth: OAuth client_credentials with audience=https://api.alvys.com/public/.
// Token TTL = 60 min; we cache for 55 (5-min safety per global rules).
// On 401 from any endpoint, invalidate cache, re-auth, retry once.
//
// Response normalization: Alvys CATALOG endpoints (/trucks, /trailers,
// /drivers) return BARE ARRAYS at the top level — not the
// `{ Items / items: [] }` envelope global notes assumed. The
// normalizeResponse() helper handles both shapes defensively.
//
// Pagination: 0-indexed `page`, `pageSize`. Stop when items.length < pageSize.

import { logger } from '../logger.js';
import { config } from '../config.js';

const AUTH_URL = 'https://auth.alvys.com/oauth/token';
const BASE_URL = 'https://integrations.alvys.com/api/p/v1.0';
const AUDIENCE = 'https://api.alvys.com/public/';
const TOKEN_TTL_MS = 55 * 60 * 1000; // refresh 5 min before Alvys's 60-min TTL
const REQUEST_TIMEOUT_MS = 15_000;
const PAGE_SIZE = 50;

let cached = null; // { token, expiresAt }
let inflight = null; // de-dup concurrent auth attempts

function getCreds() {
  const clientId = process.env.ALVYS_CLIENT_ID;
  const clientSecret = process.env.ALVYS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('alvys: ALVYS_CLIENT_ID / ALVYS_CLIENT_SECRET missing');
  }
  return { clientId, clientSecret };
}

async function authenticate() {
  const { clientId, clientSecret } = getCreds();
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    audience: AUDIENCE,
  });
  const t0 = Date.now();
  const res = await fetchWithTimeout(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) {
    const body = await res.text();
    logger.error(
      { status: res.status, body: body.slice(0, 300) },
      'alvys: auth failed',
    );
    throw new Error(`alvys auth failed: ${res.status}`);
  }
  const body = await res.json();
  const token = body.access_token;
  if (!token) throw new Error('alvys auth: no access_token in response');
  cached = { token, expiresAt: Date.now() + TOKEN_TTL_MS };
  logger.info({ ms: Date.now() - t0 }, 'alvys: token acquired');
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

function fetchWithTimeout(url, opts = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: controller.signal }).finally(() =>
    clearTimeout(t),
  );
}

// Normalize Alvys responses: bare array OR { Items: [] } OR { items: [] }
function normalizeResponse(data) {
  if (Array.isArray(data)) return data;
  return data?.Items ?? data?.items ?? [];
}

async function request(path, { method = 'GET', body, query } = {}) {
  let url = BASE_URL + path;
  if (query) {
    const qs = new URLSearchParams(query).toString();
    if (qs) url += (path.includes('?') ? '&' : '?') + qs;
  }

  async function attempt() {
    const token = await getToken();
    return fetchWithTimeout(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }

  const t0 = Date.now();
  let res = await attempt();
  if (res.status === 401) {
    logger.warn({ path }, 'alvys: 401 — invalidating token and retrying');
    invalidateToken();
    res = await attempt();
  }
  const ms = Date.now() - t0;

  if (!res.ok) {
    const text = await res.text();
    logger.error(
      { path, status: res.status, ms, body: text.slice(0, 300) },
      'alvys: request failed',
    );
    throw new Error(`alvys ${method} ${path} → ${res.status}`);
  }
  logger.debug({ path, ms, status: res.status }, 'alvys: request ok');
  return res.json();
}

async function paginate(path) {
  const out = [];
  for (let page = 0; ; page++) {
    const data = await request(path, { query: { page, pageSize: PAGE_SIZE } });
    const items = normalizeResponse(data);
    out.push(...items);
    if (items.length < PAGE_SIZE) break;
    if (page > 200) {
      throw new Error(`alvys: paginate ${path} exceeded 200 pages`);
    }
  }
  return out;
}

// ---- Public catalog readers ------------------------------------------------

export async function listTrucks() {
  return paginate('/trucks');
}

export async function listTrailers() {
  return paginate('/trailers');
}

export async function listDrivers() {
  return paginate('/drivers');
}

// ---- Field mappers ---------------------------------------------------------
// Map Alvys catalog records → Delta `assets` and `drivers` row shapes.

export function mapTruckToAsset(t) {
  return {
    unit_number: t.TruckNum,
    type: 'truck',
    vin: t.VinNumber || null,
    make: t.Make || null,
    model: t.Model || null,
    year: t.Year || null,
    alvys_id: t.Id,
    active: (t.Status || '').toLowerCase() === 'active',
    metadata: {
      license: t.LicenseNum || null,
      license_state: t.LicenseState || null,
      license_expires: t.LicenseExpirationDate || null,
      color: t.Color || null,
      fuel_type: t.FuelType || null,
    },
  };
}

export function mapTrailerToAsset(t) {
  // Trailers can be 'reefer' (EquipmentType === 'Reefer') or generic 'trailer'.
  const equip = (t.EquipmentType || '').toLowerCase();
  const type = equip === 'reefer' ? 'reefer' : 'trailer';
  return {
    unit_number: t.TrailerNum,
    type,
    vin: t.VinNum || null,
    make: t.Make || null,
    model: null,
    year: t.Year || null,
    alvys_id: t.Id,
    active: (t.Status || '').toLowerCase() === 'active',
    metadata: {
      license: t.LicenseNum || null,
      license_state: t.LicenseState || null,
      license_expires: t.LicenseExpiresAt || null,
      equipment_type: t.EquipmentType || null,
      equipment_size: t.EquipmentSize || null,
    },
  };
}

export function mapDriver(d) {
  // Alvys drivers have `Status` (online/offline/off duty — session state)
  // and `IsActive` (employment state). We want the latter. Fall back to
  // TerminatedAt IS NULL if IsActive isn't present on the payload.
  const active =
    typeof d.IsActive === 'boolean' ? d.IsActive : !d.TerminatedAt;
  return {
    full_name: d.Name,
    alvys_id: d.Id,
    phone: d.PhoneNumber || null,
    email: d.Email || null,
    active,
  };
}

// ---- All-in-one sync result shape ------------------------------------------
export async function fetchAllCatalog() {
  const [trucks, trailers, drivers] = await Promise.all([
    listTrucks(),
    listTrailers(),
    listDrivers(),
  ]);
  return {
    assets: [...trucks.map(mapTruckToAsset), ...trailers.map(mapTrailerToAsset)],
    drivers: drivers.map(mapDriver),
  };
}
