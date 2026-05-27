// Centralized env access. Load dotenv ONCE here, before anything else.
//
// `override: true` is intentional. The auto-import `import 'dotenv/config'`
// uses override:false, which means any shell env (including empty strings
// like ANTHROPIC_API_KEY="" set by other tools) shadows our local .env
// values. Override here so the developer's .env always wins in development.
// In production, Render injects directly into process.env and no .env file
// is present, so this flag has no effect.
import * as dotenv from 'dotenv';
dotenv.config({ override: true });

// Treat empty-string env vars the same as unset.
for (const k of Object.keys(process.env)) {
  if (process.env[k] === '') delete process.env[k];
}

function required(name) {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Delta API: required env var ${name} is missing`);
  }
  return value;
}

function optional(name, fallback = undefined) {
  const value = process.env[name];
  return value && value.trim() !== '' ? value : fallback;
}

export const config = {
  env: optional('NODE_ENV', 'development'),
  port: Number.parseInt(optional('PORT', '4000'), 10),
  version: optional('npm_package_version', '0.0.0'),
  frontendOrigin: optional('FRONTEND_ORIGIN', 'http://localhost:5173'),
  supabase: {
    url: optional('SUPABASE_URL'),
    anonKey: optional('SUPABASE_ANON_KEY'),
    serviceRoleKey: optional('SUPABASE_SERVICE_ROLE_KEY'),
  },
  anthropic: {
    apiKey: optional('ANTHROPIC_API_KEY'),
  },
  intangles: {
    clientId: optional('INTANGLES_CLIENT_ID'),
    clientSecret: optional('INTANGLES_CLIENT_SECRET'),
  },
};

export const requiredEnv = required;
