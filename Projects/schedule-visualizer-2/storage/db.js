// The device's copy of the project: two IndexedDB databases, so that a main
// database that is corrupt or was cleared does not take the recovery points
// with it.
//
//   sv2            project    "current"      { savedAt, project, exportedAt, openedAt? }
//                             "shelf:<id>"   { savedAt, project, exportedAt, shelvedAt, bytes, images }
//                  snapshots  "n…" (the id)  { id, name, takenAt, bytes, project }
//                  images     "i…"           { blob, type, width, height }
//                  quarantine autoincrement  { at, raw, error }
//   sv2-recovery   recovery   autoincrement  { takenAt, reason, summary, bytes, project, images }
//
// Several projects on one device (ARCHITECTURE 21.4, 21.10). The open project
// stays at "current", exactly where an older planner looks for it. Every other
// project on the device is a shelf record, key "shelf:" + the project's id, in
// the same store. A shelf record carries its traced images inside itself
// (`images`: { [imageId]: { blob, type, width, height } }), not in the images
// store, so the image sweep, an older planner's included, cannot take them: it
// keeps only what "current", a snapshot or a quarantined record names.
//
// The functions for the session (storage/session.js, steps 1 to 6 of 21.10's
// "Switching"). Each is one transaction, so a project is never in neither place:
//
//   listShelf() -> [{ id, label, schoolName, savedAt, shelvedAt, bytes, summary, unreadable? }]
//       Step 1's list. Newest shelved first. Reads no image. A damaged record
//       (not an object, or its `project` not an object) is listed too, with
//       `unreadable: true`, its id taken from the key and the rest blank, so
//       the session can offer to export it as it is or delete it; a readable
//       record has no `unreadable` key. Every key under the prefix is listed,
//       so the list agrees with shelfIds() and with PROJECTS_MOST's count.
//   readShelved(id) -> the raw record, or null
//       Step 1: the session reads the target and runs it through readProject
//       (validate, migrate, repair) before anything moves. An unreadable record
//       is offered as a file as it is: nothing here has altered it.
//   switchTo(targetId, open, known, { images }) -> savedAt
//       Step 5. `open` is the very project object the recovery point of step 4
//       was taken from. `known` is the savedAt this tab last read or wrote.
//       `images` is a Map (or object) of imageId -> { blob, type, width, height }
//       for the images the session holds; the store is asked only for the ids
//       it lacks. Puts `open` on the shelf, the target at "current" (with
//       `openedAt` = the new savedAt, which the tab lock reads, 21.10 "The tab
//       lock across a reload"), the target's images into the images store, then
//       sweeps. Resolves with the new savedAt, which is the session's `known`.
//   shelveAndStart(open, fresh, known, { images, freshImages }) -> savedAt
//       The same with `fresh` (a new, sample or duplicated project) becoming
//       current. `freshImages` are the fresh project's images, put into the
//       images store in the same transaction.
//   deleteShelved(id) -> true when there was one. (The caller took the point.)
//   renameShelved(id, label) -> the new label. Not an undo step.
//   shelfIds() -> ids on the shelf, for the one-per-id rule.
//
// Refusals (a ShelfError with a `code`, except the first two): ConflictError
// when "current" is newer than `known`; TypeError when the target or the fresh
// project is the open one; ShelfError 'shelf-has-open' when shelf:<open.id>
// exists (only an older planner can cause that: export both), 'no-such-project',
// 'shelf-has-fresh', 'shelf-full' (PROJECTS_MOST), 'unreadable-target' (switchTo
// only: the record is not an object, or its `project` is not an object with a
// string `id` equal to the target id; nothing moves). A request inside a move
// that fails on its own aborts the whole transaction and the promise rejects
// with that request's error: everything or nothing. `hooks.failWrite` fails
// every one of these, deleteShelved and renameShelved included, with its
// sentence; `hooks.failSwitchLate` aborts the transaction after every write was
// issued; `hooks.failSwitchRequest` makes one request inside a move fail
// asynchronously (an add on a key that exists), to prove nothing is half done.
// forgetStored() is called by each success.
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

// How many recovery points are kept: the open project's newest 8; of every
// other project the newest OTHER_POINTS_EACH, at most OTHER_POINTS_MOST of
// other projects together (21.10 "Recovery points").
export const RECOVERY_KEEP = 8;
export const OTHER_POINTS_EACH = 3;
export const OTHER_POINTS_MOST = 24;

// Other projects kept on the shelf's key prefix; at most PROJECTS_MOST projects
// on a device, the open one included.
export const SHELF_PREFIX = 'shelf:';
export const PROJECTS_MOST = 20;
const SHELF_RANGE_END = SHELF_PREFIX + '\uffff';
// The longest label (21.5); the caller's own check is the rule, this one only
// keeps a rename from writing a record validate would refuse.
const LABEL_MOST = 60;

// For the tests. `failWrite` set to a sentence makes every save of the
// project fail with it, the way a full disk would; `failImagePut` set true
// makes every putImage's transaction abort, the way a full disk would.
// `failSwitchLate` set true aborts each shelf move once all its writes have
// been issued; `failSwitchRequest` set true makes one request of each shelf
// move fail by itself, after the others were issued.
export const hooks = { failWrite: null, failImagePut: false, failSwitchLate: false, failSwitchRequest: false };

// The saved record is newer than the one this tab last read or wrote: another
// tab saved in between. Nothing was written.
export class ConflictError extends Error {
  constructor(savedAt) {
    super('Another tab saved this project at ' + savedAt + ', after this tab last read it.');
    this.name = 'ConflictError';
    this.savedAt = savedAt;
  }
}

// A refusal of a shelf operation: `code` says which, the message says what to do.
export class ShelfError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ShelfError';
    this.code = code;
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

// How much a project weighs when stored: its JSON as UTF-8, plus its images.
// `images` is { id: { blob } } or { id: Blob }.
export function projectBytes(project, images) {
  let bytes = new Blob([JSON.stringify(project)]).size;
  for (const value of Object.values(images || {})) {
    const blob = value && value.blob ? value.blob : value;
    bytes += blob && Number.isFinite(blob.size) ? blob.size : 0;
  }
  return bytes;
}

// Whose a recovery point is: its `projectId`, or for a point taken before that
// field existed, its project's id. '' when it says neither.
export function pointProjectId(point) {
  if (!isObject(point)) return '';
  if (typeof point.projectId === 'string') return point.projectId;
  return isObject(point.project) && typeof point.project.id === 'string' ? point.project.id : '';
}

// An image by id from a Map or a plain object, or undefined.
function heldImage(held, id) {
  if (!held) return undefined;
  if (typeof held.get === 'function') return held.get(id);
  return Object.prototype.hasOwnProperty.call(held, id) ? held[id] : undefined;
}

// The four figures a shelf list shows, read defensively (nothing is validated here).
function shelfSummary(project) {
  const floors = isObject(project) && isObject(project.building) && Array.isArray(project.building.floors) ? project.building.floors : [];
  let rooms = 0;
  for (const floor of floors) {
    for (const space of isObject(floor) && Array.isArray(floor.spaces) ? floor.spaces : []) {
      if (isObject(space) && space.kind === 'room') rooms += 1;
    }
  }
  const count = (list) => (Array.isArray(list) ? list.length : 0);
  return { floors: floors.length, rooms, groups: count(project && project.groups), teachers: count(project && project.teachers) };
}

function sameIds(a, b) {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

// Every open connection's `fresh` set (below): images stored on this page
// that no saved project names yet, which no sweep on any connection may take.
const liveFresh = new Set();

// The image sweep for code with a connection of its own (storage/snapshots.js
// deleting a snapshot). Inside a readwrite transaction over snapshots,
// quarantine and images: delete every image that nothing names. Kept: `named`
// (the saved project and the one on screen, as the caller read them in the
// same transaction), every image a snapshot names, every image a record set
// aside in quarantine names (so a recovered copy still has its pictures), and
// every image a connection on this page stored that no saved project names
// yet (an import between storing its images and saving). `done(swept)` is
// called with the ids deleted, before the transaction commits.
export function sweepUnnamedImages(tx, named, done) {
  const keep = new Set(named);
  const finish = done || (() => {});
  const snapshots = tx.objectStore(SNAPSHOT_STORE).openCursor();
  snapshots.onsuccess = () => {
    const at = snapshots.result;
    if (at) {
      for (const id of imageIdsOf(at.value && at.value.project)) keep.add(id);
      at.continue();
      return;
    }
    const aside = tx.objectStore(QUARANTINE_STORE).openCursor();
    aside.onsuccess = () => {
      const held = aside.result;
      if (held) {
        const raw = held.value && held.value.raw;
        for (const id of imageIdsOf(raw)) keep.add(id);
        for (const id of imageIdsOf(raw && raw.project)) keep.add(id);
        held.continue();
        return;
      }
      const images = tx.objectStore(IMAGE_STORE);
      const keys = images.getAllKeys();
      keys.onsuccess = () => {
        const swept = keys.result.filter((id) => !keep.has(id) && !Array.from(liveFresh).some((set) => set.has(id)));
        for (const id of swept) images.delete(id);
        finish(swept);
      };
    };
  };
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
  // Each is held from its putImage until a save that names it, or until a
  // save started after the put completes without naming it (SV2-28b): by
  // then the project the put was for has been on screen and saved, or was
  // undone before it ever was (a snapshot restored and undone inside the
  // autosave's 600 ms), and the image is an ordinary one again, which the
  // next sweep keeps only if something names it. A put the save did not
  // follow (the save began first) is still held. Map of id -> the put's
  // number, against `puts`. A put is numbered when its transaction completes
  // (SV2-28d): until then it is Infinity, which no save follows and no save
  // releases, so a save begun while the bytes are still being written can
  // never count them as done. `flying` counts the puts of an id in flight.
  // `landed` (SV2-28e) holds the fresh ids a put of which committed: a put
  // that failed is numbered too, so that saves release it, but its bytes
  // are not known to be stored.
  const fresh = new Map();
  const flying = new Map();
  const landed = new Set();
  let puts = 0;
  liveFresh.add(fresh);
  // The images the session holds, as the last save was given them, for the
  // save made as the page is left (which is given none).
  let lastHeld = null;
  // Saves begun and not yet complete or refused.
  let saving = 0;
  // The image ids of the project as last saved, to know when a sweep is due.
  // null when nothing is known of the images store (no save yet, or since
  // forgetStored()): the next save sweeps, which puts back every image the
  // project names that the store lacks. `era` counts forgetStored() calls,
  // so a save begun before one does not set it again when it completes.
  let savedImageIds = null;
  let era = 0;

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
      const begunIn = era;
      // the puts this save follows: every one numbered up to here
      const follows = puts;
      if (extra && extra.images) lastHeld = extra.images;
      let stamp = clock().toISOString();
      if (typeof known === 'string' && stamp <= known) stamp = new Date(Date.parse(known) + 1).toISOString();
      const record = { savedAt: stamp, project, exportedAt: extra && extra.exportedAt ? extra.exportedAt : null };
      let refusal = null;
      let tx;
      try {
        tx = main.transaction(sweep ? [PROJECT_STORE, SNAPSHOT_STORE, QUARANTINE_STORE, IMAGE_STORE] : [PROJECT_STORE], 'readwrite');
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
            sweepUnnamedImages(tx, names);
          }
        };
      } catch (error) {
        reject(error);
        return;
      }
      saving += 1;
      tx.oncomplete = () => {
        saving -= 1;
        if (begunIn === era) savedImageIds = names;
        for (const [id, put] of Array.from(fresh)) {
          if (put !== Infinity && (names.includes(id) || put <= follows)) {
            fresh.delete(id);
            landed.delete(id);
          }
        }
        resolve(stamp);
      };
      tx.onerror = (event) => event.preventDefault();
      tx.onabort = () => {
        saving -= 1;
        reject(refusal || tx.error || new Error('The browser stopped the write.'));
      };
    });
  }

  // Save as the page is being left. A page that is going gets to start a
  // write but not to wait for an answer, so this one does not read first: the
  // put is issued here and now, with no check of what is stored and no sweep,
  // so it spares every image, fresh, in flight or otherwise. Only the editing
  // tab calls it. Returns { savedAt, done }: the stamp at once, and a promise
  // for the commit that the page may never see.
  //
  // Its backstop (SV2-28d), what restoreImages is to saveProject: an image
  // the project names that an earlier save may have swept (an undo since)
  // is written again in the same transaction, from the images the session
  // holds (`extra.images`, else those the last save was given). Without a
  // read first it cannot ask what is stored, so it writes each one that is
  // not known to be there: known means named by the last save to complete
  // while no other save is under way (and since the last forgetStored()),
  // or put in this session, committed and not yet released (SV2-28e: a put
  // that failed, or is still in flight, is not known to be stored, and is
  // written from what the session holds). Transactions over one store run
  // in the order they were made, so whenever the project names an image put
  // in this session the transaction takes in the images store as well: it
  // then commits after any put of it still in flight, never before.
  function saveProjectLeaving(project, known, extra) {
    let stamp = clock().toISOString();
    if (typeof known === 'string' && stamp <= known) stamp = new Date(Date.parse(known) + 1).toISOString();
    if (hooks.failWrite) return { savedAt: null, done: Promise.reject(new Error(hooks.failWrite)) };
    const held = extra && extra.images ? extra.images : lastHeld;
    const stored = new Set(saving === 0 && savedImageIds ? savedImageIds : []);
    const named = imageIdsOf(project);
    const missing = held ? named.filter((id) => held.has(id) && !stored.has(id) && !(fresh.has(id) && landed.has(id))) : [];
    const images = missing.length > 0 || named.some((id) => fresh.has(id));
    const tx = main.transaction(images ? [PROJECT_STORE, IMAGE_STORE] : [PROJECT_STORE], 'readwrite');
    tx.objectStore(PROJECT_STORE).put({ savedAt: stamp, project, exportedAt: extra && extra.exportedAt ? extra.exportedAt : null }, CURRENT_KEY);
    for (const id of missing) tx.objectStore(IMAGE_STORE).put(held.get(id), id);
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

  // The tab is to edit again after a spell as read-only (SV2-28e): another
  // tab may have swept or written images since, so nothing is known of the
  // images store. The next save sweeps and puts back what the project names;
  // the save made as the page is left counts none as stored, this session's
  // own committed puts included (SV2-28f).
  function forgetStored() {
    savedImageIds = null;
    landed.clear();
    era += 1;
  }

  // ------------------------------------------------------------ images

  // Keep an image's bytes. `value` is { blob, type, width, height }.
  // Fresh from now, and numbered only once the put has committed (or
  // failed): a save that begins while it is in flight does not follow it.
  async function putImage(id, value) {
    flying.set(id, (flying.get(id) || 0) + 1);
    fresh.set(id, Infinity);
    try {
      const tx = main.transaction(IMAGE_STORE, 'readwrite');
      tx.objectStore(IMAGE_STORE).put(value, id);
      if (hooks.failImagePut) tx.abort();
      await committed(tx);
      landed.add(id);
    } finally {
      const left = flying.get(id) - 1;
      if (left > 0) {
        flying.set(id, left);
      } else {
        flying.delete(id);
        puts += 1;
        fresh.set(id, puts);
      }
    }
  }

  function getImage(id) {
    return asPromise(main.transaction(IMAGE_STORE, 'readonly').objectStore(IMAGE_STORE).get(id));
  }

  function imageIds() {
    return asPromise(main.transaction(IMAGE_STORE, 'readonly').objectStore(IMAGE_STORE).getAllKeys());
  }

  // ------------------------------------------------------------ recovery points

  // The project id of each recovery point key this connection has met. A
  // record is never changed once added, so a key is read once.
  const pointOwners = new Map();

  // Add a point and trim, in one transaction. `spare` is the key of a point
  // that must survive this trim (the one being restored). `openId` is the
  // project that is open (the point's own project when not given: every point
  // is taken of the open one). Kept: the newest RECOVERY_KEEP of the open
  // project, the newest OTHER_POINTS_EACH of each other project, and of other
  // projects together at most OTHER_POINTS_MOST, newest first. The walk is over
  // keys only; a record is read (for its `projectId`) only when the store holds
  // more than OTHER_POINTS_EACH points (fewer cannot need a trim) and this
  // connection has not met its key before. When the add itself fails the
  // transaction aborts and this rejects; a failed delete of the trim is left
  // to the next point (the new point is kept, which is what matters).
  // Resolves with the new point's key.
  function addPoint(point, spare, openId) {
    return new Promise((resolve, reject) => {
      let key = null;
      let tx;
      try {
        tx = needRecovery().transaction(RECOVERY_STORE, 'readwrite');
        const store = tx.objectStore(RECOVERY_STORE);
        const added = store.add(point);
        added.onsuccess = () => {
          key = added.result;
          pointOwners.set(key, pointProjectId(point));
          const open = typeof openId === 'string' ? openId : pointProjectId(point);
          const keys = [];
          const walk = store.openKeyCursor(null, 'prev');
          walk.onsuccess = () => {
            const at = walk.result;
            if (at) {
              keys.push(at.key);
              at.continue();
              return;
            }
            trimPoints(store, keys, open, spare);
          };
        };
      } catch (error) {
        reject(error);
        return;
      }
      tx.oncomplete = () => resolve(key);
      tx.onerror = (event) => {
        // a failed delete of the trim leaves the point added; a failed add must not commit
        if (key !== null) event.preventDefault();
      };
      tx.onabort = () => reject(tx.error || new Error('The browser stopped the write.'));
    });
  }

  // `keys` newest first. Delete what the keep rules above do not keep.
  function trimPoints(store, keys, open, spare) {
    for (const known of Array.from(pointOwners.keys())) {
      if (!keys.includes(known)) pointOwners.delete(known);
    }
    if (keys.length <= OTHER_POINTS_EACH) return;
    const unknown = keys.filter((key) => !pointOwners.has(key));
    let waiting = unknown.length;
    const decide = () => {
      let openSeen = 0;
      let othersSeen = 0;
      const each = new Map();
      for (const key of keys) {
        const owner = pointOwners.get(key);
        let keep;
        if (owner === open) {
          openSeen += 1;
          keep = openSeen <= RECOVERY_KEEP;
        } else {
          const mine = (each.get(owner) || 0) + 1;
          each.set(owner, mine);
          keep = mine <= OTHER_POINTS_EACH && othersSeen < OTHER_POINTS_MOST;
          if (keep) othersSeen += 1;
        }
        if (!keep && key !== spare) store.delete(key);
      }
    };
    if (waiting === 0) {
      decide();
      return;
    }
    for (const key of unknown) {
      const read = store.get(key);
      read.onsuccess = () => {
        pointOwners.set(key, pointProjectId(read.result));
        waiting -= 1;
        if (waiting === 0) decide();
      };
    }
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

  // ------------------------------------------------------------ the shelf

  function shelfRange() {
    return IDBKeyRange.bound(SHELF_PREFIX, SHELF_RANGE_END);
  }

  // The projects kept besides the open one, newest shelved first. The records
  // are read whole (a list is at most PROJECTS_MOST - 1 long). A damaged
  // record is listed with `unreadable: true` and its id from the key.
  function listShelf() {
    return new Promise((resolve, reject) => {
      const found = [];
      let cursor;
      try {
        cursor = main.transaction(PROJECT_STORE, 'readonly').objectStore(PROJECT_STORE).openCursor(shelfRange());
      } catch (error) {
        reject(error);
        return;
      }
      cursor.onerror = () => reject(cursor.error);
      cursor.onsuccess = () => {
        const at = cursor.result;
        if (!at) {
          found.sort((a, b) => (a.shelvedAt < b.shelvedAt ? 1 : a.shelvedAt > b.shelvedAt ? -1 : a.id < b.id ? -1 : 1));
          resolve(found);
          return;
        }
        const record = at.value;
        if (!isObject(record) || !isObject(record.project)) {
          const kept = isObject(record) ? record : {};
          found.push({
            id: String(at.key).slice(SHELF_PREFIX.length),
            label: '',
            schoolName: '',
            savedAt: typeof kept.savedAt === 'string' ? kept.savedAt : '',
            shelvedAt: typeof kept.shelvedAt === 'string' ? kept.shelvedAt : '',
            bytes: Number.isFinite(kept.bytes) ? kept.bytes : 0,
            summary: shelfSummary(null),
            unreadable: true,
          });
        } else {
          const project = isObject(record.project) ? record.project : {};
          const settings = isObject(project.settings) ? project.settings : {};
          found.push({
            id: String(at.key).slice(SHELF_PREFIX.length),
            label: typeof project.label === 'string' ? project.label : '',
            schoolName: typeof settings.schoolName === 'string' ? settings.schoolName : '',
            savedAt: typeof record.savedAt === 'string' ? record.savedAt : '',
            shelvedAt: typeof record.shelvedAt === 'string' ? record.shelvedAt : '',
            bytes: Number.isFinite(record.bytes) ? record.bytes : 0,
            summary: shelfSummary(project),
          });
        }
        at.continue();
      };
    });
  }

  function shelfIds() {
    return asPromise(main.transaction(PROJECT_STORE, 'readonly').objectStore(PROJECT_STORE).getAllKeys(shelfRange())).then((keys) => keys.map((key) => String(key).slice(SHELF_PREFIX.length)));
  }

  // The record exactly as stored, or null.
  async function readShelved(id) {
    const record = await asPromise(main.transaction(PROJECT_STORE, 'readonly').objectStore(PROJECT_STORE).get(SHELF_PREFIX + id));
    return record === undefined ? null : record;
  }

  // The move behind switchTo and shelveAndStart: in one transaction, the open
  // project goes on the shelf and another becomes current. `target` is a shelf
  // id to bring in, or null when `fresh` (a project in memory) is to start.
  function shelve(target, open, fresh, known, extra) {
    return new Promise((resolve, reject) => {
      if (hooks.failWrite) {
        reject(new Error(hooks.failWrite));
        return;
      }
      const incoming = target === null ? fresh : null;
      const incomingId = target === null ? (isObject(fresh) ? fresh.id : undefined) : target;
      if (!isObject(open) || typeof open.id !== 'string' || open.id === '') {
        reject(new TypeError('The project to put on the shelf has no id.'));
        return;
      }
      if (typeof incomingId !== 'string' || incomingId === '') {
        reject(new TypeError('The project to open has no id.'));
        return;
      }
      if (incomingId === open.id) {
        reject(new TypeError('That project is the one already open.'));
        return;
      }
      const held = extra && extra.images;
      const freshHeld = extra && extra.freshImages;
      let stamp = clock().toISOString();
      if (typeof known === 'string' && stamp <= known) stamp = new Date(Date.parse(known) + 1).toISOString();
      let refusal = null;
      let tx;
      const refuse = (error) => {
        refusal = error;
        tx.abort();
      };
      try {
        tx = main.transaction([PROJECT_STORE, SNAPSHOT_STORE, QUARANTINE_STORE, IMAGE_STORE], 'readwrite');
        const projects = tx.objectStore(PROJECT_STORE);
        const images = tx.objectStore(IMAGE_STORE);
        const at = projects.get(CURRENT_KEY);
        at.onsuccess = () => {
          const there = at.result;
          if (isObject(there) && typeof there.savedAt === 'string' && there.savedAt > (known || '')) {
            refuse(new ConflictError(there.savedAt));
            return;
          }
          const shelved = projects.get(SHELF_PREFIX + open.id);
          shelved.onsuccess = () => {
            if (shelved.result !== undefined) {
              refuse(new ShelfError('shelf-has-open', 'This device already keeps a second copy of \u201c' + (open.label || (open.settings && open.settings.schoolName) || 'this project') + '\u201d on its shelf, which only an older version of the planner can cause. Export both copies before going on.'));
              return;
            }
            const next = projects.get(SHELF_PREFIX + incomingId);
            next.onsuccess = () => {
              if (target !== null && next.result === undefined) {
                refuse(new ShelfError('no-such-project', 'That project is no longer kept on this device.'));
                return;
              }
              if (target !== null && !(isObject(next.result) && isObject(next.result.project) && typeof next.result.project.id === 'string' && next.result.project.id === target)) {
                refuse(new ShelfError('unreadable-target', 'The copy of that project kept on this device cannot be read, so it was not opened. Export it as it is, or delete it.'));
                return;
              }
              if (target === null && next.result !== undefined) {
                refuse(new ShelfError('shelf-has-fresh', 'A project with that id is already kept on this device.'));
                return;
              }
              const count = projects.count(shelfRange());
              count.onsuccess = () => {
                if (target === null && count.result + 1 > PROJECTS_MOST - 1) {
                  refuse(new ShelfError('shelf-full', 'This device keeps ' + PROJECTS_MOST + ' projects at most. Delete one before starting another.'));
                  return;
                }
                finish(there, next.result);
              };
            };
          };
        };

        // every check passed: gather the open project's images, then write
        const finish = (there, record) => {
          const names = imageIdsOf(open);
          const shelfImages = {};
          const lacking = [];
          for (const id of names) {
            const value = heldImage(held, id);
            if (value) shelfImages[id] = value;
            else lacking.push(id);
          }
          let waiting = lacking.length;
          const write = () => {
            const shelvedAt = stamp;
            projects.put({
              savedAt: isObject(there) && typeof there.savedAt === 'string' ? there.savedAt : stamp,
              project: open,
              exportedAt: isObject(there) && there.exportedAt ? there.exportedAt : null,
              shelvedAt,
              bytes: projectBytes(open, shelfImages),
              images: shelfImages,
            }, SHELF_PREFIX + open.id);
            // for the tests: a request that fails by itself (the key was just put)
            if (hooks.failSwitchRequest) projects.add({}, SHELF_PREFIX + open.id);
            let start;
            let startImages;
            let exportedAt = null;
            if (target !== null) {
              start = record.project;
              startImages = isObject(record.images) ? record.images : {};
              exportedAt = record.exportedAt || null;
            } else {
              start = incoming;
              startImages = freshHeld || {};
            }
            const startIds = typeof startImages.entries === 'function' && typeof startImages.get === 'function' ? Array.from(startImages.keys()) : Object.keys(startImages);
            for (const id of startIds) images.put(heldImage(startImages, id), id);
            projects.put({ savedAt: stamp, project: start, exportedAt, openedAt: stamp }, CURRENT_KEY);
            if (target !== null) projects.delete(SHELF_PREFIX + target);
            sweepUnnamedImages(tx, imageIdsOf(start));
            if (hooks.failSwitchLate) {
              refusal = new Error('The move was stopped after its writes, to prove that nothing is half done.');
              tx.abort();
            }
          };
          if (waiting === 0) {
            write();
            return;
          }
          for (const id of lacking) {
            const read = images.get(id);
            read.onsuccess = () => {
              if (read.result !== undefined) shelfImages[id] = read.result;
              waiting -= 1;
              if (waiting === 0) write();
            };
          }
        };
      } catch (error) {
        reject(error);
        return;
      }
      saving += 1;
      tx.oncomplete = () => {
        saving -= 1;
        forgetStored();
        resolve(stamp);
      };
      tx.onerror = (event) => {
        // one failed request fails the whole move: record it, stop everything
        event.preventDefault();
        if (!refusal) refusal = (event.target && event.target.error) || tx.error;
        try {
          tx.abort();
        } catch (error) {
          // already stopping
        }
      };
      tx.onabort = () => {
        saving -= 1;
        reject(refusal || tx.error || new Error('The browser stopped the write.'));
      };
    });
  }

  function switchTo(targetId, open, known, extra) {
    return shelve(typeof targetId === 'string' ? targetId : '', open, null, known, extra);
  }

  function shelveAndStart(open, fresh, known, extra) {
    return shelve(null, open, fresh, known, extra);
  }

  async function deleteShelved(id) {
    if (hooks.failWrite) throw new Error(hooks.failWrite);
    const tx = main.transaction(PROJECT_STORE, 'readwrite');
    const store = tx.objectStore(PROJECT_STORE);
    let existed = false;
    const there = store.getKey(SHELF_PREFIX + id);
    there.onsuccess = () => {
      existed = there.result !== undefined;
      store.delete(SHELF_PREFIX + id);
    };
    await committed(tx);
    return existed;
  }

  async function renameShelved(id, label) {
    if (hooks.failWrite) throw new Error(hooks.failWrite);
    const text = typeof label === 'string' ? label.trim() : null;
    if (text === null || text.length > LABEL_MOST) throw new TypeError('A project label is text of at most ' + LABEL_MOST + ' characters.');
    const tx = main.transaction(PROJECT_STORE, 'readwrite');
    const store = tx.objectStore(PROJECT_STORE);
    let refusal = null;
    const read = store.get(SHELF_PREFIX + id);
    read.onsuccess = () => {
      const record = read.result;
      if (!isObject(record) || !isObject(record.project)) {
        refusal = new ShelfError('no-such-project', 'That project is no longer kept on this device.');
        tx.abort();
        return;
      }
      store.put({ ...record, project: { ...record.project, label: text } }, SHELF_PREFIX + id);
    };
    try {
      await committed(tx);
    } catch (error) {
      throw refusal || error;
    }
    return text;
  }

  return {
    main,
    recovery,
    recoveryError,
    readCurrent,
    saveProject,
    saveProjectLeaving,
    forgetStored,
    listShelf,
    shelfIds,
    readShelved,
    switchTo,
    shelveAndStart,
    deleteShelved,
    renameShelved,
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
      liveFresh.delete(fresh);
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
