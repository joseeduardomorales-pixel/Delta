// Delta — Supabase client (browser).
// Uses the publishable (anon) key + project URL from Vite env vars.
// Persists the session in localStorage so reloads survive.
//
// All three VITE_* env vars are baked into the JS bundle at BUILD time.
// If any is missing during the build, we abort the build (see below) —
// silently shipping a bundle that calls http://localhost:4000 in prod
// is the exact failure mode we hit on first deploy.

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const apiUrl = import.meta.env.VITE_API_URL;
const isProd = import.meta.env.PROD;

if (!url || !anonKey) {
  throw new Error(
    'Delta web: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing — ' +
      'copy .env.example to .env and fill them in.',
  );
}

if (!apiUrl) {
  // In dev, fall back to localhost so `npm run dev` Just Works.
  // In prod, refuse to start — better a blank screen + console error
  // than a bundle that calls localhost forever.
  if (isProd) {
    throw new Error(
      'Delta web: VITE_API_URL is missing in this build. The bundle would ' +
        'otherwise try to call http://localhost:4000 in production. Set ' +
        'VITE_API_URL in Render env vars and rebuild.',
    );
  }
}

// Guard against shipping a bundle that points at localhost. This catches
// the "env var was unset when the build ran" case at the request site too,
// so even if a bundle slips through, the first /api/* call will fail
// loudly with a recognizable error.
if (isProd && (apiUrl?.includes('localhost') || apiUrl?.startsWith('http://'))) {
  throw new Error(
    `Delta web: VITE_API_URL="${apiUrl}" is invalid for production ` +
      '(must be HTTPS, not localhost). Reset it in Render env vars and rebuild.',
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'delta-auth',
  },
});

export const API_URL = apiUrl || 'http://localhost:4000';
