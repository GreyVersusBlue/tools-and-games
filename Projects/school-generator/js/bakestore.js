// bakestore.js — where a bake rests between walks.
//
// Phase 27. A bake is a cache, not a fact about the building: it is keyed on
// the hash of the structural state that made it (bakelight.js's `bakeKey`)
// and it never, ever goes in the save file — a design travels light and a
// stale bake in a file would be a lie with a long shelf life. So it lives
// beside the autosave, in IndexedDB rather than localStorage, because a
// packed bake is typed arrays and tens of kilobytes and localStorage is
// strings and already fighting the tracing overlay for room.
//
// The contract is deliberately meek: every function resolves rather than
// throws, and a browser with no IndexedDB (or one that refuses it — private
// windows do) makes every save a no-op and every load a miss. The bake is
// recomputed instead; nothing downstream ever hears about storage.
//
// A handful of recent bakes are kept, newest first, so flipping between two
// designs — or undoing back across a wall — is a cache hit rather than a
// re-bake. The store prunes itself on every save; nothing else maintains it.
//
// The `idb` parameter exists for the suite: Node has no IndexedDB, so the
// tests hand in a fake that keeps the same onsuccess/onerror shape. The page
// never passes it.

export const BAKE_DB = 'school-generator-bakes';
export const BAKE_STORE = 'bakes';
export const BAKE_KEEP = 4;

const idbOf = (idb) => idb !== undefined ? idb
  : (typeof globalThis !== 'undefined' ? globalThis.indexedDB : undefined);

// A request wrapped so callers can await it. Rejection is private to this
// module — every public function catches and answers with its miss value.
const asPromise = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error || new Error('IndexedDB refused'));
});

function openDB(idb) {
  return new Promise((resolve) => {
    let req;
    try {
      req = idb.open(BAKE_DB, 1);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(BAKE_STORE)) {
        db.createObjectStore(BAKE_STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

// Store one packed bake under its own key, and prune to the newest
// BAKE_KEEP. Resolves true when it landed, false when storage declined —
// which the caller treats as weather, not as an error.
export async function saveBake(packed, idb) {
  const factory = idbOf(idb);
  if (!factory || !packed || typeof packed.key !== 'string') return false;
  const db = await openDB(factory);
  if (!db) return false;
  try {
    const store = db.transaction(BAKE_STORE, 'readwrite').objectStore(BAKE_STORE);
    await asPromise(store.put({ key: packed.key, at: Date.now(), bake: packed }));
    const keys = await asPromise(store.getAll());
    const stale = keys
      .sort((a, b) => b.at - a.at)
      .slice(BAKE_KEEP)
      .map((r) => r.key);
    for (const k of stale) await asPromise(store.delete(k));
    return true;
  } catch {
    return false;
  } finally {
    try { db.close(); } catch { /* closing is a courtesy */ }
  }
}

// The bake stored under this structural key, or null — a miss and a refusal
// look identical on purpose.
export async function loadBake(key, idb) {
  const factory = idbOf(idb);
  if (!factory || typeof key !== 'string') return null;
  const db = await openDB(factory);
  if (!db) return null;
  try {
    const store = db.transaction(BAKE_STORE, 'readonly').objectStore(BAKE_STORE);
    const rec = await asPromise(store.get(key));
    return rec && rec.bake ? rec.bake : null;
  } catch {
    return null;
  } finally {
    try { db.close(); } catch { /* closing is a courtesy */ }
  }
}

// Forget everything. Nothing in the tool calls this today; it exists so a
// debugging session (or a future settings panel) has one honest verb.
export async function clearBakes(idb) {
  const factory = idbOf(idb);
  if (!factory) return false;
  const db = await openDB(factory);
  if (!db) return false;
  try {
    const store = db.transaction(BAKE_STORE, 'readwrite').objectStore(BAKE_STORE);
    await asPromise(store.clear());
    return true;
  } catch {
    return false;
  } finally {
    try { db.close(); } catch { /* closing is a courtesy */ }
  }
}
