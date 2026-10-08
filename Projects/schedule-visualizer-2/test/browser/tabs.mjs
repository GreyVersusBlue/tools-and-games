// Two tabs on one project, in a real browser: node test/browser/tabs.mjs
//
// The first tab edits. A second tab on the same origin is told, is
// read-only, and takes over within 5 s of the first one closing, starting
// from what the first one last saved. Web Locks first; then the same again
// with Web Locks taken away, which leaves the heartbeat in localStorage. The
// heartbeat's own rules (2 s, stale after 60 s) run in Node with a clock the
// test moves by hand.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, startServer, launch, waitForSection } from './harness.mjs';
import { watchTabs, TAB_LOCK, TAB_KEY, TAB_RETRY_MS, TAB_BEAT_MS, TAB_STALE_MS } from '../../storage/tabs.js';

let server;
let browser;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// open({ keep, noLocks }): noLocks loads the page again as a browser without
// Web Locks would run it.
async function open(options) {
  const session = await openPlanner({ hash: '#project', server, browser, keep: options && options.keep });
  if (options && options.noLocks) {
    await session.page.evaluateOnNewDocument(() => {
      Object.defineProperty(Navigator.prototype, 'locks', { get: () => undefined, configurable: true });
    });
    await session.page.reload({ waitUntil: 'load' });
    await waitForSection(session.page, 'project');
  }
  await session.page.evaluate(async () => {
    globalThis.sv2Actions = await import(new URL('engine/actions.js', document.baseURI).href);
  });
  return session;
}

const rename = (page, name) => page.evaluate((value) => {
  globalThis.sv2.store.apply(globalThis.sv2Actions.setSetting, { key: 'schoolName', value });
}, name);
const schoolShown = (page) => page.$eval('#school-name .school__text', (el) => el.textContent);
const waitSaved = (page) => page.waitForFunction(() => document.getElementById('save-indicator').dataset.state === 'saved' && !globalThis.sv2.storage.pending, { timeout: 10000 });
const indicator = (page) => page.$eval('#save-indicator', (el) => el.dataset.state + '|' + el.textContent);
const savedName = (page) => page.evaluate(() => new Promise((resolve) => {
  const openDb = indexedDB.open('sv2');
  openDb.onsuccess = () => {
    const db = openDb.result;
    const get = db.transaction('project', 'readonly').objectStore('project').get('current');
    get.onsuccess = () => {
      db.close();
      resolve(get.result ? get.result.project.settings.schoolName : null);
    };
  };
}));

before(async () => {
  server = await startServer();
  browser = await launch();
});

after(async () => {
  if (browser) await browser.close();
  if (server) await server.close();
});

// ---------------------------------------------------------------- in Node: the heartbeat's rules

function fakeWorld() {
  let now = 1000000;
  const held = new Map();
  const intervals = [];
  return {
    held,
    storage: { getItem: (key) => (held.has(key) ? held.get(key) : null), setItem: (key, value) => held.set(key, value), removeItem: (key) => held.delete(key) },
    now: () => now,
    setInterval(fn, ms) {
      const entry = { fn, ms, next: now + ms, on: true };
      intervals.push(entry);
      return entry;
    },
    clearInterval(entry) {
      if (entry) entry.on = false;
    },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = intervals.filter((entry) => entry.on && entry.next <= end).sort((a, b) => a.next - b.next)[0];
        if (!due) break;
        now = due.next;
        due.next += due.ms;
        due.fn();
        for (let i = 0; i < 5; i += 1) await Promise.resolve();
      }
      now = end;
    },
  };
}

// A tab on the heartbeat. `die()` stops its timers and nothing else, the way
// a killed tab stops: the key it wrote stays behind.
function tab(world, tabId, changes) {
  let beat = null;
  const watch = watchTabs({
    locks: null,
    storage: world.storage,
    now: world.now,
    setInterval: (fn, ms) => {
      beat = world.setInterval(fn, ms);
      return beat;
    },
    clearInterval: world.clearInterval,
    tabId,
    onChange: (owner) => changes.push(tabId + ':' + owner),
  });
  watch.die = () => world.clearInterval(beat);
  return watch;
}

test('the names and the times are the ones in the architecture', () => {
  assert.deepEqual([TAB_LOCK, TAB_KEY, TAB_RETRY_MS, TAB_BEAT_MS, TAB_STALE_MS], ['sv2:project', 'sv2:tab', 5000, 2000, 60000]);
});

test('heartbeat: the first tab edits and beats every 2 s; the second is read-only while the beat is fresh', async () => {
  const world = fakeWorld();
  const changes = [];
  const first = tab(world, 'first', changes);
  assert.equal(await first.ready, true);
  assert.equal(first.kind, 'heartbeat');
  assert.deepEqual(JSON.parse(world.held.get('sv2:tab')), { tabId: 'first', at: 1000000 });
  const second = tab(world, 'second', changes);
  assert.equal(await second.ready, false);
  await world.advance(2000);
  assert.deepEqual(JSON.parse(world.held.get('sv2:tab')), { tabId: 'first', at: 1002000 }, 'the editing tab rewrites the key every 2 s');
  await world.advance(120000);
  assert.equal(second.owner, false, 'a tab that keeps beating keeps the project, however long');
  assert.deepEqual(changes, []);
  first.stop();
  second.stop();
});

test('heartbeat: a tab that leaves hands over at the next beat; one that dies is waited on for 60 s', async () => {
  const world = fakeWorld();
  const changes = [];
  const first = tab(world, 'first', changes);
  const second = tab(world, 'second', changes);
  await first.ready;
  await second.ready;
  first.stop(); // it removes the key as it goes
  assert.equal(world.held.has('sv2:tab'), false);
  await world.advance(2000);
  assert.deepEqual(changes, ['second:true'], 'the second tab edits within one beat');

  // the second tab dies without a word: its timers stop, the key stays
  const third = tab(world, 'third', changes);
  assert.equal(await third.ready, false);
  second.die();
  const frozenAt = JSON.parse(world.held.get('sv2:tab')).at;
  await world.advance(frozenAt + 60000 - world.now());
  assert.equal(third.owner, false, 'at exactly 60 s the beat is not stale yet');
  await world.advance(2000);
  assert.equal(third.owner, true, 'past 60 s without a beat, the key is abandoned');
  assert.deepEqual(changes, ['second:true', 'third:true']);
  third.stop();
});

test('heartbeat: two tabs that both claimed settle on one, and the loser is told', async () => {
  const world = fakeWorld();
  const changes = [];
  const first = tab(world, 'first', changes);
  await first.ready;
  // a second tab wrote over the key in the same instant
  world.held.set('sv2:tab', JSON.stringify({ tabId: 'other', at: world.now() }));
  await world.advance(2000);
  assert.equal(first.owner, false);
  assert.deepEqual(changes, ['first:false']);
  first.stop();
});

test('heartbeat: where localStorage refuses, the tab edits and the save\'s own check is the guard', async () => {
  const changes = [];
  const refusing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => {} };
  const alone = watchTabs({ locks: null, storage: refusing, onChange: (owner) => changes.push(owner), setInterval: () => null, clearInterval: () => {} });
  assert.equal(await alone.ready, true);
  alone.stop();
});

test('locks: a tab that cannot have the lock asks again every 5 s and edits once it can', async () => {
  const world = fakeWorld();
  let free = false;
  let asked = 0;
  const locks = {
    request(name, options, callback) {
      asked += 1;
      assert.equal(name, 'sv2:project');
      assert.deepEqual(options, { ifAvailable: true });
      return Promise.resolve(callback(free ? { name } : null));
    },
  };
  const changes = [];
  const waiting = watchTabs({ locks, setInterval: world.setInterval, clearInterval: world.clearInterval, onChange: (owner) => changes.push(owner) });
  assert.equal(waiting.kind, 'locks');
  assert.equal(await waiting.ready, false);
  await world.advance(4999);
  assert.equal(asked, 1);
  await world.advance(1);
  assert.equal(asked, 2);
  free = true;
  await world.advance(5000);
  assert.deepEqual(changes, [true]);
  await world.advance(60000);
  assert.equal(asked, 3, 'it stops asking once it holds the lock');
  waiting.stop();
});

// ---------------------------------------------------------------- in the browser

async function twoTabs(t, noLocks) {
  const options = { noLocks };
  const first = await open(options);
  await rename(first.page, 'First Tab School');
  await waitSaved(first.page);

  const second = await open({ keep: true, ...options });
  await t.test('the second tab is told, in a banner, and shows the project the first one saved', async () => {
    const banner = await second.page.$eval('#banner-read-only', (el) => ({ text: el.querySelector('p').textContent, role: el.getAttribute('role') }));
    assert.match(banner.text, /^This project is open in another tab, so this tab is read-only: nothing you do here changes the project\. Close the other tab and this one can edit within a few seconds\.$/);
    assert.equal(banner.role, 'status');
    assert.equal(await indicator(second.page), 'off|Read-only');
    assert.equal(await schoolShown(second.page), 'First Tab School');
    assert.match(await second.page.$eval('#saved [data-line="tabs"]', (el) => el.textContent), /^The project is open in another tab, so this tab is read-only\./);
    assert.equal(await first.page.$('#banner-read-only'), null, 'the first tab is not told anything: it is the one that edits');
  });

  await t.test('the second tab changes nothing: not the project on screen, not the saved one', async () => {
    await rename(second.page, 'Written By The Wrong Tab');
    assert.equal(await schoolShown(second.page), 'First Tab School');
    assert.equal(await second.page.$eval('.toast .toast__text', (el) => el.textContent), 'Nothing changed: this tab is read-only while the project is open in another tab.');
    assert.equal(await second.page.$eval('#undo', (el) => el.getAttribute('aria-disabled')), 'true');
    await second.page.click('#settings input[name="timeFormat"][value="24h"]');
    await pause(1200);
    assert.equal(await second.page.evaluate(() => globalThis.sv2.store.project.settings.timeFormat), '12h', 'a real click in the page is refused the same way');
    assert.equal(await second.page.$eval('#settings input[name="timeFormat"]:checked', (el) => el.value), '12h', 'and the control goes back to what the project says');
    assert.equal(await savedName(second.page), 'First Tab School');
    // and it leaves no recovery point and no save as it is looked at
    assert.equal(await second.page.evaluate(() => globalThis.sv2.storage.takeRecoveryPoint('replace')), null);
  });

  await t.test('the first tab still edits and saves while the second looks on', async () => {
    await rename(first.page, 'First Tab School, later');
    await waitSaved(first.page);
    assert.equal(await savedName(first.page), 'First Tab School, later');
    assert.equal(await schoolShown(second.page), 'First Tab School', 'the second tab shows what it loaded until it takes over');
  });

  await t.test('closing the first tab makes the second editable within 5 s, from the first one\'s last save', async () => {
    const started = Date.now();
    await first.close();
    await second.page.waitForFunction(() => document.getElementById('banner-read-only') === null, { timeout: 8000 });
    const took = Date.now() - started;
    assert.ok(took < 6000, 'editable ' + took + ' ms after the first tab closed');
    assert.equal(await schoolShown(second.page), 'First Tab School, later', 'it starts from the last save, not from what it had on screen');
    assert.match(await second.page.$eval('.toast .toast__text', (el) => el.textContent), /^The other tab closed\. This tab can edit now/);
    assert.match(await indicator(second.page), /^saved\|Saved at /);
    await rename(second.page, 'Second Tab School');
    await waitSaved(second.page);
    assert.equal(await savedName(second.page), 'Second Tab School');
    assert.match(await second.page.$eval('#saved [data-line="tabs"]', (el) => el.textContent), /^This is the tab that edits the project\./);
  });

  assert.deepEqual(second.problems().errors, []);
  return second;
}

test('two tabs, with Web Locks', async (t) => {
  const second = await twoTabs(t, false);
  assert.equal(await second.page.evaluate(() => globalThis.sv2.storage.state.tabs), 'locks');
  assert.equal(await second.page.evaluate(() => localStorage.getItem('sv2:tab')), null);
  await second.close();
});

test('two tabs, in a browser with no Web Locks: the heartbeat does the same job', async (t) => {
  const second = await twoTabs(t, true);
  assert.equal(await second.page.evaluate(() => globalThis.sv2.storage.state.tabs), 'heartbeat');
  const beat = await second.page.evaluate(() => JSON.parse(localStorage.getItem('sv2:tab')));
  assert.deepEqual(Object.keys(beat), ['tabId', 'at']);
  assert.match(await second.page.$eval('#saved [data-line="tabs"]', (el) => el.textContent), /slow to notice a second tab/);
  await second.close();
});
