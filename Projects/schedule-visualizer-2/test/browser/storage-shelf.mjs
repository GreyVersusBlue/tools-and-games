// Several projects on one device, the database layer, in a real browser with a
// real IndexedDB: node test/browser/storage-shelf.mjs
//
// storage/db.js's shelf (ARCHITECTURE 21.4 and 21.10): the open project stays
// at "current", every other one is a record "shelf:<id>" carrying its traced
// images inside itself. The journey, in order: the names; two projects each
// with a traced image switched there and back twice with every picture intact,
// and once more after the image sweep ran on its own; a switch that fails
// (the write hook, and an abort after every write) leaves both where they
// were; the refusals; delete, rename and the list; the images a caller holds
// that the store lacks; a duplicate's shared image ids surviving the
// original's delete; the recovery trim across three projects; the tab lock's
// grace for a tab left behind by a switch (plain Node).
//
// Every case works on its own pair of databases, opened through a wrapper that
// renames them, so the page's own autosave never touches the records under
// test. Every wait is on a promise the code under test returns, never on a
// first paint or a sleep.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, waitForSection } from './harness.mjs';
import { OPENED_GRACE_MS, switchedAway } from '../../storage/tabs.js';

let session;
let page;

before(async () => {
  session = await openPlanner({ hash: '#project' });
  page = session.page;
  await waitForSection(page, 'project');
  // the lab: fresh databases per case, small projects with pictures, and a
  // reading of everything stored, as plain data
  await page.evaluate(async () => {
    const db = await import(new URL('storage/db.js', document.baseURI).href);
    const recovery = await import(new URL('storage/recovery.js', document.baseURI).href);
    let era = 0;
    let ticks = 0;
    let opened = null;
    const factory = { open: (name, version) => indexedDB.open('lab' + era + '-' + name, version) };
    const clock = () => new Date(Date.parse('2026-11-14T10:00:00.000Z') + (ticks += 1) * 1000);
    const lab = {
      db,
      recovery,
      get handle() {
        return opened;
      },
      async fresh() {
        if (opened) opened.close();
        era += 1;
        opened = await db.openDatabases({ indexedDB: factory, clock });
        return opened;
      },
      image: (text) => ({ blob: new Blob([text]), type: 'image/png', width: 2, height: 2 }),
      project: (id, label, imageIds) => ({
        id,
        label,
        settings: { schoolName: 'School ' + id },
        building: { floors: (imageIds.length ? imageIds : [null]).map((imageId, index) => ({ id: 'f' + index, spaces: [{ kind: 'room' }], image: imageId ? { imageId } : null })) },
        groups: [{}, {}],
        teachers: [{}],
      }),
      // put the project on the device as the open one, with its pictures
      async seed(project, pictures) {
        const held = new Map();
        for (const [id, text] of Object.entries(pictures || {})) {
          held.set(id, lab.image(text));
          await opened.putImage(id, held.get(id));
        }
        const known = await opened.saveProject(project, null, { images: held });
        return { known, held };
      },
      // every record in the main database as plain data; blobs as their text
      async everything() {
        const tx = opened.main.transaction(['project', 'images', 'snapshots', 'quarantine'], 'readonly');
        const all = (name) => new Promise((resolve, reject) => {
          const out = {};
          const request = tx.objectStore(name).openCursor();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const at = request.result;
            if (!at) {
              resolve(out);
              return;
            }
            out[at.key] = at.value;
            at.continue();
          };
        });
        const [project, images] = await Promise.all([all('project'), all('images')]);
        const text = async (value) => (value && value.blob ? { text: await value.blob.text(), type: value.type } : value);
        const plain = { current: null, shelf: {}, images: {} };
        for (const [key, record] of Object.entries(project)) {
          if (key === 'current') plain.current = { id: record.project.id, savedAt: record.savedAt, openedAt: record.openedAt || null, exportedAt: record.exportedAt };
          else {
            const pictures = {};
            for (const [id, value] of Object.entries(record.images)) pictures[id] = (await text(value)).text;
            plain.shelf[key] = { id: record.project.id, label: record.project.label, shelvedAt: record.shelvedAt, savedAt: record.savedAt, bytes: record.bytes, pictures };
          }
        }
        for (const [id, value] of Object.entries(images)) plain.images[id] = (await text(value)).text;
        return plain;
      },
      async refusal(promise) {
        try {
          await promise;
        } catch (error) {
          return { name: error.name, code: error.code || null, message: error.message, type: error instanceof TypeError };
        }
        return null;
      },
    };
    globalThis.lab = lab;
  });
});

after(async () => {
  if (session) await session.close();
});

// ---------------------------------------------------------------- in the browser

test('the names the shelf is kept under, and what it is bounded by', async () => {
  const seen = await page.evaluate(() => {
    const { db, recovery } = globalThis.lab;
    return {
      prefix: db.SHELF_PREFIX,
      most: db.PROJECTS_MOST,
      each: db.OTHER_POINTS_EACH,
      points: db.OTHER_POINTS_MOST,
      keep: db.RECOVERY_KEEP,
      version: db.DB_VERSION,
      recoveryVersion: db.RECOVERY_DB_VERSION,
      reexport: recovery.projectBytes === db.projectBytes,
    };
  });
  assert.deepEqual(seen, { prefix: 'shelf:', most: 20, each: 3, points: 24, keep: 8, version: 1, recoveryVersion: 1, reexport: true }, 'no store was added and no version moved');
  const stores = await page.evaluate(async () => {
    const handle = await globalThis.lab.fresh();
    return { main: Array.from(handle.main.objectStoreNames), version: handle.main.version };
  });
  assert.deepEqual(stores, { main: ['images', 'project', 'quarantine', 'snapshots'], version: 1 });
});

test('two projects with a traced image each, switched there and back twice: every image intact, and once more after the sweep ran on its own', async () => {
  const result = await page.evaluate(async () => {
    const { db } = globalThis.lab;
    const handle = await globalThis.lab.fresh();
    const a = globalThis.lab.project('pa', 'This year', ['iaaaa']);
    const b = globalThis.lab.project('pb', 'Next year', ['ibbbb']);
    const seeded = await globalThis.lab.seed(a, { iaaaa: 'bytes of A' });
    // B is made as another project: started beside A, which goes on the shelf
    const bHeld = new Map([['ibbbb', globalThis.lab.image('bytes of B')]]);
    let known = await handle.shelveAndStart(a, b, seeded.known, { images: seeded.held, freshImages: bHeld });
    const log = [await globalThis.lab.everything()];
    // there and back, twice (the session passes the open project's held images)
    const heldNow = { pa: seeded.held, pb: bHeld };
    let open = 'pb';
    for (let round = 0; round < 4; round += 1) {
      const target = open === 'pb' ? 'pa' : 'pb';
      const openProject = open === 'pb' ? b : a;
      known = await handle.switchTo(target, openProject, known, { images: heldNow[open] });
      open = target;
      log.push(await globalThis.lab.everything());
    }
    // the sweep on its own, naming only what "current" names, as an older planner's does
    await new Promise((resolve, reject) => {
      const tx = handle.main.transaction(['snapshots', 'quarantine', 'images'], 'readwrite');
      db.sweepUnnamedImages(tx, [open === 'pa' ? 'iaaaa' : 'ibbbb']);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    log.push(await globalThis.lab.everything());
    // and once more: both ways again, the session not holding the images this time (the store is asked)
    for (let round = 0; round < 2; round += 1) {
      const target = open === 'pb' ? 'pa' : 'pb';
      known = await handle.switchTo(target, open === 'pb' ? b : a, known, { images: new Map() });
      open = target;
      log.push(await globalThis.lab.everything());
    }
    return { log, open };
  });
  const [afterStart, ...rest] = result.log;
  assert.equal(afterStart.current.id, 'pb');
  assert.deepEqual(Object.keys(afterStart.shelf), ['shelf:pa']);
  assert.deepEqual(afterStart.shelf['shelf:pa'].pictures, { iaaaa: 'bytes of A' }, 'the shelved project carries its picture inside its record');
  assert.deepEqual(afterStart.images, { ibbbb: 'bytes of B' }, 'the images store holds only what the open project names');
  const states = rest.map((entry) => ({ open: entry.current.id, shelf: Object.keys(entry.shelf), images: entry.images, shelved: Object.values(entry.shelf).map((one) => one.pictures) }));
  const A = 'bytes of A';
  const B = 'bytes of B';
  assert.deepEqual(states, [
    { open: 'pa', shelf: ['shelf:pb'], images: { iaaaa: A }, shelved: [{ ibbbb: B }] },
    { open: 'pb', shelf: ['shelf:pa'], images: { ibbbb: B }, shelved: [{ iaaaa: A }] },
    { open: 'pa', shelf: ['shelf:pb'], images: { iaaaa: A }, shelved: [{ ibbbb: B }] },
    { open: 'pb', shelf: ['shelf:pa'], images: { ibbbb: B }, shelved: [{ iaaaa: A }] },
    { open: 'pb', shelf: ['shelf:pa'], images: { ibbbb: B }, shelved: [{ iaaaa: A }] },
    { open: 'pa', shelf: ['shelf:pb'], images: { iaaaa: A }, shelved: [{ ibbbb: B }] },
    { open: 'pb', shelf: ['shelf:pa'], images: { ibbbb: B }, shelved: [{ iaaaa: A }] },
  ]);
  assert.equal(result.open, 'pb');
  // current was stamped by the switch, for the tab lock
  const stamped = rest[0].current;
  assert.equal(stamped.openedAt, stamped.savedAt, 'openedAt is the switch\'s own savedAt');
  // rest[4] is the reading after the sweep, which is no switch: same savedAt as rest[3]
  assert.ok(rest.every((entry, index) => index === 0 || (index === 4 ? entry.current.savedAt === rest[3].current.savedAt : entry.current.savedAt > rest[index - 1].current.savedAt)), 'each switch gives current a later savedAt, and the sweep gives it none');
  assert.ok(rest[0].shelf['shelf:pb'].shelvedAt, 'a shelf record says when it was shelved');
  assert.ok(rest[0].shelf['shelf:pb'].bytes > 'bytes of B'.length, 'and what it weighs, pictures included');
});

test('a switch that fails leaves both projects where they were, whether the write is refused or the transaction stops after its writes', async () => {
  const result = await page.evaluate(async () => {
    const { db } = globalThis.lab;
    const handle = await globalThis.lab.fresh();
    const a = globalThis.lab.project('pa', 'This year', ['iaaaa']);
    const b = globalThis.lab.project('pb', 'Next year', ['ibbbb']);
    const seeded = await globalThis.lab.seed(a, { iaaaa: 'bytes of A' });
    const bHeld = new Map([['ibbbb', globalThis.lab.image('bytes of B')]]);
    const known = await handle.shelveAndStart(a, b, seeded.known, { images: seeded.held, freshImages: bHeld });
    const before = await globalThis.lab.everything();
    const out = { before };
    db.hooks.failWrite = 'The disk is full.';
    out.early = await globalThis.lab.refusal(handle.switchTo('pa', b, known, { images: bHeld }));
    out.earlyStart = await globalThis.lab.refusal(handle.shelveAndStart(b, globalThis.lab.project('pc', 'C', []), known, { images: bHeld }));
    db.hooks.failWrite = null;
    out.afterEarly = await globalThis.lab.everything();
    db.hooks.failSwitchLate = true;
    out.late = await globalThis.lab.refusal(handle.switchTo('pa', b, known, { images: bHeld }));
    out.lateStart = await globalThis.lab.refusal(handle.shelveAndStart(b, globalThis.lab.project('pc', 'C', ['icccc']), known, { images: bHeld, freshImages: new Map([['icccc', globalThis.lab.image('bytes of C')]]) }));
    db.hooks.failSwitchLate = false;
    out.afterLate = await globalThis.lab.everything();
    // and the same switch works once the fault is gone: the failure left nothing in the way
    await handle.switchTo('pa', b, known, { images: bHeld });
    out.worked = (await globalThis.lab.everything()).current.id;
    return out;
  });
  assert.equal(result.early.message, 'The disk is full.');
  assert.equal(result.earlyStart.message, 'The disk is full.');
  assert.deepEqual(result.afterEarly, result.before, 'a refused write moved nothing');
  assert.match(result.late.message, /nothing is half done/);
  assert.match(result.lateStart.message, /nothing is half done/);
  assert.deepEqual(result.afterLate, result.before, 'a transaction stopped after all its writes moved nothing: the project, the shelf and the images are as they were');
  assert.equal(result.worked, 'pa');
});

test('the refusals: a newer current, a shelf copy of the open project, the open project as the target, a target that is gone, a fresh id already kept, a full shelf', async () => {
  const result = await page.evaluate(async () => {
    const { db } = globalThis.lab;
    const handle = await globalThis.lab.fresh();
    const a = globalThis.lab.project('pa', 'This year', []);
    const b = globalThis.lab.project('pb', 'Next year', []);
    const c = globalThis.lab.project('pc', 'Third', []);
    const seeded = await globalThis.lab.seed(a, {});
    let known = await handle.shelveAndStart(a, b, seeded.known, {});
    const out = {};
    // another tab saved after this one last read
    const older = '2026-11-14T09:00:00.000Z';
    out.newer = await globalThis.lab.refusal(handle.switchTo('pa', b, older, {}));
    out.newerStart = await globalThis.lab.refusal(handle.shelveAndStart(b, c, older, {}));
    out.sameTarget = await globalThis.lab.refusal(handle.switchTo('pb', b, known, {}));
    out.sameFresh = await globalThis.lab.refusal(handle.shelveAndStart(b, b, known, {}));
    out.noId = await globalThis.lab.refusal(handle.switchTo(undefined, b, known, {}));
    out.gone = await globalThis.lab.refusal(handle.switchTo('pz', b, known, {}));
    out.keptFresh = await globalThis.lab.refusal(handle.shelveAndStart(b, a, known, {}));
    out.afterRefusals = await globalThis.lab.everything();
    // an older planner imported the open project's id over current while a copy was shelved
    const tx = handle.main.transaction('project', 'readwrite');
    tx.objectStore('project').put({ savedAt: known, project: b, exportedAt: null, shelvedAt: known, bytes: 1, images: {} }, 'shelf:pb');
    await new Promise((resolve) => { tx.oncomplete = resolve; });
    out.shelfOfOpen = await globalThis.lab.refusal(handle.switchTo('pa', b, known, {}));
    out.shelfOfOpenStart = await globalThis.lab.refusal(handle.shelveAndStart(b, c, known, {}));
    const clean = handle.main.transaction('project', 'readwrite');
    clean.objectStore('project').delete('shelf:pb');
    await new Promise((resolve) => { clean.oncomplete = resolve; });
    // a full shelf: PROJECTS_MOST projects, the open one included
    const ids = [];
    for (let n = 0; n < db.PROJECTS_MOST - 2; n += 1) {
      const next = globalThis.lab.project('px' + n, 'Extra ' + n, []);
      known = await handle.shelveAndStart(b, next, known, {});
      ids.push(next.id);
      b.id = next.id;
      Object.assign(b, next);
    }
    out.count = (await handle.shelfIds()).length + 1;
    out.full = await globalThis.lab.refusal(handle.shelveAndStart(b, globalThis.lab.project('py', 'One too many', []), known, {}));
    out.afterFull = (await handle.shelfIds()).length + 1;
    // switching among a full shelf is not refused
    out.switchFull = await globalThis.lab.refusal(handle.switchTo('pa', b, known, {}));
    return out;
  });
  assert.equal(result.newer.name, 'ConflictError');
  assert.equal(result.newerStart.name, 'ConflictError');
  assert.equal(result.sameTarget.type, true, 'the target being the open project is a TypeError');
  assert.equal(result.sameFresh.type, true);
  assert.equal(result.noId.type, true);
  assert.equal(result.gone.code, 'no-such-project');
  assert.equal(result.keptFresh.code, 'shelf-has-fresh');
  assert.equal(result.afterRefusals.current.id, 'pb');
  assert.deepEqual(Object.keys(result.afterRefusals.shelf), ['shelf:pa'], 'no refusal moved anything');
  assert.equal(result.shelfOfOpen.code, 'shelf-has-open');
  assert.equal(result.shelfOfOpenStart.code, 'shelf-has-open');
  assert.match(result.shelfOfOpen.message, /Export both copies/);
  assert.equal(result.count, 20, 'twenty projects, the open one included');
  assert.equal(result.full.code, 'shelf-full');
  assert.equal(result.afterFull, 20, 'the refusal added nothing');
  assert.equal(result.switchFull, null, 'switching keeps the count, so a full shelf still switches');
});

test('the list, a rename, a delete and the ids on the shelf; a record that is not a project is left out of the list', async () => {
  const result = await page.evaluate(async () => {
    const a = globalThis.lab.project('pa', 'This year', ['iaaaa']);
    const b = globalThis.lab.project('pb', '', []);
    const c = globalThis.lab.project('pc', 'Third', []);
    const out = { empty: await (await globalThis.lab.fresh()).listShelf() };
    // the same three projects on a fresh device
    const handle2 = await globalThis.lab.fresh();
    let k = (await globalThis.lab.seed(a, { iaaaa: 'bytes of A' })).known;
    k = await handle2.shelveAndStart(a, b, k, { images: new Map([['iaaaa', globalThis.lab.image('bytes of A')]]) });
    k = await handle2.shelveAndStart(b, c, k, {});
    out.list = await handle2.listShelf();
    out.ids = (await handle2.shelfIds()).sort();
    out.raw = await handle2.readShelved('pa');
    out.rawGone = await handle2.readShelved('pz');
    out.renamed = await handle2.renameShelved('pa', '  Next year\'s plan  ');
    out.afterRename = (await handle2.listShelf()).map((one) => [one.id, one.label]);
    out.rawAfter = (await handle2.readShelved('pa')).project.label;
    out.longLabel = await globalThis.lab.refusal(handle2.renameShelved('pa', 'x'.repeat(61)));
    out.notText = await globalThis.lab.refusal(handle2.renameShelved('pa', 5));
    out.renameGone = await globalThis.lab.refusal(handle2.renameShelved('pz', 'Ghost'));
    out.hostile = await handle2.renameShelved('pb', '<img src=x onerror=alert(1)> "quotes" שלום');
    out.hostileRead = (await handle2.readShelved('pb')).project.label;
    out.deleted = await handle2.deleteShelved('pb');
    out.deletedAgain = await handle2.deleteShelved('pb');
    out.idsAfter = await handle2.shelfIds();
    out.currentAfter = (await globalThis.lab.everything()).current.id;
    // a stray value under the prefix
    const tx = handle2.main.transaction('project', 'readwrite');
    tx.objectStore('project').put('not a record', 'shelf:stray');
    await new Promise((resolve) => { tx.oncomplete = resolve; });
    out.listWithStray = (await handle2.listShelf()).map((one) => one.id);
    out.idsWithStray = (await handle2.shelfIds()).sort();
    return out;
  });
  assert.deepEqual(result.empty, []);
  assert.equal(result.list.length, 2);
  assert.deepEqual(result.list.map((one) => one.id), ['pb', 'pa'], 'newest shelved first');
  const [listB, listA] = result.list;
  assert.deepEqual(listA, { id: 'pa', label: 'This year', schoolName: 'School pa', savedAt: listA.savedAt, shelvedAt: listA.shelvedAt, bytes: listA.bytes, summary: { floors: 1, rooms: 1, groups: 2, teachers: 1 } });
  assert.equal(listB.label, '');
  assert.ok(listA.bytes > 'bytes of A'.length && listA.savedAt && listA.shelvedAt);
  assert.deepEqual(result.ids, ['pa', 'pb']);
  assert.equal(result.raw.project.id, 'pa', 'the raw record, as stored');
  assert.deepEqual(Object.keys(result.raw.images), ['iaaaa']);
  assert.equal(result.rawGone, null);
  assert.equal(result.renamed, 'Next year\'s plan', 'trimmed');
  assert.deepEqual(result.afterRename, [['pb', ''], ['pa', 'Next year\'s plan']]);
  assert.equal(result.rawAfter, 'Next year\'s plan');
  assert.equal(result.longLabel.type, true);
  assert.equal(result.notText.type, true);
  assert.equal(result.renameGone.code, 'no-such-project');
  assert.equal(result.hostileRead, '<img src=x onerror=alert(1)> "quotes" שלום', 'a label is stored exactly as typed');
  assert.equal(result.deleted, true);
  assert.equal(result.deletedAgain, false);
  assert.deepEqual(result.idsAfter, ['pa']);
  assert.equal(result.currentAfter, 'pc', 'the open project is untouched by any of it');
  assert.deepEqual(result.listWithStray, ['pa']);
  assert.deepEqual(result.idsWithStray, ['pa', 'stray'], 'the ids are every key under the prefix');
});

test('the open project\'s images come from the ones given, the store is asked only for the rest, and an image the device lost is left out', async () => {
  const result = await page.evaluate(async () => {
    const handle = await globalThis.lab.fresh();
    // A names three pictures: one given by the session (an undo brought it back after a sweep took it), one stored, one lost
    const a = globalThis.lab.project('pa', 'A', ['igiven', 'istored', 'ilost']);
    const b = globalThis.lab.project('pb', 'B', []);
    const seeded = await globalThis.lab.seed(a, { istored: 'in the store' });
    const given = new Map([['igiven', globalThis.lab.image('from the session')], ['istored', globalThis.lab.image('the session\'s older copy')]]);
    await handle.shelveAndStart(a, b, seeded.known, { images: given });
    const everything = await globalThis.lab.everything();
    return everything;
  });
  assert.deepEqual(result.shelf['shelf:pa'].pictures, { igiven: 'from the session', istored: 'the session\'s older copy' }, 'a given image wins over the store\'s; the one nobody has is not invented');
  const second = await page.evaluate(async () => {
    const handle = await globalThis.lab.fresh();
    const a = globalThis.lab.project('pa', 'A', ['igiven', 'istored']);
    const b = globalThis.lab.project('pb', 'B', []);
    const seeded = await globalThis.lab.seed(a, { istored: 'in the store' });
    // no images given at all: the store is asked for both ids
    await handle.shelveAndStart(a, b, seeded.known, {});
    return (await globalThis.lab.everything()).shelf['shelf:pa'].pictures;
  });
  assert.deepEqual(second, { istored: 'in the store' }, 'with none given the store supplies what it has');
});

test('a duplicate keeps its pictures when the original is deleted, and again after a switch away and back', async () => {
  const result = await page.evaluate(async () => {
    const { db } = globalThis.lab;
    const handle = await globalThis.lab.fresh();
    const original = globalThis.lab.project('pa', 'This year', ['iaaaa', 'iaaab']);
    const seeded = await globalThis.lab.seed(original, { iaaaa: 'first picture', iaaab: 'second picture' });
    // the duplicate: a fresh project id, the same picture ids, started beside the original
    const copy = { ...original, id: 'pcopy', label: 'This year (copy)' };
    let known = await handle.shelveAndStart(original, copy, seeded.known, { images: seeded.held, freshImages: seeded.held });
    const out = { afterDuplicate: await globalThis.lab.everything() };
    // delete the original
    await handle.deleteShelved('pa');
    out.afterDelete = await globalThis.lab.everything();
    // an older planner's sweep, naming only current's images
    await new Promise((resolve, reject) => {
      const tx = handle.main.transaction(['snapshots', 'quarantine', 'images'], 'readwrite');
      db.sweepUnnamedImages(tx, ['iaaaa', 'iaaab']);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    out.afterSweep = await globalThis.lab.everything();
    // away to another project and back
    const other = globalThis.lab.project('pother', 'Other', []);
    known = await handle.shelveAndStart(copy, other, known, { images: seeded.held });
    out.away = await globalThis.lab.everything();
    await handle.switchTo('pcopy', other, known, { images: new Map() });
    out.back = await globalThis.lab.everything();
    return out;
  });
  const both = { iaaaa: 'first picture', iaaab: 'second picture' };
  assert.deepEqual(result.afterDuplicate.images, both, 'the copy is current and names the pictures');
  assert.deepEqual(result.afterDuplicate.shelf['shelf:pa'].pictures, both, 'the original carries its own copies');
  assert.deepEqual(Object.keys(result.afterDelete.shelf), [], 'the original is gone');
  assert.deepEqual(result.afterDelete.images, both, 'and the copy\'s pictures with it: deleting a shelved project touches no image in the store');
  assert.deepEqual(result.afterSweep.images, both);
  assert.deepEqual(result.away.shelf['shelf:pcopy'].pictures, both);
  assert.deepEqual(result.away.images, {}, 'nothing in the images store names them while the copy is shelved');
  assert.deepEqual(result.back.images, both, 'every picture is back');
});

test('the recovery trim across projects: 8 of the open project, 3 of each other, 24 of the others at most, by project id', async () => {
  const result = await page.evaluate(async () => {
    const { db, recovery } = globalThis.lab;
    const handle = await globalThis.lab.fresh();
    const projects = { pa: globalThis.lab.project('pa', 'A', []), pb: globalThis.lab.project('pb', 'B', []), pc: globalThis.lab.project('pc', 'C', []) };
    let n = 0;
    const take = async (id, open, spare) => {
      n += 1;
      const point = recovery.buildPoint(projects[id], 'timer', '2026-11-14T10:' + String(n % 60).padStart(2, '0') + ':00.000Z', null);
      point.sequence = n;
      return handle.addPoint(point, spare, open);
    };
    const kept = async () => (await handle.listPoints()).map((point) => point.project.id + point.sequence);
    const out = {};
    // a point says whose it is
    out.built = recovery.buildPoint(projects.pa, 'replace', '2026-11-14T10:00:00.000Z', null).projectId;
    out.legacy = [db.pointProjectId({ project: { id: 'pold' } }), db.pointProjectId({ projectId: 'pnew', project: { id: 'pold' } }), db.pointProjectId({}), db.pointProjectId(null)];
    // ten of A while A is open: 8 kept
    for (let i = 0; i < 10; i += 1) await take('pa', 'pa');
    out.tenOfA = await kept();
    // B is opened: 'replace' point of A, then B's own points
    await take('pa', 'pa');
    for (let i = 0; i < 6; i += 1) await take('pb', 'pb');
    out.afterB = await kept();
    // C is opened: points of C; B and A are others now
    for (let i = 0; i < 12; i += 1) await take('pc', 'pc');
    out.afterC = await kept();
    // an older planner's trim to 8 overall could have dropped the older projects' points: a point of A with none left
    // the walk reads each record once per connection
    return out;
  });
  assert.equal(result.built, 'pa');
  assert.deepEqual(result.legacy, ['pold', 'pnew', '', '']);
  assert.equal(result.tenOfA.length, 8, 'the open project keeps its newest 8');
  assert.deepEqual(result.tenOfA, ['pa10', 'pa9', 'pa8', 'pa7', 'pa6', 'pa5', 'pa4', 'pa3']);
  // A has 8 points before the switch; the new one makes 9 of A, so the oldest of A is the one that goes ... but A is now only 'other'
  // at the point B is open: A keeps 3, B keeps its 6
  const bPoints = result.afterB.filter((key) => key.startsWith('pb'));
  assert.equal(bPoints.length, 6);
  assert.deepEqual(result.afterB.filter((key) => key.startsWith('pa')), ['pa11', 'pa10', 'pa9'], 'A is another project now: its newest 3');
  assert.equal(result.afterC.filter((key) => key.startsWith('pc')).length, 8, 'C, the open project: 8');
  assert.deepEqual(result.afterC.filter((key) => key.startsWith('pb')), ['pb17', 'pb16', 'pb15'], 'B: 3');
  assert.deepEqual(result.afterC.filter((key) => key.startsWith('pa')), ['pa11', 'pa10', 'pa9'], 'A: 3');
  assert.equal(result.afterC.length, 8 + 3 + 3);
});

test('the other projects\' points are at most 24 together, oldest first, and a legacy point without a projectId counts as its project\'s', async () => {
  const result = await page.evaluate(async () => {
    const { recovery } = globalThis.lab;
    const handle = await globalThis.lab.fresh();
    let n = 0;
    const take = async (id, open, legacy, spare) => {
      n += 1;
      const point = recovery.buildPoint(globalThis.lab.project(id, id, []), 'timer', '2026-11-14T10:00:00.000Z', null);
      point.sequence = n;
      if (legacy) delete point.projectId;
      return handle.addPoint(point, spare, open);
    };
    const kept = async () => (await handle.listPoints()).map((point) => point.project.id + point.sequence);
    const out = {};
    // ten other projects, three points each, then the open one's: 30 points of others, 24 allowed
    for (let project = 0; project < 10; project += 1) {
      for (let i = 0; i < 3; i += 1) await take('p' + project, 'popen', project % 2 === 0);
    }
    await take('popen', 'popen', false);
    out.others = (await kept()).filter((key) => !key.startsWith('popen'));
    out.openKept = (await kept()).filter((key) => key.startsWith('popen'));
    // a spared point survives even when it is the oldest of the others
    const oldest = (await handle.listPoints()).slice(-1)[0];
    out.sparedKey = oldest.key;
    await take('popen', 'popen', false, oldest.key);
    out.afterSpare = (await handle.listPoints()).map((point) => point.key).includes(oldest.key);
    // the id given wins: a point of another project taken while "popen" is open does not take the open project's room
    out.total = (await handle.listPoints()).length;
    // with no open id given the point's own project is the open one
    const alone = await globalThis.lab.fresh();
    for (let i = 0; i < 10; i += 1) {
      const point = recovery.buildPoint(globalThis.lab.project('plone', 'plone', []), 'timer', '2026-11-14T10:00:00.000Z', null);
      await alone.addPoint(point);
    }
    out.alone = (await alone.listPoints()).length;
    return out;
  });
  assert.equal(result.others.length, 24, 'no more than 24 points of other projects');
  // the newest first: projects 9 down to 2 keep 3 each (24), projects 0 and 1 lose theirs
  assert.deepEqual(result.others.map((key) => key.slice(0, 2)).filter((id, index, all) => all.indexOf(id) === index), ['p9', 'p8', 'p7', 'p6', 'p5', 'p4', 'p3', 'p2'], 'the oldest projects are the ones that lose their points');
  assert.equal(result.openKept.length, 1);
  assert.equal(result.afterSpare, true, 'a spared point is never trimmed');
  assert.equal(result.alone, 8, 'without an open id the point\'s own project is the open one: the old rule of 8');
});

test('after a switch nothing is known about the images store, so the page-leaving save writes every image it holds', async () => {
  const result = await page.evaluate(async () => {
    const handle = await globalThis.lab.fresh();
    // B is a copy of A: the same picture id, so the last save's own record of "stored" would still hold after the switch
    const a = globalThis.lab.project('pa', 'A', ['ishared']);
    const b = { ...a, id: 'pb', label: 'B' };
    const seeded = await globalThis.lab.seed(a, { ishared: 'bytes of both' });
    const known = await handle.shelveAndStart(a, b, seeded.known, { images: seeded.held, freshImages: seeded.held });
    // another writer takes the picture out of the store, as an older planner's sweep could
    const tx = handle.main.transaction('images', 'readwrite');
    tx.objectStore('images').delete('ishared');
    await new Promise((resolve) => { tx.oncomplete = resolve; });
    const leaving = handle.saveProjectLeaving(b, known, { images: seeded.held });
    await leaving.done;
    return globalThis.lab.everything();
  });
  assert.deepEqual(result.images, { ishared: 'bytes of both' }, 'forgetStored() ran with the switch, so the leaving save does not trust the images store');
});

// ---------------------------------------------------------------- in Node: the tab lock's grace

test('tabs: a tab left behind by a switch is told so for 10 s, and only then', () => {
  const stamped = (project, at) => ({ savedAt: at, openedAt: at, project: { id: project } });
  const at = '2026-11-14T10:00:00.000Z';
  const now = Date.parse(at);
  assert.equal(OPENED_GRACE_MS, 10000);
  assert.equal(switchedAway(stamped('pb', at), 'pa', now + 1000), true, 'another project, just switched: left behind');
  assert.equal(switchedAway(stamped('pb', at), 'pa', now + OPENED_GRACE_MS), true, 'the edge is inside');
  assert.equal(switchedAway(stamped('pb', at), 'pa', now + OPENED_GRACE_MS + 1), false, 'later than that: an ordinary change');
  assert.equal(switchedAway(stamped('pb', at), 'pb', now + 1000), false, 'the same project is not a switch');
  assert.equal(switchedAway({ savedAt: at, project: { id: 'pb' } }, 'pa', now + 1000), false, 'a record no switch wrote has no openedAt');
  assert.equal(switchedAway(stamped('pb', at), 'pa', now - 1), false, 'a stamp in the future is not trusted');
  assert.equal(switchedAway({ openedAt: 'yesterday', project: { id: 'pb' } }, 'pa', now), false);
  assert.equal(switchedAway(null, 'pa', now), false);
  assert.equal(switchedAway({ openedAt: at }, 'pa', now), false, 'no project, no switch');
  assert.equal(switchedAway(stamped('pb', at), 'pa', NaN), false);
});

test('after all of that the page has logged no error', () => {
  assert.deepEqual(session.problems(), { errors: [], blocked: [], shimmed: [] });
});
