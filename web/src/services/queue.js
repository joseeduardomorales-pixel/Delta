// Delta offline queue (Phase 1 — INTERFACE ONLY).
//
// Backed by IndexedDB ("delta-queue" / "action_logs_pending") via Dexie.
// FIFO semantics keyed on auto-incrementing id.
//
// Foundation scope:
//   enqueue(payload) — store an opaque payload object with createdAt.
//   dequeue()        — pop the oldest record (atomic read+delete).
//   peek()           — return the oldest record without removing it.
//   size()           — count of pending records.
//
// Explicitly NOT implemented in Phase 1:
//   retry policy, sync orchestration, conflict resolution, dedup.
//
// Sync worker lands in a later build; do not add it here.

import Dexie from 'dexie';

export const DB_NAME = 'delta-queue';
export const STORE = 'action_logs_pending';

class DeltaQueueDB extends Dexie {
  constructor() {
    super(DB_NAME);
    this.version(1).stores({
      [STORE]: '++id, createdAt',
    });
  }
}

let _db = null;

export function getQueueDB() {
  if (!_db) _db = new DeltaQueueDB();
  return _db;
}

function assertPayload(payload) {
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('queue.enqueue: payload must be a non-null plain object');
  }
}

export async function enqueue(payload) {
  assertPayload(payload);
  const db = getQueueDB();
  const createdAt = new Date().toISOString();
  const id = await db.table(STORE).add({ payload, createdAt });
  return { id, createdAt };
}

export async function peek() {
  const db = getQueueDB();
  return (await db.table(STORE).orderBy('id').first()) ?? null;
}

export async function dequeue() {
  const db = getQueueDB();
  return db.transaction('rw', db.table(STORE), async () => {
    const head = await db.table(STORE).orderBy('id').first();
    if (!head) return null;
    await db.table(STORE).delete(head.id);
    return head;
  });
}

export async function size() {
  const db = getQueueDB();
  return db.table(STORE).count();
}

// Test-only helper. Not used at runtime.
export async function __resetQueueForTests() {
  const db = getQueueDB();
  await db.table(STORE).clear();
}
