// Inspection local store — IndexedDB-backed source of truth for in-progress
// inspections on this device.
//
// Three object stores:
//
//   inspection_cache
//     Keyed by inspection_id. Holds the last-known server snapshot of an
//     inspection (template, items with their results, photo metadata).
//     Refreshed on mount when online; read-from-only when offline. The
//     runner UI renders from this store, never directly from server data.
//
//   pending_actions
//     Queue of PATCH/POST calls waiting to be sent to the server. One
//     entry per (inspection_id + item_id) for item marks — newest tap
//     replaces older queued entry (last-write-wins per item). Also holds
//     finalize actions (POST /complete) and remove_photo intents.
//     Each entry: { id, kind, inspection_id, item_id, payload, attempts,
//                   status: 'queued'|'syncing'|'needs_attention',
//                   error?, photo_ids?: string[], created_at, updated_at }
//
//   pending_photos
//     Photo blobs waiting to be uploaded to /api/uploads. Each entry:
//       { id (local uuid), inspection_id, item_id, blob, mime,
//         created_at, status: 'queued'|'uploading'|'uploaded'|'failed',
//         staging_path? (set after a successful /api/uploads call) }
//
// All async functions return resolved Promises with the new state when
// successful. They throw on schema/DB errors. Callers can subscribe to
// per-inspection updates via subscribe(inspectionId, cb).

import { openDB } from 'idb';

const DB_NAME = 'delta-inspections';
const DB_VERSION = 1;

let _dbPromise = null;

function getDb() {
  if (!_dbPromise) {
    _dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('inspection_cache')) {
          db.createObjectStore('inspection_cache', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('pending_actions')) {
          const s = db.createObjectStore('pending_actions', { keyPath: 'id' });
          s.createIndex('by_inspection', 'inspection_id');
          s.createIndex('by_status', 'status');
        }
        if (!db.objectStoreNames.contains('pending_photos')) {
          const s = db.createObjectStore('pending_photos', { keyPath: 'id' });
          s.createIndex('by_inspection_item', ['inspection_id', 'item_id']);
          s.createIndex('by_status', 'status');
        }
      },
    });
  }
  return _dbPromise;
}

// ── Pub/sub for in-process subscribers ─────────────────────────────────────
const subscribers = new Map(); // inspection_id → Set<cb>

function notify(inspectionId) {
  const set = subscribers.get(inspectionId);
  if (!set) return;
  for (const cb of set) {
    try {
      cb();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('store subscriber threw', e);
    }
  }
  // Also notify global "any change" listeners (registered with key '*').
  const all = subscribers.get('*');
  if (all) {
    for (const cb of all) {
      try {
        cb();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('store subscriber threw', e);
      }
    }
  }
}

export function subscribe(inspectionId, cb) {
  const key = inspectionId || '*';
  if (!subscribers.has(key)) subscribers.set(key, new Set());
  subscribers.get(key).add(cb);
  return () => subscribers.get(key)?.delete(cb);
}

// ── inspection_cache ────────────────────────────────────────────────────────
export async function putInspectionCache(snapshot) {
  // snapshot shape mirrors the server's GET /api/inspections/:id response:
  //   { id, work_order_id, ..., template, sections: [{section, items: [...]}] }
  if (!snapshot?.id) throw new Error('snapshot.id required');
  const db = await getDb();
  await db.put('inspection_cache', { ...snapshot, _cached_at: Date.now() });
  notify(snapshot.id);
}

export async function getInspectionCache(inspectionId) {
  const db = await getDb();
  return db.get('inspection_cache', inspectionId);
}

// ── pending_actions ────────────────────────────────────────────────────────
// Item-mark actions are deduped by (inspection_id, item_id) — newest tap
// replaces older. Finalize/other actions get unique ids.
function actionIdFor({ kind, inspection_id, item_id }) {
  if (kind === 'mark_item') {
    return `mark:${inspection_id}:${item_id}`;
  }
  if (kind === 'finalize') {
    return `finalize:${inspection_id}`;
  }
  if (kind === 'update_pm_info') {
    return `pm:${inspection_id}`;
  }
  return `${kind}:${inspection_id}:${crypto.randomUUID()}`;
}

export async function enqueueAction({
  kind, // 'mark_item' | 'finalize'
  inspection_id,
  item_id,
  payload,
  photo_ids, // optional — local IDs from pending_photos this action depends on
}) {
  if (!kind || !inspection_id) throw new Error('kind + inspection_id required');
  const db = await getDb();
  const id = actionIdFor({ kind, inspection_id, item_id });
  const now = Date.now();
  const existing = await db.get('pending_actions', id);
  const action = {
    id,
    kind,
    inspection_id,
    item_id: item_id ?? null,
    payload,
    photo_ids: photo_ids ?? [],
    attempts: 0,
    status: 'queued',
    error: null,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
  await db.put('pending_actions', action);
  notify(inspection_id);
  return action;
}

export async function getActionsForInspection(inspectionId) {
  const db = await getDb();
  return db.getAllFromIndex('pending_actions', 'by_inspection', inspectionId);
}

export async function getAllQueuedActions() {
  const db = await getDb();
  const tx = db.transaction('pending_actions', 'readonly');
  const all = await tx.store.getAll();
  return all.filter((a) => a.status !== 'needs_attention');
}

export async function getActionsByStatus(status) {
  const db = await getDb();
  return db.getAllFromIndex('pending_actions', 'by_status', status);
}

export async function updateActionStatus(id, patch) {
  const db = await getDb();
  const current = await db.get('pending_actions', id);
  if (!current) return null;
  const next = { ...current, ...patch, updated_at: Date.now() };
  await db.put('pending_actions', next);
  notify(current.inspection_id);
  return next;
}

export async function deleteAction(id) {
  const db = await getDb();
  const current = await db.get('pending_actions', id);
  await db.delete('pending_actions', id);
  if (current?.inspection_id) notify(current.inspection_id);
}

// ── pending_photos ────────────────────────────────────────────────────────
export async function addPhoto({ inspection_id, item_id, blob, mime }) {
  if (!inspection_id || !item_id || !blob) {
    throw new Error('inspection_id + item_id + blob required');
  }
  const db = await getDb();
  const photo = {
    id: crypto.randomUUID(),
    inspection_id,
    item_id,
    blob,
    mime: mime || blob.type || 'image/jpeg',
    status: 'queued',
    staging_path: null,
    created_at: Date.now(),
  };
  await db.put('pending_photos', photo);
  notify(inspection_id);
  return photo;
}

export async function getPhotosForItem(inspectionId, itemId) {
  const db = await getDb();
  return db.getAllFromIndex('pending_photos', 'by_inspection_item', [
    inspectionId,
    itemId,
  ]);
}

// Batched alternative to N×getPhotosForItem when the caller wants every
// pending photo for an inspection. Single IndexedDB read; caller groups
// by item_id in memory. Used on the hot path of useInspectionData so
// every tap doesn't trigger 57 individual queries.
export async function getAllPhotosForInspection(inspectionId) {
  const db = await getDb();
  const all = await db.getAll('pending_photos');
  return all.filter((p) => p.inspection_id === inspectionId);
}

export async function getPhotoById(id) {
  const db = await getDb();
  return db.get('pending_photos', id);
}

export async function updatePhotoStatus(id, patch) {
  const db = await getDb();
  const current = await db.get('pending_photos', id);
  if (!current) return null;
  const next = { ...current, ...patch };
  await db.put('pending_photos', next);
  notify(current.inspection_id);
  return next;
}

export async function deletePhoto(id) {
  const db = await getDb();
  const current = await db.get('pending_photos', id);
  await db.delete('pending_photos', id);
  if (current?.inspection_id) notify(current.inspection_id);
}

// ── Aggregate read for the UI's "X queued · Y syncing · Z need attention" ──
export async function getSyncCounts(inspectionId) {
  const db = await getDb();
  const actions = inspectionId
    ? await db.getAllFromIndex('pending_actions', 'by_inspection', inspectionId)
    : await db.getAll('pending_actions');
  const photos = inspectionId
    ? (await db.getAll('pending_photos')).filter(
        (p) => p.inspection_id === inspectionId,
      )
    : await db.getAll('pending_photos');
  const queued = actions.filter((a) => a.status === 'queued').length;
  const syncing = actions.filter((a) => a.status === 'syncing').length;
  const needs_attention = actions.filter(
    (a) => a.status === 'needs_attention',
  ).length;
  const photo_queued = photos.filter((p) => p.status === 'queued').length;
  const photo_uploading = photos.filter((p) => p.status === 'uploading').length;
  return {
    queued,
    syncing,
    needs_attention,
    photo_queued,
    photo_uploading,
    pending_total: queued + syncing + photo_queued + photo_uploading,
  };
}

// Diagnostic snapshot of everything in IndexedDB relevant to one inspection
// PLUS the whole-DB sync state (action counts by status, sample of stuck or
// failed actions). Used by the in-app 'diag' button — no dev tools needed
// on tablets.
//
// Photo blobs are NOT included (would explode the dump size); only metadata.
export async function getDiagnosticDump(inspectionId) {
  const db = await getDb();
  const allActions = await db.getAll('pending_actions');
  const allPhotos = await db.getAll('pending_photos');
  const cache = await db.get('inspection_cache', inspectionId);

  function actionShape(a) {
    return {
      id: a.id,
      kind: a.kind,
      inspection_id: a.inspection_id,
      item_id: a.item_id,
      status: a.status,
      attempts: a.attempts,
      error: a.error,
      photo_ids: a.photo_ids || [],
      payload_keys: a.payload ? Object.keys(a.payload) : [],
      payload_result: a.payload?.inspection_result,
      created_at: a.created_at,
      updated_at: a.updated_at,
    };
  }

  // For the CURRENT inspection: every action in full.
  const myActions = allActions
    .filter((a) => a.inspection_id === inspectionId)
    .map(actionShape);

  const myPhotos = allPhotos
    .filter((p) => p.inspection_id === inspectionId)
    .map((p) => ({
      id: p.id,
      item_id: p.item_id,
      status: p.status,
      attempts: p.attempts,
      staging_path: p.staging_path,
      mime: p.mime,
      blob_size: p.blob?.size ?? null,
      created_at: p.created_at,
    }));

  // For the WHOLE DB: counts by status + a sample of the most
  // diagnostically interesting actions (any with errors, anything
  // syncing with high attempts).
  const byStatus = {};
  const byInspection = {};
  let maxAttempts = 0;
  for (const a of allActions) {
    byStatus[a.status] = (byStatus[a.status] || 0) + 1;
    byInspection[a.inspection_id] = (byInspection[a.inspection_id] || 0) + 1;
    if ((a.attempts || 0) > maxAttempts) maxAttempts = a.attempts || 0;
  }
  const erroredSample = allActions
    .filter((a) => a.error || a.status === 'needs_attention')
    .slice(0, 10)
    .map(actionShape);
  const stuckSample = allActions
    .filter((a) => (a.attempts || 0) >= 1)
    .sort((a, b) => (b.attempts || 0) - (a.attempts || 0))
    .slice(0, 5)
    .map(actionShape);
  // First few queued so we can see what shape we're sending and to which URL.
  const queuedSample = allActions
    .filter((a) => a.status === 'queued')
    .slice(0, 3)
    .map(actionShape);

  return {
    inspection_id: inspectionId,
    cache_present: !!cache,
    cache_template_name: cache?.inspection?.template?.name ?? null,
    cache_section_count: cache?.sections?.length ?? null,
    totals: {
      total_actions_in_db: allActions.length,
      total_photos_in_db: allPhotos.length,
      actions_for_this_inspection: myActions.length,
      photos_for_this_inspection: myPhotos.length,
      max_attempts_across_db: maxAttempts,
    },
    db_action_status_counts: byStatus,
    db_actions_per_inspection: byInspection,
    db_errored_actions_sample: erroredSample,
    db_high_attempts_sample: stuckSample,
    db_queued_actions_sample: queuedSample,
    this_inspection_actions: myActions,
    this_inspection_photos: myPhotos,
    online: typeof navigator !== 'undefined' ? navigator.onLine : null,
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    api_url: typeof window !== 'undefined' ? window.__DELTA_API_URL__ : null,
    dump_collected_at: new Date().toISOString(),
  };
}

// Test helper — wipe the DB. Not used in production.
export async function _resetForTests() {
  const db = await getDb();
  await db.clear('inspection_cache');
  await db.clear('pending_actions');
  await db.clear('pending_photos');
}
