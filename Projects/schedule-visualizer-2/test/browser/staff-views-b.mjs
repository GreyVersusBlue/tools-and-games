// Six of the staff browser's views, driven in Chromium from a published file
// on disk: node test/browser/staff-views-b.mjs
//
//   Free right now, Where right now, Common planning, Coverage, Substitute
//   plan, Directions
//
// The file is assembled here exactly as the planner assembles it and opened
// from file://, the way test/browser/staff-shell.mjs does. The clock is
// pinned: the page takes its time from `sv2StaffClock` (staff/clock.js), which
// each page here sets before anything loads, and the browser's zone is set to
// New York, so a period worked out from UTC hours instead of the reader's own
// gives a different answer and fails.
//
// The names and periods asserted are the sample school's (data/sample-school.js),
// written out here by hand from its schedule, not worked out again.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { launch, TOOL_DIR } from './harness.mjs';
import { diskReader } from '../publish/reader.mjs';
import { publishDocument } from '../../ui/staff/targets.js';
import { publishedModel } from '../../engine/publish-data.js';
import { buildGraph } from '../../engine/graph.js';
import { routingGraph, route } from '../../engine/routing.js';
import { directions } from '../../engine/directions.js';
import { seededRandom } from '../../engine/ids.js';
import { sampleSchool } from '../../data/sample-school.js';

const AXE = readFileSync(path.join(TOOL_DIR, 'test', 'vendor', 'axe-core', 'axe.min.js'), 'utf8');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];
const SCHOOL = 'Marrowby Middle School (sample)';
const HOSTILE = '<img src=x onerror="window.__pwned=1"> </script><b>"Ünï" 東京';
const NOTES = 'Seating chart is in the top drawer.\n<b>Fire drill</b> at 10 & "quiet" reading after.';
const ZONE = 'America/New_York';

// New York is four hours behind UTC in September.
const AT_0950 = '2026-09-01T13:50:00Z'; // A Day: Period 3 (9:44 to 10:32). B Day: Period 2 (9:12 to 10:00).
const AT_1034 = '2026-09-01T14:34:00Z'; // A Day: passing time before Period 4 (10:36).
const AT_1040 = '2026-09-01T14:40:00Z'; // A Day: Period 4.
const AT_0700 = '2026-09-01T11:00:00Z'; // before the first bell
const AT_1600 = '2026-09-01T20:00:00Z'; // after the last
const AT_2230 = '2026-09-02T02:30:00Z'; // still 1 September in New York

const future = () => new Date('2999-01-01T12:00:00Z');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'sv2-staff-b-'));
const read = diskReader();
const files = {};
let browser;

async function write(name, change) {
  const project = sampleSchool();
  project.publish.passcode = '';
  if (change) change(project);
  const published = await publishDocument(read, project, { clock: future, random: seededRandom('staff-views-b ' + name) });
  const file = path.join(scratch, name + '.html');
  writeFileSync(file, published.html);
  files[name] = { file, url: pathToFileURL(file).href, model: published.model };
  return files[name];
}

before(async () => {
  await write('open');
  await write('hostile', (project) => {
    project.settings.schoolName = HOSTILE;
    project.teachers[0].name = HOSTILE + ' T';
    project.groups[0].name = HOSTILE + ' G';
    project.teachers[2].notes = NOTES;
  });
  await write('bare', (project) => {
    for (const view of ['teacher', 'group', 'room', 'map', 'now', 'coverage']) project.publish.views[view] = false;
  });
  await write('nobells', (project) => {
    for (const dayType of project.dayTypes) dayType.bells = dayType.bells.map(() => null);
  });
  browser = await launch();
});

after(async () => {
  if (browser) await browser.close();
  rmSync(scratch, { recursive: true, force: true });
});

// A page in a profile of its own, in New York, with the clock pinned at `at`
// and read again every `every` milliseconds. `every` left out is an hour: a
// page whose timer never fires during a test.
async function openPage(options) {
  const opts = options || {};
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const phone = opts.width === undefined;
  await page.setViewport({ width: opts.width || 390, height: opts.height || 760, deviceScaleFactor: 1, hasTouch: phone, isMobile: phone });
  await page.emulateTimezone(ZONE);
  if (opts.theme) await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: opts.theme }]);
  await page.evaluateOnNewDocument((at, every, share) => {
    globalThis.sv2Pinned = at;
    globalThis.sv2Reads = 0;
    globalThis.sv2StaffClock = {
      now: () => {
        globalThis.sv2Reads += 1;
        return globalThis.sv2Pinned;
      },
      every,
    };
    globalThis.sv2Printed = 0;
    globalThis.print = () => {
      globalThis.sv2Printed += 1;
    };
    if (share) {
      globalThis.sv2Shared = [];
      Object.defineProperty(navigator, 'share', { configurable: true, value: (what) => {
        globalThis.sv2Shared.push(what);
        return Promise.resolve();
      } });
    }
  }, opts.at || AT_0950, opts.every || 3600000, opts.share === true);
  const requests = [];
  const errors = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => errors.push('page error: ' + error.message));
  page.on('requestfailed', (request) => errors.push('request failed: ' + request.url()));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push('console: ' + message.text());
  });
  return { page, context, requests, errors, close: () => context.close() };
}

const asked = (session, own) => session.requests.filter((url) => url !== own && !url.startsWith(own + '#') && !url.startsWith('data:'));
const texts = (page, selector) => page.evaluate((s) => Array.from(document.querySelectorAll(s), (el) => el.textContent), selector);
const text = (page, selector) => page.evaluate((s) => {
  const found = document.querySelector(s);
  return found ? found.textContent : null;
}, selector);
const says = (page) => text(page, '.page__body > .lede');
const hash = (page) => page.evaluate(() => location.hash);
const setClock = (page, at) => page.evaluate((value) => { globalThis.sv2Pinned = value; }, at);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function goto(page, url) {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('app').dataset.state === 'open', { timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
}

// Move to another address in the same file and wait for its page.
async function move(page, to, title) {
  await page.evaluate((next) => { location.hash = next; }, to);
  await page.waitForFunction((want, where) => location.hash === where && document.querySelector('h1').textContent === want, { timeout: 5000 }, title, to);
}

async function axe(page, name) {
  if (!(await page.evaluate(() => typeof globalThis.axe === 'object'))) await page.addScriptTag({ content: AXE });
  const result = await page.evaluate((tags) => globalThis.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] }), TAGS);
  assert.ok(result.passes.length > 10, 'axe ran very few rules on ' + name);
  const said = result.violations.map((violation) => violation.id + ': ' + violation.help + ' at ' + violation.nodes.map((node) => node.target.join(' ')).join(', '));
  assert.deepEqual(said, [], 'axe on ' + name);
}

const freeNames = (page) => texts(page, '[data-list="teachers"] .list__name');
const roomNames = (page) => texts(page, '[data-list="rooms"] .list__name');

// ---------------------------------------------------------------- Free right now

test('Free right now takes the period from the reader\'s own clock and the bells', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.open.url + '#/free');
    assert.equal(await text(page, 'h1'), 'Free right now');
    // 13:50 UTC is 9:50 in New York: Period 3 on A Day. By UTC hours it would be Period 7.
    assert.equal(await says(page), 'It is Period 3 on A Day, 9:44 AM to 10:32 AM. 4 teachers and 5 rooms are free.');
    assert.deepEqual(await freeNames(page), ['Ms. Oyelaran', 'Mr. Castellanos', 'Ms. Thistlewood', 'Ms. O\'Fennimore']);
    assert.deepEqual(await roomNames(page), ['Cafeteria', 'Room 201', 'Room 202', 'Room 303', 'Room 301']);
    assert.deepEqual(await texts(page, '[data-list="teachers"] li:first-child .list__detail'), ['English · Room 201']);
    assert.deepEqual(await texts(page, '[data-list="rooms"] li:first-child .list__detail'), ['Floor 1 · 150 seats']);
    assert.equal(await page.evaluate(() => document.querySelector('[data-list="teachers"] a').getAttribute('href')), '#/teacher/tsample005');
    assert.equal(await page.evaluate(() => document.querySelector('[data-list="rooms"] a').getAttribute('href')), '#/room/rsamplecaf');
    assert.equal(await page.evaluate(() => document.querySelector('.page__body > .lede').getAttribute('role')), 'status', 'the sentence is announced when it changes');
    assert.equal(await page.evaluate(() => document.querySelector('[data-pick="period"]').value), '', 'the period picker starts on Now');
    assert.equal(await page.evaluate(() => document.querySelector('[data-pick="period"]').options[3].textContent), 'Period 3, 9:44 AM to 10:32 AM');
    assert.equal(await page.evaluate(() => document.querySelector('.bar a[aria-current="page"]').dataset.item), 'now');
    assert.deepEqual(await texts(page, '.page .tabs .tab'), ['Where right now', 'Free right now']);
    assert.equal(await page.evaluate(() => document.querySelector('.page .tabs [aria-current="page"]').textContent), 'Free right now');
    assert.deepEqual(asked(session, files.open.url), [], 'the page asks for nothing');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('Free right now is drawn again as time passes: passing time, then the next period', async () => {
  const session = await openPage({ every: 100 });
  try {
    const { page } = session;
    await goto(page, files.open.url + '#/free');
    assert.equal(await page.evaluate(() => document.querySelector('.lede').dataset.period), '2');
    await setClock(page, AT_1034);
    await page.waitForFunction(() => document.querySelector('.lede').dataset.moment === 'passing', { timeout: 5000 });
    assert.equal(await says(page), 'It is passing time on A Day. Period 4 starts at 10:36 AM. Showing Period 4, 10:36 AM to 11:24 AM: 7 teachers and 7 rooms are free.');
    await setClock(page, AT_1040);
    await page.waitForFunction(() => document.querySelector('.lede').dataset.moment === 'in', { timeout: 5000 });
    assert.equal(await says(page), 'It is Period 4 on A Day, 10:36 AM to 11:24 AM. 7 teachers and 7 rooms are free.');
    assert.deepEqual(await freeNames(page), ['Ms. Halloran', 'Coach Dunmore', 'Mr. Castellanos', 'Mme. Dufrêne', 'Ms. Thistlewood', 'Mr. Larkspur', 'Ms. O\'Fennimore']);
    assert.deepEqual(await roomNames(page), ['Room 101', 'Gym', 'Room 202', 'Room 204', 'Room 303', 'Room 302', 'Room 301']);
    await setClock(page, AT_1600);
    await page.waitForFunction(() => document.querySelector('.lede').dataset.moment === 'after', { timeout: 5000 });
    assert.equal(await says(page), 'The last bell on A Day has gone. Showing Period 1, 8:00 AM to 8:48 AM: 4 teachers and 5 rooms are free.');
    await setClock(page, AT_0700);
    await page.waitForFunction(() => document.querySelector('.lede').dataset.moment === 'before', { timeout: 5000 });
    assert.match(await says(page), /^The day has not started on A Day\. Period 1 starts at 8:00 AM\. Showing Period 1, /);
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('a page that comes back into view reads the clock again without waiting for the timer', async () => {
  const session = await openPage(); // the timer is an hour away
  try {
    const { page } = session;
    await goto(page, files.open.url + '#/free');
    await setClock(page, AT_1040);
    await pause(400);
    assert.equal(await page.evaluate(() => document.querySelector('.lede').dataset.period), '2', 'nothing has read the clock yet');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForFunction(() => document.querySelector('.lede').dataset.period === '3', { timeout: 5000 });
    assert.equal(await says(page), 'It is Period 4 on A Day, 10:36 AM to 11:24 AM. 7 teachers and 7 rooms are free.');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('the clock stops being read once the page that asked for it has gone', async () => {
  const session = await openPage({ every: 50 });
  try {
    const { page } = session;
    await goto(page, files.open.url + '#/free');
    const start = await page.evaluate(() => globalThis.sv2Reads);
    await pause(400);
    const during = await page.evaluate(() => globalThis.sv2Reads);
    assert.ok(during >= start + 3, 'the timer reads the clock while the page is up (' + start + ' then ' + during + ')');
    await move(page, '#/search', 'Search');
    await pause(150);
    const left = await page.evaluate(() => globalThis.sv2Reads);
    await pause(400);
    assert.equal(await page.evaluate(() => globalThis.sv2Reads), left, 'the timer went on after its page left');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    assert.equal(await page.evaluate(() => globalThis.sv2Reads), left, 'the visibility listener went on after its page left');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('the day type is chosen by hand, kept on the device, and still chosen after the file is opened again', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.open.url + '#/free');
    assert.deepEqual(await texts(page, '[data-pick="day"] .pick__name'), ['A Day', 'B Day']);
    assert.equal(await page.evaluate(() => document.querySelector('[data-pick="day"] input:checked').value), 'dsample00a');
    assert.equal(await page.evaluate(() => localStorage.getItem('sv2staff:psample001:day')), null, 'nothing is kept until something is chosen');
    await page.click('[data-pick="day"] input[value="dsample00b"]');
    // 9:50 on B Day is Period 2
    assert.equal(await says(page), 'It is Period 2 on B Day, 9:12 AM to 10:00 AM. 4 teachers and 5 rooms are free.');
    assert.deepEqual(await freeNames(page), ['Ms. Oyelaran', 'Mr. Castellanos', 'Mr. Pennywhistle', 'Ms. Thistlewood']);
    assert.equal(await page.evaluate(() => localStorage.getItem('sv2staff:psample001:day')), 'dsample00b');
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('[data-pick="day"] input:checked') && document.activeElement.value), 'dsample00b', 'focus stays on the day type chosen');
    assert.equal(await page.evaluate(() => document.querySelector('[data-pick="period"]').options[2].textContent), 'Period 2, 9:12 AM to 10:00 AM', 'the period picker shows the chosen day type\'s times');
    assert.equal(await hash(page), '#/free', 'the reader\'s own day type is not put in the address');

    await page.goto('about:blank');
    await goto(page, files.open.url + '#/now');
    assert.equal(await page.evaluate(() => document.querySelector('[data-pick="day"] input:checked').value), 'dsample00b', 'the other pages use the same choice');
    await move(page, '#/coverage/tsample003', 'Coverage: Dr. Quillfeather');
    assert.match(await says(page), /on B Day\./);
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('a period chosen by hand is kept in the address and is not moved by the clock', async () => {
  const session = await openPage({ every: 100 });
  try {
    const { page } = session;
    await goto(page, files.open.url + '#/free');
    await page.focus('[data-pick="period"]');
    await page.select('[data-pick="period"]', '4');
    assert.equal(await hash(page), '#/free?p=4&d=dsample00a');
    assert.equal(await says(page), 'Period 5, 11:28 AM to 12:16 PM on A Day: 9 teachers and 9 rooms are free.');
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('[data-pick="period"]')), true, 'choosing a period does not take the picker away from under the reader');
    await setClock(page, AT_1040);
    await pause(400);
    assert.equal(await page.evaluate(() => document.querySelector('.lede').dataset.period), '4', 'a chosen period stays');

    // the address alone brings the same page back, on another device with another day type kept
    await page.evaluate(() => localStorage.setItem('sv2staff:psample001:day', 'dsample00b'));
    await page.goto('about:blank');
    await goto(page, files.open.url + '#/free?p=4&d=dsample00a');
    assert.equal(await says(page), 'Period 5, 11:28 AM to 12:16 PM on A Day: 9 teachers and 9 rooms are free.');
    await page.select('[data-pick="period"]', '');
    assert.equal(await hash(page), '#/free');
    assert.equal(await page.evaluate(() => document.querySelector('.lede').dataset.moment), 'in');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('empty rooms are narrowed by seats, subject and wing, and the field keeps its focus', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    // Period 4 on A Day: 101, Gym, 202, 204, 303, 302 and 301 are empty
    await goto(page, files.open.url + '#/free?p=3&d=dsample00a');
    assert.deepEqual(await roomNames(page), ['Room 101', 'Gym', 'Room 202', 'Room 204', 'Room 303', 'Room 302', 'Room 301']);
    await page.focus('#free-seats');
    await page.keyboard.type('40');
    assert.deepEqual(await roomNames(page), ['Gym', 'Room 303']);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'free-seats');
    assert.equal(await hash(page), '#/free?p=3&d=dsample00a&seats=40');
    assert.equal(await text(page, '[data-out="rooms"] h2'), 'Rooms empty that match (2)');
    await page.select('#free-wing', 'East');
    assert.deepEqual(await roomNames(page), ['Gym']);
    await page.evaluate(() => {
      const input = document.getElementById('free-seats');
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    assert.deepEqual(await roomNames(page), ['Gym', 'Room 204', 'Room 302', 'Room 301']);
    await page.select('#free-wing', '');
    await page.select('#free-subject', 'ssample003');
    assert.deepEqual(await roomNames(page), ['Room 301']);
    assert.equal(await hash(page), '#/free?p=3&d=dsample00a&subject=ssample003');
    await page.select('#free-wing', 'West');
    assert.deepEqual(await roomNames(page), []);
    assert.equal(await text(page, '[data-out="rooms"] .muted'), 'No empty room matches. Ask for less above.');
    assert.equal(await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('free-seats')).fontSize) >= 16), true, 'a field under 16 px makes iOS zoom the page');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('a schedule with no bell times says the period is not known and still answers for a chosen one', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.nobells.url + '#/free');
    assert.equal(await says(page), 'A Day has no bell times in this schedule, so the current period is not known. Showing Period 1: 4 teachers and 5 rooms are free.');
    assert.equal(await page.evaluate(() => document.querySelector('[data-pick="period"]').options[1].textContent), 'Period 1');
    await page.select('[data-pick="period"]', '2');
    assert.equal(await says(page), 'Period 3 on A Day: 4 teachers and 5 rooms are free.');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

// ---------------------------------------------------------------- Where right now

test('Where right now: a group\'s room and teacher this period, and a teacher\'s group or planning', async () => {
  const session = await openPage({ every: 100 });
  try {
    const { page } = session;
    await goto(page, files.open.url + '#/now');
    assert.equal(await text(page, 'h1'), 'Where right now');
    assert.equal(await says(page), 'It is Period 3 on A Day, 9:44 AM to 10:32 AM.');
    assert.equal(await text(page, '[data-out="where"]'), 'Choose a group or a teacher above.');
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('#now-who optgroup'), (group) => group.label + ' ' + group.children.length)), ['Groups 8', 'Teachers 12']);

    await page.select('#now-who', 'g:gsample06a');
    assert.equal(await hash(page), '#/now?g=gsample06a');
    assert.equal(await text(page, '[data-where="sentence"]'), '6A is in Room 101 with Ms. Halloran right now.');
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('[data-where="sentence"] a'), (link) => link.getAttribute('href'))), ['#/group/gsample06a', '#/room/rsample101', '#/teacher/tsample001']);
    assert.equal(await text(page, '[data-where="floor"]'), 'Room 101 is on Floor 1, West. Show Floor 1 on the map');
    assert.equal(await page.evaluate(() => document.querySelector('[data-where="floor"] a').getAttribute('href')), '#/map/fsample001');

    // the next period, by the clock: lunch in the Cafeteria, which has no teacher
    await setClock(page, AT_1040);
    await page.waitForFunction(() => document.querySelector('.lede').dataset.period === '3', { timeout: 5000 });
    assert.equal(await text(page, '[data-where="sentence"]'), '6A is in Cafeteria right now.');

    await page.select('#now-who', 't:tsample005');
    assert.equal(await hash(page), '#/now?t=tsample005');
    assert.equal(await text(page, '[data-where="sentence"]'), 'Ms. Oyelaran has 7C in Room 201 right now.');
    await page.select('#now-who', 't:tsample001');
    assert.equal(await text(page, '[data-where="sentence"]'), 'Ms. Halloran has no group right now: it is planning.');
    assert.equal(await text(page, '[data-out="where"] p:nth-of-type(2)'), 'Based in Room 101.');

    // between bells nothing is "right now": the period shown is named
    await setClock(page, AT_1034);
    await page.waitForFunction(() => document.querySelector('.lede').dataset.moment === 'passing', { timeout: 5000 });
    assert.equal(await text(page, '[data-where="sentence"]'), 'Ms. Halloran has no group in Period 4: it is planning.');
    assert.deepEqual(asked(session, files.open.url), []);
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('Where right now opens from its address, for a chosen period and two groups in one room', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.open.url + '#/now?t=tsample007&p=1&d=dsample00a');
    assert.equal(await says(page), 'Period 2, 8:52 AM to 9:40 AM on A Day.');
    assert.equal(await text(page, '[data-where="sentence"]'), 'Ms. Vandermeer has 6C and 7C in Room 203 in Period 2.');
    assert.equal(await page.evaluate(() => document.getElementById('now-who').value), 't:tsample007');
    await page.select('[data-pick="period"]', '4');
    assert.equal(await hash(page), '#/now?t=tsample007&p=4&d=dsample00a');
    assert.equal(await text(page, '[data-where="sentence"]'), 'Ms. Vandermeer has no group in Period 5: it is planning.');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

// ---------------------------------------------------------------- Common planning

test('Common planning: the periods when every chosen teacher is free, per day type, with the grid beneath', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.open.url + '#/common');
    assert.equal(await says(page), 'Choose two or more teachers to see when all of them are free.');
    await page.select('#common-add', 'tsample001');
    assert.equal(await says(page), 'Choose one more teacher to see when both are free.');
    await page.select('#common-add', 'tsample002');
    assert.equal(await hash(page), '#/common?t=tsample001%2Ctsample002');
    assert.equal(await says(page), 'Both are free in Period 5 and Period 6 on A Day; in Period 4 on B Day.');
    assert.deepEqual(await texts(page, '[data-out="common"] .card__title'), ['A Day', 'B Day']);
    assert.deepEqual(await texts(page, '[data-common="sentence"]'), ['Both are free in Period 5 and Period 6.', 'Both are free in Period 4.']);
    const grid = await page.evaluate(() => Array.from(document.querySelectorAll('[data-days="dsample00a"] tbody tr'), (row) => Array.from(row.cells, (cell) => cell.textContent)));
    assert.equal(grid.length, 8);
    assert.deepEqual(grid[0], ['Period 18:00 AM to 8:48 AM', 'Free', '8A in Room 102', '']);
    assert.deepEqual(grid[1], ['Period 28:52 AM to 9:40 AM', '8B in Room 101', 'Free', '']);
    assert.deepEqual(grid[4], ['Period 511:28 AM to 12:16 PM', 'Free', 'Free', 'All free']);
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('[data-days="dsample00a"] tr[data-all="true"]'), (row) => row.dataset.period)), ['4', '5']);
    assert.deepEqual(await texts(page, '[data-days="dsample00a"] thead th'), ['Period', 'Ms. Halloran', 'Mr. Brightwater', 'Together']);
    assert.deepEqual(await texts(page, '.chips__item > span'), ['Ms. Halloran', 'Mr. Brightwater']);
    assert.equal(await page.evaluate(() => Array.from(document.getElementById('common-add').options, (option) => option.value).includes('tsample001')), false, 'a teacher already chosen is not offered again');

    await page.select('#common-add', 'tsample003');
    assert.equal(await says(page), 'All 3 are free in Period 5 on A Day.');
    assert.deepEqual(await texts(page, '[data-common="sentence"]'), ['All 3 are free in Period 5.', 'There is no period when all 3 are free.']);
    await page.click('[data-remove="tsample002"]');
    assert.equal(await hash(page), '#/common?t=tsample001%2Ctsample003');
    assert.equal(await says(page), 'Both are free in Period 1, Period 5 and Period 8 on A Day; in Period 3 and Period 5 on B Day.');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'common-add', 'focus goes somewhere that still exists');
    assert.deepEqual(asked(session, files.open.url), []);
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('Common planning opens from its address, drops ids that name nobody or come twice, and says when there is no common period', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.open.url + '#/common?t=tsample002,tnobody000,tsample002,tsample005,tsample007,tsample008');
    assert.deepEqual(await texts(page, '.chips__item > span'), ['Mr. Brightwater', 'Ms. Oyelaran', 'Ms. Vandermeer', 'Mme. Dufrêne']);
    // no period on either day type has all four of them free
    assert.equal(await says(page), 'These 4 teachers are never all free in the same period.');
    assert.deepEqual(await texts(page, '[data-common="sentence"]'), ['There is no period when all 4 are free.', 'There is no period when all 4 are free.']);
    assert.equal(await page.evaluate(() => document.querySelectorAll('tr[data-all="true"]').length), 0);
    await goto(page, files.open.url + '#/common?t=tsample002,tsample004');
    // Mr. Brightwater and Coach Dunmore share nothing on A Day, and Period 8 on B Day
    assert.equal(await says(page), 'Both are free in Period 8 on B Day.');
    assert.deepEqual(await texts(page, '[data-common="sentence"]'), ['There is no period when both are free.', 'Both are free in Period 8.']);
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

// ---------------------------------------------------------------- Coverage

const candidates = (page, period) => page.evaluate((p) => Array.from(document.querySelectorAll('[data-out="coverage"] [data-period="' + p + '"] [data-list="candidates"] li'), (item) => item.querySelector('.list__name').firstChild.textContent + (item.dataset.same === 'true' ? ' *' : '')), period);

test('Coverage lists who is free in each period the teacher teaches, same subject first', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.open.url + '#/coverage/tsample003');
    assert.equal(await text(page, 'h1'), 'Coverage: Dr. Quillfeather');
    assert.equal(await says(page), 'Dr. Quillfeather teaches 5 of 8 periods on A Day. Somebody is free in every one of them.');
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('[data-out="coverage"] > [data-period]'), (card) => card.dataset.period)), ['1', '2', '3', '5', '6'], 'one card for each period taught, and none for planning');
    // Ms. Thistlewood teaches science too: tenth in the school's list, first here
    assert.deepEqual(await candidates(page, '1'), ['Ms. Thistlewood *', 'Mr. Brightwater', 'Ms. Oyelaran', 'Mr. Pennywhistle', 'Ms. O\'Fennimore']);
    assert.deepEqual(await candidates(page, '2'), ['Ms. Thistlewood *', 'Ms. Oyelaran', 'Mr. Castellanos', 'Ms. O\'Fennimore']);
    // in Period 7 she has a group herself, so nobody is marked
    assert.deepEqual(await candidates(page, '6'), ['Ms. Halloran', 'Coach Dunmore', 'Ms. Oyelaran', 'Mr. Larkspur']);
    assert.equal(await text(page, '[data-out="coverage"] [data-period="1"] .tag'), 'Same subject');
    assert.equal(await text(page, '[data-out="coverage"] [data-period="1"] .card__title'), 'Period 28:52 AM to 9:40 AM');
    assert.equal(await text(page, '[data-out="coverage"] [data-period="1"] > p'), '6A in Room 103');
    assert.equal(await text(page, '[data-out="coverage"] [data-period="1"] li:first-child .list__detail'), 'Science · Room 301');
    assert.equal(await text(page, '[data-out="coverage"] [data-period="1"] h2.results__heading'), 'Free to cover (5)');
    assert.equal(await page.evaluate(() => document.querySelector('[data-out="coverage"] [data-list="candidates"] a').getAttribute('href')), '#/teacher/tsample010');
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('.page__body > .actions a'), (link) => link.textContent + ' ' + link.getAttribute('href'))), ['Substitute plan #/sub/tsample003?d=dsample00a', 'The teacher\'s page #/teacher/tsample003']);

    await page.click('[data-pick="day"] input[value="dsample00b"]');
    assert.equal(await says(page), 'Dr. Quillfeather teaches 5 of 8 periods on B Day. Somebody is free in every one of them.');
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('[data-out="coverage"] > [data-period]'), (card) => card.dataset.period)), ['0', '1', '3', '5', '7']);
    assert.deepEqual(await candidates(page, '0'), ['Ms. Thistlewood *', 'Ms. Halloran', 'Mr. Castellanos', 'Mr. Larkspur']);
    assert.deepEqual(asked(session, files.open.url), []);
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('Coverage with no teacher in the address asks for one, and says when nobody is free', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.open.url + '#/coverage');
    assert.equal(await text(page, 'h1'), 'Coverage');
    assert.equal(await page.evaluate(() => document.querySelector('label[for="coverage-teacher"]').textContent), 'Teacher who is out');
    await page.select('#coverage-teacher', 'tsample009');
    await page.waitForFunction(() => document.querySelector('h1').textContent === 'Coverage: Mr. Pennywhistle', { timeout: 5000 });
    assert.equal(await hash(page), '#/coverage/tsample009');
    await page.goBack();
    await page.waitForFunction(() => document.querySelector('h1').textContent === 'Coverage', { timeout: 5000 });

    // a school of one teacher with groups: nobody else exists to be free
    const lone = await write('lone', (project) => {
      const kept = project.teachers[2];
      for (const floor of project.building.floors) {
        for (const space of floor.spaces) {
          if (space.kind === 'room') space.teacherIds = space.teacherIds.filter((id) => id === kept.id);
        }
      }
      project.teachers = [kept];
    });
    await goto(page, lone.url + '#/coverage/tsample003');
    assert.equal(await says(page), 'Dr. Quillfeather teaches 5 of 8 periods on A Day. Nobody is free in Period 2, Period 3, Period 4, Period 6 and Period 7.');
    assert.equal(await text(page, '[data-out="coverage"] [data-period="1"] .muted'), 'Nobody is free this period.');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

// ---------------------------------------------------------------- Substitute plan

test('the substitute plan is one page: the day, a date, who could cover, the room, the notes and the office line', async () => {
  const session = await openPage({ at: AT_2230 });
  try {
    const { page } = session;
    await goto(page, files.hostile.url + '#/sub/tsample003?d=dsample00a');
    assert.equal(await text(page, 'h1'), 'Substitute plan: Dr. Quillfeather');
    assert.equal(await says(page), 'Dr. Quillfeather\'s day on A Day: 5 of 8 periods with a group.');
    // 02:30 UTC on the 2nd is still the 1st in New York
    assert.equal(await page.evaluate(() => document.getElementById('sub-date').value), '2026-09-01');
    assert.equal(await page.evaluate(() => document.querySelector('label[for="sub-date"]').textContent), 'Date');

    const rows = await page.evaluate(() => Array.from(document.querySelectorAll('[data-sub="day"] .row'), (row) => [row.querySelector('.row__when').innerText.replace(/\n/g, ' | '), row.querySelector('.row__what').textContent]));
    assert.deepEqual(rows, [
      ['Period 1 | 8:00 AM to 8:48 AM', 'Planning'],
      ['Period 2 | 8:52 AM to 9:40 AM', HOSTILE + ' G in Room 103'],
      ['Period 3 | 9:44 AM to 10:32 AM', '6B in Room 103'],
      ['Period 4 | 10:36 AM to 11:24 AM', '8A in Room 103'],
      ['Period 5 | 11:28 AM to 12:16 PM', 'Planning'],
      ['Period 6 | 12:20 PM to 1:08 PM', '8B in Room 103'],
      ['Period 7 | 1:12 PM to 2:00 PM', '7B in Room 103'],
      ['Period 8 | 2:04 PM to 2:52 PM', 'Planning'],
    ]);
    assert.equal(await text(page, '[data-sub="day"] .card__title'), 'The day: A Day');
    assert.equal(await text(page, '[data-sub="day"] > .muted'), 'Science · Room 103');
    assert.deepEqual(await texts(page, '[data-sub="cover"] li'), [
      'Period 2: Ms. Thistlewood (same subject), Mr. Brightwater, Ms. Oyelaran, and 2 more',
      'Period 3: Ms. Thistlewood (same subject), Ms. Oyelaran, Mr. Castellanos, and 1 more',
      'Period 4: Ms. Thistlewood (same subject), ' + HOSTILE + ' T, Coach Dunmore, and 4 more',
      'Period 6: Ms. Thistlewood (same subject), ' + HOSTILE + ' T, Mr. Brightwater, and 1 more',
      'Period 7: ' + HOSTILE + ' T, Coach Dunmore, Ms. Oyelaran, and 1 more',
    ]);
    assert.equal(await text(page, '[data-sub="room"] p'), 'Room 103 is on Floor 1, West. Show Floor 1 on the map');
    // the notes are text: the line break is kept and nothing in them is markup
    assert.equal(await text(page, '[data-sub="notes"] .notes'), NOTES);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[data-sub="notes"] .notes')).whiteSpace), 'pre-wrap');
    assert.equal(await page.evaluate(() => document.querySelector('[data-sub="notes"] b, [data-sub="day"] img, [data-sub="cover"] img')), null);
    assert.equal(await page.evaluate(() => globalThis.__pwned), undefined);
    assert.match(await text(page, '[data-sub="check"]'), /^Check this plan with the office before the day starts\. This schedule was published on (1 January 2999|January 1, 2999) and may have changed since\.$/);

    await page.click('[data-sub="print"]');
    assert.equal(await page.evaluate(() => globalThis.sv2Printed), 1, 'the button asks the browser to print');

    await page.click('[data-pick="day"] input[value="dsample00b"]');
    assert.equal(await text(page, '[data-sub="day"] .card__title'), 'The day: B Day');
    assert.equal(await text(page, '[data-sub="day"] .row:first-child .row__what'), '6B in Room 103');
    assert.equal(await hash(page), '#/sub/tsample003?d=dsample00b');
    await page.evaluate(() => {
      const input = document.getElementById('sub-date');
      input.value = '2026-09-14';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    assert.equal(await hash(page), '#/sub/tsample003?d=dsample00b&date=2026-09-14');
    await page.goto('about:blank');
    await goto(page, files.hostile.url + '#/sub/tsample003?d=dsample00b&date=2026-09-14');
    assert.equal(await page.evaluate(() => document.getElementById('sub-date').value), '2026-09-14', 'the date in the address is the date on the page');
    assert.deepEqual(asked(session, files.hostile.url), []);
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('on paper the substitute plan is one column with the pickers, buttons and bar left off', async () => {
  const session = await openPage({ width: 1280, height: 900 });
  try {
    const { page } = session;
    await goto(page, files.open.url + '#/sub/tsample001');
    assert.equal(await text(page, '[data-sub="notes"] .muted'), 'No notes were left in this schedule.');
    await page.emulateMediaType('print');
    const paper = await page.evaluate(() => {
      const shown = (selector) => Array.from(document.querySelectorAll(selector)).filter((el) => el.getClientRects().length > 0).length;
      const cards = Array.from(document.querySelectorAll('[data-out="sub"] > *'), (el) => el.getBoundingClientRect());
      return {
        bar: shown('.bar'),
        buttons: shown('.page button'),
        dayPicker: shown('[data-pick="day"]'),
        mapLinks: shown('[data-sub="room"] a.no-print'),
        date: shown('#sub-date'),
        rows: shown('[data-sub="day"] .row'),
        check: shown('[data-sub="check"]'),
        lefts: Array.from(new Set(cards.map((rect) => Math.round(rect.left)))).length,
        widths: Array.from(new Set(cards.map((rect) => Math.round(rect.width)))).length,
        stacked: cards.every((rect, index) => index === 0 || rect.top >= cards[index - 1].bottom),
      };
    });
    assert.deepEqual(paper, { bar: 0, buttons: 0, dayPicker: 0, mapLinks: 0, date: 1, rows: 8, check: 1, lefts: 1, widths: 1, stacked: true });
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

// ---------------------------------------------------------------- Directions

test('Directions shows the engine\'s own route and words, with a step-free option', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.open.url + '#/directions');
    assert.equal(await says(page), 'Choose where you are starting and where you are going.');
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('#directions-from optgroup'), (group) => group.label + ' ' + group.children.length)), ['Floor 1 5', 'Floor 2 5', 'Floor 3 3']);
    await page.select('#directions-from', 'rsample101');
    await page.select('#directions-to', 'rsample303');
    assert.equal(await hash(page), '#/directions?from=rsample101&to=rsample303');
    assert.equal(await says(page), 'From Room 101 to Room 303: about 4 minutes, 2 flights of stairs.');

    // what the planner's engine says for the same two rooms, on the same published data
    const model = files.open.model;
    const graph = routingGraph(model, buildGraph(model));
    const written = directions(model, route(graph, 'rsample101', 'rsample303'));
    const steps = await texts(page, '.steps > li');
    assert.deepEqual(steps, written.steps.map((step) => step.text));
    assert.equal(steps.length, 15);
    assert.equal(steps[0], 'Turn left out of the door.');
    assert.equal(steps[4], 'Take stairs A up to Floor 2.');
    assert.equal(steps[14], 'Room 303 is on your right.');
    assert.equal(await text(page, '[data-directions="steps"] h2'), 'The way (15)');
    assert.deepEqual(await texts(page, '[data-directions="floors"] li'), ['Floor 1, then stairs A', 'Floor 2, then stairs B', 'Floor 3, where the walk ends']);
    assert.equal(await page.evaluate(() => document.querySelector('[data-directions="floors"] a').getAttribute('href')), '#/map/fsample001');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.steps')).listStyleType), 'decimal', 'the steps are numbered');

    // step-free: this building has only stairs between floors
    await page.click('#directions-stepfree');
    assert.equal(await hash(page), '#/directions?from=rsample101&to=rsample303&stepfree=1');
    assert.equal(await says(page), 'There is no step-free way through from Room 101 to Room 303 on Floor 3.');
    assert.equal(await page.evaluate(() => document.querySelector('.steps')), null);
    await page.click('[data-directions="stairs"] button');
    assert.equal(await page.evaluate(() => document.getElementById('directions-stepfree').checked), false);
    assert.equal(await hash(page), '#/directions?from=rsample101&to=rsample303');
    assert.equal((await texts(page, '.steps > li')).length, 15);

    // on one floor a step-free way exists and is said to be one
    await page.click('#directions-stepfree');
    await page.select('#directions-to', 'rsample103');
    assert.equal(await says(page), 'From Room 101 to Room 103: under a minute, all on one floor, step-free.');
    assert.deepEqual(await texts(page, '.steps > li'), directions(model, route(graph, 'rsample101', 'rsample103', { avoidStairs: true })).steps.map((step) => step.text));
    assert.deepEqual(await texts(page, '[data-directions="floors"] li'), ['Floor 1, where the walk ends']);

    await page.click('[data-directions="swap"]');
    assert.equal(await hash(page), '#/directions?from=rsample103&to=rsample101&stepfree=1');
    assert.equal(await says(page), 'From Room 103 to Room 101: under a minute, all on one floor, step-free.');
    await page.select('#directions-to', 'rsample103');
    assert.equal(await says(page), 'This is the same room. There is no travel.');
    assert.deepEqual(asked(session, files.open.url), []);
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('Directions opens from its address, and an id that names no room is left unchosen', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.open.url + '#/directions?from=rsample201&to=rsamplegym');
    assert.equal(await says(page), 'From Room 201 to Gym: about 2 minutes, 1 flight of stairs.');
    assert.equal(await page.evaluate(() => document.getElementById('directions-from').value + ' ' + document.getElementById('directions-to').value), 'rsample201 rsamplegym');
    assert.deepEqual(await texts(page, '[data-directions="floors"] li'), ['Floor 2, then stairs A', 'Floor 1, where the walk ends']);
    await goto(page, files.open.url + '#/directions?from=rnobody000&to=rsamplegym');
    assert.equal(await says(page), 'Choose where you are starting and where you are going.');
    assert.equal(await page.evaluate(() => document.getElementById('directions-from').value), '');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

// ---------------------------------------------------------------- names, left-out views, sharing

test('a name with markup in it is shown as typed on every one of the six pages', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    const teacher = HOSTILE + ' T';
    const group = HOSTILE + ' G';
    await goto(page, files.hostile.url + '#/free?p=0&d=dsample00a');
    assert.equal((await freeNames(page))[0], teacher);
    await move(page, '#/now?g=gsample06a&p=2&d=dsample00a', 'Where right now');
    assert.equal(await text(page, '[data-where="sentence"]'), group + ' is in Room 101 with ' + teacher + ' in Period 3.');
    assert.equal(await page.evaluate(() => document.querySelector('#now-who option[value="g:gsample06a"]').textContent), group);
    await move(page, '#/common?t=tsample001,tsample003', 'Common planning');
    assert.deepEqual(await texts(page, '.chips__item > span'), [teacher, 'Dr. Quillfeather']);
    assert.equal(await page.evaluate(() => document.querySelector('[data-remove="tsample001"]').getAttribute('aria-label')), 'Remove ' + teacher);
    assert.equal(await page.evaluate(() => document.querySelector('[data-days="dsample00a"] tbody tr:nth-child(3) td').textContent), group + ' in Room 101');
    await move(page, '#/coverage/tsample001', 'Coverage: ' + teacher);
    assert.equal(await page.title(), 'Coverage: ' + teacher + ' · ' + HOSTILE);
    await move(page, '#/sub/tsample001', 'Substitute plan: ' + teacher);
    assert.match(await says(page), /'s day on A Day: 2 of 8 periods with a group\.$/);
    await move(page, '#/directions?from=rsample101&to=rsample102', 'Directions');
    assert.equal(await says(page), 'From Room 101 to Room 102: under a minute, all on one floor.');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.page img, .page b, .page script').length), 0, 'a typed name became an element');
    assert.equal(await page.evaluate(() => globalThis.__pwned), undefined);
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('where the publisher left a view out, its names are plain text and its links are gone', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.bare.url + '#/free');
    assert.deepEqual(await freeNames(page), ['Ms. Oyelaran', 'Mr. Castellanos', 'Ms. Thistlewood', 'Ms. O\'Fennimore']);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.page a').length), 0, 'a link to a view that is not in the file');
    assert.equal(await page.evaluate(() => document.querySelector('.page .tabs')), null, 'Where right now is not in this file, so there is no pair to move between');
    await move(page, '#/now', 'Where right now');
    assert.equal(await says(page), 'This view was not included when this schedule was published.');
    await move(page, '#/sub/tsample003', 'Substitute plan: Dr. Quillfeather');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.page a').length), 0);
    assert.equal(await text(page, '[data-sub="room"] p'), 'Room 103 is on Floor 1, West. ');
    await move(page, '#/directions?from=rsample101&to=rsample303', 'Directions');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.page a').length), 0);
    assert.deepEqual(await texts(page, '[data-directions="floors"] li'), ['Floor 1, then stairs A', 'Floor 2, then stairs B', 'Floor 3, where the walk ends']);
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('Share hands the page\'s name to the device and never a file address; without a share sheet there is no button', async () => {
  const sharing = await openPage({ share: true });
  const plain = await openPage();
  try {
    await goto(sharing.page, files.open.url + '#/coverage/tsample003');
    assert.deepEqual(await texts(sharing.page, '[data-actions="share"] button'), ['Share'], 'Copy link is only for a file on a web address');
    await sharing.page.click('[data-share="share"]');
    assert.deepEqual(await sharing.page.evaluate(() => globalThis.sv2Shared), [{ title: 'Coverage: Dr. Quillfeather · ' + SCHOOL, text: 'Coverage: Dr. Quillfeather · ' + SCHOOL }]);
    for (const [to, title] of [['#/free', 'Free right now'], ['#/now', 'Where right now'], ['#/common', 'Common planning'], ['#/sub/tsample003', 'Substitute plan: Dr. Quillfeather'], ['#/directions', 'Directions']]) {
      await move(sharing.page, to, title);
      assert.equal(await sharing.page.evaluate(() => document.querySelectorAll('[data-share="share"]').length), 1, to);
    }
    await goto(plain.page, files.open.url + '#/coverage/tsample003');
    assert.equal(await plain.page.evaluate(() => document.querySelector('[data-actions="share"]')), null);
    assert.deepEqual(sharing.errors.concat(plain.errors), []);
  } finally {
    await sharing.close();
    await plain.close();
  }
});

// ---------------------------------------------------------------- phone and desktop, both themes

const PAGES = [
  ['#/free', 'Free right now'],
  ['#/now?g=gsample06a', 'Where right now'],
  ['#/common?t=tsample001,tsample002,tsample003', 'Common planning'],
  ['#/coverage/tsample003', 'Coverage: Dr. Quillfeather'],
  ['#/sub/tsample003', 'Substitute plan: Dr. Quillfeather'],
  ['#/directions?from=rsample101&to=rsample303', 'Directions'],
  ['#/directions?from=rsample101&to=rsample303&stepfree=1', 'Directions'],
];

for (const [width, height] of [[390, 760], [1280, 900]]) {
  for (const theme of ['light', 'dark']) {
    test('the six pages at ' + width + ' px, ' + theme + ': axe passes, nothing runs off the side, and what is tapped is big enough', async () => {
      const session = await openPage(width === 390 ? { theme } : { theme, width, height });
      try {
        const { page } = session;
        await goto(page, files.open.url + PAGES[0][0]);
        for (const [to, title] of PAGES) {
          if (to !== PAGES[0][0]) await move(page, to, title);
          const name = to + ' at ' + width + ' px, ' + theme;
          await axe(page, name);
          const layout = await page.evaluate(() => {
            const column = document.querySelector('.page').getBoundingClientRect();
            const small = [];
            for (const el of document.querySelectorAll('.page a.list__link, .page button, .page select, .page input:not([type="radio"]):not([type="checkbox"]), .page .pick__name, .page label.check, .page .tab')) {
              const rect = el.getBoundingClientRect();
              if (rect.width > 0 && rect.height < 44) small.push(el.className + ' ' + Math.round(rect.height));
            }
            const fields = Array.from(document.querySelectorAll('.page select, .page input:not([type="radio"]):not([type="checkbox"])'), (el) => parseFloat(getComputedStyle(el).fontSize));
            return {
              sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
              column: Math.round(column.width),
              small,
              smallestField: fields.length > 0 ? Math.min(...fields) : 16,
              paper: getComputedStyle(document.body).backgroundColor,
            };
          });
          assert.equal(layout.sideways, 0, name + ' scrolls sideways');
          assert.deepEqual(layout.small, [], name + ' has something under 44 px to tap');
          assert.ok(layout.smallestField >= 16, name + ' has a field under 16 px');
          assert.ok(layout.column <= 720, name + ' is wider than the 720 px column');
          assert.equal(layout.paper, theme === 'dark' ? 'rgb(21, 24, 28)' : 'rgb(246, 243, 236)', name + ' is not in the ' + theme + ' theme');
        }
        assert.deepEqual(asked(session, files.open.url), []);
        assert.deepEqual(session.errors, []);
      } finally {
        await session.close();
      }
    });
  }
}

test('on a phone the wide grid scrolls inside its own frame, reachable by keyboard', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.open.url + '#/common?t=tsample001,tsample002,tsample003,tsample004');
    const frame = await page.evaluate(() => {
      const scroll = document.querySelector('[data-days="dsample00a"] .scroll');
      return { wider: scroll.scrollWidth > scroll.clientWidth, tabindex: scroll.getAttribute('tabindex'), role: scroll.getAttribute('role'), label: scroll.getAttribute('aria-label'), page: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    assert.deepEqual(frame, { wider: true, tabindex: '0', role: 'region', label: 'The full grid for A Day', page: 0 });
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});
