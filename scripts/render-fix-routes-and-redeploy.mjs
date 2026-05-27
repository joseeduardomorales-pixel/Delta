#!/usr/bin/env node
// Two post-deploy fixes:
//   1. Add SPA rewrite (/* → /index.html) to delta-web so client-side
//      routing works on the deployed static site.
//   2. Trigger a manual deploy on delta-api so the updated
//      FRONTEND_ORIGIN env var takes effect (PUT on a single env-var
//      doesn't always restart the container on Render).

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
    else { const h = val.indexOf(' #'); if (h >= 0) val = val.slice(0, h); val = val.trim(); }
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

async function main() {
  // 1. SPA rewrite on delta-web
  console.log('→ Adding SPA rewrite rule (/* → /index.html) to delta-web');
  try {
    await api('PUT', `/services/${ids.webId}/routes`, [
      { type: 'rewrite', source: '/*', destination: '/index.html' },
    ]);
    console.log('  ok');
  } catch (e) {
    console.log('  PUT failed, trying POST:', e.message.slice(0, 200));
    // Some Render endpoints prefer POST for the first rule
    await api('POST', `/services/${ids.webId}/routes`, {
      type: 'rewrite',
      source: '/*',
      destination: '/index.html',
    });
    console.log('  ok (via POST)');
  }

  // 2. Trigger manual deploy on delta-api so the new FRONTEND_ORIGIN
  //    actually takes effect.
  console.log('\n→ Triggering manual deploy on delta-api');
  const deploy = await api('POST', `/services/${ids.apiId}/deploys`, {
    clearCache: 'do_not_clear',
  });
  console.log(`  deploy ${deploy.id} queued`);
}

main().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
