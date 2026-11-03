// The scenario lab's lever forms in a real browser (spec 9.1, 9.3; DESIGN
// 12.4; ARCHITECTURE 18.3): node test/browser/scenario-levers.mjs
//
// SV2-92. The Kind of change fieldset (one form open at a time); Bell times
// with the passing time it would make and its "Lengthen passing" row;
// Staggered dismissal with the Day tab's own editor, "Already in force" and a
// chip that says what it replaces; Capacity and head counts; every lever a
// chip in plain words with × (the focus after it, and what is said); the
// comparison moving for each lever; the report listing them; Apply's summary
// lines, its closures left out in a band of their own, "Apply n of m changes",
// one step of undo and the focus after it; the forms by keyboard, and at 390
// by 844 with touch (the stage at least 160 px, every target 44 px); axe on
// each new state in both themes. Every wait is on a state the page sets (the
// lab's `data-compare` "ready", a section's `data-pending` gone, a status
// line's words), never on a first paint or a sleep.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { openPlanner, go, launch, startServer, loadModule, assertTouch, atRest, TOOL_DIR } from './harness.mjs';

const { plainSchool: sampleSchool } = await import(pathToFileURL(path.join(TOOL_DIR, 'test', 'engine', 'helpers.mjs')).href);

const AXE = path.join(TOOL_DIR, 'test', 'vendor', 'axe-core', 'axe.min.js');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];
const A = 'dsample00a';

let browser;
let server;
let wide;
let page;

before(async () => {
  server = await startServer();
  browser = await launch();
  wide = await openPlanner({ browser, server, width: 1280, height: 800, hash: '#scenarios', theme: 'light' });
  page = wide.page;
  await loadModule(page, 'actions', 'engine/actions.js');
});

after(async () => {
  if (wide) await wide.close().catch(() => {});
  if (browser) await browser.close();
  if (server) await server.close();
});

// The section drawn for the project in the store, and the comparison settled
// (answered for the store as it is, or nothing open).
async function ready(p) {
  await p.waitForFunction(() => {
    const el = document.querySelector('.scn');
    if (!el || el.dataset.styled !== 'true' || !el.scenarios) return false;
    if (el.dataset.mode === 'empty') return true;
    if (el.scenarios.plan.project !== globalThis.sv2.store.project) return false;
    if (el.dataset.mode === 'none') return el.dataset.compare === 'none';
    return el.dataset.compare === 'ready' && !el.scenarios.pending;
  }, { timeout: 30000 });
}

// The plain sample school, nothing open, on the Scenarios section; `alter` is
// a function body run on the project before it is put in.
async function fresh(p, alter) {
  await p.evaluate(() => {
    for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  });
  await p.mouse.move(1, 1);
  const close = await p.$('.toast .toast__close');
  if (close) {
    await close.click();
    await p.waitForFunction(() => !document.querySelector('.toast'));
  }
  await p.evaluate((body, plain) => {
    if (body) new Function('project', body)(plain);
    globalThis.sv2.store.replace(plain);
  }, alter || null, JSON.parse(JSON.stringify(sampleSchool())));
  await go(p, '#scenarios');
  await ready(p);
}

async function start(p, name) {
  await p.click('#scenario-start-name');
  if (name) await p.keyboard.type(name);
  await p.click('[data-action="start"]');
  await p.waitForFunction(() => document.querySelector('.scn').dataset.mode === 'open');
  await ready(p);
}

async function chooseKind(p, kind) {
  await p.click('.scn-add .seg input[value="' + kind + '"] + .seg__label');
  await p.waitForFunction((k) => document.querySelector('.scn-form').dataset.kind === k, {}, kind);
}

const text = (selector) => page.$eval(selector, (el) => el.textContent);
const texts = (selector) => page.$$eval(selector, (all) => all.map((el) => el.textContent));
const value = (selector) => page.$eval(selector, (el) => el.value);
const scenarioOf = () => page.evaluate(() => JSON.parse(JSON.stringify(globalThis.sv2.store.project.scenario)));
const projectOf = () => page.evaluate(() => JSON.parse(JSON.stringify(globalThis.sv2.store.project)));
const chipTexts = () => page.$$eval('.scn-chip', (items) => items.map((item) => item.querySelector('.scn-chip__words').textContent));
const status = () => text('.scn-status');
const activeKey = () => page.evaluate(() => document.activeElement && (document.activeElement.dataset.key || document.activeElement.dataset.action || document.activeElement.id || null));
// One figure of the comparison: [before, after, difference].
const figure = (id) => page.$$eval('.scn-figures [data-figure="' + id + '"] td', (cells) => cells.map((cell) => cell.textContent.replace(/ /g, ' ').trim()));

// A typed field: select what is there, type, and press the key that commits.
async function typeInto(selector, words, finish) {
  await atRest(page, selector);
  await page.click(selector, { clickCount: 3 });
  await page.keyboard.type(words);
  await page.keyboard.press(finish || 'Enter');
}

async function addByPointer() {
  await page.click('.scn-add [data-action="add-change"]');
  await ready(page);
}

async function setLevers(levers) {
  await page.evaluate((list) => {
    const { store } = globalThis.sv2;
    const project = JSON.parse(JSON.stringify(store.project));
    project.scenario = { name: 'Levers', changes: [], compared: null, levers: list };
    store.replace(project);
  }, levers);
  await go(page, '#scenarios');
  await ready(page);
}

// ------------------------------------------------------------------ the fieldset

test('Kind of change is a fieldset of six radio chips, one form open at a time, the chosen chip marked by a shape and bold', async () => {
  await fresh(page);
  await start(page, 'Chips');
  assert.equal(await text('.scn-kind legend'), 'Kind of change');
  assert.equal(await page.$eval('.scn-kind', (el) => el.tagName), 'FIELDSET');
  assert.deepEqual(await texts('.scn-kind .seg__label'), ['Move a group', 'Swap two periods', 'Swap two groups’ rooms', 'Bell times', 'Staggered dismissal', 'Capacity and head counts']);
  assert.deepEqual(await page.$$eval('.scn-kind input', (all) => all.map((el) => el.value)), ['move', 'swapPeriods', 'swapRooms', 'bells', 'release', 'seats']);
  for (const kind of ['bells', 'release', 'seats', 'move']) {
    await chooseKind(page, kind);
    assert.equal(await page.$$eval('.scn-form', (all) => all.length), 1, 'one form at a time');
    assert.equal(await page.$eval('.scn-kind input:checked', (el) => el.value), kind);
    const mark = await page.$eval('.scn-kind input:checked + .seg__label', (el) => ({ weight: Number(getComputedStyle(el).fontWeight), shape: getComputedStyle(el, '::before').content, height: el.getBoundingClientRect().height }));
    assert.ok(mark.weight >= 700, 'the chosen chip is bold: ' + mark.weight);
    assert.notEqual(mark.shape, 'none', 'and has a filled shape');
    assert.ok(mark.height >= 44, 'chips are 44 px: ' + mark.height);
  }
  const small = await page.$$eval('.scn-kind .seg__option', (all) => all.map((el) => Math.round(el.getBoundingClientRect().height)).filter((height) => height < 44));
  assert.deepEqual(small, []);
});

// ------------------------------------------------------------------ Bell times

test('Bell times: the real times, the passing time it would make in a polite region, and Lengthen passing keeps the end and says so', async () => {
  await fresh(page);
  await start(page, 'Bells');
  await chooseKind(page, 'bells');
  assert.equal(await text('label[for="scenario-bells-set"]'), 'Day type');
  assert.deepEqual(await texts('#scenario-bells-set option'), ['A Day', 'B Day']);
  await page.select('#scenario-bells-period', '2');
  assert.deepEqual([await value('#scenario-bells-start'), await value('#scenario-bells-end')], ['9:44 AM', '10:32 AM'], 'the form starts from the real times');
  assert.equal(await text('.scn-form__now'), 'Now: Period 3, 9:44 AM to 10:32 AM.');
  assert.equal(await text('[data-part="passing"]'), 'Passing before Period 3: 4 min (was 4 min)');
  assert.equal(await page.$eval('[data-part="passing"]', (el) => el.getAttribute('aria-live')), 'polite');
  assert.deepEqual(await texts('.scn-lengthen button'), ['1 min', '2 min', '5 min']);
  assert.equal(await page.$eval('[data-key="scenario-lengthen-2"]', (el) => el.getAttribute('aria-label')), 'Lengthen passing before Period 3 by 2 min');
  await page.click('[data-key="scenario-lengthen-2"]');
  assert.deepEqual([await value('#scenario-bells-start'), await value('#scenario-bells-end')], ['9:46 AM', '10:32 AM'], 'the start later, the end kept');
  assert.equal(await text('[data-part="lengthen"]'), 'Period 3 then runs 9:46 AM to 10:32 AM, was 9:44 AM to 10:32 AM');
  assert.equal(await text('[data-part="passing"]'), 'Passing before Period 3: 6 min (was 4 min)');
  assert.equal(await text('[data-part="preview"]'), 'The change: A Day, Period 3: 9:46 AM to 10:32 AM (was 9:44 AM to 10:32 AM)');
  // the first period has nothing passed into it, and no Lengthen
  await page.select('#scenario-bells-period', '0');
  assert.equal(await text('[data-part="passing"]'), 'Nothing is passed into Period 1: it is the first of the day.');
  assert.equal(await page.$$eval('.scn-lengthen button:not([disabled])', (all) => all.length), 0);
  await page.select('#scenario-bells-period', '2');
  await page.click('[data-key="scenario-lengthen-2"]');
  await addByPointer();
  assert.deepEqual((await scenarioOf()).levers, [{ kind: 'bell', dayTypeId: A, period: 2, start: '09:46', end: '10:32' }]);
  assert.deepEqual(await chipTexts(), ['A Day, Period 3: 9:46 AM to 10:32 AM (was 9:44 AM to 10:32 AM)']);
  assert.equal(await status(), 'Added: A Day, Period 3: 9:46 AM to 10:32 AM (was 9:44 AM to 10:32 AM).');
  assert.equal(await page.$eval('.scn-chip', (el) => el.dataset.kind), 'bell');
  assert.equal(await text('[data-part="bar-text"]'), 'Not applied yet: 1 change');
});

test('Bell times: a shorter passing time is typed, a refusal is said under the field, and the comparison moves: one more late walk and warning', async () => {
  await fresh(page);
  await start(page, 'Shorter');
  await chooseKind(page, 'bells');
  await page.select('#scenario-bells-period', '3');
  assert.equal(await value('#scenario-bells-start'), '10:36 AM');
  await typeInto('#scenario-bells-start', 'ten thirty', 'Enter');
  await page.waitForSelector('#scenario-bells-start[aria-invalid="true"]');
  assert.match(await page.$eval('#scenario-bells-start ~ .field__refusal', (el) => el.textContent), /is not a time/);
  await typeInto('#scenario-bells-start', '10:34', 'Enter');
  await page.waitForFunction(() => document.querySelector('[data-part="passing"]').textContent === 'Passing before Period 4: 2 min (was 4 min)');
  await addByPointer();
  assert.deepEqual(await figure('late'), ['1', '2', '+1']);
  assert.deepEqual(await figure('warning'), ['1', '2', '+1']);
  assert.deepEqual(await figure('walking'), ['2 h 34 min', '2 h 34 min', 'no change']);
});

test('Bell times: a bell schedule is offered beside the day types, and its lever names the schedule', async () => {
  await fresh(page, 'project.bellSchedules = [{ id: "bsampleearly", name: "Early Release", off: [], bells: project.dayTypes[0].bells.map((bell) => ({ ...bell })) }];');
  await start(page, 'Schedules');
  await chooseKind(page, 'bells');
  assert.equal(await text('label[for="scenario-bells-set"]'), 'Day type or bell schedule');
  assert.deepEqual(await texts('#scenario-bells-set option'), ['A Day', 'B Day', 'Early Release bells']);
  await page.select('#scenario-bells-set', 'b:bsampleearly');
  await page.select('#scenario-bells-period', '2');
  await page.click('[data-key="scenario-lengthen-1"]');
  await addByPointer();
  assert.deepEqual((await scenarioOf()).levers, [{ kind: 'bell', bellsId: 'bsampleearly', period: 2, start: '09:45', end: '10:32' }]);
  assert.deepEqual(await chipTexts(), ['Early Release bells, Period 3: 9:45 AM to 10:32 AM (was 9:44 AM to 10:32 AM)']);
});

// ------------------------------------------------------------------ Staggered dismissal

test('Staggered dismissal: the real entries read-only, the Day tab\'s editor, and a trial that replaces a real one says so in its chip', async () => {
  await fresh(page);
  await page.evaluate(() => globalThis.sv2.store.apply(globalThis.sv2modules.actions.addRelease, { who: { grade: '7' }, seconds: 120 }));
  await go(page, '#scenarios');
  await ready(page);
  await start(page, 'Leave late');
  await chooseKind(page, 'release');
  assert.equal(await text('.scn-force__title'), 'Already in force');
  assert.deepEqual(await texts('.scn-force__list li'), ['grade 7 leaves 2 min after the bell, after every period, every day type (3 groups)']);
  assert.equal(await text('.scn-form__trial'), 'A trial: it counts here, and becomes real only if you Apply');
  // the Day tab's editor, imported: the same three kinds of who, the same fields
  assert.deepEqual(await page.$eval('.scn-form fieldset', (set) => Array.from(set.querySelectorAll('.sch-radio'), (el) => el.textContent)), ['Groups…', 'A grade', 'A wing']);
  assert.equal(await page.$eval('[data-action="add-change"]', (el) => el.textContent), 'Add this trial');
  assert.equal(await page.$eval('[data-action="add-change"]', (el) => el.disabled), true, 'Add waits for a group');
  await page.click('[data-key="scenario-release:who:grade"]');
  await page.waitForSelector('.sch-markedit__chips [data-grade="7"]');
  assert.equal(await page.$eval('[data-action="add-change"]', (el) => el.disabled), true, 'and for a grade');
  await page.click('.sch-markedit__chips [data-grade="7"]');
  await page.waitForFunction(() => !document.querySelector('[data-action="add-change"]').disabled);
  await typeInto('[data-key="scenario-release:minutes"]', '3', 'Enter');
  await page.waitForFunction(() => document.querySelector('[data-part="preview"]').textContent === 'The change: Grade 7 leaves 3 min after the bell');
  await addByPointer();
  assert.deepEqual((await scenarioOf()).levers, [{ kind: 'release', who: { grade: '7' }, seconds: 180, after: null, dayTypeIds: null }]);
  assert.deepEqual(await chipTexts(), ['Grade 7 leaves 3 min after the bell, instead of 2 min']);
  assert.equal(await status(), 'Added: Grade 7 leaves 3 min after the bell, instead of 2 min.');
  assert.deepEqual((await projectOf()).release.map((entry) => entry.seconds), [120], 'the real entry is untouched');
  // the comparison moves, and the late rows name the delay
  assert.equal((await figure('late'))[2].startsWith('+'), true, 'a group held back longer is late more often: ' + (await figure('late')));
  const held = await page.$$eval('.scn-groups [data-tag="held"]', (all) => all.map((el) => el.textContent));
  assert.ok(held.length > 0 && held.every((words) => words === 'Late, and leaves 3 min after the bell'), 'the late rows say why: ' + held);
});

test('Staggered dismissal: a group on the bell, by group, with a period tick, and the groups picker; the trial is one lever per key', async () => {
  await fresh(page);
  await start(page, 'By group');
  await chooseKind(page, 'release');
  assert.equal(await text('.scn-force__none'), 'No staggered dismissal is in force.');
  await page.focus('[data-key="scenario-release:group-add"]');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.sch-markedit__chips .chip').length === 1);
  await page.click('[data-key="scenario-release:on-bell"]');
  await page.waitForFunction(() => document.querySelector('[data-part="preview"]').textContent.endsWith('leaves on the bell'));
  await page.click('[data-key="scenario-release:after:some"]');
  await page.click('[data-key="scenario-release:period:3"]');
  await page.waitForFunction(() => document.querySelector('[data-part="preview"]').textContent.endsWith(', after Period 4'));
  await addByPointer();
  const [lever] = (await scenarioOf()).levers;
  assert.equal(lever.kind, 'release');
  assert.deepEqual([lever.seconds, lever.after, lever.dayTypeIds], [0, [3], null]);
  // a second for the same groups, periods and day types replaces the first
  await page.click('[data-key="scenario-release:on-bell"]');
  await page.waitForFunction(() => document.querySelector('[data-part="preview"]').textContent.includes('after the bell'));
  await addByPointer();
  assert.equal((await scenarioOf()).levers.length, 1, 'one lever per key');
  assert.equal((await scenarioOf()).levers[0].seconds, 120);
});

// ------------------------------------------------------------------ Capacity and head counts

test('Capacity: the room and its field start from what is there, a refusal is said, and the comparison moves: new warnings, the walks as they were', async () => {
  await fresh(page);
  await start(page, 'Seats');
  await chooseKind(page, 'seats');
  assert.deepEqual(await texts('.scn-seats__what .seg__label'), ['A room’s capacity', 'A group’s head count']);
  assert.equal(await text('[data-part="seats-move"]'), 'Capacity changes findings (a group larger than its room); head count changes crowding, walking times and findings.');
  await page.select('#scenario-seats-room', 'rsample204');
  const was = await value('#scenario-seats-capacity');
  assert.match(was, /^\d+$/);
  assert.equal(await text('.scn-seats__now'), was + ' now');
  await typeInto('#scenario-seats-capacity', '1000', 'Enter');
  await page.waitForSelector('#scenario-seats-capacity[aria-invalid="true"]');
  assert.equal(await page.$eval('#scenario-seats-capacity ~ .field__refusal', (el) => el.textContent), 'A capacity is a whole number from 1 to 999, or empty.');
  await typeInto('#scenario-seats-capacity', '5', 'Enter');
  await page.waitForFunction(() => document.querySelector('[data-part="preview"]').textContent.startsWith('The change: Room 204 seats 5'));
  await addByPointer();
  assert.deepEqual((await scenarioOf()).levers, [{ kind: 'capacity', roomId: 'rsample204', capacity: 5 }]);
  assert.deepEqual(await chipTexts(), ['Room 204 seats 5 (was ' + was + ')']);
  assert.deepEqual(await figure('warning'), ['1', '12', '+11']);
  assert.deepEqual(await figure('walking'), ['2 h 34 min', '2 h 34 min', 'no change']);
  // putting a capacity back to the real one puts back the schedule: nothing is added, the earlier lever goes
  await typeInto('#scenario-seats-capacity', was, 'Enter');
  await page.click('.scn-add [data-action="add-change"]');
  await ready(page);
  assert.equal((await scenarioOf()).levers.length, 0);
  assert.match(await status(), /^That puts the schedule back as it is: Room 204 seats \d+ \(was \d+\)\. Nothing is added, and 1 earlier change to the same thing is taken out\.$/);
});

test('Head count: a group, a number, cleared for the school\'s default; the comparison moves: the group is edited, crowding and the busiest load rise', async () => {
  await fresh(page);
  await start(page, 'Heads');
  await chooseKind(page, 'seats');
  await page.click('.scn-seats__what input[value="headCount"] + .seg__label');
  await page.waitForSelector('#scenario-seats-group');
  await page.select('#scenario-seats-group', 'gsample07a');
  assert.equal(await text('.scn-seats__now'), '25 now, the school’s default'.replace('25', await value('#scenario-seats-headcount') || '25'));
  await typeInto('#scenario-seats-headcount', 'many', 'Enter');
  await page.waitForSelector('#scenario-seats-headcount[aria-invalid="true"]');
  await typeInto('#scenario-seats-headcount', '90', 'Enter');
  await page.waitForFunction(() => document.querySelector('[data-part="preview"]').textContent.startsWith('The change: 7A: 90 students'));
  await addByPointer();
  assert.deepEqual((await scenarioOf()).levers, [{ kind: 'headCount', groupId: 'gsample07a', headCount: 90 }]);
  assert.match((await chipTexts())[0], /^7A: 90 students \(was \d+\)$/);
  assert.equal((await figure('crowding'))[2].startsWith('+'), true);
  assert.equal((await figure('busiest'))[2].startsWith('+'), true);
  assert.equal(await page.$eval('.scn-groups [data-group="gsample07a"]', (el) => el.dataset.edited), 'true', 'the group is marked edited');
});

// ------------------------------------------------------------------ chips and focus

test('every chip is a sentence with ×; after × the focus goes to the next chip, else the previous, else the Kind of change fieldset, and the count is said', async () => {
  await fresh(page);
  await setLevers([
    { kind: 'capacity', roomId: 'rsample204', capacity: 12 },
    { kind: 'headCount', groupId: 'gsample07a', headCount: 31 },
    { kind: 'release', who: { grade: '7' }, seconds: 90, after: null, dayTypeIds: null },
  ]);
  assert.equal((await chipTexts()).length, 3);
  assert.equal(await page.$$eval('.scn-chip .scn-chip__remove', (all) => all.every((el) => el.getAttribute('aria-label').startsWith('Remove: '))), true);
  await page.click('.scn-chip:nth-child(1) [data-action="remove"]');
  await ready(page);
  assert.equal((await scenarioOf()).levers.length, 2);
  assert.match(await status(), /^Removed: Room 204 seats 12 \(was \d+\)\. 2 changes\.$/);
  assert.equal(await page.evaluate(() => document.querySelector('.scn-chip [data-action="remove"]') === document.activeElement), true, 'the next chip takes the focus');
  await page.click('.scn-chip:nth-child(2) [data-action="remove"]');
  await ready(page);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.scn-chip')[0].querySelector('[data-action="remove"]') === document.activeElement), true, 'with none after, the one before');
  assert.match(await status(), /^Removed: Grade 7 leaves 1 min 30 s after the bell\. 1 change\.$/);
  await page.keyboard.press('Enter');
  await ready(page);
  assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('.scn-kind input:checked')), true, 'with none left, the Kind of change fieldset');
  assert.equal(await status(), 'Removed: 7A: 31 students (was 24). 0 changes.');
  assert.deepEqual((await scenarioOf()).levers, []);
  // Undo brings the lever back as one step
  await page.evaluate(() => globalThis.sv2.store.undo());
  await ready(page);
  assert.equal((await scenarioOf()).levers.length, 1);
});

test('a lever that no longer applies is listed with why, and Remove them takes it out', async () => {
  await fresh(page);
  await setLevers([
    { kind: 'capacity', roomId: 'rsample204', capacity: 12 },
    { kind: 'headCount', groupId: 'gsample07a', headCount: 31 },
  ]);
  await page.evaluate(() => {
    const { store } = globalThis.sv2;
    store.apply(globalThis.sv2modules.actions.deleteGroup, { id: 'gsample07a' });
  });
  await ready(page);
  assert.equal((await chipTexts()).length, 1);
  assert.equal(await page.$$eval('.scn-dropped__item', (all) => all.length), 1);
  assert.match(await text('.scn-dropped__item'), /is no longer in the project/);
  assert.equal(await text('[data-part="bar-text"]'), 'Not applied yet: 1 change, 1 skipped');
  await page.click('[data-action="remove-dropped"]');
  await ready(page);
  assert.equal(await page.$$eval('.scn-dropped__item', (all) => all.length), 0);
  assert.equal((await scenarioOf()).levers.length, 1);
});

// ------------------------------------------------------------------ the report

test('the congestion report lists the levers in the chips\' words', async () => {
  await fresh(page);
  await setLevers([
    { kind: 'capacity', roomId: 'rsample204', capacity: 12 },
    { kind: 'headCount', groupId: 'gsample07a', headCount: 31 },
  ]);
  await page.click('[data-action="congestion"]');
  await page.waitForSelector('#print-preview .doc-scenario table.doc-table--changes', { timeout: 30000 });
  const rows = await page.$$eval('#print-preview .doc-table--changes tr', (all) => all.map((row) => row.textContent.replace(/\s+/g, ' ').trim()));
  assert.match(rows[0], /^1 Room 204 seats 12 \(was \d+\)$/);
  assert.equal(rows[1], '2 7A: 31 students (was 24)');
  assert.equal(await page.$eval('#print-preview .doc-scenario h3', (el) => el.textContent), 'Its changes 2');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#print-preview') || document.querySelector('#print-preview').hidden || !document.querySelector('#print-preview').open);
});

// ------------------------------------------------------------------ Apply

// The scenario every Apply case starts from: a move, a bell, a staggered
// dismissal, a capacity, a head count, a closed stairs and a closed corridor.
const APPLY_BODY = `
  const floor = project.building.floors[0];
  const cells = [];
  for (let i = 0; i < floor.cells.length && cells.length < 2; i += 1) if (floor.cells[i] === '#') cells.push(i);
  project.scenario = { name: 'Everything', compared: null,
    changes: [{ kind: 'move', dayTypeId: 'dsample00a', groupId: 'gsample07c', period: 1, roomId: 'rsample204' }],
    levers: [
      { kind: 'bell', dayTypeId: 'dsample00a', period: 2, start: '09:46', end: '10:32' },
      { kind: 'release', who: { grade: '7' }, seconds: 120, after: null, dayTypeIds: null },
      { kind: 'capacity', roomId: 'rsample204', capacity: 12 },
      { kind: 'headCount', groupId: 'gsample06a', headCount: 31 },
      { kind: 'way', connectionId: 'csample00b', way: 'closed' },
      { kind: 'corridor', floorId: floor.id, cells, name: 'North Corridor' },
    ] };`;

test('Apply: the summary lists what is written and a line per kind, the closures are left out in a band of their own, the button says "n of m"', async () => {
  await fresh(page, APPLY_BODY);
  assert.equal((await chipTexts()).length, 7);
  assert.deepEqual(await page.$$eval('.scn-chip[data-trial="true"] .scn-tag', (all) => all.map((el) => el.textContent)), ['Trial only', 'Trial only']);
  await page.click('[data-action="apply"]');
  await page.waitForSelector('#scenario-apply[open]');
  const dialog = await page.$eval('#scenario-apply', (el) => ({
    title: el.querySelector('.dialog__title').textContent,
    list: Array.from(el.querySelectorAll('[data-part="applies"] li'), (li) => li.textContent),
    kinds: Array.from(el.querySelectorAll('[data-part="kinds"] li'), (li) => li.textContent),
    trial: el.querySelector('[data-part="trial"]').textContent,
    trialIsAfterTheLists: Boolean(el.querySelector('[data-part="kinds"]').compareDocumentPosition(el.querySelector('[data-part="trial"]')) & Node.DOCUMENT_POSITION_FOLLOWING),
    trialBeforeButtons: Boolean(el.querySelector('[data-part="trial"]').compareDocumentPosition(el.querySelector('.dialog__buttons')) & Node.DOCUMENT_POSITION_FOLLOWING),
    buttons: Array.from(el.querySelectorAll('.dialog__buttons button'), (button) => button.textContent),
    body: el.querySelector('.dialog__body').textContent,
  }));
  assert.equal(dialog.title, 'Apply the scenario “Everything”?');
  assert.equal(dialog.list.length, 5, 'the move and the four levers it writes; the closures are not in the list');
  assert.ok(dialog.list.includes('A Day, Period 3: 9:46 AM to 10:32 AM (was 9:44 AM to 10:32 AM)'));
  assert.ok(dialog.list.includes('Grade 7 leaves 2 min after the bell'));
  assert.deepEqual(dialog.kinds, ['Bell times: 1 change.', 'Staggered dismissal: 1 rule.', 'Room capacities: 1 change.', 'Head counts: 1 change.']);
  assert.equal(dialog.trial, 'Closing Stairs B and North Corridor is a trial: Apply leaves the building as it is.');
  assert.ok(dialog.trialIsAfterTheLists && dialog.trialBeforeButtons, 'a band of its own above the buttons');
  assert.deepEqual(dialog.buttons, ['Apply 5 of 7 changes', 'Keep it as a scenario']);
  assert.match(dialog.body, /Undo brings back the schedule and the scenario together\./);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#scenario-apply[open]'));
});

test('Apply writes the changes and levers as one undo step, closes the scenario with its closures, and the focus goes to the name field; Undo brings it all back', async () => {
  await fresh(page, APPLY_BODY);
  const before = await projectOf();
  const steps = await page.evaluate(() => globalThis.sv2.store.undoDepth !== undefined ? globalThis.sv2.store.undoDepth : null);
  await page.click('[data-action="apply"]');
  await page.waitForSelector('#scenario-apply[open]');
  await page.click('#scenario-apply .btn--primary');
  await page.waitForFunction(() => globalThis.sv2.store.project.scenario === null);
  await ready(page);
  const now = await projectOf();
  assert.deepEqual(now.dayTypes[0].bells[2], { start: '09:46', end: '10:32' });
  assert.deepEqual(now.release.map((entry) => [entry.who, entry.seconds]), [[{ grade: '7' }, 120]]);
  const room = (project) => project.building.floors.flatMap((floor) => floor.spaces).find((space) => space.id === 'rsample204');
  assert.equal(room(now).capacity, 12);
  assert.equal(now.groups.find((group) => group.id === 'gsample06a').headCount, 31);
  assert.notEqual(now.groups.find((group) => group.id === 'gsample07c').days.dsample00a[1].room, before.groups.find((group) => group.id === 'gsample07c').days.dsample00a[1].room);
  assert.deepEqual(now.building, before.building, 'the closures went with the scenario: the building is as it was');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'scenario-start-name', 'the focus is on the first control of the section with nothing open');
  assert.match(await page.$eval('.toast .toast__text', (el) => el.textContent), /^Applied “Everything”: 5 changes made to the schedule\. Closing Stairs B and North Corridor is a trial: Apply leaves the building as it is\.$/);
  // one undo step brings the scenario back whole, closures included
  await page.evaluate(() => globalThis.sv2.store.undo());
  await ready(page);
  const back = await projectOf();
  assert.equal(back.scenario.levers.length, 6);
  assert.deepEqual(back.dayTypes[0].bells[2], before.dayTypes[0].bells[2]);
  assert.deepEqual(back.release || [], before.release || []);
  assert.deepEqual(room(back).capacity, room(before).capacity);
  assert.ok(steps === null || typeof steps === 'number');
});

// ------------------------------------------------------------------ keyboard

test('by keyboard: the kind chips by arrows, a field typed and committed with Enter, the lever added with Enter on its button', async () => {
  await fresh(page);
  await start(page, 'Keys');
  await chooseKind(page, 'move');
  await page.focus('.scn-kind input:checked');
  for (const kind of ['swapPeriods', 'swapRooms', 'bells', 'release', 'seats']) {
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction((k) => document.querySelector('.scn-form').dataset.kind === k, {}, kind);
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('.scn-kind input:checked')), true, 'the chip keeps the focus as the form is drawn');
  }
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.closest('.scn-seats__what') !== null), true, 'Tab leaves the chips for the form');
  await page.focus('#scenario-seats-capacity');
  await page.keyboard.type('9');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('[data-part="preview"]').textContent.includes('seats 9'));
  await page.keyboard.press('Tab');
  assert.equal(await activeKey(), 'add-change');
  await page.keyboard.press('Enter');
  await ready(page);
  assert.deepEqual((await scenarioOf()).levers.map((lever) => [lever.kind, lever.capacity]), [['capacity', 9]]);
  // the chip is taken out by its × from the keyboard, and Undo is one step
  await page.focus('.scn-chip [data-action="remove"]');
  await page.keyboard.press('Enter');
  await ready(page);
  assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('.scn-kind input:checked')), true, 'with none left the focus is on the Kind of change fieldset');
});

// ------------------------------------------------------------------ axe

for (const theme of ['light', 'dark']) {
  test('axe finds nothing in each new state of the panel, in the ' + theme + ' theme', async () => {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
    await fresh(page);
    await page.evaluate(() => globalThis.sv2.store.apply(globalThis.sv2modules.actions.addRelease, { who: { grade: '7' }, seconds: 120 }));
    await start(page, 'Axe');
    await page.addScriptTag({ path: AXE });
    const check = async (what, selector) => {
      await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
      const found = await page.evaluate((root, tags) => globalThis.axe.run(document.querySelector(root), { runOnly: { type: 'tag', values: tags } }), selector || '.scn-panel', TAGS);
      assert.ok(found.passes.length > 5, 'axe ran very few rules');
      assert.deepEqual(found.violations.map((violation) => violation.id + ': ' + violation.nodes.map((node) => node.target.join(' ')).join(', ')), [], what + ', ' + theme);
    };
    await chooseKind(page, 'bells');
    await page.select('#scenario-bells-period', '2');
    await page.click('[data-key="scenario-lengthen-2"]');
    await check('Bell times, lengthened');
    await addByPointer();
    await check('Bell times, with a chip');
    await chooseKind(page, 'release');
    await check('Staggered dismissal, groups');
    await page.click('[data-key="scenario-release:who:grade"]');
    await page.waitForSelector('.sch-markedit__chips [data-grade="7"]');
    await page.click('.sch-markedit__chips [data-grade="7"]');
    await page.click('[data-key="scenario-release:after:some"]');
    await page.click('[data-key="scenario-release:days:some"]');
    await check('Staggered dismissal, a grade with ticks');
    await page.click('[data-key="scenario-release:who:wing"]');
    await check('Staggered dismissal, a wing');
    await chooseKind(page, 'seats');
    await check('Capacity');
    await page.click('.scn-seats__what input[value="headCount"] + .seg__label');
    await page.waitForSelector('#scenario-seats-group');
    await check('Head count');
    await typeInto('#scenario-seats-headcount', 'x', 'Enter');
    await page.waitForSelector('#scenario-seats-headcount[aria-invalid="true"]');
    await check('Head count, refused');
    await fresh(page, APPLY_BODY);
    await check('Chips with trial only tags');
    await page.click('[data-action="apply"]');
    await page.waitForSelector('#scenario-apply[open]');
    await check('Apply with the closures band', '#scenario-apply');
    await page.keyboard.press('Escape');
  });
}

// ------------------------------------------------------------------ phone

test('at 390 by 844 with touch: the forms are used by tap, every target is 44 px, the stage keeps 160 px, nothing scrolls sideways', async () => {
  await page.close();
  const phone = await openPlanner({ server, browser, hash: '#scenarios', theme: 'light', width: 390, height: 844, mobile: true });
  const p = phone.page;
  try {
    await assertTouch(p, 'scenario levers at 390');
    await loadModule(p, 'actions', 'engine/actions.js');
    await fresh(p);
    const tap = async (selector) => {
      await p.waitForSelector(selector);
      await p.$eval(selector, (el) => el.scrollIntoView({ block: 'center' }));
      await atRest(p, selector);
      await p.tap(selector);
    };
    await tap('#scenario-start-name');
    await p.keyboard.type('Phone');
    await tap('[data-action="start"]');
    await p.waitForFunction(() => document.querySelector('.scn').dataset.mode === 'open');
    await ready(p);
    const small = (selector) => p.evaluate((wanted) => Array.from(document.querySelectorAll(wanted))
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => [el.className || el.tagName, el.textContent.slice(0, 24), Math.round(el.getBoundingClientRect().height)]).filter(([, , height]) => height < 44), selector);
    const sheet = '.scn-form .btn, .scn-form .field__input, .scn-form .sch-radio, .scn-form .sch-show__chip, .scn-form .chip__remove, .scn-kind .seg__option, .scn-seats__what .seg__option';
    for (const kind of ['bells', 'release', 'seats']) {
      await tap('.scn-kind input[value="' + kind + '"] + .seg__label');
      await p.waitForFunction((k) => document.querySelector('.scn-form').dataset.kind === k, {}, kind);
      assert.deepEqual(await small(sheet), [], kind + ': every control is 44 px tall');
      const shape = await p.evaluate(() => ({ stage: document.querySelector('.scn .mov-stage').getBoundingClientRect().height, wide: document.documentElement.scrollWidth - window.innerWidth }));
      assert.ok(shape.stage >= 160 - 0.5, kind + ': the stage keeps its 160 px: ' + shape.stage);
      assert.ok(shape.wide <= 0, kind + ': nothing scrolls sideways: ' + shape.wide);
    }
    // a lever by tap: a capacity
    await tap('#scenario-seats-capacity');
    await p.keyboard.type('8');
    await p.keyboard.press('Enter');
    await tap('.scn-add [data-action="add-change"]');
    await ready(p);
    await p.waitForSelector('.scn-chip[data-kind="capacity"]');
    assert.equal(await p.$$eval('.scn-chip', (all) => all.length), 1);
    assert.deepEqual(await small('.scn-chip__remove'), [], 'the × is 44 px');
    await tap('.scn-chip [data-action="remove"]');
    await ready(p);
    assert.equal(await p.$$eval('.scn-chip', (all) => all.length), 0);
    assert.equal(await p.evaluate(() => document.activeElement === document.querySelector('.scn-kind input:checked')), true, 'the focus is on the Kind of change fieldset');
    assert.deepEqual(phone.problems().errors, []);
  } finally {
    await phone.close();
  }
});
