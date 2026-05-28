// /api/admin/users/* — admin user management endpoints.
//
//   GET    /api/admin/users                       list users (auth + profile)
//   POST   /api/admin/users                       create user (auth + profile)
//   PATCH  /api/admin/users/:id                   update role / active / name / phone
//   POST   /api/admin/users/:id/reset-password    set a new password on auth.users
//   DELETE /api/admin/users/:id                   hard-delete (auth + profile)
//
// Admin-only via requireAuth + requireAdmin.

import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';
import { logger } from '../logger.js';

export const adminUsersRouter = Router();
// Scope to the actual path prefix — see admin_work_orders.js for the
// underlying bug (unscoped .use middleware 403s unrelated paths).
adminUsersRouter.use('/api/admin/users', requireAuth, requireAdmin);

const VALID_ROLES = new Set(['admin', 'dispatcher', 'tech', 'driver']);

// ---- GET /api/admin/users --------------------------------------------------
// Join auth.users (email) with public.users (role, full_name, active) for
// the admin's overview table.
adminUsersRouter.get('/api/admin/users', async (req, res) => {
  const admin = getSupabaseAdmin();

  // Pull both lists. auth.admin.listUsers is paginated; we page until done.
  const authUsers = [];
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 100,
    });
    if (error) {
      return res.status(500).json({ error: 'auth_listUsers: ' + error.message });
    }
    authUsers.push(...data.users);
    if (data.users.length < 100) break;
    page += 1;
    if (page > 50) break; // safety cap
  }

  const { data: profiles, error: pErr } = await admin
    .from('users')
    .select('id, full_name, role, phone, active, created_at, updated_at');
  if (pErr) {
    return res.status(500).json({ error: 'profiles: ' + pErr.message });
  }

  // Stitch by id.
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const rows = authUsers
    .map((u) => {
      const p = profileById.get(u.id);
      return {
        id: u.id,
        email: u.email,
        email_confirmed_at: u.email_confirmed_at,
        last_sign_in_at: u.last_sign_in_at,
        created_at: u.created_at,
        // Profile fields (may be null if no profile row exists — shouldn't
        // happen in practice, but the UI handles it).
        full_name: p?.full_name ?? null,
        role: p?.role ?? null,
        phone: p?.phone ?? null,
        active: p?.active ?? true,
      };
    })
    .sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email));

  res.json({ users: rows, count: rows.length });
});

// ---- POST /api/admin/users -------------------------------------------------
// Creates auth.users + public.users in one shot. Returns the new id.
// Body: { email, full_name, role, phone?, temp_password }
adminUsersRouter.post('/api/admin/users', async (req, res) => {
  const { email, full_name, role, phone, temp_password } = req.body || {};
  if (typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'invalid_email' });
  }
  if (typeof full_name !== 'string' || !full_name.trim()) {
    return res.status(400).json({ error: 'full_name_required' });
  }
  if (!VALID_ROLES.has(role)) {
    return res.status(400).json({ error: 'invalid_role' });
  }
  if (typeof temp_password !== 'string' || temp_password.length < 8) {
    return res.status(400).json({ error: 'password_min_8' });
  }
  const admin = getSupabaseAdmin();

  // Create the auth user first.
  const { data: authData, error: authErr } = await admin.auth.admin.createUser({
    email: email.trim().toLowerCase(),
    password: temp_password,
    email_confirm: true,
    user_metadata: { full_name: full_name.trim(), bootstrapped_by: req.user.id },
  });
  if (authErr) {
    logger.warn({ err: authErr.message, email }, 'admin.createUser failed');
    return res.status(400).json({ error: authErr.message });
  }
  const newId = authData.user.id;

  // Then the profile row.
  const { error: pErr } = await admin.from('users').insert({
    id: newId,
    full_name: full_name.trim(),
    role,
    phone: phone || null,
    active: true,
  });
  if (pErr) {
    // Compensate: delete the auth user we just created to avoid orphans.
    await admin.auth.admin.deleteUser(newId).catch(() => {});
    return res.status(500).json({ error: 'profile_insert: ' + pErr.message });
  }

  await admin.from('audit_log').insert({
    actor_user_id: req.user.id,
    action: 'user_create',
    target_table: 'users',
    target_id: newId,
    after: { email: email.trim().toLowerCase(), full_name, role },
  });

  res.status(201).json({
    user: { id: newId, email: email.trim().toLowerCase(), full_name, role, active: true },
  });
});

// ---- PATCH /api/admin/users/:id --------------------------------------------
// Body: { role?, active?, full_name?, phone? }
adminUsersRouter.patch('/api/admin/users/:id', async (req, res) => {
  const { id } = req.params;
  if (id === req.user.id) {
    return res.status(400).json({ error: 'cannot_modify_self' });
  }
  const update = {};
  if (typeof req.body?.role === 'string') {
    if (!VALID_ROLES.has(req.body.role)) {
      return res.status(400).json({ error: 'invalid_role' });
    }
    update.role = req.body.role;
  }
  if (typeof req.body?.active === 'boolean') update.active = req.body.active;
  if (typeof req.body?.full_name === 'string' && req.body.full_name.trim()) {
    update.full_name = req.body.full_name.trim();
  }
  if (typeof req.body?.phone === 'string') update.phone = req.body.phone;

  if (Object.keys(update).length === 0) {
    return res.status(400).json({ error: 'no_fields_to_update' });
  }

  const admin = getSupabaseAdmin();
  const { data: before } = await admin
    .from('users')
    .select('id, role, active, full_name, phone')
    .eq('id', id)
    .maybeSingle();
  if (!before) return res.status(404).json({ error: 'user_not_found' });

  const { data: after, error } = await admin
    .from('users')
    .update(update)
    .eq('id', id)
    .select('id, role, active, full_name, phone')
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });

  await admin.from('audit_log').insert({
    actor_user_id: req.user.id,
    action: 'user_update',
    target_table: 'users',
    target_id: id,
    before,
    after: update,
  });

  res.json({ user: after });
});

// ---- POST /api/admin/users/:id/reset-password ------------------------------
// Set a new password on auth.users. Body: { new_password: string }. Admin
// hands the new password to the user out-of-band (SMS, paper, etc.).
// Audit log records the action — but never the password itself.
adminUsersRouter.post('/api/admin/users/:id/reset-password', async (req, res) => {
  const { id } = req.params;
  const { new_password } = req.body || {};
  if (typeof new_password !== 'string' || new_password.length < 8) {
    return res.status(400).json({ error: 'password_min_8' });
  }
  if (id === req.user.id) {
    return res.status(400).json({
      error: 'cannot_reset_own_password',
      message: 'Use the regular password-reset flow for your own account.',
    });
  }
  const admin = getSupabaseAdmin();
  const { error } = await admin.auth.admin.updateUserById(id, { password: new_password });
  if (error) {
    logger.warn({ err: error.message, id }, 'admin: reset_password failed');
    return res.status(400).json({ error: error.message });
  }
  await admin.from('audit_log').insert({
    actor_user_id: req.user.id,
    action: 'user_password_reset',
    target_table: 'users',
    target_id: id,
    // Never persist the password.
    after: { reset_at: new Date().toISOString() },
  });
  res.json({ ok: true });
});

// ---- DELETE /api/admin/users/:id -------------------------------------------
// Hard-delete both auth.users AND public.users. Use when removing a person
// permanently OR cleaning up orphans (auth.users rows without a public
// profile). Refuses to delete the caller.
adminUsersRouter.delete('/api/admin/users/:id', async (req, res) => {
  const { id } = req.params;
  if (id === req.user.id) {
    return res.status(400).json({ error: 'cannot_delete_self' });
  }
  const admin = getSupabaseAdmin();

  // Snapshot what we're deleting for the audit log.
  const [{ data: profile }, { data: authData }] = await Promise.all([
    admin.from('users').select('id, full_name, role, active').eq('id', id).maybeSingle(),
    admin.auth.admin.getUserById(id),
  ]);
  const before = {
    profile,
    auth: authData?.user
      ? {
          email: authData.user.email,
          created_at: authData.user.created_at,
          last_sign_in_at: authData.user.last_sign_in_at,
        }
      : null,
  };

  // Delete the auth.users row — cascade in the DB removes public.users
  // (ON DELETE CASCADE on the FK). If the profile didn't exist, no-op.
  const { error: delErr } = await admin.auth.admin.deleteUser(id);
  if (delErr) {
    // If the auth user doesn't exist, still try to clean up an orphan
    // public.users row (rare, but possible if something failed mid-create).
    if (/not found/i.test(delErr.message)) {
      if (profile) await admin.from('users').delete().eq('id', id);
      await admin.from('audit_log').insert({
        actor_user_id: req.user.id,
        action: 'user_delete_orphan_profile',
        target_table: 'users',
        target_id: id,
        before,
      });
      return res.json({ ok: true, note: 'auth_user_not_found_profile_cleaned' });
    }
    logger.warn({ err: delErr.message, id }, 'admin: delete user failed');
    return res.status(400).json({ error: delErr.message });
  }

  await admin.from('audit_log').insert({
    actor_user_id: req.user.id,
    action: 'user_delete',
    target_table: 'users',
    target_id: id,
    before,
  });

  res.json({ ok: true });
});
