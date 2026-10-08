// Recovery points, in a real browser with a real IndexedDB:
// node test/browser/recovery.mjs
//
// When a point is taken (the timer, leaving the page, on request), how many
// are kept, the card that lists them, restore (which captures the present
// first), export and delete; then the starts that need one: a saved project
// that cannot be read, a crash, and a device that cannot keep points at all.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, startServer, launch, waitForSection, TOOL_PATH } from './harness.mjs';
import { readProjectFile } from '../../engine/project-file.js';
import { buildPoint, pointSummary, isPoint, RECOVERY_INTERVAL_MS, RECOVERY_REASONS } from '../../storage/recovery.js';
import { RECOVERY_KEEP } from '../../storage/db.js';
import { sampleSchool } from '../../data/sample-school.js';

let server;
let browser;
let session;
let page;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function use(next) {
  session = next;
  page = next.page;
}

async function prepare(target) {
  await target.evaluate(async () => {
    globalThis.sv2Actions = await import(new URL('engine/actions.js', document.baseURI).href);
  });
}

// A page on a device with nothing saved (or, with keep, on what the last page left).
async function open(options) {
  const next = await openPlanner({ hash: '#project', server, browser, ...options });
  await prepare(next.page);
  return next;
}

const rename = (name) => page.evaluate((value) => {
  globalThis.sv2.store.apply(globalThis.sv2Actions.setSetting, { key: 'schoolName', value });
}, name);
const schoolShown = () => page.$eval('#school-name .school__text', (el) => el.textContent);
const waitSaved = () => page.waitForFunction(() => document.getElementById('save-indicator').dataset.state === 'saved' && !globalThis.sv2.storage.pending, { timeout: 10000 });
const take = (reason) => page.evaluate((why) => globalThis.sv2.storage.takeRecoveryPoint(why), reason);
const toastText = () => page.$eval('.toast .toast__text', (el) => el.textContent);

// The points as stored, oldest first: [{ key, reason, name, summary, bytes }].
const points = (target) => (target || page).evaluate(() => new Promise((resolve, reject) => {
  const openDb = indexedDB.open('sv2-recovery');
  openDb.onerror = () => reject(openDb.error);
  openDb.onsuccess = () => {
    const db = openDb.result;
    const found = [];
    const cursor = db.transaction('recovery', 'readonly').objectStore('recovery').openCursor();
    cursor.onsuccess = () => {
      const at = cursor.result;
      if (!at) {
        db.close();
        resolve(found);
        return;
      }
      found.push({ key: at.key, reason: at.value.reason, name: at.value.project.settings.schoolName, summary: at.value.summary, bytes: at.value.bytes, takenAt: at.value.takenAt });
      at.continue();
    };
  };
}));

const stored = (target, database, storeName, key) => (target || page).evaluate((args) => new Promise((resolve, reject) => {
  const openDb = indexedDB.open(args.database);
  openDb.onerror = () => reject(openDb.error);
  openDb.onsuccess = () => {
    const db = openDb.result;
    const store = db.transaction(args.storeName, 'readonly').objectStore(args.storeName);
    const request = args.key === undefined ? store.getAll() : store.get(args.key);
    request.onsuccess = () => {
      db.close();
      resolve(request.result === undefined ? null : request.result);
    };
  };
}), { database, storeName, key });

const writeCurrent = (value) => page.evaluate((record) => new Promise((resolve, reject) => {
  const openDb = indexedDB.open('sv2');
  openDb.onerror = () => reject(openDb.error);
  openDb.onsuccess = () => {
    const db = openDb.result;
    const tx = db.transaction('project', 'readwrite');
    tx.objectStore('project').put(record, 'current');
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
  };
}), value);

const cardRows = () => page.$$eval('#recovery tbody tr', (rows) => rows.map((row) => ({
  key: Number(row.dataset.point),
  reason: row.dataset.reason,
  cells: Array.from(row.children).slice(0, 4).map((cell) => cell.textContent),
  buttons: Array.from(row.querySelectorAll('button'), (button) => button.textContent + '|' + button.getAttribute('aria-label')),
})));

const waitRows = (n) => page.waitForFunction((wanted) => document.querySelectorAll('#recovery tbody tr').length === wanted, { timeout: 5000 }, n);

before(async () => {
  server = await startServer();
  browser = await launch();
  use(await open());
});

after(async () => {
  if (session) await session.close().catch(() => {});
  if (browser) await browser.close();
  if (server) await server.close();
});

// ---------------------------------------------------------------- in Node

test('a point is the project, its four figures, its size and its images, for one of five reasons', () => {
  const project = sampleSchool();
  assert.equal(RECOVERY_INTERVAL_MS, 180000);
  assert.equal(RECOVERY_KEEP, 8);
  assert.deepEqual(RECOVERY_REASONS, ['timer', 'leave', 'replace', 'import', 'restore']);
  assert.deepEqual(pointSummary(project), { floors: 3, rooms: 13, groups: 8, teachers: 12 });
  const point = buildPoint(project, 'timer', '2026-09-01T12:00:00.000Z', new Map());
  assert.deepEqual(Object.keys(point), ['takenAt', 'reason', 'summary', 'bytes', 'project', 'images']);
  assert.equal(point.project, project);
  assert.equal(point.bytes, Buffer.byteLength(JSON.stringify(project)));
  assert.equal(isPoint(point), true);
  assert.equal(isPoint({ takenAt: 'x', project: 'text' }), false);
  assert.throws(() => buildPoint(project, 'because', '2026-09-01T12:00:00.000Z', new Map()), /one of: timer, leave, replace, import, restore/);
});

test('a point counts a name in another script by its bytes, and carries only the images its project names', () => {
  const project = sampleSchool();
  project.settings.schoolName = '東京中学校';
  project.building.floors[0].image = { imageId: 'ione000000' };
  const blobs = new Map([['ione000000', new Blob(['12345'])], ['itwo000000', new Blob(['not named'])]]);
  const point = buildPoint(project, 'leave', '2026-09-01T12:00:00.000Z', blobs);
  assert.deepEqual(Object.keys(point.images), ['ione000000']);
  assert.equal(point.bytes, Buffer.byteLength(JSON.stringify(project)) + 5);
});

// ---------------------------------------------------------------- when one is taken

test('the timer takes a point when the project has changed, and none while it has not', async () => {
  await page.evaluate(() => globalThis.sv2.storage.setTiming({ recoveryMs: 300 }));
  await pause(900);
  assert.deepEqual(await points(), [], 'the untouched sample is nobody\'s work');
  await rename('Timer School');
  await page.waitForFunction(() => document.getElementById('recovery').dataset.points === '1', { timeout: 5000 });
  let held = await points();
  assert.deepEqual(held.map((point) => [point.reason, point.name]), [['timer', 'Timer School']]);
  await pause(1200);
  assert.equal((await points()).length, 1, 'no change since the last point, so no new one');
  // a setting is a change too: anything in the project counts
  await page.evaluate(() => globalThis.sv2.store.apply(globalThis.sv2Actions.setSetting, { key: 'timeFormat', value: '24h' }));
  await page.waitForFunction(() => document.getElementById('recovery').dataset.points === '2', { timeout: 5000 });
  held = await points();
  assert.deepEqual(held.map((point) => point.reason), ['timer', 'timer']);
  await page.evaluate(() => globalThis.sv2.storage.setTiming({ recoveryMs: 180000 }));
});

test('the card lists each point with its time, why it was taken, what it holds and its size', async () => {
  const rows = await cardRows();
  const held = await points();
  assert.deepEqual(rows.map((row) => row.key), held.map((point) => point.key).reverse(), 'newest first');
  assert.match(rows[0].cells[0], /^\d\d:\d\d$/, 'taken today, in the project\'s 24-hour format');
  assert.equal(rows[0].cells[1], 'While you worked');
  assert.equal(rows[0].cells[2], '3 floors, 13 rooms, 8 groups, 12 teachers');
  assert.match(rows[0].cells[3], /^\d+ KB$/);
  assert.deepEqual(rows[0].buttons.map((button) => button.split('|')[0]), ['Restore', 'Export', 'Delete']);
  assert.match(rows[0].buttons[0], /^Restore\|Restore the recovery point from \d\d:\d\d$/, 'each button says which point it is for');
  assert.match(await page.$eval('#recovery [data-line="points"]', (el) => el.textContent), /^There are 2 recovery points, \d+ KB in all\.$/);
});

test('the newest 8 are kept, and each is whole', async () => {
  for (let n = 1; n <= 10; n += 1) {
    await rename('Kept ' + n);
    await take('replace');
  }
  const held = await points();
  assert.equal(held.length, 8);
  assert.deepEqual(held.map((point) => point.name), ['Kept 3', 'Kept 4', 'Kept 5', 'Kept 6', 'Kept 7', 'Kept 8', 'Kept 9', 'Kept 10']);
  for (const point of held) assert.deepEqual(point.summary, { floors: 3, rooms: 13, groups: 8, teachers: 12 });
  await waitRows(8);
  assert.equal(await page.$eval('#recovery', (el) => el.dataset.points), '8');
});

// ---------------------------------------------------------------- restore, export, delete

test('restoring the oldest point works: the present is captured first, and one undo puts it back', async () => {
  await rename('The present');
  await waitSaved();
  const before = await points();
  const oldest = before[0];
  assert.equal(oldest.name, 'Kept 3');
  await page.click('#recovery tr[data-point="' + oldest.key + '"] [data-action="restore"]');
  await page.waitForFunction(() => document.querySelector('#school-name .school__text').textContent === 'Kept 3');
  assert.match(await toastText(), /^Restored the recovery point from \d\d:\d\d\. What was here before is a recovery point now\.$/);

  const afterRestore = await points();
  const newest = afterRestore[afterRestore.length - 1];
  assert.deepEqual([newest.reason, newest.name], ['restore', 'The present'], 'what was on screen is the newest point');
  assert.ok(afterRestore.some((point) => point.key === oldest.key), 'the point being restored was not trimmed away by its own capture');

  await waitSaved();
  assert.equal((await stored(page, 'sv2', 'project', 'current')).project.settings.schoolName, 'Kept 3', 'the restored project is the saved one');
  assert.match(await page.$eval('#undo', (el) => el.getAttribute('aria-label')), /^Undo: Restore the recovery point from \d\d:\d\d$/);
  await page.click('.toast .toast__action');
  assert.equal(await schoolShown(), 'The present');
  await waitRows(9);
  assert.equal(await page.$eval('#recovery tbody tr', (row) => row.dataset.reason + '|' + row.children[1].textContent), 'restore|Before a restore');
});

async function catchDownloads() {
  await page.evaluate(() => {
    if (globalThis.downloads) return;
    globalThis.downloads = [];
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function caught() {
      if (!this.hasAttribute('download')) return click.call(this);
      const entry = { name: this.download, text: null };
      globalThis.downloads.push(entry);
      return fetch(this.href).then((response) => response.text()).then((text) => {
        entry.text = text;
      });
    };
  });
}

test('exporting a point writes it as a project file that reads back', async () => {
  await catchDownloads();
  const held = await points();
  const point = held.find((each) => each.name === 'Kept 7');
  await page.click('#recovery tr[data-point="' + point.key + '"] [data-action="export"]');
  await page.waitForFunction(() => globalThis.downloads.length === 1 && globalThis.downloads[0].text !== null);
  const file = await page.evaluate(() => globalThis.downloads[0]);
  assert.match(file.name, /^Kept 7 - recovery point - \d{4}-\d\d-\d\d\.json$/);
  const read = readProjectFile(file.text);
  assert.equal(read.project.format, 'sv2-project');
  assert.equal(read.project.version, 1);
  assert.equal(read.project.settings.schoolName, 'Kept 7');
  assert.deepEqual(read.notes, []);
  assert.equal(await schoolShown(), 'The present', 'exporting changes nothing');
});

test('deleting a point asks first, with buttons that name the action, and deletes only that one', async () => {
  const held = await points();
  const point = held.find((each) => each.name === 'Kept 5');
  const button = '#recovery tr[data-point="' + point.key + '"] [data-action="delete"]';
  await page.click(button);
  await page.waitForSelector('dialog.dialog[open]');
  assert.match(await page.$eval('dialog.dialog[open] .dialog__title', (el) => el.textContent), /^Delete the recovery point from \d\d:\d\d\?$/);
  assert.deepEqual(await page.$$eval('dialog.dialog[open] .dialog__buttons button', (all) => all.map((each) => each.textContent)), ['Delete this recovery point', 'Keep it']);
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Keep it', 'the safe one is focused');
  await page.keyboard.press('Enter');
  await pause(300);
  assert.equal((await points()).length, held.length, 'keeping it keeps it');
  await page.click(button);
  await page.waitForSelector('dialog.dialog[open]');
  await page.click('dialog.dialog[open] .dialog__buttons button:first-child');
  await waitRows(held.length - 1);
  const left = await points();
  assert.deepEqual(left.map((each) => each.key), held.map((each) => each.key).filter((key) => key !== point.key));
});

// ---------------------------------------------------------------- leaving, and coming back

test('leaving the page saves what was waiting and takes a point', async () => {
  await waitSaved();
  await rename('Left in a hurry');
  // inside the 600 ms debounce: nothing has been written yet
  assert.equal((await stored(page, 'sv2', 'project', 'current')).project.settings.schoolName, 'The present');
  await page.goto('about:blank');
  await session.close();
  use(await open({ keep: true }));
  assert.equal(await schoolShown(), 'Left in a hurry', 'the save was flushed as the page went');
  assert.equal(await page.$('#recovery-dialog'), null, 'an ordinary return asks nothing');
  const held = await points();
  assert.deepEqual([held[held.length - 1].reason, held[held.length - 1].name], ['leave', 'Left in a hurry']);
  assert.equal(await page.$eval('#recovery tbody tr', (row) => row.children[1].textContent), 'When the page was left');
});

test('a saved project that cannot be read is set aside, never overwritten, and the newest point is offered', async () => {
  const bad = { savedAt: '2026-09-01T12:00:00.000Z', project: { format: 'sv2-project', version: 1, building: 'this is not a building' }, exportedAt: null };
  await writeCurrent(bad);
  await page.goto('about:blank');
  await page.goto(session.url('#project'), { waitUntil: 'load' });
  await page.waitForSelector('#recovery-dialog[open]');

  assert.equal(await page.$eval('#recovery-dialog .dialog__title', (el) => el.textContent), 'The saved project could not be read.');
  const body = await page.$$eval('#recovery-dialog .dialog__body p', (all) => all.map((each) => each.textContent));
  assert.match(body[0], /^The unreadable copy has been set aside on this device\. Nothing has overwritten it/);
  assert.match(body[1], /^The newest recovery point is from \d\d:\d\d \(3 floors, 13 rooms, 8 groups, 12 teachers, \d+ KB\)\.$/, 'its time and what it holds');
  const buttons = await page.$$eval('#recovery-dialog .dialog__buttons button', (all) => all.map((each) => each.textContent));
  assert.equal(buttons[0], 'Start with the sample school');
  assert.match(buttons[1], /^Restore the recovery point from \d\d:\d\d$/);
  assert.equal(await page.evaluate(() => document.activeElement.textContent), buttons[1], 'restoring is the safe answer, and focused');

  // already, before any answer: the bad record is in quarantine and out of the way
  const aside = await stored(page, 'sv2', 'quarantine');
  assert.equal(aside.length, 1);
  assert.deepEqual(aside[0].raw, bad, 'set aside exactly as it was');
  assert.match(aside[0].error, /\S/);
  assert.match(aside[0].at, /^\d{4}-\d\d-\d\dT/);
  assert.equal(await stored(page, 'sv2', 'project', 'current'), null);

  await page.click('#recovery-dialog .dialog__buttons button:last-child');
  await waitForSection(page, 'project');
  await prepare(page);
  assert.equal(await schoolShown(), 'Left in a hurry');
  await waitSaved();
  assert.equal((await stored(page, 'sv2', 'project', 'current')).project.settings.schoolName, 'Left in a hurry', 'the restored point is the saved project now');
  assert.deepEqual((await stored(page, 'sv2', 'quarantine')).map((each) => each.raw), [bad], 'and the bad copy is still set aside');
  assert.match(await page.$eval('#saved [data-line="quarantine"]', (el) => el.textContent), /^1 saved copy that could not be read has been set aside on this device, and nothing has overwritten it\.$/);

  await catchDownloads();
  await page.click('#saved [data-action="export-unreadable"]');
  await page.waitForFunction(() => globalThis.downloads.length === 1 && globalThis.downloads[0].text !== null);
  const file = await page.evaluate(() => globalThis.downloads[0]);
  assert.match(file.name, /unreadable copy - 2\d{3}-\d\d-\d\d\.json$/);
  assert.deepEqual(JSON.parse(file.text), bad, 'the unreadable copy can be taken off the device');
});

test('declining the point starts with the sample school and keeps every point', async () => {
  const held = await points();
  await writeCurrent('not even an object');
  await page.goto('about:blank');
  await page.goto(session.url('#project'), { waitUntil: 'load' });
  await page.waitForSelector('#recovery-dialog[open]');
  await page.click('#recovery-dialog .dialog__buttons button:first-child');
  await waitForSection(page, 'project');
  await prepare(page);
  assert.equal(await schoolShown(), 'Marrowby Middle School (sample)');
  assert.equal(await page.$eval('#save-indicator', (el) => el.dataset.state), 'off');
  assert.deepEqual((await points()).map((each) => each.key), held.map((each) => each.key));
  assert.equal((await stored(page, 'sv2', 'quarantine')).length, 2);
  assert.equal(await page.$eval('#recovery', (el) => el.dataset.points), String(held.length));
});

test('with no point to offer, the dialog says so and the sample school opens', async () => {
  await session.close();
  use(await open());
  await writeCurrent({ savedAt: 5, project: null });
  await page.goto('about:blank');
  await page.goto(session.url('#project'), { waitUntil: 'load' });
  await page.waitForSelector('#recovery-dialog[open]');
  const body = await page.$$eval('#recovery-dialog .dialog__body p', (all) => all.map((each) => each.textContent));
  assert.match(body[1], /^There is no recovery point on this device, so this is the sample school\./);
  assert.deepEqual(await page.$$eval('#recovery-dialog .dialog__buttons button', (all) => all.map((each) => each.textContent)), ['Carry on with the sample school']);
  await page.keyboard.press('Enter');
  await waitForSection(page, 'project');
  await prepare(page);
  assert.equal(await schoolShown(), 'Marrowby Middle School (sample)');
  assert.equal((await stored(page, 'sv2', 'quarantine')).length, 1);
});

// ---------------------------------------------------------------- a crash

// Kill the page's process. Nothing in the page runs again: no pagehide, no flush.
async function crash() {
  const client = await page.createCDPSession();
  client.send('Page.crash').catch(() => {});
  await pause(500);
  // closing a dead page may never answer; do not wait on it for long
  await Promise.race([session.close().catch(() => {}), pause(3000)]);
  session = null;
}

test('a crash after the save keeps the work: the page is killed with no pagehide and the edit is there', async () => {
  await session.close();
  use(await open());
  await page.evaluate(() => globalThis.sv2.storage.setTiming({ recoveryMs: 300 }));
  await rename('Crashed after saving');
  await waitSaved();
  await page.waitForFunction(() => document.getElementById('recovery').dataset.points === '1', { timeout: 5000 });
  await rename('Crashed after saving, later');
  await waitSaved();
  await pause(700);
  await crash();
  use(await open({ keep: true }));
  assert.equal(await schoolShown(), 'Crashed after saving, later');
  assert.equal(await page.$('#recovery-dialog'), null);
  const held = await points();
  assert.ok(held.length >= 2);
  assert.ok(held.every((point) => point.reason === 'timer'), 'no "leave" point: the page never had the chance to say it was going (' + held.map((point) => point.reason).join(', ') + ')');
});

test('a crash while saves were failing: the next start offers the recovery point, which holds the work', async () => {
  await rename('Saved before the trouble');
  await waitSaved();
  await page.evaluate(() => {
    globalThis.sv2.storage.setTiming({ recoveryMs: 300 });
    globalThis.sv2.storage.hooks.failWrite = 'The disk is full (a test made this up)';
  });
  await rename('Only the recovery point has this');
  await page.waitForSelector('#banner-save-failed');
  await page.waitForFunction(() => new Promise((resolve) => {
    const openDb = indexedDB.open('sv2-recovery');
    openDb.onsuccess = () => {
      const db = openDb.result;
      const all = db.transaction('recovery', 'readonly').objectStore('recovery').getAll();
      all.onsuccess = () => {
        db.close();
        resolve(all.result.some((point) => point.project.settings.schoolName === 'Only the recovery point has this'));
      };
    };
  }), { timeout: 5000 });
  assert.equal((await stored(page, 'sv2', 'project', 'current')).project.settings.schoolName, 'Saved before the trouble');
  await crash();

  // the planner waits for an answer before it draws, so this page is opened by hand
  page = await browser.newPage();
  await page.goto(server.base + TOOL_PATH + '#building', { waitUntil: 'load' });
  await page.waitForSelector('#recovery-dialog[open]');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.ready), undefined, 'nothing is drawn until the question is answered');
  assert.equal(await page.$eval('#recovery-dialog .dialog__title', (el) => el.textContent), 'A recovery point is newer than the saved project.');
  const buttons = await page.$$eval('#recovery-dialog .dialog__buttons button', (all) => all.map((each) => each.textContent));
  assert.equal(buttons[0], 'Keep the saved project');
  await page.keyboard.press('Escape');
  await waitForSection(page, 'building');
  assert.equal(await schoolShown(), 'Only the recovery point has this', 'Escape is the safe answer: the later work');
  await page.waitForFunction(() => document.getElementById('save-indicator').dataset.state === 'saved', { timeout: 10000 });
  assert.equal((await stored(page, 'sv2', 'project', 'current')).project.settings.schoolName, 'Only the recovery point has this');
  await page.close();
  session = null;
});

// ---------------------------------------------------------------- no recovery points at all

test('a device that cannot keep recovery points says so once and carries on saving', async () => {
  use(await openPlanner({
    hash: '#project',
    server,
    browser,
    device: { theme: 'light' },
  }).then(async (opened) => {
    // reload with the recovery database refused
    await opened.page.evaluateOnNewDocument(() => {
      const open = IDBFactory.prototype.open;
      IDBFactory.prototype.open = function refused(name, version) {
        if (name === 'sv2-recovery') throw new DOMException('Recovery storage is switched off (a test made this up)', 'SecurityError');
        return open.call(this, name, version);
      };
    });
    await opened.page.reload({ waitUntil: 'load' });
    await waitForSection(opened.page, 'project');
    await prepare(opened.page);
    return opened;
  }));
  assert.match(await toastText(), /^This device is not keeping recovery points: Recovery storage is switched off \(a test made this up\)\. The project itself is still saved\./);
  assert.match(await page.$eval('#recovery [data-line="points"]', (el) => el.textContent), /^This device is not keeping recovery points: Recovery storage is switched off/);
  await page.click('.toast .toast__close');
  await rename('No recovery here');
  await waitSaved();
  assert.equal(await take('replace'), null, 'a caller that asks for a point is told there is none, and carries on');
  assert.equal(await page.$('.toast'), null, 'said once, not every time');
  assert.equal((await stored(page, 'sv2', 'project', 'current')).project.settings.schoolName, 'No recovery here');
  assert.deepEqual(session.problems().errors, []);
});
