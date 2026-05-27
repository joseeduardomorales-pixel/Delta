#!/usr/bin/env node
// Attach a custom domain to delta-web on Render, wait for SSL, then
// update delta-api's FRONTEND_ORIGIN. Run after DNS CNAME is in place.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const DOMAIN = 'delta.coldcargo.us';

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
  // 1. List existing custom domains so we're idempotent.
  console.log(`→ Checking existing custom domains on delta-web`);
  const existing = await api('GET', `/services/${ids.webId}/custom-domains`);
  let domain = (existing || []).find((d) => d.customDomain?.name === DOMAIN)?.customDomain;
  if (domain) {
    console.log(`  ${DOMAIN} already attached (${domain.verificationStatus})`);
  } else {
    console.log(`→ Adding ${DOMAIN} to delta-web`);
    const created = await api('POST', `/services/${ids.webId}/custom-domains`, {
      name: DOMAIN,
    });
    domain = created;
    console.log(`  added (id=${domain.id})`);
  }

  // 2. Poll until verified.
  console.log(`→ Waiting for verification + SSL`);
  let verified = false;
  for (let i = 0; i < 30; i++) {
    const list = await api('GET', `/services/${ids.webId}/custom-domains`);
    const found = (list || []).find((d) => d.customDomain?.name === DOMAIN)?.customDomain;
    const status = found?.verificationStatus || 'unknown';
    const cert = found?.publicSuffix || found?.redirectForName || '';
    process.stdout.write(`  [${new Date().toLocaleTimeString()}] ${DOMAIN} → ${status}\n`);
    if (status === 'verified' || status === 'ready') {
      verified = true;
      break;
    }
    if (status === 'failed') {
      throw new Error('verification failed — check Render dashboard');
    }
    await new Promise((r) => setTimeout(r, 10000));
  }
  if (!verified) {
    console.log('  still pending — SSL may take a few more minutes; safe to proceed');
  }

  // 3. Update FRONTEND_ORIGIN on delta-api to the custom domain.
  console.log(`\n→ Updating FRONTEND_ORIGIN on delta-api to https://${DOMAIN}`);
  await api('PUT', `/services/${ids.apiId}/env-vars/FRONTEND_ORIGIN`, {
    value: `https://${DOMAIN}`,
  });
  console.log(`  ok (delta-api will redeploy)`);

  console.log(`\nDone. Once SSL is fully issued, https://${DOMAIN} will serve the app.`);
}

main().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
