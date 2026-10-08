// The device's copy of the project: two IndexedDB databases, so that a main
// database that is corrupt or was cleared does not take the recovery points
// with it.
//
//   sv2            project    "current"      { savedAt, project, exportedAt }
//                  snapshots  "n…" (the id)  { id, name, takenAt, bytes, project }
//                  images     "i…"           { blob, type, width, height }
//                  quarantine autoincrement  { at, raw, error }
//   sv2-recovery   recovery   autoincrement  { takenAt, reason, summary, bytes, project, images }
//
// Every name above is permanent. A person's work is behind them; a renamed
// database or store is a lost project.
//
// openDatabases({ indexedDB, clock }) gives the object the rest of storage/
// uses. Nothing here knows about the page: no DOM, no store, no timers.

export const DB_NAME = 'sv2';
export const DB_VERSION = 1;
export const RECOVERY_DB_NAME = 'sv2-recovery';
export const RECOVERY_DB_VERSION = 1;

export const PROJECT_STORE = 'project';
export const SNAPSHOT_STORE = 'snapshots';
export const IMAGE_STORE = 'images';
export const QUARANTINE_STORE = 'quarantine';
export const RECOVERY_STORE = 'recovery';
export const CURRENT_KEY = 'current';

// How many recovery points are kept.
export const RECOVERY_KEEP = 8;

// For the tests. `failWrite` set to a sentence makes every save of the
// project fail with it, the way a full disk would.
export const hooks = { failWrite: null };

// The saved record is newer than the one this tab last read or wrote: another
// tab saved in between. Nothing was written.
export class ConflictError extends Error {
  constructor(savedAt) {
    super('Another tab saved this project at ' + savedAt + ', after this tab last read it.');
    this.name = 'ConflictError';
    this.savedAt = savedAt;
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Resolves when the transaction has committed; a write is not kept before that.
function committed(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('The browser stopped the write.'));
  });
}

// Ask for the commit now instead of when the last request has answered. A
// transaction still open when its page goes is dropped, so a write issued as
// the page leaves has to be committed in the same breath.
function commitNow(tx) {
  if (typeof tx.commit === 'function') tx.commit();
}

function open(factory, name, version, upgrade) {
  return new Promise((resolve, reject) => {
    let request;
    try {
      request = factory.open(name, version);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = () => upgrade(request.result);
    request.onblocked = () => reject(new Error('Another tab is holding an older copy of the saved project open. Close the other tabs and reload.'));
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      // a later version of the tool, in another tab, wants to upgrade: let it
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

// The traced images a project names.
export function imageIdsOf(project) {
  const found = [];
  const floors = project && project.building && Array.isArray(project.building.floors) ? project.building.floors : [];
  for (const floor of floors) {
    if (floor && floor.image && typeof floor.image.imageId === 'string') found.push(floor.image.imageId);
  }
  return found;
}

function sameIds(a, b) {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

export async function openDatabases(options) {
  const opts = options || {};
  const factory = opts.indexedDB || globalThis.indexedDB;
  const clock = opts.clock || (() => new Date());
  if (!factory) throw new Error('This browser has no storage for a project (IndexedDB is missing or switched off).');

  const main = await open(factory, DB_NAME, DB_VERSION, (db) => {
    db.createObjectStore(PROJECT_STORE);
    db.createObjectStore(SNAPSHOT_STORE, { keyPath: 'id' });
    db.createObjectStore(IMAGE_STORE);
    db.createObjectStore(QUARANTINE_STORE, { autoIncrement: true });
  });

  // The recovery database is apart on purpose, and the tool carries on
  // without it: `recoveryError` says why it is missing.
  let recovery = null;
  let recoveryError = null;
  try {
    recovery = await open(factory, RECOVERY_DB_NAME, RECOVERY_DB_VERSION, (db) => {
      db.createObjectStore(RECOVERY_STORE, { autoIncrement: true });
    });
  } catch (error) {
    recoveryError = error;
  }

  // Image ids written in this session that no saved project names yet. A
  // save that runs before the project names them must not sweep them away.
  const fresh = new Set();
  // The image ids of the project as last saved, to know when a sweep is due.
  let savedImageIds = null;

  function needRecovery() {
    if (!recovery) throw recoveryError || new Error('This device is not keeping recovery points.');
    return recovery;
  }

  // ------------------------------------------------------------ the project

  // The record as stored, or undefined. Nothing is checked here.
  function readCurrent() {
    const tx = main.transaction(PROJECT_STORE, 'readonly');
    return asPromise(tx.objectStore(PROJECT_STORE).get(CURRENT_KEY));
  }

  // Save the project. `known` is the savedAt this tab last read or wrote
  // (null when it has seen none); a stored record newer than that is another
  // tab's work and is never overwritten: the save is refused with a
  // ConflictError. When the set of images the project names has changed,
  // the same transaction deletes the images nothing names any more, and puts
  // back any the project names again that an earlier save removed (an undo):
  // `extra.images` is a Map of imageId -> { blob, type, width, height } for
  // the images this tab holds. Resolves with the new savedAt.
  function saveProject(project, known, extra) {
    return new Promise((resolve, reject) => {
      if (hooks.failWrite) {
        reject(new Error(hooks.failWrite));
        return;
      }
      const names = imageIdsOf(project).sort();
      const sweep = savedImageIds === null || !sameIds(names, savedImageIds);
      let stamp = clock().toISOString();
      if (typeof known === 'string' && stamp <= known) stamp = new Date(Date.parse(known) + 1).toISOString();
      const record = { savedAt: stamp, project, exportedAt: extra && extra.exportedAt ? extra.exportedAt : null };
      let refusal = null;
      let tx;
      try {
        tx = main.transaction(sweep ? [PROJECT_STORE, SNAPSHOT_STORE, IMAGE_STORE] : [PROJECT_STORE], 'readwrite');
        const store = tx.objectStore(PROJECT_STORE);
        const held = store.get(CURRENT_KEY);
        held.onsuccess = () => {
          const there = held.result;
          if (isObject(there) && typeof there.savedAt === 'string' && there.savedAt > (known || '')) {
            refusal = new ConflictError(there.savedAt);
            tx.abort();
            return;
          }
          store.put(record, CURRENT_KEY);
          if (sweep) {
            restoreImages(tx, names, extra && extra.images);
            sweepImages(tx, names);
          }
        };
      } catch (error) {
        reject(error);
        return;
      }
      tx.oncomplete = () => {
        savedImageIds = names;
        for (const id of names) fresh.delete(id);
        resolve(stamp);
      };
      tx.onerror = (event) => event.preventDefault();
      tx.onabort = () => reject(refusal || tx.error || new Error('The browser stopped the write.'));
    });
  }

  // Save as the page is being left. A page that is going gets to start a
  // write but not to wait for an answer, so this one does not read first: the
  // put is issued here and now, with no check of what is stored and no sweep.
  // Only the editing tab calls it. Returns { savedAt, done }: the stamp at
  // once, and a promise for the commit that the page may never see.
  function saveProjectLeaving(project, known, extra) {
    let stamp = clock().toISOString();
    if (typeof known === 'string' && stamp <= known) stamp = new Date(Date.parse(known) + 1).toISOString();
    if (hooks.failWrite) return { savedAt: null, done: Promise.reject(new Error(hooks.failWrite)) };
    const tx = main.transaction(PROJECT_STORE, 'readwrite');
    tx.objectStore(PROJECT_STORE).put({ savedAt: stamp, project, exportedAt: extra && extra.exportedAt ? extra.exportedAt : null }, CURRENT_KEY);
    const done = committed(tx);
    commitNow(tx);
    return { savedAt: stamp, done };
  }

  // Inside the same transaction: an image the project names that is not
  // stored, and that this tab still holds, is stored again.
  function restoreImages(tx, named, held) {
    if (!held) return;
    const images = tx.objectStore(IMAGE_STORE);
    for (const id of named) {
      if (!held.has(id)) continue;
      const there = images.getKey(id);
      there.onsuccess = () => {
        if (there.result === undefined) images.put(held.get(id), id);
      };
    }
  }

  // Inside a write transaction over snapshots and images: delete every image
  // that neither `named` (the project being saved) nor any snapshot names.
  function sweepImages(tx, named) {
    const keep = new Set(named);
    const snapshots = tx.objectStore(SNAPSHOT_STORE).openCursor();
    snapshots.onsuccess = () => {
      const cursor = snapshots.result;
      if (cursor) {
        for (const id of imageIdsOf(cursor.value && cursor.value.project)) keep.add(id);
        cursor.continue();
        return;
      }
      const images = tx.objectStore(IMAGE_STORE);
      const keys = images.getAllKeys();
      keys.onsuccess = () => {
        for (const id of keys.result) if (!keep.has(id) && !fresh.has(id)) images.delete(id);
      };
    };
  }

  // Move an unreadable saved record aside, in one transaction, so that it is
  // never overwritten: it leaves `project/current` and lands in `quarantine`.
  async function quarantineCurrent(raw, error) {
    const tx = main.transaction([PROJECT_STORE, QUARANTINE_STORE], 'readwrite');
    tx.objectStore(QUARANTINE_STORE).add({ at: clock().toISOString(), raw, error: String(error && error.message ? error.message : error) });
    tx.objectStore(PROJECT_STORE).delete(CURRENT_KEY);
    await committed(tx);
  }

  // What has been set aside: [{ key, at, raw, error }], oldest first.
  function quarantined() {
    return new Promise((resolve, reject) => {
      const found = [];
      const cursor = main.transaction(QUARANTINE_STORE, 'readonly').objectStore(QUARANTINE_STORE).openCursor();
      cursor.onerror = () => reject(cursor.error);
      cursor.onsuccess = () => {
        const at = cursor.result;
        if (!at) {
          resolve(found);
          return;
        }
        found.push({ key: at.key, ...at.value });
        at.continue();
      };
    });
  }

  // ------------------------------------------------------------ images

  // Keep an image's bytes. `value` is { blob, type, width, height }.
  async function putImage(id, value) {
    fresh.add(id);
    const tx = main.transaction(IMAGE_STORE, 'readwrite');
    tx.objectStore(IMAGE_STORE).put(value, id);
    await committed(tx);
  }

  function getImage(id) {
    return asPromise(main.transaction(IMAGE_STORE, 'readonly').objectStore(IMAGE_STORE).get(id));
  }

  function imageIds() {
    return asPromise(main.transaction(IMAGE_STORE, 'readonly').objectStore(IMAGE_STORE).getAllKeys());
  }

  // ------------------------------------------------------------ recovery points

  // Add a point and drop all but the newest RECOVERY_KEEP, in one
  // transaction. `spare` is the key of a point that must survive this trim
  // (the one being restored). Resolves with the new point's key.
  function addPoint(point, spare) {
    return new Promise((resolve, reject) => {
      let key = null;
      let tx;
      try {
        tx = needRecovery().transaction(RECOVERY_STORE, 'readwrite');
        const store = tx.objectStore(RECOVERY_STORE);
        const added = store.add(point);
        added.onsuccess = () => {
          key = added.result;
          let seen = 0;
          const walk = store.openKeyCursor(null, 'prev');
          walk.onsuccess = () => {
            const at = walk.result;
            if (!at) return;
            seen += 1;
            if (seen > RECOVERY_KEEP && at.key !== spare) store.delete(at.key);
            at.continue();
          };
        };
      } catch (error) {
        reject(error);
        return;
      }
      tx.oncomplete = () => resolve(key);
      tx.onerror = (event) => event.preventDefault();
      tx.onabort = () => reject(tx.error || new Error('The browser stopped the write.'));
    });
  }

  // Add a point as the page is being left: the add is committed at once, and
  // the trim is left to the next point taken (a trim needs an answer first).
  function addPointLeaving(point) {
    const tx = needRecovery().transaction(RECOVERY_STORE, 'readwrite');
    tx.objectStore(RECOVERY_STORE).add(point);
    const done = committed(tx);
    commitNow(tx);
    return done;
  }

  // Every point, newest first: [{ key, takenAt, reason, summary, bytes, project, images }].
  function listPoints() {
    return new Promise((resolve, reject) => {
      const found = [];
      let cursor;
      try {
        cursor = needRecovery().transaction(RECOVERY_STORE, 'readonly').objectStore(RECOVERY_STORE).openCursor(null, 'prev');
      } catch (error) {
        reject(error);
        return;
      }
      cursor.onerror = () => reject(cursor.error);
      cursor.onsuccess = () => {
        const at = cursor.result;
        if (!at) {
          resolve(found);
          return;
        }
        found.push({ key: at.key, ...at.value });
        at.continue();
      };
    });
  }

  async function getPoint(key) {
    const value = await asPromise(needRecovery().transaction(RECOVERY_STORE, 'readonly').objectStore(RECOVERY_STORE).get(key));
    return value === undefined ? null : { key, ...value };
  }

  async function deletePoint(key) {
    const tx = needRecovery().transaction(RECOVERY_STORE, 'readwrite');
    tx.objectStore(RECOVERY_STORE).delete(key);
    await committed(tx);
  }

  return {
    main,
    recovery,
    recoveryError,
    readCurrent,
    saveProject,
    saveProjectLeaving,
    quarantineCurrent,
    quarantined,
    putImage,
    getImage,
    imageIds,
    addPoint,
    addPointLeaving,
    listPoints,
    getPoint,
    deletePoint,
    close() {
      main.close();
      if (recovery) recovery.close();
    },
  };
}

// How much room this origin is using: { usage, quota, share } in bytes and as
// a fraction, or null where the browser does not say.
export async function estimateUsage(storage) {
  const manager = storage || (globalThis.navigator && globalThis.navigator.storage);
  if (!manager || typeof manager.estimate !== 'function') return null;
  try {
    const { usage, quota } = await manager.estimate();
    if (!Number.isFinite(usage) || !Number.isFinite(quota) || quota <= 0) return null;
    return { usage, quota, share: usage / quota };
  } catch (error) {
    return null;
  }
}

// Ask the browser to keep this origin's storage until the user clears it.
// 'kept' (it agreed), 'best-effort' (it may clear it when the device runs
// low) or 'unknown' (it does not say).
export async function askToPersist(storage) {
  const manager = storage || (globalThis.navigator && globalThis.navigator.storage);
  if (!manager || typeof manager.persist !== 'function') return 'unknown';
  try {
    if (typeof manager.persisted === 'function' && (await manager.persisted())) return 'kept';
    return (await manager.persist()) ? 'kept' : 'best-effort';
  } catch (error) {
    return 'unknown';
  }
}
