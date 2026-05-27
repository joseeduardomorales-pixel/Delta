#!/usr/bin/env node
// Delta bootstrap — create the first admin user and the action-photos
// storage bucket. Idempotent: re-running with the same email is a no-op.
//
// Reads from api/.env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   ADMIN_BOOTSTRAP_EMAIL, ADMIN_BOOTSTRAP_PASSWORD, ADMIN_BOOTSTRAP_FULL_NAME
//
// Usage:
//   cd ~/delta/api && node --env-file=.env ../db/seed/bootstrap_admin.mjs

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const apiNodeModules = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'api', 'node_modules');
const { createClient } = require(join(apiNodeModules, '@supabase', 'supabase-js'));

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  ADMIN_BOOTSTRAP_EMAIL: email,
  ADMIN_BOOTSTRAP_PASSWORD: password,
  ADMIN_BOOTSTRAP_FULL_NAME: fullName,
} = process.env;

function fail(msg) {
  console.error('bootstrap: ' + msg);
  process.exit(1);
}

if (!SUPABASE_URL) fail('SUPABASE_URL missing');
if (!SUPABASE_SERVICE_ROLE_KEY) fail('SUPABASE_SERVICE_ROLE_KEY missing');
if (!email) fail('ADMIN_BOOTSTRAP_EMAIL missing');
if (!password) fail('ADMIN_BOOTSTRAP_PASSWORD missing');
if (!fullName) fail('ADMIN_BOOTSTRAP_FULL_NAME missing');

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const BUCKET = 'action-photos';

async function ensureAuthUser() {
  // Look for an existing user with this email (Admin API doesn't have
  // getByEmail; paginate listUsers and match).
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 50 });
    if (error) fail(`listUsers failed: ${error.message}`);
    const found = data.users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase());
    if (found) return { id: found.id, created: false };
    if (data.users.length < 50) break;
    page += 1;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // skip verification email
    user_metadata: { full_name: fullName, bootstrapped: true },
  });
  if (error) fail(`createUser failed: ${error.message}`);
  return { id: data.user.id, created: true };
}

async function ensureProfileRow(userId) {
  // public.users row must exist with role='admin'. Upsert by id.
  const { data: existing, error: selErr } = await admin
    .from('users')
    .select('id, role, full_name, active')
    .eq('id', userId)
    .maybeSingle();
  if (selErr) fail(`profile select failed: ${selErr.message}`);

  if (!existing) {
    const { error } = await admin
      .from('users')
      .insert({ id: userId, full_name: fullName, role: 'admin', active: true });
    if (error) fail(`profile insert failed: ${error.message}`);
    return 'created';
  }
  if (existing.role !== 'admin' || existing.full_name !== fullName || existing.active !== true) {
    const { error } = await admin
      .from('users')
      .update({ role: 'admin', full_name: fullName, active: true })
      .eq('id', userId);
    if (error) fail(`profile update failed: ${error.message}`);
    return 'updated';
  }
  return 'unchanged';
}

async function ensureBucket() {
  const { data: existing, error: listErr } = await admin.storage.listBuckets();
  if (listErr) fail(`listBuckets failed: ${listErr.message}`);
  if (existing.find((b) => b.id === BUCKET)) return 'unchanged';
  const { error } = await admin.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: 25 * 1024 * 1024, // 25 MB
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
  });
  if (error) fail(`createBucket failed: ${error.message}`);
  return 'created';
}

(async () => {
  const t0 = Date.now();
  console.log(`bootstrap: target project = ${new URL(SUPABASE_URL).hostname}`);
  console.log(`bootstrap: admin email   = ${email}`);

  const authResult = await ensureAuthUser();
  console.log(
    `  auth.users  ${authResult.created ? 'created' : 'already existed'}  (id=${authResult.id})`,
  );

  const profileResult = await ensureProfileRow(authResult.id);
  console.log(`  public.users  ${profileResult}`);

  const bucketResult = await ensureBucket();
  console.log(`  storage.${BUCKET}  ${bucketResult}`);

  console.log(`bootstrap: done in ${Date.now() - t0} ms.`);
})().catch((e) => {
  console.error('bootstrap: unhandled error:', e.message || e);
  process.exit(1);
});
