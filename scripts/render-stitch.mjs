#!/usr/bin/env node
// Delta — stitch FRONTEND_ORIGIN + VITE_API_URL after both Render
// services have URLs. Run after render-deploy.mjs.

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
const RENDER_KEY = env.RENDER_API_KEY;
const ids = JSON.parse(readFileSync(join(REPO_ROOT, '.render-services.json'), 'utf8'));

const H = {
  Authorization: `Bearer ${RENDER_KEY}`,
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
    throw new Error(`Render API ${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function setEnvVar(serviceId, key, value) {
  // Render API: PUT /v1/services/:id/env-vars/:key sets a single var
  return api('PUT', `/services/${serviceId}/env-vars/${encodeURIComponent(key)}`, {
    value: String(value),
  });
}

async function getService(serviceId) {
  return api('GET', `/services/${serviceId}`);
}

async function main() {
  console.log('→ Reading service URLs');
  const apiSvc = await getService(ids.apiId);
  const webSvc = await getService(ids.webId);
  const apiUrl = apiSvc.serviceDetails?.url;
  const webUrl = webSvc.serviceDetails?.url;
  console.log('  delta-api:', apiUrl);
  console.log('  delta-web:', webUrl);
  if (!apiUrl || !webUrl) {
    throw new Error('one of the services has no URL yet — wait a moment and retry');
  }

  console.log('\n→ Setting FRONTEND_ORIGIN on delta-api');
  await setEnvVar(ids.apiId, 'FRONTEND_ORIGIN', webUrl);
  console.log('  ok');

  console.log('→ Setting VITE_API_URL on delta-web');
  await setEnvVar(ids.webId, 'VITE_API_URL', apiUrl);
  console.log('  ok');

  console.log('\nEnv vars stitched. Both services will redeploy automatically.');
  console.log('Watch progress at:');
  console.log('  ', apiSvc.dashboardUrl);
  console.log('  ', webSvc.dashboardUrl);
}

main().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
