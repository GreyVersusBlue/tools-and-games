// Saving on the device, in a real browser with a real IndexedDB:
// node test/browser/storage.mjs
//
// The names of the two databases, autosave and its indicator, a reload that
// keeps the work, a save that fails, a save that would overwrite another
// tab's, the room used, and the traced images nothing names any more. The
// timing rules of autosave and the words storage uses are plain modules, so
// their cases run here in Node with a pinned clock.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, waitForSection } from './harness.mjs';
import { createAutosave, SAVE_DELAY_MS, SAVE_MAX_WAIT_MS, SAVE_RETRY_MS } from '../../storage/autosave.js';
import { formatBytes, clockTime, whenWords, whenInSentence } from '../../storage/words.js';
import { readDevice, writeDevice, DEVICE_KEY } from '../../storage/device.js';
import { readProjectFile } from '../../engine/project-file.js';

let session;
let page;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const indicator = () => page.$eval('#save-indicator', (el) => ({ state: el.dataset.state, text: el.textContent, title: el.title }));
const waitSaved = () => page.waitForFunction(() => document.getElementById('save-indicator').dataset.state === 'saved' && !globalThis.sv2.storage.pending, { timeout: 10000 });
const rename = (name) => page.evaluate((value) => {
  globalThis.sv2.store.apply(globalThis.sv2Actions.setSetting, { key: 'schoolName', value });
}, name);

// Read straight from IndexedDB, past the tool's own code.
const idb = (database, storeName, how, key) => page.evaluate((args) => new Promise((resolve, reject) => {
  const open = indexedDB.open(args.database);
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    const store = db.transaction(args.storeName, 'readonly').objectStore(args.storeName);
    const request = args.how === 'get' ? store.get(args.key) : args.how === 'keys' ? store.getAllKeys() : store.getAll();
    request.onsuccess = () => {
      db.close();
      // a Blob does not survive the trip to Node; say only that it was one
      resolve(JSON.parse(JSON.stringify(request.result === undefined ? null : request.result, (name, value) => (value instanceof Blob ? { blob: value.size } : value))));
    };
    request.onerror = () => reject(request.error);
  };
}), { database, storeName, how, key });

const put = (database, storeName, value, key) => page.evaluate((args) => new Promise((resolve, reject) => {
  const open = indexedDB.open(args.database);
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    const tx = db.transaction(args.storeName, 'readwrite');
    if (args.key === undefined) tx.objectStore(args.storeName).put(args.value);
    else tx.objectStore(args.storeName).put(args.value, args.key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  };
}), { database, storeName, value, key });

// The page's actions module, for store.apply from a test.
async function withActions() {
  await page.evaluate(async () => {
    globalThis.sv2Actions = await import(new URL('engine/actions.js', document.baseURI).href);
  });
}

async function reload() {
  await page.reload({ waitUntil: 'load' });
  await waitForSection(page, 'project');
  await withActions();
}

before(async () => {
  session = await openPlanner({ hash: '#project' });
  page = session.page;
  await withActions();
});

after(async () => {
  if (session) await session.close();
});

// ---------------------------------------------------------------- in Node: autosave's timing

// A clock and timers the test moves by hand.
function fakeTime() {
  let now = 0;
  let next = 1;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms) {
      const id = next;
      next += 1;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
        // let the write's promise settle before the next timer
        for (let i = 0; i < 5; i += 1) await Promise.resolve();
      }
      now = end;
    },
  };
}

function saver(time, behaviour) {
  const writes = [];
  const states = [];
  const autosave = createAutosave({
    now: time.now,
    setTimeout: time.setTimeout,
    clearTimeout: time.clearTimeout,
    onState: (state, detail) => states.push(detail instanceof Error ? state + ':' + detail.message : state),
    write: () => {
      writes.push(time.now());
      return behaviour ? behaviour(writes.length) : Promise.resolve('saved-' + writes.length);
    },
  });
  return { autosave, writes, states };
}

test('autosave: the constants are 600 ms, 3 s and 10 s', () => {
  assert.deepEqual([SAVE_DELAY_MS, SAVE_MAX_WAIT_MS, SAVE_RETRY_MS], [600, 3000, 10000]);
});

test('autosave: one change is written 600 ms later, and says Saving at once', async () => {
  const time = fakeTime();
  const { autosave, writes, states } = saver(time);
  autosave.changed();
  assert.deepEqual(states, ['saving'], 'Saving shows from the first change');
  await time.advance(599);
  assert.deepEqual(writes, []);
  await time.advance(1);
  assert.deepEqual(writes, [600]);
  assert.deepEqual(states, ['saving', 'saved']);
  assert.equal(autosave.pending, false);
});

test('autosave: changes close together are one write, 600 ms after the last', async () => {
  const time = fakeTime();
  const { autosave, writes } = saver(time);
  autosave.changed();
  await time.advance(300);
  autosave.changed();
  await time.advance(200);
  autosave.changed();
  await time.advance(599);
  assert.deepEqual(writes, [], 'the debounce is trailing');
  await time.advance(1);
  assert.deepEqual(writes, [1100]);
});

test('autosave: a run of changes that never pauses is still written 3 s after its first', async () => {
  const time = fakeTime();
  const { autosave, writes } = saver(time);
  for (let at = 0; at < 7000; at += 400) {
    autosave.changed();
    await time.advance(400);
  }
  assert.deepEqual(writes.slice(0, 2), [3000, 6200], 'the maximum wait, then the same again from the next change');
});

test('autosave: a failed write says so and is tried again every 10 s until it works', async () => {
  const time = fakeTime();
  const { autosave, writes, states } = saver(time, (n) => (n < 3 ? Promise.reject(new Error('disk full')) : Promise.resolve('ok')));
  autosave.changed();
  await time.advance(600);
  assert.deepEqual(states, ['saving', 'failed:disk full']);
  assert.equal(autosave.pending, true, 'the change is still owed a save');
  await time.advance(9999);
  assert.deepEqual(writes, [600]);
  await time.advance(1);
  assert.deepEqual(writes, [600, 10600]);
  await time.advance(10000);
  assert.deepEqual(writes, [600, 10600, 20600]);
  assert.equal(states[states.length - 1], 'saved');
  await time.advance(60000);
  assert.equal(writes.length, 3, 'nothing more once it is saved');
});

test('autosave: while a save is failing the indicator stays failed, and a new change tries sooner', async () => {
  const time = fakeTime();
  const { autosave, writes, states } = saver(time, (n) => (n === 1 ? Promise.reject(new Error('no')) : Promise.resolve('ok')));
  autosave.changed();
  await time.advance(600);
  autosave.changed();
  assert.equal(states[states.length - 1], 'failed:no', 'not back to Saving while the banner is up');
  await time.advance(600);
  assert.deepEqual(writes, [600, 1200]);
  assert.equal(states[states.length - 1], 'saved');
});

test('autosave: a save refused because another tab saved first stops it for good', async () => {
  const time = fakeTime();
  const conflict = Object.assign(new Error('another tab'), { name: 'ConflictError' });
  const { autosave, writes, states } = saver(time, () => Promise.reject(conflict));
  autosave.changed();
  await time.advance(600);
  assert.deepEqual(states, ['saving', 'conflict:another tab']);
  autosave.changed();
  await time.advance(60000);
  assert.deepEqual(writes, [600], 'no retry: it would only ask to overwrite the other tab again');
});

test('autosave: a change made while a write is in flight gets its own write', async () => {
  const time = fakeTime();
  let finish;
  const { autosave, writes, states } = saver(time, (n) => (n === 1 ? new Promise((resolve) => {
    finish = resolve;
  }) : Promise.resolve('ok')));
  autosave.changed();
  await time.advance(600);
  autosave.changed();
  finish('first');
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  assert.notEqual(states[states.length - 1], 'saved', 'the first write did not cover the second change');
  await time.advance(600);
  assert.equal(writes.length, 2);
  assert.equal(states[states.length - 1], 'saved');
});

test('autosave: flush writes at once, and a paused autosave writes nothing', async () => {
  const time = fakeTime();
  const { autosave, writes } = saver(time);
  autosave.changed();
  await autosave.flush();
  assert.deepEqual(writes, [0]);
  autosave.pause();
  autosave.changed();
  await time.advance(60000);
  await autosave.flush();
  assert.deepEqual(writes, [0], 'a read-only tab saves nothing');
  autosave.resume();
  await time.advance(60000);
  assert.deepEqual(writes, [0], 'and owes nothing when it can edit again');
});

// ---------------------------------------------------------------- in Node: words and the device key

test('words: sizes and moments read the same on every machine', () => {
  assert.deepEqual([0, 1, 1023, 1024, 1536, 20 * 1024, 5 * 1024 * 1024, 4.2 * 1024 ** 3].map(formatBytes), ['0 bytes', '1 byte', '1023 bytes', '1.0 KB', '1.5 KB', '20 KB', '5.0 MB', '4.2 GB']);
  const now = new Date('2026-09-01T12:00:00Z');
  assert.equal(clockTime(new Date('2026-09-01T10:42:00Z'), '12h'), '10:42 AM');
  assert.equal(clockTime(new Date('2026-09-01T10:42:00Z'), '12h', { suffix: false }), '10:42');
  assert.equal(clockTime(new Date('2026-09-01T14:05:00Z'), '24h'), '14:05');
  assert.equal(whenWords('2026-09-01T10:42:00Z', now, '24h'), '10:42');
  assert.equal(whenInSentence('2026-09-01T10:42:00Z', now, '12h'), 'at 10:42 AM');
  assert.match(whenWords('2026-08-30T10:42:00Z', now, '24h'), /30.*, 10:42$/, 'another day is named');
  assert.match(whenInSentence('2026-08-30T10:42:00Z', now, '24h'), /^on .*30.* at 10:42$/);
  assert.equal(whenWords('not a date', now, '24h'), 'an unknown time');
});

test('device: a write changes only its own keys under sv2:device, and bad JSON reads as nothing', () => {
  const held = new Map();
  const storage = { getItem: (key) => (held.has(key) ? held.get(key) : null), setItem: (key, value) => held.set(key, value) };
  assert.equal(DEVICE_KEY, 'sv2:device');
  assert.deepEqual(readDevice(storage), {});
  writeDevice({ theme: 'dark' }, storage);
  held.set(DEVICE_KEY, JSON.stringify({ ...JSON.parse(held.get(DEVICE_KEY)), lastSection: 'schedule' }));
  writeDevice({ paper: 'a4' }, storage);
  assert.deepEqual(JSON.parse(held.get('sv2:device')), { theme: 'dark', lastSection: 'schedule', paper: 'a4' });
  held.set(DEVICE_KEY, '{not json');
  assert.deepEqual(readDevice(storage), {});
  assert.throws(() => writeDevice({ theme: 'light' }, { getItem: () => null, setItem: () => { throw new Error('full'); } }), /full/);
});

// ---------------------------------------------------------------- in the browser

test('a new device opens the sample school, has saved nothing, and says so', async () => {
  assert.deepEqual(session.problems(), { errors: [], blocked: [], shimmed: [] });
  const shown = await indicator();
  assert.equal(shown.state, 'off');
  assert.equal(shown.text, 'Nothing to save yet');
  assert.equal(await idb('sv2', 'project', 'get', 'current'), null, 'the sample is not a person\'s work; it is not written until something changes');
  assert.match(await page.$eval('#saved [data-line="saved"]', (el) => el.textContent), /nothing has changed yet, so nothing is saved yet/);
  assert.match(await page.$eval('#saved [data-line="exported"]', (el) => el.textContent), /never been exported/);
  assert.equal(await page.$eval('#recovery', (el) => el.dataset.points), '0');
});

test('the two databases, their stores and their keys have the names that never change', async () => {
  await rename('Names Test School');
  await waitSaved();
  await page.evaluate(() => globalThis.sv2.storage.takeRecoveryPoint('replace'));
  const databases = await page.evaluate(async () => (await indexedDB.databases()).map((each) => each.name + '@' + each.version).sort());
  assert.deepEqual(databases, ['sv2-recovery@1', 'sv2@1']);
  const stores = await page.evaluate(() => Promise.all(['sv2', 'sv2-recovery'].map((name) => new Promise((resolve) => {
    const open = indexedDB.open(name);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(Array.from(db.objectStoreNames), 'readonly');
      const found = Array.from(db.objectStoreNames).map((each) => each + ' keyPath=' + JSON.stringify(tx.objectStore(each).keyPath) + ' auto=' + tx.objectStore(each).autoIncrement);
      db.close();
      resolve(found);
    };
  }))));
  assert.deepEqual(stores, [
    ['images keyPath=null auto=false', 'project keyPath=null auto=false', 'quarantine keyPath=null auto=true', 'snapshots keyPath="id" auto=false'],
    ['recovery keyPath=null auto=true'],
  ]);
  assert.deepEqual(await idb('sv2', 'project', 'keys'), ['current']);
  const record = await idb('sv2', 'project', 'get', 'current');
  assert.deepEqual(Object.keys(record).sort(), ['exportedAt', 'project', 'savedAt']);
  assert.equal(record.project.format, 'sv2-project');
  assert.equal(record.project.settings.schoolName, 'Names Test School');
  const points = await idb('sv2-recovery', 'recovery', 'all');
  assert.equal(points.length, 1);
  assert.deepEqual(Object.keys(points[0]).sort(), ['bytes', 'images', 'project', 'reason', 'summary', 'takenAt']);
  assert.deepEqual(points[0].summary, { floors: 3, rooms: 13, groups: 8, teachers: 12 });
  assert.equal(points[0].reason, 'replace');
  assert.ok(points[0].bytes > 10000 && points[0].bytes < 200000, 'bytes is the size of the project: ' + points[0].bytes);
  assert.equal(await page.evaluate(() => localStorage.getItem('sv2:tab')), null, 'with Web Locks there is no heartbeat key');
});

test('a change says Saving at once, is on the device within about a second, and then says Saved at the time', async () => {
  const started = Date.now();
  const during = await page.evaluate(() => {
    globalThis.sv2.store.apply(globalThis.sv2Actions.setSetting, { key: 'schoolName', value: 'Quick Save School' });
    const el = document.getElementById('save-indicator');
    return { state: el.dataset.state, text: el.textContent };
  });
  assert.deepEqual(during, { state: 'saving', text: 'Saving…' });
  await waitSaved();
  const took = Date.now() - started;
  assert.ok(took < 2000, 'saved ' + took + ' ms after the change');
  const shown = await indicator();
  assert.match(shown.text, /^Saved at \d{1,2}:\d\d$/, 'the 12-hour time carries no AM or PM in the top bar');
  assert.match(shown.title, /last saved on this device at \d{1,2}:\d\d (AM|PM)\.$/);
  assert.equal((await idb('sv2', 'project', 'get', 'current')).project.settings.schoolName, 'Quick Save School');
  await page.evaluate(() => globalThis.sv2.store.apply(globalThis.sv2Actions.setSetting, { key: 'timeFormat', value: '24h' }));
  await waitSaved();
  assert.match((await indicator()).text, /^Saved at \d\d:\d\d$/, 'the project\'s time format');
  assert.match(await page.$eval('#saved [data-line="saved"]', (el) => el.textContent), /It was last saved at \d\d:\d\d\.$/);
});

test('edit, reload: the edit is there, with nothing to undo and no dialog', async () => {
  await rename('Reload Test School');
  await waitSaved();
  await reload();
  assert.equal(await page.$eval('#school-name .school__text', (el) => el.textContent), 'Reload Test School');
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.settings.timeFormat), '24h');
  assert.equal(await page.$('#recovery-dialog'), null);
  assert.equal(await page.$eval('#undo', (el) => el.getAttribute('aria-disabled')), 'true', 'history starts again with the tab');
  assert.equal((await indicator()).state, 'saved', 'a loaded project is a saved one');
  assert.deepEqual(await page.evaluate(() => globalThis.sv2.storage.state.repairs), [], 'a project the tool saved needs no repair');
  const before = (await idb('sv2', 'project', 'get', 'current')).savedAt;
  await pause(1500);
  assert.equal((await idb('sv2', 'project', 'get', 'current')).savedAt, before, 'loading is not a change, so it is not saved again');
});

test('the browser is asked to keep the project, and the answer is on the card', async () => {
  const answer = await page.$eval('#saved [data-line="persist"]', (el) => ({ answer: el.dataset.answer, text: el.textContent }));
  const persisted = await page.evaluate(() => navigator.storage.persisted());
  assert.equal(answer.answer, persisted ? 'kept' : 'best-effort');
  assert.match(answer.text, persisted ? /has agreed to keep the project/ : /may clear the project if the device runs short of room/);
});

test('the room used is on the card, and a banner warns at 80%', async () => {
  assert.match(await page.$eval('#saved [data-line="usage"]', (el) => el.textContent), /^It uses [\d.]+ (bytes|KB|MB) of the [\d.]+ (MB|GB|TB) this browser allows this site \((under 1|\d+)%\)\.$/);
  assert.equal(await page.$('#banner-usage'), null);
  await page.evaluate(async () => {
    globalThis.realEstimate = navigator.storage.estimate.bind(navigator.storage);
    navigator.storage.estimate = async () => ({ usage: 79 * 1024 * 1024, quota: 100 * 1024 * 1024 });
    await globalThis.sv2.storage.refreshUsage();
  });
  assert.equal(await page.$('#banner-usage'), null, '79% is under the line');
  await page.evaluate(async () => {
    navigator.storage.estimate = async () => ({ usage: 80 * 1024 * 1024, quota: 100 * 1024 * 1024 });
    await globalThis.sv2.storage.refreshUsage();
  });
  const banner = await page.$eval('#banner-usage', (el) => ({ text: el.querySelector('p').textContent, role: el.getAttribute('role'), button: el.querySelector('button').textContent }));
  assert.match(banner.text, /nearly out of room for the project: 80 MB of 100 MB used \(80%\)/);
  assert.equal(banner.button, 'Export the project now');
  assert.match(await page.$eval('#saved [data-line="usage"]', (el) => el.textContent), /\(80%\)\. That is nearly all of it/);
  await page.evaluate(async () => {
    navigator.storage.estimate = globalThis.realEstimate;
    await globalThis.sv2.storage.refreshUsage();
  });
  assert.equal(await page.$('#banner-usage'), null, 'the banner goes when the room comes back');
});

// What a click on a download link would have written, without touching the disk.
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

async function lastDownload() {
  await page.waitForFunction(() => globalThis.downloads.length > 0 && globalThis.downloads[globalThis.downloads.length - 1].text !== null);
  return page.evaluate(() => globalThis.downloads[globalThis.downloads.length - 1]);
}

test('a save that fails says so at once in a banner, keeps the work, offers an export, retries, and clears when it works', async () => {
  await catchDownloads();
  await page.evaluate(() => {
    globalThis.sv2.storage.setTiming({ retry: 700 });
    globalThis.sv2.storage.hooks.failWrite = 'The disk is full (a test made this up)';
  });
  const before = (await idb('sv2', 'project', 'get', 'current')).savedAt;
  await rename('Failing Save School');
  await page.waitForSelector('#banner-save-failed');
  const banner = await page.$eval('#banner-save-failed', (el) => ({ text: el.querySelector('p').textContent, role: el.getAttribute('role'), buttons: Array.from(el.querySelectorAll('button'), (button) => button.textContent) }));
  assert.equal(banner.role, 'alert');
  assert.match(banner.text, /^The project is not being saved on this device: The disk is full \(a test made this up\)\. Your work is still in this tab\. Export the project now to keep it\. Saving is tried again every 10 seconds\.$/);
  assert.deepEqual(banner.buttons, ['Export the project now']);
  const shown = await indicator();
  assert.equal(shown.state, 'failed');
  assert.equal(shown.text, 'Not saved: see Project');
  assert.match(shown.title, /The disk is full/);
  assert.match(await page.$eval('#saved [data-line="saved"]', (el) => el.textContent), /^The last save failed: The disk is full/);
  assert.equal(await page.$eval('#school-name .school__text', (el) => el.textContent), 'Failing Save School', 'the work is still on screen');

  // it stays through further tries, and the device still holds the last good save
  await pause(1600);
  assert.notEqual(await page.$('#banner-save-failed'), null, 'the banner is persistent');
  const held = await idb('sv2', 'project', 'get', 'current');
  assert.equal(held.savedAt, before);
  assert.equal(held.project.settings.schoolName, 'Reload Test School');

  await page.click('#banner-save-failed [data-action="export-now"]');
  const file = await lastDownload();
  assert.match(file.name, /^Failing Save School - project - \d{4}-\d\d-\d\d\.json$/);
  assert.equal(readProjectFile(file.text).project.settings.schoolName, 'Failing Save School', 'the export is a project file that reads back');
  assert.match(await page.$eval('#saved [data-line="exported"]', (el) => el.textContent), /^It was last exported to a file at /);

  await page.evaluate(() => {
    globalThis.sv2.storage.hooks.failWrite = null;
  });
  await page.waitForFunction(() => document.getElementById('banner-save-failed') === null, { timeout: 5000 });
  await waitSaved();
  const after = await idb('sv2', 'project', 'get', 'current');
  assert.equal(after.project.settings.schoolName, 'Failing Save School', 'the retry saved the work with no further change');
  assert.match(after.exportedAt, /^\d{4}-\d\d-\d\dT/, 'when it was exported rides in the saved record');
  await page.evaluate(() => globalThis.sv2.storage.setTiming({ retry: 10000 }));
});

test('a traced image is kept while the project or a snapshot names it, and goes in the save after nothing does', async () => {
  const withImage = (imageId) => page.evaluate((id) => {
    const project = globalThis.sv2.store.project;
    const floors = project.building.floors.map((floor, index) => (index === 0
      ? { ...floor, image: id ? { imageId: id, opacity: 0.4, scale: 1, rotation: 0, x: 0, y: 0, visible: true, locked: false, width: 2, height: 2, missing: false } : null }
      : floor));
    globalThis.sv2.store.apply(globalThis.sv2Actions.replaceProject, { project: { ...project, building: { ...project.building, floors } }, label: 'Test: image ' + id });
  }, imageId);
  const blobValue = () => ({ blob: new Blob(['png']), type: 'image/png', width: 2, height: 2 });

  // an image is stored before the project names it; a save that sweeps in between must leave it
  await page.evaluate(async (make) => {
    const value = new Function('return (' + make + ')()')();
    await globalThis.sv2.storage.putImage('ifreshimg0', value);
    await globalThis.sv2.storage.putImage('itestimage', value);
  }, blobValue.toString());
  await withImage('itestimage');
  await waitSaved();
  assert.deepEqual(await idb('sv2', 'images', 'keys'), ['ifreshimg0', 'itestimage'], 'an image stored in this tab and not named yet survives the sweep');

  // a snapshot names a second image; a third is named by nothing
  await page.evaluate(async (make) => {
    const value = new Function('return (' + make + ')()')();
    const open = indexedDB.open('sv2');
    await new Promise((resolve) => {
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(['images', 'snapshots'], 'readwrite');
        tx.objectStore('images').put(value, 'isnapimage');
        tx.objectStore('images').put(value, 'iorphanimg');
        tx.objectStore('snapshots').put({ id: 'ntestsnap0', name: 'A snapshot', takenAt: '2026-09-01T12:00:00.000Z', bytes: 1, project: { building: { floors: [{ image: { imageId: 'isnapimage' } }] } } });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
      };
    });
  }, blobValue.toString());
  assert.deepEqual(await idb('sv2', 'images', 'keys'), ['ifreshimg0', 'iorphanimg', 'isnapimage', 'itestimage']);

  await rename('Image School');
  await waitSaved();
  assert.deepEqual(await idb('sv2', 'images', 'keys'), ['ifreshimg0', 'iorphanimg', 'isnapimage', 'itestimage'], 'a save that changes no image leaves the images alone');

  await withImage(null);
  await waitSaved();
  assert.deepEqual(await idb('sv2', 'images', 'keys'), ['ifreshimg0', 'isnapimage'], 'the project\'s own image and the orphan are gone; the snapshot\'s stays');

  // undo names the image again: the save puts its bytes back
  await page.evaluate(() => globalThis.sv2.store.undo());
  await waitSaved();
  assert.deepEqual(await idb('sv2', 'images', 'keys'), ['ifreshimg0', 'isnapimage', 'itestimage'], 'an undo never leaves the project naming an image the device has lost');
});

test('a recovery point carries the bytes of the images its project names', async () => {
  await page.evaluate(() => globalThis.sv2.storage.takeRecoveryPoint('replace'));
  const points = await idb('sv2-recovery', 'recovery', 'all');
  const newest = points[points.length - 1];
  assert.equal(newest.project.building.floors[0].image.imageId, 'itestimage');
  assert.deepEqual(newest.images, { itestimage: { blob: 3 } }, 'complete on its own');
  assert.ok(newest.bytes > JSON.stringify(newest.project).length, 'the size counts the image');
});

test('a save never overwrites a record newer than the one this tab read: it stops and says so', async () => {
  const foreign = { savedAt: '2999-01-01T00:00:00.000Z', project: { marker: 'another tab wrote this' }, exportedAt: null };
  await put('sv2', 'project', foreign, 'current');
  await rename('Conflict School');
  await page.waitForSelector('#banner-conflict');
  const banner = await page.$eval('#banner-conflict', (el) => ({ text: el.querySelector('p').textContent, buttons: Array.from(el.querySelectorAll('button'), (button) => button.textContent) }));
  assert.match(banner.text, /^Another tab saved this project after this tab read it, so this tab has stopped saving rather than overwrite that work\./);
  assert.deepEqual(banner.buttons, ['Export the project now', 'Reload this tab']);
  assert.equal((await indicator()).text, 'Not saved: see Project');
  await rename('Conflict School Again');
  await pause(1500);
  assert.deepEqual(await idb('sv2', 'project', 'get', 'current'), foreign, 'the other tab\'s record is untouched');
  assert.equal(await page.$('#banner-save-failed'), null, 'a conflict is not a failing disk');
});

test('after all of that the page has logged no error', () => {
  assert.deepEqual(session.problems(), { errors: [], blocked: [], shimmed: [] });
});
