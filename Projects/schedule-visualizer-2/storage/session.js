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
//
// The module also exports takeRecoveryPoint(reason) for code that has no ctx.

import { h } from '../ui/components/dom.js';
import { migrate, versionOf } from '../engine/migrate.js';
import { repair } from '../engine/repair.js';
import { validate } from '../engine/validate.js';
import { replaceProject } from '../engine/actions.js';
import { writeProjectFile } from '../engine/project-file.js';
import { exportFileName } from '../engine/exports.js';
import { openDatabases, estimateUsage, askToPersist, imageIdsOf, hooks, RECOVERY_KEEP } from './db.js';
import { createAutosave, SAVE_RETRY_MS } from './autosave.js';
import { buildPoint, isPoint, RECOVERY_INTERVAL_MS } from './recovery.js';
import { watchTabs } from './tabs.js';
import { formatBytes, clockTime, whenWords, whenInSentence, dayWords } from './words.js';

// Above this share of the room the browser allows, the page warns.
export const USAGE_WARNING_SHARE = 0.8;

const USAGE_EVERY_MS = 10000;
const READ_ONLY_TOAST_EVERY_MS = 5000;

const BANNER_EDGE = { problem: 'var(--problem)', warning: 'var(--warning)', note: 'var(--note)' };

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
  };

  let db = null;
  let known = null; // the savedAt this tab last read or wrote
  let quiet = false; // a store change that is storage's own (a load)
  let touched = false; // is there anything of the person's here to protect?
  let lastPointModified = null;
  let recoveryWarned = false;
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
  // (Their look is set here: ui/app.css has no banner yet.)
  const bannerHost = h('div', { id: 'storage-banners' });
  bannerHost.style.cssText = 'position:sticky;top:0;z-index:3;display:grid';
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
    const element = h('div', { id: 'banner-' + id, role: content.kind === 'problem' ? 'alert' : 'status', data: { banner: id, kind: content.kind } },
      h('p', null, content.text),
      (content.buttons || []).map((button) => h('button', { type: 'button', class: 'btn', data: { action: button.action }, on: { click: button.run } }, button.label)),
    );
    element.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:var(--s-3);padding:var(--s-3) var(--s-5);'
      + 'background:var(--card);color:var(--ink);border-bottom:var(--border-width) solid var(--line);border-left:4px solid ' + BANNER_EDGE[content.kind];
    element.firstChild.style.cssText = 'margin:0;flex:1 1 20rem;max-width:60rem';
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
  async function takePoint(reason, spare) {
    if (!db || state.readOnly) return null;
    const project = store.project;
    const before = lastPointModified;
    lastPointModified = project.modified;
    try {
      const key = await db.addPoint(buildPoint(project, reason, clock().toISOString(), blobs), spare);
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
      if (changedSincePoint()) takePoint('timer');
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
    if (db && !state.readOnly) autosave.changed();
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
    if (!state.readOnly) return apply(action, payload);
    refuseReadOnly();
    return store.project;
  };
  store.undo = () => (state.readOnly ? null : undo());
  store.redo = () => (state.readOnly ? null : redo());

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

  // The other tab has gone: take up its last save and start editing.
  async function becomeEditor() {
    if (db) {
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
      if (owner) becomeEditor();
      else setReadOnly(true);
    },
  });
  state.tabs = tabs.kind;

  // ------------------------------------------------------------ start

  function offerPoint(reason, newest, saved) {
    // the store still holds the stand-in; the point's own project says how its school writes a time
    const format = newest.project.settings.timeFormat;
    const when = whenWords(newest.point.takenAt, clock(), format);
    const holds = [summaryWords(newest.point.summary), formatBytes(newest.point.bytes)].filter((part) => part !== '').join(', ');
    const about = 'The newest recovery point is from ' + when + (holds === '' ? '.' : ' (' + holds + ').');
    const texts = {
      unreadable: {
        title: 'The saved project could not be read.',
        body: ['The unreadable copy has been set aside on this device. Nothing has overwritten it, and the Project section can export it.', about],
        other: 'Start with the sample school',
      },
      missing: {
        title: 'No saved project was found, but there is a recovery point.',
        body: ['This browser has no saved project, which happens when its storage was cleared or the page closed before the first save.', about],
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
      body: texts.body.map((line) => h('p', null, line)),
      buttons: [
        { label: texts.other, value: 'other' },
        { label: 'Restore the recovery point from ' + when, value: 'restore', kind: 'primary' },
      ],
    }).closed.then((value) => value !== 'other');
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

    // the newest point that can be read
    let newest = null;
    if (db.recovery) {
      try {
        for (const point of await db.listPoints()) {
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

    let restore = false;
    if (newest && unreadable) restore = await offerPoint('unreadable', newest);
    else if (newest && !loaded) restore = await offerPoint('missing', newest);
    else if (newest && pointModified > savedModified) restore = await offerPoint('newer', newest, raw.savedAt);
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

    if (restore) {
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
    if (!db || state.readOnly) return;
    autosave.changed();
  });

  // Leaving: save what is waiting and keep a point. Both writes are issued
  // here in full, before the page goes; the browser finishes them. (A write
  // that reads first and puts in the callback is lost: the callback never runs.)
  globalThis.addEventListener('pagehide', () => {
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
