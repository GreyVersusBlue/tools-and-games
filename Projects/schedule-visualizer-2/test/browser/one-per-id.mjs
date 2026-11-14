// The one-per-id rule at every hook, and recovery points and snapshots across
// projects: node test/browser/one-per-id.mjs
//
// A device keeps one project per id (ARCHITECTURE 21.1, 21.10; DESIGN 15.3,
// 15.4). With a kept project of the file's id on the shelf:
//   import         a project file of that id is refused in the dialog, with the
//                  sentence and two buttons (Keep it as another project, Open
//                  <label>), before any snapshot, recovery point or image;
//   receive        a project that arrives with that id is refused the same way,
//                  the sending device is told it was not taken;
//   snapshot       a snapshot of such a project is refused by restore, and the
//                  card's rows of projects no longer here offer Restore as a
//                  project (and, when the project turns out to be kept after
//                  all, the same refusal), never a plain Restore;
//   recovery point the "Of other projects" rows offer Open <label> for a kept
//                  project and Restore as a project for one that is gone.
// Each by the keyboard at 1280 by 900, and the dialogs again by finger at 390
// by 844 with no sideways scroll.
//
// Every wait is on a state the page sets: the dialog being open, the dialogs'
// data-state, a card's data-pending gone, the page after a reload (its marker
// gone, its sections not pending), never on a first paint or a sleep.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, waitForSection, clearSaved, plainSample } from './harness.mjs';

let session;
let page;
const extra = [];
const contexts = [];

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

async function freshDevice(p, s) {
  await p.goto('about:blank');
  await clearSaved(p, s.base);
  await p.goto(s.url('#project'), { waitUntil: 'load' });
  await waitForSection(p, 'project');
  await plainSample(p);
  await waitSaved(p);
  await withActions(p);
}

async function withActions(p) {
  await p.evaluate(async () => {
    globalThis.sv2Actions = await import(new URL('engine/actions.js', document.baseURI).href);
  });
}

// A page in a browser context of its own: its own storage, its own editing tab.
async function lone(size) {
  const context = await session.browser.createBrowserContext();
  context.__engine = session.browser.__engine;
  contexts.push(context);
  const s = await openPlanner({ hash: '#project', server: session.server, browser: context, ...size });
  extra.push(s);
  await s.page.waitForFunction(() => globalThis.sv2 && globalThis.sv2.storage && globalThis.sv2.storage.state.available && !globalThis.sv2.storage.state.readOnly, { timeout: 15000 });
  return s;
}

async function shut(...sessions) {
  for (const s of sessions) {
    await s.close().catch(() => {});
    extra.splice(extra.indexOf(s), 1);
  }
}

before(async () => {
  session = await openPlanner({ hash: '#project' });
  page = session.page;
  await withActions(page);
});

after(async () => {
  for (const s of extra) await s.close().catch(() => {});
  for (const context of contexts) await context.close().catch(() => {});
  if (session) await session.close();
});

const snapshotsHeld = async (p) => (await idb(p, 'sv2', 'snapshots', 'all')).length;
const imagesHeld = (p) => imageKeys(p);

// What has been stored, taken or replaced: the figures a refusal must leave as they were.
async function counts(p) {
  return { snapshots: await snapshotsHeld(p), points: (await points(p)).length, images: (await imagesHeld(p)).length, id: await projectId(p), shelf: await shelfKeys(p) };
}

// The device holds the sample (id psample001) on the shelf and an empty project open.
async function withKept(p, s) {
  await freshDevice(p, s);
  const kept = await projectId(p);
  await through(p, "storage.projects.startAnother('empty')");
  await withActions(p);
  const label = await p.evaluate((id) => globalThis.sv2.storage.projects.holds(id), kept);
  assert.equal(typeof label, 'string');
  return { kept, open: await projectId(p), label };
}

// A project file whose project is the open one's, under another id.
const fileOf = (p, id) => p.evaluate(async (wanted) => {
  const { writeProjectFile } = await import(new URL('engine/project-file.js', document.baseURI).href);
  const project = { ...JSON.parse(JSON.stringify(globalThis.sv2.store.project)), id: wanted };
  return writeProjectFile(project, { images: {} });
}, id);

const chooseFile = (p, name, contents) => p.evaluate((fileName, text) => {
  const input = document.querySelector('#project-file input[type="file"][data-file="project"]');
  const data = new DataTransfer();
  data.items.add(new File([text], fileName));
  input.files = data.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}, name, contents);

const dialogButtons = (p, id) => p.$$eval('#' + id + ' .dialog__buttons button', (buttons) => buttons.map((button) => button.textContent));
const focused = (p) => p.evaluate(() => document.activeElement.textContent);

// Shift+Tab to the previous control, then Enter: the keyboard's way to the first button.
async function backAndEnter(p) {
  await p.keyboard.down('Shift');
  await p.keyboard.press('Tab');
  await p.keyboard.up('Shift');
  await p.keyboard.press('Enter');
}

// No sideways scroll, and the box inside the window.
async function fits(p, selector) {
  const seen = await p.evaluate((wanted) => {
    const box = document.querySelector(wanted).getBoundingClientRect();
    return { scroll: document.documentElement.scrollWidth - innerWidth, left: box.left, right: box.right, width: innerWidth };
  }, selector);
  assert.ok(seen.scroll <= 0 && seen.left >= 0 && seen.right <= seen.width, selector + ' fits the window: ' + JSON.stringify(seen));
}

const sentence = (what, label, again) => 'This ' + (what === 'point' ? 'recovery point' : what) + ' is a copy of ' + label + ', which is also kept on this device. Open ' + label + ' first, then ' + again + ', or keep it as another project. Nothing was replaced.';

// ---------------------------------------------------------------- import

// The import hook, by `how` ('keyboard' | 'tap') in the page `p` of session `s`.
async function importRefused(p, s, how) {
  const { kept, open, label } = await withKept(p, s);
  const text = await fileOf(p, kept);
  const before = await counts(p);
  await chooseFile(p, 'next year <b>.json', text);
  await p.waitForSelector('dialog#held-refusal[open]');
  assert.equal(await p.$eval('#held-refusal [role="alert"]', (el) => el.textContent), sentence('file', label, 'choose the file again'));
  assert.deepEqual(await dialogButtons(p, 'held-refusal'), ['Keep it as another project', 'Open ' + label], 'the sentence and two buttons');
  assert.equal(await focused(p), 'Open ' + label, 'Open, which changes nothing, is the focused one');
  assert.equal(await p.$eval('#project-file [data-line="result"]', (el) => el.dataset.result), 'refused', 'the card says so as well');
  assert.deepEqual(await counts(p), before, 'nothing was snapshotted, kept as a recovery point, stored or replaced');
  if (how === 'tap') await fits(p, 'dialog#held-refusal');
  // Escape is not a way on: nothing changes and the focus returns to the opener
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => document.getElementById('held-refusal') === null);
  assert.equal(await p.evaluate(() => document.activeElement.dataset.action), 'import-project');
  assert.deepEqual(await counts(p), before);

  // Keep it as another project: a copy with an identity of its own, opened
  await chooseFile(p, 'next year.json', text);
  await p.waitForSelector('dialog#held-refusal[open]');
  await p.evaluate(() => {
    globalThis.__before = true;
  });
  if (how === 'tap') await p.tap('#held-refusal .dialog__buttons button:first-child');
  else await backAndEnter(p);
  await loaded(p);
  const copy = await current(p);
  assert.ok(![kept, open].includes(copy.project.id), 'the copy has an id of its own');
  assert.match(copy.project.label, / \(another copy\)$/);
  assert.deepEqual(await shelfKeys(p), ['shelf:' + kept, 'shelf:' + open].sort(), 'both projects that were here stay kept');

  // Open <label>: the file is forgotten and the kept project is the open one
  await withActions(p);
  await chooseFile(p, 'next year.json', text);
  await p.waitForSelector('dialog#held-refusal[open]');
  await p.evaluate(() => {
    globalThis.__before = true;
  });
  if (how === 'tap') await p.tap('#held-refusal .dialog__buttons button:last-child');
  else await p.keyboard.press('Enter');
  await loaded(p);
  assert.equal(await projectId(p), kept, 'the kept project is open');
  assert.equal(await shelfOf(p, kept), null, 'and no longer on the shelf');
}

test('import by the keyboard at 1280: a project file that is a copy of a kept project is refused with Open and Keep, before any snapshot or image', async () => {
  await importRefused(page, session, 'keyboard');
});

test('import by finger at 390 by 844: the same refusal, inside the window', async () => {
  const phone = await lone({ width: 390, height: 844, mobile: true });
  try {
    await importRefused(phone.page, phone, 'tap');
    assert.deepEqual(phone.problems().errors, []);
  } finally {
    await shut(phone);
  }
});

test('import: the open project\'s own id is not a refusal (a newer copy replaces it as before)', async () => {
  await freshDevice(page, session);
  const text = await fileOf(page, await projectId(page));
  await chooseFile(page, 'same.json', text);
  await page.waitForSelector('dialog.dialog[open]');
  assert.equal(await page.$('#held-refusal'), null);
  assert.match(await page.$eval('dialog.dialog[open] h2', (el) => el.textContent), /^Replace this project with the one in /);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('dialog[open]') === null);
});

// ---------------------------------------------------------------- receive

async function pressOn(p, selector) {
  await p.focus(selector);
  await p.keyboard.press('Enter');
}

async function pasteCode(p, kind, code, how) {
  const field = 'textarea[data-paste="' + kind + '"]';
  if (how === 'tap') await p.tap(field);
  else await p.focus(field);
  await p.keyboard.sendCharacter(code);
  if (how === 'tap') await p.tap('[data-action="connect-' + kind + '"]');
  else {
    await p.keyboard.press('Tab');
    await p.keyboard.press('Enter');
  }
}

const reaches = (p, id, states) => p.waitForFunction((which, wanted) => {
  const el = document.getElementById(which);
  return el && wanted.includes(el.dataset.state);
}, { timeout: 30000 }, id, states).then(() => p.$eval('#' + id, (el) => el.dataset.state));

// `choice`: what is done in the refusal: 'keep' (Keep it as another project), 'open' (Open <label>) or 'close' (Escape).
async function receiveRefused(size, how, choice) {
  const a = await lone(size);
  const b = await lone(size);
  try {
    const sender = a.page;
    const there = b.page;
    await withActions(sender);
    await withActions(there);
    // both start on the sample school (one id); the receiving device keeps its copy on the shelf
    const sampleId = await projectId(there);
    assert.equal(sampleId, await projectId(sender), 'one project, on two devices');
    await through(there, "storage.projects.startAnother('empty')");
    const label = await there.evaluate((id) => globalThis.sv2.storage.projects.holds(id), sampleId);
    const before = await counts(there);

    if (how === 'tap') await sender.tap('[data-action="send-project"]');
    else await pressOn(sender, '[data-action="send-project"]');
    await reaches(sender, 'transfer-send', ['offer']);
    const offer = await sender.$eval('textarea[data-code="offer"]', (el) => el.value);
    if (how === 'tap') await there.tap('[data-action="receive-project"]');
    else await pressOn(there, '[data-action="receive-project"]');
    await reaches(there, 'transfer-receive', ['offer']);
    await pasteCode(there, 'offer', offer, how);
    await reaches(there, 'transfer-receive', ['reply']);
    const answer = await there.$eval('textarea[data-code="answer"]', (el) => el.value);
    await pasteCode(sender, 'answer', answer, how);

    assert.equal(await reaches(there, 'transfer-receive', ['held', 'confirm', 'applied', 'failed', 'lost']), 'held', 'refused, never asked "Replace my project"');
    assert.equal(await there.$eval('#transfer-receive [data-line="status"]', (el) => el.textContent), sentence('project', label, 'send it again'));
    assert.deepEqual(await there.$$eval('#transfer-receive [data-action="keep-held"], #transfer-receive [data-action="open-held"]', (buttons) => buttons.map((button) => button.textContent)), ['Keep it as another project', 'Open ' + label]);
    assert.equal(await there.$('#transfer-receive [data-action="replace-project"]'), null, 'no way to replace');
    assert.equal(await focused(there), 'Open ' + label);
    // the sending device is not told "not taken" before the person has chosen
    await there.waitForFunction(() => document.querySelector('#transfer-receive [data-action="keep-held"]') !== null);
    assert.equal(await sender.$eval('#transfer-send', (el) => el.dataset.state), 'sent', 'still waiting for the reply while the question is open');
    assert.deepEqual(await counts(there), before, 'no snapshot, recovery point or image on the receiving device');
    if (how === 'tap') await fits(there, 'dialog#transfer-receive');

    if (choice === 'close') {
      await there.keyboard.press('Escape');
      assert.equal(await reaches(sender, 'transfer-send', ['not-taken', 'applied', 'lost', 'failed']), 'not-taken', 'Cancel: told it was not taken');
      assert.deepEqual(await counts(there), before);
      return;
    }
    await there.evaluate(() => {
      globalThis.__before = true;
    });
    if (choice === 'open') {
      if (how === 'tap') await there.tap('[data-action="open-held"]');
      else await there.keyboard.press('Enter');
      await loaded(there);
      assert.equal(await projectId(there), sampleId, 'the kept project is open');
      assert.equal(await reaches(sender, 'transfer-send', ['not-taken', 'applied', 'lost', 'failed']), 'not-taken', 'Open: told it was not taken');
      return;
    }
    if (how === 'tap') await there.tap('[data-action="keep-held"]');
    else await backAndEnter(there);
    await loaded(there);
    const copy = await current(there);
    assert.notEqual(copy.project.id, sampleId);
    assert.match(copy.project.label, / \(another copy\)$/);
    assert.ok((await shelfKeys(there)).includes('shelf:' + sampleId), 'the kept project is still kept');
    // the protocol has no word for "kept as another project": the reply is received-and-applied
    assert.equal(await reaches(sender, 'transfer-send', ['not-taken', 'applied', 'lost', 'failed']), 'applied', 'Keep it as another project: told it was received and applied');
    assert.deepEqual(a.problems().errors, []);
  } finally {
    await shut(a, b);
  }
}

test('receive by the keyboard at 1280: a project that arrives as a copy of a kept one is refused with Open and Keep, and the sender is told', async () => {
  await receiveRefused({ width: 1280, height: 900 }, 'keyboard', 'keep');
});

test('receive: Escape in the refusal tells the sender it was not taken, and nothing was stored; Open <label> tells it the same and opens the kept project', async () => {
  await receiveRefused({ width: 1280, height: 900 }, 'keyboard', 'close');
  await receiveRefused({ width: 1280, height: 900 }, 'keyboard', 'open');
});

test('receive by finger at 390 by 844: the same, inside the window', async () => {
  await receiveRefused({ width: 390, height: 844, mobile: true }, 'tap', 'keep');
});

// ---- the guards of SV2-118b

// A kept project's record on the shelf under `id`, as a copy of the open project.
const shelve = (p, id, label) => p.evaluate((wanted, name) => new Promise((resolve, reject) => {
  const open = indexedDB.open('sv2');
  open.onsuccess = () => {
    const db = open.result;
    const tx = db.transaction('project', 'readwrite');
    const store = tx.objectStore('project');
    const got = store.get('current');
    got.onsuccess = () => {
      const record = got.result;
      store.put({ savedAt: record.savedAt, project: { ...record.project, id: wanted, label: name }, exportedAt: null, shelvedAt: record.savedAt, bytes: 1, images: {} }, 'shelf:' + wanted);
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  };
}), id, label);

const withoutHolds = (p) => p.evaluate(() => {
  const { projects } = globalThis.sv2.storage;
  globalThis.__holds = projects.holds;
  projects.holds = undefined;
});
const withHolds = (p) => p.evaluate(() => {
  globalThis.sv2.storage.projects.holds = globalThis.__holds;
});
const resultOf = (p) => p.waitForFunction(() => document.querySelector('#project-file [data-line="result"]').dataset.result === 'refused', { timeout: 10000 })
  .then(() => p.$eval('#project-file [data-line="result"] p', (el) => el.textContent));

test('import: the refusal is said once, in the dialog; the card line says only that nothing was imported and replaces a stale line', async () => {
  const { kept, label } = await withKept(page, session);
  // an earlier outcome leaves a line: a file of the open id, read and declined
  await chooseFile(page, 'same.json', await fileOf(page, await projectId(page)));
  await page.waitForSelector('dialog.dialog[open]');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('dialog[open]') === null);
  assert.match(await page.$eval('#project-file [data-line="result"] p', (el) => el.textContent), /was read and not imported/);
  await chooseFile(page, 'next year.json', await fileOf(page, kept));
  await page.waitForSelector('dialog#held-refusal[open]');
  const line = await page.$eval('#project-file [data-line="result"] p', (el) => el.textContent);
  assert.equal(line, '“next year.json” was not imported, and nothing has changed.');
  assert.ok(!line.includes('is a copy of'), 'the sentence of the refusal is in the dialog only');
  assert.equal(await page.$$eval('[role="alert"]', (all) => all.filter((el) => el.textContent.includes('is a copy of ' + '')).length), 1, 'one alert says it: ' + label);
  await page.keyboard.press('Escape');
});

test('import: a hostile label in the refusal is text, in the sentence and on Open', async () => {
  const { kept } = await withKept(page, session);
  const hostile = '<img src=x onerror=alert(1)> Next';
  await shelve(page, kept, hostile);
  await chooseFile(page, 'next year.json', await fileOf(page, kept));
  await page.waitForSelector('dialog#held-refusal[open]');
  assert.equal(await page.$('#held-refusal img'), null);
  assert.deepEqual(await dialogButtons(page, 'held-refusal'), ['Keep it as another project', 'Open ' + hostile]);
  assert.equal(await page.$eval('#held-refusal [role="alert"]', (el) => el.textContent), sentence('file', hostile, 'choose the file again'));
  await page.keyboard.press('Escape');
});

test('import: the shelf changing while the question is open refuses at Replace, before any snapshot, image or recovery point', async () => {
  await freshDevice(page, session);
  const id = 'plate00001';
  await chooseFile(page, 'late.json', await fileOf(page, id));
  await page.waitForSelector('dialog.dialog[open]');
  assert.equal(await page.$('#held-refusal'), null, 'not held when the question was asked');
  await shelve(page, id, 'Late twin');
  const before = await counts(page);
  await page.click('dialog.dialog[open] .dialog__buttons button:first-child');
  await page.waitForSelector('dialog#held-refusal[open]');
  assert.deepEqual(await dialogButtons(page, 'held-refusal'), ['Keep it as another project', 'Open Late twin']);
  assert.deepEqual(await counts(page), before, 'nothing stored, snapshotted or replaced');
  await page.keyboard.press('Escape');
});

test('import: with no way to ask which projects are kept, the file is refused before any question, snapshot or image', async () => {
  await freshDevice(page, session);
  const before = await counts(page);
  await withoutHolds(page);
  try {
    await chooseFile(page, 'absent.json', await fileOf(page, 'pabsent001'));
    assert.match(await resultOf(page), /was not imported, and nothing has changed, because this device could not be asked which projects it keeps\./);
    assert.equal(await page.$('dialog.dialog[open]'), null, 'nothing asked');
  } finally {
    await withHolds(page);
  }
  assert.deepEqual(await counts(page), before);
});

test('a building file has no id check and none is wanted: it goes to its own question even with a kept project of the open id\'s family', async () => {
  await withKept(page, session);
  const text = await page.evaluate(async () => {
    const { buildExport } = await import(new URL('engine/exports.js', document.baseURI).href);
    return buildExport(globalThis.sv2.store.project, 'building', { date: new Date(), images: {} }).text;
  });
  await page.evaluate((contents) => {
    const input = document.querySelector('#project-file input[type="file"][data-file="building"]');
    const data = new DataTransfer();
    data.items.add(new File([contents], 'building.json'));
    input.files = data.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, text);
  await page.waitForSelector('dialog.dialog[open]');
  assert.equal(await page.$('#held-refusal'), null);
  assert.match(await page.$eval('dialog.dialog[open] h2', (el) => el.textContent), /^Replace the building with the one in /);
  await page.keyboard.press('Escape');
});

// Two devices on the sample school; the receiving one is made ready by `ready(there, sampleId)`; the project is sent;
// resolves what the receiving dialog reached.
async function pairAndSend(ready) {
  const a = await lone({ width: 1280, height: 900 });
  const b = await lone({ width: 1280, height: 900 });
  const sender = a.page;
  const there = b.page;
  await withActions(sender);
  await withActions(there);
  const sampleId = await projectId(there);
  await ready(there, sampleId);
  const before = await counts(there);
  await pressOn(sender, '[data-action="send-project"]');
  await reaches(sender, 'transfer-send', ['offer']);
  const offer = await sender.$eval('textarea[data-code="offer"]', (el) => el.value);
  await pressOn(there, '[data-action="receive-project"]');
  await reaches(there, 'transfer-receive', ['offer']);
  await pasteCode(there, 'offer', offer, 'keyboard');
  await reaches(there, 'transfer-receive', ['reply']);
  const answer = await there.$eval('textarea[data-code="answer"]', (el) => el.value);
  await pasteCode(sender, 'answer', answer, 'keyboard');
  return { a, b, sender, there, sampleId, before };
}

test('receive: the shelf changing while the question is open refuses at Replace, the sender is told it was not taken, nothing is stored', async () => {
  const rig = await pairAndSend(async (there, sampleId) => {
    await through(there, "storage.projects.startAnother('empty')");
    assert.equal((await ask(there, 'storage.projects.remove(arg)', sampleId)).ok, true);
  });
  try {
    assert.equal(await reaches(rig.there, 'transfer-receive', ['held', 'confirm', 'applied', 'failed', 'lost']), 'confirm');
    await shelve(rig.there, rig.sampleId, 'Late twin');
    const before = await counts(rig.there);
    await rig.there.click('#transfer-receive [data-action="replace-project"]');
    assert.equal(await reaches(rig.there, 'transfer-receive', ['held', 'applied', 'failed']), 'held');
    assert.deepEqual(await counts(rig.there), before, 'no snapshot, recovery point or image');
    assert.equal(await rig.sender.$eval('#transfer-send', (el) => el.dataset.state), 'sent', 'not told yet');
    await rig.there.keyboard.press('Escape');
    assert.equal(await reaches(rig.sender, 'transfer-send', ['not-taken', 'applied', 'lost', 'failed']), 'not-taken');
  } finally {
    await shut(rig.a, rig.b);
  }
});

test('receive: with no way to ask which projects are kept the project is refused, the sender is told, nothing is stored', async () => {
  let before;
  const rig = await pairAndSend(async (there, sampleId) => {
    await through(there, "storage.projects.startAnother('empty')");
    await withoutHolds(there);
  });
  try {
    assert.equal(await reaches(rig.there, 'transfer-receive', ['held', 'confirm', 'applied', 'failed', 'lost']), 'failed');
    assert.match(await rig.there.$eval('#transfer-receive [data-line="status"]', (el) => el.textContent), /could not be asked which projects it keeps, so nothing was changed\./);
    assert.equal(await reaches(rig.sender, 'transfer-send', ['not-taken', 'applied', 'lost', 'failed']), 'not-taken');
    before = rig.before;
    assert.deepEqual(await counts(rig.there), before);
  } finally {
    await shut(rig.a, rig.b);
  }
});

// ---------------------------------------------------------------- snapshots

const snapshotsCardReady = (p) => p.waitForFunction(() => {
  const el = document.getElementById('snapshots');
  return el && el.dataset.state === 'ready' && el.dataset.pending === undefined;
}, { timeout: 15000 });

async function takeSnapshot(p, name) {
  return p.evaluate(async (wanted) => {
    const { pageSnapshots } = await import(new URL('storage/snapshots.js', document.baseURI).href);
    return (await pageSnapshots().take(wanted)).id;
  }, name);
}

test('snapshots: restore refuses a snapshot of a kept project before any image or recovery point; the card lists the open project\'s and counts the others', async () => {
  await freshDevice(page, session);
  const kept = await projectId(page);
  const id = await takeSnapshot(page, 'Sample day <i>one</i>');
  await through(page, "storage.projects.startAnother('empty')");
  await withActions(page);
  await snapshotsCardReady(page);
  const label = await page.evaluate((own) => globalThis.sv2.storage.projects.holds(own), kept);
  const card = await page.$eval('#snapshots', (el) => ({ mine: el.dataset.snapshots, others: el.dataset.others, gone: el.dataset.gone, status: el.querySelector('[data-line="snapshots"]').textContent, goneHidden: el.querySelector('[data-disclosure="gone-snapshots"]').hidden }));
  assert.deepEqual([card.mine, card.others, card.gone, card.goneHidden], ['0', '1', '0', true], 'the snapshot of a kept project is counted, not listed');
  assert.match(card.status, /1 more is of other projects; the limit of 30 is for the whole device\.$/);
  const before = await counts(page);
  const refused = await page.evaluate(async (snapshotId) => {
    const { pageSnapshots } = await import(new URL('storage/snapshots.js', document.baseURI).href);
    try {
      await pageSnapshots().restore(snapshotId);
      return { restored: true };
    } catch (error) {
      return { code: error.code, held: error.held, text: error.message };
    }
  }, id);
  assert.equal(refused.code, 'held');
  assert.deepEqual(refused.held, { id: kept, label });
  assert.match(refused.text, /^This snapshot is a copy of .* which is also kept on this device\. Open .* first, or keep it as another project\. Nothing was replaced\.$/);
  assert.deepEqual(await counts(page), before, 'no recovery point, image or replacement');
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.id), before.id);
});

test('snapshots: a snapshot of a project no longer here is listed apart with Export, Restore as a project and Delete, never a plain Restore, and restores as a project by the keyboard', async () => {
  await freshDevice(page, session);
  const gone = await projectId(page);
  const id = await takeSnapshot(page, 'Sample day <i>two</i>');
  await through(page, "storage.projects.startAnother('empty')");
  await withActions(page);
  assert.equal((await ask(page, 'storage.projects.remove(arg)', gone)).ok, true);
  await snapshotsCardReady(page);
  const card = await page.$eval('#snapshots', (el) => ({ mine: el.dataset.snapshots, gone: el.dataset.gone, hidden: el.querySelector('[data-disclosure="gone-snapshots"]').hidden, title: el.querySelector('[data-line="gone-title"]').textContent, status: el.querySelector('[data-line="snapshots"]').textContent }));
  assert.deepEqual([card.mine, card.gone, card.hidden], ['0', '1', false]);
  assert.equal(card.title, 'Of projects no longer on this device (1)');
  assert.match(card.status, /1 more is of other projects/);
  const row = '#snapshots [data-disclosure="gone-snapshots"] [data-snapshot="' + id + '"]';
  await page.$eval('#snapshots [data-disclosure="gone-snapshots"]', (el) => {
    el.open = true;
  });
  assert.deepEqual(await page.$$eval(row + ' button', (buttons) => buttons.map((button) => button.textContent)), ['Export', 'Restore as a project', 'Delete']);
  assert.equal(await page.$('#snapshots [data-action="restore"]'), null, 'a plain Restore is offered for no snapshot of another project');
  assert.equal(await page.$eval(row + ' [data-line="of-project"] bdi', (el) => el.textContent.length > 0), true);
  assert.equal(await page.$eval(row + ' .snap__name bdi', (el) => el.textContent), 'Sample day <i>two</i>', 'a name is text');
  const before = await counts(page);
  // a plain restore of it is refused by the storage itself, whatever the card offers
  const plain = await page.evaluate(async (snapshotId) => {
    const { pageSnapshots } = await import(new URL('storage/snapshots.js', document.baseURI).href);
    try {
      await pageSnapshots().restore(snapshotId);
      return 'restored';
    } catch (error) {
      return error.code;
    }
  }, id);
  assert.equal(plain, 'other-project');
  assert.deepEqual(await counts(page), before, 'and nothing moved');
  // the stale case: the project is kept after all by the time the button is pressed
  const record = await current(page);
  await write(page, 'sv2', 'project', 'put', { savedAt: record.savedAt, project: { ...record.project, id: gone, label: 'Kept twin' }, exportedAt: null, shelvedAt: record.savedAt, bytes: 1, images: {} }, 'shelf:' + gone);
  await page.focus(row + ' [data-action="restore-as-project"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('dialog#held-refusal[open]');
  assert.deepEqual(await dialogButtons(page, 'held-refusal'), ['Keep it as another project', 'Open Kept twin']);
  assert.equal(await page.$eval('#held-refusal [role="alert"]', (el) => el.textContent), sentence('snapshot', 'Kept twin', 'restore it again'));
  assert.equal(await snapshotsHeld(page), before.snapshots, 'no snapshot was taken');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('held-refusal') === null);
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.id), before.id, 'nothing was replaced');
  // the card drew the row again: it offers Open on the row, in the open project's list
  await page.waitForFunction((wanted) => document.querySelector('#snapshots [data-snapshot="' + wanted + '"] [data-action="open-project"]') !== null, {}, id);
  assert.equal(await page.$eval('#snapshots [data-snapshot="' + id + '"] [data-action="open-project"]', (el) => el.textContent), 'Open Kept twin');
  await write(page, 'sv2', 'project', 'delete', null, 'shelf:' + gone);
  await page.evaluate(() => globalThis.sv2.navigate('#building'));
  await page.evaluate(() => globalThis.sv2.navigate('#project'));
  await snapshotsCardReady(page);
  await page.$eval('#snapshots [data-disclosure="gone-snapshots"]', (el) => {
    el.open = true;
  });
  // and with the project truly gone: restored as a project, opened
  await page.evaluate(() => {
    globalThis.__before = true;
  });
  await page.focus(row + ' [data-action="restore-as-project"]');
  await page.keyboard.press('Enter');
  await loaded(page);
  assert.equal(await projectId(page), gone, 'the project of the snapshot is the open one');
  assert.ok((await shelfKeys(page)).length >= 1, 'the project that was open is kept');
});

test('snapshots at 390 by 844: the disclosure and its rows fit, with no sideways scroll', async () => {
  const phone = await lone({ width: 390, height: 844, mobile: true });
  try {
    const p = phone.page;
    await freshDevice(p, phone);
    const gone = await projectId(p);
    await takeSnapshot(p, 'Before moving 7th grade');
    await through(p, "storage.projects.startAnother('empty')");
    await withActions(p);
    assert.equal((await ask(p, 'storage.projects.remove(arg)', gone)).ok, true);
    await snapshotsCardReady(p);
    await p.$eval('#snapshots [data-disclosure="gone-snapshots"]', (el) => {
      el.open = true;
    });
    await fits(p, '#snapshots [data-disclosure="gone-snapshots"]');
    assert.deepEqual(phone.problems().errors, []);
  } finally {
    await shut(phone);
  }
});

// ---------------------------------------------------------------- recovery points

const pointsCardReady = (p) => p.waitForFunction(() => {
  const el = document.getElementById('recovery');
  return el && el.dataset.points !== undefined;
}, { timeout: 15000 });

test('recovery points: the open project\'s, then Of other projects with labels; Open <label> for a kept project, Restore as a project for a gone one, never a plain Restore', async () => {
  await freshDevice(page, session);
  const kept = await projectId(page);
  await through(page, "storage.projects.startAnother('empty')");
  await withActions(page);
  await pointsCardReady(page);
  const label = await page.evaluate((own) => globalThis.sv2.storage.projects.holds(own), kept);
  const rows = '#recovery [data-disclosure="other-points"] tr[data-project="' + kept + '"]';
  await page.waitForSelector(rows);
  assert.equal(await page.$eval('#recovery [data-line="others-title"]', (el) => /^Of other projects \(\d+\)$/.test(el.textContent)), true);
  await page.$eval('#recovery [data-disclosure="other-points"]', (el) => {
    el.open = true;
  });
  assert.equal(await page.$eval(rows + ' [data-line="point-project"]', (el) => el.textContent), label, 'the project\'s label comes first');
  const own = await page.$$eval('#recovery tbody tr', (trs) => trs.filter((tr) => !tr.closest('details')).map((tr) => tr.dataset.project || ''));
  assert.ok(!own.includes(kept), 'the open project\'s list holds none of the other project\'s');
  assert.deepEqual(await page.$$eval(rows + ' button', (buttons) => buttons.map((button) => button.textContent)), ['Open ' + label, 'Export', 'Delete']);
  assert.equal(await page.$('#recovery [data-disclosure="other-points"] [data-action="restore"]'), null, 'no plain Restore on another project\'s point');
  await page.evaluate(() => {
    globalThis.__before = true;
  });
  await page.focus(rows + ' [data-action="open-project"]');
  await page.keyboard.press('Enter');
  await loaded(page);
  assert.equal(await projectId(page), kept, 'Open <label> opens the kept project');

  // gone: remove it and its point is Restore as a project
  await withActions(page);
  const other = (await ask(page, 'storage.projects.list()')).find((entry) => !entry.open).id;
  assert.equal((await ask(page, 'storage.projects.remove(arg)', other)).ok, true);
  await pointsCardReady(page);
  const goneRows = '#recovery [data-disclosure="other-points"] tr[data-project="' + other + '"]';
  await page.waitForSelector(goneRows);
  await page.$eval('#recovery [data-disclosure="other-points"]', (el) => {
    el.open = true;
  });
  const names = await page.$$eval(goneRows + ' button', (buttons) => buttons.map((button) => button.textContent));
  assert.equal(names[0], 'Restore as a project');
  assert.equal(await page.$('#recovery [data-disclosure="other-points"] [data-action="restore"]'), null);
  await page.evaluate(() => {
    globalThis.__before = true;
  });
  await page.focus(goneRows + ' [data-action="restore-as-project"]');
  await page.keyboard.press('Enter');
  await loaded(page);
  assert.equal(await projectId(page), other, 'restored as a project and opened');
});

test('recovery points: a point whose project turns out to be kept after the list was drawn is refused with Open only', async () => {
  await freshDevice(page, session);
  const gone = await projectId(page);
  await through(page, "storage.projects.startAnother('empty')");
  await withActions(page);
  assert.equal((await ask(page, 'storage.projects.remove(arg)', gone)).ok, true);
  await pointsCardReady(page);
  const row = '#recovery [data-disclosure="other-points"] tr[data-project="' + gone + '"]';
  await page.waitForSelector(row);
  await page.$eval('#recovery [data-disclosure="other-points"]', (el) => {
    el.open = true;
  });
  const record = await current(page);
  await write(page, 'sv2', 'project', 'put', { savedAt: record.savedAt, project: { ...record.project, id: gone, label: 'Kept twin' }, exportedAt: null, shelvedAt: record.savedAt, bytes: 1, images: {} }, 'shelf:' + gone);
  const before = await counts(page);
  await page.focus(row + ' [data-action="restore-as-project"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('dialog#held-refusal[open]');
  assert.deepEqual(await dialogButtons(page, 'held-refusal'), ['Open Kept twin'], 'a recovery point cannot be kept as a file copy, so Open is the one way on');
  assert.equal(await page.$eval('#held-refusal [role="alert"]', (el) => el.textContent), sentence('point', 'Kept twin', 'restore it again').replace(', or keep it as another project', ''));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('held-refusal') === null);
  assert.deepEqual(await counts(page), { ...before, shelf: before.shelf }, 'nothing was replaced');
});

test('recovery points: rows of other projects name the label (in the button\'s name too), a hostile label is text, Open is busy once, and focus goes on after it', async () => {
  const hostile = '<img src=x onerror=alert(1)> Next';
  await freshDevice(page, session);
  const kept = await projectId(page);
  await page.evaluate((label) => globalThis.sv2.store.apply(globalThis.sv2Actions.setProjectLabel, { label }), hostile);
  await waitSaved(page);
  await through(page, "storage.projects.startAnother('empty')");
  await withActions(page);
  await pointsCardReady(page);
  const rows = '#recovery [data-disclosure="other-points"] tr[data-project="' + kept + '"]';
  await page.waitForSelector(rows);
  await page.$eval('#recovery [data-disclosure="other-points"]', (el) => {
    el.open = true;
  });
  assert.equal(await page.$eval(rows + ' [data-line="point-project"]', (el) => el.textContent), hostile);
  assert.equal(await page.$('#recovery img'), null);
  const names = await page.$$eval(rows + ' button', (all) => all.map((b) => [b.textContent, b.getAttribute('aria-label')]));
  assert.equal(names[0][0], 'Open ' + hostile);
  for (const [visible, name] of names) assert.ok(name.startsWith(visible), name);
  assert.ok(names.every(([, name]) => name.includes(hostile)), 'each name says whose point it is');
  // busy: two presses, one call
  await page.evaluate(() => {
    globalThis.calls = 0;
    globalThis.sv2.storage.projects.open = () => {
      globalThis.calls += 1;
      return new Promise((resolve) => {
        globalThis.release = () => resolve({ ok: false, code: 'refused', text: 'Not opened (a test made this up).' });
      });
    };
  });
  const open = rows + ' [data-action="open-project"]';
  await page.click(open);
  await page.waitForFunction((selector) => document.querySelector(selector).getAttribute('aria-busy') === 'true', { timeout: 5000 }, open);
  await page.click(open);
  assert.equal(await page.evaluate(() => globalThis.calls), 1, 'the second press did nothing');
  await page.evaluate(() => globalThis.release());
  await page.waitForFunction(() => !document.querySelector('#recovery [data-line="point-problem"]').hidden);
  assert.equal(await page.$eval('#recovery [data-line="point-problem"]', (el) => el.textContent), 'Not opened (a test made this up).');
  assert.equal(await page.$eval(open, (el) => el.getAttribute('aria-busy')), null);
});

test('recovery points: unreadable and unclassed points of a device with several projects are listed apart, in no count', async () => {
  await withKept(page, session);
  await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const open = indexedDB.open('sv2-recovery');
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('recovery', 'readwrite');
        tx.objectStore('recovery').add({ takenAt: '2026-01-01T10:00:00.000Z', reason: 'timer', junk: true });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
    await globalThis.sv2.storage.takeRecoveryPoint('replace');
  });
  await page.waitForFunction(() => document.getElementById('recovery').dataset.unreadable === '1', { timeout: 10000 });
  assert.equal(await page.$eval('#recovery [data-line="broken-title"]', (el) => el.textContent), 'Cannot be read (1)');
  const inOthers = await page.$$eval('#recovery [data-disclosure="other-points"] tr', (all) => all.length);
  const countAll = await page.$eval('#recovery', (el) => Number(el.dataset.points) + Number(el.dataset.others) + Number(el.dataset.unreadable));
  assert.ok(countAll >= 3 && inOthers >= 1);
});
