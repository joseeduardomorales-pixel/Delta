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
  return { path, mimetype, size: buffer.length };
}

// Move a staging object to its permanent home under a work order.
// We use storage.move() so the underlying bytes don't re-upload.
export async function attachStagingToWorkOrder({
  stagingPath,
  workOrderId,
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

// Issue a short-lived signed URL for viewing a photo from the client.
export async function signedReadUrl(storagePath, expiresInSeconds = 60) {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}
