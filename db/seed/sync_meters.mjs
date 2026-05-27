#!/usr/bin/env node
// One-shot CLI: run the meters sync. Same wrapper pattern as
// sync_alvys.mjs. Used during foundation; later replaced by a
// /api/admin/sources/meters/sync endpoint + cron.
//
// Usage:
//   cd ~/delta/api && node --env-file=.env ../db/seed/sync_meters.mjs

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const apiRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'api');

const { syncAllMeters } = await import(
  'file://' + join(apiRoot, 'src', 'sync', 'meters_sync.js')
);

const result = await syncAllMeters();
console.log(JSON.stringify(result, null, 2));
const hadErrors =
  (result.trucks?.errors?.length || 0) > 0 ||
  (result.reefers?.errors?.length || 0) > 0 ||
  result.trucks?.error ||
  result.reefers?.error;
process.exit(hadErrors ? 1 : 0);
