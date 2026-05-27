#!/usr/bin/env node
// One-shot script: run the Alvys sync. Used during foundation build
// while the /api/admin/sources/alvys/sync endpoint is still being wired.
// Usage:  cd ~/delta/api && node --env-file=.env ../db/seed/sync_alvys.mjs

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const apiRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'api');

// Use the api/ folder's node_modules + source.
const { syncAlvysCatalog } = await import(
  'file://' + join(apiRoot, 'src', 'sync', 'alvys_sync.js')
);

const result = await syncAlvysCatalog();
console.log(JSON.stringify(result, null, 2));
process.exit(result.errors.length > 0 ? 1 : 0);
