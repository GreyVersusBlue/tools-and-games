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

// a folder of this run's own: two runs of this file at once never take each other's files away
const SCRATCH = path.join(TOOL_DIR, 'test', '.scratch', 'compare-buildings-' + process.pid);
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

// a close that does not come back is given up on after 10 s: a failed case may leave a page
// the browser cannot close, and the file must end (and say it failed) rather than hang
const quickly = (work) => Promise.race([Promise.resolve(work).catch(() => {}), new Promise((resolve) => setTimeout(resolve, 10000).unref())]);

after(async () => {
  for (const each of [wide, phone, landscape]) if (each) await quickly(each.close());
  if (browser) await quickly(browser.close());
  if (server) await quickly(server.close());
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
  fs.mkdirSync(SCRATCH, { recursive: true });
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
const heldOf = (page) => page.$eval('.scn-bld', (el) => el.dataset.held);
const focused = (page) => page.evaluate(() => {
  const el = document.activeElement;
  return el ? { id: el.id, name: el.getAttribute('name') || '', value: el.value || '', action: el.dataset ? el.dataset.action || '' : '', text: el.textContent.slice(0, 40) } : null;
});
// closed: asking for the other building answers null at once. A lane still held answers with the
// building, or (once the page that held it has gone) not at all: the wait is capped so that is a failure.
const laneClosed = (page) => page.evaluate(() => Promise.race([
  globalThis.sv2.store.derived.other().then((answer) => answer === null),
  new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
]));

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
  assert.deepEqual(await page.$eval('#scenario-building-edit', (el) => [el.getAttribute('role'), el.hasAttribute('tabindex')]), ['note', false], 'the line is a note and nothing focuses it');
  // the band has a name for its landmark
  assert.deepEqual(await page.$eval('.scn-bld', (el) => [el.tagName, document.getElementById(el.getAttribute('aria-labelledby')).textContent]), ['SECTION', 'Comparing two buildings']);
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
  assert.match(await page.$$eval('[data-part="building-places"] [data-part="new"] li', (els) => els.map((el) => el.textContent).join('|')), /Wing Corridor/);
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
  assert.match(await seen(page, '[data-part="building-status"]'), new RegExp('^Showing ' + name + '\\.json’s building\\. Busiest: .+, \\d+ students\\.$'));
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
  assert.match(await seen(page, '[data-part="building-status"]'), /^Showing this project’s building\. Busiest: /);

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
  assert.equal(await seen(page, '.scn-file__result'), 'Stopped comparing with ' + name + '.json.');
  assert.equal(await page.$eval('.scn-file__result p', (el) => el.getAttribute('role')), 'status', 'Stop comparing is said by one status');
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

test('a focus inside the forms when the comparison starts goes to the switch\'s checked radio, never through the edit line', async () => {
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
  assert.equal(seenFocus[0], 'scenario-building-side', 'the checked radio is where the focus went first: ' + seenFocus.join(', '));
  assert.ok(!seenFocus.includes('scenario-building-edit'), 'never through the edit line: ' + seenFocus.join(', '));
  assert.ok(!seenFocus.includes('scenario-name'), 'never back to a hidden field');
  assert.ok(seenFocus.every((each) => each === 'scenario-building-side'), 'only the radio: ' + seenFocus.join(', '));
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
  assert.equal((await focused(page)).id, 'scenario-file-title', 'a file made into a scenario: the focus is on the file panel\'s heading');
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


// ---------------------------------------------------------------- the review of SV2-123 (SV2-123b)

const rename = (page, from, to) => page.evaluate(async ([was, now]) => {
  const { renameDayType } = await import('./engine/actions.js');
  const { store } = globalThis.sv2;
  store.apply(renameDayType, { dayTypeId: store.project.dayTypes.find((each) => each.name === was).id, name: now });
}, [from, to]);

// a slot moved to another room: the walking figures change
const moveSlot = (page) => page.evaluate(async () => {
  const { setSlot } = await import('./engine/actions.js');
  globalThis.sv2.store.apply(setSlot, { groupId: 'gsample07a', dayTypeId: 'dsample00a', period: 2, slot: { room: 'rsample101' } });
});

const liveCounters = (page) => page.evaluate(() => { const store = globalThis.sv2.store; return store.geometryVersion + ':' + store.buildingVersion + ':' + store.scheduleVersion; });

// The worked-out answers held back: store.derived.results() starts its work at once and answers
// when the door is opened, so an answer can be older than the project by the time it arrives.
async function gate(page) {
  await page.evaluate(() => {
    const derived = globalThis.sv2.store.derived;
    const real = derived.results;
    let open;
    const door = new Promise((resolve) => { open = resolve; });
    globalThis.__gate = { calls: 0, real, open, door };
    derived.results = (...args) => {
      globalThis.__gate.calls += 1;
      const answer = real.apply(derived, args);
      return door.then(() => answer);
    };
  });
}
const openGate = (page) => page.evaluate(() => {
  globalThis.__gate.open();
  globalThis.sv2.store.derived.results = globalThis.__gate.real;
});

async function uploadWing(page, name, project) {
  const file = writeFile(name + '.json', project || withWing(plainSchool()));
  const input = await page.$('input[data-file="compare"]');
  await input.uploadFile(file);
  await page.waitForSelector('[data-action="compare-buildings"]', { timeout: 15000 }).catch(async (error) => {
    throw new Error(error.message + ' | ' + (await page.$eval('.scn-file__result', (el) => el.textContent)));
  });
}

// every text a live region comes to say (a status, an alert, aria-live, #announcer) after this call
async function listen(page) {
  await page.evaluate(() => {
    const sel = '[role="status"],[role="alert"],[aria-live="polite"],[aria-live="assertive"],#announcer';
    globalThis.__said = [];
    const last = new Map();
    const scan = (quiet) => {
      for (const el of document.querySelectorAll(sel)) {
        if (el.closest('[hidden]')) continue;
        const text = el.textContent.replace(/\s+/g, ' ').trim();
        if (text !== (last.get(el) || '')) {
          last.set(el, text);
          if (text && !quiet) globalThis.__said.push(text);
        }
      }
    };
    scan(true);
    if (globalThis.__mo) globalThis.__mo.disconnect();
    globalThis.__mo = new MutationObserver(() => scan(false));
    globalThis.__mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'role'] });
  });
}
const said = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
  const out = globalThis.__said.slice();
  globalThis.__said.length = 0;
  resolve(out);
}))));

test('an edit to the open project during the first start leaves no stale comparison, and another project opened meanwhile holds none', async () => {
  const page = wide.page;
  await fresh(page);
  await uploadWing(page, 'stale-start');
  await gate(page);
  await page.evaluate(() => document.querySelector('[data-action="compare-buildings"]').click());
  await page.waitForFunction(() => globalThis.__gate.calls >= 1);
  await moveSlot(page);
  await openGate(page);
  await page.waitForSelector(BAND, { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('.scn-bld').dataset.counters === globalThis.sv2.store.geometryVersion + ':' + globalThis.sv2.store.buildingVersion + ':' + globalThis.sv2.store.scheduleVersion);
  const held = await seen(page, '[data-part="building-figures"]');
  // a comparison started cold on the edited project reads the same figures
  await page.click('[data-action="stop-comparing"]');
  await page.waitForFunction(() => document.querySelector('.scn-bld').dataset.held === 'false');
  await uploadWing(page, 'stale-start');
  await page.click('[data-action="compare-buildings"]');
  await page.waitForSelector(BAND, { timeout: 30000 });
  assert.equal(held, await seen(page, '[data-part="building-figures"]'), 'the first comparison is of the project as edited');
  await page.click('[data-action="stop-comparing"]');
  await page.waitForFunction(() => document.querySelector('.scn-bld').dataset.held === 'false');
  // another project replaces the open one while the first answer is out
  await uploadWing(page, 'stale-id');
  await gate(page);
  await page.evaluate(() => document.querySelector('[data-action="compare-buildings"]').click());
  await page.waitForFunction(() => globalThis.__gate.calls >= 1);
  const other = clone(plainSchool());
  other.id = 'pother00002';
  await page.evaluate((next) => globalThis.sv2.store.replace(next), other);
  await openGate(page);
  await page.waitForFunction(() => /Another project was opened/.test(document.querySelector('.scn-file__result')?.textContent || ''), { timeout: 30000 });
  assert.equal(await heldOf(page), 'false', 'nothing is held for another project');
  assert.equal(await laneClosed(page), true, 'and the lane is let go');
});

test('a second comparison leaves the first as it was until its own answer is ready, and a refused one leaves it untouched', async () => {
  const page = wide.page;
  await fresh(page);
  await hold(page, 'first-held');
  const before = await page.evaluate(() => ({
    text: document.querySelector('.scn-bld__text').textContent,
    painted: document.querySelector('.scn-bld').dataset.painted,
    scale: document.querySelector('.scn-bld').dataset.scale,
    overlays: document.querySelector('.scn').scenarios.plan.overlays.length,
  }));
  // a file of another building with no day type in common: the engine refuses it
  const refusedProject = withWing(plainSchool());
  refusedProject.dayTypes = refusedProject.dayTypes.map((day) => ({ ...day, name: day.name + ' elsewhere' }));
  await uploadWing(page, 'second-refused', refusedProject);
  await page.focus('[data-action="compare-buildings"]');
  await page.click('[data-action="compare-buildings"]');
  await page.waitForFunction(() => /could not be compared|no day type|No day type|day type/i.test(document.querySelector('.scn-file__result')?.textContent || '') && !document.querySelector('[data-part="working"]'), { timeout: 30000 });
  assert.equal(await page.$eval('.scn-file__result [role="alert"]', (el) => el.tagName), 'P', 'the refusal is an alert');
  const after = await page.evaluate(() => ({
    held: document.querySelector('.scn-bld').dataset.held,
    working: document.querySelector('.scn-bld').dataset.working,
    text: document.querySelector('.scn-bld__text').textContent,
    painted: document.querySelector('.scn-bld').dataset.painted,
    scale: document.querySelector('.scn-bld').dataset.scale,
    overlays: document.querySelector('.scn').scenarios.plan.overlays.length,
    hidden: document.querySelector('.scn-bld').hidden,
    focus: document.activeElement === document.body ? 'body' : document.activeElement.id || document.activeElement.className,
  }));
  assert.equal(after.held, 'true');
  assert.equal(after.working, 'false');
  assert.equal(after.hidden, false);
  assert.deepEqual([after.text, after.painted, after.scale, after.overlays], [before.text, before.painted, before.scale, before.overlays], 'the band, the painted cells and the overlays are as they were');
  assert.notEqual(after.focus, 'body', 'the focus is not lost');
  assert.equal(await laneClosed(page), false, 'the lane still holds the first file');
  // a good second file takes the first one\'s place without the band going away
  await uploadWing(page, 'second-good');
  await page.evaluate(() => {
    globalThis.__bandHidden = [];
    new MutationObserver(() => globalThis.__bandHidden.push(document.querySelector('.scn-bld').hidden)).observe(document.querySelector('.scn-bld'), { attributes: true, attributeFilter: ['hidden'] });
  });
  await page.click('[data-action="compare-buildings"]');
  await page.waitForFunction(() => document.querySelector('.scn-bld__text').textContent === 'Comparing with second-good.json, another building' && document.querySelector('.scn-bld').dataset.working === 'false', { timeout: 30000 });
  assert.deepEqual(await page.evaluate(() => globalThis.__bandHidden), [], 'the band never went away between the two');
  assert.equal(await heldOf(page), 'true');
  await page.click('[data-action="stop-comparing"]');
  await page.waitForFunction(() => document.querySelector('.scn-bld').dataset.held === 'false');
});

test('a file made into a scenario stops a held comparison only after "Replace the scenario?" is confirmed', async () => {
  const page = wide.page;
  await fresh(page, openScenarioSchool());
  await uploadWing(page, 'before-replace');
  await page.click('[data-action="compare-buildings"]');
  await page.waitForSelector(BAND, { timeout: 30000 });
  const same = clone(plainSchool());
  const a7 = same.groups.find((each) => each.id === 'gsample07a');
  a7.days[DAY_A][2] = { ...a7.days[DAY_A][2], room: 'rsample101' };
  const input = await page.$('input[data-file="compare"]');
  await input.uploadFile(writeFile('same-replace.json', same));
  await page.waitForSelector('dialog[open]');
  assert.equal(await heldOf(page), 'true', 'the comparison is held while the question is asked');
  await page.evaluate(() => [...document.querySelectorAll('dialog[open] .dialog__buttons button')].find((b) => b.textContent === 'Keep the scenario').click());
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));
  assert.equal(await heldOf(page), 'true', 'Keep the scenario leaves the comparison held');
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.scenario.changes.length), 1, 'and the scenario as it was');
  assert.equal(await laneClosed(page), false);
  await input.uploadFile(writeFile('same-replace-2.json', same));
  await page.waitForSelector('dialog[open]');
  await page.evaluate(() => [...document.querySelectorAll('dialog[open] .dialog__buttons button')].find((b) => b.textContent === 'Replace the scenario').click());
  await page.waitForFunction(() => document.querySelector('.scn-bld').dataset.held === 'false');
  await page.waitForFunction(() => /^Compared with/.test(document.querySelector('.scn-file__result').textContent));
  assert.equal((await focused(page)).id, 'scenario-file-title', 'the focus is on the file panel\'s heading');
  assert.equal(await laneClosed(page), true);
  await ready(page);
});

test('places: each row is in its own side\'s unit, and units that differ say so on both sides', async () => {
  const page = wide.page;
  await fresh(page);
  const wing = withWing(plainSchool());
  for (const each of wing.groups) each.headCount = null;
  await uploadWing(page, 'groups-unit', wing);
  await page.click('[data-action="compare-buildings"]');
  await page.waitForSelector(BAND, { timeout: 30000 });
  assert.equal(await page.$eval('[data-part="units-differ"]', (el) => el.getAttribute('role')), 'note');
  const changed = await page.$$eval('[data-part="changed"] li', (els) => els.map((el) => el.textContent.replace(/\s+/g, ' ')));
  assert.ok(changed.length > 0, 'matched places are listed unranked');
  for (const row of changed) assert.match(row, /: \d+ students? before → \d+ groups? after$/, row);
  for (const each of ['new', 'gone']) {
    const rows = await page.$$eval('[data-part="building-places"] [data-part="' + each + '"] li', (els) => els.map((el) => el.textContent.replace(/\s+/g, ' ')));
    for (const row of rows) assert.match(row, each === 'new' ? /: \d+ groups?$/ : /: \d+ students?$/, each + ': ' + row);
  }
  assert.ok((await page.$$eval('[data-part="building-places"] [data-part="new"] li', (els) => els.length)) > 0, 'the wing\'s corridor is new');
  // the figures are two columns of numbers, as the real grid class says
  assert.equal(await page.$eval('[data-part="building-figures"]', (el) => [el.classList.contains('scn-figures'), getComputedStyle(el).gridTemplateColumns.split(' ').length]).then((a) => a.join(',')), 'true,2');
  // and one unit on both sides is one word in every row
  await page.click('[data-action="stop-comparing"]');
  await page.waitForFunction(() => document.querySelector('.scn-bld').dataset.held === 'false');
  await uploadWing(page, 'same-unit');
  await page.click('[data-action="compare-buildings"]');
  await page.waitForSelector(BAND, { timeout: 30000 });
  for (const row of await page.$$eval('[data-part="building-places"] li', (els) => els.map((el) => el.textContent))) assert.match(row, /students?( \([+−-]\d+\))?$/, row);
  await page.click('[data-action="stop-comparing"]');
  await page.waitForFunction(() => document.querySelector('.scn-bld').dataset.held === 'false');
});

test('groups with no name are counted from the engine, and a group really named "(no name)" is still listed', async () => {
  const page = wide.page;
  // this project: 7A has no name and 7B is really named "(no name)"; the file (valid names only) has the wing
  const open = clone(plainSchool());
  open.groups.find((each) => each.id === 'gsample07a').name = '';
  open.groups.find((each) => each.id === 'gsample07b').name = '(no name)';
  await fresh(page, open);
  await uploadWing(page, 'nameless', withWing(plainSchool()));
  await page.click('[data-action="compare-buildings"]');
  await page.waitForSelector(BAND, { timeout: 30000 });
  assert.equal(await seen(page, '[data-part="only-here"]'), 'Only in this project: (no name); 1 group with no name, which cannot be matched.');
  assert.deepEqual(await page.$$eval('[data-part="only-here"] bdi', (els) => els.map((el) => el.textContent)), ['(no name)'], 'the one name typed, not the marker');
  assert.match(await seen(page, '[data-part="only-there"]'), /^Only in nameless\.json: .*7A.*\.$/);
  assert.ok(!/no name/.test(await seen(page, '[data-part="only-there"]')), 'nothing nameless in the file');
  await page.click('[data-action="stop-comparing"]');
  await page.waitForFunction(() => document.querySelector('.scn-bld').dataset.held === 'false');
});

test('a day type renamed or removed while held: the first matched one instead, said; none: a refusal that clears everything, and back again', async () => {
  const page = wide.page;
  await fresh(page);
  await hold(page, 'day-types');
  await page.select('#scenario-building-day', 'B Day');
  await page.waitForFunction(() => document.querySelector('.scn-bld').dataset.day === 'B Day');
  // B Day is renamed: it is in both buildings no more
  await gate(page);
  await rename(page, 'B Day', 'C Day');
  // while the answer is out the old tables are marked and the status says so
  await page.waitForFunction(() => document.querySelector('[data-part="building-body"]').dataset.stale === 'true');
  assert.equal(await seen(page, '[data-part="building-status"]'), 'Working it out again…');
  assert.equal(await page.$eval('.scn-bld', (el) => el.dataset.working), 'true');
  assert.equal(await page.$eval('[data-part="building-body"]', (el) => Number(getComputedStyle(el).opacity) < 1), true, 'the stale tables are dimmed');
  assert.equal(await page.$eval('.scn-bld', (el) => el.dataset.painted), undefined, 'nothing is painted from the old answer');
  await openGate(page);
  await page.waitForFunction(() => document.querySelector('.scn-bld').dataset.working === 'false' && document.querySelector('.scn-bld').dataset.day === 'A Day');
  assert.match(await seen(page, '[data-part="building-status"]'), /^The day type “B Day” is no longer in both buildings, so this is compared on “A Day” now\. /);
  assert.deepEqual(await page.$$eval('#scenario-building-day option', (els) => els.map((el) => el.textContent)), ['A Day']);
  assert.equal(await page.$eval('[data-part="building-body"]', (el) => el.dataset.stale), undefined);
  assert.ok(Number(await page.$eval('.scn-bld', (el) => el.dataset.painted)) > 0, 'painted again');
  // the other day type goes too: nothing matches, and nothing of the old answer stays
  await rename(page, 'A Day', 'D Day');
  await page.waitForFunction(() => document.querySelector('[data-part="refusal"]'), { timeout: 30000 });
  assert.equal(await page.$eval('[data-part="building-alert"]', (el) => el.textContent.length > 0), true, 'the refusal is said as an alert');
  assert.deepEqual(await page.evaluate(() => ({
    legend: document.querySelector('.scn-bld__key').children.length,
    options: document.querySelectorAll('#scenario-building-day option').length,
    painted: document.querySelector('.scn-bld').dataset.painted,
    scale: document.querySelector('.scn-bld').dataset.scale,
    held: document.querySelector('.scn-bld').dataset.held,
    stale: document.querySelector('[data-part="building-body"]').dataset.stale,
    tables: document.querySelectorAll('[data-part="building-body"] table').length,
    overlay: document.querySelector('.scn').scenarios.plan.overlays.length,
  })), { legend: 0, options: 0, held: 'true', tables: 0, overlay: 1 }, 'nothing of the old answer stays (painted, scale and stale are not set)');
  // put the names back: the comparison is whole again
  await rename(page, 'D Day', 'A Day');
  await rename(page, 'C Day', 'B Day');
  await page.waitForFunction(() => !document.querySelector('[data-part="refusal"]') && document.querySelector('.scn-bld').dataset.working === 'false' && document.querySelectorAll('#scenario-building-day option').length === 2, { timeout: 30000 });
  assert.equal(await page.$$eval('.scn-bld__bands li', (els) => els.length), 5, 'the legend is back');
  assert.ok(Number(await page.$eval('.scn-bld', (el) => el.dataset.painted)) > 0);
  await page.click('[data-action="stop-comparing"]');
  await page.waitForFunction(() => document.querySelector('.scn-bld').dataset.held === 'false');
});

test('the day select that cannot be compared says so, keeps the day it was on, and a refusal is an alert', async () => {
  const page = wide.page;
  await fresh(page);
  await hold(page, 'day-select');
  await page.evaluate(() => {
    const select = document.querySelector('#scenario-building-day');
    select.append(Object.assign(document.createElement('option'), { value: 'Ghost Day', textContent: 'Ghost Day' }));
    select.value = 'Ghost Day';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelector('[data-part="building-alert"]').textContent.length > 0);
  assert.match(await seen(page, '[data-part="building-alert"]'), /Nothing has changed\.$/);
  assert.equal(await seen(page, '[data-part="building-status"]'), '');
  assert.equal(await page.$eval('.scn-bld', (el) => el.dataset.day), 'A Day');
  assert.equal(await page.$eval('#scenario-building-day', (el) => el.value), 'A Day');
  await page.click('[data-action="stop-comparing"]');
  await page.waitForFunction(() => document.querySelector('.scn-bld').dataset.held === 'false');
});

test('a change of the colour scale moves no counter, and the legend and the bands follow it', async () => {
  const page = wide.page;
  await fresh(page);
  await hold(page, 'colours');
  const before = await page.evaluate(() => ({ legend: document.querySelector('.scn-bld__bands').textContent, painted: document.querySelector('.scn-bld').dataset.painted, scale: document.querySelector('.scn-bld').dataset.scale, counters: document.querySelector('.scn-bld').dataset.counters }));
  const counters = await liveCounters(page);
  await page.evaluate(async () => {
    const { setSetting } = await import('./engine/actions.js');
    globalThis.sv2.store.apply(setSetting, { key: 'colourScale.mode', value: 'absolute' });
  });
  assert.equal(await liveCounters(page), counters, 'a colour scale moves no counter');
  await page.waitForFunction((was) => document.querySelector('.scn-bld__bands').textContent !== was, {}, before.legend);
  const after = await page.evaluate(() => ({ painted: document.querySelector('.scn-bld').dataset.painted, working: document.querySelector('.scn-bld').dataset.working, counters: document.querySelector('.scn-bld').dataset.counters }));
  assert.equal(after.working, 'false', 'no recompute was asked');
  assert.equal(after.counters, before.counters);
  assert.ok(Number(after.painted) > 0, 'still painted');
  await page.click('[data-action="stop-comparing"]');
  await page.waitForFunction(() => document.querySelector('.scn-bld').dataset.held === 'false');
});

test('every event is said once: the start, a switch of side, a day type, Stop comparing', async () => {
  const page = wide.page;
  await fresh(page);
  await uploadWing(page, 'voice');
  await listen(page);
  await page.click('[data-action="compare-buildings"]');
  await page.waitForSelector(BAND, { timeout: 30000 });
  const started = await said(page);
  assert.equal(started.length, 1, 'the start: ' + JSON.stringify(started));
  assert.match(started[0], /^Comparing with voice\.json, another building\. Stop comparing to edit the scenario\. Busiest: .+, \d+ students?\.$/);
  await page.click('.scn-bld .seg__option:last-child .seg__label');
  await page.waitForSelector('.scn-bld[data-side="other"]');
  assert.equal((await said(page)).length, 1, 'a switch of side');
  await page.select('#scenario-building-day', 'B Day');
  await page.waitForFunction(() => document.querySelector('.scn-bld').dataset.day === 'B Day');
  assert.equal((await said(page)).length, 1, 'a day type');
  await page.click('[data-action="stop-comparing"]');
  await page.waitForFunction(() => document.querySelector('.scn-bld').dataset.held === 'false');
  assert.deepEqual(await said(page), ['Stopped comparing with voice.json.'], 'Stop comparing');
});

test('Stop comparing, a file made into a scenario, another project and leaving the lab: each ends with the focus on the file panel\'s heading', async () => {
  const page = wide.page;
  // another project, the focus in the band
  await fresh(page);
  await hold(page, 'end-project');
  assert.equal((await focused(page)).name, 'scenario-building-side');
  const other = clone(plainSchool());
  other.id = 'pother00003';
  await page.evaluate((next) => globalThis.sv2.store.replace(next), other);
  await page.waitForFunction(() => document.querySelector('.scn-bld').dataset.held === 'false');
  assert.equal((await focused(page)).id, 'scenario-file-title', 'another project');
  await ready(page);
  // leaving the lab with the focus in the band; the band is let go too
  await fresh(page);
  await hold(page, 'end-leave');
  await page.evaluate(() => {
    globalThis.__band = document.querySelector('.scn-bld');
    globalThis.__focus = [];
    document.addEventListener('focusin', (event) => globalThis.__focus.push(event.target.id || event.target.name || event.target.tagName), true);
  });
  assert.equal((await focused(page)).name, 'scenario-building-side');
  await go(page, '#building');
  await waitForSection(page, 'building');
  assert.ok((await page.evaluate(() => globalThis.__focus)).includes('scenario-file-title'), 'unmount: the heading took the focus first');
  assert.deepEqual(await page.evaluate(() => ({ held: globalThis.__band.dataset.held, hidden: globalThis.__band.hidden, painted: globalThis.__band.dataset.painted, side: globalThis.__band.dataset.side, counters: globalThis.__band.dataset.counters })), { held: 'false', hidden: true }, 'unmount ends the state (no side, no painted cells, no counters)');
  assert.equal(await laneClosed(page), true);
  await go(page, '#scenarios');
  await ready(page);
});

test('the sides keep their own zoom and place across switches, and the closed corridors\' count is reset while their overlay is set aside', async () => {
  const page = wide.page;
  const project = openScenarioSchool();
  project.scenario.levers = [{ kind: 'way', connectionId: 'csample00a', way: 'closed' }];
  await fresh(page, project);
  await page.waitForFunction(() => Number(document.querySelector('.scn').dataset.closedDrawn) > 0);
  await uploadWing(page, 'views');
  await page.click('[data-action="compare-buildings"]');
  await page.waitForSelector(BAND, { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('.scn').dataset.closedDrawn === '0');
  const zoom = () => page.evaluate(() => { const plan = document.querySelector('.scn').scenarios.plan; return [Math.round(plan.view.zoom * 1000), plan.fitted]; });
  const click = (action) => page.evaluate((a) => document.querySelector('.scn .mov-zoom__btn[data-action="' + a + '"]').click(), action);
  await click('zoom-in');
  await click('zoom-in');
  const here = await zoom();
  assert.equal(here[1], false);
  await page.click('.scn-bld .seg__option:last-child .seg__label');
  await page.waitForSelector('.scn-bld[data-side="other"]');
  const fitted = await zoom();
  assert.equal(fitted[1], true, 'the file\'s building has not been moved: it is fitted');
  await click('zoom-out');
  await click('zoom-out');
  await click('zoom-out');
  const there = await zoom();
  assert.notEqual(there[0], here[0]);
  await page.click('.scn-bld .seg__option:first-child .seg__label');
  await page.waitForSelector('.scn-bld[data-side="this"]');
  assert.deepEqual(await zoom(), here, 'this project keeps its zoom');
  await page.click('.scn-bld .seg__option:last-child .seg__label');
  await page.waitForSelector('.scn-bld[data-side="other"]');
  assert.deepEqual(await zoom(), there, 'the file\'s building keeps its own');
  await page.click('[data-action="stop-comparing"]');
  await page.waitForFunction(() => document.querySelector('.scn-bld').dataset.held === 'false');
  await page.waitForFunction(() => Number(document.querySelector('.scn').dataset.closedDrawn) > 0);
});

test('a double press on Compare the two buildings starts one comparison', async () => {
  const page = wide.page;
  await fresh(page);
  await uploadWing(page, 'double');
  await page.evaluate(() => {
    const derived = globalThis.sv2.store.derived;
    const real = derived.setOther;
    globalThis.__starts = 0;
    globalThis.__realSetOther = real;
    derived.setOther = (...args) => { globalThis.__starts += 1; return real.apply(derived, args); };
  });
  const state = await page.evaluate(() => {
    const button = document.querySelector('[data-action="compare-buildings"]');
    button.click();
    const busy = [button.getAttribute('aria-busy'), button.getAttribute('aria-disabled')];
    button.click();
    button.click();
    return busy;
  });
  assert.deepEqual(state, ['true', 'true'], 'the button says it is busy at once');
  await page.waitForSelector(BAND, { timeout: 30000 });
  assert.equal(await page.evaluate(() => { globalThis.sv2.store.derived.setOther = globalThis.__realSetOther; return globalThis.__starts; }), 1, 'one start');
  await page.click('[data-action="stop-comparing"]');
  await page.waitForFunction(() => document.querySelector('.scn-bld').dataset.held === 'false');
});

// long names, right to left, on the phones: Stop stays in view and nothing scrolls sideways
const RTL = 'ملف-مدرسة-'.repeat(8) + '.json';
async function longName(page) {
  await fresh(page, openScenarioSchool());
  const stage0 = await page.evaluate(() => document.querySelector('.scn .mov-stage').getBoundingClientRect().height);
  const file = writeFile(RTL, withWing(plainSchool()));
  const input = await page.$('input[data-file="compare"]');
  await input.uploadFile(file);
  await page.waitForSelector('[data-action="compare-buildings"]');
  await page.evaluate(() => document.querySelector('[data-action="compare-buildings"]').click());
  await page.waitForSelector(BAND, { timeout: 30000 });
  await page.evaluate(() => document.querySelector('.scn-bld__stop').scrollIntoView({ block: 'nearest' }));
  const box = await page.evaluate(() => {
    const stop = document.querySelector('.scn-bld__stop').getBoundingClientRect();
    const head = document.querySelector('.scn-bld__head').getBoundingClientRect();
    const stage = document.querySelector('.scn .mov-stage').getBoundingClientRect();
    return { top: stop.top, bottom: stop.bottom, left: stop.left, right: stop.right, width: innerWidth, height: innerHeight, headHeight: head.height, stage: stage.height, scrolls: document.documentElement.scrollWidth > document.documentElement.clientWidth };
  });
  assert.ok(box.left >= 0 && box.right <= box.width, 'Stop is inside the window across: ' + JSON.stringify(box));
  assert.ok(box.top >= 0 && box.bottom <= box.height, 'Stop is inside the window down: ' + JSON.stringify(box));
  assert.equal(box.scrolls, false, 'no sideways scroll');
  assert.ok(Math.abs(box.stage - stage0) <= 2, 'the band takes nothing from the stage: ' + stage0 + ' before, ' + box.stage + ' after');
  return box;
}

test('a long right-to-left file name: Stop stays in view at 390 by 844, at 844 by 390 and at 844 by 300', async () => {
  for (const [width, height] of [[390, 844], [844, 390], [844, 300]]) {
    const own = await openPlanner({ browser, server, width, height, mobile: true, hash: '#scenarios', theme: 'light' });
    try {
      await longName(own.page);
    } finally {
      await quickly(own.close());
    }
  }
});

test('the shelf: rows follow the device without a focus, one press at a time, a refused read and a row that has vanished are said', async () => {
  const own = await launch();
  const device = await openPlanner({ browser: own, server, width: 1280, height: 800, hash: '#scenarios', theme: 'light' });
  try {
    const page = device.page;
    await fresh(page);
    await openAsAnother(page, withWing(plainSchool()));
    await ready(page);
    await page.waitForFunction(() => document.querySelector('[data-part="shelf"]') && !document.querySelector('[data-part="shelf"]').hidden, { timeout: 30000 });
    const id = await page.$eval('#scenario-shelf-project', (el) => el.value);
    // a row renamed elsewhere shows at once, with no focus on the shelf
    await page.evaluate((rowId) => globalThis.sv2.storage.projects.rename(rowId, 'Next year, renamed'), id);
    await page.waitForFunction(() => document.querySelector('#scenario-shelf-project option')?.textContent === 'Next year, renamed', { timeout: 15000 });
    // a read that comes back refused: said as an alert, nothing held, and the controls are free again
    await page.evaluate(() => {
      const projects = globalThis.sv2.storage.projects;
      globalThis.__realRead = projects.read;
      projects.read = async () => ({ ok: false, code: 'no-such-project', text: 'There is no such project on this device.' });
    });
    await page.click('[data-action="compare-shelf"]');
    await page.waitForFunction(() => /no such project/.test(document.querySelector('.scn-file__result')?.textContent || ''));
    assert.equal(await seen(page, '.scn-file__result'), '“Next year, renamed” was not compared, and nothing has changed. There is no such project on this device.');
    assert.equal(await page.$eval('.scn-file__result [role="alert"]', (el) => el.tagName), 'P');
    assert.equal(await heldOf(page), 'false');
    assert.deepEqual(await page.evaluate(() => [document.querySelector('#scenario-shelf-project').inert, document.querySelector('[data-action="compare-shelf"]').getAttribute('aria-busy'), document.querySelector('[data-action="compare-shelf"]').getAttribute('aria-disabled')]), [false, null, null]);
    // a read that is slow: two more presses do nothing, and the select and the button are inert meanwhile
    await page.evaluate(() => {
      globalThis.__reads = 0;
      globalThis.sv2.storage.projects.read = (rowId) => {
        globalThis.__reads += 1;
        return new Promise((resolve) => { globalThis.__release = () => resolve(globalThis.__realRead.call(globalThis.sv2.storage.projects, rowId)); });
      };
    });
    await page.evaluate(() => {
      const button = document.querySelector('[data-action="compare-shelf"]');
      button.click();
      button.click();
    });
    assert.deepEqual(await page.evaluate(() => [document.querySelector('#scenario-shelf-project').inert, document.querySelector('[data-action="compare-shelf"]').getAttribute('aria-disabled'), document.querySelector('[data-action="compare-shelf"]').getAttribute('aria-busy')]), [true, 'true', 'true']);
    await page.evaluate(() => document.querySelector('[data-action="compare-shelf"]').click());
    await page.evaluate(() => globalThis.__release());
    await page.waitForSelector(BAND, { timeout: 30000 });
    assert.equal(await page.evaluate(() => globalThis.__reads), 1, 'one read for three presses');
    assert.equal(await seen(page, '.scn-bld__text'), 'Comparing with Next year, renamed, another building');
    assert.deepEqual(await page.evaluate(() => [document.querySelector('#scenario-shelf-project').inert, document.querySelector('[data-action="compare-shelf"]').getAttribute('aria-disabled'), document.querySelector('[data-action="compare-shelf"]').getAttribute('aria-busy')]), [false, null, null], 'the controls are free once it is held');
    await page.click('[data-action="stop-comparing"]');
    await page.waitForFunction(() => document.querySelector('.scn-bld').dataset.held === 'false');
    // the row goes (deleted from elsewhere): the shelf follows, and a press on a row that was there says so
    await page.evaluate(() => {
      globalThis.sv2.storage.projects.read = async () => ({ ok: false, code: 'no-such-project', text: 'There is no such project on this device.' });
    });
    await page.click('[data-action="compare-shelf"]');
    await page.waitForFunction(() => /no such project/.test(document.querySelector('.scn-file__result')?.textContent || ''));
    await page.evaluate(() => { globalThis.sv2.storage.projects.read = globalThis.__realRead; });
    await page.evaluate((rowId) => globalThis.sv2.storage.projects.remove(rowId, { exported: true }), id);
    await page.waitForFunction(() => document.querySelector('[data-part="shelf"]').hidden === true, { timeout: 15000 });
    assert.equal(await page.$$eval('#scenario-shelf-project option', (els) => els.length), 0, 'the select follows the shelf');
  } finally {
    await quickly(device.close());
    await quickly(own.close());
  }
});
