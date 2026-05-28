// React hook that gives the runner an authoritative view of the inspection
// state from the local IndexedDB store, AND keeps it in sync with the
// server when online.
//
// On mount it does two things in parallel:
//   1. Read the cached snapshot from IndexedDB → render immediately.
//   2. Fetch fresh data from the server. On success, write to the cache.
//      The cache merge preserves any pending-action overlays (so a tap
//      the tech just did won't get clobbered by stale server data).
//
// Subscribes to store changes so when the sync engine flushes a queued
// action, the UI updates automatically.

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  getInspectionCache,
  putInspectionCache,
  subscribe,
  getActionsForInspection,
  getPhotosForItem,
} from './inspectionStore.js';

export function useInspectionData({ inspectionId, accessToken, apiUrl }) {
  const [cached, setCached] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const refreshing = useRef(false);

  const reloadFromCache = useCallback(async () => {
    const snapshot = await getInspectionCache(inspectionId);
    if (snapshot) {
      // Overlay queued actions on top of the cached snapshot so the UI
      // shows the tech's latest taps even if the engine hasn't flushed.
      const actions = await getActionsForInspection(inspectionId);
      const markActions = actions.filter((a) => a.kind === 'mark_item');
      const overlayed = await applyMarkOverlay(snapshot, markActions, inspectionId);
      setCached(overlayed);
    }
    setLoading(false);
  }, [inspectionId]);

  const refreshFromServer = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const r = await fetch(`${apiUrl}/api/inspections/${inspectionId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const snapshot = await r.json();
      // The server response shape uses `sections` + nested items. Store as-is.
      await putInspectionCache({ id: inspectionId, ...snapshot });
      await reloadFromCache();
    } catch (e) {
      // Offline / network error — keep showing cached data, surface error only
      // if there's NO cached data at all.
      if (!cached) setError(e.message);
    } finally {
      refreshing.current = false;
    }
  }, [apiUrl, accessToken, inspectionId, cached, reloadFromCache]);

  useEffect(() => {
    // Initial read from cache (fast path) + parallel refresh from server.
    reloadFromCache();
    refreshFromServer();
    // Subscribe to store changes (the sync engine pushes updates here too).
    const unsub = subscribe(inspectionId, () => reloadFromCache());
    return () => unsub();
  }, [inspectionId, reloadFromCache, refreshFromServer]);

  return { data: cached, loading, error, refresh: refreshFromServer };
}

// Merge queued mark_item actions onto the cached snapshot so the UI shows
// the latest tap even before the server has confirmed. Also overlays any
// pending photos for failed items so the issue modal sees them.
async function applyMarkOverlay(snapshot, markActions, inspectionId) {
  if (!markActions.length) return snapshot;
  const byItem = new Map();
  for (const a of markActions) byItem.set(a.item_id, a);

  const sections = await Promise.all(
    (snapshot.sections || []).map(async (sec) => ({
      ...sec,
      items: await Promise.all(
        sec.items.map(async (it) => {
          const action = byItem.get(it.id);
          // Always include pending photo placeholders so the modal can
          // render them as already-attached (even if not yet uploaded).
          const pendingPhotos = await getPhotosForItem(inspectionId, it.id);
          const pendingPhotoPreviews = pendingPhotos.map((p) => ({
            id: p.id,
            local: true,
            status: p.status,
            url: blobToObjectUrl(p.blob),
          }));
          if (!action) {
            // No pending mark — keep server state but expose any pending
            // photos for the next ISSUE modal open.
            if (pendingPhotoPreviews.length) {
              return {
                ...it,
                photos: [...(it.photos || []), ...pendingPhotoPreviews],
              };
            }
            return it;
          }
          // Pending mark overlay — show as `done` with the queued result.
          return {
            ...it,
            inspection_result: action.payload.inspection_result,
            status: 'done',
            notes: action.payload.notes ?? it.notes,
            measurement_value:
              action.payload.measurement_value ?? it.measurement_value,
            photos: [
              ...(it.photos || []).filter(
                (p) => !action.payload.remove_photo_ids?.includes(p.id),
              ),
              ...pendingPhotoPreviews,
            ],
            _pending_sync: action.status, // 'queued' | 'syncing' | 'needs_attention'
          };
        }),
      ),
    })),
  );
  return { ...snapshot, sections };
}

// Memoize object URLs so we don't churn them on every render. Cleared
// when the page navigates away (browser handles GC of unreferenced URLs).
const objectUrls = new WeakMap();
function blobToObjectUrl(blob) {
  if (!blob) return null;
  if (objectUrls.has(blob)) return objectUrls.get(blob);
  const url = URL.createObjectURL(blob);
  objectUrls.set(blob, url);
  return url;
}
