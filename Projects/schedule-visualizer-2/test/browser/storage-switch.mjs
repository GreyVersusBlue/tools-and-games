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

test('the names: sessionStorage sv2:opened, the eight calls of projects, the three flags of state', async () => {
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
  assert.deepEqual(seen.calls, ['duplicate', 'holds', 'list', 'open', 'remove', 'rename', 'restoreAsProject', 'startAnother']);
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
