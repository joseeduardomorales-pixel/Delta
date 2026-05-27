// Tests for the auth middleware. Sign in as the bootstrap admin via
// Supabase Auth REST, then exercise /me with the resulting JWT.

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY;
const ADMIN_EMAIL = process.env.ADMIN_BOOTSTRAP_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD;

// Helper: sign in via the Supabase Auth REST endpoint, return the JWT.
async function signIn(email, password) {
  const res = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON,
      },
      body: JSON.stringify({ email, password }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`signIn failed: ${res.status} ${body.slice(0, 200)}`);
  }
  return (await res.json()).access_token;
}

describe('auth middleware (via GET /me)', () => {
  const app = createApp();
  let adminJwt;

  beforeAll(async () => {
    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
      throw new Error('ADMIN_BOOTSTRAP_EMAIL + _PASSWORD must be set');
    }
    adminJwt = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
  }, 15_000);

  it('returns 401 with no Authorization header', async () => {
    const res = await request(app).get('/me');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthorized');
    expect(res.body.reason).toMatch(/missing_or_malformed/);
  });

  it('returns 401 for malformed Bearer prefix', async () => {
    const res = await request(app)
      .get('/me')
      .set('Authorization', 'Basic abc.def.ghi');
    expect(res.status).toBe(401);
    expect(res.body.reason).toMatch(/missing_or_malformed/);
  });

  it('returns 401 for empty token after Bearer', async () => {
    const res = await request(app).get('/me').set('Authorization', 'Bearer ');
    expect(res.status).toBe(401);
  });

  it('returns 401 for an obviously invalid JWT', async () => {
    const res = await request(app)
      .get('/me')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
    expect(res.body.reason).toMatch(/invalid|expired/);
  });

  it('returns 200 + admin profile for a valid JWT', async () => {
    const res = await request(app)
      .get('/me')
      .set('Authorization', `Bearer ${adminJwt}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(ADMIN_EMAIL);
    expect(res.body.role).toBe('admin');
    expect(res.body.fullName).toBeTypeOf('string');
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
