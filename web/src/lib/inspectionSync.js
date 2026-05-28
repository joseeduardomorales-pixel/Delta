// Optimistic-UI + retry queue for inspection item marks.
//
// Each mark is processed like this:
//   1. UI calls enqueue({ itemId, payload, run })
//   2. We attempt run() — the actual fetch.
//      - Success: callback({ status: 'synced' })
//      - Failure: retry with exponential backoff (300ms → 900ms → 2.7s).
//        After 3 failed attempts we mark the item as 'retry' and STOP
//        firing requests for it; the UI shows a ⟳ badge.
//   3. When `navigator.onLine` flips back to true OR the user manually
//      taps the offline banner, we flush all 'retry' items.
//
// Photos are NOT queued — the ISSUE modal refuses to submit while offline
// so the tech doesn't lose their typed description to a failed upload.

const BACKOFF_MS = [300, 900, 2700];

class InspectionSyncQueue {
  constructor() {
    this.items = new Map(); // itemId → { payload, run, attempt, status, onStatusChange }
    this._wireOnlineListener();
  }

  _wireOnlineListener() {
    if (typeof window === 'undefined') return;
    window.addEventListener('online', () => this.drain());
  }

  enqueue({ itemId, payload, run, onStatusChange }) {
    // Cancel any previous pending entry for this item — the new tap wins.
    this.items.set(itemId, {
      payload,
      run,
      attempt: 0,
      status: 'pending',
      onStatusChange,
    });
    this._processOne(itemId);
  }

  async _processOne(itemId) {
    const entry = this.items.get(itemId);
    if (!entry) return;
    entry.status = 'pending';
    entry.onStatusChange?.('pending');
    try {
      const result = await entry.run();
      entry.status = 'synced';
      entry.onStatusChange?.('synced', result);
      this.items.delete(itemId);
    } catch (e) {
      entry.attempt += 1;
      if (entry.attempt >= BACKOFF_MS.length) {
        entry.status = 'retry';
        entry.onStatusChange?.('retry', null, e);
        // Stay in the map; drain() will retry on reconnect.
        return;
      }
      const wait = BACKOFF_MS[entry.attempt - 1];
      setTimeout(() => this._processOne(itemId), wait);
    }
  }

  // Manually retry — called by the offline banner OR on `online` event.
  drain() {
    for (const itemId of this.items.keys()) {
      const entry = this.items.get(itemId);
      if (!entry) continue;
      entry.attempt = 0;
      this._processOne(itemId);
    }
  }

  pendingCount() {
    return this.items.size;
  }

  retryCount() {
    let n = 0;
    for (const entry of this.items.values()) {
      if (entry.status === 'retry') n += 1;
    }
    return n;
  }

  hasUnsynced() {
    return this.items.size > 0;
  }

  clear() {
    this.items.clear();
  }
}

// One shared queue per runner instance; we'll instantiate it inside React.
export function createInspectionSyncQueue() {
  return new InspectionSyncQueue();
}

export function isOnline() {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine !== false;
}
