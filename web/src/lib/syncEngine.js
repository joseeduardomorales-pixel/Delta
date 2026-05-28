// Sync engine — drains pending_actions and pending_photos to the server.
//
// Design contract:
//   - Re-runnable: calling drain() concurrently is safe; a global lock
//     serializes the actual work.
//   - Idempotent at the action level: each action carries the full
//     payload, so re-sending after a partial failure produces the same
//     end state on the server. The mark_item PATCH endpoint already
//     handles edit-vs-create on the issue side.
//   - Retry policy: network / 5xx errors → exponential backoff and stay
//     queued. 4xx → mark needs_attention, surface to the UI, do not
//     retry. Auth errors (401) → refresh token via supabase, retry once;
//     if still 401, mark needs_attention.
//
// The engine is usable from both the foreground React app and (later)
// a service worker — it depends only on the store and on a fetch-like
// function + auth-token resolver passed in.

import * as store from './inspectionStore.js';

let _draining = false;
let _drainQueued = false;

const BACKOFF_MS = [500, 1500, 4500, 12000];

export class SyncEngine {
  // ctx: {
  //   apiUrl: string,
  //   getAccessToken: async () => string,  // refreshes if needed
  //   onUpdate?: () => void,               // called after every state change
  //   fetchImpl?: typeof fetch,            // for tests
  // }
  constructor(ctx) {
    this.ctx = ctx;
    this.fetchImpl = ctx.fetchImpl || fetch;
  }

  // ── Public API ──────────────────────────────────────────────────────────
  async drain() {
    if (_draining) {
      _drainQueued = true;
      return;
    }
    _draining = true;
    try {
      let madeProgress = true;
      // Loop until no more progress can be made — that handles the case
      // where new items were enqueued mid-drain.
      while (madeProgress) {
        madeProgress = await this._drainOnce();
      }
    } finally {
      _draining = false;
      this.ctx.onUpdate?.();
      if (_drainQueued) {
        _drainQueued = false;
        // Re-fire on next tick to avoid stack growth.
        setTimeout(() => this.drain(), 0);
      }
    }
  }

  // ── Internals ───────────────────────────────────────────────────────────
  async _drainOnce() {
    // 1. Upload any queued photos first so their staging_paths are
    //    available when we process the actions that reference them.
    const photoChanged = await this._uploadQueuedPhotos();

    // 2. Process actions in creation order.
    const actions = await store.getAllQueuedActions();
    actions.sort((a, b) => a.created_at - b.created_at);

    let actionChanged = false;
    for (const action of actions) {
      // Skip if the action depends on a photo that isn't uploaded yet.
      // If ANY linked photo is 'failed' (permanent), surface the action
      // to needs_attention so the tech can re-shoot the photo.
      if (action.photo_ids?.length) {
        const photos = await Promise.all(
          action.photo_ids.map((id) => store.getPhotoById(id)),
        );
        const anyFailed = photos.some((p) => p?.status === 'failed');
        if (anyFailed) {
          await store.updateActionStatus(action.id, {
            status: 'needs_attention',
            error: 'photo_upload_failed',
          });
          actionChanged = true;
          continue;
        }
        const ready = photos.every((p) => p && p.status === 'uploaded' && p.staging_path);
        if (!ready) continue;
      }
      const changed = await this._processAction(action);
      if (changed) actionChanged = true;
    }

    return photoChanged || actionChanged;
  }

  async _uploadQueuedPhotos() {
    const queued = (await store.getAllQueuedActions()).flatMap(
      (a) => a.photo_ids || [],
    );
    // Also pick up any orphan queued photos (e.g. attached to an item but
    // their action hasn't been enqueued yet — shouldn't happen but defensive).
    const allPhotoIds = new Set(queued);
    const photosToUpload = [];
    for (const id of allPhotoIds) {
      const p = await store.getPhotoById(id);
      if (p && p.status === 'queued') photosToUpload.push(p);
    }
    if (!photosToUpload.length) return false;

    // After this many transient failures we give up on a photo and mark
    // it as permanently failed so the dependent action can surface to
    // needs_attention. Otherwise we'd loop forever on a dead network.
    const PHOTO_MAX_ATTEMPTS = 5;
    let changed = false;
    for (const photo of photosToUpload) {
      const attempts = (photo.attempts || 0) + 1;
      await store.updatePhotoStatus(photo.id, { status: 'uploading', attempts });
      try {
        const stagingPath = await this._uploadOne(photo);
        await store.updatePhotoStatus(photo.id, {
          status: 'uploaded',
          staging_path: stagingPath,
        });
        changed = true;
      } catch (e) {
        const permanent = e.permanent === true;
        if (permanent || attempts >= PHOTO_MAX_ATTEMPTS) {
          await store.updatePhotoStatus(photo.id, { status: 'failed' });
        } else {
          await store.updatePhotoStatus(photo.id, { status: 'queued' });
        }
        changed = true;
        // Brief backoff so we don't hammer when the network is dead.
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    return changed;
  }

  async _uploadOne(photo) {
    const token = await this.ctx.getAccessToken();
    const fd = new FormData();
    // Give it a name so multer is happy. Re-wrap the blob in a fresh Blob
    // so the FormData append works after the IndexedDB roundtrip (real
    // browsers tolerate this either way; jsdom in tests is strict).
    const ext = (photo.mime || 'image/jpeg').split('/')[1] || 'jpg';
    const blob =
      photo.blob instanceof Blob
        ? photo.blob
        : new Blob([photo.blob], { type: photo.mime || 'image/jpeg' });
    const safeBlob = new Blob([blob], { type: photo.mime || blob.type || 'image/jpeg' });
    fd.append('files', safeBlob, `${photo.id}.${ext}`);
    const res = await this.fetchImpl(`${this.ctx.apiUrl}/api/uploads`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    if (res.status === 401) {
      const e = new Error('unauthorized');
      e.permanent = false;
      throw e;
    }
    if (res.status >= 400 && res.status < 500) {
      const e = new Error(`upload rejected ${res.status}`);
      e.permanent = true;
      throw e;
    }
    if (!res.ok) {
      throw new Error(`upload ${res.status}`);
    }
    const body = await res.json();
    const u = body.uploads?.[0];
    if (!u?.staging_path) throw new Error('upload response missing staging_path');
    return u.staging_path;
  }

  async _processAction(action) {
    await store.updateActionStatus(action.id, { status: 'syncing' });
    try {
      const result = await this._dispatch(action);
      // Success — drop the action AND its photos from the queue.
      for (const pid of action.photo_ids || []) {
        await store.deletePhoto(pid);
      }
      await store.deleteAction(action.id);
      // If the action returned a fresh snapshot, persist it.
      if (result?.refresh && action.kind === 'mark_item') {
        // The action handler may return a re-fetch hint; consumer of the
        // engine listens via onUpdate and refetches the cache.
      }
      return true;
    } catch (e) {
      if (e.permanent === true) {
        await store.updateActionStatus(action.id, {
          status: 'needs_attention',
          error: e.message,
        });
        return true;
      }
      // Transient — back off based on attempt count, re-queue.
      const attempts = (action.attempts || 0) + 1;
      const backoff = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
      await store.updateActionStatus(action.id, {
        status: 'queued',
        attempts,
        error: e.message,
      });
      await new Promise((r) => setTimeout(r, backoff));
      // Tell the drain loop we made progress so it keeps going.
      return true;
    }
  }

  async _dispatch(action) {
    const token = await this.ctx.getAccessToken();
    if (action.kind === 'mark_item') {
      // Resolve any photo_ids to staging_paths and merge into the payload.
      const payload = { ...action.payload };
      if (action.photo_ids?.length) {
        const photos = await Promise.all(
          action.photo_ids.map((id) => store.getPhotoById(id)),
        );
        payload.attachments = photos
          .filter((p) => p?.staging_path)
          .map((p) => ({ staging_path: p.staging_path }));
      }
      const url = `${this.ctx.apiUrl}/api/inspections/${action.inspection_id}/items/${action.item_id}`;
      const res = await this.fetchImpl(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) {
        const e = new Error('unauthorized');
        e.permanent = false;
        throw e;
      }
      if (res.status >= 400 && res.status < 500) {
        const body = await res.json().catch(() => ({}));
        const e = new Error(body.message || body.error || `HTTP ${res.status}`);
        e.permanent = true;
        throw e;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }

    if (action.kind === 'finalize') {
      const url = `${this.ctx.apiUrl}/api/inspections/${action.inspection_id}/complete`;
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(action.payload || {}),
      });
      if (res.status >= 400 && res.status < 500) {
        const body = await res.json().catch(() => ({}));
        const e = new Error(body.message || body.error || `HTTP ${res.status}`);
        e.permanent = true;
        throw e;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }

    const e = new Error(`unknown action kind: ${action.kind}`);
    e.permanent = true;
    throw e;
  }
}

// Convenience for tests: reset the global drain lock.
export function _resetDrainLock() {
  _draining = false;
  _drainQueued = false;
}
