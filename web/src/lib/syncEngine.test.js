// Sync engine unit tests.
// Uses fake-indexeddb so the actual store layer is exercised end-to-end.

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import * as store from './inspectionStore.js';
import { SyncEngine, _resetDrainLock } from './syncEngine.js';

const FIXED_TOKEN = 'fake-jwt-token';
const API = 'http://localhost:4000';
const INSP = 'insp-1';
const ITEM = 'item-1';

function fakeFetchOk(responses) {
  // responses: array of { match: (url, opts) => bool, respond: () => Response-ish }
  let i = 0;
  return async function (url, opts) {
    for (const r of responses) {
      if (r.match(url, opts)) {
        const out = await r.respond({ url, opts, i });
        i += 1;
        return out;
      }
    }
    throw new Error(`no fake matcher for ${url}`);
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(async () => {
  await store._resetForTests();
  _resetDrainLock();
});

describe('SyncEngine — mark_item flow', () => {
  it('drains a single mark_item action against the live PATCH endpoint', async () => {
    await store.enqueueAction({
      kind: 'mark_item',
      inspection_id: INSP,
      item_id: ITEM,
      payload: { inspection_result: 'pass' },
    });

    let calls = 0;
    const engine = new SyncEngine({
      apiUrl: API,
      getAccessToken: async () => FIXED_TOKEN,
      fetchImpl: fakeFetchOk([
        {
          match: (url, opts) => url.endsWith(`/api/inspections/${INSP}/items/${ITEM}`) && opts.method === 'PATCH',
          respond: async () => {
            calls += 1;
            return jsonResponse({ item: { id: ITEM, status: 'done', inspection_result: 'pass' } });
          },
        },
      ]),
    });

    await engine.drain();
    expect(calls).toBe(1);
    const remaining = await store.getActionsForInspection(INSP);
    expect(remaining).toHaveLength(0);
  });

  it('keeps queued + backs off on transient 5xx', async () => {
    await store.enqueueAction({
      kind: 'mark_item',
      inspection_id: INSP,
      item_id: ITEM,
      payload: { inspection_result: 'pass' },
    });

    let calls = 0;
    const engine = new SyncEngine({
      apiUrl: API,
      getAccessToken: async () => FIXED_TOKEN,
      fetchImpl: fakeFetchOk([
        {
          match: () => true,
          respond: async () => {
            calls += 1;
            // Fail the first call with 500, succeed on second.
            if (calls === 1) return jsonResponse({ error: 'boom' }, 500);
            return jsonResponse({ item: { id: ITEM, status: 'done', inspection_result: 'pass' } });
          },
        },
      ]),
    });

    await engine.drain();
    expect(calls).toBe(2);
    const remaining = await store.getActionsForInspection(INSP);
    expect(remaining).toHaveLength(0);
  }, 30_000);

  it('marks needs_attention on permanent 4xx and does NOT retry', async () => {
    await store.enqueueAction({
      kind: 'mark_item',
      inspection_id: INSP,
      item_id: ITEM,
      payload: { inspection_result: 'fail' },
    });

    let calls = 0;
    const engine = new SyncEngine({
      apiUrl: API,
      getAccessToken: async () => FIXED_TOKEN,
      fetchImpl: fakeFetchOk([
        {
          match: () => true,
          respond: async () => {
            calls += 1;
            return jsonResponse({ error: 'description_required' }, 400);
          },
        },
      ]),
    });

    await engine.drain();
    expect(calls).toBe(1);
    const remaining = await store.getActionsForInspection(INSP);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].status).toBe('needs_attention');
    expect(remaining[0].error).toBe('description_required');
  });

  it('dedupes by (inspection_id, item_id) — last tap wins', async () => {
    await store.enqueueAction({
      kind: 'mark_item',
      inspection_id: INSP,
      item_id: ITEM,
      payload: { inspection_result: 'pass' },
    });
    await store.enqueueAction({
      kind: 'mark_item',
      inspection_id: INSP,
      item_id: ITEM,
      payload: { inspection_result: 'fail', notes: 'broken' },
    });

    const queued = await store.getActionsForInspection(INSP);
    expect(queued).toHaveLength(1);
    expect(queued[0].payload.inspection_result).toBe('fail');
    expect(queued[0].payload.notes).toBe('broken');
  });
});

describe('SyncEngine — photo upload flow', () => {
  it('uploads photo blob first, then sends action with staging_path', async () => {
    const photo = await store.addPhoto({
      inspection_id: INSP,
      item_id: ITEM,
      blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' }),
      mime: 'image/jpeg',
    });
    await store.enqueueAction({
      kind: 'mark_item',
      inspection_id: INSP,
      item_id: ITEM,
      payload: { inspection_result: 'fail', notes: 'busted' },
      photo_ids: [photo.id],
    });

    const STAGING = 'staging/u/abc.jpg';
    let uploadCalls = 0;
    let patchPayload = null;
    const engine = new SyncEngine({
      apiUrl: API,
      getAccessToken: async () => FIXED_TOKEN,
      fetchImpl: fakeFetchOk([
        {
          match: (url, opts) => url.endsWith('/api/uploads') && opts.method === 'POST',
          respond: async () => {
            uploadCalls += 1;
            return jsonResponse({ uploads: [{ staging_path: STAGING, mimetype: 'image/jpeg', size: 4 }] });
          },
        },
        {
          match: (url, opts) => url.includes(`/api/inspections/${INSP}/items/${ITEM}`) && opts.method === 'PATCH',
          respond: async ({ opts }) => {
            patchPayload = JSON.parse(opts.body);
            return jsonResponse({ item: { id: ITEM, status: 'done', inspection_result: 'fail' } });
          },
        },
      ]),
    });

    await engine.drain();
    expect(uploadCalls).toBe(1);
    expect(patchPayload).toEqual({
      inspection_result: 'fail',
      notes: 'busted',
      attachments: [{ staging_path: STAGING }],
    });
    // Photo should be gone after success.
    const remaining = await store.getPhotosForItem(INSP, ITEM);
    expect(remaining).toHaveLength(0);
  }, 30_000);

  it('does not send the action until its photo upload succeeds', async () => {
    const photo = await store.addPhoto({
      inspection_id: INSP,
      item_id: ITEM,
      blob: new Blob([new Uint8Array([1])], { type: 'image/jpeg' }),
      mime: 'image/jpeg',
    });
    await store.enqueueAction({
      kind: 'mark_item',
      inspection_id: INSP,
      item_id: ITEM,
      payload: { inspection_result: 'fail', notes: 'broken' },
      photo_ids: [photo.id],
    });

    let uploadCalls = 0;
    let patchCalls = 0;
    const engine = new SyncEngine({
      apiUrl: API,
      getAccessToken: async () => FIXED_TOKEN,
      fetchImpl: fakeFetchOk([
        {
          match: (url) => url.endsWith('/api/uploads'),
          respond: async () => {
            uploadCalls += 1;
            // First attempt fails with 500.
            if (uploadCalls === 1) return jsonResponse({ error: 'boom' }, 500);
            return jsonResponse({ uploads: [{ staging_path: 'staging/u/x.jpg', mimetype: 'image/jpeg', size: 1 }] });
          },
        },
        {
          match: (url, opts) => url.includes('/items/') && opts.method === 'PATCH',
          respond: async () => {
            patchCalls += 1;
            return jsonResponse({ item: { id: ITEM, status: 'done', inspection_result: 'fail' } });
          },
        },
      ]),
    });

    await engine.drain();
    // Photo upload retried, then PATCH fired once.
    expect(uploadCalls).toBeGreaterThanOrEqual(2);
    expect(patchCalls).toBe(1);
  }, 30_000);
});

describe('SyncEngine — finalize flow', () => {
  it('sends POST /complete after all item marks are flushed', async () => {
    await store.enqueueAction({
      kind: 'mark_item',
      inspection_id: INSP,
      item_id: ITEM,
      payload: { inspection_result: 'pass' },
    });
    await store.enqueueAction({
      kind: 'finalize',
      inspection_id: INSP,
      payload: {},
    });

    const calls = [];
    const engine = new SyncEngine({
      apiUrl: API,
      getAccessToken: async () => FIXED_TOKEN,
      fetchImpl: fakeFetchOk([
        {
          match: () => true,
          respond: async ({ url, opts }) => {
            calls.push({ url, method: opts.method });
            return jsonResponse({ ok: true, item: { id: ITEM, status: 'done', inspection_result: 'pass' } });
          },
        },
      ]),
    });

    await engine.drain();
    // Both should have been hit.
    expect(calls.some((c) => c.url.includes('/items/'))).toBe(true);
    expect(calls.some((c) => c.url.includes('/complete'))).toBe(true);
    // Action queue empty.
    expect(await store.getActionsForInspection(INSP)).toHaveLength(0);
  });
});

describe('SyncEngine — regression: fetch this-binding', () => {
  // Reproduces the production bug where storing native fetch as a class
  // property (this.fetchImpl = ctx.fetchImpl || fetch) stripped the
  // Window binding and threw "Illegal invocation" on every call.
  //
  // Repro by installing a strict-this enforcer onto globalThis.fetch.
  // The SyncEngine MUST construct fetchImpl such that the wrapped call
  // succeeds without the SyncEngine instance as `this`.
  it('drains successfully when default fetchImpl is used (no ctx.fetchImpl)', async () => {
    const calls = [];
    const original = globalThis.fetch;
    const strictFetch = function (url, opts) {
      // Native browser fetch is strict: if called with a wrong `this`,
      // it throws. Force the same behavior here.
      if (this !== undefined && this !== globalThis) {
        throw new TypeError(
          "Failed to execute 'fetch' on 'Window': Illegal invocation",
        );
      }
      calls.push({ url, method: opts?.method });
      return Promise.resolve(
        jsonResponse({
          item: { id: ITEM, status: 'done', inspection_result: 'pass' },
        }),
      );
    };
    globalThis.fetch = strictFetch;

    try {
      await store.enqueueAction({
        kind: 'mark_item',
        inspection_id: INSP,
        item_id: ITEM,
        payload: { inspection_result: 'pass' },
      });

      // CRITICAL: build the engine without passing fetchImpl. That forces
      // the production code path (the wrapper around globalThis.fetch).
      const engine = new SyncEngine({
        apiUrl: API,
        getAccessToken: async () => FIXED_TOKEN,
      });

      await engine.drain();

      // PATCH was made.
      expect(calls.some((c) => c.url.includes('/items/'))).toBe(true);
      // Action was deleted on success (so the drain completed).
      expect(await store.getActionsForInspection(INSP)).toHaveLength(0);
    } finally {
      globalThis.fetch = original;
    }
  });
});
