// End-to-end test for /api/chat. Signs in as the bootstrap admin (role
// switched to tech for the duration of the test so the create_work_order
// path through tech-role gating + RLS gets exercised), sends a real chat
// message, asserts the work_orders row landed with approval_status=
// 'pending_review'.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY;
const ADMIN_EMAIL = process.env.ADMIN_BOOTSTRAP_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD;

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
  if (!res.ok) throw new Error(`signIn ${res.status}: ${await res.text()}`);
  return (await res.json()).access_token;
}

describe('POST /api/chat (tool-use end-to-end)', () => {
  const app = createApp();
  let jwt;
  let createdConversations = [];
  let createdWorkOrders = [];

  beforeAll(async () => {
    jwt = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
    // Briefly demote to tech so the create_work_order path goes through
    // tech-role RLS (more realistic). admin's "all" policy would mask
    // RLS issues.
    const admin = getSupabaseAdmin();
    await admin.from('users').update({ role: 'tech' }).eq('email', ADMIN_EMAIL);
  }, 30_000);

  afterAll(async () => {
    const admin = getSupabaseAdmin();
    // Cleanup: void test WOs and delete test conversations.
    if (createdWorkOrders.length) {
      await admin
        .from('work_orders')
        .delete()
        .in('id', createdWorkOrders);
    }
    if (createdConversations.length) {
      await admin
        .from('conversations')
        .delete()
        .in('id', createdConversations);
    }
    // Restore admin role.
    await admin.from('users').update({ role: 'admin' }).eq('email', ADMIN_EMAIL);
  });

  it('400 if message is empty', async () => {
    const res = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${jwt}`)
      .send({ message: '' });
    expect(res.status).toBe(400);
  });

  it('401 if no auth header', async () => {
    const res = await request(app)
      .post('/api/chat')
      .send({ message: 'hi' });
    expect(res.status).toBe(401);
  });

  it(
    'creates a work_order with approval_status=pending_review when a tech narrates a job',
    async () => {
      const res = await request(app)
        .post('/api/chat')
        .set('Authorization', `Bearer ${jwt}`)
        .send({ message: 'Quick test: I did an oil change on CC07 today.' });

      expect(res.status).toBe(200);
      expect(res.body.conversationId).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.body.assistantText).toBeTypeOf('string');
      expect(res.body.assistantText.length).toBeGreaterThan(0);
      // Should mention WO-xxxxxxxx in the reply (the confirmation echo)
      expect(res.body.assistantText).toMatch(/WO-[0-9a-f]{8}/i);
      expect(res.body.createdWorkOrders.length).toBeGreaterThanOrEqual(1);

      const wo = res.body.createdWorkOrders[0];
      expect(wo.asset_unit_number).toMatch(/CC07/i);
      expect(['pm', 'repair']).toContain(wo.type);
      expect(wo.approval_status).toBe('pending_review');

      createdConversations.push(res.body.conversationId);
      createdWorkOrders.push(wo.id);

      // Verify it actually persisted with the right shape
      const admin = getSupabaseAdmin();
      const { data } = await admin
        .from('work_orders')
        .select('id, approval_status, user_id, raw_input, asset_unit_number')
        .eq('id', wo.id)
        .maybeSingle();
      expect(data.approval_status).toBe('pending_review');
      expect(data.raw_input).toMatch(/oil change/i);
    },
    60_000,
  );
});
