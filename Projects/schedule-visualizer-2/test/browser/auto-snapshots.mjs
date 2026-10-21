// The automatic snapshots inside sections (SV2-28b), in a real browser with
// a real IndexedDB: node test/browser/auto-snapshots.mjs
//
// At 1280 by 900 on the sample school: clearing a floor (the Floor tab's
// Clear), a resize that cuts something off and applying a scenario of more
// than SCENARIO_SNAPSHOT_SLOTS slots each change the project at once and
// then keep a snapshot of the project from before, which restores it; a
// resize that cuts nothing and a scenario at the limit keep none. With no
// room for a snapshot (the limit reached, saves failing, a read-only second
// tab) the change is still made and its message says why no snapshot was
// kept. Then db.js: a save's sweep spares an image only a quarantined record
// names, and an image a restore put back is swept once the restore is undone
// inside the autosave's wait and nothing names it. Then at 390 by 844 with
// touch, a floor cleared by finger.
//
// Every wait is on a state the page sets: the panel's or the lab's
// data-snapshot ('taking', then 'taken' or 'not-taken'), the save indicator,
// an open dialog, the Snapshots card's data-snapshots.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, startServer, launch } from './harness.mjs';
import { SCENARIO_SNAPSHOT_SLOTS } from '../../ui/scenarios/model.js';
import { SNAPSHOT_LIMIT } from '../../storage/snapshots.js';

let server;
let browser;
let session;
let page;

before(async () => {
  server = await startServer();
  browser = await launch();
  session = await openPlanner({ hash: '#building', server, browser, width: 1280, height: 900 });
  page = session.page;
  await editable(page);
  await page.evaluate(async () => {
    globalThis.sv2Actions = await import(new URL('engine/actions.js', document.baseURI).href);
    globalThis.sv2Snapshots = await import(new URL('storage/snapshots.js', document.baseURI).href);
  });
});

after(async () => {
  if (session) await session.close();
  if (browser) await browser.close();
  if (server) await server.close();
});

// ---------------------------------------------------------------- helpers

function editable(target) {
  return target.waitForFunction(() => globalThis.sv2 && globalThis.sv2.storage && globalThis.sv2.storage.state.available && !globalThis.sv2.storage.state.readOnly, { timeout: 15000 });
}

const shows = (fn, ...args) => page.waitForFunction(fn, { timeout: 10000 }, ...args);
const text = (selector, target) => (target || page).$eval(selector, (el) => el.textContent);
const project = (target) => (target || page).evaluate(() => JSON.parse(JSON.stringify(globalThis.sv2.store.project)));
const entries = (target) => (target || page).evaluate(() => globalThis.sv2.store.history.past.length);
const waitSaved = (target) => (target || page).waitForFunction(() => document.getElementById('save-indicator').dataset.state === 'saved' && !globalThis.sv2.storage.pending, { timeout: 10000 });

// Every record in a store of the `sv2` database, as stored (images: keys).
function idb(storeName, target) {
  return (target || page).evaluate((name) => new Promise((resolve, reject) => {
    const open = indexedDB.open('sv2');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(name, 'readonly');
      const all = name === 'images' ? tx.objectStore(name).getAllKeys() : tx.objectStore(name).getAll();
      all.onsuccess = () => {
        db.close();
        resolve(all.result);
      };
      all.onerror = () => reject(all.error);
    };
  }), storeName);
}

// Run fn(tx, value) on the raw `sv2` database in one readwrite transaction.
function rawWrite(stores, fn, arg, target) {
  return (target || page).evaluate(({ names, source, value }) => new Promise((resolve, reject) => {
    const open = indexedDB.open('sv2');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(names, 'readwrite');
      // eslint-disable-next-line no-new-func
      new Function('tx', 'value', source)(tx, value);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => reject(tx.error);
    };
  }), { names: stores, source: '(' + fn.toString() + ')(tx, value)', value: arg === undefined ? null : arg });
}

// The snapshots stored, oldest first, as { name, project }.
async function snapshots(target) {
  const all = await idb('snapshots', target);
  return all.sort((a, b) => (a.takenAt < b.takenAt ? -1 : a.takenAt > b.takenAt ? 1 : 0)).map((record) => ({ id: record.id, name: record.name, project: record.project }));
}

const toastText = (target) => (target || page).evaluate(() => Array.from(document.querySelectorAll('.toast .toast__text')).map((el) => el.textContent).pop() || null);
async function dismissToasts(target) {
  await (target || page).evaluate(() => document.querySelectorAll('.toast__close').forEach((button) => button.click()));
}

// The Floor tab of floor `index` (0-based), drawn.
async function floorTab(index, target) {
  const p = target || page;
  await p.evaluate((at) => document.querySelectorAll('.bld-floors__tab')[at].click(), index);
  await p.waitForFunction((at) => {
    const tab = document.querySelectorAll('.bld-floors__tab')[at];
    return tab && tab.getAttribute('aria-selected') === 'true';
  }, { timeout: 10000 }, index);
  await p.click('#inspector [data-tab="floor"]');
  await p.waitForSelector('#inspector-floor');
}

// The panel's snapshot is done one way or the other; resolves with which.
async function panelSnapshot(target) {
  const p = target || page;
  await p.waitForFunction(() => {
    const state = document.getElementById('inspector-floor').dataset.snapshot;
    return state === 'taken' || state === 'not-taken';
  }, { timeout: 15000 });
  return p.$eval('#inspector-floor', (el) => el.dataset.snapshot);
}

async function resetPanel(target) {
  await (target || page).evaluate(() => {
    delete document.getElementById('inspector-floor').dataset.snapshot;
  });
}

async function retype(selector, typed) {
  await page.click(selector, { clickCount: 3 });
  await page.keyboard.type(typed);
}

// ---------------------------------------------------------------- clear a floor

test('Clear on the Floor tab says what it removes and keeps, clears the floor at once, then keeps a snapshot from before it', async () => {
  await floorTab(1);
  assert.equal(await text('#floor-clear'), 'Clear Floor 2');
  assert.equal(await text('#floor-clear-says'), 'Removes everything drawn on Floor 2: 5 rooms, 3 other spaces, 38 corridor cells, 2 stairs cells, 1 corridor name and 2 stairs connections.');
  assert.match(await text('#floor-clear-keeps'), /^The floor stays, empty, with its name, level, size, traced image and the areas left out of the colour scale\./);
  const start = await project();
  const had = (await snapshots()).length;
  const before = await entries();
  await resetPanel();
  await page.click('#floor-clear');
  // on screen at once: the words beside the button and the rooms list follow
  // the cleared floor before any snapshot is written
  assert.equal(await text('#floor-clear-says'), 'Nothing is drawn on Floor 2, so there is nothing to clear.');
  assert.equal(await page.$eval('#floor-clear', (el) => el.getAttribute('aria-disabled')), 'true');
  assert.equal(await entries(), before + 1, 'one undo step');
  const cleared = (await project()).building.floors[1];
  assert.equal(cleared.cells, '.'.repeat(cleared.width * cleared.height));
  assert.deepEqual(cleared.spaces, []);
  assert.equal(await panelSnapshot(), 'taken');
  const kept = await snapshots();
  assert.equal(kept.length, had + 1);
  const snapshot = kept[kept.length - 1];
  assert.equal(snapshot.name, 'Before clearing Floor 2');
  assert.deepEqual(snapshot.project.building, start.building, 'the snapshot is the project from before the clear');
  await shows(() => /^Cleared Floor 2, which removed 5 rooms, /.test(Array.from(document.querySelectorAll('.toast .toast__text')).pop()?.textContent || ''));
  assert.match(await toastText(), / The snapshot “⁨Before clearing Floor 2⁩” has what was there\.$/);

  // the snapshot restores what was cleared
  await page.evaluate((id) => globalThis.sv2Snapshots.pageSnapshots().restore(id), snapshot.id);
  assert.deepEqual((await project()).building, start.building);
  // and undo goes back over the restore, then over the clear
  await page.click('#undo');
  assert.deepEqual((await project()).building.floors[1].spaces, []);
  await page.click('#undo');
  assert.deepEqual((await project()).building, start.building);
  await dismissToasts();
});

test('Clear with nothing drawn changes nothing and says so', async () => {
  const empty = await page.evaluate(() => {
    const { store } = globalThis.sv2;
    store.apply(globalThis.sv2Actions.addFloor, {});
    return store.project.building.floors.length;
  });
  await floorTab(empty - 1);
  await resetPanel();
  const before = await entries();
  const had = (await snapshots()).length;
  await page.click('#floor-clear');
  assert.equal(await entries(), before);
  assert.match(await text('#floor-clear-says'), /^Nothing is drawn on .+, so there is nothing to clear\.$/);
  assert.equal(await page.$eval('#inspector-floor', (el) => el.dataset.snapshot), undefined, 'no snapshot asked for');
  await page.click('#undo');
  assert.equal((await snapshots()).length, had);
});

// ---------------------------------------------------------------- resize

test('a resize that cuts nothing keeps no snapshot; one that cuts something off keeps one from before it, after the change is on screen', async () => {
  await floorTab(0);
  const had = (await snapshots()).length;
  // growing cuts nothing: no question, no snapshot
  await retype('#floor-height', '20');
  assert.equal(await text('#floor-size-preview'), 'Floor 1 would be 40 × 20 squares. Nothing drawn would be cut off.');
  await resetPanel();
  await page.click('#floor-resize');
  assert.equal((await project()).building.floors[0].height, 20);
  assert.equal(await page.$eval('#inspector-floor', (el) => el.dataset.snapshot), undefined, 'a resize with no loss asks for no snapshot');
  const start = await project();

  // cutting the width to 20 at the right removes rooms
  await retype('#floor-width', '20');
  assert.match(await text('#floor-size-preview'), /That would cut off /);
  await page.click('#floor-resize');
  await page.waitForSelector('#resize-dialog[open]');
  await page.click('#resize-dialog .btn--danger');
  await shows(() => document.querySelector('dialog.dialog[open]') === null);
  assert.equal((await project()).building.floors[0].width, 20, 'resized on screen without waiting for the snapshot');
  assert.equal(await panelSnapshot(), 'taken');
  const kept = await snapshots();
  assert.equal(kept.length, had + 1, 'one snapshot: the lossless resize took none');
  assert.equal(kept[kept.length - 1].name, 'Before resizing Floor 1 to 20 × 20');
  assert.deepEqual(kept[kept.length - 1].project.building, start.building);
  await shows(() => /^Resized Floor 1 to 20 by 20, which removed .+ The snapshot “⁨Before resizing Floor 1 to 20 × 20⁩” has what was there\.$/.test(Array.from(document.querySelectorAll('.toast .toast__text')).pop()?.textContent || ''));
  await page.click('#undo');
  await page.click('#undo');
  assert.equal((await project()).building.floors[0].width, 40);
  await dismissToasts();
});

// ---------------------------------------------------------------- a scenario

// A scenario of n moves on distinct slots of the base day, opened as one.
async function scenarioOf(n, name) {
  await page.evaluate(({ count, title }) => {
    const { store } = globalThis.sv2;
    const A = globalThis.sv2Actions;
    const p = store.project;
    const day = p.dayTypes[0].id;
    const rooms = p.building.floors.flatMap((floor) => floor.spaces.filter((space) => space.kind === 'room'));
    store.apply(A.newScenario, { name: title, replace: true });
    let made = 0;
    for (const group of p.groups) {
      for (let period = 0; period < p.settings.periods && made < count; period += 1) {
        const slot = group.days[day][period];
        const room = rooms.find((each) => each.id !== slot.room);
        store.apply(A.addScenarioChange, { change: { kind: 'move', dayTypeId: day, groupId: group.id, period, roomId: room.id } });
        made += 1;
      }
    }
  }, { count: n, title: name });
}

async function applyFromLab() {
  await page.evaluate(() => globalThis.sv2.navigate('#scenarios'));
  await page.waitForSelector('.scn [data-action="apply"]', { visible: true });
  await page.evaluate(() => {
    delete document.querySelector('.scn').dataset.snapshot;
  });
  await page.click('.scn [data-action="apply"]');
  await page.waitForSelector('#scenario-apply[open]');
}

test('applying a scenario of SCENARIO_SNAPSHOT_SLOTS slots keeps no snapshot; one more slot keeps one from before, after the schedule changed', async () => {
  const had = (await snapshots()).length;
  await scenarioOf(SCENARIO_SNAPSHOT_SLOTS, 'At the limit');
  await applyFromLab();
  assert.equal(await page.$('#scenario-apply [data-part="snapshot"]'), null, 'the summary promises no snapshot');
  await page.click('#scenario-apply .btn--primary');
  await shows(() => globalThis.sv2.store.project.scenario === null);
  assert.equal(await page.$eval('.scn', (el) => el.dataset.snapshot), undefined, 'none asked for');

  await scenarioOf(SCENARIO_SNAPSHOT_SLOTS + 1, 'Move <7th> grade');
  const start = await project();
  await applyFromLab();
  assert.equal(await text('#scenario-apply [data-part="snapshot"]'), 'It changes ' + (SCENARIO_SNAPSHOT_SLOTS + 1) + ' periods of the groups\' days, so a snapshot of the project as it is now is kept as well, and can be restored from Snapshots in the Project section.');
  await page.click('#scenario-apply .btn--primary');
  // the schedule changed and the scenario closed before the snapshot is kept
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.scenario), null);
  await page.waitForFunction(() => ['taken', 'not-taken'].includes(document.querySelector('.scn').dataset.snapshot), { timeout: 15000 });
  assert.equal(await page.$eval('.scn', (el) => el.dataset.snapshot), 'taken');
  const kept = await snapshots();
  assert.equal(kept.length, had + 1, 'one snapshot: the apply at the limit took none');
  assert.equal(kept[kept.length - 1].name, 'Before applying the scenario “Move <7th> grade”');
  assert.deepEqual(kept[kept.length - 1].project.groups, start.groups);
  assert.equal(kept[kept.length - 1].project.scenario.name, 'Move <7th> grade');
  await shows(() => /^Applied “Move <7th> grade”: 11 changes made to the schedule\. The snapshot “⁨Before applying the scenario “Move <7th> grade”⁩” has what was there\.$/.test(Array.from(document.querySelectorAll('.toast .toast__text')).pop()?.textContent || ''));
  await page.evaluate(() => globalThis.sv2.ctx.undo());
  assert.deepEqual((await project()).groups, start.groups);
  await page.evaluate(() => globalThis.sv2.store.apply(globalThis.sv2Actions.discardScenario, {}));
  await dismissToasts();
  await page.evaluate(() => globalThis.sv2.navigate('#building'));
  await page.waitForSelector('.bld');
});

// ---------------------------------------------------------------- no room

test('with the device at its limit the floor is still cleared at once, and the message says no snapshot was kept and why', async () => {
  const have = (await snapshots()).length;
  await rawWrite(['snapshots'], (tx, value) => {
    for (let i = value.from; i < value.to; i += 1) tx.objectStore('snapshots').put({ id: 'nfill' + String(i).padStart(5, '0'), name: 'Filler ' + i, takenAt: '2026-01-01T00:00:00.000Z', bytes: 2, project: {} });
  }, { from: have, to: SNAPSHOT_LIMIT });
  await floorTab(2);
  const before = await entries();
  await resetPanel();
  await page.click('#floor-clear');
  assert.equal(await entries(), before + 1, 'cleared at once');
  assert.equal(await panelSnapshot(), 'not-taken');
  assert.equal((await snapshots()).length, SNAPSHOT_LIMIT, 'none replaced');
  await shows(() => /^Cleared Floor 3, which removed .+ No snapshot was taken, because this device already keeps 30, the most it keeps\. Undo brings it back while this tab stays open\.$/.test(Array.from(document.querySelectorAll('.toast .toast__text')).pop()?.textContent || ''));
  assert.equal(await page.$('dialog.dialog[open]'), null, 'nothing asked');
  await page.click('#undo');
  await rawWrite(['snapshots'], (tx) => {
    const store = tx.objectStore('snapshots');
    const keys = store.getAllKeys();
    keys.onsuccess = () => keys.result.filter((id) => id.startsWith('nfill')).forEach((id) => store.delete(id));
  });
  await dismissToasts();
});

test('with saves failing the resize still happens, and the message says the snapshot could not be kept', async () => {
  await floorTab(0);
  await page.evaluate(() => {
    globalThis.sv2.storage.hooks.failWrite = 'QuotaExceededError: the device is full';
  });
  try {
    await retype('#floor-width', '20');
    await resetPanel();
    await page.click('#floor-resize');
    await page.waitForSelector('#resize-dialog[open]');
    await page.click('#resize-dialog .btn--danger');
    await shows(() => document.querySelector('dialog.dialog[open]') === null);
    assert.equal((await project()).building.floors[0].width, 20);
    assert.equal(await panelSnapshot(), 'not-taken');
    await shows(() => /^Resized Floor 1 to 20 by 14, which removed .+ No snapshot was taken, because the project could not be saved first, .+ Undo brings it back while this tab stays open\.$/.test(Array.from(document.querySelectorAll('.toast .toast__text')).pop()?.textContent || ''));
  } finally {
    await page.evaluate(() => {
      globalThis.sv2.storage.hooks.failWrite = null;
    });
  }
  await page.click('#undo');
  await waitSaved();
  await dismissToasts();
});

test('a read-only second tab refuses the clear itself, so no snapshot is asked for', async () => {
  await waitSaved();
  const had = (await snapshots()).length;
  const other = await openPlanner({ hash: '#building', server, browser, keep: true });
  try {
    const second = other.page;
    await second.waitForFunction(() => globalThis.sv2 && globalThis.sv2.storage.state.readOnly, { timeout: 15000 });
    await floorTab(1, second);
    await resetPanel(second);
    const start = await project(second);
    await second.click('#floor-clear');
    await second.waitForFunction(() => /^Nothing changed: this tab is read-only/.test(Array.from(document.querySelectorAll('.toast .toast__text')).pop()?.textContent || ''), { timeout: 10000 });
    assert.deepEqual((await project(second)).building, start.building, 'the store refuses every change in a read-only tab');
    assert.equal(await second.$eval('#inspector-floor', (el) => el.dataset.snapshot), undefined, 'no snapshot asked for a change that was not made');
    assert.equal((await snapshots(second)).length, had);
  } finally {
    await other.close();
  }
});

// ---------------------------------------------------------------- db.js

test('a save that sweeps images spares one only a quarantined record names, and takes one nothing names', async () => {
  await rawWrite(['images', 'quarantine'], (tx) => {
    tx.objectStore('images').put({ blob: new Blob(['q']), type: 'image/png', width: 1, height: 1 }, 'iquarant01');
    tx.objectStore('images').put({ blob: new Blob(['o']), type: 'image/png', width: 1, height: 1 }, 'iorphan001');
    tx.objectStore('quarantine').add({ at: '2026-01-01T00:00:00.000Z', raw: { savedAt: 'x', project: { building: { floors: [{ image: { imageId: 'iquarant01' } }] } } }, error: 'unreadable' });
  });
  // a change of the images the project names makes the save sweep
  await page.evaluate(() => globalThis.sv2.storage.putImage('isweep0001', { blob: new Blob(['s']), type: 'image/png', width: 2, height: 2 }));
  await page.evaluate(() => {
    const { store } = globalThis.sv2;
    store.apply(globalThis.sv2Actions.setTraceImage, { floorId: store.project.building.floors[0].id, image: { imageId: 'isweep0001', width: 2, height: 2 } });
  });
  await waitSaved();
  const images = await idb('images');
  assert.equal(images.includes('iorphan001'), false, 'the save swept: an image nothing names is gone');
  assert.equal(images.includes('iquarant01'), true, 'an image only a quarantined record names stays');
  assert.equal(images.includes('isweep0001'), true);
});

test('an image a restore put back is swept once the restore is undone inside the autosave\'s wait and nothing names it', async () => {
  // isweep0001 is on Floor 1 and saved; a snapshot names it; then it is taken off
  const snapshot = await page.evaluate(() => globalThis.sv2Snapshots.pageSnapshots().take('With the picture'));
  await page.evaluate(() => {
    const { store } = globalThis.sv2;
    store.apply(globalThis.sv2Actions.setTraceImage, { floorId: store.project.building.floors[0].id, image: null });
  });
  await waitSaved();
  assert.ok((await idb('images')).includes('isweep0001'), 'the snapshot names it: kept');
  // restore puts its images back through the session, and Undo comes at once
  await page.evaluate(async (id) => {
    await globalThis.sv2Snapshots.pageSnapshots().restore(id);
    globalThis.sv2.ctx.undo();
  }, snapshot.id);
  assert.equal((await project()).building.floors[0].image, null);
  await waitSaved();
  // deleting the snapshot sweeps: nothing names the image now
  await page.evaluate((id) => globalThis.sv2Snapshots.pageSnapshots().remove(id), snapshot.id);
  assert.equal((await idb('images')).includes('isweep0001'), false, 'swept with the snapshot, not held as fresh until a reload');
  await dismissToasts();
});

test('a snapshot of a project from before a change is refused when an image it names is no longer stored, and the change is not undone', async () => {
  const had = (await snapshots()).length;
  const answer = await page.evaluate(() => {
    const before = JSON.parse(JSON.stringify(globalThis.sv2.store.project));
    before.building.floors[0].image = { imageId: 'igone00001', width: 2, height: 2, opacity: 0.4, scale: 1, rotation: 0, x: 0, y: 0, visible: true, locked: false, missing: false };
    return globalThis.sv2Snapshots.snapshotAfter('resize', 'Before a picture went', before);
  });
  assert.deepEqual(answer, { taken: false, snapshot: null, code: 'image-gone', said: 'No snapshot was taken: a traced image the project named before this change is no longer kept on this device, so a snapshot of it would be missing that image. Undo brings it back while this tab stays open.' });
  assert.equal((await snapshots()).length, had);
});

// ---------------------------------------------------------------- a phone

test('on a phone with touch, a floor is cleared by finger, at once, with a snapshot kept', async () => {
  // its own server, so its own origin: its own IndexedDB and tab lock
  const phone = await openPlanner({ hash: '#building', browser, width: 390, height: 844, mobile: true });
  try {
    const p = phone.page;
    await editable(p);
    await p.evaluate(async () => {
      globalThis.sv2Snapshots = await import(new URL('storage/snapshots.js', document.baseURI).href);
    });
    await p.evaluate(() => document.querySelectorAll('.bld-floors__tab')[1].click());
    await p.waitForFunction(() => document.querySelectorAll('.bld-floors__tab')[1].getAttribute('aria-selected') === 'true');
    // on a phone the inspector is a sheet, shut until asked for
    if (await p.$eval('#inspector', (el) => el.dataset.open) !== 'true') await p.tap('#inspector-toggle');
    await p.waitForSelector('#inspector [data-tab="floor"]', { visible: true });
    await p.tap('#inspector [data-tab="floor"]');
    await p.waitForSelector('#inspector-floor');
    await p.$eval('#floor-clear', (el) => el.scrollIntoView({ block: 'center' }));
    const box = await p.$eval('#floor-clear', (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, height: r.height, width: window.innerWidth };
    });
    assert.ok(box.left >= 0 && box.right <= box.width, 'Clear is inside the screen: ' + JSON.stringify(box));
    assert.ok(box.height >= 44, 'Clear is a finger\'s height: ' + box.height);
    await p.tap('#floor-clear');
    assert.deepEqual((await project(p)).building.floors[1].spaces, []);
    assert.equal(await panelSnapshot(p), 'taken');
    const kept = await snapshots(p);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].name, 'Before clearing Floor 2');
  } finally {
    await phone.close();
  }
});
