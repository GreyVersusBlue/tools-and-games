// The staff browser's step-free work (SV2-105, ARCHITECTURE 19.8, DESIGN 13.8),
// driven in Chromium from a published file on disk with an elevator in it:
// node test/browser/staff-step-free.mjs
//
//   the building map: stops, steps and areas of refuge in words and on the
//   canvas's label; Directions: the ride as a step, the floors it joins read
//   from the route's cells, the time line, the stairs count, and the polite
//   "Route updated" region after Step-free is ticked by keyboard
//
// Two published files: `lift` has Elevator D between Floors 1 and 2 and stairs
// B between Floors 2 and 3; `chain` joins Floors 2 and 3 to it as well, so one
// ride goes from Floor 1 to Floor 3 on a car whose id is its first connection's
// (Floor 1 to Floor 2). Every wait is on a state the page sets: the app's
// `data-state`, the Directions line's `data-ok`, the polite region's own words.
// Names are invented; the planner's sample school is the building.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { launch, TOOL_DIR } from './harness.mjs';
import { diskReader } from '../publish/reader.mjs';
import { publishDocument } from '../../ui/staff/targets.js';
import { seededRandom } from '../../engine/ids.js';
import { plainSchool as sampleSchool } from '../engine/helpers.mjs';
import { F1, F2, F3, paint } from '../fixtures/step-free.mjs';

const AXE = readFileSync(path.join(TOOL_DIR, 'test', 'vendor', 'axe-core', 'axe.min.js'), 'utf8');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];
const ZONE = 'America/New_York';
const NAMES = '<b>"Wing" & 東京</b>';

const future = () => new Date('2999-01-01T12:00:00Z');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'sv2-staff-sf-'));
const read = diskReader();
const files = {};
let browser;

// Sample school with Elevator D (staff only) in place of stairs A, a refuge on
// Floor 1 and a step in a corridor on Floor 1 east of everything the routes
// below use. `blocked` puts a step on Floor 3's corridor, on the way to Room 303. `chain` also makes the Floor 2
// to Floor 3 connection an elevator, from the same cell, so D serves three floors.
function withLift(chain, blocked) {
  const project = sampleSchool();
  project.publish.passcode = '';
  const [f1, f2, f3] = project.building.floors;
  const [a, b] = project.building.connections;
  a.kind = 'elevator';
  a.staffOnly = true;
  a.car = 'D';
  f1.lifts = [332];
  f2.lifts = [332];
  f1.refuges = [{ id: 'asample001', cell: 283, name: 'Refuge by ' + NAMES }];
  f1.notStepFree = [300];
  if (blocked) f3.notStepFree = [285];
  if (chain) {
    paint(f3, 332, 'S');
    f3.lifts = [332];
    b.kind = 'elevator';
    b.staffOnly = true;
    b.car = 'D';
    b.a = { floorId: F2, cell: 332 };
    b.b = { floorId: F3, cell: 332 };
  }
  return project;
}

async function write(name, project) {
  const published = await publishDocument(read, project, { clock: future, random: seededRandom('staff-step-free ' + name) });
  const file = path.join(scratch, name + '.html');
  writeFileSync(file, published.html);
  files[name] = { file, url: pathToFileURL(file).href, model: published.model };
}

before(async () => {
  await write('lift', withLift(false));
  await write('chain', withLift(true));
  await write('blocked', withLift(true, true));
  const plain = sampleSchool();
  plain.publish.passcode = '';
  await write('plain', plain);
  browser = await launch();
});

after(async () => {
  if (browser) await browser.close();
  rmSync(scratch, { recursive: true, force: true });
});

async function openPage(options) {
  const opts = options || {};
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const phone = opts.width === undefined;
  await page.setViewport({ width: opts.width || 390, height: opts.height || 760, deviceScaleFactor: 1, hasTouch: phone, isMobile: phone });
  await page.emulateTimezone(ZONE);
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

async function goto(page, url) {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('app').dataset.state === 'open', { timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
}

// Go to an address in the file already open and wait until the Directions line
// has been written for it (the page sets `data-ok` on that line at every draw).
async function directionsAt(page, query) {
  await page.evaluate(() => {
    const line = document.querySelector('.page__body > .lede');
    if (line) line.dataset.leaving = 'true';
  });
  await page.evaluate((next) => { location.hash = next; }, '#/directions' + query);
  await page.waitForFunction(() => {
    const line = document.querySelector('.page__body > .lede');
    return line && line.dataset.ok !== undefined && line.dataset.leaving === undefined && document.querySelector('[data-out="directions"]');
  }, { timeout: 10000 });
}

async function axe(page, name) {
  if (!(await page.evaluate(() => typeof globalThis.axe === 'object'))) await page.addScriptTag({ content: AXE });
  const result = await page.evaluate((tags) => globalThis.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] }), TAGS);
  assert.ok(result.passes.length > 10, 'axe ran very few rules on ' + name);
  const said = result.violations.map((violation) => violation.id + ': ' + violation.help + ' at ' + violation.nodes.map((node) => node.target.join(' ')).join(', '));
  assert.deepEqual(said, [], 'axe on ' + name);
}

// A canvas drawn: its frame says which floor and what cell size it has (the
// page sets them at every draw).
async function mapDrawn(page, floorId) {
  await page.waitForFunction((id) => {
    const frame = document.querySelector('.map');
    return frame && frame.dataset.floor === id && frame.dataset.cell !== undefined && Number(frame.dataset.cell) > 0;
  }, { timeout: 10000 }, floorId);
}

const pixels = (page) => page.evaluate(() => {
  const canvas = document.querySelector('canvas.map__plan');
  const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum = (sum * 31 + data[i] + data[i + 1] * 3 + data[i + 2] * 7) >>> 0;
  return sum;
});

// ---------------------------------------------------------------- the map

test('the building map lists the elevator, the area of refuge and the step in words, as typed, and the canvas says so too', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.lift.url + '#/map/' + F1);
    await mapDrawn(page, F1);
    const corridor = files.lift.model.building.floors[0].corridors.find((one) => one.cells.includes(300));
    const step = corridor && corridor.name.trim() !== '' ? 'Step in ' + corridor.name + ' (1 cell)' : 'Step in a corridor with no name (1 cell)';
    assert.deepEqual(await texts(page, '[data-mark]'), ['Elevator D (staff only): stops at Floor 1 and Floor 2', 'Refuge by ' + NAMES, step]);
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('[data-mark]'), (el) => el.dataset.mark)), ['elevator', 'refuge', 'step']);
    assert.equal(await page.evaluate(() => document.querySelector('[data-mark] b, [data-mark] img')), null, 'a name is text, never markup');
    const label = await page.evaluate(() => document.querySelector('canvas.map__plan').getAttribute('aria-label'));
    assert.match(label, /Elevator D \(staff only\)\./);
    assert.ok(label.includes('Refuge by ' + NAMES + '.'), label);
    // the elevator is not a one-way stairs line, and stairs B is not listed on Floor 1
    assert.equal(await page.evaluate(() => document.querySelector('[data-stairs]')), null);

    // Floor 2 has the other stop and nothing else
    await page.evaluate((id) => { location.hash = '#/map/' + id; }, F2);
    await mapDrawn(page, F2);
    assert.deepEqual(await texts(page, '[data-mark]'), ['Elevator D (staff only): stops at Floor 1 and Floor 2']);
    assert.deepEqual(asked(session, files.lift.url), []);
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('the canvas draws the stop, the step and the refuge: the same floor of a school without them is a different picture', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.plain.url + '#/map/' + F1);
    await mapDrawn(page, F1);
    const without = await pixels(page);
    assert.equal(await page.evaluate(() => document.querySelector('[data-mark]')), null, 'a school with no elevator lists none');
    await goto(page, files.lift.url + '#/map/' + F1);
    await mapDrawn(page, F1);
    assert.notEqual(await pixels(page), without);
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

// ---------------------------------------------------------------- Directions

test('Directions names the ride, the floors it joins, the wait in the time and no flight of stairs', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.chain.url + '#/directions');
    await directionsAt(page, '?from=rsample101&to=rsample303');
    // one ride from Floor 1 to Floor 3: the car is named by its first connection, which joins Floors 1 and 2
    assert.equal(await says(page), 'From Room 101 to Room 303: about 2 minutes, by Elevator D.');
    assert.deepEqual(await texts(page, '[data-directions="floors"] li'), ['Floor 1, then Elevator D', 'Floor 3, where the walk ends']);
    const steps = await texts(page, '.steps > li');
    assert.ok(steps.includes('Take Elevator D up to Floor 3.'), steps.join(' | '));
    assert.match(await text(page, '[data-directions="time"]'), /at the school's walking pace, including the elevator's wait, for an empty corridor/);
    // the map's own words for the line on each floor
    const lines = await texts(page, '.map__says span');
    assert.ok(lines.join(' ').includes('the line runs from Room 101 to Elevator D'), lines.join(' | '));
    assert.deepEqual(asked(session, files.chain.url), []);
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('Directions counts stairs and rides apart: an elevator then a flight of stairs', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.lift.url + '#/directions');
    await directionsAt(page, '?from=rsample101&to=rsample303');
    assert.equal(await says(page), 'From Room 101 to Room 303: about 4 minutes, 1 flight of stairs, by Elevator D.');
    assert.deepEqual(await texts(page, '[data-directions="floors"] li'), ['Floor 1, then Elevator D', 'Floor 2, then stairs B', 'Floor 3, where the walk ends']);
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('ticking Step-free by keyboard announces the new way in a polite region that was on the page before it spoke', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.chain.url + '#/directions?from=rsample101&to=rsample303');
    await page.waitForFunction(() => document.querySelector('.page__body > .lede')?.dataset.ok !== undefined);
    const before = await page.evaluate(() => {
      const region = document.querySelector('[data-says="route"]');
      return region ? { text: region.textContent, live: region.getAttribute('aria-live'), role: region.getAttribute('role') } : null;
    });
    assert.deepEqual(before, { text: '', live: 'polite', role: 'status' }, 'the region is there, empty, before anything is said');
    await page.focus('#directions-stepfree');
    await page.keyboard.press('Space');
    await page.waitForFunction(() => document.querySelector('[data-says="route"]')?.textContent.startsWith('Route updated'), { timeout: 10000 });
    assert.equal(await text(page, '[data-says="route"]'), 'Route updated: takes Elevator D.');
    assert.equal(await hash(page), '#/directions?from=rsample101&to=rsample303&stepfree=1');
    assert.equal(await says(page), 'From Room 101 to Room 303: about 2 minutes, by Elevator D, step-free.');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'directions-stepfree', 'focus stays on the tick');
    assert.equal(await page.evaluate(() => document.querySelectorAll('[data-says="route"]').length), 1);
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('step-free blocked by a step on Floor 3: the page says why, politely, and offers the way with stairs; a way that exists is announced', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.blocked.url + '#/directions?from=rsample101&to=rsample303');
    await page.waitForFunction(() => document.querySelector('.page__body > .lede')?.dataset.ok !== undefined);
    await page.focus('#directions-stepfree');
    await page.keyboard.press('Space');
    await page.waitForFunction(() => document.querySelector('[data-says="route"]')?.textContent.startsWith('Route updated'), { timeout: 10000 });
    const refusal = 'There is no step-free way through from Room 101 to Room 303 on Floor 3: a step on Music Wing.';
    assert.equal(await says(page), refusal);
    assert.equal(await text(page, '[data-says="route"]'), 'Route updated: ' + refusal);
    assert.equal(await text(page, '[data-directions="stairs"]'), 'There is a way that uses stairs. Show the way with stairs');
    // a step-free way that does exist: Floor 1 to Floor 2 by the elevator alone
    await page.select('#directions-to', 'rsample201');
    await page.waitForFunction(() => document.querySelector('.page__body > .lede')?.dataset.ok === 'true');
    assert.equal(await says(page), 'From Room 101 to Room 201: about 2 minutes, by Elevator D, step-free.');
    assert.equal(await text(page, '[data-says="route"]'), 'Route updated: takes Elevator D.');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

// ---------------------------------------------------------------- a phone, and the checks

for (const [view, query] of [['map', '#/map/' + F1], ['directions', '#/directions?from=rsample101&to=rsample303&stepfree=1']]) {
  test('at 390 px the ' + view + ' page with an elevator has no sideways scroll, nothing under 44 px to tap, and axe finds nothing', async () => {
    const session = await openPage({ width: 390 });
    try {
      const { page } = session;
      await goto(page, files.chain.url + query);
      if (view === 'map') await mapDrawn(page, F1);
      else await page.waitForFunction(() => document.querySelector('.page__body > .lede')?.dataset.ok === 'true' && document.querySelector('[data-directions="steps"]'));
      const layout = await page.evaluate(() => {
        const small = [];
        // the same things staff-views-b.mjs measures: list links, buttons, fields, ticks and tabs
        const finger = matchMedia('(pointer: coarse), (max-width: 639.98px)').matches;
        const links = finger ? ', .page .facts a, .page .map__says a' : '';
        for (const el of document.querySelectorAll('.page a.list__link, .page button, .page select, .page input:not([type="radio"]):not([type="checkbox"]), .page .pick__name, .page label.check, .page .tab' + links)) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height < 44) small.push(el.tagName.toLowerCase() + '.' + el.className + ' "' + el.textContent.trim().slice(0, 40) + '" ' + Math.round(rect.height));
        }
        return { sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth, small };
      });
      assert.equal(layout.sideways, 0);
      assert.deepEqual(layout.small, []);
      await axe(page, view + ' at 390 px');
      assert.deepEqual(asked(session, files.chain.url), []);
      assert.deepEqual(session.errors, []);
    } finally {
      await session.close();
    }
  });
}

test('the file with an elevator opens from disk with no request but its own', async () => {
  const session = await openPage();
  try {
    await goto(session.page, files.chain.url);
    assert.deepEqual(asked(session, files.chain.url), []);
    assert.deepEqual(session.errors, []);
    assert.ok(files.chain.model.building.connections.some((connection) => connection.kind === 'elevator' && connection.car === 'D' && connection.staffOnly === true));
    assert.equal(JSON.stringify(files.chain.model.groups).includes('stepFree'), false);
    assert.equal(files.chain.model.building.floors[2].id, F3);
    assert.equal(files.chain.model.building.floors[1].id, F2);
  } finally {
    await session.close();
  }
});
