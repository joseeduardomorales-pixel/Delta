// Delta — Supabase client (browser).
// Uses the publishable (anon) key + project URL from Vite env vars.
// Persists the session in localStorage so reloads survive.

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Delta web: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing — ' +
      'copy .env.example to .env and fill them in.',
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

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
