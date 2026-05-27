// Delta — auth middleware
// ------------------------
// Verifies the Supabase JWT on the Authorization header, looks up the
// caller's public.users row (role, full_name, active), and attaches
// the canonical {id, email, fullName, role, jwt} to req.user.
//
// 401 on: missing header, malformed Bearer, invalid/expired JWT, no
// matching public.users row.
// 403 on: deactivated user (active=false), or role check fails.

import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';

// One verifier client — anon key only, used purely for getUser(jwt).
// Lazy so missing env doesn't crash module import in tests.
let _verifier = null;
function getVerifier() {
  if (_verifier) return _verifier;
  if (!config.supabase.url || !config.supabase.anonKey) {
    throw new Error('auth: SUPABASE_URL / SUPABASE_ANON_KEY missing');
  }
  _verifier = createClient(config.supabase.url, config.supabase.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _verifier;
}

function deny(res, status, reason, logCtx = {}) {
  if (status >= 500) {
    logger.error(logCtx, `auth: ${reason}`);
  } else {
    logger.warn(logCtx, `auth: ${reason}`);
  }
  return res.status(status).json({
    error: status === 401 ? 'unauthorized' : 'forbidden',
    reason,
  });
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return deny(res, 401, 'missing_or_malformed_authorization', { path: req.path });
  }
  const jwt = header.slice(7).trim();
  if (!jwt) {
    return deny(res, 401, 'empty_token', { path: req.path });
  }

  // Verify via Supabase (handles signature + expiry).
  let supabaseUser;
  try {
    const { data, error } = await getVerifier().auth.getUser(jwt);
    if (error || !data?.user) {
      return deny(res, 401, 'invalid_or_expired_token', {
        path: req.path,
        err: error?.message,
      });
    }
    supabaseUser = data.user;
  } catch (e) {
    return deny(res, 500, 'verifier_failed', { path: req.path, err: e.message });
  }

  // Look up profile + role via service role (bypasses RLS).
  let profile;
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('users')
      .select('id, role, full_name, active')
      .eq('id', supabaseUser.id)
      .maybeSingle();
    if (error) {
      return deny(res, 500, 'profile_lookup_failed', {
        userId: supabaseUser.id,
        err: error.message,
      });
    }
    profile = data;
  } catch (e) {
    return deny(res, 500, 'profile_lookup_threw', { err: e.message });
  }

  if (!profile) {
    return deny(res, 401, 'no_profile_row', { userId: supabaseUser.id });
  }
  if (profile.active === false) {
    return deny(res, 403, 'inactive_user', { userId: supabaseUser.id });
  }

  req.user = {
    id: profile.id,
    email: supabaseUser.email,
    fullName: profile.full_name,
    role: profile.role,
    jwt,
  };
  next();
}

export function requireRole(...allowedRoles) {
  return function (req, res, next) {
    if (!req.user) {
      return deny(res, 401, 'no_authenticated_user', { path: req.path });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return deny(res, 403, 'role_not_permitted', {
        path: req.path,
        userRole: req.user.role,
        allowed: allowedRoles,
      });
    }
    next();
  };
}

export const requireAdmin = requireRole('admin');
