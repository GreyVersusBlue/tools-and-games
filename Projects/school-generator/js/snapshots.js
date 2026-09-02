// snapshots.js — a design's named pasts, beside the autosave.
//
// Phase 34. Autosave holds exactly one past and undo holds one session's;
// this holds the ones somebody chose to keep — "before the client meeting",
// "Tuesday" — each a whole serialized design with a name, a time, the
// thumbnail the gallery draws and the three counted facts. IndexedDB rather
// than localStorage for the same reason the bakes live there (bakestore.js):
// a design is tens of kilobytes and localStorage is already fighting the
// tracing overlay for room. Forty of them is a few megabytes, which
// IndexedDB does not blink at.
//
// The contract is bakestore's, meekly: every function resolves rather than
// throws, and a browser with no IndexedDB (or one that refuses it — private
// windows do) makes every save answer `{ ok: false, reason }` and every list
// empty. A snapshot is never in the save file: a history somebody else can
// read is a history of *this browser's* work, and the file stays the design.
//
// The `idb` parameter exists for the suite: Node has no IndexedDB, so the
// tests hand in a fake that keeps the same onsuccess/onerror shape. The page
// never passes it.

export const SNAP_DB = 'school-generator-snapshots';
export const SNAP_STORE = 'snapshots';
export const MAX_SNAPSHOTS = 40;
export const MAX_SNAP_NAME = 60;

const idbOf = (idb) => idb !== undefined ? idb
  : (typeof globalThis !== 'undefined' ? globalThis.indexedDB : undefined);

const asPromise = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error || new Error('IndexedDB refused'));
});

function openDB(idb) {
  return new Promise((resolve) => {
    let req;
    try {
      req = idb.open(SNAP_DB, 1);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SNAP_STORE)) {
        db.createObjectStore(SNAP_STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

const closeQuietly = (db) => { try { db.close(); } catch { /* closing is a courtesy */ } };

export const NO_STORAGE = 'This browser has nowhere to keep a snapshot — storage is off or refused.';
export const TOO_MANY = `You can keep up to ${MAX_SNAPSHOTS} snapshots — delete one first.`;

export const snapName = (name) =>
  (typeof name === 'string' && name.trim() ? name.trim() : 'Untitled').slice(0, MAX_SNAP_NAME);

const newKey = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// What a listing carries: everything but the design itself, which is the
// heavy half and the half a timeline does not need until somebody picks one.
const summaryOf = (rec) => ({
  id: rec.key, name: rec.name, at: rec.at,
  thumb: rec.thumb || null, facts: rec.facts || null,
  bytes: typeof rec.json === 'string' ? rec.json.length : 0,
});

// Keep one. `entry` is `{ name, json, thumb, facts }` — the serialized design
// and what the timeline shows about it; `at` defaults to now. Answers
// `{ ok: true, id }` or `{ ok: false, reason }` with a sentence.
export async function saveSnapshot(entry, idb) {
  const factory = idbOf(idb);
  if (!entry || typeof entry.json !== 'string' || !entry.json) return { ok: false, reason: 'Nothing to snapshot.' };
  if (!factory) return { ok: false, reason: NO_STORAGE };
  const db = await openDB(factory);
  if (!db) return { ok: false, reason: NO_STORAGE };
  try {
    const store = db.transaction(SNAP_STORE, 'readwrite').objectStore(SNAP_STORE);
    const all = await asPromise(store.getAll());
    if (all.length >= MAX_SNAPSHOTS) return { ok: false, reason: TOO_MANY };
    const rec = {
      key: newKey(),
      name: snapName(entry.name),
      at: Number.isFinite(entry.at) ? entry.at : Date.now(),
      json: entry.json,
      thumb: entry.thumb || null,
      facts: entry.facts || null,
    };
    await asPromise(store.put(rec));
    return { ok: true, id: rec.key };
  } catch (err) {
    return { ok: false, reason: `Could not keep the snapshot: ${err && err.message ? err.message : 'storage refused'}` };
  } finally {
    closeQuietly(db);
  }
}

// Every snapshot, newest first, without the designs.
export async function listSnapshots(idb) {
  const factory = idbOf(idb);
  if (!factory) return [];
  const db = await openDB(factory);
  if (!db) return [];
  try {
    const store = db.transaction(SNAP_STORE, 'readonly').objectStore(SNAP_STORE);
    const all = await asPromise(store.getAll());
    return all.filter((r) => r && typeof r.key === 'string').map(summaryOf).sort((a, b) => b.at - a.at);
  } catch {
    return [];
  } finally {
    closeQuietly(db);
  }
}

// One snapshot with its design, or null — a miss and a refusal look the same.
export async function loadSnapshot(id, idb) {
  const factory = idbOf(idb);
  if (!factory || typeof id !== 'string') return null;
  const db = await openDB(factory);
  if (!db) return null;
  try {
    const store = db.transaction(SNAP_STORE, 'readonly').objectStore(SNAP_STORE);
    const rec = await asPromise(store.get(id));
    return rec && typeof rec.json === 'string' ? { ...summaryOf(rec), json: rec.json } : null;
  } catch {
    return null;
  } finally {
    closeQuietly(db);
  }
}

export async function deleteSnapshot(id, idb) {
  const factory = idbOf(idb);
  if (!factory || typeof id !== 'string') return false;
  const db = await openDB(factory);
  if (!db) return false;
  try {
    const store = db.transaction(SNAP_STORE, 'readwrite').objectStore(SNAP_STORE);
    await asPromise(store.delete(id));
    return true;
  } catch {
    return false;
  } finally {
    closeQuietly(db);
  }
}

export async function renameSnapshot(id, name, idb) {
  const factory = idbOf(idb);
  if (!factory || typeof id !== 'string') return false;
  const db = await openDB(factory);
  if (!db) return false;
  try {
    const store = db.transaction(SNAP_STORE, 'readwrite').objectStore(SNAP_STORE);
    const rec = await asPromise(store.get(id));
    if (!rec) return false;
    await asPromise(store.put({ ...rec, name: snapName(name) }));
    return true;
  } catch {
    return false;
  } finally {
    closeQuietly(db);
  }
}

// How a timeline says when. Relative for today, a date otherwise — the
// question a history answers is "which one is Tuesday's".
export function whenLabel(at, now = Date.now()) {
  const d = new Date(at);
  if (!Number.isFinite(at)) return '';
  const ago = now - at;
  if (ago >= 0 && ago < 60 * 1000) return 'just now';
  if (ago >= 0 && ago < 60 * 60 * 1000) return `${Math.floor(ago / 60000)} min ago`;
  const sameDay = new Date(now).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `today, ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}, ${time}`;
}
