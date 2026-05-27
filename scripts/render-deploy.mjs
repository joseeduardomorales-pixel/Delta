#!/usr/bin/env node
// Delta — one-shot Render deploy via API.
// Creates delta-api (Node web service) + delta-web (static site),
// pastes in env vars from ~/delta/api/.env, links them to the
// "Delta" project (prj-d8bmt06rnols7397dec0), and prints back the
// service URLs.
//
// Usage:
//   node scripts/render-deploy.mjs
//
// Requires RENDER_API_KEY in api/.env.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const OWNER_ID = 'tea-d621vpe3jp1c73bgn510';
const PROJECT_ID = 'prj-d8bmt06rnols7397dec0';
const ENVIRONMENT_ID = 'evm-d8bmt06rnols7397decg';
const REPO = 'https://github.com/joseeduardomorales-pixel/Delta';
const BRANCH = 'main';

// ---- load env vars from api/.env ------------------------------------------
function loadEnv() {
  const out = {};
  const path = join(REPO_ROOT, 'api', '.env');
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
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
if (!RENDER_KEY) throw new Error('RENDER_API_KEY missing in api/.env');

const RENDER_BASE = 'https://api.render.com/v1';
const H = {
  Authorization: `Bearer ${RENDER_KEY}`,
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

async function api(method, path, body) {
  const res = await fetch(RENDER_BASE + path, {
    method,
    headers: H,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    throw new Error(
      `Render API ${method} ${path} → ${res.status}: ${text.slice(0, 500)}`,
    );
  }
  return parsed;
}

// ---- Pick the env vars we want to pass to each service --------------------
const API_ENV = {
  NODE_ENV: 'production',
  PORT: '10000',
  // FRONTEND_ORIGIN gets set in step 2 after we know the web URL
  SUPABASE_URL: env.SUPABASE_URL,
  SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
  ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
  INTANGLES_VENDOR_ACCESS_TOKEN: env.INTANGLES_VENDOR_ACCESS_TOKEN,
  INTANGLES_BASE_URL:
    env.INTANGLES_BASE_URL ||
    'https://indium-apis.intangles-aws-us-east-1.intangles.us',
  ALVYS_CLIENT_ID: env.ALVYS_CLIENT_ID,
  ALVYS_CLIENT_SECRET: env.ALVYS_CLIENT_SECRET,
  TRACKFLEET_USERCODE: env.TRACKFLEET_USERCODE,
  TRACKFLEET_USERNAME: env.TRACKFLEET_USERNAME,
  TRACKFLEET_PASSWORD: env.TRACKFLEET_PASSWORD,
};

const WEB_ENV = {
  VITE_SUPABASE_URL: env.SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY,
  // VITE_API_URL gets set in step 2 after we know the api URL
};

function toEnvVarArray(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v != null && v !== '')
    .map(([key, value]) => ({ key, value: String(value) }));
}

// ---- main -----------------------------------------------------------------
async function main() {
  console.log('→ Checking for existing Delta services');
  const existing = await api(
    'GET',
    `/services?ownerId=${OWNER_ID}&limit=100`,
  );
  const byName = new Map();
  for (const s of existing) {
    byName.set(s.service.name, s.service);
  }

  // ---- create or update delta-api ----------------------------------------
  let apiService = byName.get('delta-api');
  if (apiService) {
    console.log(`→ delta-api already exists (${apiService.id}) — will update env`);
  } else {
    console.log('→ Creating delta-api');
    const created = await api('POST', '/services', {
      type: 'web_service',
      name: 'delta-api',
      ownerId: OWNER_ID,
      projectId: PROJECT_ID,
      environmentId: ENVIRONMENT_ID,
      repo: REPO,
      branch: BRANCH,
      rootDir: 'api',
      autoDeploy: 'yes',
      envVars: toEnvVarArray(API_ENV),
      serviceDetails: {
        env: 'node',
        runtime: 'node',
        plan: 'starter',
        region: 'oregon',
        healthCheckPath: '/health',
        envSpecificDetails: {
          buildCommand: 'npm install',
          startCommand: 'node src/server.js',
        },
      },
    });
    apiService = created.service;
    console.log(`  created ${apiService.id}`);
  }

  // ---- create or update delta-web ----------------------------------------
  let webService = byName.get('delta-web');
  if (webService) {
    console.log(`→ delta-web already exists (${webService.id}) — will update env`);
  } else {
    console.log('→ Creating delta-web');
    const created = await api('POST', '/services', {
      type: 'static_site',
      name: 'delta-web',
      ownerId: OWNER_ID,
      projectId: PROJECT_ID,
      environmentId: ENVIRONMENT_ID,
      repo: REPO,
      branch: BRANCH,
      rootDir: 'web',
      autoDeploy: 'yes',
      envVars: toEnvVarArray(WEB_ENV),
      serviceDetails: {
        publishPath: './dist',
        buildCommand: 'npm install && npm run build',
      },
    });
    webService = created.service;
    console.log(`  created ${webService.id}`);
  }

  console.log('\nServices:');
  console.log(`  delta-api  ${apiService.id}  →  ${apiService.serviceDetails?.url || '(building)'}`);
  console.log(`  delta-web  ${webService.id}  →  ${webService.serviceDetails?.url || '(building)'}`);

  // ---- save IDs for the stitch step --------------------------------------
  const out = { apiId: apiService.id, webId: webService.id };
  writeFileSync(join(REPO_ROOT, '.render-services.json'), JSON.stringify(out, null, 2));
  console.log(`\nWrote service IDs to .render-services.json`);
}

import { writeFileSync } from 'node:fs';
main().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
