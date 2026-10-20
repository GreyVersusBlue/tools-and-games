// Snapshots, clearing and the import-over asks, in a real browser with a real
// IndexedDB: node test/browser/snapshots.mjs
//
// At 1280 by 900 with a mouse and the keyboard: the Snapshots card empty,
// a snapshot taken with a typed name (kept as typed), a blank name refused,
// restore (a recovery point first, one undo step), rename, export as a
// project file, delete asked first, a traced image kept while a snapshot
// names it and swept with the snapshot, the limit refused truthfully with
// nothing replaced, the three clears (each saying what it removes, a
// snapshot first, on screen at once, undone in one step), a clear and an
// import going on without a snapshot only after saying so, an import taking
// one, a read-only second tab. Then at 390 by 844 with touch: take, restore,
// rename, clear the schedule and delete by finger, the card inside the screen. Then axe on the Project
// section with snapshots listed, light and dark.
//
// Every wait is on a state the page sets: #snapshots[data-snapshots] and
// [data-state] once the list is drawn and no [data-pending] (a draw under
// way), an open dialog, a figure on the page.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { openPlanner, startServer, launch, TOOL_DIR } from './harness.mjs';
import { readProjectFile } from '../../engine/project-file.js';
import { SNAPSHOT_LIMIT, NAME_NEEDED, READ_ONLY_SENTENCE, fullSentence } from '../../storage/snapshots.js';

const AXE = path.join(TOOL_DIR, 'test', 'vendor', 'axe-core', 'axe.min.js');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

const HOSTILE = '<img src=x onerror=alert(1)> “Before” & 7th 学年';
const SCHOOL = 'Harbour <b>View</b> School';

let server;
let browser;
let session;
let page;

before(async () => {
  server = await startServer();
  browser = await launch();
  session = await openPlanner({ hash: '#project', server, browser, width: 1280, height: 900 });
  page = session.page;
  await editable(page);
  await page.evaluate(async () => {
    globalThis.sv2Actions = await import(new URL('engine/actions.js', document.baseURI).href);
  });
  await catchDownloads(page);
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
const text = (selector) => page.$eval(selector, (el) => el.textContent);
const figure = (name) => text('.figures__item[data-figure="' + name + '"] dd');

// The card has drawn a list of n.
const listed = (n, target) => (target || page).waitForFunction((count) => {
  const el = document.getElementById('snapshots');
  return el && el.dataset.state === 'ready' && el.dataset.pending === undefined && el.dataset.snapshots === String(count);
}, { timeout: 10000 }, n);

// The card is not drawing, whatever it holds; then how many it lists. A
// change that should have taken a snapshot waits on this and asserts the
// count, so a snapshot not taken fails on the count, not on a timeout.
const settled = (target) => (target || page).waitForFunction(() => {
  const el = document.getElementById('snapshots');
  return el && el.dataset.state === 'ready' && el.dataset.pending === undefined;
}, { timeout: 10000 });
async function counted(n, why) {
  await settled();
  assert.equal(await page.$eval('#snapshots', (el) => Number(el.dataset.snapshots)), n, why);
}

// The names on the card, top to bottom, as the page shows them.
const names = (target) => (target || page).$$eval('#snapshots .snap__item', (all) => all.map((item) => {
  const name = item.querySelector('.snap__name');
  return name ? name.textContent : null;
}));

const result = (card) => page.$eval('#' + card + ' [data-line="result"]', (el) => (el.hidden ? null : [el.dataset.result, el.querySelector('p').textContent, el.querySelector('p').getAttribute('role')]));

// Every record in a store, as stored.
function idb(storeName, target) {
  return (target || page).evaluate((name) => new Promise((resolve, reject) => {
    const open = indexedDB.open(name === 'recovery' ? 'sv2-recovery' : 'sv2');
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

async function catchDownloads(target) {
  await target.evaluate(() => {
    globalThis.sv2test = { downloads: [] };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function clicked() {
      if (!this.hasAttribute('download')) return click.call(this);
      const name = this.download;
      return fetch(this.href).then((response) => response.text()).then((body) => {
        globalThis.sv2test.downloads.push({ name, text: body });
      });
    };
  });
}

async function dismissToast(target) {
  await (target || page).evaluate(() => document.querySelector('.toast__close')?.click());
}

const dialogTexts = () => page.$$eval('dialog.dialog[open] .dialog__body p', (all) => all.map((el) => el.textContent));
const dialogButtons = () => page.$$eval('dialog.dialog[open] .dialog__buttons button', (all) => all.map((button) => button.textContent + (button === document.activeElement ? ' (focused)' : '')));
async function answer(label) {
  await page.evaluate((wanted) => Array.from(document.querySelectorAll('dialog.dialog[open] .dialog__buttons button')).find((button) => button.textContent === wanted).click(), label);
  await shows(() => document.querySelector('dialog.dialog[open]') === null);
}

// Take a snapshot by the keyboard: the name field, the name, Enter.
async function takeByKeyboard(name, count) {
  await page.focus('#snapshots [data-field="snapshot-name"]');
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  await listed(count);
}

const rowButton = (index, action) => '#snapshots .snap__item:nth-child(' + (index + 1) + ') [data-action="' + action + '"]';
const rename = (value) => page.evaluate((name) => globalThis.sv2.store.apply(globalThis.sv2Actions.setSetting, { key: 'schoolName', value: name }), value);
const waitSaved = () => page.waitForFunction(() => document.getElementById('save-indicator').dataset.state === 'saved' && !globalThis.sv2.storage.pending, { timeout: 10000 });

// ---------------------------------------------------------------- the card

test('the Snapshots card stands after Project file, says there are none yet and the limit, and has its name field', async () => {
  await listed(0);
  const order = await page.$$eval('.page > section.card', (all) => all.map((el) => el.id));
  assert.deepEqual(order, ['saved', 'project-file', 'snapshots', 'recovery', 'settings', 'clear', 'sample-school', 'about']);
  assert.equal(await text('#snapshots [data-line="snapshots"]'), 'There are no snapshots yet. Take one before a large change; the tool also takes one by itself before it clears the building, the schedule or the whole project, and before an import replaces it. This device keeps up to ' + SNAPSHOT_LIMIT + '.');
  assert.equal(await page.$eval('#snapshots .snap__list', (el) => el.hidden), true);
  assert.equal(await page.$eval('#snapshots [data-field="snapshot-name"]', (el) => el.labels[0].textContent), 'Name');
  assert.equal(await page.evaluate(() => document.querySelector('link[data-sheet="project"]') !== null), true, 'the section\'s sheet is in');
});

test('a blank name is refused in a sentence and nothing is kept', async () => {
  await page.focus('#snapshots [data-field="snapshot-name"]');
  await page.keyboard.type(' ​ ');
  await page.keyboard.press('Enter');
  await shows(() => document.querySelector('#snapshots [data-line="result"]').dataset.result === 'refused');
  assert.deepEqual(await result('snapshots'), ['refused', NAME_NEEDED, 'alert']);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.field), 'snapshot-name', 'the focus stays in the name field');
  assert.deepEqual(await idb('snapshots'), []);
  await page.$eval('#snapshots [data-field="snapshot-name"]', (el) => {
    el.value = '';
  });
});

test('a snapshot is taken by the keyboard with its name exactly as typed, shown as text, and stored as ARCHITECTURE 7 says', async () => {
  await rename(SCHOOL);
  await takeByKeyboard(HOSTILE, 1);
  assert.deepEqual(await names(), [HOSTILE]);
  assert.equal(await page.$$eval('#snapshots img, #snapshots b', (all) => all.length), 0, 'the name is text, never markup');
  assert.deepEqual(await result('snapshots'), ['done', 'Took the snapshot “' + HOSTILE + '”.', 'status']);
  assert.equal(await page.$eval('#snapshots [data-field="snapshot-name"]', (el) => el.value), '', 'the field is emptied for the next one');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.field), 'snapshot-name');
  assert.match(await text('#snapshots .snap__about'), /^Taken \d{1,2}:\d\d [AP]M · 3 floors, 13 rooms, 8 groups, 12 teachers · \d+(\.\d)? KB$/);
  assert.match(await text('#snapshots [data-line="snapshots"]'), /^There is 1 snapshot, \d+(\.\d)? KB in all\. This device keeps up to 30\.$/);

  const [stored] = await idb('snapshots');
  assert.deepEqual(Object.keys(stored), ['id', 'name', 'takenAt', 'bytes', 'project']);
  assert.match(stored.id, /^n[a-z0-9]{9}$/);
  assert.equal(stored.name, HOSTILE);
  assert.equal(stored.project.settings.schoolName, SCHOOL);
  assert.equal(stored.bytes, Buffer.byteLength(JSON.stringify(stored.project), 'utf8'));
});

test('restore takes a recovery point first, puts the snapshot in place as one undo step, and says so', async () => {
  await rename('Changed After');
  await waitSaved();
  await dismissToast();
  await page.click(rowButton(0, 'restore'));
  await shows((school) => globalThis.sv2.store.project.settings.schoolName === school, SCHOOL);
  assert.deepEqual(await result('snapshots'), ['done', 'Restored the snapshot “' + HOSTILE + '”. What was here before is a recovery point now, and Undo puts it back.', 'status']);
  assert.equal(await text('.toast .toast__text'), 'Restored the snapshot ' + HOSTILE + '.');
  assert.equal(await page.$eval('#school-name', (el) => el.firstChild.textContent), SCHOOL, 'on screen at once');
  const points = await page.evaluate(async () => (await globalThis.sv2.storage.listRecoveryPoints()).map((point) => point.reason));
  assert.equal(points[0], 'restore', 'the present was kept as a recovery point first');
  const newest = (await idb('recovery')).pop();
  assert.equal(newest.project.settings.schoolName, 'Changed After');
  await page.click('#undo');
  await shows(() => globalThis.sv2.store.project.settings.schoolName === 'Changed After');
  assert.equal(await text('.toast .toast__text'), 'Undid: Restore the snapshot “' + HOSTILE + '”');
  await page.click('#redo');
  await shows((school) => globalThis.sv2.store.project.settings.schoolName === school, SCHOOL);
  await listed(1);
});

test('rename by the keyboard: the field takes the name as typed on Enter, Escape keeps the old one, and a blank one is refused under the field', async () => {
  await dismissToast();
  await page.focus(rowButton(0, 'rename'));
  await page.keyboard.press('Enter');
  await shows(() => document.activeElement && document.activeElement.dataset.field === 'snapshot-rename');
  assert.equal(await page.evaluate(() => document.activeElement.value), HOSTILE);
  // Escape: nothing changes and the focus is back on Rename
  await page.keyboard.press('Escape');
  await shows(() => document.activeElement && document.activeElement.dataset.action === 'rename');
  assert.deepEqual(await names(), [HOSTILE]);

  await page.keyboard.press('Enter');
  await shows(() => document.activeElement && document.activeElement.dataset.field === 'snapshot-rename');
  await page.evaluate(() => document.activeElement.select());
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  await shows(() => document.querySelector('#snapshots .field__refusal:not([hidden])') !== null);
  assert.equal(await text('#snapshots .field__refusal'), NAME_NEEDED);
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-invalid')), 'true');

  const renamed = 'Before moving 7th grade <i>again</i>';
  await page.keyboard.type(renamed);
  await page.keyboard.press('Enter');
  await shows((name) => document.querySelector('#snapshots .snap__name')?.textContent === name, renamed);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'rename', 'the focus is back on the row\'s Rename');
  assert.deepEqual(await result('snapshots'), ['done', 'Renamed the snapshot “' + HOSTILE + '” to “' + renamed + '”.', 'status']);
  assert.equal((await idb('snapshots'))[0].name, renamed);
});

test('export writes the snapshot as a project file with its format and version, named by the one rule', async () => {
  await page.click(rowButton(0, 'export'));
  await shows(() => globalThis.sv2test.downloads.length === 1);
  const [file] = await page.evaluate(() => globalThis.sv2test.downloads.splice(0));
  assert.match(file.name, /^Harbour b View b School - snapshot - \d{4}-\d\d-\d\d\.json$/);
  const value = JSON.parse(file.text);
  assert.deepEqual([value.format, value.version, value.settings.schoolName], ['sv2-project', 1, SCHOOL]);
  const read = readProjectFile(file.text, {});
  assert.equal(read.summary.rooms, 13);
  assert.match((await result('snapshots'))[1], /^Saved the snapshot “Before moving 7th grade <i>again<\/i>” as “Harbour b View b School - snapshot - \d{4}-\d\d-\d\d\.json” to your downloads\. It is a project file: import it under Project file\.$/);
});

test('delete asks first with buttons that name it; Keep it changes nothing; Delete removes it and the focus goes on', async () => {
  await takeByKeyboard('Second one', 2);
  assert.deepEqual(await names(), ['Second one', 'Before moving 7th grade <i>again</i>'], 'newest first');
  await page.click(rowButton(0, 'delete'));
  await page.waitForSelector('dialog.dialog[open]');
  assert.equal(await text('dialog.dialog[open] .dialog__title'), 'Delete the snapshot “Second one”?');
  assert.deepEqual(await dialogButtons(), ['Delete this snapshot', 'Keep it (focused)']);
  await answer('Keep it');
  await listed(2);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'delete', 'the focus is back on Delete');
  await page.keyboard.press('Enter');
  await page.waitForSelector('dialog.dialog[open]');
  await answer('Delete this snapshot');
  await listed(1);
  assert.deepEqual(await names(), ['Before moving 7th grade <i>again</i>']);
  assert.equal(await page.evaluate(() => document.activeElement.closest('.snap__item')?.dataset.snapshot + ' ' + document.activeElement.dataset.action), (await idb('snapshots'))[0].id + ' delete', 'the focus is on the row now in its place');
  assert.deepEqual(await result('snapshots'), ['done', 'Deleted the snapshot “Second one”.', 'status']);
});

test('a traced image stays while a snapshot names it, and goes in the same step as the last snapshot that names it', async () => {
  const withImage = (imageId) => page.evaluate((id) => {
    const project = globalThis.sv2.store.project;
    const floors = project.building.floors.map((floor, index) => (index === 0
      ? { ...floor, image: id ? { imageId: id, opacity: 0.4, scale: 1, rotation: 0, x: 0, y: 0, visible: true, locked: false, width: 2, height: 2, missing: false } : null }
      : floor));
    globalThis.sv2.store.apply(globalThis.sv2Actions.replaceProject, { project: { ...project, building: { ...project.building, floors } }, label: 'Test: image ' + id });
  }, imageId);
  await page.evaluate(() => globalThis.sv2.storage.putImage('isnapshot1', { blob: new Blob(['png bytes']), type: 'image/png', width: 2, height: 2 }));
  await withImage('isnapshot1');
  await takeByKeyboard('With the image', 2);
  await withImage(null);
  await waitSaved();
  assert.ok((await idb('images')).includes('isnapshot1'), 'the project no longer names it, the snapshot does: kept');

  // restoring it brings the image back with the project, and back out
  await page.click(rowButton(0, 'restore'));
  await shows(() => globalThis.sv2.store.project.building.floors[0].image?.imageId === 'isnapshot1');
  await listed(2);
  await page.click('#undo');
  await shows(() => globalThis.sv2.store.project.building.floors[0].image === null);
  await waitSaved();

  await dismissToast();
  await page.click(rowButton(0, 'delete'));
  await page.waitForSelector('dialog.dialog[open]');
  await answer('Delete this snapshot');
  await listed(1);
  assert.equal((await idb('images')).includes('isnapshot1'), false, 'nothing names it now: swept with the snapshot');
});

test('at the limit a snapshot is refused in a sentence that names it and says what to do, and none is replaced', async () => {
  // fill the store to the limit directly: 29 more copies of the one there
  await page.evaluate((limit) => new Promise((resolve, reject) => {
    const open = indexedDB.open('sv2');
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('snapshots', 'readwrite');
      const store = tx.objectStore('snapshots');
      const got = store.getAll();
      got.onsuccess = () => {
        const first = got.result[0];
        for (let n = got.result.length; n < limit; n += 1) store.add({ ...first, id: 'nfill' + String(n).padStart(5, '0'), name: 'Filler ' + n, takenAt: '2026-08-01T10:' + String(n).padStart(2, '0') + ':00.000Z' });
      };
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
  }), SNAPSHOT_LIMIT);
  await page.evaluate(() => globalThis.sv2.storage.flush());
  // the card draws again on the next change it hears of: a take, refused
  const before = (await idb('snapshots')).map((record) => record.id + record.name).sort();
  await page.focus('#snapshots [data-field="snapshot-name"]');
  await page.keyboard.type('One too many');
  await page.keyboard.press('Enter');
  // either answer ends the wait (taken, or refused at the limit), so a limit that did not hold fails on the sentence below
  await shows(() => /One too many|at most/.test(document.querySelector('#snapshots [data-line="result"]').textContent));
  assert.deepEqual(await result('snapshots'), ['refused', fullSentence(SNAPSHOT_LIMIT), 'alert']);
  assert.deepEqual((await idb('snapshots')).map((record) => record.id + record.name).sort(), before, 'nothing added, nothing replaced');
  await page.$eval('#snapshots [data-field="snapshot-name"]', (el) => {
    el.value = '';
  });
});

test('clearing with no room for a snapshot says so before it asks, and goes on only when told', async () => {
  await page.evaluate(() => globalThis.sv2.navigate('#building'));
  await page.evaluate(() => globalThis.sv2.navigate('#project'));
  await listed(SNAPSHOT_LIMIT);
  assert.match(await text('#snapshots [data-line="snapshots"]'), /^There are 30 snapshots, .+ in all\. That is the most this device keeps: delete one to take another\.$/);
  await dismissToast();
  await page.click('#clear [data-action="clear-schedule"]');
  await page.waitForSelector('dialog.dialog[open]');
  assert.equal((await dialogTexts())[2], 'No snapshot can be taken first: this device already keeps 30 snapshots, the most it keeps, and none is replaced to make room. Undo still brings the schedule back while this tab stays open. To have a snapshot as well, keep this, delete one under Snapshots, and come back.');
  await answer('Clear the schedule');
  await shows(() => document.querySelector('.figures__item[data-figure="groups"] dd').textContent === '0');
  assert.equal((await idb('snapshots')).length, SNAPSHOT_LIMIT);
  assert.deepEqual(await result('clear'), ['done', 'Cleared the schedule. Undo brings it back.', 'status']);
  await page.click('#undo');
  await shows(() => document.querySelector('.figures__item[data-figure="groups"] dd').textContent === '8');

  // back under the limit for what follows: every filler goes
  await page.evaluate(() => new Promise((resolve) => {
    const open = indexedDB.open('sv2');
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('snapshots', 'readwrite');
      const store = tx.objectStore('snapshots');
      const keys = store.getAllKeys();
      keys.onsuccess = () => {
        for (const key of keys.result) if (key.startsWith('nfill')) store.delete(key);
      };
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
    };
  }));
  await page.evaluate(() => globalThis.sv2.navigate('#building'));
  await page.evaluate(() => globalThis.sv2.navigate('#project'));
  await listed(1);
});

// ---------------------------------------------------------------- clearing

test('clear the building: it says what it removes and keeps, takes a snapshot first, shows at once, and one undo brings it back', async () => {
  await dismissToast();
  assert.equal(await text('#clear [data-says="building"]'), 'Removes everything drawn on all 3 floors: 13 rooms, 10 other spaces, 121 corridor cells, 4 stairs cells, 5 corridor names, 2 exits, 2 stairs connections and 1 area left out of the colour scale.');
  await page.click('#clear [data-action="clear-building"]');
  await page.waitForSelector('dialog.dialog[open]');
  assert.equal(await text('dialog.dialog[open] .dialog__title'), 'Clear the building?');
  assert.deepEqual(await dialogTexts(), [
    'Removes everything drawn on all 3 floors: 13 rooms, 10 other spaces, 121 corridor cells, 4 stairs cells, 5 corridor names, 2 exits, 2 stairs connections and 1 area left out of the colour scale.',
    'The floors stay, empty, with their names, sizes and any traced images. The schedule stays: a group in a room that is gone keeps the room\'s number, which reads "not in the building", and teachers keep their names but no longer have rooms.',
    'A snapshot of the project as it is now, “Before clearing the building”, is taken first, so you can restore it from Snapshots at any time. Undo brings the building back too, while this tab stays open.',
  ]);
  assert.deepEqual(await dialogButtons(), ['Clear the building', 'Keep the building (focused)']);
  await answer('Keep the building');
  assert.deepEqual(await result('clear'), ['done', 'Nothing was cleared.', 'status']);
  assert.equal(await figure('rooms'), '13');

  await page.click('#clear [data-action="clear-building"]');
  await page.waitForSelector('dialog.dialog[open]');
  await answer('Clear the building');
  await shows(() => document.querySelector('.figures__item[data-figure="rooms"] dd').textContent === '0');
  assert.deepEqual([await figure('floors'), await figure('exits'), await figure('groups')], ['3', '0', '8']);
  assert.equal(await text('#clear [data-says="building"]'), 'Nothing is drawn on any of the 3 floors, so there is nothing to clear.');
  await counted(2, 'a snapshot was taken before the building was cleared');
  assert.deepEqual(await names(), ['Before clearing the building', 'Before moving 7th grade <i>again</i>']);
  const auto = (await idb('snapshots')).find((record) => record.name === 'Before clearing the building');
  assert.equal(auto.project.building.floors[0].spaces.length > 0, true, 'the snapshot holds the building as it was');
  assert.equal(await text('.toast .toast__text'), 'Cleared the building. The snapshot “Before clearing the building” has what was there.');
  // on another screen at once too
  await page.evaluate(() => globalThis.sv2.navigate('#building'));
  await shows(() => document.querySelector('.surface__layout')?.dataset.section === 'building');
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.building.floors.every((floor) => floor.spaces.length === 0 && !/[^.]/.test(floor.cells))), true);
  await page.evaluate(() => globalThis.sv2.navigate('#project'));
  await listed(2);

  // pressed again with nothing to remove, it asks nothing
  await page.click('#clear [data-action="clear-building"]');
  await shows(() => /nothing to clear/.test(document.querySelector('#clear [data-line="result"]').textContent));
  assert.equal(await page.$('dialog.dialog[open]'), null);

  await dismissToast();
  await page.click('#undo');
  await shows(() => document.querySelector('.figures__item[data-figure="rooms"] dd').textContent === '13');
  assert.equal(await text('.toast .toast__text'), 'Undid: Clear the building');
});

test('clear the schedule: the groups and teachers go at once with a snapshot first; the building stays', async () => {
  await dismissToast();
  await page.click('#clear [data-action="clear-schedule"]');
  await page.waitForSelector('dialog.dialog[open]');
  assert.deepEqual(await dialogTexts(), [
    'Removes 8 groups with their schedules and 12 teachers.',
    'The building stays with its rooms, which no longer have teachers. The subjects, the day types with their bell times, and the settings stay too.',
    'A snapshot of the project as it is now, “Before clearing the schedule”, is taken first, so you can restore it from Snapshots at any time. Undo brings the schedule back too, while this tab stays open.',
  ]);
  await answer('Clear the schedule');
  await shows(() => document.querySelector('.figures__item[data-figure="groups"] dd').textContent === '0');
  assert.deepEqual([await figure('teachers'), await figure('rooms'), await figure('dayTypes')], ['0', '13', '2']);
  await counted(3, 'a snapshot was taken before the schedule was cleared');
  assert.equal((await names())[0], 'Before clearing the schedule');
  await page.click('#undo');
  await shows(() => document.querySelector('.figures__item[data-figure="groups"] dd').textContent === '8');
});

test('start a new project: a recovery point and a snapshot first, an empty project of its own at once, one undo back', async () => {
  await dismissToast();
  const id = await page.evaluate(() => globalThis.sv2.store.project.id);
  await page.click('#clear [data-action="clear-new"]');
  await page.waitForSelector('dialog.dialog[open]');
  assert.equal(await text('dialog.dialog[open] .dialog__title'), 'Start a new project in place of this one?');
  assert.deepEqual(await dialogButtons(), ['Start a new project', 'Keep this project (focused)']);
  await answer('Start a new project');
  await shows(() => document.querySelector('.figures__item[data-figure="rooms"] dd').textContent === '0' && document.querySelector('.figures__item[data-figure="floors"] dd').textContent === '1');
  assert.notEqual(await page.evaluate(() => globalThis.sv2.store.project.id), id);
  assert.equal(await page.$eval('#school-name', (el) => el.firstChild.textContent), 'Schedule Visualizer 2', 'no school name: the tool\'s own');
  const recovery = await idb('recovery');
  assert.deepEqual([recovery[recovery.length - 1].reason, recovery[recovery.length - 1].project.id], ['replace', id], 'the project replaced is the newest recovery point');
  await counted(4, 'a snapshot was taken before the new project');
  assert.equal((await names())[0], 'Before starting a new project');
  // the earlier snapshots are of another project now, and say whose
  assert.match(await page.$eval('#snapshots .snap__item:nth-child(2) .snap__other', (el) => el.textContent), /^Of another project: Harbour <b>View<\/b> School$/);
  await page.click('#undo');
  await shows((wanted) => globalThis.sv2.store.project.id === wanted, id);
});

// ---------------------------------------------------------------- imports

test('importing a project file over this one asks, takes a snapshot named for the file first, and the question says so', async () => {
  await dismissToast();
  const fileText = await page.evaluate(async () => {
    const { buildExport } = await import(new URL('engine/exports.js', document.baseURI).href);
    return buildExport(globalThis.sv2.store.project, 'project', {}).text;
  });
  const fileName = 'tide <water>.json';
  await page.evaluate((name, contents) => {
    const input = document.querySelector('#project-file input[type="file"][data-file="project"]');
    const data = new DataTransfer();
    data.items.add(new File([contents], name));
    input.files = data.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, fileName, fileText);
  await page.waitForSelector('dialog.dialog[open]');
  assert.equal((await dialogTexts())[2], 'A recovery point of this project is taken first, with a snapshot of it, “Before importing ' + fileName + '”, that you can restore from Snapshots at any time. Undo brings it back while this tab stays open.');
  await answer('Replace this project');
  await shows(() => document.querySelector('#project-file [data-line="result"]')?.dataset.result === 'done' && /^Imported/.test(document.querySelector('#project-file [data-line="result"]').textContent));
  await counted(5, 'a snapshot was taken before the project file replaced the project');
  assert.equal((await names())[0], 'Before importing ' + fileName);
  assert.equal((await page.evaluate(async () => (await globalThis.sv2.storage.listRecoveryPoints())[0].reason)), 'import', 'the recovery point is still taken');
});

test('importing a building file asks first and takes a snapshot named for the file too', async () => {
  await dismissToast();
  const fileText = await page.evaluate(async () => {
    const { buildExport } = await import(new URL('engine/exports.js', document.baseURI).href);
    return buildExport(globalThis.sv2.store.project, 'building', {}).text;
  });
  await page.evaluate((contents) => {
    const input = document.querySelector('#project-file input[type="file"][data-file="building"]');
    const data = new DataTransfer();
    data.items.add(new File([contents], 'east wing.json'));
    input.files = data.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, fileText);
  await page.waitForSelector('dialog.dialog[open]');
  assert.equal((await dialogTexts())[2], 'A recovery point of this project is taken first, with a snapshot of it, “Before importing east wing.json”, that you can restore from Snapshots at any time. Undo brings the building back while this tab stays open.');
  assert.deepEqual(await dialogButtons(), ['Replace the building', 'Keep this building (focused)']);
  await answer('Keep this building');
  assert.equal((await idb('snapshots')).length, 5, 'kept: no snapshot, nothing changed');
  await page.evaluate((contents) => {
    const input = document.querySelector('#project-file input[type="file"][data-file="building"]');
    const data = new DataTransfer();
    data.items.add(new File([contents], 'east wing.json'));
    input.files = data.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, fileText);
  await page.waitForSelector('dialog.dialog[open]');
  await answer('Replace the building');
  await shows(() => /^Imported “east wing\.json”/.test(document.querySelector('#project-file [data-line="result"]').textContent));
  await counted(6, 'a snapshot was taken before the building file replaced the building');
  assert.equal((await names())[0], 'Before importing east wing.json');
});

// ---------------------------------------------------------------- two tabs

test('a read-only second tab lists the snapshots, can export one, and refuses the rest in a sentence', async () => {
  const other = await openPlanner({ hash: '#project', server, browser, keep: true });
  try {
    const second = other.page;
    await second.waitForFunction(() => globalThis.sv2 && globalThis.sv2.storage.state.readOnly, { timeout: 15000 });
    await listed(6, second);
    assert.equal(await second.$eval('#snapshots [data-action="take-snapshot"]', (el) => el.getAttribute('aria-disabled')), 'true');
    assert.deepEqual(await second.$$eval('#snapshots .snap__item:first-child [data-action]', (all) => all.map((el) => el.dataset.action + ':' + (el.getAttribute('aria-disabled') || 'on'))), ['restore:true', 'rename:true', 'export:on', 'delete:true']);
    await second.click('#snapshots .snap__item:first-child [data-action="delete"]');
    await second.waitForFunction(() => document.querySelector('#snapshots [data-line="result"]').dataset.result === 'refused');
    assert.equal(await second.$eval('#snapshots [data-line="result"] p', (el) => el.textContent), READ_ONLY_SENTENCE);
    assert.equal(await second.$('dialog.dialog[open]'), null, 'nothing asked');
    assert.equal((await idb('snapshots', second)).length, 6);
  } finally {
    await other.close();
  }
});

// ---------------------------------------------------------------- a phone

test('on a phone with touch: the card fits the screen, and take, restore, rename, a clear and delete work by finger', async () => {
  // its own server, so its own origin: its own IndexedDB and tab lock, apart from the page above
  const phone = await openPlanner({ hash: '#project', browser, width: 390, height: 844, mobile: true });
  const target = phone.page;
  try {
    await editable(target);
    await listed(0, target);
    const name = await target.$('#snapshots [data-field="snapshot-name"]');
    await name.tap();
    await target.keyboard.type('On the bus 学年');
    await target.tap('#snapshots [data-action="take-snapshot"]');
    await listed(1, target);
    assert.deepEqual(await names(target), ['On the bus 学年']);
    const sizes = await target.evaluate(() => {
      const card = document.getElementById('snapshots');
      const buttons = Array.from(card.querySelectorAll('button')).filter((el) => el.getClientRects().length > 0);
      return {
        fits: card.scrollWidth <= card.clientWidth && document.documentElement.scrollWidth <= window.innerWidth,
        smallest: Math.min(...buttons.map((el) => Math.min(el.getBoundingClientRect().width, el.getBoundingClientRect().height))),
        coarse: matchMedia('(pointer: coarse)').matches,
      };
    });
    assert.equal(sizes.coarse, true);
    assert.equal(sizes.fits, true, 'nothing on the card runs off a 390 px screen');
    assert.ok(sizes.smallest >= 44, 'every button is a finger\'s size, the smallest is ' + sizes.smallest);

    const was = await target.evaluate(() => globalThis.sv2.store.project.settings.schoolName);
    await target.evaluate(async () => {
      const actions = await import(new URL('engine/actions.js', document.baseURI).href);
      globalThis.sv2.store.apply(actions.setSetting, { key: 'schoolName', value: 'Phone changed' });
    });
    await target.tap('#snapshots .snap__item:first-child [data-action="restore"]');
    await target.waitForFunction((name) => globalThis.sv2.store.project.settings.schoolName === name, { timeout: 10000 }, was);
    await listed(1, target);
    await dismissToast(target);
    // rename: a tap opens the field with the on-screen keyboard's text in it; Enter keeps it
    await target.tap('#snapshots .snap__item:first-child [data-action="rename"]');
    await target.waitForFunction(() => document.activeElement && document.activeElement.dataset.field === 'snapshot-rename');
    await target.evaluate(() => document.activeElement.select());
    await target.keyboard.type('Bus ride');
    await target.keyboard.press('Enter');
    await target.waitForFunction(() => document.querySelector('#snapshots .snap__name')?.textContent === 'Bus ride');
    // clear the schedule by finger: asked, a snapshot first, at once
    await target.tap('#clear [data-action="clear-schedule"]');
    await target.waitForSelector('dialog.dialog[open]');
    await target.tap('dialog.dialog[open] .btn--danger');
    await target.waitForFunction(() => document.querySelector('.figures__item[data-figure="groups"] dd').textContent === '0');
    await listed(2, target);
    assert.deepEqual(await names(target), ['Before clearing the schedule', 'Bus ride']);
    await target.evaluate(() => globalThis.sv2.store.undo());
    await target.waitForFunction(() => document.querySelector('.figures__item[data-figure="groups"] dd').textContent === '8');
    await dismissToast(target);
    await target.tap('#snapshots .snap__item:first-child [data-action="delete"]');
    await target.waitForSelector('dialog.dialog[open]');
    await target.tap('dialog.dialog[open] .btn--danger');
    await listed(1, target);
    await target.tap('#snapshots .snap__item:first-child [data-action="delete"]');
    await target.waitForSelector('dialog.dialog[open]');
    await target.tap('dialog.dialog[open] .btn--danger');
    await listed(0, target);
    assert.equal(await target.$eval('#snapshots [data-line="result"] p', (el) => el.textContent), 'Deleted the snapshot “Bus ride”.');
  } finally {
    await phone.close();
  }
});

// ---------------------------------------------------------------- axe

for (const theme of ['light', 'dark']) {
  test('axe finds nothing on the Project section with snapshots listed, in the ' + theme + ' theme', async () => {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
    await page.evaluate(() => globalThis.sv2.navigate('#building'));
    await page.evaluate(() => globalThis.sv2.navigate('#project'));
    await listed(6);
    await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), theme);
    await page.addScriptTag({ path: AXE });
    const found = await page.evaluate((tags) => globalThis.axe.run(document, { runOnly: { type: 'tag', values: tags } }), TAGS);
    assert.ok(found.passes.length > 10, 'axe ran very few rules');
    assert.deepEqual(found.violations.map((violation) => violation.id + ': ' + violation.nodes.map((node) => node.target.join(' ')).join(', ')), []);
  });
}
