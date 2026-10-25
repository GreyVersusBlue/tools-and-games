// The staff browser's accessibility sweep: node test/a11y/staff-axe.mjs
//
// axe-core (vendored, test/vendor/axe-core) on every view of staff/views.js
// and every state a published file can be in, in the light and the dark
// theme, at 1280 by 900 and on a 390 by 844 phone with touch. Fails on any
// violation of WCAG 2.0 and 2.1 at A and AA and of axe's best practices, as
// axe.mjs does for the planner; a rule knowingly not met goes in ALLOW with
// its reason, and an entry that matches nothing fails the run.
//
// Three ways of reading a schedule are swept:
//
// 1. Published files opened from disk, assembled here exactly as the planner
//    assembles them. Every view's address in four states: a current copy, an
//    old copy (the stale band), a copy older than one this device has opened
//    (the newer-copy band), and a reader who has chosen themselves and kept
//    notes. Then the screens that are not a schedule: the unlock screen, a
//    wrong passcode, a newer format, a damaged file, a page with no
//    schedule, and a browser that keeps nothing.
// 2. The planner's Staff browser section: axe inside the preview frame's own
//    document, fed, at the phone and the desktop width, and its passcode
//    screen.
// 3. A published file frozen from an earlier version of the tool
//    (test/publish/frozen/), read by today's staff browser.
//
// The clock is pinned (Tuesday 1 September 2026, 9:00 in UTC: Period 2 on
// A Day) and the zone is UTC, so no page here depends on the day it runs.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { launch, openPlanner, startServer, TOOL_DIR } from '../browser/harness.mjs';
import { diskReader, partsOf } from '../publish/reader.mjs';
import { assemble } from '../../ui/staff/assemble.js';
import { publishDocument } from '../../ui/staff/targets.js';
import { publishedModel } from '../../engine/publish-data.js';
import { seededRandom } from '../../engine/ids.js';
import { sampleSchool } from '../../data/sample-school.js';
import { VIEWS } from '../../staff/views.js';
import { WRONG_PASSCODE_SENTENCE } from '../../staff/passcode.js';
import { NEWER_SENTENCE, DAMAGED_SENTENCE } from '../../staff/source.js';
import { NOT_KEPT_SENTENCE } from '../../staff/storage.js';

const AXE = readFileSync(path.join(TOOL_DIR, 'test', 'vendor', 'axe-core', 'axe.min.js'), 'utf8');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];
const SCHOOL = 'Marrowby Middle School (sample)';
const PASSCODE = 'bulldogs2015';
const FROZEN = path.join(TOOL_DIR, 'test', 'publish', 'frozen', 'sv2-m4.html');

// { rule, where (optional, a substring of the case's name), reason }
const ALLOW = [];

// Every view's address, with the view it draws. A view added to
// staff/views.js without a line here fails the first case below.
const ADDRESSES = [
  ['#/search', 'search'],
  ['#/search?q=Hal', 'search'],
  ['#/nowhere', 'search'], // an address that names no page: the search page, told so
  ['#/teacher/tsample007', 'teacher'],
  ['#/group/gsample06a', 'group'],
  ['#/room/rsample203', 'room'],
  ['#/map/fsample001', 'map'],
  ['#/map/fsample002', 'map'],
  ['#/staffing', 'staffing'],
  ['#/free', 'free'],
  ['#/free?p=3&d=dsample00b', 'free'],
  ['#/now', 'now'],
  ['#/now?g=gsample06a', 'now'],
  ['#/now?t=tsample003', 'now'],
  ['#/common?t=tsample001,tsample002,tsample003', 'common'],
  ['#/coverage', 'coverage'],
  ['#/coverage/tsample003', 'coverage'],
  ['#/sub/tsample007', 'sub'],
  ['#/directions', 'directions'],
  ['#/directions?from=rsample101&to=rsample303', 'directions'],
  ['#/directions?from=rsample101&to=rsample303&stepfree=1', 'directions'],
  ['#/me', 'me'],
  ['#/door/rsample203', 'door'],
  ['#/door/rsample203?day=1', 'door'],
];

const SIZES = [
  { name: 'desktop', width: 1280, height: 900, phone: false },
  { name: 'phone', width: 390, height: 844, phone: true },
];

const future = () => new Date('2999-01-01T12:00:00Z');
const past = () => new Date('2020-01-15T12:00:00Z');
const PINNED = '2026-09-01T09:00:00Z';

const scratch = mkdtempSync(path.join(os.tmpdir(), 'sv2-staff-axe-'));
const read = diskReader();
const files = {};
const used = new Set();
const undecided = new Map(); // rule → { nodes, cases }: what axe could not decide, printed at the end
let browser;
let server;

function save(name, html) {
  const file = path.join(scratch, name + '.html');
  writeFileSync(file, html);
  files[name] = { file, url: pathToFileURL(file).href, html };
  return files[name];
}

async function publish(name, options) {
  const project = sampleSchool();
  if (!options.locked) project.publish.passcode = '';
  const made = await publishDocument(read, project, { clock: options.clock || future, random: seededRandom('staff-axe ' + name) });
  return save(name, made.html);
}

// A document of today's staff browser holding `data` as it is, whatever it is.
async function holding(name, data) {
  return save(name, await assemble(read, data));
}

before(async () => {
  await publish('open', {});
  await publish('old', { clock: past });
  await publish('locked', { locked: true });
  const model = publishedModel(sampleSchool(), { clock: future });
  await holding('newer', { ...model, version: model.version + 1 });
  await holding('none', null);
  const whole = files.open.html;
  const at = whole.indexOf('"teachers":');
  save('damaged', whole.slice(0, at) + whole.slice(whole.indexOf('</script>', at)));
  // today's staff browser holding the frozen file's own data, as it was published
  const frozen = readFileSync(FROZEN, 'utf8');
  await holding('frozen-data', JSON.parse(partsOf(frozen).data));
  server = await startServer();
  browser = await launch();
});

after(async () => {
  if (browser) await browser.close();
  if (server) await server.close();
  rmSync(scratch, { recursive: true, force: true });
});

// ---------------------------------------------------------------- helpers

// What the page is set up with before its own script runs: the pinned clock,
// what this device has kept, and a storage that refuses when asked to.
function prepare(at, kept, refuse) {
  const fixed = Date.parse(at);
  const Real = Date;
  class Pinned extends Real {
    constructor(...args) {
      if (args.length === 0) super(fixed);
      else super(...args);
    }

    static now() {
      return fixed;
    }
  }
  globalThis.Date = Pinned;
  globalThis.print = () => {};
  try {
    for (const [key, value] of Object.entries(kept)) localStorage.setItem(key, value);
  } catch (error) {
    // a page that keeps nothing is one of the cases
  }
  if (refuse) {
    Storage.prototype.setItem = () => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    };
  }
}

async function openPage(size, theme, options) {
  const opts = options || {};
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: size.width, height: size.height, deviceScaleFactor: 1, hasTouch: size.phone, isMobile: size.phone });
  await page.emulateTimezone('UTC');
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
  await page.evaluateOnNewDocument(prepare, PINNED, opts.kept || {}, opts.refuse === true);
  const errors = [];
  page.on('pageerror', (error) => errors.push('page error: ' + error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push('console: ' + message.text());
  });
  return { page, errors, close: () => context.close() };
}

// A page at rest: its fonts in, its maps drawn, every animation finished
// (axe.mjs's atRest: a band or a card part way into its opacity is not the
// page a reader reads). `target` is a page or a frame.
async function atRest(target) {
  await target.evaluate(() => document.fonts.ready);
  await target.waitForFunction(() => Array.from(document.querySelectorAll('.map')).every((map) => map.dataset.cell), { timeout: 10000 });
  await target.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
}

async function state(target, wanted) {
  await target.waitForFunction((want) => document.getElementById('app')?.dataset.state === want, { timeout: 30000 }, wanted);
}

// Move to an address of the open schedule and wait for the new page: the
// view it names, drawn afresh (the page that was there is marked first).
async function move(target, address, view) {
  await target.evaluate((next) => {
    // the address the page is already at draws nothing new
    if (location.hash === next) return;
    const main = document.getElementById('page');
    if (main && main.firstElementChild) main.firstElementChild.dataset.leaving = 'true';
    location.hash = next;
  }, address);
  await target.waitForFunction((want) => {
    const main = document.getElementById('page');
    return Boolean(main) && main.dataset.view === want && main.firstElementChild && main.firstElementChild.dataset.leaving !== 'true';
  }, { timeout: 10000 }, view);
  await atRest(target);
}

function describe(violation) {
  return violation.id + ' (' + violation.impact + '): ' + violation.help + ' at ' + violation.nodes.map((node) => node.target.join(' ') + ' [' + String(node.failureSummary || '').replace(/\s+/g, ' ').trim() + ']').join('; ');
}

// axe on the document of `target` (a page, or the preview's frame).
async function axe(target, name) {
  if (!(await target.evaluate(() => typeof globalThis.axe === 'object'))) await target.addScriptTag({ content: AXE });
  const result = await target.evaluate((tags) => globalThis.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations', 'incomplete'] }), TAGS);
  assert.ok(result.passes.length > 10, 'axe ran very few rules (' + result.passes.length + ') on ' + name + ', so it did not check the page');
  for (const item of result.incomplete) {
    const seen = undecided.get(item.id) || { nodes: 0, cases: 0 };
    undecided.set(item.id, { nodes: seen.nodes + item.nodes.length, cases: seen.cases + 1 });
  }
  const violations = result.violations.filter((violation) => {
    const entry = ALLOW.find((allowed) => allowed.rule === violation.id && (!allowed.where || name.includes(allowed.where)));
    if (entry) used.add(entry);
    return !entry;
  });
  assert.deepEqual(violations.map(describe), [], 'axe on ' + name);
}

const theme = (target) => target.evaluate(() => getComputedStyle(document.documentElement).colorScheme);

// Type the passcode and wait for the file to open or to refuse it, and say which.
async function unlock(page, name) {
  await page.type('#passcode', PASSCODE);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('app').dataset.state === 'open' || (document.getElementById('passcode-says')?.textContent || '') !== '', { timeout: 30000 });
  const refused = await page.evaluate(() => (document.getElementById('app').dataset.state === 'open' ? null : document.getElementById('passcode-says').textContent));
  assert.equal(refused, null, name + ' was not opened by ' + PASSCODE);
}

// ---------------------------------------------------------------- the list itself

test('every view in staff/views.js has an address in the sweep', () => {
  const swept = new Set(ADDRESSES.map(([, view]) => view));
  assert.deepEqual(VIEWS.map((view) => view.id).filter((id) => !swept.has(id)), [], 'views the sweep never opens');
  assert.deepEqual([...swept].filter((id) => !VIEWS.some((view) => view.id === id)), [], 'addresses for views that are not there');
});

// ---------------------------------------------------------------- 1. every view, in every state of an open schedule

const SEEN = 'sv2staff:psample001:seen';
const NOTES = JSON.stringify({ dsample00a: { 0: 'Hall duty by the gym doors', 3: 'Department meeting, Room 204' }, dsample00b: { 5: 'Keep free: marking' } });

const STATES = [
  { id: 'current', file: 'open', bands: [] },
  { id: 'stale', file: 'old', bands: ['stale'] },
  { id: 'a newer copy seen', file: 'open', kept: { [SEEN]: '2999-06-01T12:00:00.000Z' }, bands: ['note'] },
  { id: 'notes shown', file: 'open', kept: { 'sv2staff:psample001:me': 'tsample007', 'sv2staff:psample001:notes': NOTES }, bands: [], notes: true },
];

for (const size of SIZES) {
  for (const colour of ['light', 'dark']) {
    for (const each of STATES) {
      test(each.id + ': every view at ' + size.name + ', ' + colour, async () => {
        const session = await openPage(size, colour, { kept: each.kept });
        try {
          const { page } = session;
          await page.goto(files[each.file].url + ADDRESSES[0][0], { waitUntil: 'load' });
          await state(page, 'open');
          await atRest(page);
          assert.equal(await theme(page), colour, 'the page should follow the device into the ' + colour + ' theme');
          for (const [address, view] of ADDRESSES) {
            await move(page, address, view);
            const name = address + ' (' + each.id + ') at ' + size.name + ', ' + colour;
            const bands = await page.evaluate(() => Array.from(document.querySelectorAll('.band'), (band) => band.dataset.band));
            assert.deepEqual(bands, each.bands, 'the notices on ' + name);
            if (each.notes && view === 'me') {
              const notes = await page.evaluate(() => Array.from(document.querySelectorAll('.page textarea, .page input[type="text"]'), (field) => field.value).filter(Boolean));
              assert.ok(notes.includes('Hall duty by the gym doors'), 'the kept notes are on My schedule: ' + JSON.stringify(notes));
            }
            await axe(page, name);
          }
          assert.deepEqual(session.errors, []);
        } finally {
          await session.close();
        }
      });
    }
  }
}

// ---------------------------------------------------------------- 1. the screens that are not a schedule

const CARDS = [
  { id: 'the unlock screen', file: 'locked', state: 'locked', heading: 'Staff schedule' },
  {
    id: 'a wrong passcode',
    file: 'locked',
    state: 'locked',
    heading: 'Staff schedule',
    then: async (page) => {
      await page.type('#passcode', 'bulldogs2016');
      await page.keyboard.press('Enter');
      await page.waitForFunction((want) => document.getElementById('passcode-says').textContent === want, { timeout: 30000 }, WRONG_PASSCODE_SENTENCE);
    },
  },
  { id: 'a newer format', file: 'newer', state: 'newer', heading: 'This schedule needs a newer copy', says: NEWER_SENTENCE },
  { id: 'a damaged file', file: 'damaged', state: 'damaged', heading: 'This file cannot be opened', says: DAMAGED_SENTENCE },
  { id: 'no schedule', file: 'none', state: 'none', heading: 'Staff browser' },
  {
    id: 'a browser that keeps nothing',
    file: 'open',
    state: 'open',
    address: '#/me',
    refuse: true,
    then: async (page) => {
      await page.waitForFunction((want) => Array.from(document.querySelectorAll('.band'), (band) => band.textContent).some((text) => text.startsWith(want)), { timeout: 10000 }, NOT_KEPT_SENTENCE);
    },
  },
];

for (const size of SIZES) {
  for (const colour of ['light', 'dark']) {
    test('the unlock screen, a wrong passcode, a newer format, a damaged file, no schedule and a browser that keeps nothing at ' + size.name + ', ' + colour, async () => {
      for (const card of CARDS) {
        const session = await openPage(size, colour, { refuse: card.refuse });
        try {
          const { page } = session;
          await page.goto(files[card.file].url + (card.address || ''), { waitUntil: 'load' });
          await state(page, card.state);
          if (card.then) await card.then(page);
          await atRest(page);
          const name = card.id + ' at ' + size.name + ', ' + colour;
          if (card.heading) assert.equal(await page.evaluate(() => document.querySelector('h1').textContent), card.heading, name);
          if (card.says) assert.equal(await page.evaluate(() => document.querySelector('[role="alert"]').textContent), card.says, name);
          assert.equal(await theme(page), colour);
          await axe(page, name);
          assert.deepEqual(session.errors, [], name);
        } finally {
          await session.close();
        }
      }
    });
  }
}

// ---------------------------------------------------------------- 2. inside the planner's preview frame

// The preview's own document: the frame at a blob address the Staff browser
// section makes and feeds.
function frameOf(page) {
  const frame = page.frames().find((each) => each.url().startsWith('blob:'));
  assert.ok(frame, 'the preview frame is at a blob address');
  return frame;
}

const sent = (page) => page.evaluate(() => Number(document.querySelector('.stf-preview').dataset.sent));

for (const colour of ['light', 'dark']) {
  test('inside the planner\'s staff preview, fed, at the phone and the desktop width and at its passcode screen, ' + colour, async () => {
    const session = await openPlanner({ browser, server, theme: colour, hash: '#staff' });
    try {
      const { page } = session;
      // as screens.mjs's staffLive waits: the frame has been fed
      await page.waitForFunction(() => document.querySelector('.stf-preview')?.dataset.preview === 'live', { timeout: 30000 });
      const inside = frameOf(page);
      await state(inside, 'open');
      // the frame's clock, pinned as the files' is, read again by every page drawn from here on
      await inside.evaluate((at) => { globalThis.sv2StaffClock = { now: () => at, every: 3600000 }; }, PINNED);
      assert.equal(await theme(inside), colour, 'the preview should follow the device into the ' + colour + ' theme');
      for (const width of ['phone', 'desktop']) {
        if (width === 'desktop') {
          await page.click('.stf-bar .seg__input[value="desktop"]');
          await page.waitForFunction(() => document.querySelector('.stf-stage').dataset.width === 'desktop');
        }
        const frameWidth = await inside.evaluate(() => window.innerWidth);
        assert.equal(frameWidth, width === 'phone' ? 390 : 1180, 'the frame is the ' + width + '\'s width');
        for (const [address, view] of ADDRESSES) {
          await move(inside, address, view);
          await axe(inside, address + ' in the preview at the ' + width + ' width, ' + colour);
        }
      }
      // "Start at the passcode screen": the file as a reader first meets it
      await page.evaluate(() => {
        for (const key of Object.keys(localStorage)) if (key.startsWith('sv2staff:')) localStorage.removeItem(key);
      });
      const before = await sent(page);
      await page.click('.stf-bar .stf-check');
      await page.waitForFunction((count) => Number(document.querySelector('.stf-preview').dataset.sent) > count, { timeout: 30000 }, before);
      await state(inside, 'locked');
      await atRest(inside);
      await axe(inside, 'the unlock screen in the preview, ' + colour);
      await inside.type('#passcode', 'bulldogs2016');
      await inside.evaluate(() => document.getElementById('passcode').form.requestSubmit());
      await inside.waitForFunction((want) => document.getElementById('passcode-says').textContent === want, { timeout: 30000 }, WRONG_PASSCODE_SENTENCE);
      await atRest(inside);
      await axe(inside, 'a wrong passcode in the preview, ' + colour);
      await page.click('.stf-bar .stf-check');
      await page.evaluate(() => {
        for (const key of Object.keys(localStorage)) if (key.startsWith('sv2staff:')) localStorage.removeItem(key);
      });
      assert.deepEqual(session.problems().errors, [], 'the planner reported something wrong');
    } finally {
      await session.close();
    }
  });
}

// ---------------------------------------------------------------- 3. a file from an earlier version of the tool

test('a published file frozen from an earlier version of the tool opens, and today\'s staff browser reads its schedule', async () => {
  const session = await openPage(SIZES[1], 'light');
  try {
    const { page } = session;
    // the file as it was sent: its own code, opened in today's Chromium
    await page.goto(pathToFileURL(FROZEN).href + '#/teacher/tsample007', { waitUntil: 'load' });
    await state(page, 'locked');
    await unlock(page, 'the frozen file, in its own code,');
    assert.equal(await page.evaluate(() => document.querySelector('.top__school').textContent), SCHOOL);
    assert.equal(await page.evaluate(() => document.querySelector('h1').textContent), 'Ms. Vandermeer');
    assert.equal(await page.evaluate(() => location.hash), '#/teacher/tsample007', 'the address asked for is kept through the unlock');
  } finally {
    await session.close();
  }
  // the same schedule in today's staff browser: it is read, not refused as an older format
  for (const colour of ['light', 'dark']) {
    const today = await openPage(SIZES[1], colour);
    try {
      const { page } = today;
      await page.goto(files['frozen-data'].url + '#/teacher/tsample007', { waitUntil: 'load' });
      await state(page, 'locked');
      await unlock(page, 'the frozen file\'s schedule, in today\'s staff browser,');
      assert.equal(await page.evaluate(() => document.querySelector('.top__school').textContent), SCHOOL);
      assert.match(await page.evaluate(() => document.querySelector('.foot').textContent), /published (1 September 2026|September 1, 2026)/);
      for (const [address, view] of ADDRESSES) {
        await move(page, address, view);
        await axe(page, address + ' of the frozen file in today\'s staff browser, ' + colour);
      }
      assert.deepEqual(today.errors, []);
    } finally {
      await today.close();
    }
  }
});

// axe's "incomplete" results, things it could not decide (text over a
// picture, for one), are printed, not failed, as axe.mjs prints them.
test('every entry in the allow-list still matches something', (t) => {
  for (const [rule, seen] of undecided) t.diagnostic('axe could not decide ' + rule + ': ' + seen.nodes + ' elements over ' + seen.cases + ' pages');
  assert.deepEqual(ALLOW.filter((entry) => !used.has(entry)).map((entry) => entry.rule + (entry.where ? ' on ' + entry.where : '')), []);
});
