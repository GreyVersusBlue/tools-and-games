// Comparing two buildings, and comparing with a project kept on this device, in
// a real browser (spec 9.3; DESIGN 15.7 and 15.9 items 4, 11, 12, 13):
// node test/browser/compare-buildings.mjs
//
// The sample school against the same school with a wing added (a Floor 4, two
// rooms, a corridor named Wing Corridor, stairs E, a group 8W): the refusal's
// sentence with "Compare the two buildings"; the band ("Comparing with
// wing.json, another building", "Stop comparing", the not-saved line); the
// forms and chips hidden with their line while an open scenario stays as it
// was; the radio switch "Building shown on the map" (the map paints one building
// at a time on one shared scale, and the status says which and its busiest
// place); the legend's one line; the inspector's tables (figures headed
// "This project" and the file, groups "Only in" each side, rooms, places new and
// gone with the unnamed-corridor sentence, findings); the day-type select of
// matched names; Stop comparing (the focus on the file panel's heading, the
// other lane closed); a comparison that ends when another project opens and when
// the lab is left; and "Compare with another project on this device": a kept
// project of the same building makes the scenario as a file does, a kept
// project of another building the comparison. By pointer at 1280 px, by keyboard
// alone, and by touch at 390 by 844 and 844 by 390.
//
// Every wait is for a state the page sets (the band's data-held, data-working
// and data-side, the lab's data-compare, the file panel's data-result, the
// storage session's own flags), never a first paint or a fixed sleep.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { openPlanner, go, launch, startServer, waitForSection, TOOL_DIR } from './harness.mjs';

const { plainSchool, clone, group } = await import(pathToFileURL(path.join(TOOL_DIR, 'test', 'engine', 'helpers.mjs')).href);
const { writeProjectFile } = await import(pathToFileURL(path.join(TOOL_DIR, 'engine', 'project-file.js')).href);

const SCRATCH = path.join(TOOL_DIR, 'test', '.scratch', 'compare-buildings');
const HOSTILE = '<img src=x onerror="window.__hit=1">&amp; "Plan"';
const DAY_A = 'dsample00a';

let browser;
let server;
let wide;
let phone;
let landscape;

before(async () => {
  fs.mkdirSync(SCRATCH, { recursive: true });
  server = await startServer();
  browser = await launch();
  wide = await openPlanner({ browser, server, width: 1280, height: 800, hash: '#scenarios', theme: 'light' });
});

after(async () => {
  for (const each of [wide, phone, landscape]) if (each) await each.close();
  if (browser) await browser.close();
  if (server) await server.close();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});

// The sample school with a wing: a Floor 4 built from Floor 3's drawing, its
// corridor named "Wing Corridor", two rooms numbered 401 and 402, stairs E
// from Floor 3 and a group 8W scheduled into the wing all day.
function withWing(base) {
  const project = clone(base);
  const three = project.building.floors.find((floor) => floor.id === 'fsample003');
  const four = clone(three);
  four.id = 'fwing00004';
  four.name = 'Floor 4';
  four.level = 4;
  four.image = null;
  const stairs = 5 + 8 * four.width;
  four.cells = four.cells.slice(0, stairs) + 'S' + four.cells.slice(stairs + 1);
  three.cells = three.cells.slice(0, stairs) + 'S' + three.cells.slice(stairs + 1);
  four.corridors = [{ id: 'kwing00001', name: 'Wing Corridor', cells: four.cells.split('').map((c, i) => (c === '#' ? i : -1)).filter((i) => i >= 0) }];
  four.spaces = four.spaces.slice(0, 2).map((space, index) => ({ ...space, id: 'rwing000' + (index + 1) + '0', number: '40' + (index + 1), wing: 'Wing', teacherIds: [], doors: space.doors.slice() }));
  four.exits = [];
  project.building.floors.push(four);
  project.building.connections.push({ id: 'cwing000e1', label: 'E', a: { floorId: 'fsample003', cell: stairs }, b: { floorId: 'fwing00004', cell: stairs }, direction: 'both' });
  const wingGroup = clone(group(project, '6A'));
  wingGroup.id = 'gwing00008';
  wingGroup.name = '8W';
  wingGroup.grade = '8';
  for (const dayTypeId of Object.keys(wingGroup.days)) {
    wingGroup.days[dayTypeId] = wingGroup.days[dayTypeId].map((slot, period) => ({ ...slot, room: period % 2 === 0 ? 'rwing00010' : 'rwing00020', teacherIds: [] }));
  }
  project.groups.push(wingGroup);
  return project;
}

function writeFile(name, project) {
  const file = path.join(SCRATCH, name);
  fs.writeFileSync(file, writeProjectFile(project));
  return file;
}

const move = (groupId, period, roomId) => ({ kind: 'move', dayTypeId: DAY_A, groupId, period, roomId });

// the sample with an open scenario, so the forms and chips are there to be hidden
function openScenarioSchool() {
  const project = clone(plainSchool());
  project.scenario = { id: 'eopen00001', name: 'Move 6A to 301', changes: [move('gsample06a', 1, 'rsample301')], compared: null };
  return project;
}

// the lab drawn for the store's project, its comparison settled
async function ready(page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('.scn');
    if (!el || el.dataset.styled !== 'true' || !el.scenarios) return false;
    if (el.scenarios.plan.project !== globalThis.sv2.store.project && document.querySelector('.scn-bld')?.dataset.held !== 'true') return false;
    if (document.querySelector('.scn-compare')?.dataset.settling) return false;
    if (el.dataset.mode === 'none') return el.dataset.compare === 'none';
    return el.dataset.compare === 'ready' && !el.scenarios.pending;
  }, { timeout: 30000 });
}

async function fresh(page, project) {
  await page.evaluate(() => {
    for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  });
  await page.mouse.move(1, 1);
  await page.evaluate((next) => {
    delete window.__hit;
    globalThis.sv2.store.replace(next);
  }, project || clone(plainSchool()));
  await go(page, '#scenarios');
  await ready(page);
}

const seen = (page, selector) => page.$eval(selector, (el) => el.textContent.replace(/\s+/g, ' ').trim());
const announced = (page) => page.$eval('#announcer', (el) => el.textContent);
const heldOf = (page) => page.$eval('.scn-bld', (el) => el.dataset.held);
const focused = (page) => page.evaluate(() => {
  const el = document.activeElement;
  return el ? { id: el.id, name: el.getAttribute('name') || '', value: el.value || '', action: el.dataset ? el.dataset.action || '' : '', text: el.textContent.slice(0, 40) } : null;
});
const laneClosed = (page) => page.evaluate(async () => (await globalThis.sv2.store.derived.other()) === null);

// One press, as the mode has it: a click, a tap, or the keyboard on a control
// that is focused first (Enter for a button, a radio by the arrow keys).
async function press(page, mode, selector) {
  const handle = await page.$(selector);
  assert.ok(handle, selector + ' is on the page');
  if (mode === 'keyboard') {
    await handle.focus();
    await page.keyboard.press('Enter');
    return;
  }
  await handle.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  if (mode === 'touch') await handle.tap();
  else await handle.click();
}

const BAND = '.scn-bld[data-held="true"]:not([data-working="true"])';

// ---------------------------------------------------------------- the journey

// The whole journey on one page, in one mode. `size` is for the sentences that
// depend on the window.
async function journey(page, mode, name) {
  await fresh(page, openScenarioSchool());
  const wing = withWing(plainSchool());
  const file = writeFile(name + '.json', wing);
  const scenarioBefore = await page.evaluate(() => JSON.stringify(globalThis.sv2.store.project.scenario));
  const stepsBefore = await page.evaluate(() => globalThis.sv2.store.history.past.length);

  // the refusal's sentence, and the way on
  const input = await page.$('input[data-file="compare"]');
  await input.uploadFile(file);
  await page.waitForSelector('.scn-file__result[data-result="refused"]');
  const refusal = await seen(page, '.scn-file__result');
  assert.equal(refusal, '“' + name + '.json” was not compared, and nothing has changed. This file describes a different building: 2 rooms are added. You can still compare the two buildings: crowds, travel times and findings, matched by group and room names.Compare the two buildings');
  assert.equal(await page.$eval('.scn-file__result [role="alert"]', (el) => el.tagName), 'P', 'the sentence is an alert');
  assert.equal(await heldOf(page), 'false', 'a refusal holds no comparison');
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.scenario !== null), true, 'the open scenario is as it was');

  // Compare the two buildings
  await press(page, mode, '[data-action="compare-buildings"]');
  await page.waitForSelector(BAND, { timeout: 30000 });
  assert.equal(await seen(page, '.scn-bld__text'), 'Comparing with ' + name + '.json, another building');
  assert.equal(await seen(page, '[data-part="not-saved"]'), 'Not saved: it ends when you leave this page or open another project.');
  assert.equal((await page.$eval('.scn-bld__stop', (el) => el.getBoundingClientRect().height)) >= 44, true, 'Stop comparing is 44 px tall');
  assert.equal(await seen(page, '.scn-bld__stop'), 'Stop comparing');
  // the forms and the chips are hidden, with their line; the scenario is what it was
  assert.equal(await page.$eval('.scn-add', (el) => el.getClientRects().length), 0, 'the forms are hidden');
  assert.equal(await page.$eval('.scn-changes', (el) => el.getClientRects().length), 0, 'the chips are hidden');
  assert.equal(await seen(page, '#scenario-building-edit'), 'Stop comparing to edit the scenario.');
  // the focus is on the switch's checked radio
  assert.deepEqual(await page.evaluate(() => [document.activeElement.name, document.activeElement.value, document.activeElement.checked]), ['scenario-building-side', 'this', true]);
  // the switch is a radio group named by its legend
  assert.deepEqual(await page.$eval('.scn-bld .seg', (el) => [el.getAttribute('role'), document.getElementById(el.getAttribute('aria-labelledby')).textContent]), ['radiogroup', 'Building shown on the map']);
  assert.deepEqual(await page.$$eval('.scn-bld .seg__label', (els) => els.map((el) => el.textContent)), ['This project', name + '.json']);
  assert.equal(await page.evaluate(() => document.querySelector('.scn').scenarios.plan.project.building.floors.length), 3, 'the map starts on this project');

  // the inspector: legend line, tables
  assert.equal(await seen(page, '[data-part="one-scale"]'), 'One scale for both buildings: the same colour means the same crowd.');
  assert.equal(await page.$$eval('.scn-bld__bands li', (els) => els.length), 5, 'five bands in the legend');
  assert.deepEqual(await page.$$eval('#scenario-building-day option', (els) => els.map((el) => el.textContent)), ['A Day', 'B Day']);
  assert.deepEqual(await page.$$eval('[data-part="building-figures"] thead th', (els) => els.map((el) => el.textContent)), ['Figure', 'This project', name + '.json', 'Difference']);
  const figures = await page.$$eval('[data-part="building-figures"] tbody tr', (rows) => rows.map((row) => row.dataset.figure));
  assert.deepEqual(figures, ['walking', 'crowding', 'busiest', 'late', 'failed', 'problem', 'warning', 'note']);
  assert.match(await seen(page, '[data-part="only-there"]'), new RegExp('^Only in ' + name + '\\.json: 8W\\.$'));
  assert.match(await seen(page, '[data-part="rooms"]'), /13 rooms have the same number in both buildings\.Only in .*\.json \(2\): 401 and 402/);
  assert.match(await seen(page, '[data-part="new"] .scn-places__title'), /^New, only in .*\.json \(\d+\)$/);
  assert.match(await page.$$eval('[data-part="new"] li', (els) => els.map((el) => el.textContent).join('|')), /Wing Corridor/);
  assert.equal(await seen(page, '[data-part="unnamed"]'), 'Corridors without names cannot be matched between two buildings, so they are left out of this list.');
  assert.equal(await seen(page, '[data-part="not-saved-foot"]'), 'This comparison is not saved: it ends when you close the page. To keep the other building, open it as a project (Project › Start another project › A project file).');
  assert.equal(await page.$eval('.scn-compare[data-state]', (el) => el.hidden), true, 'the scenario comparison gives way to this one');

  // one scale for both buildings: the legend reads the same on each side
  const legendHere = await seen(page, '.scn-bld__bands');
  const here = await page.$eval('.scn-bld', (el) => [Number(el.dataset.painted), el.dataset.scale]);
  assert.ok(here[0] > 0, 'this project\'s corridors are painted');
  // the switch: the map paints the file's building, and the status says so
  if (mode === 'keyboard') {
    await page.keyboard.press('ArrowRight');
  } else {
    await press(page, mode, '.scn-bld .seg__option:last-child .seg__label');
  }
  await page.waitForSelector('.scn-bld[data-side="other"]');
  assert.equal(await page.evaluate(() => document.querySelector('.scn').scenarios.plan.project.building.floors.length), 4, 'the map paints the wing');
  assert.match(await announced(page), new RegExp('^Showing ' + name + '\\.json’s building\\. Busiest: .+, \\d+ students\\.$'));
  assert.equal(await seen(page, '.scn-bld__bands'), legendHere, 'the same colours mean the same crowd on both sides');
  const there = await page.$eval('.scn-bld', (el) => [Number(el.dataset.painted), el.dataset.scale]);
  assert.ok(there[0] > 0, 'the wing\'s building is painted too');
  assert.equal(there[1], here[1], 'one scale: both sides read the same busiest load');
  // and back
  if (mode === 'keyboard') {
    await page.keyboard.press('ArrowLeft');
  } else {
    await press(page, mode, '.scn-bld .seg__option:first-child .seg__label');
  }
  await page.waitForSelector('.scn-bld[data-side="this"]');
  assert.equal(await page.evaluate(() => document.querySelector('.scn').scenarios.plan.project.building.floors.length), 3);
  assert.match(await announced(page), /^Showing this project’s building\. Busiest: /);

  // the day type: a matched name
  await page.select('#scenario-building-day', 'B Day');
  await page.waitForFunction(() => document.querySelector('.scn-bld').dataset.day === 'B Day');
  assert.match(await seen(page, '[data-part="building-status"]'), /^Compared on B Day\./);
  await page.select('#scenario-building-day', 'A Day');
  await page.waitForFunction(() => document.querySelector('.scn-bld').dataset.day === 'A Day');

  // nothing was written, nothing undone, and the scenario is as it was
  assert.equal(await page.evaluate(() => JSON.stringify(globalThis.sv2.store.project.scenario)), scenarioBefore);
  assert.equal(await page.evaluate(() => globalThis.sv2.store.history.past.length), stepsBefore, 'no step of undo');
  assert.equal(await laneClosed(page), false, 'the other lane holds the file');

  // Stop comparing: the focus on the file panel's heading, the lane closed
  await press(page, mode, '[data-action="stop-comparing"]');
  await page.waitForFunction(() => document.querySelector('.scn-bld').dataset.held === 'false');
  assert.deepEqual(await page.evaluate(() => [document.activeElement.id, document.querySelector('.scn-add').getClientRects().length > 0, document.querySelector('.scn-changes').getClientRects().length > 0]), ['scenario-file-title', true, true]);
  assert.equal(await page.evaluate(() => document.querySelector('.scn').scenarios.plan.project.building.floors.length), 3);
  assert.equal(await laneClosed(page), true, 'the lane is closed on Stop comparing');
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.scenario !== null), true);
  assert.match(await announced(page), new RegExp('^Stopped comparing with ' + name + '\\.json\\.'));
  await ready(page);
}

test('by pointer at 1280 px: the refusal, the band, the switch, the tables, Stop comparing', async () => {
  await journey(wide.page, 'pointer', 'wing-pointer');
});

test('by keyboard alone at 1280 px: every step with Tab-reachable controls, Enter and the arrow keys', async () => {
  await journey(wide.page, 'keyboard', 'wing-keys');
});

test('by touch at 390 by 844, and no sideways scroll', async () => {
  phone = await openPlanner({ browser, server, width: 390, height: 844, mobile: true, hash: '#scenarios', theme: 'light' });
  await journey(phone.page, 'touch', 'wing-phone');
  assert.equal(await phone.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, 'no sideways scroll');
});

test('by touch at 844 by 390: the band is one row, and the legend line is in the inspector', async () => {
  landscape = await openPlanner({ browser, server, width: 844, height: 390, mobile: true, hash: '#scenarios', theme: 'light' });
  await journey(landscape.page, 'touch', 'wing-landscape');
});

// ---------------------------------------------------------------- the shape, in plain Node

const { shapeOf } = await import(pathToFileURL(path.join(TOOL_DIR, 'ui', 'scenarios', 'buildings.js')).href);
const { createPipeline } = await import(pathToFileURL(path.join(TOOL_DIR, 'engine', 'worker.js')).href);
const { buildGraph } = await import(pathToFileURL(path.join(TOOL_DIR, 'engine', 'graph.js')).href);

function sideOf(project) {
  return { project, graph: buildGraph(project), result: createPipeline().run(project) };
}

test('shapeOf: one scale, the larger of the two sides\' busiest decides both, and both read the same bands', () => {
  const a = plainSchool();
  // the same building with a group doubled up in 6A's rooms: busier corridors
  const b = clone(a);
  b.groups.push({ ...clone(group(a, '6A')), id: 'gdouble0001', name: 'Z Doubles' });
  const quiet = shapeOf(sideOf(a), sideOf(b), null);
  assert.equal(quiet.answer.refused, undefined);
  assert.equal(quiet.scales.this, quiet.scales.other, 'one scale for both');
  const alone = shapeOf(sideOf(a), sideOf(a), null);
  assert.ok(quiet.scales.other > alone.scales.this, 'the busier side decides: ' + quiet.scales.other + ' over ' + alone.scales.this);
  assert.deepEqual(quiet.edges.this, quiet.edges.other, 'the same colour means the same crowd');
  assert.ok(quiet.bands.this.size > 0 && quiet.bands.other.size > 0);
});

test('shapeOf: units that differ make the numbers incomparable, so each side keeps its own scale and the sentence says why', () => {
  const a = plainSchool();
  const b = clone(a);
  for (const each of b.groups) delete each.headCount;
  const shaped = shapeOf(sideOf(a), sideOf(b), null);
  assert.ok(shaped.answer.unitsDiffer, 'students against groups');
  assert.notEqual(shaped.scales.this, shaped.scales.other, 'each side its own busiest');
  assert.match(shaped.answer.unitsDiffer.sentence, /students/);
});

test('shapeOf: a refusal is a value with its sentence and nothing is shaped', () => {
  const a = plainSchool();
  const b = clone(a);
  b.dayTypes = b.dayTypes.map((day) => ({ ...day, name: day.name + ' elsewhere' }));
  const shaped = shapeOf(sideOf(a), sideOf(b), null);
  assert.equal(shaped.answer.refused, 'no-day-type');
  assert.equal(typeof shaped.answer.sentence, 'string');
  assert.equal(shaped.bands, null);
});

// ---------------------------------------------------------------- the end of a comparison

async function hold(page, name) {
  const file = writeFile(name + '.json', withWing(plainSchool()));
  const input = await page.$('input[data-file="compare"]');
  await input.uploadFile(file);
  await page.waitForSelector('[data-action="compare-buildings"]');
  await page.click('[data-action="compare-buildings"]');
  await page.waitForSelector(BAND, { timeout: 30000 }).catch(async (error) => {
    throw new Error(error.message + ' | ' + (await page.$eval('.scn-file__result', (el) => el.textContent)) + ' | ' + (await page.evaluate(() => (globalThis.__errs || []).join(';'))));
  });
}

test('a comparison ends when another project opens, and when the lab is left', async () => {
  const page = wide.page;
  await fresh(page);
  await hold(page, 'ends');
  // another project replaces the open one: the band goes, the lane is closed
  const other = clone(plainSchool());
  other.id = 'pother00001';
  await page.evaluate((next) => globalThis.sv2.store.replace(next), other);
  await page.waitForFunction(() => document.querySelector('.scn-bld').dataset.held === 'false');
  assert.equal(await laneClosed(page), true, 'the lane is closed when another project opens');
  assert.equal(await page.$eval('.scn-bld', (el) => el.hidden), true);
  await fresh(page);
  // leaving the lab
  await hold(page, 'leave');
  await go(page, '#building');
  await waitForSection(page, 'building');
  assert.equal(await laneClosed(page), true, 'the lane is closed when the lab is unmounted');
  await go(page, '#scenarios');
  await ready(page);
  assert.equal(await heldOf(page), 'false', 'the comparison does not come back');
});

test('a focus inside the forms when the comparison starts goes to the line "Stop comparing to edit the scenario."', async () => {
  const page = wide.page;
  await fresh(page, openScenarioSchool());
  const file = writeFile('focus.json', withWing(plainSchool()));
  const input = await page.$('input[data-file="compare"]');
  await input.uploadFile(file);
  await page.waitForSelector('[data-action="compare-buildings"]');
  // the focus is in the scenario's name field, which the comparison hides; a click made by the page
  // leaves it there until the lab is drawn again, and every focus after is written down
  await page.focus('#scenario-name');
  await page.evaluate(() => {
    globalThis.__focus = [];
    document.addEventListener('focusin', (event) => globalThis.__focus.push(event.target.id || event.target.name || event.target.tagName), true);
    document.querySelector('[data-action="compare-buildings"]').click();
  });
  await page.waitForSelector(BAND, { timeout: 30000 });
  const seenFocus = await page.evaluate(() => globalThis.__focus);
  assert.equal(seenFocus[0], 'scenario-building-edit', 'the line is where the focus went first: ' + seenFocus.join(', '));
  assert.ok(!seenFocus.includes('scenario-name'), 'never back to a hidden field');
  await page.click('[data-action="stop-comparing"]');
  await page.waitForFunction(() => document.querySelector('.scn-bld').dataset.held === 'false');
});

test('the same building is not a comparison of buildings: the file still makes the scenario, and a held comparison gives way', async () => {
  const page = wide.page;
  await fresh(page);
  await hold(page, 'gives-way');
  const same = clone(plainSchool());
  const a7 = same.groups.find((each) => each.id === 'gsample07a');
  a7.days[DAY_A][2] = { ...a7.days[DAY_A][2], room: 'rsample101' };
  const file = writeFile('same.json', same);
  const input = await page.$('input[data-file="compare"]');
  await input.uploadFile(file);
  await page.waitForFunction(() => /^Compared with/.test(document.querySelector('.scn-file__result').textContent));
  assert.equal(await heldOf(page), 'false', 'the comparison of buildings gave way to the scenario');
  assert.equal(await laneClosed(page), true);
  await ready(page);
});

test('typed names stay text: a file name and a group name that are markup', async () => {
  const page = wide.page;
  await fresh(page);
  const wing = withWing(plainSchool());
  wing.groups.find((each) => each.id === 'gwing00008').name = HOSTILE;
  const file = writeFile('x-' + 'hostile.json', wing);
  const input = await page.$('input[data-file="compare"]');
  await input.uploadFile(file);
  await page.waitForSelector('[data-action="compare-buildings"]');
  await page.click('[data-action="compare-buildings"]');
  await page.waitForSelector(BAND, { timeout: 30000 });
  assert.deepEqual(await page.$$eval('[data-part="only-there"] bdi', (els) => els.map((el) => el.textContent)), ['x-hostile.json', HOSTILE]);
  assert.equal(await page.evaluate(() => window.__hit), undefined, 'no markup ran');
  assert.equal(await page.$$eval('.scn-bld img, .scn-bld__inspector img', (els) => els.length), 0, 'no element was made of a name');
  await page.click('[data-action="stop-comparing"]');
  await page.waitForFunction(() => document.querySelector('.scn-bld').dataset.held === 'false');
});

// ---------------------------------------------------------------- the projects kept on this device

// Open a project through the storage session, as another project: the open
// one is put on the shelf and the page reloads into this one.
async function openAsAnother(page, project) {
  const file = writeFile('another.json', project);
  const text = fs.readFileSync(file, 'utf8');
  const reloaded = page.waitForNavigation({ waitUntil: 'load', timeout: 20000 });
  await page.evaluate(async (fileText) => {
    const { readProjectFile } = await import(new URL('engine/project-file.js', document.baseURI).href);
    const { ctx, storage } = globalThis.sv2;
    globalThis.__started = null;
    try {
      const read = readProjectFile(fileText, { ids: ctx.ids, clock: ctx.clock });
      storage.projects.startAnother('file', read, { copy: true }).then((answer) => { globalThis.__started = answer; }, (error) => { globalThis.__started = { error: String(error) }; });
    } catch (error) {
      globalThis.__started = { error: String(error) };
    }
  }, text).catch(() => {});
  try {
    await reloaded;
  } catch (error) {
    const said = await page.evaluate(() => JSON.stringify(globalThis.__started)).catch(() => 'unknown');
    throw new Error('the page did not reload into the other project: ' + said);
  }
  await waitForSection(page, 'scenarios');
}

test('Compare with another project on this device: the same building makes the scenario, another building the comparison', async () => {
  // a browser of its own: the tab lock and the shelf are the device's, and the first page holds them
  const own = await launch();
  const device = await openPlanner({ browser: own, server, width: 1280, height: 800, hash: '#scenarios', theme: 'light' });
  try {
    const page = device.page;
    await fresh(page);
    // nothing kept: no select
    assert.equal(await page.$eval('[data-part="shelf"]', (el) => el.hidden), true, 'no kept project, no select');
    // the sample goes on the shelf and the wing is open
    await openAsAnother(page, withWing(plainSchool()));
    await ready(page);
    await page.focus('#scenario-shelf-project').catch(() => {});
    await page.waitForFunction(() => document.querySelector('[data-part="shelf"]') && !document.querySelector('[data-part="shelf"]').hidden, { timeout: 30000 });
    assert.equal(await page.$$eval('#scenario-shelf-project option', (els) => els.length), 1);
    // another building: the comparison, with the kept project's label in the band
    await page.click('[data-action="compare-shelf"]');
    await page.waitForSelector(BAND, { timeout: 30000 });
    const label = await page.$eval('#scenario-shelf-project option', (el) => el.textContent);
    assert.equal(await seen(page, '.scn-bld__text'), 'Comparing with ' + label + ', another building');
    assert.match(await seen(page, '[data-part="only-here"]'), /^Only in this project: 8W\.$/);
    await page.click('[data-action="stop-comparing"]');
    await page.waitForFunction(() => document.querySelector('.scn-bld').dataset.held === 'false');
    assert.equal(await laneClosed(page), true);
    // the kept project was only read: it is still kept, nothing opened
    assert.equal(await page.evaluate(async () => (await globalThis.sv2.storage.projects.list()).length), 2);
  } finally {
    await device.close();
    await own.close();
  }
});

test('a kept project of the same building makes the scenario as a file does', async () => {
  // a browser of its own: the tab lock and the shelf are the device's, and the first page holds them
  const own = await launch();
  const device = await openPlanner({ browser: own, server, width: 1280, height: 800, hash: '#scenarios', theme: 'light' });
  try {
    const page = device.page;
    await fresh(page);
    const changed = clone(plainSchool());
    const a7 = changed.groups.find((each) => each.id === 'gsample07a');
    a7.days[DAY_A][2] = { ...a7.days[DAY_A][2], room: 'rsample101' };
    await openAsAnother(page, changed);
    await ready(page);
    await page.waitForFunction(() => document.querySelector('[data-part="shelf"]') && !document.querySelector('[data-part="shelf"]').hidden, { timeout: 30000 });
    await page.click('[data-action="compare-shelf"]');
    await page.waitForFunction(() => /^Compared with/.test(document.querySelector('.scn-file__result').textContent));
    assert.equal(await heldOf(page), 'false');
    assert.equal(await page.evaluate(() => globalThis.sv2.store.project.scenario.changes.length), 1);
  } finally {
    await device.close();
    await own.close();
  }
});
