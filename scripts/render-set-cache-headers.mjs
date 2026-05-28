#!/usr/bin/env node
// PUT custom cache headers on delta-web via the Render API.
//
// Why this script exists: Render Blueprint (render.yaml) `headers` only
// apply when the service is FIRST created. Subsequent re-syncs ignore
// header changes — they have to be POST'd via the API. This script reads
// the desired headers from render.yaml's intent (kept in sync below) and
// pushes them.
//
// Defense in depth for the "techs see the old bundle" cache bug:
//   - /index.html, /, /sw.js, /workbox-*.js, /manifest.webmanifest →
//       no-store, must-revalidate. Browser AND CDN bypass cache entirely.
//   - /assets/*  → public, immutable, 1 year. Content-hashed; never stale.
//   - /sw.js     → Service-Worker-Allowed: / so the SW can claim the root scope.
//   - /*         → X-Frame-Options: DENY, X-Content-Type-Options: nosniff.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

function loadEnv() {
  const out = {};
  for (const rawLine of readFileSync(join(REPO_ROOT, 'api', '.env'), 'utf8').split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line || /^\s*#/.test(line)) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let val = m[2];
    if (/^".*"$/.test(val) || /^'.*'$/.test(val)) val = val.slice(1, -1);
    else {
      const h = val.indexOf(' #');
      if (h >= 0) val = val.slice(0, h);
      val = val.trim();
    }
    out[m[1]] = val;
  }
  return out;
}

const env = loadEnv();
const ids = JSON.parse(readFileSync(join(REPO_ROOT, '.render-services.json'), 'utf8'));
const H = {
  Authorization: `Bearer ${env.RENDER_API_KEY}`,
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

async function api(method, path, body) {
  const res = await fetch('https://api.render.com/v1' + path, {
    method,
    headers: H,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : null;
}

const NO_STORE = 'no-store, must-revalidate, max-age=0';
const IMMUTABLE = 'public, max-age=31536000, immutable';

// Each entry becomes a Render headers row. Path globs are matched in
// order; the FIRST match wins for a given path+name pair.
const HEADERS = [
  // Security — everywhere.
  { path: '/*', name: 'X-Frame-Options', value: 'DENY' },
  { path: '/*', name: 'X-Content-Type-Options', value: 'nosniff' },
  { path: '/*', name: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },

  // Immutable hashed assets (long cache).
  { path: '/assets/*', name: 'Cache-Control', value: IMMUTABLE },

  // No-store on every entry-pointy file. If the browser caches any of
  // these we're back in stale-bundle territory.
  { path: '/', name: 'Cache-Control', value: NO_STORE },
  { path: '/index.html', name: 'Cache-Control', value: NO_STORE },
  { path: '/sw.js', name: 'Cache-Control', value: NO_STORE },
  { path: '/workbox-*.js', name: 'Cache-Control', value: NO_STORE },
  { path: '/manifest.webmanifest', name: 'Cache-Control', value: NO_STORE },

  // Let the SW claim the root scope.
  { path: '/sw.js', name: 'Service-Worker-Allowed', value: '/' },
];

async function main() {
  console.log(`→ Pushing ${HEADERS.length} header rules to delta-web (${ids.webId})`);
  // Render accepts a full array on PUT — replaces all existing headers.
  await api('PUT', `/services/${ids.webId}/headers`, HEADERS);
  console.log('  ok');

  // Trigger a redeploy (clears CDN edge cache as a side effect).
  console.log('\n→ Triggering manual deploy on delta-web so new headers go live');
  const deploy = await api('POST', `/services/${ids.webId}/deploys`, {
    clearCache: 'clear',
  });
  console.log(`  deploy ${deploy.id} queued (cache cleared)`);

  console.log('\n→ Done. Verify in 1-2 min with:');
  console.log("    curl -sI https://delta.coldcargo.us/index.html | grep -i cache");
  console.log("    curl -sI https://delta.coldcargo.us/sw.js | grep -i cache");
}

main().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
