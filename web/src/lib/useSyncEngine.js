// Owns a singleton SyncEngine instance and a sync-status read.
//
// One engine per page lifecycle. It:
//   - Drains the queue on mount.
//   - Drains every time `online` event fires.
//   - Re-drains whenever the store changes (i.e. a fresh action was enqueued).
//   - Exposes `counts` (queued / syncing / needs_attention / online) so the
//     UI can render the banner.

import { useEffect, useState, useRef } from 'react';
import { SyncEngine } from './syncEngine.js';
import { getSyncCounts, subscribe } from './inspectionStore.js';

let _engine = null;

export function getOrCreateSyncEngine(ctx) {
  if (!_engine) _engine = new SyncEngine(ctx);
  return _engine;
}

export function useSyncEngine({ inspectionId, apiUrl, getAccessToken }) {
  const [counts, setCounts] = useState({
    queued: 0,
    syncing: 0,
    needs_attention: 0,
    photo_queued: 0,
    photo_uploading: 0,
    pending_total: 0,
  });
  const [online, setOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine !== false : true,
  );
  const engineRef = useRef(null);

  useEffect(() => {
    engineRef.current = getOrCreateSyncEngine({
      apiUrl,
      getAccessToken,
      onUpdate: refreshCounts,
    });

    async function refreshCounts() {
      const c = await getSyncCounts(inspectionId);
      setCounts(c);
    }

    refreshCounts();

    // `.catch(console.error)` on every drain call so unhandled rejections
    // don't disappear silently. (The fetch-binding bug was masked for
    // months because these were bare promises.)
    function safeDrain() {
      engineRef.current?.drain()?.catch?.((e) => {
        // eslint-disable-next-line no-console
        console.error('[sync] drain rejected', e);
      });
    }

    // Drain whenever the store changes (new action enqueued).
    const unsubStore = subscribe(inspectionId, () => {
      refreshCounts();
      safeDrain();
    });
    // Initial drain on mount.
    safeDrain();

    function onOnline() {
      setOnline(true);
      safeDrain();
    }
    function onOffline() {
      setOnline(false);
    }
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      unsubStore();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [inspectionId, apiUrl, getAccessToken]);

  return {
    counts,
    online,
    drain: () => engineRef.current?.drain(),
  };
}
