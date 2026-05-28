// Delta — server-side helpers for the action-photos bucket.
//
// Object key conventions:
//   staging/{user_id}/{uuid}.{ext}            — fresh upload, not yet linked
//   work-orders/{wo_id}/{uuid}.{ext}          — linked to a work_order
//
// Staging files older than 24h can be garbage-collected (cron, later).

import { getSupabaseAdmin } from './supabaseAdmin.js';
import { logger } from '../logger.js';
import { randomUUID } from 'node:crypto';

const BUCKET = 'action-photos';
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);
const MAX_BYTES = 25 * 1024 * 1024;

export function pickExtension(mime, originalName) {
  // Prefer mime-derived extension; fall back to filename suffix.
  const m = (mime || '').toLowerCase();
  if (m === 'image/jpeg') return 'jpg';
  if (m === 'image/png') return 'png';
  if (m === 'image/webp') return 'webp';
  if (m === 'image/heic') return 'heic';
  if (m === 'image/heif') return 'heif';
  const dot = (originalName || '').lastIndexOf('.');
  if (dot > 0) return (originalName.slice(dot + 1) || 'bin').toLowerCase();
  return 'bin';
}

export function validateUpload({ mimetype, size }) {
  if (!ALLOWED_MIME.has((mimetype || '').toLowerCase())) {
    return { ok: false, reason: 'unsupported_mime', mimetype };
  }
  if (size > MAX_BYTES) {
    return { ok: false, reason: 'too_large', size, limit: MAX_BYTES };
  }
  return { ok: true };
}

export async function uploadToStaging({ userId, buffer, mimetype, originalName }) {
  const admin = getSupabaseAdmin();
  const ext = pickExtension(mimetype, originalName);
  const path = `staging/${userId}/${randomUUID()}.${ext}`;
  const { error } = await admin.storage.from(BUCKET).upload(path, buffer, {
    contentType: mimetype,
    upsert: false,
  });
  if (error) {
    logger.error({ err: error.message, path }, 'storage: staging upload failed');
    throw new Error(error.message);
  }
  // Field is named `staging_path` to match what every client reads.
  // (We had a long-standing silent regression: the function used to
  // return `path` and the clients read `u.staging_path` → undefined.)
  return { staging_path: path, mimetype, size: buffer.length };
}

// Move a staging object to its permanent home under a work order.
// We use storage.move() so the underlying bytes don't re-upload.
export async function attachStagingToWorkOrder({
  stagingPath,
  workOrderId,
  workOrderItemId, // optional — set when the photo belongs to a specific item
  uploadedBy,
  caption,
}) {
  const admin = getSupabaseAdmin();

  // Sanity check the staging path shape.
  if (!stagingPath.startsWith('staging/')) {
    throw new Error(`invalid staging path: ${stagingPath}`);
  }
  const filename = stagingPath.split('/').pop();
  const destPath = `work-orders/${workOrderId}/${filename}`;

  const { error: mvErr } = await admin.storage.from(BUCKET).move(stagingPath, destPath);
  if (mvErr) {
    logger.error(
      { err: mvErr.message, from: stagingPath, to: destPath },
      'storage: move failed',
    );
    throw new Error(mvErr.message);
  }

  const { data, error: insErr } = await admin
    .from('action_photos')
    .insert({
      work_order_id: workOrderId,
      work_order_item_id: workOrderItemId ?? null,
      storage_path: destPath,
      caption: caption ?? null,
      uploaded_by: uploadedBy,
    })
    .select('id, storage_path')
    .single();
  if (insErr) {
    logger.error(
      { err: insErr.message, destPath },
      'storage: action_photos insert failed',
    );
    throw new Error(insErr.message);
  }
  logger.info({ destPath, action_photo_id: data.id }, 'storage: photo attached');
  return data;
}

// Delete a photo — drops the storage object AND the action_photos row.
// Caller is responsible for authorization (e.g. owning the WO).
export async function deletePhotoById(photoId) {
  const admin = getSupabaseAdmin();
  const { data: row, error: rowErr } = await admin
    .from('action_photos')
    .select('id, storage_path')
    .eq('id', photoId)
    .maybeSingle();
  if (rowErr) throw new Error(rowErr.message);
  if (!row) return { ok: true, missing: true };
  // Storage delete is best-effort — DB row removal is the source of truth.
  await admin.storage.from(BUCKET).remove([row.storage_path]).catch((e) => {
    logger.warn({ err: e?.message, path: row.storage_path }, 'storage: delete file failed');
  });
  const { error: delErr } = await admin.from('action_photos').delete().eq('id', photoId);
  if (delErr) throw new Error(delErr.message);
  return { ok: true };
}

// Issue a short-lived signed URL for viewing a photo from the client.
export async function signedReadUrl(storagePath, expiresInSeconds = 60) {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}
