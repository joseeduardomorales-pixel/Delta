// Regression guard for the express-router gating bug.
//
// Previously each admin router did:
//     adminRouter.use(requireAuth, requireAdmin)
// without a path argument. In Express, that middleware runs for EVERY
// request that flows through the router — not just requests matching
// one of its routes. Combined with `app.use(adminRouter)` mounting
// at root (no prefix), this meant the admin gate fired on unrelated
// paths whenever the routing chain passed through an admin router
// before reaching the actual handler.
//
// Concrete symptom: GET /api/inspections/:id returned 403
// role_not_permitted for tech users because inspectionsRouter was
// mounted AFTER the admin routers in app.js.
//
// The fix scopes each admin router's gate to its actual path prefix:
//     adminRouter.use('/api/admin/<thing>', requireAuth, requireAdmin)
// so the middleware only fires for /api/admin/<thing>/* requests.
//
// This test asserts both halves of the contract:
//   1. A tech user can hit every NON-admin endpoint without being 403'd
//      by an unrelated admin router's middleware leaking.
//   2. A tech user STILL gets 403'd on actual admin endpoints.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY;
const ADMIN_EMAIL = process.env.ADMIN_BOOTSTRAP_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD;

async function signIn(email, password) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`signIn ${r.status}: ${await r.text()}`);
  return (await r.json()).access_token;
}

describe('admin-router scope — no cross-router 403 leak', () => {
  const app = createApp();
  const admin = getSupabaseAdmin();

  let techJwt;
  let techAuthId;
  let techProfileId;
  const techEmail = `delta-tech-scope-${Date.now()}@test.coldcargo.us`;
  const techPassword = 'TechScope!1234';

  beforeAll(async () => {
    // Create a real tech user via auth admin.
    const cu = await admin.auth.admin.createUser({
      email: techEmail,
      password: techPassword,
      email_confirm: true,
    });
    if (cu.error) throw new Error(`createUser: ${cu.error.message}`);
    techAuthId = cu.data.user.id;

    const { data: profile } = await admin
      .from('users')
      .select('id')
      .eq('id', techAuthId)
      .maybeSingle();
    if (!profile) {
      const { error } = await admin.from('users').insert({
        id: techAuthId,
        full_name: 'Scope Test Tech',
        role: 'tech',
        active: true,
      });
      if (error) throw new Error(`profile insert: ${error.message}`);
    } else {
      await admin.from('users').update({ active: true, role: 'tech' }).eq('id', techAuthId);
    }
    techProfileId = techAuthId;
    techJwt = await signIn(techEmail, techPassword);
  }, 60_000);

  afterAll(async () => {
    if (techProfileId) await admin.from('users').delete().eq('id', techProfileId);
    if (techAuthId) await admin.auth.admin.deleteUser(techAuthId);
  });

  // --- Non-admin endpoints: tech MUST be allowed (200 OK or 200-equivalent
  //     "no data" / "needs param" — anything OTHER than 403). The point is
  //     no role_not_permitted leak from an unrelated admin router.
  const NON_ADMIN_PATHS = [
    { method: 'get', path: '/api/inspection-templates' },
    { method: 'get', path: '/api/work-orders' },
    { method: 'get', path: '/api/conversations/latest' },
    { method: 'get', path: '/api/issues' },
    { method: 'get', path: '/me' },
  ];
  for (const { method, path } of NON_ADMIN_PATHS) {
    it(`${method.toUpperCase()} ${path} is NOT 403 for a tech`, async () => {
      const r = await request(app)
        [method](path)
        .set('Authorization', `Bearer ${techJwt}`);
      expect(r.status).not.toBe(403);
    }, 15_000);
  }

  // --- Admin endpoints: tech MUST get 403.
  const ADMIN_PATHS = [
    { method: 'get', path: '/api/admin/users' },
    { method: 'get', path: '/api/admin/campaigns' },
    { method: 'get', path: '/api/admin/pm-schedules' },
    { method: 'get', path: '/api/admin/work-orders/pending' },
  ];
  for (const { method, path } of ADMIN_PATHS) {
    it(`${method.toUpperCase()} ${path} IS 403 for a tech`, async () => {
      const r = await request(app)
        [method](path)
        .set('Authorization', `Bearer ${techJwt}`);
      expect(r.status).toBe(403);
      expect(r.body).toMatchObject({ error: 'forbidden' });
    }, 15_000);
  }
});
