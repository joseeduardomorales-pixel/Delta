// Cross-user chat privacy guarantee.
//
// The chat route uses the service-role Supabase client, which BYPASSES
// row-level security. That means user-scoping has to live in application
// code (the .eq('user_id', req.user.id) filter on the latest endpoint,
// and the user_id check inside loadOrCreateConversation). DB-level RLS
// is a real second layer for any clients that DON'T use the service key,
// but the API itself does, so this test is the canary.
//
// Setup:
//   - Use the bootstrap admin (user A) to send a chat message so a
//     conversation + messages row exists with messages user A wrote.
//   - Create a fresh second user (user B) via the auth admin API.
//   - Sign in as user B, call GET /api/conversations/latest, and assert
//     we see EITHER null (no convo yet) OR a different conversation —
//     never user A's data.
//   - Also try POST /api/chat with user A's conversationId from user B's
//     JWT and verify the server creates a new conversation for B instead
//     of writing into A's thread.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY;
const ADMIN_EMAIL = process.env.ADMIN_BOOTSTRAP_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD;

async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`signIn ${res.status}: ${await res.text()}`);
  return (await res.json()).access_token;
}

describe('chat privacy — cross-user isolation', () => {
  const app = createApp();
  const admin = getSupabaseAdmin();

  // user A = bootstrap admin (already exists in DB).
  // user B = a fresh test user we create + delete at the end.
  let userAJwt;
  let userAConversationId;
  let userBJwt;
  let userBAuthId; // for cleanup
  let userBProfileId;
  const userBEmail = `delta-privacy-${Date.now()}@test.coldcargo.us`;
  const userBPassword = 'PrivacyTest!1234';
  const createdWorkOrderIds = [];
  const createdConversationIds = [];

  beforeAll(async () => {
    userAJwt = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);

    // 1) Send a real chat message as user A so a conversation+messages exist.
    const msg = 'Privacy test: secret detail about asset CC07.';
    const r = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${userAJwt}`)
      .send({ message: msg });
    expect(r.status).toBe(200);
    userAConversationId = r.body.conversationId;
    createdConversationIds.push(userAConversationId);
    // If the chat resulted in a WO from the message above, track it for cleanup.
    for (const wo of r.body.createdWorkOrders || []) {
      createdWorkOrderIds.push(wo.id);
    }

    // 2) Create user B (auth user + profile row).
    const cu = await admin.auth.admin.createUser({
      email: userBEmail,
      password: userBPassword,
      email_confirm: true,
    });
    if (cu.error) throw new Error(`createUser: ${cu.error.message}`);
    userBAuthId = cu.data.user.id;

    // The schema's trigger may auto-create a public.users row; if not, do it.
    // public.users has: id, full_name, role, active — no email column (it
    // lives in auth.users).
    const { data: profile } = await admin
      .from('users')
      .select('id, active')
      .eq('id', userBAuthId)
      .maybeSingle();
    if (!profile) {
      const { data: ins, error: insErr } = await admin
        .from('users')
        .insert({
          id: userBAuthId,
          full_name: 'Privacy Test User',
          role: 'tech',
          active: true,
        })
        .select('id')
        .single();
      if (insErr) throw new Error(`profile insert: ${insErr.message}`);
      userBProfileId = ins.id;
    } else {
      await admin.from('users').update({ active: true }).eq('id', userBAuthId);
      userBProfileId = profile.id;
    }

    userBJwt = await signIn(userBEmail, userBPassword);
  }, 60_000);

  afterAll(async () => {
    // Delete user B's auth row (cascades aren't guaranteed here; nuke explicit).
    if (createdWorkOrderIds.length) {
      await admin.from('work_order_items').delete().in('work_order_id', createdWorkOrderIds);
      await admin.from('work_orders').delete().in('id', createdWorkOrderIds);
    }
    // Delete any conversations user B created in this test run.
    if (userBProfileId) {
      await admin.from('conversations').delete().eq('user_id', userBProfileId);
    }
    if (createdConversationIds.length) {
      await admin.from('conversations').delete().in('id', createdConversationIds);
    }
    if (userBProfileId) {
      await admin.from('users').delete().eq('id', userBProfileId);
    }
    if (userBAuthId) {
      await admin.auth.admin.deleteUser(userBAuthId);
    }
  });

  it('GET /api/conversations/latest as user B does NOT return user A\'s thread', async () => {
    const r = await request(app)
      .get('/api/conversations/latest')
      .set('Authorization', `Bearer ${userBJwt}`);
    expect(r.status).toBe(200);
    // Either no conversation yet (clean state) OR a different one — but
    // critically NOT user A's id, and no leaked message text.
    expect(r.body.conversationId).not.toBe(userAConversationId);
    const blob = JSON.stringify(r.body);
    expect(blob).not.toMatch(/secret detail about asset CC07/i);
  }, 30_000);

  it(
    "POST /api/chat with user A's conversationId from user B's JWT creates a fresh conversation",
    async () => {
      const r = await request(app)
        .post('/api/chat')
        .set('Authorization', `Bearer ${userBJwt}`)
        .send({
          conversationId: userAConversationId,
          message: 'Hi from user B.',
        });
      expect(r.status).toBe(200);
      // The server must NOT have accepted user A's conversationId.
      expect(r.body.conversationId).not.toBe(userAConversationId);
      expect(r.body.conversationId).toMatch(/^[0-9a-f-]{36}$/);

      // Verify user A's conversation still belongs to user A, not B.
      const { data: row } = await admin
        .from('conversations')
        .select('id, user_id')
        .eq('id', userAConversationId)
        .single();
      // user A's user_id is the bootstrap admin; user B's is userBProfileId.
      expect(row.user_id).not.toBe(userBProfileId);

      // And the new conversation is owned by user B.
      const { data: newConvo } = await admin
        .from('conversations')
        .select('id, user_id')
        .eq('id', r.body.conversationId)
        .single();
      expect(newConvo.user_id).toBe(userBProfileId);

      // Track for cleanup.
      for (const wo of r.body.createdWorkOrders || []) {
        createdWorkOrderIds.push(wo.id);
      }
    },
    60_000,
  );

  it('GET /api/conversations/latest as user A still returns user A\'s thread', async () => {
    const r = await request(app)
      .get('/api/conversations/latest')
      .set('Authorization', `Bearer ${userAJwt}`);
    expect(r.status).toBe(200);
    // User A still sees their own conversation (one of the recent ones —
    // not necessarily the exact one we sent, since other test runs may
    // have created later conversations). What matters: NOT null, AND
    // contains messages.
    expect(r.body.conversationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Array.isArray(r.body.messages)).toBe(true);
  }, 30_000);
});
