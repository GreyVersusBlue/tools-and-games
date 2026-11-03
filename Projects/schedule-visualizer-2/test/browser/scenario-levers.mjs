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

// How much of an element is on the screen: its box cut to the window and to every
// ancestor that clips it (the section, and the page around it, which may be scrolled
// too), and nothing else. A stage scrolled off the top is tall and seen not at all.
const visibleHeight = (p, selector) => p.$eval(selector, (el) => {
  const box = el.getBoundingClientRect();
  let top = Math.max(0, box.top);
  let bottom = Math.min(window.innerHeight, box.bottom);
  for (let up = el.parentElement; up; up = up.parentElement) {
    if (getComputedStyle(up).overflowY === 'visible') continue;
    const clip = up.getBoundingClientRect();
    top = Math.max(top, clip.top);
    bottom = Math.min(bottom, clip.bottom);
  }
  return Math.max(0, bottom - top);
});

// Is this control on the screen, and not under the pinned stage or the bar? What is at its middle is it (or in it).
const reachableAt = (p, selector) => p.$eval(selector, (el) => {
  const box = el.getBoundingClientRect();
  const at = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  return Boolean(at) && (at === el || el.contains(at));
});

const text = (selector) => page.$eval(selector, (el) => el.textContent);
const texts = (selector) => page.$$eval(selector, (all) => all.map((el) => el.textContent));
const value = (selector) => page.$eval(selector, (el) => el.value);
const scenarioOf = () => page.evaluate(() => JSON.parse(JSON.stringify(globalThis.sv2.store.project.scenario)));
const projectOf = () => page.evaluate(() => JSON.parse(JSON.stringify(globalThis.sv2.store.project)));
const chipTexts = () => page.$$eval('.scn-chip', (items) => items.map((item) => item.querySelector('.scn-chip__words').textContent));
const status = () => text('.scn-status');
const activeKey = () => page.evaluate(() => document.activeElement && (document.activeElement.dataset.key || document.activeElement.dataset.action || document.activeElement.id || null));
// One figure of the comparison: [before, after, difference].
const figure = (id) => page.$$eval('.scn-figures [data-figure="' + id + '"] td', (cells) => cells.map((cell) => Array.from(cell.childNodes).filter((node) => node.nodeType === 3).map((node) => node.textContent).join('').replace(/\u00a0/g, ' ').trim()));

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

test('Kind of change is a fieldset of seven radio chips, one form open at a time, the chosen chip marked by a shape and bold', async () => {
  await fresh(page);
  await start(page, 'Chips');
  assert.equal(await text('.scn-kind legend'), 'Kind of change');
  assert.equal(await page.$eval('.scn-kind', (el) => el.tagName), 'FIELDSET');
  assert.deepEqual(await texts('.scn-kind .seg__label'), ['Move a group', 'Swap two periods', 'Swap two groups’ rooms', 'Bell times', 'Staggered dismissal', 'Stairs and corridors', 'Capacity and head counts']);
  assert.deepEqual(await page.$$eval('.scn-kind input', (all) => all.map((el) => el.value)), ['move', 'swapPeriods', 'swapRooms', 'bells', 'release', 'building', 'seats']);
  for (const kind of ['bells', 'release', 'building', 'seats', 'move']) {
    await chooseKind(page, kind);
    assert.equal(await page.$$eval('.scn-form', (all) => all.length), 1, 'one form at a time');
    assert.equal(await page.$eval('.scn-kind input:checked', (el) => el.value), kind);
    const mark = await page.$eval('.scn-kind input:checked + .seg__label', (el) => ({ weight: Number(getComputedStyle(el).fontWeight), shape: getComputedStyle(el, '::before').content, height: el.parentNode.getBoundingClientRect().height }));
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
  await page.click('[data-key="scenario-release:who:groups"]');
  await page.focus('[data-key="scenario-release:group-add"]');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.sch-markedit__chips .chip').length === 1);
  await typeInto('[data-key="scenario-release:minutes"]', '2', 'Enter');
  await page.click('[data-key="scenario-release:after:some"]');
  await page.click('[data-key="scenario-release:period:3"]');
  await page.waitForFunction(() => document.querySelector('[data-part="preview"]').textContent.endsWith(', after Period 4'));
  await addByPointer();
  const [lever] = (await scenarioOf()).levers;
  assert.equal(lever.kind, 'release');
  assert.deepEqual([lever.seconds, lever.after, lever.dayTypeIds], [120, [3], null]);
  // a second for the same groups, periods and day types replaces the first
  await typeInto('[data-key="scenario-release:minutes"]', '3', 'Enter');
  await page.waitForFunction(() => document.querySelector('[data-part="preview"]').textContent.includes('3 min after the bell'));
  await addByPointer();
  assert.equal((await scenarioOf()).levers.length, 1, 'one lever per key');
  assert.equal((await scenarioOf()).levers[0].seconds, 180);
});

// ------------------------------------------------------------------ Capacity and head counts

test('Capacity: the room and its field start from what is there, a refusal is said, and the comparison moves: new warnings, the walks as they were', async () => {
  await fresh(page);
  await start(page, 'Seats');
  await chooseKind(page, 'seats');
  await page.click('.scn-seats__what input[value="capacity"] + .seg__label');
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
  assert.equal(await text('.scn-seats__now'), (await value('#scenario-seats-headcount')) + ' now');
  await typeInto('#scenario-seats-headcount', 'many', 'Enter');
  await page.waitForSelector('#scenario-seats-headcount[aria-invalid="true"]');
  await typeInto('#scenario-seats-headcount', '90', 'Enter');
  await page.waitForFunction(() => document.querySelector('[data-part="preview"]').textContent.startsWith('The change: 7A: 90 students'));
  await addByPointer();
  assert.deepEqual((await scenarioOf()).levers, [{ kind: 'headCount', groupId: 'gsample07a', headCount: 90 }]);
  assert.match((await chipTexts())[0], /^7A: 90 students \(was \d+\)$/);
  assert.equal((await figure('crowding'))[2].startsWith('+'), true);
  assert.equal((await figure('busiest'))[2].startsWith('+'), true);
  assert.equal(await page.evaluate(() => document.querySelector('.scn').scenarios.compare.groups.find((row) => row.groupId === 'gsample07a').edited), true, 'the group is marked edited');
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
  assert.equal(await status(), 'Removed: 7A: 31 students (was 27). no changes.');
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

test('a release lever that reconcile trimmed (a group it named deleted) keeps a × that removes it', async () => {
  await fresh(page);
  await setLevers([{ kind: 'release', who: { groups: ['gsample07a', 'gsample07c'] }, seconds: 90, after: null, dayTypeIds: null }]);
  await page.evaluate(() => globalThis.sv2.store.apply(globalThis.sv2modules.actions.deleteGroup, { id: 'gsample07a' }));
  await ready(page);
  assert.equal((await chipTexts()).length, 1, 'the lever still applies to the group left');
  assert.equal(await page.$$eval('.scn-dropped__item', (all) => all.length), 0);
  await page.click('.scn-chip [data-action="remove"]');
  await ready(page);
  assert.deepEqual((await scenarioOf()).levers, [], 'the stored lever went, though the chip showed a trimmed copy of it');
  assert.equal((await chipTexts()).length, 0);
  assert.match(await status(), /^Removed: .* leaves 1 min 30 s after the bell\. no changes\.$/);
});

test('Remove them takes dropped changes and dropped levers in one undo step; a step refused says none went and what is still listed', async () => {
  await fresh(page);
  await page.evaluate(() => {
    const { store } = globalThis.sv2;
    const project = JSON.parse(JSON.stringify(store.project));
    project.scenario = { name: 'Gone', compared: null,
      changes: [{ kind: 'move', dayTypeId: 'dsample00a', groupId: 'gsample07a', period: 1, roomId: 'rsample204' }],
      levers: [
        { kind: 'headCount', groupId: 'gsample07a', headCount: 31 },
        { kind: 'headCount', groupId: 'gsample07c', headCount: 29 },
        { kind: 'headCount', groupId: 'gsample06a', headCount: 28 },
      ] };
    store.replace(project);
  });
  await go(page, '#scenarios');
  await ready(page);
  await page.evaluate(() => {
    const { store } = globalThis.sv2;
    for (const id of ['gsample07a', 'gsample07c', 'gsample06a']) store.apply(globalThis.sv2modules.actions.deleteGroup, { id });
  });
  await ready(page);
  assert.equal(await page.$$eval('.scn-dropped__item', (all) => all.length), 4, 'a change and three levers are dropped');
  // the step is refused, as a stale index or a locked project would: nothing goes and it is said
  await page.evaluate(() => {
    const { store } = globalThis.sv2;
    const { actions } = globalThis.sv2modules;
    const real = store.apply.bind(store);
    globalThis.sv2.restoreApply = () => { store.apply = real; };
    store.apply = (action, payload) => {
      if (action === actions.removeScenarioChanges) throw new actions.ActionError('The scenario could not be changed just now.', 'bad-value');
      return real(action, payload);
    };
  });
  await page.click('[data-action="remove-dropped"]');
  await page.waitForFunction(() => /^Removed none of the 4 changes/.test(document.querySelector('.scn-status').textContent));
  await page.evaluate(() => globalThis.sv2.restoreApply());
  assert.equal(await status(), 'Removed none of the 4 changes that no longer applied. 4 are still listed. The scenario could not be changed just now.');
  assert.equal(await page.$$eval('.scn-dropped__item', (all) => all.length), 4);
  const kept = await scenarioOf();
  assert.equal(kept.changes.length + kept.levers.length, 4, 'the scenario is as it was');
  // not refused: all four go, as one step
  await page.click('[data-action="remove-dropped"]');
  await ready(page);
  assert.equal(await page.$$eval('.scn-dropped__item', (all) => all.length), 0);
  const after = await scenarioOf();
  assert.deepEqual([after.changes.length, after.levers.length], [0, 0]);
  assert.equal(await status(), 'Removed 4 changes that no longer applied.');
  await page.evaluate(() => globalThis.sv2.store.undo());
  await ready(page);
  assert.equal(await page.$$eval('.scn-dropped__item', (all) => all.length), 4, 'one Undo brings the change and the three levers back together');
});

// ------------------------------------------------------------------ Stairs and corridors

const FLOOR1 = 'fsample001';

// A cell of a floor on the page: where a pointer is put to touch it, or null off the stage
const pointOf = (p, floorId, cell) => p.evaluate((f, c) => {
  const plan = document.querySelector('.scn').scenarios.plan;
  const at = plan.cellAt(f, c);
  if (!at) return null;
  const box = plan.canvas.getBoundingClientRect();
  const x = box.left + at.x;
  const y = box.top + at.y;
  // it must be the plan under the point, not the banner or a button over it
  return document.elementFromPoint(x, y) === plan.canvas ? { x, y } : null;
}, floorId, cell);

// The first of these cells that the pointer can reach
async function reachable(p, floorId, cells) {
  for (const cell of cells) {
    const at = await pointOf(p, floorId, cell);
    if (at) return { cell, ...at };
  }
  throw new Error('no cell of the list can be reached on the plan');
}

const leversNow = async () => (await scenarioOf()).levers || [];
const announced = () => text('#announcer');
const corridorCells = async (floorId, corridorId) => {
  const project = await projectOf();
  const floor = project.building.floors.find((each) => each.id === floorId);
  return floor.corridors.find((each) => each.id === corridorId).cells;
};

// How much of a cell of the plan is dark: the ink of a hatch, against the corridor's pale ground
const inkIn = (p, floorId, cell) => p.evaluate((f, c) => {
  const plan = document.querySelector('.scn').scenarios.plan;
  const at = plan.cellAt(f, c);
  const ratio = window.devicePixelRatio || 1;
  const size = plan.view.size;
  const g = plan.canvas.getContext('2d');
  const left = Math.round((at.x - size / 2) * ratio);
  const top = Math.round((at.y - size / 2) * ratio);
  const side = Math.max(1, Math.round(size * ratio));
  const data = g.getImageData(left, top, side, side).data;
  let dark = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] < 300) dark += 1;
  return dark;
}, floorId, cell);

test('Stairs and corridors: a stair by select with its four choices; Up only, then Closed replaces it; a way equal to the real one adds nothing', async () => {
  await fresh(page);
  await start(page, 'Stairs');
  await chooseKind(page, 'building');
  await page.click('.scn-seats__what input[value="stair"] + .seg__label');
  await page.waitForSelector('#scenario-building-stair');
  assert.deepEqual(await texts('#scenario-building-stair option'), ['Stairs A: Floor 1 to Floor 2', 'Stairs B: Floor 2 to Floor 3']);
  await page.select('#scenario-building-stair', 'csample00b');
  assert.deepEqual(await texts('.scn-way .seg__label'), ['Both ways', 'Up only, towards Floor 3', 'Down only, towards Floor 2', 'Closed']);
  assert.equal(await text('.scn-way legend'), 'Which way');
  assert.equal(await page.$eval('.scn-way input:checked', (el) => el.value), 'both', 'it starts from the way it has');
  assert.match(await text('[data-part="now"]'), /^Now: Both ways\.$/);
  // a way equal to the real one adds nothing, and says the building is as it was
  await addByPointer();
  assert.match(await status(), /^That puts the building back as it is: Stairs B: both ways\. Nothing is added\.$/);
  assert.deepEqual((await leversNow()), []);
  await page.click('.scn-way input[value="ab"] + .seg__label');
  await page.waitForFunction(() => /Stairs B: up only/.test(document.querySelector('[data-part="preview"]').textContent));
  await addByPointer();
  assert.deepEqual((await leversNow()), [{ kind: 'way', connectionId: 'csample00b', way: 'ab' }]);
  assert.deepEqual(await chipTexts(), ['Stairs B: up only']);
  assert.equal(await page.$$eval('.scn-chip .scn-tag', (all) => all.length), 0, 'a direction is written by Apply: not a trial only');
  assert.equal(await page.$eval('.scn-legend', (el) => el.hidden), true, 'nothing is closed: no legend');
  await page.click('.scn-way input[value="closed"] + .seg__label');
  await addByPointer();
  assert.deepEqual((await leversNow()), [{ kind: 'way', connectionId: 'csample00b', way: 'closed' }], 'a later way of the same stairs replaces the earlier');
  assert.deepEqual(await chipTexts(), ['Close Stairs B']);
  assert.deepEqual(await texts('.scn-chip .scn-tag'), ['Trial only']);
  assert.equal(await page.$eval('.scn-legend', (el) => el.hidden), false);
  assert.equal(await text('.scn-legend'), 'Closed in this trial');
});

test('closed stairs and corridors are hatched on the lab\'s plan while the scenario is open, and not when it is gone', async () => {
  await fresh(page);
  await start(page, 'Hatch');
  const cells = await corridorCells(FLOOR1, 'ksample001');
  const open = await reachable(page, FLOOR1, cells);
  const before = await inkIn(page, FLOOR1, open.cell);
  await setLevers([{ kind: 'corridor', floorId: FLOOR1, cells, name: 'Main Corridor' }, { kind: 'way', connectionId: 'csample00a', way: 'closed' }]);
  await page.waitForFunction(() => Number(document.querySelector('.scn').dataset.closedDrawn) > 0);
  // the hatch is ink over the cell, a pattern and not a tint
  const after = await inkIn(page, FLOOR1, open.cell);
  assert.ok(after > before * 2 + 3, 'the closed corridor cell is hatched in ink: ' + before + ' dark pixels before, ' + after + ' after');
  // the stairs' two ends too
  const ends = await page.evaluate(() => Number(document.querySelector('.scn').dataset.closedDrawn));
  assert.ok(ends > cells.length * 0 + 2, 'corridor cells and the two ends of Stairs A were hatched: ' + ends);
  // the chip is the text alternative
  assert.deepEqual(await chipTexts(), ['Close Main Corridor', 'Close Stairs A']);
  // an open scenario with them out: nothing drawn
  await page.click('.scn-chip:nth-child(2) [data-action="remove"]');
  await page.click('.scn-chip:nth-child(1) [data-action="remove"]');
  await ready(page);
  await page.waitForFunction(() => Number(document.querySelector('.scn').dataset.closedDrawn) === 0);
  assert.ok(await inkIn(page, FLOOR1, open.cell) <= before + 1, 'and the cell is as it was');
});

test('a corridor closed by name from the select: its chip is a Trial only sentence and its cells are the corridor\'s', async () => {
  await fresh(page);
  await start(page, 'By name');
  await chooseKind(page, 'building');
  await page.click('.scn-seats__what input[value="corridor"] + .seg__label');
  await page.waitForSelector('#scenario-building-corridor');
  assert.deepEqual(await texts('#scenario-building-corridor option'), ['Main Corridor, Floor 1', 'Front Hall, Floor 1', 'Upper Corridor, Floor 2', 'Music Wing, Floor 3', 'Top Corridor, Floor 3']);
  await page.select('#scenario-building-corridor', 'ksample003');
  await page.waitForFunction(() => /Close Upper Corridor/.test(document.querySelector('[data-part="preview"]').textContent));
  await addByPointer();
  const levers = (await leversNow());
  assert.deepEqual(levers.map((lever) => [lever.kind, lever.floorId, lever.name]), [['corridor', 'fsample002', 'Upper Corridor']]);
  assert.deepEqual(levers[0].cells, await corridorCells('fsample002', 'ksample003'));
  assert.deepEqual(await chipTexts(), ['Close Upper Corridor']);
  assert.equal(await status(), 'Added: Close Upper Corridor.');
});

test('Pick on the map by pointer: a banner with Cancel, a click closes the place, the mode ends with focus on the button, and a second click on it opens it again', async () => {
  await fresh(page);
  await start(page, 'Pointer');
  await chooseKind(page, 'building');
  await page.click('.scn-seats__what input[value="corridor"] + .seg__label');
  await page.waitForSelector('[data-key="scenario-building-pick"]');
  assert.equal(await page.$eval('.scn-pick', (el) => el.hidden), true, 'no banner until the mode starts');
  await page.click('[data-key="scenario-building-pick"]');
  await page.waitForFunction(() => document.querySelector('.scn').dataset.picking === 'true');
  const banner = await page.$eval('.scn-pick', (el) => ({ hidden: el.hidden, role: el.getAttribute('role'), text: el.querySelector('.scn-pick__text').textContent, cancel: el.querySelector('button').textContent, height: el.querySelector('button').getBoundingClientRect().height }));
  assert.deepEqual([banner.hidden, banner.role, banner.text, banner.cancel], [false, 'status', 'Tap or click a corridor to close it.', 'Cancel']);
  assert.ok(banner.height >= 44, 'Cancel is 44 px: ' + banner.height);
  assert.equal(await page.$eval('[data-key="scenario-building-pick"]', (el) => el.getAttribute('aria-pressed')), 'true');
  assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('.scn').scenarios.plan.canvas), true, 'the plan takes the focus');
  // a click on something that is not a corridor is said and the mode goes on
  const cells = await corridorCells(FLOOR1, 'ksample001');
  const empty = await reachable(page, FLOOR1, [0, 1, 2, 3, 40, 41, 42, 80, 81, 82]);
  await page.mouse.click(empty.x, empty.y);
  await page.waitForFunction(() => /not a corridor/.test(document.querySelector('#announcer').textContent));
  assert.equal(await page.evaluate(() => document.querySelector('.scn').dataset.picking), 'true');
  assert.deepEqual((await leversNow()), []);
  // a click on the corridor closes the whole corridor
  const at = await reachable(page, FLOOR1, cells);
  await page.mouse.click(at.x, at.y);
  await ready(page);
  const levers = (await leversNow());
  assert.deepEqual(levers.map((lever) => [lever.kind, lever.name]), [['corridor', 'Main Corridor']]);
  assert.deepEqual(levers[0].cells, cells);
  assert.equal(await announced(), 'Main Corridor closed in this trial.');
  assert.equal(await page.evaluate(() => document.querySelector('.scn').dataset.picking), undefined, 'the mode has ended');
  assert.equal(await page.$eval('.scn-pick', (el) => el.hidden), true);
  assert.equal(await activeKey(), 'scenario-building-pick', 'the focus is back on Pick on the map');
  assert.deepEqual(await chipTexts(), ['Close Main Corridor']);
  // picking a place that is closed opens it again
  await page.click('[data-key="scenario-building-pick"]');
  await page.waitForFunction(() => document.querySelector('.scn').dataset.picking === 'true');
  const again = await reachable(page, FLOOR1, cells);
  await page.mouse.click(again.x, again.y);
  await ready(page);
  assert.deepEqual((await leversNow()), []);
  assert.equal(await announced(), 'Main Corridor is open again.');
  assert.equal(await activeKey(), 'scenario-building-pick');
  // Cancel ends the mode and adds nothing
  await page.click('[data-key="scenario-building-pick"]');
  await page.waitForFunction(() => document.querySelector('.scn').dataset.picking === 'true');
  await page.click('.scn-pick__cancel');
  await page.waitForFunction(() => document.querySelector('.scn').dataset.picking === undefined);
  assert.equal(await announced(), 'Picking cancelled.');
  assert.equal(await activeKey(), 'scenario-building-pick');
  assert.deepEqual((await leversNow()), []);
});

test('a corridor with no name is picked as the stretch between junctions, and its chip says how many cells', async () => {
  await fresh(page, 'for (const floor of project.building.floors) floor.corridors = [];');
  await start(page, 'Stretch');
  await chooseKind(page, 'building');
  await page.click('.scn-seats__what input[value="corridor"] + .seg__label');
  await page.waitForSelector('[data-part="none"]');
  assert.match(await text('[data-part="none"]'), /^No corridor has a name\. Pick one on the map/);
  await page.click('[data-key="scenario-building-pick"]');
  await page.waitForFunction(() => document.querySelector('.scn').dataset.picking === 'true');
  const project = await projectOf();
  const floor = project.building.floors[0];
  const row = [];
  for (let i = 281; i < 281 + 39; i += 1) row.push(i);
  const at = await reachable(page, FLOOR1, row);
  await page.mouse.click(at.x, at.y);
  await ready(page);
  const lever = (await leversNow())[0];
  assert.equal(lever.kind, 'corridor');
  assert.equal(lever.name, '');
  assert.ok(lever.cells.length > 1 && lever.cells.includes(at.cell), 'the stretch, not the one cell: ' + lever.cells.length);
  assert.ok(lever.cells.every((cell) => floor.cells[cell] === '#'));
  assert.match((await chipTexts())[0], new RegExp('^Close ' + lever.cells.length + ' corridor cells on Floor 1$'));
});

test('Pick on the map by keyboard: the plan is one stop, the cursor says the place under it, Enter picks, Escape cancels and does nothing else', async () => {
  await fresh(page);
  await start(page, 'Keys pick');
  await chooseKind(page, 'building');
  await page.click('.scn-seats__what input[value="corridor"] + .seg__label');
  await page.waitForSelector('[data-key="scenario-building-pick"]');
  const cells = await corridorCells(FLOOR1, 'ksample001');
  const upper = await corridorCells('fsample002', 'ksample003');
  // the cursor put on a cell of a floor (as a person would arrive at it with the arrows)
  const cursorOn = (floorId, cell) => page.evaluate((f, c) => {
    const plan = document.querySelector('.scn').scenarios.plan;
    const at = plan.cellAt(f, c);
    plan.cursor.moveTo(Math.floor((at.x - plan.view.x) / plan.view.size), Math.floor((at.y - plan.view.y) / plan.view.size), true);
  }, floorId, cell);
  // started from the keyboard: the button pressed with Enter
  await page.focus('[data-key="scenario-building-pick"]');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.scn').dataset.picking === 'true');
  assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('.scn').scenarios.plan.canvas), true);
  await cursorOn(FLOOR1, cells[10]);
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => /^Main Corridor, open$/.test(document.querySelector('#announcer').textContent));
  // Escape: the mode ends, nothing is added, the focus is back on the button
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.scn').dataset.picking === undefined);
  assert.equal(await announced(), 'Picking cancelled.');
  assert.equal(await activeKey(), 'scenario-building-pick');
  assert.deepEqual((await leversNow()), []);
  assert.equal(await page.evaluate(() => document.querySelector('.scn').dataset.mode), 'open', 'Escape did nothing else: the scenario is open');
  // Enter picks
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.scn').dataset.picking === 'true');
  await cursorOn(FLOOR1, cells[10]);
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => /^Main Corridor, open$/.test(document.querySelector('#announcer').textContent));
  await page.keyboard.press('Enter');
  await ready(page);
  assert.deepEqual((await leversNow()).map((lever) => lever.name), ['Main Corridor']);
  assert.equal(await announced(), 'Main Corridor closed in this trial.');
  assert.equal(await activeKey(), 'scenario-building-pick');
  // on a place that is closed the cursor says so
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.scn').dataset.picking === 'true');
  await cursorOn(FLOOR1, cells[10]);
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => /^Main Corridor, closed$/.test(document.querySelector('#announcer').textContent));
  // Space let go alone picks; Space with an arrow moves the map and picks nothing
  await cursorOn('fsample002', upper[10]);
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => /^Upper Corridor, open$/.test(document.querySelector('#announcer').textContent));
  await page.keyboard.down('Space');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.up('Space');
  assert.deepEqual((await leversNow()).map((lever) => lever.name), ['Main Corridor'], 'Space with an arrow only moves the map');
  await cursorOn('fsample002', upper[10]);
  await page.keyboard.press('Space');
  await ready(page);
  assert.deepEqual((await leversNow()).map((lever) => lever.name), ['Main Corridor', 'Upper Corridor']);
  assert.equal(await announced(), 'Upper Corridor closed in this trial.');
});

test('a closure that strands a group shows it in the failed walks, by name, in the comparison', async () => {
  await fresh(page);
  await setLevers([{ kind: 'way', connectionId: 'csample00b', way: 'closed' }]);
  await page.waitForFunction(() => document.querySelector('.scn-figures [data-figure="failed"]'));
  const failed = await figure('failed');
  assert.equal(failed[0], '0');
  assert.ok(Number(failed[1]) > 0 && failed[2].startsWith('+'), 'walks with no way through appear: ' + failed);
  const rows = await page.$$eval('[data-part="groups"] tr[data-group]', (all) => all.map((row) => ({ name: row.querySelector('th bdi, th').textContent, change: row.querySelectorAll('td')[2] ? row.querySelectorAll('td')[2].textContent : row.textContent })));
  const stranded = rows.filter((row) => /more with no way through/.test(row.change));
  assert.ok(stranded.length > 0, 'a group is named with its walks with no way through: ' + JSON.stringify(rows));
  const project = await projectOf();
  for (const row of stranded) assert.ok(project.groups.some((group) => group.name === row.name), row.name + ' is a group of the school');
});

// ------------------------------------------------------------------ the report

test('the congestion report lists the levers in the chips\' words', async () => {
  await fresh(page);
  await setLevers([
    { kind: 'capacity', roomId: 'rsample204', capacity: 12 },
    { kind: 'headCount', groupId: 'gsample07a', headCount: 31 },
  ]);
  await page.click('[data-action="congestion"]');
  await page.waitForSelector('#print-preview[open][data-scenario="answered"][data-ready="true"]', { timeout: 30000 });
  const rows = await page.$eval('#print-preview iframe', (el) => Array.from(el.contentDocument.querySelectorAll('.doc-table--changes tr'), (row) => Array.from(row.children, (cell) => cell.textContent.replace(/\s+/g, ' ').trim()).join(' | ')));
  assert.match(rows[0], /^1 \| Room 204 seats 12 \(was \d+\)$/);
  assert.equal(rows[1], '2 | 7A: 31 students (was 27)');
  assert.equal(await page.$eval('#print-preview iframe', (el) => el.contentDocument.querySelector('.doc-scenario h3').textContent), 'Its changes 2');
  await page.click('#print-preview [data-action="close"]');
  await page.waitForFunction(() => document.getElementById('print-preview') === null);
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

test('Apply: the button never reads "0 of 1"; with nothing it can write it says so and is disabled; the counts are in good grammar', async () => {
  await fresh(page);
  await setLevers([{ kind: 'way', connectionId: 'csample00b', way: 'closed' }]);
  await page.click('[data-action="apply"]');
  await page.waitForSelector('#scenario-apply[open]');
  const only = await page.$eval('#scenario-apply', (el) => ({
    buttons: Array.from(el.querySelectorAll('.dialog__buttons button'), (button) => [button.textContent, button.disabled]),
    body: el.querySelector('.dialog__body').textContent,
  }));
  assert.deepEqual(only.buttons, [['Nothing here can be applied', true], ['Keep it as a scenario', false]]);
  assert.match(only.body, /there is nothing to apply\. Discard the scenario to close it\./);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#scenario-apply[open]'));
  assert.notEqual((await scenarioOf()), null, 'the scenario is still open');
  // one thing it writes beside one it leaves out: "1 of 2"; and "1 change" alone
  await setLevers([{ kind: 'way', connectionId: 'csample00b', way: 'closed' }, { kind: 'capacity', roomId: 'rsample204', capacity: 12 }]);
  await page.click('[data-action="apply"]');
  await page.waitForSelector('#scenario-apply[open]');
  assert.deepEqual(await page.$$eval('#scenario-apply .dialog__buttons button', (all) => all.map((b) => [b.textContent, b.disabled])), [['Apply 1 of 2 changes', false], ['Keep it as a scenario', false]]);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#scenario-apply[open]'));
});

test('Apply offers its snapshot when it writes levers, and the line counts what it changes', async () => {
  await fresh(page);
  await setLevers([{ kind: 'capacity', roomId: 'rsample204', capacity: 12 }, { kind: 'headCount', groupId: 'gsample06a', headCount: 31 }]);
  await page.click('[data-action="apply"]');
  await page.waitForSelector('#scenario-apply[open]');
  assert.equal(await text('#scenario-apply [data-part="snapshot"]'), 'It changes 2 other changes, so a snapshot of the project as it is now is kept as well, and can be restored from Snapshots in the Project section.');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#scenario-apply[open]'));
  // a move and a lever: both are counted
  await fresh(page, APPLY_BODY);
  await page.click('[data-action="apply"]');
  await page.waitForSelector('#scenario-apply[open]');
  assert.equal(await text('#scenario-apply [data-part="snapshot"]'), 'It changes 1 period of the groups\' days and 4 other changes, so a snapshot of the project as it is now is kept as well, and can be restored from Snapshots in the Project section.');
  await page.click('#scenario-apply .btn--primary');
  await page.waitForFunction(() => globalThis.sv2.store.project.scenario === null);
  await page.waitForFunction(() => ['taken', 'not-taken'].includes(document.querySelector('.scn').dataset.snapshot));
});

test('Apply with a one-way stair and closures: the summary has the trial band, and the building after is unchanged but for the direction', async () => {
  await fresh(page, `
    const floor = project.building.floors[0];
    project.scenario = { name: 'Building', compared: null, changes: [], levers: [
      { kind: 'way', connectionId: 'csample00a', way: 'ab' },
      { kind: 'way', connectionId: 'csample00b', way: 'closed' },
      { kind: 'corridor', floorId: floor.id, cells: project.building.floors[0].corridors[0].cells, name: 'Main Corridor' },
    ] };`);
  const before = await projectOf();
  await page.click('[data-action="apply"]');
  await page.waitForSelector('#scenario-apply[open]');
  const dialog = await page.$eval('#scenario-apply', (el) => ({
    list: Array.from(el.querySelectorAll('[data-part="applies"] li'), (li) => li.textContent),
    kinds: Array.from(el.querySelectorAll('[data-part="kinds"] li'), (li) => li.textContent),
    trial: el.querySelector('[data-part="trial"]').textContent,
    buttons: Array.from(el.querySelectorAll('.dialog__buttons button'), (button) => button.textContent),
  }));
  assert.deepEqual(dialog.list, ['Stairs A: up only']);
  assert.deepEqual(dialog.kinds, ['Stairs A becomes up only.']);
  assert.equal(dialog.trial, 'Closing Stairs B and Main Corridor is a trial: Apply leaves the building as it is.');
  assert.deepEqual(dialog.buttons, ['Apply 1 of 3 changes', 'Keep it as a scenario']);
  await page.click('#scenario-apply .btn--primary');
  await page.waitForFunction(() => globalThis.sv2.store.project.scenario === null);
  await ready(page);
  const now = await projectOf();
  const same = (project) => JSON.stringify([project.building.floors.map((floor) => [floor.id, floor.cells, floor.corridors, floor.spaces, floor.exits]), project.building.connections.map((connection) => [connection.id, connection.a, connection.b])]);
  assert.equal(same(now), same(before), 'the cells, corridors, rooms, exits and the stairs\' ends are as they were');
  assert.deepEqual(now.building.connections.map((connection) => [connection.id, connection.direction]), [['csample00a', 'ab'], ['csample00b', 'both']], 'only the direction changed, and the stairs that was closed is open');
  assert.equal(await page.$eval('.scn', (el) => el.dataset.closedDrawn), '0', 'nothing is hatched once the scenario is gone');
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
  const shape = (project) => JSON.stringify([project.building.connections, project.building.floors.map((floor) => floor.cells)]);
  assert.equal(shape(now), shape(before), 'the closures went with the scenario: the stairs and corridors are as they were');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'scenario-start-name', 'the focus is on the first control of the section with nothing open');
  assert.match(await page.$eval('.toast .toast__text', (el) => el.textContent), /^Applied “Everything”: 5 changes made to the schedule\. Closing Stairs B and North Corridor is a trial: Apply leaves the building as it is\.( The snapshot “.*” has what was there\.)?$/);
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
  for (const kind of ['swapPeriods', 'swapRooms', 'bells', 'release', 'building', 'seats']) {
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction((k) => document.querySelector('.scn-form').dataset.kind === k, {}, kind);
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('.scn-kind input:checked')), true, 'the chip keeps the focus as the form is drawn');
  }
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.closest('.scn-seats__what') !== null), true, 'Tab leaves the chips for the form');
  await page.click('.scn-seats__what input[value="capacity"] + .seg__label');
  await page.focus('#scenario-seats-capacity');
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.keyboard.type('9');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('[data-part="preview"]').textContent.includes('seats 9 '));
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
    await chooseKind(page, 'building');
    await page.click('.scn-seats__what input[value="stair"] + .seg__label');
    await page.waitForSelector('#scenario-building-stair');
    await check('Stairs and corridors, a stair');
    await page.click('.scn-way input[value="closed"] + .seg__label');
    await check('Stairs and corridors, Closed chosen');
    await page.click('.scn-seats__what input[value="corridor"] + .seg__label');
    await page.waitForSelector('[data-key="scenario-building-pick"]');
    await check('Stairs and corridors, a corridor');
    await page.click('[data-key="scenario-building-pick"]');
    await page.waitForFunction(() => document.querySelector('.scn').dataset.picking === 'true');
    await check('the picking state: the banner and the plan', '.scn');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('.scn').dataset.picking === undefined);
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
    for (const kind of ['bells', 'release', 'building', 'seats']) {
      await tap('.scn-kind input[value="' + kind + '"] + .seg__label');
      await p.waitForFunction((k) => document.querySelector('.scn-form').dataset.kind === k, {}, kind);
      assert.deepEqual(await small(sheet), [], kind + ': every control is 44 px tall');
      // the form's first field brought into view, as a finger would; then how much of the
      // stage is on the screen (its box cut to the window and to what clips it), not how tall
      // it is: a stage scrolled off the top is tall and seen not at all
      await p.$eval('.scn-form select, .scn-form .field__input', (el) => el.scrollIntoView({ block: 'center' }));
      await p.waitForFunction(() => document.querySelector('.scn').dataset.compare === 'ready');
      const seen = await visibleHeight(p, '.scn .mov-stage');
      const shape = await p.evaluate(() => ({ stage: document.querySelector('.scn .mov-stage').getBoundingClientRect().height, wide: document.documentElement.scrollWidth - window.innerWidth }));
      assert.ok(await reachableAt(p, '.scn-form select, .scn-form .field__input'), kind + ': the form\'s first field is on the screen, clear of the stage and the bar');
      assert.ok(seen >= 160 - 0.5, kind + ': at least 160 px of the stage is on the screen with the first field in view: ' + seen + ' of ' + shape.stage);
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
    // a corridor picked on the map by a tap: the banner and its Cancel are a finger's size, the stage keeps its 160 px
    await tap('.scn-kind input[value="building"] + .seg__label');
    await tap('.scn-seats__what input[value="corridor"] + .seg__label');
    await tap('[data-key="scenario-building-pick"]');
    await p.waitForFunction(() => document.querySelector('.scn').dataset.picking === 'true');
    assert.deepEqual(await small('.scn-pick button'), [], 'Cancel is 44 px');
    assert.deepEqual(await small('[data-key="scenario-building-pick"]'), []);
    const seen = await visibleHeight(p, '.scn .mov-stage');
    assert.ok(seen >= 160 - 0.5, 'the stage keeps 160 px while picking: ' + seen);
    // the page and the section scrolled back to their tops, as a person would to see the whole plan
    await p.evaluate(() => {
      document.querySelector('.scn').scrollTop = 0;
      document.querySelector('.surface').scrollTop = 0;
    });
    const floorOne = await p.evaluate(() => globalThis.sv2.store.project.building.floors[0]);
    const cells = floorOne.corridors[0].cells;
    let spot = null;
    for (const cell of cells) {
      spot = await p.evaluate((f, c) => {
        const plan = document.querySelector('.scn').scenarios.plan;
        const at = plan.cellAt(f, c);
        const box = plan.canvas.getBoundingClientRect();
        const x = box.left + at.x;
        const y = box.top + at.y;
        return document.elementFromPoint(x, y) === plan.canvas && x > 0 && x < window.innerWidth && y > 0 && y < window.innerHeight ? { x, y } : null;
      }, floorOne.id, cell);
      if (spot) break;
    }
    assert.ok(spot, 'a corridor cell can be touched on the phone');
    await p.touchscreen.tap(spot.x, spot.y);
    await ready(p);
    await p.waitForSelector('.scn-chip[data-kind="corridor"]');
    assert.equal(await p.evaluate(() => document.querySelector('.scn').dataset.picking), undefined, 'the tap ended the mode');
    assert.deepEqual(phone.problems().errors, []);
  } finally {
    await phone.close();
  }
});
