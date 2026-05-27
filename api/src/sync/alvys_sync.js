// Delta — Alvys → Supabase sync.
// Pulls trucks/trailers/drivers from Alvys, upserts to public.assets and
// public.drivers. Idempotent: ON CONFLICT (alvys_id) DO UPDATE.

import { fetchAllCatalog } from '../services/alvys.js';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';
import { logger } from '../logger.js';

export async function syncAlvysCatalog() {
  const t0 = Date.now();
  logger.info('alvys-sync: starting');

  const { assets, drivers } = await fetchAllCatalog();
  const admin = getSupabaseAdmin();

  // ---- assets upsert (by alvys_id) -----------------------------------------
  const result = {
    assets_seen: assets.length,
    assets_upserted: 0,
    drivers_seen: drivers.length,
    drivers_upserted: 0,
    errors: [],
  };

  // Skip rows where alvys_id is missing — can't be reconciled.
  const validAssets = assets.filter((a) => {
    if (!a.alvys_id) {
      result.errors.push(`asset missing alvys_id: ${JSON.stringify(a).slice(0, 120)}`);
      return false;
    }
    if (!a.unit_number) {
      result.errors.push(`asset missing unit_number for alvys_id ${a.alvys_id}`);
      return false;
    }
    return true;
  });

  if (validAssets.length) {
    const { data, error } = await admin
      .from('assets')
      .upsert(validAssets, { onConflict: 'alvys_id', ignoreDuplicates: false })
      .select('id');
    if (error) {
      logger.error({ err: error }, 'alvys-sync: assets upsert failed');
      result.errors.push(`assets upsert: ${error.message}`);
    } else {
      result.assets_upserted = data?.length ?? validAssets.length;
    }
  }

  // ---- drivers upsert (by alvys_id) ----------------------------------------
  const validDrivers = drivers.filter((d) => {
    if (!d.alvys_id) {
      result.errors.push(`driver missing alvys_id: ${JSON.stringify(d).slice(0, 120)}`);
      return false;
    }
    return true;
  });

  if (validDrivers.length) {
    const { data, error } = await admin
      .from('drivers')
      .upsert(validDrivers, { onConflict: 'alvys_id', ignoreDuplicates: false })
      .select('id');
    if (error) {
      logger.error({ err: error }, 'alvys-sync: drivers upsert failed');
      result.errors.push(`drivers upsert: ${error.message}`);
    } else {
      result.drivers_upserted = data?.length ?? validDrivers.length;
    }
  }

  result.duration_ms = Date.now() - t0;
  logger.info(result, 'alvys-sync: complete');
  return result;
}
