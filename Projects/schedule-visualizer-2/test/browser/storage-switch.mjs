// Several projects on one device, the session: node test/browser/storage-switch.mjs
//
// ctx.storage.projects (storage/session.js, ARCHITECTURE 21.4 and 21.10) in a
// real browser with a real IndexedDB, through the page's own storage session
// and its real reloads. The journey, in order: the names; Start another (empty,
// the sample, a file with a traced image; the one-per-id refusals and "keep it
// as another project"); an edit pending as a switch starts (the target is
// current after the reload, the edit is on the shelf and in the 'replace' point,
// nothing wrote the old project over it); the boot dialogs seeing only a
// point of the saved project's own id; the boot reconcile of a second copy;
// an unreadable shelf record refused before anything moves; a duplicate's label,
// new id and images; restore as a project from a point and from a snapshot
// whose image is gone; holds, rename and remove; every call refused while a
// switch is under way (and a failed switch giving everything back); every call
// refused in a read-only tab; a read-only sibling through a switch with no
// bounce; a tab that becomes the editor over another project reloading.
//
// Every wait is on a state the page sets (the sections not pending, the
// storage session's own flags, a marker the old page cannot carry through a
// reload), never on a first paint or a sleep.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, waitForSection, clearSaved, plainSample } from './harness.mjs';
import { IMAGE_GONE_SENTENCE } from '../../storage/snapshots.js';

let session;
let page;
const extra = [];

// ---------------------------------------------------------------- helpers

// Read straight from IndexedDB, past the tool's own code.
const idb = (p, database, storeName, how, key) => p.evaluate((args) => new Promise((resolve, reject) => {
  const open = indexedDB.open(args.database);
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    const store = db.transaction(args.storeName, 'readonly').objectStore(args.storeName);
    const request = args.how === 'get' ? store.get(args.key) : args.how === 'keys' ? store.getAllKeys() : store.getAll();
    request.onsuccess = () => {
      db.close();
      resolve(JSON.parse(JSON.stringify(request.result === undefined ? null : request.result, (name, value) => (value instanceof Blob ? { blob: value.size } : value))));
    };
    request.onerror = () => reject(request.error);
  };
}), { database, storeName, how, key });

const write = (p, database, storeName, how, value, key) => p.evaluate((args) => new Promise((resolve, reject) => {
  const open = indexedDB.open(args.database);
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    const tx = db.transaction(args.storeName, 'readwrite');
    if (args.how === 'delete') tx.objectStore(args.storeName).delete(args.key);
    else if (args.key === undefined) tx.objectStore(args.storeName).put(args.value);
    else tx.objectStore(args.storeName).put(args.value, args.key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  };
}), { database, storeName, how, value, key });

const current = (p) => idb(p, 'sv2', 'project', 'get', 'current');
const shelfOf = (p, id) => idb(p, 'sv2', 'project', 'get', 'shelf:' + id);
const shelfKeys = async (p) => (await idb(p, 'sv2', 'project', 'keys')).filter((key) => key.startsWith('shelf:')).sort();
const points = (p) => idb(p, 'sv2-recovery', 'recovery', 'all');
const imageKeys = (p) => idb(p, 'sv2', 'images', 'keys');
const stateOf = (p) => p.evaluate(() => {
  const { storage, store } = globalThis.sv2;
  const s = storage.state;
  return { readOnly: s.readOnly, switching: s.switching, opened: s.opened, reconciled: s.reconciled, id: store.project.id };
});
const projectId = (p) => p.evaluate(() => globalThis.sv2.store.project.id);

// Saved, with nothing waiting: the save indicator and the session's own word for it.
const waitSaved = (p) => p.waitForFunction(() => document.getElementById('save-indicator').dataset.state === 'saved' && !globalThis.sv2.storage.pending, { timeout: 15000 });

// A page loaded again: the marker the old page set is gone, the planner is
// drawn, its sections are not pending.
async function loaded(p) {
  try {
    await p.waitForFunction(() => globalThis.__before === undefined && globalThis.sv2 !== undefined
      && document.documentElement.dataset.ready === 'true' && document.querySelector('[data-pending="true"]') === null, { timeout: 40000 });
    await waitForSection(p, 'project');
  } catch (error) {
    // say what the page was waiting on, not only that it waited
    const seen = await p.evaluate(() => ({
      marker: globalThis.__before === undefined ? 'gone' : 'still there',
      planner: typeof globalThis.sv2,
      ready: document.documentElement.dataset.ready,
      pending: Array.from(document.querySelectorAll('[data-pending="true"]')).map((el) => el.id || el.className),
      dialog: document.querySelector('dialog[open], .dialog')?.textContent.slice(0, 200) || null,
      answer: sessionStorage.getItem('test:answer'),
    })).catch((failure) => ({ gone: String(failure) }));
    throw new Error(error.message + ' ' + JSON.stringify(seen));
  }
}

// Make the call in the page without waiting for its answer (a successful switch
// reloads the page under it), then wait for the page that follows.
async function through(p, expression, arg) {
  await p.evaluate(() => {
    globalThis.__before = true;
  });
  await p.evaluate((source, given) => {
    const call = new Function('storage', 'sv2', 'arg', 'return (' + source + ')');
    Promise.resolve(call(globalThis.sv2.storage, globalThis.sv2, given)).then((result) => sessionStorage.setItem('test:answer', JSON.stringify(result)));
  }, expression, arg);
  await loaded(p);
}

// The answer of a call that did not reload the page.
const ask = (p, expression, arg) => p.evaluate((source, given) => {
  const call = new Function('storage', 'sv2', 'arg', 'return (' + source + ')');
  return Promise.resolve(call(globalThis.sv2.storage, globalThis.sv2, given)).then((result) => JSON.parse(JSON.stringify(result, (name, value) => (typeof value === 'function' ? '[function]' : value))));
}, expression, arg);

// Leave the planner for a page of the same origin that runs none of it (the
// planner's own leaving writes are done by then), do `work`, and open the
// planner again. Does not wait for it: a boot dialog may be what is asked for.
async function away(p, work) {
  await p.goto(session.base + '/404.html', { waitUntil: 'load' });
  await work();
  await p.goto(session.url('#project'), { waitUntil: 'load' });
}

async function freshDevice(p) {
  await p.goto('about:blank');
  await clearSaved(p, session.base);
  await p.goto(session.url('#project'), { waitUntil: 'load' });
  await waitForSection(p, 'project');
  await plainSample(p);
  await waitSaved(p);
  await p.evaluate(async () => {
    globalThis.sv2Actions = await import(new URL('engine/actions.js', document.baseURI).href);
  });
}

// The page's actions again after a reload.
async function withActions(p) {
  await p.evaluate(async () => {
    globalThis.sv2Actions = await import(new URL('engine/actions.js', document.baseURI).href);
  });
}

const rename = (p, name) => p.evaluate((value) => {
  globalThis.sv2.store.apply(globalThis.sv2Actions.setSetting, { key: 'schoolName', value });
}, name);

// A second page on the same device: it is a second tab of the first.
async function secondTab() {
  const other = await openPlanner({ server: session.server, browser: session.browser, hash: '#project', keep: true });
  extra.push(other);
  return other.page;
}

before(async () => {
  session = await openPlanner({ hash: '#project' });
  page = session.page;
  await withActions(page);
});

after(async () => {
  for (const other of extra) await other.close().catch(() => {});
  if (session) await session.close();
});

// ---------------------------------------------------------------- the names

test('the names: sessionStorage sv2:opened, the ten calls of projects, the three flags of state', async () => {
  const seen = await page.evaluate(async () => {
    const module = await import(new URL('storage/session.js', document.baseURI).href);
    const { storage } = globalThis.sv2;
    return {
      key: module.OPENED_KEY,
      calls: Object.keys(storage.projects).sort(),
      flags: ['switching', 'opened', 'reconciled'].map((name) => name in storage.state),
    };
  });
  assert.equal(seen.key, 'sv2:opened', 'the key never changes once written');
  assert.deepEqual(seen.calls, ['duplicate', 'exportShelved', 'holds', 'list', 'open', 'read', 'remove', 'rename', 'restoreAsProject', 'startAnother']);
  assert.deepEqual(seen.flags, [true, true, true]);
});

// ---------------------------------------------------------------- start another

test('start another, empty: the open project goes on the shelf, the new one is current after the reload, and the sentence for the page is read once', async () => {
  await freshDevice(page);
  const first = await projectId(page);
  assert.equal((await stateOf(page)).opened, null, 'a page that was not reached by a switch has no sentence');
  await through(page, "storage.projects.startAnother('empty', undefined, { label: 'Next year' })");
  const now = await stateOf(page);
  assert.notEqual(now.id, first, 'the page shows the new project');
  assert.equal(now.opened.id, now.id, 'state.opened says which project this page was opened for');
  assert.match(now.opened.at, /^\d{4}-\d\d-\d\dT/, 'and when, as a time');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('sv2:opened')), null, 'read once and removed');
  const saved = await current(page);
  assert.equal(saved.project.id, now.id);
  assert.equal(saved.project.label, 'Next year', 'the label given is in the project as stored');
  assert.equal(typeof saved.openedAt, 'string', 'current carries the stamp of the switch (the tab lock reads it)');
  assert.deepEqual(await shelfKeys(page), ['shelf:' + first], 'the project that was open is on the shelf under its id');
  const list = await ask(page, 'storage.projects.list()');
  assert.deepEqual(list.map((entry) => [entry.id, entry.open]), [[now.id, true], [first, false]], 'the open project first, then the rest');
  await page.reload({ waitUntil: 'load' });
  await loaded(page);
  assert.equal((await stateOf(page)).opened, null, 'a plain reload says nothing');
});

test('start another, the sample: opened as another project; the sample already open or kept is refused, and "keep it as another project" gives it its own id', async () => {
  await freshDevice(page);
  // the plain school the harness loads is the sample's own project id: put it
  // aside and delete it, so the device holds no project of that id
  const sampleId = await projectId(page);
  assert.equal(sampleId, 'psample001');
  await through(page, "storage.projects.startAnother('empty')");
  const first = await projectId(page);
  const kept = await ask(page, "storage.projects.startAnother('sample')");
  assert.deepEqual([kept.ok, kept.code, kept.heldBy], [false, 'held', 'shelf'], 'the sample is kept on this device');
  assert.equal(typeof kept.label, 'string');
  assert.ok(kept.label.length > 0, 'the refusal names the project it would copy');
  assert.equal((await ask(page, 'storage.projects.remove(arg)', sampleId)).ok, true);
  await through(page, "storage.projects.startAnother('sample')");
  assert.equal(await projectId(page), 'psample001', 'the sample school, under its fixed id');
  assert.deepEqual(await shelfKeys(page), ['shelf:' + first]);
  const open = await ask(page, "storage.projects.startAnother('sample')");
  assert.deepEqual([open.ok, open.code, open.heldBy], [false, 'held', 'open'], 'the sample is the open project');
  assert.equal((await stateOf(page)).switching, false, 'a refusal moves nothing');
  await through(page, "storage.projects.startAnother('empty')");
  const empty = await projectId(page);
  assert.deepEqual(await shelfKeys(page), ['shelf:' + first, 'shelf:psample001'].sort());
  await through(page, "storage.projects.startAnother('sample', undefined, { copy: true })");
  const copy = await current(page);
  assert.notEqual(copy.project.id, 'psample001', 'the copy has an identity of its own');
  assert.notEqual(copy.project.id, empty);
  assert.match(copy.project.label, / \(another copy\)$/, 'and the label the design gives it');
  assert.deepEqual(await shelfKeys(page), ['shelf:' + first, 'shelf:psample001', 'shelf:' + empty].sort(), 'all three others are kept');
});

test('start another from a file: its traced image is kept, a file that is the open project or a kept one is refused, and the copy has a new id', async () => {
  await freshDevice(page);
  const first = await projectId(page);
  // a project file with one traced image, as readProjectFile reads it
  const file = (id) => page.evaluate(async (projectIdWanted) => {
    const { writeProjectFile, readProjectFile } = await import(new URL('engine/project-file.js', document.baseURI).href);
    const { store, ctx } = globalThis.sv2;
    const base = store.project;
    const floors = base.building.floors.map((floor, index) => (index === 0
      ? { ...floor, image: { imageId: 'ifileimg01', opacity: 0.4, scale: 1, rotation: 0, x: 0, y: 0, visible: true, locked: false, width: 2, height: 2, missing: false } }
      : floor));
    const project = { ...JSON.parse(JSON.stringify(base)), id: projectIdWanted, label: '', building: { ...base.building, floors } };
    const text = writeProjectFile(project, { images: { ifileimg01: { data: btoa('a picture'), type: 'image/png' } } });
    const read = readProjectFile(text, { ids: ctx.ids, clock: ctx.clock });
    globalThis.__file = read;
    return read.project.id;
  }, id);
  assert.equal(await file('pfileproj1'), 'pfileproj1');
  await through(page, "storage.projects.startAnother('file', globalThis.__file, { label: 'From a file' })");
  assert.equal(await projectId(page), 'pfileproj1', 'the file\'s project is open');
  assert.equal((await current(page)).project.label, 'From a file');
  assert.deepEqual(await imageKeys(page), ['ifileimg01'], 'its traced image is on the device');
  assert.deepEqual(await shelfKeys(page), ['shelf:' + first]);
  // the same file again: its id is the open project's
  await file('pfileproj1');
  const same = await ask(page, "storage.projects.startAnother('file', globalThis.__file)");
  assert.deepEqual([same.ok, same.code, same.heldBy, same.id], [false, 'held', 'open', 'pfileproj1']);
  // a file with the id of a kept project
  await file(first);
  const kept = await ask(page, "storage.projects.startAnother('file', globalThis.__file)");
  assert.deepEqual([kept.ok, kept.code, kept.heldBy, kept.id], [false, 'held', 'shelf', first]);
  assert.equal(typeof kept.label, 'string');
  await through(page, "storage.projects.startAnother('file', globalThis.__file, { copy: true })");
  const copy = await current(page);
  assert.notEqual(copy.project.id, first, 'kept as another project, with an id of its own');
  assert.notEqual(copy.project.id, 'pfileproj1');
  assert.match(copy.project.label, / \(another copy\)$/);
  assert.deepEqual(await shelfKeys(page), ['shelf:' + first, 'shelf:pfileproj1'].sort(), 'the project that was kept stays kept');
});

// ---------------------------------------------------------------- the six steps

test('an edit pending as the switch starts: the target is current after the reload, the edit is on the shelf and in the replace point, and no leaving save wrote it over the new project', async () => {
  await freshDevice(page);
  const first = await projectId(page);
  await through(page, "storage.projects.startAnother('empty')");
  const second = await projectId(page);
  await withActions(page);
  await waitSaved(page);
  const before = (await points(page)).length;
  // the edit and the switch in one tick: the edit cannot have been saved yet
  await page.evaluate((target) => {
    globalThis.__before = true;
    const { store, storage } = globalThis.sv2;
    store.apply(globalThis.sv2Actions.setSetting, { key: 'schoolName', value: 'Edited as the switch began' });
    if (!storage.pending) throw new Error('the edit was not pending: this test proves nothing');
    storage.projects.open(target);
  }, first);
  await loaded(page);
  const now = await stateOf(page);
  assert.equal(now.id, first, 'the target is the project on screen after the reload');
  const saved = await current(page);
  assert.equal(saved.project.id, first, 'and the one saved as current: the page that was left wrote nothing over it');
  const shelved = await shelfOf(page, second);
  assert.equal(shelved.project.settings.schoolName, 'Edited as the switch began', 'the edit is in the project that was put on the shelf');
  const after = await points(page);
  const replace = after.filter((point) => point.reason === 'replace' && point.project.id === second);
  assert.ok(replace.some((point) => point.project.settings.schoolName === 'Edited as the switch began'), 'the replace point holds the edit');
  assert.equal(after.filter((point) => point.reason === 'leave').length, 0, 'the leaving point was skipped: the switch had taken its own');
  assert.equal(after.length, before + 1, 'exactly one point was taken by the switch');
});

test('the boot dialogs see only points of the saved project\'s own id: a switch\'s point of the other project is not offered, a same-id newer one still is', async () => {
  await freshDevice(page);
  const first = await projectId(page);
  await through(page, "storage.projects.startAnother('empty')");
  const second = await projectId(page);
  // the page reached here without a recovery dialog: the reload after the
  // switch had the switch's own 'replace' point of the first project to meet
  assert.equal(await page.evaluate(() => document.getElementById('recovery-dialog')), null);
  assert.ok((await points(page)).some((point) => point.reason === 'replace' && point.project.id === first), 'the switch\'s point is there');
  // a point of the other project, far newer than anything saved
  const saved = await current(page);
  const clone = (id) => JSON.parse(JSON.stringify({ ...saved.project, id, modified: '2099-01-01T00:00:00.000Z' }));
  const point = (project) => ({ takenAt: '2099-01-01T00:00:00.000Z', reason: 'timer', summary: { floors: 1, rooms: 0, groups: 0, teachers: 0 }, bytes: 1, project, images: {}, projectId: project.id });
  // written with the planner's page gone, so that the point the page takes as
  // it leaves is not newer than this one and hides it
  await away(page, () => write(page, 'sv2-recovery', 'recovery', 'put', point(clone(first))));
  await loaded(page);
  assert.equal(await page.evaluate(() => document.getElementById('recovery-dialog')), null, 'a newer point of another project is not offered over this one');
  assert.equal((await stateOf(page)).id, second);
  // and one of its own id, newer, is
  await away(page, () => write(page, 'sv2-recovery', 'recovery', 'put', point(clone(second))));
  await page.waitForFunction(() => document.getElementById('recovery-dialog') !== null, { timeout: 20000 });
  const dialog = await page.evaluate(() => ({
    title: document.querySelector('#recovery-dialog h2, #recovery-dialog [role="heading"]')?.textContent || document.getElementById('recovery-dialog').textContent.slice(0, 80),
    buttons: [...document.querySelectorAll('#recovery-dialog button')].map((button) => button.textContent),
  }));
  assert.match(dialog.title, /newer than the saved project/);
  assert.ok(dialog.buttons.includes('Keep the saved project'));
  await page.evaluate(() => [...document.querySelectorAll('#recovery-dialog button')].find((button) => button.textContent === 'Keep the saved project').click());
  await loaded(page);
  assert.equal((await stateOf(page)).id, second);
});

test('boot reconcile: a shelf copy of the project that is current becomes a recovery point of its own, the shelf key goes, and the page says so', async () => {
  await freshDevice(page);
  const first = await projectId(page);
  await through(page, "storage.projects.startAnother('empty')");
  const second = await projectId(page);
  const before = await current(page);
  // an older planner put the first project's contents over the open one's id
  const old = await shelfOf(page, first);
  const copy = JSON.parse(JSON.stringify(old));
  copy.project.id = second;
  copy.project.settings.schoolName = 'The older copy';
  await write(page, 'sv2', 'project', 'put', copy, 'shelf:' + second);
  assert.deepEqual(await shelfKeys(page), ['shelf:' + first, 'shelf:' + second].sort());
  await page.reload({ waitUntil: 'load' });
  await loaded(page);
  const now = await stateOf(page);
  assert.match(now.reconciled, /^Two copies of .+ were kept; the older one is in Recovery points\.$/);
  assert.deepEqual(await shelfKeys(page), ['shelf:' + first], 'the shelf key of the open project is gone');
  const kept = (await points(page)).filter((point) => point.reason === 'replace' && point.project.id === second);
  assert.equal(kept.length, 1, 'the older copy is a recovery point');
  assert.equal(kept[0].project.settings.schoolName, 'The older copy');
  const after = await current(page);
  assert.equal(after.project.settings.schoolName, before.project.settings.schoolName, 'the open project was not overwritten');
});

test('an unreadable shelf record is refused before anything moves, and can be exported as it is', async () => {
  await freshDevice(page);
  const first = await projectId(page);
  await through(page, "storage.projects.startAnother('empty')");
  const second = await projectId(page);
  const damaged = await shelfOf(page, first);
  delete damaged.project.groups;
  await write(page, 'sv2', 'project', 'put', damaged, 'shelf:' + first);
  await waitSaved(page);
  const record = await current(page);
  const pointsBefore = (await points(page)).length;
  const shelfBefore = await shelfOf(page, first);
  await page.evaluate(() => {
    globalThis.__before = true;
  });
  const answer = await page.evaluate(async (id) => {
    const result = await globalThis.sv2.storage.projects.open(id);
    return { ok: result.ok, code: result.code, text: result.text, exportRaw: typeof result.exportRaw };
  }, first);
  assert.deepEqual([answer.ok, answer.code, answer.exportRaw], [false, 'unreadable', 'function'], 'refused, with a way to export it as it is');
  assert.match(answer.text, /nothing has moved/);
  assert.equal(await page.evaluate(() => globalThis.__before), true, 'the page did not reload');
  assert.equal((await stateOf(page)).switching, false);
  assert.deepEqual(await current(page), record, 'current is as it was');
  assert.deepEqual(await shelfOf(page, first), shelfBefore, 'and so is the shelf record');
  assert.equal((await points(page)).length, pointsBefore, 'no recovery point was taken for a switch that did not happen');
  assert.equal((await stateOf(page)).id, second);
  await withActions(page);
  await rename(page, 'Still editable');
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.settings.schoolName), 'Still editable', 'the project can still be edited');
  // a record that is not a project at all is listed as unreadable, with its
  // export, and can be deleted (no recovery point can be made of it)
  await write(page, 'sv2', 'project', 'put', { savedAt: '2026-11-14T10:00:00.000Z', project: null, shelvedAt: '2026-11-14T10:00:00.000Z', bytes: 1, images: {} }, 'shelf:pdamaged01');
  const entry = (await ask(page, 'storage.projects.list()')).find((each) => each.id === 'pdamaged01');
  assert.deepEqual([entry.open, entry.unreadable, entry.exportRaw], [false, true, '[function]'], 'listed as unreadable, with a way to export it as it is');
  const refused = await ask(page, "storage.projects.open('pdamaged01')");
  assert.deepEqual([refused.ok, refused.code], [false, 'unreadable'], 'and never opened');
  const gone = await ask(page, "storage.projects.remove('pdamaged01', { exported: true })");
  assert.deepEqual([gone.ok, gone.pointKept, gone.pointKey], [true, false, null], 'deleted once exported, and the answer says no recovery point was kept');
  assert.deepEqual(await shelfKeys(page), ['shelf:' + first], 'only the damaged record went');
  // the one that failed validation is deleted too, when asked, and the answer says what it could keep
  const rest = await ask(page, 'storage.projects.remove(arg)', first);
  assert.equal(rest.ok, true);
  assert.deepEqual(await shelfKeys(page), [], 'the damaged record is gone');
});

// ---------------------------------------------------------------- duplicate and restore

test('duplicate: the label, a new id, publishing left unpublished, and its images copied so the original\'s delete does not take them', async () => {
  await freshDevice(page);
  const first = await projectId(page);
  await through(page, "storage.projects.startAnother('empty')");
  // give the open project a traced image
  await page.evaluate(async () => {
    const { storage, store } = globalThis.sv2;
    globalThis.sv2Actions = await import(new URL('engine/actions.js', document.baseURI).href);
    await storage.putImage('idupimage1', { blob: new Blob(['the picture']), type: 'image/png', width: 2, height: 2 });
    const project = store.project;
    const floors = project.building.floors.map((floor, index) => (index === 0
      ? { ...floor, image: { imageId: 'idupimage1', opacity: 0.4, scale: 1, rotation: 0, x: 0, y: 0, visible: true, locked: false, width: 2, height: 2, missing: false } }
      : floor));
    store.apply(globalThis.sv2Actions.replaceProject, { project: { ...project, label: 'This year', building: { ...project.building, floors } }, label: 'Test: image' });
  });
  await waitSaved(page);
  const original = await projectId(page);
  assert.deepEqual(await imageKeys(page), ['idupimage1']);
  const tooLong = await ask(page, "storage.projects.duplicate({ label: 'x'.repeat(61) })");
  assert.deepEqual([tooLong.ok, tooLong.code], [false, 'label'], 'a label past 60 characters is refused');
  await through(page, "storage.projects.duplicate({ label: 'Next year (a copy)' })");
  const copy = await current(page);
  assert.notEqual(copy.project.id, original, 'the copy has a new project id');
  assert.equal(copy.project.label, 'Next year (a copy)', 'and the label it was given');
  assert.equal(copy.project.publish.lastPublishedAt, null);
  assert.equal(copy.project.building.floors[0].image.imageId, 'idupimage1', 'it names the same picture');
  assert.ok(copy.project.created === copy.project.modified, 'created and modified are now');
  const kept = await shelfOf(page, original);
  assert.equal(kept.project.label, 'This year', 'the original is kept as it was');
  assert.deepEqual(Object.keys(kept.images), ['idupimage1'], 'and carries its own picture');
  assert.deepEqual(await imageKeys(page), ['idupimage1'], 'the copy\'s picture is in the images store');
  // the default label
  await through(page, 'storage.projects.duplicate()');
  assert.equal((await current(page)).project.label, 'Next year (a copy) (copy)', 'with no label given: "<label> (copy)"');
  // delete the original: the copies keep the picture
  const removed = await ask(page, 'storage.projects.remove(arg)', original);
  assert.equal(removed.ok, true);
  assert.deepEqual(await imageKeys(page), ['idupimage1'], 'the picture survives the original\'s delete');
  assert.equal(await page.evaluate(async () => (await globalThis.sv2.storage.getImage('idupimage1')).blob.size), 'the picture'.length);
  assert.ok(first !== original);
});

test('restore as a project: from a recovery point, and from a snapshot whose traced image is gone; a project that is open or kept is refused', async () => {
  await freshDevice(page);
  await page.evaluate(async () => {
    const { storage, store } = globalThis.sv2;
    globalThis.sv2Actions = await import(new URL('engine/actions.js', document.baseURI).href);
    await storage.putImage('irestimage1', { blob: new Blob(['restored picture']), type: 'image/png', width: 2, height: 2 });
    const project = store.project;
    const floors = project.building.floors.map((floor, index) => (index === 0
      ? { ...floor, image: { imageId: 'irestimage1', opacity: 0.4, scale: 1, rotation: 0, x: 0, y: 0, visible: true, locked: false, width: 2, height: 2, missing: false } }
      : floor));
    store.apply(globalThis.sv2Actions.replaceProject, { project: { ...project, building: { ...project.building, floors } }, label: 'Test: image' });
  });
  await waitSaved(page);
  const lost = await projectId(page);
  const snap = await page.evaluate(async () => {
    const { pageSnapshots } = await import(new URL('storage/snapshots.js', document.baseURI).href);
    const entry = await pageSnapshots().take('Before the switch');
    return entry.id;
  });
  // the open project is not restored as another one
  const isOpen = await ask(page, 'storage.projects.restoreAsProject(arg)', snap);
  assert.deepEqual([isOpen.ok, isOpen.code], [false, 'is-open']);
  await through(page, "storage.projects.startAnother('empty')");
  // kept on the shelf: Open it instead
  const held = await ask(page, 'storage.projects.restoreAsProject({ snapshot: arg })', snap);
  assert.deepEqual([held.ok, held.code, held.heldBy, held.id], [false, 'held', 'shelf', lost]);
  assert.equal(typeof held.label, 'string');
  // delete it, keeping the recovery point the delete took
  const removed = await ask(page, 'storage.projects.remove(arg)', lost);
  assert.equal(removed.ok, true);
  assert.equal(typeof removed.pointKey, 'number', 'the delete says which recovery point it took');
  await through(page, 'storage.projects.restoreAsProject(arg)', removed.pointKey);
  assert.equal(await projectId(page), lost, 'restored from the point, under its own id');
  assert.deepEqual(await imageKeys(page), ['irestimage1'], 'with its traced image, from the point\'s own bytes');
  assert.equal(await page.evaluate(async () => (await globalThis.sv2.storage.getImage('irestimage1')).blob.size), 'restored picture'.length);
  // again, from the snapshot, with the image gone from the device
  await through(page, "storage.projects.startAnother('empty')");
  const second = await ask(page, 'storage.projects.remove(arg)', lost);
  assert.equal(second.ok, true);
  await write(page, 'sv2', 'images', 'delete', undefined, 'irestimage1');
  assert.deepEqual(await imageKeys(page), [], 'the image is gone from this device');
  await page.evaluate(() => {
    globalThis.__before = true;
  });
  await page.evaluate((id) => {
    globalThis.sv2.storage.projects.restoreAsProject(id).then((result) => sessionStorage.setItem('test:answer', JSON.stringify(result)));
  }, snap);
  await loaded(page);
  assert.equal(await projectId(page), lost, 'the project is restored without its image');
  const answer = JSON.parse(await page.evaluate(() => sessionStorage.getItem('test:answer')));
  assert.equal(answer.ok, true);
  assert.equal(answer.imageGone, true, 'and the answer says an image is gone');
  assert.equal(answer.notes[0], IMAGE_GONE_SENTENCE, 'in the sentence the snapshots use');
  assert.deepEqual(await imageKeys(page), [], 'nothing was invented in its place');
});

test('holds, rename and remove: the label of a kept project, a rename that is not an undo step, a delete that keeps a recovery point', async () => {
  await freshDevice(page);
  const first = await projectId(page);
  const firstName = await page.evaluate(() => globalThis.sv2.store.project.settings.schoolName);
  await through(page, "storage.projects.startAnother('empty', undefined, { label: 'Next year' })");
  const second = await projectId(page);
  assert.equal(await ask(page, 'storage.projects.holds(arg)', first), firstName === '' ? 'Untitled project' : firstName, 'a kept project: its school name (it has no label)');
  assert.equal(await ask(page, 'storage.projects.holds(arg)', second), null, 'the open project\'s own id is not a refusal');
  assert.equal(await ask(page, "storage.projects.holds('pnothere01')"), null, 'a project that is not kept');
  const renamed = await ask(page, "storage.projects.rename(arg, '  This year  ')", first);
  assert.deepEqual([renamed.ok, renamed.label], [true, 'This year'], 'trimmed');
  assert.equal(await ask(page, 'storage.projects.holds(arg)', first), 'This year', 'the label is what a project goes by');
  assert.equal((await shelfOf(page, first)).project.label, 'This year');
  const long = await ask(page, "storage.projects.rename(arg, 'x'.repeat(61))", first);
  assert.deepEqual([long.ok, long.code], [false, 'label']);
  const open = await ask(page, "storage.projects.rename(arg, 'Nope')", second);
  assert.deepEqual([open.ok, open.code], [false, 'is-open'], 'the open project is renamed in its Label field');
  const missing = await ask(page, "storage.projects.rename('pnothere01', 'Nope')");
  assert.deepEqual([missing.ok, missing.code], [false, 'no-such-project']);
  const openRemove = await ask(page, 'storage.projects.remove(arg)', second);
  assert.deepEqual([openRemove.ok, openRemove.code], [false, 'is-open'], 'the open project cannot be deleted');
  const before = (await points(page)).length;
  const gone = await ask(page, 'storage.projects.remove(arg)', first);
  assert.equal(gone.ok, true);
  assert.equal(gone.label, 'This year');
  assert.deepEqual(await shelfKeys(page), [], 'the shelf is empty');
  assert.equal(await ask(page, 'storage.projects.holds(arg)', first), null);
  const after = await points(page);
  assert.equal(after.length, before + 1, 'a recovery point of it was kept first');
  assert.ok(after.some((point) => point.reason === 'replace' && point.project.label === 'This year'), 'the point is of the project that was deleted');
  assert.equal((await ask(page, 'storage.projects.list()')).length, 1);
});

// ---------------------------------------------------------------- refusals

test('while a switch is under way every call is refused and nothing is edited; a switch that fails gives everything back and saves the edit it held', async () => {
  await freshDevice(page);
  const first = await projectId(page);
  await through(page, "storage.projects.startAnother('empty')");
  const second = await projectId(page);
  await withActions(page);
  await waitSaved(page);
  const shelfBefore = await shelfOf(page, first);
  const answer = await page.evaluate(async (target) => {
    const { storage, store } = globalThis.sv2;
    const { hooks } = await import(new URL('storage/db.js', document.baseURI).href);
    hooks.failSwitchLate = true;
    let during = null;
    const stop = storage.subscribe((state, what) => {
      if (what !== 'switching' || !state.switching || during !== null) return;
      const projectBefore = store.project;
      store.apply(globalThis.sv2Actions.setSetting, { key: 'schoolName', value: 'Typed while switching' });
      const edited = store.project !== projectBefore;
      during = {
        edited,
        undo: store.undo(),
        calls: Promise.all([
          storage.projects.open(target),
          storage.projects.startAnother('empty'),
          storage.projects.duplicate(),
          storage.projects.rename(target, 'Nope'),
          storage.projects.remove(target),
          storage.projects.restoreAsProject(1),
        ]).then((results) => results.map((result) => [result.ok, result.code])),
        flag: state.switching,
      };
    });
    // an edit is pending as the switch starts
    store.apply(globalThis.sv2Actions.setSetting, { key: 'schoolName', value: 'Held edit' });
    const result = await storage.projects.open(target);
    stop();
    hooks.failSwitchLate = false;
    return { result: [result.ok, result.code], during: { edited: during.edited, undo: during.undo, flag: during.flag, calls: await during.calls } };
  }, first);
  assert.deepEqual(answer.during.calls, Array(6).fill([false, 'switching']), 'all six refused, with the word for it');
  assert.equal(answer.during.edited, false, 'store.apply changed nothing');
  assert.equal(answer.during.undo, null, 'and undo did nothing');
  assert.equal(answer.during.flag, true);
  assert.deepEqual(answer.result, [false, 'failed'], 'the stopped switch says it failed');
  const now = await stateOf(page);
  assert.equal(now.switching, false, 'the flag is down again');
  assert.equal(now.id, second, 'this page still shows the project it had');
  assert.deepEqual(await shelfOf(page, first), shelfBefore, 'nothing moved');
  assert.equal((await current(page)).project.id, second);
  // saving carries on, and the edit that was held is saved
  await waitSaved(page);
  assert.equal((await current(page)).project.settings.schoolName, 'Held edit', 'the edit made as the switch began was not lost when it failed');
  await rename(page, 'Editing again');
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.settings.schoolName), 'Editing again', 'the project is editable again');
  await waitSaved(page);
  assert.equal((await current(page)).project.settings.schoolName, 'Editing again');
});

test('a read-only tab: the six calls are refused with the word for it and nothing moves; list and holds still answer', async () => {
  await freshDevice(page);
  const first = await projectId(page);
  await through(page, "storage.projects.startAnother('empty')");
  const second = await projectId(page);
  await waitSaved(page);
  const sibling = await secondTab();
  assert.equal((await stateOf(sibling)).readOnly, true, 'the second tab is read-only');
  const keys = await shelfKeys(sibling);
  const results = await ask(sibling, `Promise.all([
    storage.projects.open(arg),
    storage.projects.startAnother('empty'),
    storage.projects.duplicate(),
    storage.projects.rename(arg, 'Nope'),
    storage.projects.remove(arg),
    storage.projects.restoreAsProject(1),
  ]).then((all) => all.map((result) => [result.ok, result.code, /read-only/.test(result.text)]))`, first);
  assert.deepEqual(results, Array(6).fill([false, 'read-only', true]));
  assert.deepEqual(await shelfKeys(sibling), keys, 'the shelf is as it was');
  assert.equal((await current(sibling)).project.id, second);
  assert.equal((await ask(sibling, 'storage.projects.list()')).length, 2, 'the list is still read');
  assert.equal(typeof (await ask(sibling, 'storage.projects.holds(arg)', first)), 'string', 'and so is holds');
  await sibling.close();
  extra.pop();
});

// ---------------------------------------------------------------- two tabs

test('a read-only sibling tab through a switch: the tab that switched is the editor after its reload, and the sibling stays read-only, with no bounce', async () => {
  await freshDevice(page);
  const first = await projectId(page);
  const sibling = await secondTab();
  assert.equal((await stateOf(sibling)).readOnly, true);
  assert.equal((await stateOf(page)).readOnly, false);
  await through(page, "storage.projects.startAnother('empty')");
  const second = await projectId(page);
  // The tab that switched is the editor and the sibling is read-only, whichever
  // of them asked for the lock first after the reload: a sibling that won it
  // gives it back at once and reloads (21.10 "The tab lock across a reload").
  await page.waitForFunction(() => globalThis.sv2.storage.state.readOnly === false, { timeout: 40000 });
  await sibling.waitForFunction(() => globalThis.sv2 !== undefined && document.documentElement.dataset.ready === 'true' && globalThis.sv2.storage.state.readOnly === true, { timeout: 40000 });
  const editor = await stateOf(page);
  const watcher = await stateOf(sibling);
  assert.equal(editor.readOnly, false, 'the tab that switched edits');
  assert.equal(editor.id, second);
  assert.equal(watcher.readOnly, true, 'the sibling does not');
  assert.ok([first, second].includes(watcher.id), 'and shows the project it had or the one it was handed, never anything else');
  // the editor still saves: nothing was bounced out of its lock
  await withActions(page);
  await rename(page, 'Edited after the switch');
  await waitSaved(page);
  assert.equal((await current(page)).project.settings.schoolName, 'Edited after the switch');
  await sibling.close();
  extra.pop();
});

test('a tab that becomes the editor over another project than the one it shows reloads instead of taking it in', async () => {
  await freshDevice(page);
  const first = await projectId(page);
  const sibling = await secondTab();
  assert.equal((await stateOf(sibling)).readOnly, true);
  assert.equal((await stateOf(sibling)).id, first);
  // the device now holds another project, put there long ago (no recent switch stamp)
  const saved = await current(page);
  const other = JSON.parse(JSON.stringify(saved.project));
  other.id = 'pelsewher1';
  other.settings.schoolName = 'Elsewhere';
  await write(page, 'sv2', 'project', 'put', { savedAt: '2026-11-14T12:00:00.000Z', project: other, exportedAt: null }, 'current');
  await sibling.evaluate(() => {
    globalThis.__before = true;
  });
  // this tab goes: its document unloads and the lock with it
  await page.goto('about:blank');
  // the lock is free; within a few seconds the sibling takes it, finds another project, and reloads
  await sibling.waitForFunction(() => globalThis.__before === undefined && globalThis.sv2 !== undefined && document.documentElement.dataset.ready === 'true'
    && document.querySelector('[data-pending="true"]') === null, { timeout: 60000 });
  const now = await stateOf(sibling);
  assert.equal(now.id, 'pelsewher1', 'it shows the project the device holds');
  assert.equal(now.readOnly, false, 'and, with the lock free, edits it');
  await sibling.close();
  extra.pop();
});

// ---------------------------------------------------------------- the review of SV2-116 (SV2-116b)
//
// One case for each item of the review: a switch that has committed is never
// given back; pagehide before the commit keeps the edit; a point is only
// applied over its own project; the boot with a shelf; the reconcile and its
// words; the pre-checks; the raw export; a lost lock during a switch; the
// failure sentences; the two small API additions. Where a case needs the page
// to stay (a reload that does not happen), the test replaces the page's reload
// (storage.setReload) and slows the move (storage.hooks.slowSwitch).

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const setHooks = (p, patch) => p.evaluate((values) => Object.assign(globalThis.sv2.storage.hooks, values), patch);
const clearHooks = (p) => setHooks(p, { failWrite: null, failImagePut: false, failSwitchLate: false, failSwitchRequest: false, slowSwitch: 0 });
const editSchool = (p, value) => p.evaluate((text) => {
  globalThis.sv2.store.apply(globalThis.sv2Actions.setSetting, { key: 'schoolName', value: text });
}, value);
const schoolOf = (p) => p.evaluate(() => globalThis.sv2.store.project.settings.schoolName);

// A device with a second project open and the first on the shelf, saved and with the page's actions.
async function twoProjects() {
  await freshDevice(page);
  await page.evaluate(() => localStorage.removeItem('sv2:tab'));
  const first = await projectId(page);
  await through(page, "storage.projects.startAnother('empty')");
  const second = await projectId(page);
  await withActions(page);
  await waitSaved(page);
  return { first, second };
}

// Downloads, caught instead of saved: [{ name, text }] in the page.
const captureDownloads = (p) => p.evaluate(() => {
  globalThis.__downloads = [];
  const make = URL.createObjectURL.bind(URL);
  const blobs = new Map();
  URL.createObjectURL = (blob) => {
    const url = make(blob);
    blobs.set(url, blob);
    return url;
  };
  HTMLAnchorElement.prototype.click = function click() {
    globalThis.__downloads.push({ name: this.download, blob: blobs.get(this.href) });
  };
});
const downloads = (p) => p.evaluate(() => Promise.all(globalThis.__downloads.map(async (each) => ({ name: each.name, text: await each.blob.text() }))));

// The planner, loaded from a page that holds no saved project, up to its boot dialog: the buttons' texts.
async function bootDialog() {
  await page.goto(session.url('#project'), { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('recovery-dialog') !== null, { timeout: 20000 });
  return page.evaluate(() => [...document.querySelectorAll('#recovery-dialog button')].map((button) => button.textContent));
}
async function choose(text) {
  await page.evaluate((wanted) => [...document.querySelectorAll('#recovery-dialog button')].find((button) => button.textContent === wanted).click(), text);
  await loaded(page);
}
// The device as a page that is not the planner finds it: `work` runs with no planner page open.
async function without(work) {
  await page.goto(session.base + '/404.html', { waitUntil: 'load' });
  await work();
}
const nameOf = async (id) => {
  const entry = (await ask(page, 'storage.projects.list()')).find((each) => each.id === id);
  return entry.label || entry.schoolName || 'Untitled project';
};

const clearPoints = (p) => p.evaluate(() => new Promise((resolve, reject) => {
  const open = indexedDB.open('sv2-recovery');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    const tx = db.transaction('recovery', 'readwrite');
    tx.objectStore('recovery').clear();
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
  };
}));

const aPoint = (project) => ({ takenAt: '2099-01-01T00:00:00.000Z', reason: 'timer', summary: { floors: 1, rooms: 0, groups: 0, teachers: 0 }, bytes: 1, project, images: {}, projectId: project.id });

test('item 1: a switch that has committed is never given back, whether a listener throws or the reload throws', async () => {
  for (const how of ['listener', 'reload']) {
    const { first, second } = await twoProjects();
    const answer = await page.evaluate(async (target, mode) => {
      const { storage, store } = globalThis.sv2;
      globalThis.__reloads = 0;
      storage.setReload(() => {
        globalThis.__reloads += 1;
        if (mode === 'reload') throw new Error('the reload was refused');
      });
      if (mode === 'listener') {
        storage.subscribe((state, what) => {
          if (what === 'switched') throw new Error('a card broke while drawing');
        });
      }
      store.apply(globalThis.sv2Actions.setSetting, { key: 'schoolName', value: 'Typed before the switch' });
      const result = await storage.projects.open(target);
      return { ok: result.ok, reloadFailed: result.reloadFailed === true, reloads: globalThis.__reloads, switching: storage.state.switching };
    }, first, how);
    assert.deepEqual([answer.ok, answer.reloadFailed, answer.reloads], [true, how === 'reload', 1], how + ': the switch is a success and the reload was asked for once');
    assert.equal(answer.switching, true, how + ': the page stays switching');
    const written = await current(page);
    assert.equal(written.project.id, first, how + ': the target is current');
    if (how === 'reload') {
      const banner = await page.evaluate(() => document.getElementById('banner-reload-needed')?.textContent || null);
      assert.match(banner, /^Reload the page to finish opening .+\.Reload this tab$/, 'the banner asks for the reload by hand, naming the project');
    }
    // every way the old project could be written back: a flush, a pagehide, a visibility change, time
    await page.evaluate(() => {
      globalThis.sv2.storage.flush();
      window.dispatchEvent(new Event('pagehide'));
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const apply = await page.evaluate(() => {
      const before = globalThis.sv2.store.project;
      globalThis.sv2.store.apply(globalThis.sv2Actions.setSetting, { key: 'schoolName', value: 'Typed after the switch' });
      return globalThis.sv2.store.project === before;
    });
    assert.equal(apply, true, how + ': the store still refuses edits');
    await sleep(1500);
    assert.deepEqual(await current(page), written, how + ': current is exactly what the switch wrote');
    assert.equal((await stateOf(page)).id, second, how + ': this page still shows the old project, frozen');
    assert.equal((await points(page)).filter((point) => point.reason === 'leave').length, 0, how + ': no leaving point either');
    assert.equal((await shelfOf(page, second)).project.settings.schoolName, 'Typed before the switch', how + ': the edit is on the shelf with the old project');
  }
});

test('item 2: a pagehide before the switch commits keeps the held edit (during the wait for the move, and as the switch begins)', async () => {
  // (a) the move waits; the page is going: the edit is saved at once, and the switch finds a newer save and gives back
  let { first, second } = await twoProjects();
  await page.evaluate((target) => {
    const { storage, store } = globalThis.sv2;
    storage.hooks.slowSwitch = 1500;
    store.apply(globalThis.sv2Actions.setSetting, { key: 'schoolName', value: 'Held at pagehide' });
    globalThis.__run = storage.projects.open(target).then((result) => ({ ok: result.ok, code: result.code }));
  }, first);
  await sleep(300);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  let seen = null;
  const start = Date.now();
  while (Date.now() - start < 900 && seen === null) {
    const saved = await current(page);
    if (saved.project.settings.schoolName === 'Held at pagehide') seen = saved;
    else await sleep(50);
  }
  assert.ok(seen, 'the leaving save wrote the held edit while the switch was still waiting to commit');
  assert.equal(seen.project.id, second, 'and the device still held the old project then');
  assert.deepEqual(await page.evaluate(() => globalThis.__run), { ok: false, code: 'conflict' }, 'the switch met the newer save and gave back');
  await clearHooks(page);
  assert.equal((await stateOf(page)).switching, false);
  // (b) the pagehide comes as the switch begins, before anything is awaited: the leaving save and point are made, and the switch then commits with the edit on the shelf
  ({ first, second } = await twoProjects());
  await page.evaluate((target) => {
    const { storage, store } = globalThis.sv2;
    globalThis.__reloads = 0;
    storage.setReload(() => {
      globalThis.__reloads += 1;
    });
    store.apply(globalThis.sv2Actions.setSetting, { key: 'schoolName', value: 'Held as it began' });
    const stop = storage.subscribe((state, what) => {
      if (what === 'switching' && state.switching) {
        stop();
        window.dispatchEvent(new Event('pagehide'));
      }
    });
    globalThis.__run = storage.projects.open(target).then((result) => result.ok);
  }, first);
  assert.equal(await page.evaluate(() => globalThis.__run), true);
  assert.equal(await page.evaluate(() => globalThis.__reloads), 1);
  const leave = (await points(page)).filter((point) => point.reason === 'leave' && point.project.id === second);
  assert.ok(leave.some((point) => point.project.settings.schoolName === 'Held as it began'), 'the leaving point holds the edit');
  assert.equal((await current(page)).project.id, first, 'and the switch still committed');
  assert.equal((await shelfOf(page, second)).project.settings.schoolName, 'Held as it began', 'with the edit on the shelf');
});

test('item 3: a point is applied only over its own project: a kept project\'s is refused with Open, one that is neither open nor kept with Restore as a project; switching and a refused apply are said', async () => {
  const { first, second } = await twoProjects();
  const rows = await ask(page, 'storage.listRecoveryPoints()');
  const own = rows.find((row) => row.projectId === first && row.reason === 'replace');
  assert.ok(own, 'the switch\'s point of the first project is listed');
  assert.equal(typeof own.label, 'string', 'listPoints rows carry the label');
  assert.ok(own.label.length > 0, 'the point\'s project\'s school name when it has no label');
  const before = (await points(page)).length;
  const held = await ask(page, 'storage.restoreRecoveryPointResult(arg)', own.key);
  assert.deepEqual([held.ok, held.code, held.heldBy, held.id], [false, 'held', 'shelf', first], 'a kept project\'s point: Open it');
  assert.equal(await ask(page, 'storage.restoreRecoveryPoint(arg)', own.key), false, 'the boolean call says no');
  const removed = await ask(page, 'storage.projects.remove(arg)', first);
  assert.equal(removed.ok, true);
  const afterRemove = (await points(page)).length;
  const gone = await ask(page, 'storage.restoreRecoveryPointResult(arg)', own.key);
  assert.deepEqual([gone.ok, gone.code, gone.id], [false, 'other-project', first], 'a project neither open nor kept: Restore as a project');
  assert.match(gone.text, /Restore it as a project of its own/);
  assert.deepEqual(gone.action, { label: 'Restore as a project', run: '[function]' }, 'with the call that does it');
  assert.equal((await stateOf(page)).id, second, 'the open project is the one it was');
  assert.equal((await points(page)).length, afterRemove, 'no restore point was taken for a point that was not applied');
  assert.ok(afterRemove >= before);
  // the open project's own point is restored
  await editSchool(page, 'Edited, then restored');
  const key = await ask(page, "storage.takeRecoveryPoint('timer')");
  await editSchool(page, 'Edited again');
  assert.deepEqual(await ask(page, 'storage.restoreRecoveryPointResult(arg)', key), { ok: true });
  assert.equal(await schoolOf(page), 'Edited, then restored');
  // the store does not take it: said, and false
  const refused = await page.evaluate(async (pointKey) => {
    const { storage, store } = globalThis.sv2;
    const keep = store.apply;
    store.apply = () => store.project;
    try {
      const result = await storage.restoreRecoveryPointResult(pointKey);
      return { ok: result.ok, code: result.code };
    } finally {
      store.apply = keep;
    }
  }, key);
  assert.deepEqual(refused, { ok: false, code: 'refused' });
  // a switch begins during the restore (as its own point is taken): nothing is applied
  const during = await page.evaluate(async (pointKey) => {
    const { storage, store } = globalThis.sv2;
    storage.setReload(() => {});
    const stop = storage.subscribe((state, what) => {
      if (what === 'points') {
        stop();
        storage.projects.duplicate();
      }
    });
    const result = await storage.restoreRecoveryPointResult(pointKey);
    return { ok: result.ok, code: result.code, school: store.project.settings.schoolName };
  }, key);
  assert.deepEqual([during.ok, during.code], [false, 'switching']);
});

test('item 4: with the saved project gone, the shelf record chosen at boot becomes current in one move', async () => {
  const { first } = await twoProjects();
  const name = await nameOf(first);
  const record = await shelfOf(page, first);
  await without(async () => {
    await write(page, 'sv2', 'project', 'delete', undefined, 'current');
    await clearPoints(page);
  });
  const buttons = await bootDialog();
  assert.ok(buttons.includes('Open ' + name));
  await choose('Open ' + name);
  assert.equal((await stateOf(page)).id, first);
  const saved = await current(page);
  assert.equal(saved.project.id, first, 'the shelved project is current');
  assert.equal(typeof saved.openedAt, 'string');
  assert.deepEqual(saved.project, record.project, 'as it was kept');
  assert.deepEqual(await shelfKeys(page), [], 'and its shelf key went in the same move');
  assert.equal((await stateOf(page)).opened.id, first);
});

test('item 4: a second copy of the open project that is the same to the letter needs no point and no note; the shelf key just goes', async () => {
  const { first, second } = await twoProjects();
  const saved = await current(page);
  await write(page, 'sv2', 'project', 'put', { savedAt: saved.savedAt, project: saved.project, exportedAt: saved.exportedAt, shelvedAt: saved.savedAt, bytes: 1, images: {} }, 'shelf:' + second);
  const before = (await points(page)).filter((point) => point.reason === 'replace' && point.project.id === second).length;
  await page.reload({ waitUntil: 'load' });
  await loaded(page);
  assert.equal((await stateOf(page)).reconciled, null, 'no note');
  assert.deepEqual(await shelfKeys(page), ['shelf:' + first], 'the redundant key is gone');
  assert.equal((await points(page)).filter((point) => point.reason === 'replace' && point.project.id === second).length, before, 'and no point was added');
});

test('item 5: the note says which copy is newer and where the other went; a copy that cannot be kept is said in a banner with both copies as files', async () => {
  const { first, second } = await twoProjects();
  const own = await current(page);
  const other = async (patch) => {
    const copy = JSON.parse(JSON.stringify(await shelfOf(page, first)));
    copy.project.id = second;
    copy.project.settings.schoolName = 'The other copy';
    patch(copy.project);
    await write(page, 'sv2', 'project', 'put', copy, 'shelf:' + second);
  };
  const cases = [
    ['2000-01-01T00:00:00.000Z', /^Two copies of .+ were kept; the older one is in Recovery points\.$/],
    [own.project.modified, /^Two different copies of .+ were kept, and their times do not say which is newer\. The other one is in Recovery points\.$/],
    ['2099-01-01T00:00:00.000Z', /^Two copies of .+ were kept\. The other one was edited later than the one that is open; it is in Recovery points, where it can be restored\.$/],
  ];
  for (const [modified, words] of cases) {
    await other((project) => {
      project.modified = modified;
    });
    await page.reload({ waitUntil: 'load' });
    if (modified.startsWith('2099')) {
      // the newer copy is a recovery point of this very project, so the boot offers it
      await page.waitForFunction(() => document.getElementById('recovery-dialog') !== null, { timeout: 20000 });
      await choose('Keep the saved project');
    }
    await loaded(page);
    assert.match((await stateOf(page)).reconciled, words, modified);
    assert.ok((await points(page)).some((point) => point.reason === 'replace' && point.project.id === second && point.project.settings.schoolName === 'The other copy'), 'the other copy is a point');
    assert.deepEqual(await shelfKeys(page), ['shelf:' + first]);
    assert.equal((await current(page)).project.settings.schoolName, own.project.settings.schoolName, 'the open project was not overwritten');
  }
  // a copy no point can be made of: said, with both copies as files, and kept where it is
  await clearPoints(page); // the newer one just kept would be offered at this boot
  await other((project) => {
    project.building = { floors: 5 };
  });
  await page.reload({ waitUntil: 'load' });
  await loaded(page);
  assert.equal((await stateOf(page)).reconciled, null, 'no note of a reconcile that did not happen');
  const banner = await page.evaluate(() => ({ text: document.getElementById('banner-reconcile-failed')?.textContent || null, buttons: [...document.querySelectorAll('#banner-reconcile-failed button')].map((button) => button.textContent) }));
  assert.match(banner.text, /could not be put in Recovery points/);
  assert.deepEqual(banner.buttons, ['Export both copies']);
  assert.deepEqual(await shelfKeys(page), ['shelf:' + first, 'shelf:' + second].sort(), 'the second copy is still kept');
  await captureDownloads(page);
  await page.evaluate(() => document.querySelector('#banner-reconcile-failed button').click());
  await page.waitForFunction(() => globalThis.__downloads.length >= 2, { timeout: 10000 });
  const files = await downloads(page);
  assert.equal(JSON.parse(files[1].text).project.building.floors, 5, 'the second copy as it is');
  assert.match(files[0].name, / - project - /, 'the open project as a project file');
});

test('item 6: refused attempts add no recovery point: a full shelf eight times, and a second copy of the open project on the shelf', async () => {
  const { first, second } = await twoProjects();
  const record = await shelfOf(page, first);
  for (let n = 0; n < 18; n += 1) {
    const copy = JSON.parse(JSON.stringify(record));
    copy.project.id = 'pfill' + String(n).padStart(4, '0');
    await write(page, 'sv2', 'project', 'put', copy, 'shelf:' + copy.project.id);
  }
  assert.equal((await shelfKeys(page)).length, 19, 'the shelf is at its limit');
  const before = (await points(page)).length;
  const codes = [];
  for (let n = 0; n < 8; n += 1) codes.push((await ask(page, "storage.projects.startAnother('empty')")).code);
  codes.push((await ask(page, 'storage.projects.duplicate()')).code);
  assert.deepEqual(codes, Array(9).fill('limit'));
  assert.equal((await points(page)).length, before, 'the open project\'s points are as they were');
  assert.equal((await stateOf(page)).switching, false);
  // a second copy of the open project on the shelf
  await write(page, 'sv2', 'project', 'delete', undefined, 'shelf:pfill0000');
  await write(page, 'sv2', 'project', 'put', { ...record, project: { ...record.project, id: second } }, 'shelf:' + second);
  const refused = await ask(page, 'storage.projects.open(arg)', first);
  assert.deepEqual([refused.ok, refused.code], [false, 'shelf-has-open']);
  assert.equal((await points(page)).length, before, 'still no point');
});

// a record written with traced pictures (a Blob cannot cross from the test)
const putWithPictures = (p, key, record, pictures) => p.evaluate((args) => new Promise((resolve, reject) => {
  const images = {};
  for (const [id, text] of Object.entries(args.pictures)) images[id] = { blob: new Blob([text]), type: 'image/png', width: 2, height: 2 };
  const open = indexedDB.open('sv2');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    const tx = db.transaction('project', 'readwrite');
    tx.objectStore('project').put({ ...args.record, images }, args.key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  };
}), { key, record, pictures });

test('item 7: an unreadable shelf record is exported whole, pictures as base64, even with no project or one that is not an object; deleting one no point can be made of needs the export first', async () => {
  const { first } = await twoProjects();
  await captureDownloads(page);
  const shape = { savedAt: '2026-11-14T10:00:00.000Z', shelvedAt: '2026-11-14T10:00:00.000Z', bytes: 1, exportedAt: null };
  await putWithPictures(page, 'shelf:pnoproject1', shape, { ipicture001: 'the picture' });
  await putWithPictures(page, 'shelf:pnotobject1', { ...shape, project: 'not a project' }, {});
  const entries = await ask(page, 'storage.projects.list()');
  assert.deepEqual(entries.filter((entry) => entry.unreadable).map((entry) => entry.id).sort(), ['pnoproject1', 'pnotobject1']);
  assert.equal(await ask(page, "storage.projects.list().then((all) => all.find((entry) => entry.id === 'pnoproject1').exportRaw())"), true);
  let files = await downloads(page);
  assert.match(files[0].name, /^Unreadable project pnoproject1 - record - \d{4}-\d\d-\d\d\.json$/, 'a record that says nothing of its school goes by its key');
  const whole = JSON.parse(files[0].text);
  assert.equal(whole.savedAt, shape.savedAt, 'the whole record');
  assert.equal('project' in whole, false, 'with no project, as it was');
  assert.deepEqual([whole.images.ipicture001.data, whole.images.ipicture001.type], [btoa('the picture'), 'image/png'], 'the picture as base64');
  assert.equal(await ask(page, "storage.projects.list().then((all) => all.find((entry) => entry.id === 'pnotobject1').exportRaw())"), true);
  files = await downloads(page);
  assert.equal(JSON.parse(files[1].text).project, 'not a project');
  assert.match(files[1].name, /^Unreadable project pnotobject1 - record - /, 'a project that is not an object: the file name does not throw');
  // a record that is a project with a part missing: open() refuses with the same export
  const damaged = JSON.parse(JSON.stringify(await shelfOf(page, first)));
  delete damaged.project.groups;
  await write(page, 'sv2', 'project', 'put', damaged, 'shelf:' + first);
  assert.equal(await ask(page, "storage.projects.open(arg).then((result) => result.exportRaw())", first), true);
  files = await downloads(page);
  assert.equal(JSON.parse(files[2].text).project.id, first);
  // delete: no point can be made of a record with no project
  const before = (await points(page)).length;
  const refused = await ask(page, "storage.projects.remove('pnoproject1')");
  assert.deepEqual([refused.ok, refused.code, refused.needs, refused.exportRaw], [false, 'unreadable', 'exported', '[function]']);
  assert.ok((await shelfKeys(page)).includes('shelf:pnoproject1'), 'still kept');
  assert.equal((await points(page)).length, before);
  const done = await ask(page, "storage.projects.remove('pnoproject1', { exported: true })");
  assert.deepEqual([done.ok, done.pointKept], [true, false]);
  assert.ok(!(await shelfKeys(page)).includes('shelf:pnoproject1'));
});

test('item 8: with the saved project gone, a shelved project\'s points are offered as Open, never Restore; the sample school on the shelf is what "Start with the sample school" opens', async () => {
  const { first } = await twoProjects();
  const name = await nameOf(first);
  const shelved = await shelfOf(page, first);
  await without(async () => {
    await write(page, 'sv2', 'project', 'delete', undefined, 'current');
    await clearPoints(page);
    await write(page, 'sv2-recovery', 'recovery', 'put', aPoint({ ...shelved.project, modified: '2099-01-01T00:00:00.000Z' }));
  });
  const buttons = await bootDialog();
  assert.ok(buttons.includes('Open ' + name), 'the project is offered to open');
  assert.ok(buttons.includes('Start with the sample school'));
  assert.equal(buttons.filter((text) => /^Restore the recovery point/.test(text)).length, 0, 'its point is not offered as a Restore');
  await choose('Open ' + name);
  assert.equal((await stateOf(page)).id, first);
  assert.deepEqual(await shelfKeys(page), [], 'in one place');
  // a point of a project that is not kept is still offered
  const again = await twoProjects();
  const keptName = await nameOf(again.first);
  const kept = await shelfOf(page, again.first);
  await without(async () => {
    await write(page, 'sv2', 'project', 'delete', undefined, 'current');
    await clearPoints(page);
    await write(page, 'sv2-recovery', 'recovery', 'put', aPoint({ ...kept.project, id: 'pnotkept01', modified: '2099-01-01T00:00:00.000Z' }));
  });
  const both = await bootDialog();
  assert.ok(both.some((text) => /^Restore the recovery point/.test(text)), 'a point of a project not kept anywhere is a Restore');
  assert.ok(both.includes('Open ' + keptName));
  await choose(both.find((text) => /^Restore the recovery point/.test(text)));
  assert.equal((await stateOf(page)).id, 'pnotkept01');
  assert.deepEqual(await shelfKeys(page), ['shelf:' + again.first], 'the kept project is still kept');
  // the sample on the shelf
  await freshDevice(page);
  await through(page, "storage.projects.startAnother('empty')");
  assert.deepEqual(await shelfKeys(page), ['shelf:psample001']);
  await without(async () => {
    await write(page, 'sv2', 'project', 'delete', undefined, 'current');
    await clearPoints(page);
  });
  await bootDialog();
  await choose('Start with the sample school');
  assert.equal((await stateOf(page)).id, 'psample001', 'the kept sample school is what it opens');
  assert.equal((await current(page)).project.id, 'psample001');
  assert.deepEqual(await shelfKeys(page), [], 'and it is kept in one place only');
});

test('item 9: the shelf record\'s exportedAt is the session\'s, even when no save has written it to current yet', async () => {
  const { first, second } = await twoProjects();
  assert.equal((await current(page)).exportedAt, null);
  const stamp = await page.evaluate((target) => {
    globalThis.__before = true;
    const { storage } = globalThis.sv2;
    storage.noteExported();
    const at = storage.state.exportedAt;
    storage.projects.open(target);
    return at;
  }, first);
  await loaded(page);
  assert.match(stamp, /^\d{4}-/);
  assert.equal((await shelfOf(page, second)).exportedAt, stamp, 'the shelf record carries when it was exported');
});

test('item 10: hold and pause are two flags: a resume while a switch holds the saves keeps what is owed, and a release never lifts a pause', async () => {
  const seen = await page.evaluate(async () => {
    const { createAutosave } = await import(new URL('storage/autosave.js', document.baseURI).href);
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    let writes = 0;
    const saver = createAutosave({ write: async () => { writes += 1; return 'at'; }, delay: 5, maxWait: 20, retry: 50 });
    saver.changed();
    saver.hold();
    saver.resume();
    const owed = saver.pending;
    await wait(60);
    const whileHeld = writes;
    saver.release();
    await wait(60);
    const afterRelease = writes;
    saver.pause();
    saver.changed();
    saver.hold();
    saver.release();
    await wait(60);
    const whilePaused = writes;
    saver.resume();
    return { owed, whileHeld, afterRelease, whilePaused, pendingAfterResume: saver.pending };
  });
  assert.deepEqual(seen, { owed: true, whileHeld: 0, afterRelease: 1, whilePaused: 1, pendingAfterResume: false });
});

test('review: a hold with a failing save in flight, then release, saves the held edit once the disk works', async () => {
  const { first } = await twoProjects();
  await page.evaluate(async (target) => {
    const { storage, store } = globalThis.sv2;
    storage.hooks.failWrite = 'Disk full';
    store.apply(globalThis.sv2Actions.setSetting, { key: 'schoolName', value: 'Edit with a failing disk' });
    await storage.flush();
    if (storage.state.save !== 'failed') throw new Error('the save did not fail: this test proves nothing');
    // the disk comes back as the failed switch is given back
    const stop = storage.subscribe((state, what) => {
      if (what === 'switching' && !state.switching) {
        stop();
        storage.hooks.failWrite = null;
      }
    });
    const result = await storage.projects.open(target);
    if (result.ok) throw new Error('the switch should have been refused');
  }, first);
  await page.waitForFunction(() => globalThis.sv2.storage.state.save === 'saved' && !globalThis.sv2.storage.pending, { timeout: 15000 });
  assert.equal((await current(page)).project.settings.schoolName, 'Edit with a failing disk', 'the held edit was saved after the release');
  assert.equal(await page.evaluate(() => document.getElementById('banner-save-failed')), null, 'and the banner is gone');
});

test('review: while a switch holds the saves a page that is hidden flushes nothing; the release saves it', async () => {
  const { first } = await twoProjects();
  await page.evaluate((target) => {
    const { storage, store } = globalThis.sv2;
    storage.hooks.slowSwitch = 1200;
    storage.hooks.failSwitchLate = true;
    store.apply(globalThis.sv2Actions.setSetting, { key: 'schoolName', value: 'Edit while held' });
    globalThis.__run = storage.projects.open(target).then((result) => result.code);
  }, first);
  await sleep(250);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await sleep(300);
  assert.notEqual((await current(page)).project.settings.schoolName, 'Edit while held', 'nothing was written while the switch held the saves');
  assert.equal(await page.evaluate(() => globalThis.__run), 'failed');
  await page.evaluate(() => {
    delete document.visibilityState;
    globalThis.sv2.storage.hooks.slowSwitch = 0;
    globalThis.sv2.storage.hooks.failSwitchLate = false;
  });
  await page.waitForFunction(() => globalThis.sv2.storage.state.save === 'saved' && !globalThis.sv2.storage.pending, { timeout: 15000 });
  assert.equal((await current(page)).project.settings.schoolName, 'Edit while held', 'the release saved it');
});

// A tab with no Web Locks, so the localStorage heartbeat decides who edits.
async function locklessTab() {
  const browser = session.browser;
  let tab;
  let context = null;
  if (browser.__engine === 'playwright') {
    context = await browser.newContext();
    tab = await context.newPage();
    tab.evaluateOnNewDocument = (fn) => tab.addInitScript(fn);
  } else {
    tab = await browser.newPage();
  }
  await tab.evaluateOnNewDocument(() => {
    Object.defineProperty(Navigator.prototype, 'locks', { configurable: true, get: () => undefined });
  });
  const entry = { close: async () => (context ? context.close() : tab.close()) };
  extra.push(entry);
  return { tab, entry };
}

test('item 10 and the heartbeat: without Web Locks the beat decides, a second tab is read-only, a switch works through the reload, and a beat lost during a failed switch is applied', async () => {
  await freshDevice(page);
  await page.evaluate(() => localStorage.removeItem('sv2:tab'));
  await page.goto('about:blank');
  const { tab, entry } = await locklessTab();
  await tab.goto(session.url('#project'), { waitUntil: 'load' });
  await loaded(tab);
  await withActions(tab);
  const kind = await tab.evaluate(() => ({ tabs: globalThis.sv2.storage.state.tabs, readOnly: globalThis.sv2.storage.state.readOnly, beat: JSON.parse(localStorage.getItem('sv2:tab')) }));
  assert.deepEqual([kind.tabs, kind.readOnly, typeof kind.beat.tabId], ['heartbeat', false, 'string'], 'the beat is the fallback and this tab holds it');
  // a second tab with no locks is read-only while the beat is fresh
  const second = await locklessTab();
  await second.tab.goto(session.url('#project'), { waitUntil: 'load' });
  await second.tab.waitForFunction(() => globalThis.sv2 !== undefined && document.documentElement.dataset.ready === 'true', { timeout: 40000 });
  assert.equal((await stateOf(second.tab)).readOnly, true);
  assert.equal((await ask(second.tab, 'storage.projects.duplicate()')).code, 'read-only');
  await second.entry.close();
  extra.splice(extra.indexOf(second.entry), 1);
  // a switch through the reload: the tab is the editor again afterwards
  const first = await projectId(tab);
  await through(tab, "storage.projects.startAnother('empty')");
  await withActions(tab);
  const after = await stateOf(tab);
  assert.equal(after.readOnly, false, 'the switched tab edits');
  assert.equal((await tab.evaluate(() => globalThis.sv2.storage.state.tabs)), 'heartbeat');
  // another tab takes the beat while a switch is under way, and the switch fails
  const result = await tab.evaluate(async (target) => {
    const { storage } = globalThis.sv2;
    storage.hooks.slowSwitch = 2800;
    storage.hooks.failSwitchLate = true;
    const run = storage.projects.open(target);
    localStorage.setItem('sv2:tab', JSON.stringify({ tabId: 'another-tab', at: Date.now() }));
    const answer = await run;
    storage.hooks.slowSwitch = 0;
    storage.hooks.failSwitchLate = false;
    return { ok: answer.ok, readOnly: storage.state.readOnly, switching: storage.state.switching, banner: document.getElementById('banner-read-only') !== null };
  }, first);
  assert.deepEqual(result, { ok: false, readOnly: true, switching: false, banner: true }, 'the lost beat was applied when the switch gave back');
  await entry.close();
  extra.splice(extra.indexOf(entry), 1);
});

test('item 11: a shelf record kept under another project\'s id is refused when opened and at boot; the failure sentences say what was being done', async () => {
  const { first } = await twoProjects();
  const wrong = JSON.parse(JSON.stringify(await shelfOf(page, first)));
  wrong.project.label = 'Wrongly keyed';
  await write(page, 'sv2', 'project', 'put', wrong, 'shelf:pwrongkey01');
  const before = (await points(page)).length;
  const refused = await page.evaluate(async () => {
    const result = await globalThis.sv2.storage.projects.open('pwrongkey01');
    return { ok: result.ok, code: result.code, text: result.text, exportRaw: typeof result.exportRaw };
  });
  assert.deepEqual([refused.ok, refused.code, refused.exportRaw], [false, 'unreadable', 'function']);
  assert.match(refused.text, /nothing has moved/);
  assert.equal((await points(page)).length, before, 'no point for a move that did not happen');
  // the failure sentences name what was being done
  for (const [what, call] of [['opened', 'storage.projects.open(arg)'], ['started', "storage.projects.startAnother('empty')"], ['duplicated', 'storage.projects.duplicate()']]) {
    await setHooks(page, { failWrite: 'Disk full' });
    const one = await ask(page, call, first);
    await clearHooks(page);
    assert.deepEqual([one.ok, one.code], [false, 'failed']);
    assert.match(one.text, new RegExp('^The project was not ' + what + ', and nothing has moved\\. Disk full\\.$'));
  }
  // another tab saved in between
  const saved = await current(page);
  await write(page, 'sv2', 'project', 'put', { ...saved, savedAt: '2099-01-01T00:00:00.000Z' }, 'current');
  const conflict = await ask(page, 'storage.projects.open(arg)', first);
  assert.deepEqual([conflict.ok, conflict.code], [false, 'conflict']);
  assert.match(conflict.text, /so the project was not opened and nothing has moved\./);
  // at boot
  await without(async () => {
    await write(page, 'sv2', 'project', 'delete', undefined, 'current');
    await clearPoints(page);
  });
  const buttons = await bootDialog();
  assert.ok(buttons.includes('Open Wrongly keyed'));
  const shelfBefore = await shelfKeys(page);
  await choose('Open Wrongly keyed');
  assert.equal(await current(page), null, 'nothing was made current');
  assert.deepEqual(await shelfKeys(page), shelfBefore, 'and nothing left the shelf');
});

test('item 11: a duplicate holds the edit made before the call and refuses one made after it', async () => {
  const { second } = await twoProjects();
  const answer = await page.evaluate(async () => {
    const { storage, store } = globalThis.sv2;
    storage.setReload(() => {});
    store.apply(globalThis.sv2Actions.setSetting, { key: 'schoolName', value: 'Before the duplicate' });
    const run = storage.projects.duplicate({ label: 'The copy' });
    const unchanged = store.project;
    store.apply(globalThis.sv2Actions.setSetting, { key: 'schoolName', value: 'After the duplicate' });
    const refused = store.project === unchanged;
    const result = await run;
    return { ok: result.ok, refused };
  });
  assert.deepEqual(answer, { ok: true, refused: true });
  assert.equal((await current(page)).project.settings.schoolName, 'Before the duplicate', 'the copy has the edit');
  assert.equal((await shelfOf(page, second)).project.settings.schoolName, 'Before the duplicate', 'and so does the original');
});

test('item 12: points are listed with their project and label; exportShelved writes a project file with its pictures, is refused while switching, answers in a read-only tab, and refuses what cannot be read', async () => {
  const { first, second } = await twoProjects();
  const rows = await ask(page, 'storage.listRecoveryPoints()');
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.equal(typeof row.projectId, 'string');
    assert.equal(typeof row.label, 'string');
  }
  assert.ok(rows.some((row) => row.projectId === first && row.label !== ''), 'the point of the first project says whose it is');
  // a shelved project with a traced picture
  const record = await shelfOf(page, first);
  record.project.building.floors[0].image = { imageId: 'ishelved001', opacity: 0.4, scale: 1, rotation: 0, x: 0, y: 0, visible: true, locked: false, width: 2, height: 2, missing: false };
  await putWithPictures(page, 'shelf:' + first, record, { ishelved001: 'shelved picture' });
  await captureDownloads(page);
  const done = await ask(page, 'storage.projects.exportShelved(arg)', first);
  assert.equal(done.ok, true);
  assert.match(done.fileName, / - project - \d{4}-\d\d-\d\d\.json$/, 'the project file\'s name');
  const files = await downloads(page);
  assert.equal(files[0].name, done.fileName);
  const file = JSON.parse(files[0].text);
  assert.equal(file.building.floors[0].image.data, btoa('shelved picture'), 'the picture is inside, as base64');
  assert.equal(file.building.floors[0].image.type, 'image/png');
  assert.equal((await ask(page, 'storage.projects.exportShelved(arg)', second)).code, 'is-open');
  assert.equal((await ask(page, "storage.projects.exportShelved('pnothere01')")).code, 'no-such-project');
  const damaged = JSON.parse(JSON.stringify(record));
  delete damaged.project.groups;
  damaged.project.id = 'pdamaged02';
  await write(page, 'sv2', 'project', 'put', damaged, 'shelf:pdamaged02');
  const bad = await ask(page, "storage.projects.exportShelved('pdamaged02')");
  assert.deepEqual([bad.ok, bad.code, bad.exportRaw], [false, 'unreadable', '[function]']);
  // a read-only tab may export
  const sibling = await secondTab();
  assert.equal((await ask(sibling, 'storage.projects.exportShelved(arg)', first)).ok, true, 'a read-only tab can export a shelved project');
  await sibling.close();
  extra.pop();
  // refused while a switch is under way
  const during = await page.evaluate(async (target) => {
    const { storage } = globalThis.sv2;
    storage.hooks.failSwitchLate = true;
    let answer = null;
    const stop = storage.subscribe((state, what) => {
      if (what === 'switching' && state.switching && answer === null) answer = storage.projects.exportShelved(target).then((result) => [result.ok, result.code]);
    });
    await storage.projects.open(target);
    stop();
    storage.hooks.failSwitchLate = false;
    return answer;
  }, first);
  assert.deepEqual(during, [false, 'switching']);
});

test('SV2-123: read(id) gives a kept project through open()\'s path, writes nothing, answers in a read-only tab, and refuses the open project, a missing one, an unreadable one and a switch under way', async () => {
  const { first, second } = await twoProjects();
  const before = await idb(page, 'sv2', 'project', 'keys');
  const done = await ask(page, 'storage.projects.read(arg)', first);
  assert.equal(done.ok, true);
  assert.equal(done.project.id, first, 'the kept project, not the open one');
  assert.equal(typeof done.images, 'object');
  assert.deepEqual(await idb(page, 'sv2', 'project', 'keys'), before, 'nothing was written, nothing taken off the shelf');
  assert.equal((await ask(page, 'storage.projects.read(arg)', second)).code, 'is-open');
  assert.equal((await ask(page, "storage.projects.read('pnothere01')")).code, 'no-such-project');
  const record = await shelfOf(page, first);
  const damaged = JSON.parse(JSON.stringify(record));
  delete damaged.project.groups;
  damaged.project.id = 'pdamaged03';
  await write(page, 'sv2', 'project', 'put', damaged, 'shelf:pdamaged03');
  const bad = await ask(page, "storage.projects.read('pdamaged03')");
  assert.deepEqual([bad.ok, bad.code], [false, 'unreadable']);
  assert.match(bad.text, /so it was not read\./, 'the sentence is about reading, not opening');
  const sibling = await secondTab();
  assert.equal((await ask(sibling, 'storage.projects.read(arg)', first)).ok, true, 'a read-only tab can read a kept project');
  await sibling.close();
  extra.pop();
  const during = await page.evaluate(async (target) => {
    const { storage } = globalThis.sv2;
    storage.hooks.failSwitchLate = true;
    let answer = null;
    const stop = storage.subscribe((state, what) => {
      if (what === 'switching' && state.switching && answer === null) answer = storage.projects.read(target).then((result) => [result.ok, result.code]);
    });
    await storage.projects.open(target);
    stop();
    storage.hooks.failSwitchLate = false;
    return answer;
  }, first);
  assert.deepEqual(during, [false, 'switching']);
});
