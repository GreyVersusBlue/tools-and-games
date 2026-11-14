// Storage for one open page: where db.js, autosave.js, recovery.js and tabs.js
// meet the store and the shell. ui/app.js calls startStorage(ctx) once, waits
// for `ready`, and from then on every change to the project is saved.
//
//   const storage = startStorage(ctx);
//   await storage.ready;       the saved project (or a recovery point the
//                              person chose) is in the store
//
// What the rest of the page may use, as ctx.storage:
//
//   state                      what the cards show (see `state` below)
//   subscribe(fn)              fn(state, what) after anything here changes
//   takeRecoveryPoint(reason)  before anything that replaces the whole
//                              project; resolves when the point is kept
//   listRecoveryPoints()       newest first
//   restoreRecoveryPoint(key), exportRecoveryPoint(key), deleteRecoveryPoint(key)
//   exportProject()            download the project file now
//   noteExported()             a project file was just written (the Saved
//                              card shows when)
//   putImage(id, value), getImage(id), imagesForFile(project), keepFileImages(project, images)
//   flush()                    save now
//   projects                   several projects on one device (below)
//
// ctx.storage.projects (ARCHITECTURE 21.4 and 21.10, DESIGN 15.2):
//
//   list()                     -> [{ id, open, label, schoolName, savedAt, shelvedAt,
//                                   bytes, summary }]  the open project first, then the
//                                   rest, most recently put aside first. A shelved
//                                   project that cannot be read has `unreadable: true`
//                                   and `exportRaw()` (its record as a file): offer
//                                   that and remove(id), never open(id).
//   holds(projectId)           -> the label (label, else school name, else "Untitled
//                                   project") of the project of that id when it is kept
//                                   on the shelf, else null. The open project's own id
//                                   is null: that is today's import of a newer copy.
//   open(id)                   switch to a shelved project; the page reloads
//   startAnother('empty' | 'sample' | 'file', read?, { label, copy })
//                              keep the open project, start another; the page reloads.
//                              `read` is what readProjectFile returned. A sample or a
//                              file whose id is the open project's or a shelved one's
//                              is refused (code 'held') unless `copy: true`, which gives
//                              it a fresh id and the label "<name> (another copy)".
//   duplicate({ label })       the open project, with a fresh id, its images copied,
//                              kept beside it and opened; label default "<name> (copy)"
//   rename(id, label)          a shelved project's label (not an undo step; the open
//                              project's label is an action)
//   remove(id)                 delete a shelved project after a recovery point of it
//                              (pointKey, pointKept; none for a record too damaged to read)
//   restoreAsProject(point | snapshot)
//                              a recovery point (its key, or { point: key }) or a
//                              snapshot (its id, or { snapshot: id }) of a project that
//                              is neither open nor shelved, kept on the shelf as it was
//                              and opened. A traced image that is gone is said, and the
//                              project is kept without it.
//
// list() and holds() only read, so they answer in a read-only tab and while a
// switch is under way. Every other call is refused then, and returns
// { ok: false, code: 'read-only' | 'switching', text } without doing anything.
// Each of the six answers { ok: true, ... } (open, startAnother, duplicate and
// restoreAsProject reload the page a moment later; remove and rename do not)
// or { ok: false, code, text, ... } with the sentence to show. Codes: 'read-only',
// 'switching', 'unavailable', 'no-such-project', 'unreadable' (with `exportRaw()`:
// the record as it is, as a file), 'held' (with `id`, `label`, `heldBy`: 'open' or
// 'shelf'), 'is-open', 'label', 'limit' (the 20 projects), 'conflict', 'failed',
// and the shelf codes db.js documents. A switch's progress is state.switching;
// the sentence for the page that follows a switch is state.opened = { id, at }
// (read once from sessionStorage 'sv2:opened' and removed), and the note of a boot
// reconcile is state.reconciled.
//
// The six steps of a switch, in order (21.10): read the target through the same
// readProject start() uses and refuse an unreadable one before anything moves;
// set `switching`, which makes store.apply, undo, redo and autosave refuse
// at once; let the save in flight finish; take a recovery point (reason
// 'replace') of the very project that goes on the shelf; db.switchTo (one
// transaction); on success write 'sv2:opened' and reload, on failure undo step 2
// and say so. While `switching` the leaving save and leaving point are skipped:
// the page holds the old project and would write it over the new one.
//
// The module also exports takeRecoveryPoint(reason) for code that has no ctx.

import { h } from '../ui/components/dom.js';
import { migrate, versionOf } from '../engine/migrate.js';
import { repair } from '../engine/repair.js';
import { validate } from '../engine/validate.js';
import { replaceProject } from '../engine/actions.js';
import { newProject } from '../engine/schema.js';
import { DEFAULT_PASSCODE } from '../engine/publish-defaults.js';
import { writeProjectFile } from '../engine/project-file.js';
import { exportFileName } from '../engine/exports.js';
import { sampleSchool } from '../data/sample-school.js';
import { keepNeverShow } from '../ui/help/progress.js';
import { openDatabases, estimateUsage, askToPersist, imageIdsOf, projectBytes, pointProjectId, hooks, RECOVERY_KEEP, ConflictError, ShelfError } from './db.js';
import { createAutosave, SAVE_RETRY_MS } from './autosave.js';
import { buildPoint, isPoint, pointSummary, RECOVERY_INTERVAL_MS } from './recovery.js';
import { watchTabs, switchedAway, TAB_LOCK, TAB_BEAT_MS } from './tabs.js';
import { readSnapshot, isSnapshot, readSnapshotProject, IMAGE_GONE_SENTENCE } from './snapshots.js';
import { formatBytes, clockTime, whenWords, whenInSentence, dayWords } from './words.js';

// Above this share of the room the browser allows, the page warns.
export const USAGE_WARNING_SHARE = 0.8;

const USAGE_EVERY_MS = 10000;
const READ_ONLY_TOAST_EVERY_MS = 5000;

// The sessionStorage key the page that switches writes for the page that follows
// (21.4): { id, at }. Read once at start and removed. Permanent.
export const OPENED_KEY = 'sv2:opened';
// db.js's renameShelved holds its own copy of this limit (21.5).
const LABEL_MOST = 60;
const UNTITLED = 'Untitled project';
const READ_ONLY_PROJECTS = 'This tab is read-only while the project is open in another tab, so it cannot open, start, duplicate or delete projects.';
// How long a tab that gave the lock back to a switch waits to see another tab
// take it before it reloads (a tab that is not there to take it is not waited for).
const HANDOVER_WAIT_MS = 3000;

// What every project from format 1 on has, whatever is in it.
const PARTS = [
  ['settings', (project) => isObject(project.settings)],
  ['building', (project) => isObject(project.building) && Array.isArray(project.building.floors)],
  ['subjects', (project) => Array.isArray(project.subjects)],
  ['teachers', (project) => Array.isArray(project.teachers)],
  ['groups', (project) => Array.isArray(project.groups)],
  ['day types', (project) => Array.isArray(project.dayTypes)],
];

let active = null;

// For a caller with no ctx: take a recovery point in the page's one session.
export function takeRecoveryPoint(reason) {
  return active ? active.takeRecoveryPoint(reason) : Promise.resolve(null);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// What a project goes by in a sentence: its label, else the school's name.
export function projectTitle(project) {
  const label = isObject(project) && typeof project.label === 'string' ? project.label.trim() : '';
  if (label !== '') return label;
  const school = isObject(project) && isObject(project.settings) && typeof project.settings.schoolName === 'string' ? project.settings.schoolName.trim() : '';
  return school !== '' ? school : UNTITLED;
}

// "<name> (copy)" kept within the label limit: the name is cut, never the suffix.
function suffixed(name, suffix) {
  const room = LABEL_MOST - suffix.length;
  const base = name.length > room ? name.slice(0, Math.max(0, room - 1)).trimEnd() + '\u2026' : name;
  return base + suffix;
}

// The label as stored (trimmed, at most LABEL_MOST), or null when it cannot be one.
function cleanLabel(label) {
  if (typeof label !== 'string') return null;
  const text = label.trim();
  return text.length <= LABEL_MOST ? text : null;
}

function refusal(code, text, extra) {
  return { ok: false, code, text, ...extra };
}

// An error's own words as a sentence, so they can stand inside ours.
function messageOf(error) {
  const text = String(error && error.message ? error.message : error).trim();
  return /[.!?]$/.test(text) ? text : text + '.';
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(at, at + 0x8000));
  return btoa(text);
}

function base64ToBlob(data, type) {
  const text = atob(data);
  const bytes = new Uint8Array(text.length);
  for (let at = 0; at < text.length; at += 1) bytes[at] = text.charCodeAt(at);
  return new Blob([bytes], { type: type || 'application/octet-stream' });
}

function download(fileName, mime, text) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = h('a', { href: url, download: fileName, hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// "3 floors, 12 rooms, 9 groups, 8 teachers" from a point's summary.
export function summaryWords(summary) {
  if (!isObject(summary)) return '';
  const part = (n, one) => (Number.isFinite(n) ? n + ' ' + (n === 1 ? one : one + 's') : null);
  return [part(summary.floors, 'floor'), part(summary.rooms, 'room'), part(summary.groups, 'group'), part(summary.teachers, 'teacher')].filter(Boolean).join(', ');
}

// What the page that switched left for this one, read once and removed.
function takeOpened() {
  try {
    const raw = globalThis.sessionStorage.getItem(OPENED_KEY);
    if (raw === null) return null;
    globalThis.sessionStorage.removeItem(OPENED_KEY);
    const value = JSON.parse(raw);
    return isObject(value) && typeof value.id === 'string' && typeof value.at === 'string' ? { id: value.id, at: value.at } : null;
  } catch (error) {
    return null;
  }
}

export function startStorage(ctx, options) {
  const opts = options || {};
  const store = ctx.store;
  const clock = ctx.clock;
  const listeners = new Set();

  // What the cards show. Never replaced, only changed, then `emit`.
  const state = {
    available: true, // false: this browser keeps nothing; `error` says why
    error: null,
    save: 'off', // 'off' | 'saving' | 'saved' | 'failed' | 'conflict'
    savedAt: null, // ISO, the last save this tab knows of
    saveError: null,
    readOnly: false, // another tab is the editing one
    tabs: 'locks', // how other tabs are seen: 'locks' or 'heartbeat'
    persist: 'unknown', // 'kept' | 'best-effort' | 'unknown'
    usage: null, // { usage, quota, share }
    exportedAt: null, // ISO, the last project file written from this device
    quarantined: 0, // unreadable copies set aside
    recovery: true, // false: this device is not keeping recovery points
    recoveryError: null,
    repairs: [], // what was put right when the project was loaded
    switching: false, // a switch to another project is under way; nothing can be edited
    opened: takeOpened(), // { id, at }: this page was opened by a switch, for the card and the status region
    reconciled: null, // the sentence of a boot reconcile (two copies of one project), or null
  };

  let db = null;
  let known = null; // the savedAt this tab last read or wrote
  let quiet = false; // a store change that is storage's own (a load)
  let touched = false; // is there anything of the person's here to protect?
  let lastPointModified = null;
  let recoveryWarned = false;
  let switching = false; // the same as state.switching, read synchronously by the guards
  let skipped = false; // a change autosave was not told of while switching
  let recoveryTimer = null;
  let recoveryMs = opts.recoveryMs === undefined ? RECOVERY_INTERVAL_MS : opts.recoveryMs;
  let usageAt = 0;
  let lastReadOnlyToast = 0;
  const held = new Map(); // imageId -> { blob, type, width, height }, the images this tab has seen
  // the same images as a recovery point carries them: imageId -> Blob
  const blobs = { get: (id) => (held.has(id) ? held.get(id).blob : undefined), has: (id) => held.has(id) };

  function emit(what) {
    for (const listener of Array.from(listeners)) listener(state, what);
  }

  const timeFormat = () => store.project.settings.timeFormat;

  // ------------------------------------------------------------ banners

  // Lines across the top of the section that stay until their cause goes.
  // Their look is ui/app.css's `.banner`, with an edge for each kind:
  // problem, warning or note.
  const bannerHost = h('div', { id: 'storage-banners', class: 'banners' });
  new ResizeObserver(() => bannerHost.parentNode && bannerHost.parentNode.style.setProperty('--banners-height', Math.ceil(bannerHost.getBoundingClientRect().height) + 'px')).observe(bannerHost);
  const banners = new Map();

  function mountBanners() {
    const surface = document.getElementById('surface');
    if (surface && bannerHost.parentNode !== surface) surface.prepend(bannerHost);
  }

  // setBanner(id, null) takes it away. { kind, text, buttons: [{ label, run, action }] }
  function setBanner(id, content) {
    const old = banners.get(id);
    if (old) old.remove();
    banners.delete(id);
    if (!content) return;
    mountBanners();
    const element = h('div', { id: 'banner-' + id, class: 'banner banner--' + content.kind, role: content.kind === 'problem' ? 'alert' : 'status', data: { banner: id, kind: content.kind } },
      h('p', { class: 'banner__text' }, content.text),
      (content.buttons || []).map((button) => h('button', { type: 'button', class: 'btn', data: { action: button.action }, on: { click: button.run } }, button.label)),
    );
    banners.set(id, element);
    bannerHost.append(element);
  }

  // ------------------------------------------------------------ the indicator

  function drawIndicator() {
    if (!state.available) {
      ctx.setSaveState('failed', 'Not saved: see Project', 'This browser is not keeping the project: ' + state.error);
    } else if (state.readOnly) {
      ctx.setSaveState('off', 'Read-only', 'This project is open in another tab. Nothing changes here, so there is nothing to save.');
    } else if (state.save === 'saving') {
      ctx.setSaveState('saving', 'Saving…', 'Saving the project on this device.');
    } else if (state.save === 'failed' || state.save === 'conflict') {
      ctx.setSaveState('failed', 'Not saved: see Project', state.saveError || '');
    } else if (state.save === 'saved' && state.savedAt) {
      const at = new Date(state.savedAt);
      const today = at.toDateString() === clock().toDateString();
      ctx.setSaveState('saved',
        today ? 'Saved at ' + clockTime(at, timeFormat(), { suffix: false }) : 'Saved on ' + dayWords(at),
        'The project was last saved on this device ' + whenInSentence(state.savedAt, clock(), timeFormat()) + '.');
    } else {
      ctx.setSaveState('off', 'Nothing to save yet', 'Every change is saved on this device as you make it. Nothing has changed yet.');
    }
  }

  // ------------------------------------------------------------ saving

  const autosave = createAutosave({
    write: () => db.saveProject(store.project, known, { exportedAt: state.exportedAt, images: held }).then((savedAt) => {
      known = savedAt;
      return savedAt;
    }),
    onState(next, detail) {
      if (next === 'saving') {
        state.save = 'saving';
      } else if (next === 'saved') {
        state.save = 'saved';
        state.savedAt = detail;
        state.saveError = null;
        setBanner('save-failed', null);
        refreshUsage(false);
      } else if (next === 'failed') {
        state.save = 'failed';
        state.saveError = messageOf(detail);
        setBanner('save-failed', {
          kind: 'problem',
          text: 'The project is not being saved on this device: ' + state.saveError + ' Your work is still in this tab. Export the project now to keep it. Saving is tried again every ' + Math.round(SAVE_RETRY_MS / 1000) + ' seconds.',
          buttons: [{ label: 'Export the project now', action: 'export-now', run: () => exportProject() }],
        });
      } else if (next === 'conflict') {
        state.save = 'conflict';
        state.saveError = 'Another tab saved this project after this tab read it.';
        setBanner('save-failed', null);
        setBanner('conflict', {
          kind: 'problem',
          text: 'Another tab saved this project after this tab read it, so this tab has stopped saving rather than overwrite that work. Export what is here if you need it, then reload to carry on from the saved project.',
          buttons: [
            { label: 'Export the project now', action: 'export-now', run: () => exportProject() },
            { label: 'Reload this tab', action: 'reload', run: () => location.reload() },
          ],
        });
      }
      drawIndicator();
      emit('save');
    },
  });

  async function refreshUsage(force) {
    const at = Date.now();
    if (!force && at - usageAt < USAGE_EVERY_MS) return;
    usageAt = at;
    state.usage = await estimateUsage();
    const usage = state.usage;
    setBanner('usage', usage && usage.share >= USAGE_WARNING_SHARE ? {
      kind: 'warning',
      text: 'This browser is nearly out of room for the project: ' + formatBytes(usage.usage) + ' of ' + formatBytes(usage.quota) + ' used ('
        + Math.round(usage.share * 100) + '%). Export the project now, then free some room on this device.',
      buttons: [{ label: 'Export the project now', action: 'export-now', run: () => exportProject() }],
    } : null);
    emit('usage');
  }

  // ------------------------------------------------------------ reading a saved copy

  // A project as stored (in `current` or in a point) made ready for the
  // store, or an Error saying why it cannot be.
  function readProject(raw, imageIds) {
    if (!isObject(raw)) throw new Error('The saved copy is not a project.');
    // repair() can make a valid project out of anything, by emptying what it
    // cannot read. For a copy this version of the tool wrote, a missing part
    // means damage, and the damaged copy is worth more set aside than emptied.
    if (versionOf(raw) >= 1) {
      const missing = PARTS.filter(([, present]) => !present(raw)).map(([name]) => name);
      if (missing.length > 0) throw new Error('The saved copy is damaged: it has no readable ' + missing.join(', ') + '.');
    }
    const repaired = repair(migrate(raw), { ids: ctx.ids, clock, imageIds });
    const findings = validate(repaired.project);
    if (findings.length > 0) throw new Error('The saved copy is not a valid project (' + findings[0].path + ': ' + findings[0].message + ')');
    return repaired;
  }

  function readRecord(record, imageIds) {
    if (!isObject(record) || typeof record.savedAt !== 'string') throw new Error('The saved copy is not a saved project.');
    return readProject(record.project, imageIds);
  }


  async function loadBlobs(project) {
    for (const id of imageIdsOf(project)) {
      const value = await db.getImage(id);
      if (value && value.blob) held.set(id, value);
    }
  }

  // Put a loaded project in the store. Not an undo entry, and not a change
  // that needs saving.
  function show(project) {
    quiet = true;
    try {
      store.replace(project);
    } finally {
      quiet = false;
    }
  }

  function noteRepairs(notes) {
    state.repairs = notes.slice();
    if (notes.length === 0) return;
    ctx.toast({ text: 'Repaired ' + notes.length + (notes.length === 1 ? ' thing' : ' things') + ' on load. The Project section lists ' + (notes.length === 1 ? 'it.' : 'them.'), action: { label: 'Show', run: () => ctx.navigate('#project') } });
    // the repaired project is what should be on the device from now on
    autosave.changed();
  }

  // ------------------------------------------------------------ recovery points

  function warnRecovery(error) {
    state.recovery = false;
    state.recoveryError = messageOf(error);
    emit('recovery');
    if (recoveryWarned) return;
    recoveryWarned = true;
    ctx.toast({ kind: 'problem', duration: Infinity, text: 'This device is not keeping recovery points: ' + state.recoveryError + ' The project itself is still saved. Export a project file now and then to be safe.' });
  }

  // Take a point of the project as it is now. `spare` is the key of a point
  // the trim must leave (the one about to be restored). Resolves with the
  // new point's key, or null when the device could not keep it: the caller
  // carries on either way, and the person has been told once.
  // `of` is the project to take it of (a switch gives the very object that goes
  // on the shelf); the open project's id is always passed to the trim.
  async function takePoint(reason, spare, of) {
    if (!db || state.readOnly) return null;
    const project = of || store.project;
    const before = lastPointModified;
    lastPointModified = project.modified;
    try {
      const key = await db.addPoint(buildPoint(project, reason, clock().toISOString(), blobs), spare, project.id);
      if (!state.recovery) {
        state.recovery = true;
        state.recoveryError = null;
      }
      emit('points');
      return key;
    } catch (error) {
      lastPointModified = before;
      warnRecovery(error);
      return null;
    }
  }

  const changedSincePoint = () => touched && store.project.modified !== lastPointModified;

  function startRecoveryTimer() {
    if (recoveryTimer !== null) clearInterval(recoveryTimer);
    recoveryTimer = setInterval(() => {
      if (!switching && changedSincePoint()) takePoint('timer');
    }, recoveryMs);
  }

  async function listPoints() {
    if (!db) return [];
    const points = await db.listPoints();
    return points.map((point) => ({
      key: point.key,
      takenAt: point.takenAt,
      reason: point.reason,
      summary: point.summary,
      bytes: point.bytes,
      readable: isPoint(point),
    }));
  }

  // A point's project, checked and ready for the store, with its images kept.
  async function openPoint(key) {
    const point = await db.getPoint(key);
    if (!point) throw new Error('That recovery point is no longer on this device.');
    if (!isPoint(point)) throw new Error('That recovery point cannot be read.');
    const images = isObject(point.images) ? point.images : {};
    const have = new Set([...(await db.imageIds()), ...Object.keys(images)]);
    const read = readProject(point.project, have);
    return { point, images, project: read.project, notes: read.notes };
  }

  async function keepPointImages(project, images) {
    for (const floor of project.building.floors) {
      const id = floor.image ? floor.image.imageId : null;
      const blob = id ? images[id] : null;
      if (!blob) continue;
      if (held.has(id)) continue;
      const value = { blob, type: blob.type, width: floor.image.width, height: floor.image.height };
      await db.putImage(id, value);
      held.set(id, value);
    }
  }

  // Restore a point: the present is captured first, so this can be put back,
  // and the restore is one undo step as well.
  async function restorePoint(key) {
    if (switching) return false;
    if (state.readOnly) {
      refuseReadOnly();
      return false;
    }
    let opened;
    try {
      opened = await openPoint(key);
    } catch (error) {
      ctx.toast({ kind: 'problem', text: 'That recovery point was not restored. ' + messageOf(error) });
      return false;
    }
    // one project, one place (21.1): a point of a project kept on the shelf is
    // not put over the open one
    const keptAs = opened.project.id === store.project.id ? null : await holds(opened.project.id);
    if (keptAs !== null) {
      ctx.toast({ kind: 'problem', text: 'That recovery point is of ' + keptAs + ', which is also kept on this device. Open ' + keptAs + ' first; nothing was restored.', action: { label: 'Open ' + keptAs, run: () => projects.open(opened.project.id) } });
      return false;
    }
    await takePoint('restore', key);
    await keepPointImages(opened.project, opened.images);
    const label = 'Restore the recovery point from ' + whenWords(opened.point.takenAt, clock(), timeFormat());
    store.apply(replaceProject, { project: opened.project, label });
    lastPointModified = store.project.modified;
    ctx.toast({ text: 'Restored the recovery point from ' + whenWords(opened.point.takenAt, clock(), timeFormat()) + '. What was here before is a recovery point now.', action: { label: 'Undo', run: ctx.undo } });
    return true;
  }

  async function exportPoint(key) {
    try {
      const opened = await openPoint(key);
      const images = {};
      for (const [id, blob] of Object.entries(opened.images)) images[id] = { data: await blobToBase64(blob), type: blob.type };
      const taken = new Date(opened.point.takenAt);
      download(exportFileName(opened.project, 'recovery point', 'json', Number.isNaN(taken.getTime()) ? clock() : taken), 'application/json', writeProjectFile(opened.project, { images }));
      return true;
    } catch (error) {
      ctx.toast({ kind: 'problem', text: 'That recovery point was not exported. ' + messageOf(error) });
      return false;
    }
  }

  async function deletePoint(key) {
    await db.deletePoint(key);
    emit('points');
  }

  // ------------------------------------------------------------ files

  // The images a project names, as a project file carries them.
  async function imagesForFile(project) {
    const images = {};
    for (const id of imageIdsOf(project)) {
      const blob = blobs.get(id) || ((await db.getImage(id)) || {}).blob;
      if (blob) images[id] = { data: await blobToBase64(blob), type: blob.type };
    }
    return images;
  }

  // Keep the images a project file brought, before the project that names
  // them is put in the store. `images` is { [imageId]: { data, type } }.
  async function keepFileImages(project, images) {
    for (const floor of project.building.floors) {
      const id = floor.image ? floor.image.imageId : null;
      const file = id ? images[id] : null;
      if (!file) continue;
      const blob = base64ToBlob(file.data, file.type);
      const value = { blob, type: blob.type, width: floor.image.width, height: floor.image.height };
      await db.putImage(id, value);
      held.set(id, value);
    }
  }

  function noteExported() {
    state.exportedAt = clock().toISOString();
    // it rides in the saved record, so the next save has to happen
    markChanged();
    emit('export');
  }

  async function exportProject() {
    try {
      const project = store.project;
      const images = db ? await imagesForFile(project) : {};
      download(exportFileName(project, 'project', 'json', clock()), 'application/json', writeProjectFile(project, { images }));
      noteExported();
      return true;
    } catch (error) {
      ctx.toast({ kind: 'problem', text: 'The project was not exported. ' + messageOf(error) });
      return false;
    }
  }

  async function exportQuarantined() {
    const set = await db.quarantined();
    if (set.length === 0) return false;
    const newest = set[set.length - 1];
    let text;
    try {
      text = JSON.stringify(newest.raw, null, 2);
    } catch (error) {
      text = String(newest.raw);
    }
    const day = new Date(newest.at);
    download(exportFileName(store.project, 'unreadable copy', 'json', Number.isNaN(day.getTime()) ? clock() : day), 'application/json', text === undefined ? 'null' : text);
    return true;
  }

  // ------------------------------------------------------------ two tabs

  // A change autosave is to be told of; while switching it is remembered instead.
  function markChanged() {
    if (!db || state.readOnly) return;
    if (switching) {
      skipped = true;
      return;
    }
    autosave.changed();
  }

  // While a switch is under way the store refuses every change, as a read-only
  // tab does, and says nothing: the person is looking at "Opening…".
  function refuseSwitching() {
    Promise.resolve().then(() => {
      if (switching) show(store.project);
    });
  }

  function refuseReadOnly() {
    // a control that already moved (a radio, a switch) is drawn again from the project
    Promise.resolve().then(() => {
      if (state.readOnly) show(store.project);
    });
    const at = Date.now();
    if (at - lastReadOnlyToast < READ_ONLY_TOAST_EVERY_MS) return;
    lastReadOnlyToast = at;
    ctx.toast({ kind: 'problem', text: 'Nothing changed: this tab is read-only while the project is open in another tab.' });
  }

  // While this tab is read-only the store refuses every change, as a no-op.
  const { apply, undo, redo } = store;
  store.apply = (action, payload) => {
    if (switching) {
      refuseSwitching();
      return store.project;
    }
    if (!state.readOnly) return apply(action, payload);
    refuseReadOnly();
    return store.project;
  };
  store.undo = () => (state.readOnly || switching ? null : undo());
  store.redo = () => (state.readOnly || switching ? null : redo());

  function setReadOnly(on) {
    state.readOnly = on;
    if (on) autosave.pause();
    else autosave.resume();
    setBanner('read-only', on ? {
      kind: 'note',
      text: 'This project is open in another tab, so this tab is read-only: nothing you do here changes the project. Close the other tab and this one can edit within a few seconds.',
    } : null);
    drawIndicator();
    emit('tabs');
  }

  // A tab that became the editor and found another project than the one it
  // shows reloads instead of taking it in. When the other project was put there
  // by a switch moments ago, this tab was left behind by it: it gives the lock
  // back at once, so the tab that switched is the editor, waits to see that tab
  // take it (no bounce), then reloads read-only (21.10 "The tab lock across a reload").
  async function handOver(raw) {
    if (switchedAway(raw, store.project.id, clock().getTime())) {
      tabs.stop();
      await lockTakenByAnother();
    }
    reload();
  }

  async function lockTakenByAnother() {
    const locks = globalThis.navigator && globalThis.navigator.locks;
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    if (!locks || typeof locks.query !== 'function') {
      await pause(TAB_BEAT_MS + 500);
      return;
    }
    const heldNow = async () => ((await locks.query()).held || []).some((lock) => lock.name === TAB_LOCK);
    const end = Date.now() + HANDOVER_WAIT_MS;
    try {
      while (Date.now() < end && await heldNow()) await pause(25); // ours, going
      while (Date.now() < end && !(await heldNow())) await pause(25); // theirs, arriving
    } catch (error) { /* reload anyway */ }
  }

  const reload = () => (opts.reload || (() => globalThis.location.reload()))();

  // The other tab has gone: take up its last save and start editing.
  async function becomeEditor() {
    if (db) {
      // what the images store held when this tab last saved is not known now:
      // the other tab may have swept an image this tab's project names (SV2-28e)
      db.forgetStored();
      try {
        const raw = await db.readCurrent();
        if (raw !== undefined) {
          const have = new Set(await db.imageIds());
          let read = null;
          try {
            read = readRecord(raw, have);
          } catch (error) {
            await db.quarantineCurrent(raw, error);
            state.quarantined += 1;
            ctx.toast({ kind: 'problem', duration: Infinity, text: 'The other tab closed, and what it saved could not be read. That copy has been set aside; this tab carries on with what it shows.' });
          }
          if (read && read.project.id !== store.project.id) {
            // this tab shows one project and the device now holds another: it
            // never edits one while showing the other (21.4)
            await handOver(raw);
            return;
          }
          if (read) {
            show(read.project);
            known = raw.savedAt;
            state.savedAt = raw.savedAt;
            state.exportedAt = typeof raw.exportedAt === 'string' ? raw.exportedAt : null;
            state.save = 'saved';
            touched = true;
            await loadBlobs(read.project);
          }
        }
      } catch (error) {
        ctx.toast({ kind: 'problem', text: 'The other tab closed, but its last save could not be read here. ' + messageOf(error) });
      }
    }
    setReadOnly(false);
    ctx.toast({ text: 'The other tab closed. This tab can edit now, starting from the project as it was last saved.' });
  }

  const tabs = watchTabs({
    retryMs: opts.tabRetryMs,
    onChange(owner) {
      if (switching) return;
      if (owner) becomeEditor();
      else setReadOnly(true);
    },
  });
  state.tabs = tabs.kind;

  // ------------------------------------------------------------ start

  // `shelf` is the projects kept besides the open one, offered when the saved
  // project is missing or unreadable. Resolves with 'restore', 'other' or
  // 'shelf:<id>' (a project to open).
  function offerPoint(reason, newest, saved, shelf) {
    // the store still holds the stand-in; the point's own project says how its school writes a time
    const format = newest ? newest.project.settings.timeFormat : store.project.settings.timeFormat;
    const when = newest ? whenWords(newest.point.takenAt, clock(), format) : '';
    const holds = newest ? [summaryWords(newest.point.summary), formatBytes(newest.point.bytes)].filter((part) => part !== '').join(', ') : '';
    const about = newest ? 'The newest recovery point is from ' + when + (holds === '' ? '.' : ' (' + holds + ').') : null;
    const others = (shelf || []).filter((entry) => !entry.unreadable);
    const keptLine = others.length === 0 ? null : (others.length === 1 ? 'Another project is kept on this device.' : others.length + ' other projects are kept on this device.') + ' Open one of them, or start again.';
    const texts = {
      unreadable: {
        title: 'The saved project could not be read.',
        body: ['The unreadable copy has been set aside on this device. Nothing has overwritten it, and the Project section can export it.', about, keptLine],
        other: 'Start with the sample school',
      },
      missing: {
        title: newest ? 'No saved project was found, but there is a recovery point.' : 'No saved project was found, but other projects are kept on this device.',
        body: ['This browser has no saved project, which happens when its storage was cleared or the page closed before the first save.', about, keptLine],
        other: 'Start with the sample school',
      },
      newer: {
        title: 'A recovery point is newer than the saved project.',
        body: ['The saved project is from ' + whenWords(saved, clock(), format) + '. A recovery point holds later work, which happens when the page closed before a save finished.', about],
        other: 'Keep the saved project',
      },
    }[reason];
    return ctx.openDialog({
      id: 'recovery-dialog',
      title: texts.title,
      body: texts.body.filter((line) => line !== null).map((line) => h('p', null, line)),
      buttons: [
        // the projects kept on this device come before the sample school (21.10)
        ...others.map((entry) => ({ label: 'Open ' + (entry.label || entry.schoolName || UNTITLED), value: 'shelf:' + entry.id })),
        { label: texts.other, value: 'other' },
        ...(newest ? [{ label: 'Restore the recovery point from ' + when, value: 'restore', kind: 'primary' }] : []),
      ],
    }).closed.then((value) => (typeof value === 'string' && value.startsWith('shelf:') ? value : value === 'other' || !newest ? 'other' : 'restore'));
  }

  // Storage could not be opened or read at all. The page still works; it
  // says, and keeps saying, that nothing is being kept.
  function unavailable(error) {
    db = null;
    state.available = false;
    state.error = messageOf(error);
    state.recovery = false;
    setBanner('unavailable', {
      kind: 'problem',
      text: 'This browser is not keeping the project: ' + state.error + ' Your work lasts only while this tab is open. Export the project before you close it.',
      buttons: [{ label: 'Export the project now', action: 'export-now', run: () => exportProject() }],
    });
    drawIndicator();
  }

  // Two copies of one project (an older planner imported or restored it over
  // "current" while a newer one had it on the shelf): the shelf copy becomes a
  // recovery point of its own and the shelf key goes, so neither is overwritten
  // and neither is lost (21.10 "Boot reconcile").
  async function reconcileShelf(project) {
    let record;
    try {
      record = await db.readShelved(project.id);
    } catch (error) {
      return;
    }
    if (record === null || !isObject(record)) return;
    try {
      const images = isObject(record.images) ? record.images : {};
      const point = buildPoint(record.project, 'replace', clock().toISOString(), { get: (id) => (images[id] ? images[id].blob : undefined) });
      await db.addPoint(point, undefined, project.id);
      await db.deleteShelved(project.id);
    } catch (error) {
      return; // the shelf copy stays where it is; the next start tries again
    }
    state.reconciled = 'Two copies of ' + projectTitle(project) + ' were kept; the older one is in Recovery points.';
    ctx.toast({ text: state.reconciled, duration: Infinity });
  }

  // The saved project is missing or unreadable and the person chose a project
  // from the shelf: it becomes current, in the page, with no open project to put
  // on the shelf. Two transactions (save it as current, then delete the shelf
  // key); a stop between them leaves the project in both places, which
  // reconcileShelf says and mends at the next start. True when it was opened.
  async function openShelvedAtBoot(id) {
    try {
      const record = await db.readShelved(id);
      if (!isObject(record)) return false;
      const images = isObject(record.images) ? record.images : {};
      const read = readProject(record.project, new Set(Object.keys(images)));
      for (const [imageId, value] of Object.entries(images)) held.set(imageId, value);
      const savedAt = await db.saveProject(read.project, null, { exportedAt: typeof record.exportedAt === 'string' ? record.exportedAt : null, images: held });
      await db.deleteShelved(id);
      show(read.project);
      known = savedAt;
      state.savedAt = savedAt;
      state.exportedAt = typeof record.exportedAt === 'string' ? record.exportedAt : null;
      state.save = 'saved';
      state.opened = { id, at: clock().toISOString() };
      touched = true;
      lastPointModified = null;
      noteRepairs(read.notes);
      return true;
    } catch (error) {
      ctx.toast({ kind: 'problem', text: 'That project was not opened, and nothing has moved. ' + messageOf(error) });
      return false;
    }
  }

  async function start() {
    const owner = await tabs.ready;
    db = await openDatabases({ clock });
    if (db.recoveryError) warnRecovery(db.recoveryError);
    askToPersist().then((answer) => {
      state.persist = answer;
      emit('persist');
    });

    const raw = await db.readCurrent();
    const have = new Set(await db.imageIds());
    let loaded = null;
    let unreadable = null;
    if (raw !== undefined) {
      try {
        loaded = readRecord(raw, have);
      } catch (error) {
        unreadable = error;
      }
    }
    // Whose project the saved one is: a recovery point of another project is
    // not offered over it (21.10). Unknown when it is missing or too damaged to say.
    const currentId = loaded ? loaded.project.id : (isObject(raw) && isObject(raw.project) && typeof raw.project.id === 'string' ? raw.project.id : null);

    if (!owner) {
      // the editing tab deals with an unreadable copy; this one only looks
      if (loaded) {
        show(loaded.project);
        await loadBlobs(loaded.project);
        state.savedAt = raw.savedAt;
        state.exportedAt = typeof raw.exportedAt === 'string' ? raw.exportedAt : null;
      }
      state.quarantined = (await db.quarantined()).length;
      setReadOnly(true);
      return;
    }

    if (unreadable) await db.quarantineCurrent(raw, unreadable);
    state.quarantined = (await db.quarantined()).length;
    if (loaded) await reconcileShelf(loaded.project);

    // the newest point that can be read, of the saved project's own id
    let newest = null;
    if (db.recovery) {
      try {
        for (const point of await db.listPoints()) {
          if (currentId !== null && pointProjectId(point) !== currentId) continue;
          try {
            newest = await openPoint(point.key);
            break;
          } catch (error) { /* an unreadable point: try the one before */ }
        }
      } catch (error) {
        warnRecovery(error);
      }
    }
    const pointModified = newest && typeof newest.point.project.modified === 'string' ? newest.point.project.modified : '';
    const savedModified = loaded && typeof raw.project.modified === 'string' ? raw.project.modified : '';

    // with no saved project, the projects kept on this device come first
    let shelf = [];
    if (!loaded) {
      try {
        shelf = await db.listShelf();
      } catch (error) { /* no shelf to offer */ }
    }
    let restore = false;
    let choice = null;
    if (newest && unreadable) choice = await offerPoint('unreadable', newest, undefined, shelf);
    else if (newest && !loaded) choice = await offerPoint('missing', newest, undefined, shelf);
    else if (newest && pointModified > savedModified) choice = await offerPoint('newer', newest, raw.savedAt);
    else if (!loaded && shelf.some((entry) => !entry.unreadable)) choice = await offerPoint(unreadable ? 'unreadable' : 'missing', null, undefined, shelf);
    else if (unreadable) {
      await ctx.openDialog({
        id: 'recovery-dialog',
        title: 'The saved project could not be read.',
        body: [
          h('p', null, 'The unreadable copy has been set aside on this device. Nothing has overwritten it, and the Project section can export it.'),
          h('p', null, 'There is no recovery point on this device, so this is the sample school. If you have a project file, import it.'),
        ],
        buttons: [{ label: 'Carry on with the sample school', value: null }],
      }).closed;
    }
    restore = choice === 'restore';
    const shelfPick = typeof choice === 'string' && choice.startsWith('shelf:') ? choice.slice('shelf:'.length) : null;

    if (shelfPick !== null && await openShelvedAtBoot(shelfPick)) {
      // the shelved project is current now
    } else if (restore) {
      await keepPointImages(newest.project, newest.images);
      show(newest.project);
      await loadBlobs(newest.project);
      if (loaded) known = raw.savedAt;
      touched = true;
      lastPointModified = newest.project.modified;
      // the restored project becomes the saved one
      autosave.changed();
      noteRepairs(newest.notes);
    } else if (loaded) {
      show(loaded.project);
      await loadBlobs(loaded.project);
      known = raw.savedAt;
      state.savedAt = raw.savedAt;
      state.exportedAt = typeof raw.exportedAt === 'string' ? raw.exportedAt : null;
      state.save = 'saved';
      touched = true;
      lastPointModified = newest ? pointModified : null;
      noteRepairs(loaded.notes);
    }
    drawIndicator();
    refreshUsage(true);
  }

  store.subscribe(() => {
    if (quiet) return;
    touched = true;
    markChanged();
  });

  // Leaving: save what is waiting and keep a point. Both writes are issued
  // here in full, before the page goes; the browser finishes them. (A write
  // that reads first and puts in the callback is lost: the callback never runs.)
  globalThis.addEventListener('pagehide', () => {
    // a switch under way: this page holds the old project, and a save of it now
    // would land over the new "current"; the switch took its point (21.10 step 6)
    if (switching) return;
    if (!db || state.readOnly || state.save === 'conflict') return;
    if (autosave.pending) {
      try {
        const leaving = db.saveProjectLeaving(store.project, known, { exportedAt: state.exportedAt });
        leaving.done.catch(() => {});
        // a page kept in memory and shown again carries on from this save
        if (leaving.savedAt) known = leaving.savedAt;
      } catch (error) { /* the recovery point below is the other chance */ }
    }
    if (changedSincePoint()) {
      const project = store.project;
      try {
        db.addPointLeaving(buildPoint(project, 'leave', clock().toISOString(), blobs)).catch(() => {});
        lastPointModified = project.modified;
      } catch (error) { /* said already, if this device keeps no points */ }
    }
  });
  // A phone often hides a page and never says it has left.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && db && !state.readOnly) autosave.flush();
  });

  const ready = start().catch(unavailable).then(() => {
    startRecoveryTimer();
    emit('ready');
  });

  // ------------------------------------------------------------ several projects

  // Is this tab allowed to change which projects the device keeps? A refusal
  // object when it is not.
  function blocked() {
    if (!db) return refusal('unavailable', 'This browser is not keeping projects, so it cannot keep more than one.');
    if (state.readOnly) return refusal('read-only', READ_ONLY_PROJECTS);
    if (switching) return refusal('switching', 'A project is already being opened. Wait for the page to reload.');
    return null;
  }

  // The label of the shelved project with this id, or null (a project that is
  // not kept, and the open project's own id, which is not a refusal).
  async function holds(projectId) {
    if (!db || typeof projectId !== 'string' || projectId === '' || projectId === store.project.id) return null;
    const record = await db.readShelved(projectId);
    return isObject(record) ? projectTitle(record.project) : null;
  }

  function heldSentence(label, by) {
    return by === 'open'
      ? 'This is a copy of the open project, ' + label + '. Replace the open project with it, or keep it as another project.'
      : 'This is a copy of ' + label + ', which is also kept on this device. Open ' + label + ' first, or keep it as another project.';
  }

  // The shelf's refusals as results.
  function failed(error, what) {
    if (error instanceof ConflictError) return refusal('conflict', 'Another tab saved this project after this tab read it, so ' + what + ' and nothing has moved. Reload this tab, then try again.');
    if (error instanceof ShelfError) {
      const code = error.code === 'unreadable-target' ? 'unreadable' : error.code === 'shelf-full' ? 'limit' : error.code;
      return refusal(code, messageOf(error));
    }
    return refusal('failed', 'The project was not ' + what + ', and nothing has moved. ' + messageOf(error));
  }

  // The raw record of a shelved project as a file, whatever is wrong with it.
  function exportShelvedRaw(record) {
    const project = isObject(record) && record.project !== undefined ? record.project : null;
    download(exportFileName(isObject(project) ? project : {}, 'unreadable project', 'json', clock()), 'application/json', JSON.stringify(project, null, 2));
    return true;
  }

  // Step 1: the shelf record read the way start() reads the saved project.
  async function readTarget(id) {
    const record = await db.readShelved(id);
    if (record === null) return { refused: refusal('no-such-project', 'That project is no longer kept on this device.') };
    const images = isObject(record) && isObject(record.images) ? record.images : {};
    try {
      return { record, read: readProject(isObject(record) ? record.project : undefined, new Set(Object.keys(images))) };
    } catch (error) {
      return {
        refused: refusal('unreadable', 'That project cannot be read here, so it was not opened and nothing has moved. ' + messageOf(error) + ' It can still be exported as it is.', {
          exportRaw: () => exportShelvedRaw(record),
        }),
      };
    }
  }

  // Steps 2 to 6 of 21.10. `plan` is { targetId } (a shelved project to open)
  // or { fresh, freshImages } (a project in memory to start, the open one kept).
  async function move(plan, openedId) {
    // step 2: from this line no edit is made and no autosave is acted on
    switching = true;
    state.switching = true;
    autosave.hold();
    emit('switching');
    try {
      // step 3: the save in flight is let finish; then read the project
      await autosave.settle();
      const open = store.project;
      // step 4: a recovery point of the very object that goes on the shelf
      await takePoint('replace', undefined, open);
      // step 5: one transaction
      const extra = { images: held };
      const savedAt = plan.fresh
        ? await db.shelveAndStart(open, plan.fresh, known, { images: held, freshImages: plan.freshImages })
        : await db.switchTo(plan.targetId, open, known, extra);
      // step 6: the page reloads into the project that is current now
      known = savedAt;
      db.forgetStored();
      try {
        globalThis.sessionStorage.setItem(OPENED_KEY, JSON.stringify({ id: openedId, at: clock().toISOString() }));
      } catch (error) { /* the page opens all the same, without its sentence */ }
      emit('switched');
      reload();
      return { ok: true, id: openedId };
    } catch (error) {
      switching = false;
      state.switching = false;
      autosave.release();
      if (skipped) {
        skipped = false;
        autosave.changed();
      }
      const result = failed(error, 'opened');
      ctx.toast({ kind: 'problem', text: result.text });
      emit('switching');
      return result;
    }
  }

  // The images of a project in memory as the shelf takes them.
  function imagesOfFile(project, images) {
    const found = {};
    for (const floor of project.building.floors) {
      const id = floor.image ? floor.image.imageId : null;
      const file = id && images ? images[id] : null;
      if (!file || typeof file.data !== 'string') continue;
      const blob = base64ToBlob(file.data, file.type);
      found[id] = { blob, type: blob.type, width: floor.image.width, height: floor.image.height };
    }
    return found;
  }

  async function openProject(id) {
    const no = blocked();
    if (no) return no;
    if (typeof id !== 'string' || id === '') throw new TypeError('A project to open is named by its id.');
    if (id === store.project.id) throw new TypeError('That project is the one already open.');
    const target = await readTarget(id);
    if (target.refused) return target.refused;
    if (blocked()) return blocked();
    return move({ targetId: id }, id);
  }

  async function startAnother(kind, read, options) {
    const no = blocked();
    if (no) return no;
    if (!['empty', 'sample', 'file'].includes(kind)) throw new TypeError("A project is started as 'empty', 'sample' or 'file'.");
    const opts = options || {};
    let label = '';
    if (opts.label !== undefined) {
      label = cleanLabel(opts.label);
      if (label === null) return refusal('label', 'A label is at most ' + LABEL_MOST + ' characters.');
    }
    const open = store.project;
    let fresh;
    let freshImages = {};
    if (kind === 'empty') {
      fresh = keepNeverShow(open, newProject(ctx.ids, clock, { paperSize: ctx.devicePaper ? ctx.devicePaper() : undefined, passcode: DEFAULT_PASSCODE }));
      fresh.settings.theme = open.settings.theme;
    } else if (kind === 'sample') {
      fresh = keepNeverShow(open, sampleSchool());
      fresh.settings.theme = open.settings.theme;
    } else {
      if (!isObject(read) || !isObject(read.project)) throw new TypeError("startAnother('file') takes what readProjectFile returned.");
      fresh = read.project;
      freshImages = imagesOfFile(fresh, read.images);
      try {
        readProject(fresh, new Set(Object.keys(freshImages)));
      } catch (error) {
        return refusal('unreadable', 'That project was not started, and nothing has moved. ' + messageOf(error));
      }
    }
    // one project, one place (21.1)
    let by = null;
    let heldLabel = '';
    if (fresh.id === open.id) {
      by = 'open';
      heldLabel = projectTitle(open);
    } else {
      const there = await db.readShelved(fresh.id);
      if (isObject(there)) {
        by = 'shelf';
        heldLabel = projectTitle(there.project);
      }
    }
    if (by !== null) {
      if (opts.copy !== true) return refusal('held', heldSentence(heldLabel, by), { id: fresh.id, label: heldLabel, heldBy: by });
      fresh = { ...fresh, id: ctx.ids('p'), label: label !== '' ? label : suffixed(projectTitle(fresh), ' (another copy)') };
    } else if (label !== '') {
      fresh = { ...fresh, label };
    }
    if (blocked()) return blocked();
    return move({ fresh, freshImages }, fresh.id);
  }

  async function duplicate(options) {
    const no = blocked();
    if (no) return no;
    const opts = options || {};
    let label = null;
    if (opts.label !== undefined) {
      label = cleanLabel(opts.label);
      if (label === null) return refusal('label', 'A label is at most ' + LABEL_MOST + ' characters.');
    }
    const open = store.project;
    const now = clock().toISOString();
    const copy = structuredClone(open);
    copy.id = ctx.ids('p');
    copy.label = label !== null && label !== '' ? label : suffixed(projectTitle(open), ' (copy)');
    copy.created = now;
    copy.modified = now;
    if (isObject(copy.publish)) copy.publish.lastPublishedAt = null;
    // its images, the same ids: the images store keeps what "current" names, and
    // the original's shelf record carries its own
    const freshImages = {};
    try {
      for (const id of imageIdsOf(copy)) {
        const value = held.get(id) || await db.getImage(id);
        if (value) freshImages[id] = value;
      }
    } catch (error) {
      return refusal('failed', 'The project was not duplicated, and nothing has moved. ' + messageOf(error));
    }
    if (blocked()) return blocked();
    return move({ fresh: copy, freshImages }, copy.id);
  }

  async function rename(id, label) {
    const no = blocked();
    if (no) return no;
    if (id === store.project.id) return refusal('is-open', 'Rename the open project in its Label field.');
    const text = cleanLabel(label);
    if (text === null) return refusal('label', 'A label is at most ' + LABEL_MOST + ' characters.');
    try {
      await db.renameShelved(id, text);
    } catch (error) {
      return failed(error, 'renamed');
    }
    emit('projects');
    return { ok: true, label: text };
  }

  async function remove(id) {
    const no = blocked();
    if (no) return no;
    if (id === store.project.id) return refusal('is-open', 'This project is open. To delete it, open another first.');
    let record;
    try {
      record = await db.readShelved(id);
    } catch (error) {
      return failed(error, 'deleted');
    }
    if (record === null) return refusal('no-such-project', 'That project is no longer kept on this device.');
    // a recovery point of it first; the newest 3 of each other project are kept.
    // A record too damaged to make a point of (it is listed as unreadable) is
    // deleted without one: the person was offered its export first.
    let point = null;
    try {
      const images = isObject(record) && isObject(record.images) ? record.images : {};
      point = buildPoint(record.project, 'replace', clock().toISOString(), { get: (imageId) => (images[imageId] ? images[imageId].blob : undefined) });
    } catch (error) { /* no point can be made of it */ }
    let key = null;
    if (point !== null) {
      try {
        key = await db.addPoint(point, undefined, store.project.id);
      } catch (error) {
        warnRecovery(error);
      }
    }
    try {
      await db.deleteShelved(id);
    } catch (error) {
      return failed(error, 'deleted');
    }
    emit('points');
    emit('projects');
    return { ok: true, label: projectTitle(isObject(record) ? record.project : null), pointKey: key, pointKept: key !== null };
  }

  // The project of a recovery point or a snapshot, read for restoreAsProject.
  async function readForRestore(which) {
    if (which.point !== undefined) {
      const point = await db.getPoint(which.point);
      if (!point) return { refused: refusal('no-such-point', 'That recovery point is no longer on this device.') };
      if (!isPoint(point)) return { refused: refusal('unreadable', 'That recovery point cannot be read.') };
      const images = isObject(point.images) ? point.images : {};
      const stored = {};
      for (const [id, blob] of Object.entries(images)) {
        const floor = point.project.building && Array.isArray(point.project.building.floors) ? point.project.building.floors.find((each) => each && each.image && each.image.imageId === id) : null;
        if (floor) stored[id] = { blob, type: blob.type, width: floor.image.width, height: floor.image.height };
      }
      return { raw: point.project, stored };
    }
    const record = await readSnapshot(db.main, which.snapshot);
    if (!record) return { refused: refusal('no-such-snapshot', 'That snapshot is no longer on this device.') };
    if (!isSnapshot(record)) return { refused: refusal('unreadable', 'That snapshot cannot be read.') };
    const stored = {};
    for (const id of imageIdsOf(record.project)) {
      const value = await db.getImage(id);
      if (value && value.blob) stored[id] = value;
    }
    return { raw: record.project, stored };
  }

  async function restoreAsProject(of) {
    const no = blocked();
    if (no) return no;
    let which;
    if (typeof of === 'number') which = { point: of };
    else if (typeof of === 'string') which = { snapshot: of };
    else if (isObject(of) && of.point !== undefined) which = { point: of.point };
    else if (isObject(of) && typeof of.snapshot === 'string') which = { snapshot: of.snapshot };
    else throw new TypeError('restoreAsProject takes a recovery point (its key) or a snapshot (its id).');
    let source;
    try {
      source = await readForRestore(which);
    } catch (error) {
      return refusal('failed', 'The project was not restored, and nothing has moved. ' + messageOf(error));
    }
    if (source.refused) return source.refused;
    let read;
    try {
      read = readProject(source.raw, new Set(Object.keys(source.stored)));
    } catch (error) {
      return refusal('unreadable', 'That project cannot be read, so it was not restored and nothing has moved. ' + messageOf(error));
    }
    const project = read.project;
    if (project.id === store.project.id) return refusal('is-open', 'This is the open project. Restore it where it is listed, not as another project.');
    const keptAs = await holds(project.id);
    if (keptAs !== null) return refusal('held', 'This is a copy of ' + keptAs + ', which is also kept on this device. Open ' + keptAs + ' instead.', { id: project.id, label: keptAs, heldBy: 'shelf' });
    const gone = imageIdsOf(source.raw).filter((id) => !source.stored[id]);
    if (blocked()) return blocked();
    const result = await move({ fresh: project, freshImages: source.stored }, project.id);
    if (!result.ok) return result;
    const notes = read.notes.slice();
    if (gone.length > 0) notes.unshift(IMAGE_GONE_SENTENCE);
    return { ok: true, id: project.id, imageGone: gone.length > 0, notes };
  }

  async function list() {
    if (!db) return [];
    const shelf = await db.listShelf();
    const open = store.project;
    return [{
      id: open.id,
      open: true,
      label: typeof open.label === 'string' ? open.label : '',
      schoolName: open.settings.schoolName,
      savedAt: state.savedAt,
      shelvedAt: null,
      bytes: projectBytes(open, Object.fromEntries(held)),
      summary: pointSummary(open),
    }, ...shelf.map((entry) => (entry.unreadable ? { ...entry, open: false, exportRaw: async () => exportShelvedRaw(await db.readShelved(entry.id)) } : { ...entry, open: false }))];
  }

  const projects = { list, open: openProject, startAnother, duplicate, rename, remove, holds, restoreAsProject };

  const storage = {
    state,
    ready,
    hooks,
    recoveryKeep: RECOVERY_KEEP,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    takeRecoveryPoint: (reason) => takePoint(reason),
    listRecoveryPoints: listPoints,
    restoreRecoveryPoint: restorePoint,
    exportRecoveryPoint: exportPoint,
    deleteRecoveryPoint: deletePoint,
    exportProject,
    exportQuarantined,
    projects,
    noteExported,
    imagesForFile,
    keepFileImages,
    async putImage(id, value) {
      await db.putImage(id, value);
      held.set(id, value);
    },
    getImage: (id) => db.getImage(id),
    refreshUsage: () => refreshUsage(true),
    flush: () => autosave.flush(),
    get pending() {
      return autosave.pending;
    },
    // For the tests: shorter waits.
    setTiming(timing) {
      autosave.setTiming(timing);
      if (timing.recoveryMs !== undefined) {
        recoveryMs = timing.recoveryMs;
        startRecoveryTimer();
      }
    },
  };
  active = storage;
  return storage;
}
