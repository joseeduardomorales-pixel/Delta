// End-to-end test for /api/chat. Signs in as the bootstrap admin (role
// switched to tech for the duration of the test so the log_completed_work
// path through tech-role gating + RLS gets exercised), sends a real chat
// message, asserts the work_orders row landed with approval_status=
// 'pending_review' AND has an item with the right type.

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
    // Cleanup: delete items first (FK), then WOs, then conversations.
    if (createdWorkOrders.length) {
      await admin
        .from('work_order_items')
        .delete()
        .in('work_order_id', createdWorkOrders);
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
        // Include the odometer inline so the test doesn't depend on
        // telematics freshness. (FRESH_MS = 24h; if Alvys sync didn't
        // run in the last day the tool would correctly ask for a meter
        // and the test would flake.)
        .send({ message: 'Quick test: I did an oil change on CC07 today, odometer 587000.' });

      expect(res.status).toBe(200);
      expect(res.body.conversationId).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.body.assistantText).toBeTypeOf('string');
      expect(res.body.assistantText.length).toBeGreaterThan(0);
      // Should mention WO-<handle>-<seq> in the reply (the confirmation echo
      // — schema 0007 replaced the hex short-id with WO-1001-0042 style).
      expect(res.body.assistantText).toMatch(/WO-\d{4}-\d{4}/);
      expect(res.body.createdWorkOrders.length).toBeGreaterThanOrEqual(1);

      const wo = res.body.createdWorkOrders[0];
      expect(wo.asset_unit_number).toMatch(/CC07/i);
      // Post-redesign: WO no longer has type/title; check the item instead.

      createdConversations.push(res.body.conversationId);
      createdWorkOrders.push(wo.id);

      // Verify the WO + at least one item with the expected shape.
      const admin = getSupabaseAdmin();
      const { data: woRow } = await admin
        .from('work_orders')
        .select('id, approval_status, user_id, asset_unit_number, status, summary')
        .eq('id', wo.id)
        .maybeSingle();
      expect(woRow.approval_status).toBe('pending_review');
      expect(woRow.asset_unit_number).toMatch(/CC07/i);

      const { data: items } = await admin
        .from('work_order_items')
        .select('id, type, title, status, raw_input, source')
        .eq('work_order_id', wo.id);
      expect(items.length).toBeGreaterThanOrEqual(1);
      const item = items[0];
      expect(['pm', 'repair', 'inspection', 'other']).toContain(item.type);
      expect(item.status).toBe('done');
      expect(item.raw_input).toMatch(/oil change/i);
    },
    60_000,
  );
});
