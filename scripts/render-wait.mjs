#!/usr/bin/env node
// Watch Render builds until both services are live (or fail).

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
const H = { Authorization: `Bearer ${env.RENDER_API_KEY}`, Accept: 'application/json' };

async function api(path) {
  const res = await fetch('https://api.render.com/v1' + path, { headers: H });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

const TERMINAL = new Set(['live', 'build_failed', 'update_failed', 'canceled', 'deactivated']);
const SUCCESS = new Set(['live']);

async function latestDeploy(serviceId) {
  const list = await api(`/services/${serviceId}/deploys?limit=1`);
  return list[0]?.deploy;
}

async function pollUntilDone(serviceId, name) {
  for (let i = 0; i < 60; i++) {
    const d = await latestDeploy(serviceId);
    const status = d?.status || 'unknown';
    process.stdout.write(`  [${new Date().toLocaleTimeString()}] ${name} → ${status}\n`);
    if (TERMINAL.has(status)) return { status, deploy: d };
    await new Promise((r) => setTimeout(r, 15000));
  }
  return { status: 'timeout' };
}

async function main() {
  console.log('Watching both services. ~3–5 min typical.\n');
  const [api1, web1] = await Promise.all([
    pollUntilDone(ids.apiId, 'delta-api '),
    pollUntilDone(ids.webId, 'delta-web '),
  ]);

  console.log('\nFinal status:');
  console.log('  delta-api:', api1.status);
  console.log('  delta-web:', web1.status);

  const apiSvc = await api(`/services/${ids.apiId}`);
  const webSvc = await api(`/services/${ids.webId}`);
  console.log('\nURLs:');
  console.log('  delta-api:', apiSvc.serviceDetails?.url);
  console.log('  delta-web:', webSvc.serviceDetails?.url);

  process.exit(SUCCESS.has(api1.status) && SUCCESS.has(web1.status) ? 0 : 1);
}

main().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
