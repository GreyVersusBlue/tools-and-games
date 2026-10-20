// Snapshots (spec 13.3): copies of the project kept on this device by name,
// "Before moving 7th grade", until the person deletes them. Each is one record
// in the `snapshots` store of the `sv2` database (db.js):
//
//   { id: "n…", name, takenAt, bytes, project }
//
// A snapshot holds no image bytes. The traced images it names stay in the
// `images` store, which keeps an image while the saved project or any
// snapshot names it (db.js sweeps the rest when the project's images change);
// deleting a snapshot sweeps in the same transaction here. So `bytes` is what
// the snapshot itself takes: its project as JSON.
//
// The limit. A snapshot is never dropped to make room: at SNAPSHOT_LIMIT the
// next one is refused with a sentence that names the limit and what to do.
// 30, because the project at the size spec 3.13 promises (4 floors of 60 by
// 40, 150 rooms, 80 groups, 10 periods; test/fixtures/big.mjs) is 182 KB of
// JSON, so 30 snapshots are about 5.5 MB; with every one naming four traced
// images of its own (about 300 KB each after the reduction on import) the
// worst case is about 42 MB, and with the 8 recovery points (under 10 MB,
// ARCHITECTURE 7) and the project itself the device holds under 60 MB, a
// small share of what any browser the tool targets lets an origin keep and
// far from the usage warning at 80% (session.js). Thirty is also as many as
// the Snapshots card can list and still be read down in one go.
//
// Restoring takes a recovery point of the present first, through the page's
// storage session, and puts the snapshot's project in place as one undo step
// (actions.replaceProject), the way an import does (ARCHITECTURE 9).
//
// The page has one snapshots instance, made by startSnapshots(ctx) at boot.
// For code with no handle on it (the automatic snapshots inside sections,
// SV2-28b):
//
//   takeAutoSnapshot(reason, name?) -> Promise<{ ok: true, snapshot } | { ok: false, code, text }>
//
// reason is a key of AUTO_SNAPSHOT_NAMES; name, when given, is the snapshot's
// name instead ("Before clearing Floor 2"). It never throws: a snapshot that
// could not be taken says why in `text`, and the caller decides whether to go
// on (it should have asked first, with snapshotRoom(), when the limit is
// reached).

import { migrate, versionOf } from '../engine/migrate.js';
import { repair } from '../engine/repair.js';
import { validate } from '../engine/validate.js';
import { blankName, replaceProject } from '../engine/actions.js';
import { writeProjectFile } from '../engine/project-file.js';
import { exportFileName } from '../engine/exports.js';
import { openDatabases, imageIdsOf, PROJECT_STORE, SNAPSHOT_STORE, IMAGE_STORE, CURRENT_KEY } from './db.js';
import { pointSummary } from './recovery.js';

// How many snapshots this device keeps. Why 30: the header.
export const SNAPSHOT_LIMIT = 30;

// The names the tool gives the snapshots it takes by itself.
export const AUTO_SNAPSHOT_NAMES = {
  'clear-building': 'Before clearing the building',
  'clear-schedule': 'Before clearing the schedule',
  'new-project': 'Before starting a new project',
  import: 'Before an import',
  'clear-floor': 'Before clearing a floor',
  resize: 'Before resizing a floor',
  scenario: 'Before applying a scenario',
};

export const NAME_NEEDED = 'A snapshot needs a name. Say what it comes before, such as “Before moving 7th grade”.';

// The refusal at the limit: what the limit is, and what to do.
export function fullSentence(limit) {
  const most = limit === undefined ? SNAPSHOT_LIMIT : limit;
  return 'This device keeps at most ' + most + ' snapshots, and it has ' + most + '. Delete one you no longer need (export it first to keep it as a file), then take this one. No snapshot is ever replaced to make room.';
}

export const READ_ONLY_SENTENCE = 'This tab is read-only while the project is open in another tab, so it cannot take, restore, rename or delete a snapshot. It can export one.';

export class SnapshotError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'SnapshotError';
    this.code = code || 'refused';
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// What a project takes when stored: its JSON as UTF-8.
export function snapshotBytes(project) {
  return new TextEncoder().encode(JSON.stringify(project)).length;
}

// The record to store. The name is kept exactly as typed; a blank one (white
// space and the zero-width characters only, actions.blankName) is refused.
export function snapshotRecord(project, options) {
  const { id, name, takenAt } = options;
  if (typeof name !== 'string' || blankName(name)) throw new SnapshotError(NAME_NEEDED, 'no-name');
  if (typeof id !== 'string' || !/^n[a-z0-9]{9}$/.test(id)) throw new TypeError('A snapshot id is "n" and nine letters or digits.');
  if (!isObject(project)) throw new TypeError('A snapshot is of a project.');
  return { id, name, takenAt, bytes: snapshotBytes(project), project };
}

// Is this what a snapshot record looks like? One that is not is listed as
// unreadable, never hidden.
export function isSnapshot(value) {
  return isObject(value) && typeof value.id === 'string' && typeof value.name === 'string'
    && typeof value.takenAt === 'string' && isObject(value.project);
}

// What the card lists of a record: everything but the project.
export function snapshotEntry(record) {
  const readable = isSnapshot(record);
  const project = readable ? record.project : null;
  const settings = project && isObject(project.settings) ? project.settings : {};
  let summary = null;
  if (readable) {
    try {
      summary = pointSummary(project);
    } catch (error) {
      summary = null;
    }
  }
  return {
    id: record && typeof record.id === 'string' ? record.id : '',
    name: record && typeof record.name === 'string' ? record.name : '',
    takenAt: record && typeof record.takenAt === 'string' ? record.takenAt : '',
    bytes: record && Number.isFinite(record.bytes) ? record.bytes : null,
    school: typeof settings.schoolName === 'string' ? settings.schoolName : '',
    projectId: project && typeof project.id === 'string' ? project.id : null,
    summary,
    readable: readable && summary !== null,
  };
}

// Newest first; two taken in the same millisecond by id, so the order holds.
export function newestFirst(entries) {
  return entries.slice().sort((a, b) => (a.takenAt < b.takenAt ? 1 : a.takenAt > b.takenAt ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

// What the project of a stored snapshot is, made ready for the store: brought
// up to date, repaired and checked, or an Error saying why it cannot be.
// options: { ids, clock, imageIds } (imageIds: the images on this device).
export function readSnapshotProject(raw, options) {
  const opts = options || {};
  if (!isObject(raw)) throw new SnapshotError('The snapshot holds no project.', 'unreadable');
  if (versionOf(raw) >= 1) {
    const missing = [
      ['settings', isObject(raw.settings)],
      ['building', isObject(raw.building) && Array.isArray(raw.building.floors)],
      ['subjects', Array.isArray(raw.subjects)],
      ['teachers', Array.isArray(raw.teachers)],
      ['groups', Array.isArray(raw.groups)],
      ['day types', Array.isArray(raw.dayTypes)],
    ].filter(([, there]) => !there).map(([part]) => part);
    if (missing.length > 0) throw new SnapshotError('The snapshot is damaged: it has no readable ' + missing.join(', ') + '.', 'unreadable');
  }
  let repaired;
  try {
    repaired = repair(migrate(raw), { ids: opts.ids, clock: opts.clock, imageIds: opts.imageIds });
  } catch (error) {
    throw new SnapshotError(error && error.message ? error.message : 'The snapshot could not be read.', 'unreadable');
  }
  const findings = validate(repaired.project);
  if (findings.length > 0) throw new SnapshotError('The snapshot is not a valid project (' + findings[0].path + ': ' + findings[0].message + ').', 'unreadable');
  return repaired;
}

// The name a snapshot's file is saved under: the one rule for download names
// (engine/exports.js), dated the day the snapshot was taken.
export function snapshotFileName(project, takenAt, fallback) {
  const day = new Date(takenAt);
  return exportFileName(project, 'snapshot', 'json', Number.isNaN(day.getTime()) ? fallback : day);
}

// ------------------------------------------------------------ IndexedDB
//
// Each function works on the `sv2` database (an IDBDatabase) in one
// transaction, and resolves once that transaction has committed.

function finish(tx, value, refusal) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(value());
    tx.onerror = (event) => event.preventDefault();
    tx.onabort = () => reject(refusal() || tx.error || new Error('The browser stopped the write.'));
  });
}

// Add a snapshot, unless the device already keeps `limit`: then nothing is
// written and the refusal says so. `add`, never `put`: a record with the
// same id is never overwritten.
export function addSnapshot(main, record, limit) {
  const most = limit === undefined ? SNAPSHOT_LIMIT : limit;
  let refusal = null;
  const tx = main.transaction(SNAPSHOT_STORE, 'readwrite');
  const store = tx.objectStore(SNAPSHOT_STORE);
  const counted = store.count();
  counted.onsuccess = () => {
    if (counted.result >= most) {
      refusal = new SnapshotError(fullSentence(most), 'full');
      tx.abort();
      return;
    }
    store.add(record);
  };
  return finish(tx, () => record, () => refusal);
}

// Every snapshot as the card lists it, newest first.
export function readSnapshots(main) {
  const found = [];
  const tx = main.transaction(SNAPSHOT_STORE, 'readonly');
  const cursor = tx.objectStore(SNAPSHOT_STORE).openCursor();
  cursor.onsuccess = () => {
    const at = cursor.result;
    if (!at) return;
    found.push(snapshotEntry(at.value));
    at.continue();
  };
  return finish(tx, () => newestFirst(found), () => null);
}

export function countSnapshots(main) {
  const tx = main.transaction(SNAPSHOT_STORE, 'readonly');
  const counted = tx.objectStore(SNAPSHOT_STORE).count();
  return finish(tx, () => counted.result, () => null);
}

// The stored record, or null.
export function readSnapshot(main, id) {
  const tx = main.transaction(SNAPSHOT_STORE, 'readonly');
  const got = tx.objectStore(SNAPSHOT_STORE).get(id);
  return finish(tx, () => (got.result === undefined ? null : got.result), () => null);
}

// Give a snapshot another name, exactly as typed. Resolves with the record.
export function renameStored(main, id, name) {
  if (typeof name !== 'string' || blankName(name)) return Promise.reject(new SnapshotError(NAME_NEEDED, 'no-name'));
  let refusal = null;
  let record = null;
  const tx = main.transaction(SNAPSHOT_STORE, 'readwrite');
  const store = tx.objectStore(SNAPSHOT_STORE);
  const got = store.get(id);
  got.onsuccess = () => {
    if (!isObject(got.result)) {
      refusal = new SnapshotError('That snapshot is no longer on this device.', 'missing');
      tx.abort();
      return;
    }
    record = { ...got.result, name };
    store.put(record);
  };
  return finish(tx, () => record, () => refusal);
}

// Delete a snapshot and, in the same transaction, every traced image that
// nothing names any more: not the saved project, not another snapshot, not
// `keep` (the image ids of the project on screen, which may be ahead of its
// last save).
export function deleteStored(main, id, keep) {
  const named = new Set(keep || []);
  let refusal = null;
  let swept = [];
  const tx = main.transaction([PROJECT_STORE, SNAPSHOT_STORE, IMAGE_STORE], 'readwrite');
  const snapshots = tx.objectStore(SNAPSHOT_STORE);
  const there = snapshots.getKey(id);
  there.onsuccess = () => {
    if (there.result === undefined) {
      refusal = new SnapshotError('That snapshot is no longer on this device.', 'missing');
      tx.abort();
      return;
    }
    snapshots.delete(id);
    const current = tx.objectStore(PROJECT_STORE).get(CURRENT_KEY);
    current.onsuccess = () => {
      if (isObject(current.result)) for (const name of imageIdsOf(current.result.project)) named.add(name);
      const cursor = snapshots.openCursor();
      cursor.onsuccess = () => {
        const at = cursor.result;
        if (at) {
          for (const name of imageIdsOf(at.value && at.value.project)) named.add(name);
          at.continue();
          return;
        }
        const images = tx.objectStore(IMAGE_STORE);
        const keys = images.getAllKeys();
        keys.onsuccess = () => {
          swept = keys.result.filter((key) => !named.has(key));
          for (const key of swept) images.delete(key);
        };
      };
    };
  };
  return finish(tx, () => ({ swept }), () => refusal);
}

// ------------------------------------------------------------ the page's snapshots

let active = null;

function quote(text) {
  return '“' + text + '”';
}

function messageOf(error) {
  const text = String(error && error.message ? error.message : error).trim();
  return /[.!?]$/.test(text) ? text : text + '.';
}

// startSnapshots(ctx) -> the page's snapshots. ctx: { store, clock, ids, and
// later storage (the session, ctx.storage, which may be set after this is
// called; it is read when first needed) }.
export function startSnapshots(ctx, options) {
  const opts = options || {};
  const listeners = new Set();
  let opening = null;
  let known = null; // the count as last read or written

  function emit(what) {
    for (const listener of Array.from(listeners)) listener(what);
  }

  const storage = () => ctx.storage;

  // The `sv2` database, once the page's storage is ready. A browser that
  // keeps nothing refuses here, with its reason.
  async function main() {
    if (!storage()) throw new SnapshotError('The project is still loading. Try again in a moment.', 'not-ready');
    await storage().ready;
    if (!storage().state.available) throw new SnapshotError('This browser is not keeping the project, so it cannot keep a snapshot either: ' + storage().state.error, 'unavailable');
    if (!opening) {
      opening = (opts.open || openDatabases)({ clock: ctx.clock }).catch((error) => {
        opening = null;
        throw error;
      });
    }
    return (await opening).main;
  }

  function editable() {
    if (storage() && storage().state.readOnly) throw new SnapshotError(READ_ONLY_SENTENCE, 'read-only');
  }

  async function list() {
    const entries = await readSnapshots(await main());
    known = entries.length;
    return entries;
  }

  // { count, limit, full }: asked before a large change, so the question can
  // say whether a snapshot will be taken first.
  async function room() {
    try {
      known = await countSnapshots(await main());
    } catch (error) {
      return { count: null, limit: SNAPSHOT_LIMIT, full: false, error: messageOf(error) };
    }
    return { count: known, limit: SNAPSHOT_LIMIT, full: known >= SNAPSHOT_LIMIT, error: null };
  }

  // Take a snapshot of the project as it is now. Throws a SnapshotError with
  // the sentence to show.
  async function take(name) {
    editable();
    if (typeof name !== 'string' || blankName(name)) throw new SnapshotError(NAME_NEEDED, 'no-name');
    const db = await main();
    // the saved copy and its images are brought up to what is on screen, so
    // every image the snapshot names is in the images store
    await storage().flush();
    let record = null;
    for (let tries = 0; tries < 2 && record === null; tries += 1) {
      const fresh = snapshotRecord(ctx.store.project, { id: ctx.ids('n'), name, takenAt: ctx.clock().toISOString() });
      try {
        record = await addSnapshot(db, fresh, SNAPSHOT_LIMIT);
      } catch (error) {
        // an id already used on this device (another tab's): once more with a new one
        if (error && error.name === 'ConstraintError' && tries === 0) continue;
        if (error instanceof SnapshotError) throw error;
        throw new SnapshotError('The snapshot was not kept: ' + messageOf(error), 'failed');
      }
    }
    known = known === null ? null : known + 1;
    emit('taken');
    return snapshotEntry(record);
  }

  async function takeAuto(reason, name) {
    const named = typeof name === 'string' && !blankName(name) ? name : AUTO_SNAPSHOT_NAMES[reason];
    if (!named) return { ok: false, code: 'bad-reason', text: 'An automatic snapshot is taken for one of: ' + Object.keys(AUTO_SNAPSHOT_NAMES).join(', ') + '.' };
    try {
      return { ok: true, snapshot: await take(named) };
    } catch (error) {
      return { ok: false, code: error && error.code ? error.code : 'failed', text: messageOf(error) };
    }
  }

  // The snapshot's project, checked, with the images it names held by the
  // page's storage session (so its recovery points and its saves carry them).
  async function open(id) {
    const db = await main();
    const record = await readSnapshot(db, id);
    if (!record) throw new SnapshotError('That snapshot is no longer on this device.', 'missing');
    if (!isSnapshot(record)) throw new SnapshotError('That snapshot cannot be read.', 'unreadable');
    const have = new Set();
    for (const imageId of imageIdsOf(record.project)) {
      const value = await storage().getImage(imageId);
      if (value && value.blob) have.add(imageId);
    }
    const read = readSnapshotProject(record.project, { ids: ctx.ids, clock: ctx.clock, imageIds: have });
    return { record, project: read.project, notes: read.notes, images: have };
  }

  // Put a snapshot's project in place of the one on screen: a recovery point
  // of the present first, then one undo step. Resolves with { name, notes }.
  async function restore(id) {
    editable();
    const opened = await open(id);
    for (const imageId of opened.images) {
      const value = await storage().getImage(imageId);
      if (value) await storage().putImage(imageId, value);
    }
    await storage().takeRecoveryPoint('restore');
    const before = ctx.store.project;
    ctx.store.apply(replaceProject, { project: opened.project, label: 'Restore the snapshot ' + quote(opened.record.name) });
    if (ctx.store.project === before) throw new SnapshotError('The snapshot was not restored. Nothing has changed.', 'refused');
    emit('restored');
    return { name: opened.record.name, notes: opened.notes };
  }

  async function rename(id, name) {
    editable();
    const record = await renameStored(await main(), id, name);
    emit('renamed');
    return snapshotEntry(record);
  }

  async function remove(id) {
    editable();
    const db = await main();
    await storage().flush();
    const done = await deleteStored(db, id, imageIdsOf(ctx.store.project));
    known = known === null ? null : Math.max(0, known - 1);
    emit('deleted');
    return done;
  }

  // The snapshot as a project file: { fileName, text }. The page hands it on.
  async function exportFile(id) {
    const opened = await open(id);
    const images = await storage().imagesForFile(opened.project);
    return { fileName: snapshotFileName(opened.project, opened.record.takenAt, ctx.clock()), text: writeProjectFile(opened.project, { images }), name: opened.record.name };
  }

  const snapshots = {
    limit: SNAPSHOT_LIMIT,
    get count() {
      return known;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    list,
    room,
    take,
    takeAuto,
    restore,
    rename,
    remove,
    exportFile,
  };
  active = snapshots;
  return snapshots;
}

// The page's snapshots, or null before boot has made them.
export function pageSnapshots() {
  return active;
}

// For code with no handle on the page's snapshots: the header says what it
// answers. Before boot it answers that the project is still loading.
export function takeAutoSnapshot(reason, name) {
  if (!active) return Promise.resolve({ ok: false, code: 'not-ready', text: 'The project is still loading, so no snapshot was taken.' });
  return active.takeAuto(reason, name);
}

// For code with no handle on the page's snapshots: is there room for one more?
export function snapshotRoom() {
  if (!active) return Promise.resolve({ count: null, limit: SNAPSHOT_LIMIT, full: false, error: 'The project is still loading.' });
  return active.room();
}
