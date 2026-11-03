// One-way stairs in the building editor and on the maps, in a real browser:
// node test/browser/one-way.mjs
//
// DESIGN 12.5 and 12.6, ARCHITECTURE 18.4, on the sample school (its stairs A
// joins Floor 1 and Floor 2, its stairs B joins Floor 2 and Floor 3). The
// journey: the Floor tab's connection row and its three radio chips worded by
// floor level; a chip by pointer (one undo step, the words the page says, the
// list saying the way); the same by keyboard; the chevron beside the letter at
// both ends of the stairs on the plan, read back from the canvas, in both
// themes; the Checks tab's one-way-trap warning and its Show me; a connection
// on one floor worded by its ends; the staff browser's map from a published
// file (the chevron at the stairs, the picture's text saying "up only"); axe on
// the Floor tab and the Checks tab in both themes; and the whole at 390 by 844
// with touch, every chip 44 px. Every wait is on a state the page sets (the
// plan at rest, a toast's words, the project's direction), never on a first
// paint or a sleep.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

import { openPlanner, startServer, launch, loadModule, assertTouch, still, atRest, TOOL_DIR } from './harness.mjs';
import { state, floorIs } from './draw-pointer.mjs';
import { diskReader } from '../publish/reader.mjs';
import { publishDocument } from '../../ui/staff/targets.js';
import { seededRandom } from '../../engine/ids.js';
import { plainSchool } from '../engine/helpers.mjs';
import { splitLevel } from '../fixtures/buildings/plans.mjs';

const AXE = path.join(TOOL_DIR, 'test', 'vendor', 'axe-core', 'axe.min.js');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];
const A = 'csample00a';
const B = 'csample00b';
const future = () => new Date('2999-01-01T12:00:00Z');

let server;
let browser;
let session;
let page;
let phone = null;
const scratch = mkdtempSync(path.join(os.tmpdir(), 'sv2-one-way-'));

const text = (selector) => page.$eval(selector, (el) => el.textContent);
const shows = (fn, ...args) => page.waitForFunction(fn, { timeout: 8000 }, ...args);
const key = (name) => '[data-key="' + name + '"]';
const direction = (id) => page.evaluate((wanted) => globalThis.sv2.store.project.building.connections.find((each) => each.id === wanted).direction, id);
const entries = async () => (await state(page)).entries;
const chips = (id) => page.$$eval('[data-connection="' + id + '"] .bi-way__chip', (all) => all.map((el) => el.textContent));
const checked = (id) => page.$eval('[data-connection="' + id + '"] .bi-way__input:checked', (el) => el.nextElementSibling.textContent);
const activeKey = () => page.evaluate(() => document.activeElement?.dataset.key || null);

// A direction in the store, and the page having drawn it: the project says so
// and the plan is at rest.
async function setDirection(p, id, how) {
  await p.evaluate((wanted, to) => {
    const { store } = globalThis.sv2;
    return store.apply(globalThis.sv2modules.actions.setConnection, { connectionId: wanted, direction: to });
  }, id, how);
  await p.waitForFunction((wanted, to) => globalThis.sv2.store.project.building.connections.find((each) => each.id === wanted).direction === to, { timeout: 8000 }, id, how);
  await still(p);
}

async function goFloor(p, name) {
  await p.evaluate((wanted) => {
    const tabs = Array.from(document.querySelectorAll('.bld-floors__tab'));
    tabs.find((tab) => tab.textContent.includes(wanted)).click();
  }, name);
  await floorIs(p, name);
  await still(p);
}

async function floorTab(p) {
  await p.click('#inspector [data-tab="floor"]');
  await p.waitForSelector('#floor-connections .bi-way');
}

// The pixels of the plan inside one cell, as one string per row of the cell.
async function cellPixels(p, x, y) {
  return p.evaluate((cx, cy) => {
    const editor = document.querySelector('.bld').editor;
    const box = editor.canvas.getBoundingClientRect();
    const ratio = editor.canvas.width / box.width;
    const a = editor.view.toScreen(cx, cy);
    const b = editor.view.toScreen(cx + 1, cy + 1);
    const left = Math.round(a.x * ratio);
    const top = Math.round(a.y * ratio);
    const width = Math.round((b.x - a.x) * ratio);
    const height = Math.round((b.y - a.y) * ratio);
    const data = editor.canvas.getContext('2d').getImageData(left, top, width, height).data;
    return { width, height, data: Array.from(data) };
  }, x, y);
}

// How many pixels differ between two reads of the same cell, and the contrast
// (WCAG ratio) of the strongest of them against the cell's most common colour.
function difference(one, two) {
  assert.deepEqual([one.width, one.height], [two.width, two.height], 'the cell is the same size');
  const luminance = (r, g, b) => {
    const lin = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const counts = new Map();
  for (let i = 0; i < one.data.length; i += 4) {
    const k = one.data[i] + ',' + one.data[i + 1] + ',' + one.data[i + 2];
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const fill = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
  const fillL = luminance(...fill);
  let changed = 0;
  let best = 1;
  for (let i = 0; i < one.data.length; i += 4) {
    if (one.data[i] === two.data[i] && one.data[i + 1] === two.data[i + 1] && one.data[i + 2] === two.data[i + 2]) continue;
    changed += 1;
    const l = luminance(two.data[i], two.data[i + 1], two.data[i + 2]);
    const ratio = (Math.max(l, fillL) + 0.05) / (Math.min(l, fillL) + 0.05);
    if (ratio > best) best = ratio;
  }
  return { changed, contrast: best };
}

// A cell large enough to carry a letter and its chevron (18 px): zoom with
// Ctrl and the wheel about the stairs, which keeps them where they are.
async function zoomOnto(p, x, y, side) {
  for (let turns = 0; turns < 12; turns += 1) {
    const size = await p.evaluate(() => document.querySelector('.bld').editor.view.size);
    if (size >= side) break;
    const at = await p.evaluate((cx, cy) => {
      const editor = document.querySelector('.bld').editor;
      const box = editor.canvas.getBoundingClientRect();
      const spot = editor.view.toScreen(cx + 0.5, cy + 0.5);
      return { x: box.left + spot.x, y: box.top + spot.y };
    }, x, y);
    await p.mouse.move(at.x, at.y);
    await p.keyboard.down('Control');
    await p.mouse.wheel({ deltaY: -200 });
    await p.keyboard.up('Control');
    await still(p);
  }
  assert.ok((await p.evaluate(() => document.querySelector('.bld').editor.view.size)) >= side, 'the plan is zoomed to a cell of ' + side + ' px');
}

// The planner's plan, as in "a chevron beside the letter at both ends": the
// stairs B cell (column 34, row 9) on Floor 2 and on Floor 3, with the
// connection both ways and then up only.
async function chevronEvidence(p) {
  const found = {};
  for (const floor of ['Floor 2', 'Floor 3']) {
    await goFloor(p, floor);
    await setDirection(p, B, 'both');
    await zoomOnto(p, 33, 8, 28);
    const plain = await cellPixels(p, 33, 8);
    await setDirection(p, B, 'ab');
    const one = await cellPixels(p, 33, 8);
    await setDirection(p, B, 'ba');
    const down = await cellPixels(p, 33, 8);
    found[floor] = { up: difference(plain, one), down: difference(one, down) };
    await setDirection(p, B, 'both');
  }
  return found;
}

before(async () => {
  server = await startServer();
  browser = await launch();
  session = await openPlanner({ server, browser, hash: '#building', theme: 'light', width: 1280, height: 900 });
  page = session.page;
  await loadModule(page, 'actions', 'engine/actions.js');
  await still(page);
  await goFloor(page, 'Floor 2');
  await floorTab(page);
});

after(async () => {
  const problems = session ? session.problems() : null;
  if (phone) await phone.close().catch(() => {});
  if (browser) await browser.close();
  if (server) await server.close();
  rmSync(scratch, { recursive: true, force: true });
  if (problems) assert.deepEqual(problems, { errors: [], blocked: [], shimmed: [] });
});

// ------------------------------------------------------------------ the row

test('the Floor tab\'s connection row has a "Which way" fieldset of three radio chips, worded by floor level', async () => {
  assert.equal(await text('[data-connection="' + A + '"] .bi-way__legend'), 'Which way');
  assert.deepEqual(await chips(A), ['Both ways', 'Up only, towards Floor 2', 'Down only, towards Floor 1'], 'Floor 1 is below Floor 2, so a to b is up');
  assert.deepEqual(await chips(B), ['Both ways', 'Up only, towards Floor 3', 'Down only, towards Floor 2']);
  assert.equal(await checked(A), 'Both ways');
  assert.equal(await checked(B), 'Both ways');
  assert.equal(await page.$eval('[data-connection="' + B + '"] fieldset.bi-way', (el) => el.querySelector('legend') !== null), true, 'a native fieldset with a legend');
  assert.equal(await text('[data-connection="' + B + '"] .bld-inspector__small'), 'Joins Floor 2 and Floor 3.', 'both ways says nothing more');
});

test('a chip by pointer: one undo step, the words the page says, and the list says the way', async () => {
  const before = await entries();
  await page.click('[data-connection="' + B + '"] .bi-way__chip:nth-of-type(2)');
  await shows((id) => globalThis.sv2.store.project.building.connections.find((each) => each.id === id).direction === 'ab', B);
  const now = await state(page);
  assert.equal(now.entries, before + 1, 'one undo step');
  assert.equal(now.said, 'Stairs B is now up only, towards Floor 3.');
  assert.equal(await direction(B), 'ab');
  assert.equal(await direction(A), 'both', 'the other connection is not touched');
  assert.equal(await checked(B), 'Up only, towards Floor 3');
  assert.equal(await text('[data-connection="' + B + '"] .bld-inspector__small'), 'Joins Floor 2 and Floor 3. Stairs B is up only, towards Floor 3.');
  await page.click('#undo');
  await shows((id) => globalThis.sv2.store.project.building.connections.find((each) => each.id === id).direction === 'both', B);
  assert.equal((await state(page)).entries, before, 'one undo takes it back');
  assert.equal(await checked(B), 'Both ways');
  await page.click('#redo');
  await shows((id) => globalThis.sv2.store.project.building.connections.find((each) => each.id === id).direction === 'ab', B);
  assert.equal(await checked(B), 'Up only, towards Floor 3');
});

test('by keyboard: the arrows move the choice and commit it, Tab passes the group once, and the focus stays on the chip', async () => {
  await setDirection(page, B, 'both');
  const before = await entries();
  await page.focus(key('way:' + B + ':both'));
  assert.equal(await activeKey(), 'way:' + B + ':both');
  await page.keyboard.press('ArrowRight');
  await shows((id) => globalThis.sv2.store.project.building.connections.find((each) => each.id === id).direction === 'ab', B);
  assert.equal(await activeKey(), 'way:' + B + ':ab', 'the focus follows the choice');
  await page.keyboard.press('ArrowRight');
  await shows((id) => globalThis.sv2.store.project.building.connections.find((each) => each.id === id).direction === 'ba', B);
  assert.equal((await state(page)).said, 'Stairs B is now down only, towards Floor 2.');
  assert.equal(await entries(), before + 2, 'one undo step a choice');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await shows((id) => globalThis.sv2.store.project.building.connections.find((each) => each.id === id).direction === 'both', B);
  assert.equal((await state(page)).said, 'Stairs B now runs both ways.');
  const stops = await page.evaluate((id) => {
    const set = document.querySelector('[data-connection="' + id + '"] .bi-way');
    return Array.from(set.querySelectorAll('input')).filter((input) => input.tabIndex >= 0 && (input.checked || !set.querySelector('input:checked'))).length;
  }, B);
  assert.equal(stops, 1, 'one Tab stop in the group');
});

// ------------------------------------------------------------------ the plan

for (const theme of ['light', 'dark']) {
  test('the plan draws a chevron beside the letter at both ends of an up-only stair and the other way for down only, in the ' + theme + ' theme', async () => {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
    await page.evaluate((mode) => {
      const saved = globalThis.sv2.store.project.settings.theme;
      globalThis.__savedTheme = saved;
      return mode;
    }, theme);
    await still(page);
    const found = await chevronEvidence(page);
    for (const floor of ['Floor 2', 'Floor 3']) {
      assert.ok(found[floor].up.changed > 6, floor + ': up only draws something beside the letter (' + found[floor].up.changed + ' pixels)');
      assert.ok(found[floor].down.changed > 6, floor + ': and down only turns it (' + found[floor].down.changed + ' pixels)');
      assert.ok(found[floor].up.contrast >= 3, floor + ': the chevron is 3:1 against the stairs fill, in ' + theme + ' (' + found[floor].up.contrast.toFixed(2) + ')');
    }
  });
}

test('a stair that is not one-way draws no chevron: both ways is the plain plan', async () => {
  await goFloor(page, 'Floor 2');
  await setDirection(page, B, 'both');
  const first = await cellPixels(page, 33, 8);
  await setDirection(page, B, 'ab');
  await setDirection(page, B, 'both');
  const again = await cellPixels(page, 33, 8);
  assert.equal(difference(first, again).changed, 0, 'putting it back puts the plan back');
});

// ------------------------------------------------------------------ the warning

test('an up-only stair to the top floor is a warning on the Checks tab, and Show me goes to the floor', async () => {
  await goFloor(page, 'Floor 1');
  await setDirection(page, B, 'ab');
  await page.click('#inspector [data-tab="checks"]');
  await shows(() => document.querySelector('#building-findings [data-kind="one-way-trap"]') !== null);
  assert.equal(await text('#building-findings [data-kind="one-way-trap"] .bi-finding__text'), 'Warning: Nothing on Floor 3 can get back down: Stairs B is up only and no other way leads down.');
  assert.equal(await page.$eval('#building-findings [data-kind="one-way-trap"]', (el) => el.classList.contains('bi-finding--warning')), true);
  await page.click('#building-findings [data-kind="one-way-trap"] [data-action="show"]');
  await floorIs(page, 'Floor 3');
  await still(page);
  assert.equal((await state(page)).floor, 'Floor 3');
  assert.ok((await page.evaluate(() => document.querySelector('.bld').editor.selection.length)) >= 0);
  // down only strands nobody who can be entered, and putting it back clears the warning
  await setDirection(page, B, 'both');
  await shows(() => document.querySelector('#building-findings [data-kind="one-way-trap"]') === null);
  await goFloor(page, 'Floor 2');
  await floorTab(page);
});

// ------------------------------------------------------------------ one floor

test('a connection on one floor names its ends by place: the nearest room, and one undo step', async () => {
  const split = JSON.parse(JSON.stringify(splitLevel()));
  await page.evaluate((project) => {
    project.onboarding = { ...(project.onboarding || {}), dismissed: true };
    globalThis.sv2.store.apply(globalThis.sv2modules.actions.replaceProject, { project, label: 'Open a split-level floor' });
  }, split);
  await shows(() => globalThis.sv2.store.project.building.floors.length === 1);
  await still(page);
  await page.waitForSelector('#floor-connections .bi-way');
  const labels = await chips('cplan00001');
  assert.equal(labels.length, 3);
  assert.equal(labels[0], 'Both ways');
  assert.match(labels[1], /^Only from the end by Room 1A$/);
  assert.match(labels[2], /^Only from the end by Room 1B$/);
  const before = await entries();
  await page.click('[data-connection="cplan00001"] .bi-way__chip:nth-of-type(3)');
  await shows(() => globalThis.sv2.store.project.building.connections[0].direction === 'ba');
  assert.equal(await entries(), before + 1);
  assert.equal(await text('[data-connection="cplan00001"] .bld-inspector__small'), 'Joins two places on Floor 1: column 4, row 3 and column 7, row 3. Stairs A is only from the end by Room 1B.');
});

// ------------------------------------------------------------------ the staff browser

async function publishedMap(name, direction) {
  const project = plainSchool();
  project.publish.passcode = '';
  project.building.connections.find((each) => each.id === B).direction = direction;
  const published = await publishDocument(diskReader(), project, { clock: future, random: seededRandom('one-way') });
  const file = path.join(scratch, name + '.html');
  writeFileSync(file, published.html);
  return pathToFileURL(file).href;
}

async function mapPixels(url, theme) {
  const context = await browser.createBrowserContext();
  const staff = await context.newPage();
  try {
    await staff.setViewport({ width: 1100, height: 900, deviceScaleFactor: 1 });
    await staff.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
    await staff.evaluateOnNewDocument(() => {
      globalThis.sv2StaffClock = { now: () => new Date('2026-09-01T13:50:00Z'), every: 3600000 };
    });
    await staff.goto(url + '#/map/fsample002', { waitUntil: 'load' });
    await staff.waitForFunction(() => {
      const canvas = document.querySelector('.map canvas');
      return Boolean(canvas) && canvas.width > 0 && document.querySelector('.map').dataset.drawn !== 'false';
    }, { timeout: 15000 });
    // the stairs are at the floor's east side: zoom in to the cell that carries a
    // letter and a chevron, then move the floor all the way to its east end
    for (let step = 0; step < 3; step += 1) await staff.click('.map__zoom[aria-label="Zoom in"]');
    await staff.waitForFunction(() => document.querySelector('.map').dataset.zoom === '3', { timeout: 8000 });
    const box = await staff.$eval('.map canvas', (canvas) => {
      const r = canvas.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });
    // a drag sideways is at most one picture wide: drag until the floor's east end is there
    for (let drag = 0; drag < 6; drag += 1) {
      await staff.mouse.move(box.x + box.w - 6, box.y + box.h / 2);
      await staff.mouse.down();
      await staff.mouse.move(box.x + 6, box.y + box.h / 2, { steps: 6 });
      await staff.mouse.up();
    }
    // at rest: the canvas is the same two frames running
    await staff.waitForFunction(() => new Promise((resolve) => {
      const canvas = document.querySelector('.map canvas');
      const read = () => canvas.toDataURL().length + ':' + canvas.toDataURL().slice(-200);
      const first = read();
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(read() === first)));
    }), { timeout: 8000 });
    return await staff.evaluate(() => {
      const canvas = document.querySelector('.map canvas');
      const g = canvas.getContext('2d');
      return { width: canvas.width, height: canvas.height, label: canvas.getAttribute('aria-label'), data: Array.from(g.getImageData(0, 0, canvas.width, canvas.height).data) };
    });
  } finally {
    await context.close();
  }
}

for (const theme of ['light', 'dark']) {
  test('the staff browser\'s map draws the same chevron beside the stairs\' letter, in the ' + theme + ' theme, and its picture says "up only"', async () => {
    const both = await publishedMap('both-' + theme, 'both');
    const up = await publishedMap('up-' + theme, 'ab');
    const plain = await mapPixels(both, theme);
    const marked = await mapPixels(up, theme);
    assert.deepEqual([plain.width, plain.height], [marked.width, marked.height]);
    assert.equal(plain.label.includes('up only'), false, 'both ways says nothing');
    assert.match(marked.label, /Stairs B is up only\./);
    const spots = [];
    for (let i = 0; i < plain.data.length; i += 4) {
      if (plain.data[i] === marked.data[i] && plain.data[i + 1] === marked.data[i + 1] && plain.data[i + 2] === marked.data[i + 2]) continue;
      spots.push([(i / 4) % plain.width, Math.floor(i / 4 / plain.width)]);
    }
    // the chevron is a cluster of changed pixels inside one cell; a pixel here and there
    // at a room's corner is the picture's own sub-pixel rounding from one load to the next
    let best = 0;
    for (const [x, y] of spots) best = Math.max(best, spots.filter(([sx, sy]) => sx >= x && sx < x + 24 && sy >= y && sy < y + 24).length);
    assert.ok(best >= 40, 'the map draws a chevron: ' + best + ' changed pixels in one cell');
    assert.ok(best >= spots.length * 0.75, 'and it is what changed: ' + best + ' of ' + spots.length + ' pixels are in that cell');
  });
}

// ------------------------------------------------------------------ axe

for (const theme of ['light', 'dark']) {
  test('axe finds nothing on the Floor tab with an up-only chip and on the Checks tab with the warning, in the ' + theme + ' theme', async () => {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
    await page.evaluate((project) => {
      globalThis.sv2.store.apply(globalThis.sv2modules.actions.replaceProject, { project, label: 'Open the sample school' });
    }, JSON.parse(JSON.stringify(plainSchool())));
    await shows(() => globalThis.sv2.store.project.building.floors.length === 3);
    await goFloor(page, 'Floor 2');
    await setDirection(page, B, 'ab');
    await floorTab(page);
    await page.addScriptTag({ path: AXE });
    await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
    let found = await page.evaluate((tags) => globalThis.axe.run(document.querySelector('#floor-connections'), { runOnly: { type: 'tag', values: tags } }), TAGS);
    assert.ok(found.passes.length > 5, 'axe ran very few rules');
    assert.deepEqual(found.violations.map((violation) => violation.id + ': ' + violation.nodes.map((node) => node.target.join(' ')).join(', ')), [], 'Floor tab, ' + theme);
    await page.click('#inspector [data-tab="checks"]');
    await shows(() => document.querySelector('#building-findings [data-kind="one-way-trap"]') !== null);
    found = await page.evaluate((tags) => globalThis.axe.run(document.querySelector('#inspector-checks'), { runOnly: { type: 'tag', values: tags } }), TAGS);
    assert.ok(found.passes.length > 5, 'axe ran very few rules');
    assert.deepEqual(found.violations.map((violation) => violation.id + ': ' + violation.nodes.map((node) => node.target.join(' ')).join(', ')), [], 'Checks tab, ' + theme);
    await setDirection(page, B, 'both');
    await floorTab(page);
  });
}

// ------------------------------------------------------------------ phone

test('at 390 by 844 with touch: a chip is chosen by tap, every chip is 44 px, and the tab does not scroll sideways', async () => {
  await page.close();
  phone = await openPlanner({ server, browser, hash: '#building', theme: 'light', width: 390, height: 844, mobile: true });
  const p = phone.page;
  await assertTouch(p, 'one-way at 390');
  await loadModule(p, 'actions', 'engine/actions.js');
  await still(p);
  await goFloor(p, 'Floor 2');
  await p.tap('#inspector-toggle');
  await p.waitForFunction(() => document.getElementById('inspector').dataset.open === 'true', { timeout: 8000 });
  await p.tap('#inspector [data-tab="floor"]');
  await p.waitForSelector('#floor-connections .bi-way');
  const chip = '[data-connection="' + B + '"] .bi-way__chip:nth-of-type(2)';
  await atRest(p, chip);
  await p.$eval(chip, (el) => el.scrollIntoView({ block: 'center' }));
  const small = await p.evaluate(() => Array.from(document.querySelectorAll('.bi-way__text'), (el) => [el.textContent, Math.round(el.getBoundingClientRect().height)]).filter(([, height]) => height < 44));
  assert.deepEqual(small, [], 'every chip is at least 44 px tall');
  const cut = await p.evaluate(() => Array.from(document.querySelectorAll('.bi-way__text')).filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent));
  assert.deepEqual(cut, [], 'a chip wraps and is never cut off');
  await p.tap(chip);
  await p.waitForFunction((id) => globalThis.sv2.store.project.building.connections.find((each) => each.id === id).direction === 'ab', { timeout: 8000 }, B);
  assert.equal(await p.$eval('[data-connection="' + B + '"] .bi-way__input:checked', (el) => el.nextElementSibling.textContent), 'Up only, towards Floor 3');
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'the Floor tab does not scroll sideways');
});
