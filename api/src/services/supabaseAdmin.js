// Server-side Supabase client with the SERVICE ROLE key. Bypasses RLS.
// Use only in trusted server contexts — never expose to the client.

import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

let _admin = null;

export function getSupabaseAdmin() {
  if (_admin) return _admin;
  if (!config.supabase.url) throw new Error('supabaseAdmin: SUPABASE_URL missing');
  if (!config.supabase.serviceRoleKey) {
    throw new Error('supabaseAdmin: SUPABASE_SERVICE_ROLE_KEY missing');
  }
  _admin = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _admin;
}
