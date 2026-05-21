// Round-trip test for the offline queue interface (Phase 1).
// Foundation requirement: enqueue → peek → dequeue → size() === 0.

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';

import {
  enqueue,
  peek,
  dequeue,
  size,
  __resetQueueForTests,
} from './queue.js';

describe('offline queue (Dexie + IndexedDB)', () => {
  beforeEach(async () => {
    await __resetQueueForTests();
  });

  it('round-trips a single record: enqueue → peek → dequeue → size 0', async () => {
    expect(await size()).toBe(0);

    const payload = { type: 'intent', text: 'oil change CC07' };
    const { id, createdAt } = await enqueue(payload);

    expect(id).toBeTypeOf('number');
    expect(createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await size()).toBe(1);

    const head = await peek();
    expect(head).not.toBeNull();
    expect(head.payload).toEqual(payload);
    expect(await size()).toBe(1);

    const popped = await dequeue();
    expect(popped.id).toBe(id);
    expect(popped.payload).toEqual(payload);
    expect(await size()).toBe(0);
    expect(await peek()).toBeNull();
    expect(await dequeue()).toBeNull();
  });

  it('preserves FIFO order across multiple records', async () => {
    await enqueue({ n: 1 });
    await enqueue({ n: 2 });
    await enqueue({ n: 3 });
    expect(await size()).toBe(3);

    const a = await dequeue();
    const b = await dequeue();
    const c = await dequeue();
    expect([a.payload.n, b.payload.n, c.payload.n]).toEqual([1, 2, 3]);
    expect(await size()).toBe(0);
  });

  it('rejects non-object payloads', async () => {
    await expect(enqueue(null)).rejects.toThrow(/plain object/);
    await expect(enqueue('string')).rejects.toThrow(/plain object/);
    await expect(enqueue([1, 2])).rejects.toThrow(/plain object/);
  });
});
