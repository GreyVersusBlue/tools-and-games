// The scenario lab in a real browser (spec 9, 18 "run a scenario and apply
// it"; DESIGN 5.4): node test/browser/scenario.mjs
//
// Starting a scenario and naming it, each kind of change added by pointer and
// by keyboard, a chip taken out, a change that cancels itself, a change that
// no longer applies after its room is deleted and back after Undo, the
// comparison as the scenario lane gives it (and while the lane is working),
// Apply with its summary as one step of undo, Discard asking first, compare
// with another project file of the same building and refused for another
// building, the congestion report's button, the spec 18 journey, typed names
// shown as typed, and the bar at the section's foot with touch on a phone
// upright and on its side and at 1280 by 800.
//
// SV2-68b, the review's findings: a drawing that changes nothing the
// comparison is for asks the lane nothing; the focus after Apply, Discard
// and Undo from the message; an older answer after a newer one, a failed
// lane, the section leaving while the lane works, Redo after an Undone
// Apply; a group deleted under the lab; a scenario from a file then edited;
// the slots not compared kept to their own comparison and worked out after
// the question; a refused file said as an alert; Undo of a rename in a
// focused field; Apply with nothing that applies; the picker after a rename.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { openPlanner, go, launch, startServer, TOOL_DIR } from './harness.mjs';

const { sampleSchool } = await import(pathToFileURL(path.join(TOOL_DIR, 'data', 'sample-school.js')).href);
const { writeProjectFile } = await import(pathToFileURL(path.join(TOOL_DIR, 'engine', 'project-file.js')).href);

const SCRATCH = path.join(TOOL_DIR, 'test', '.scratch', 'scenario');
const HOSTILE = '<img src=x onerror="window.__hit=1">&amp; "Plan"';
const ARABIC = 'خطة الصباح';

let browser;
let server;
let wide;

before(async () => {
  fs.mkdirSync(SCRATCH, { recursive: true });
  server = await startServer();
  browser = await launch();
  wide = await openPlanner({ browser, server, width: 1280, height: 800, hash: '#scenarios', theme: 'light' });
});

after(async () => {
  if (wide) await wide.close();
  if (browser) await browser.close();
  if (server) await server.close();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});

// The section drawn for the project in the store, and the comparison settled
// (answered for the store as it is, or nothing open).
async function ready(page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('.scn');
    if (!el || el.dataset.styled !== 'true' || !el.scenarios) return false;
    if (el.dataset.mode === 'empty') return true;
    if (el.scenarios.plan.project !== globalThis.sv2.store.project) return false;
    if (el.dataset.mode === 'none') return el.dataset.compare === 'none';
    return el.dataset.compare === 'ready' && !el.scenarios.pending;
  }, { timeout: 30000 });
}

// The sample school as it loads, nothing open, on the Scenarios section.
async function fresh(page, change) {
  await page.evaluate(() => {
    for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  });
  // a message an earlier case left up goes, and the mouse leaves the page:
  // a message under a resting pointer holds its timer, and lies over the
  // panel's foot at this width
  await page.mouse.move(1, 1);
  const close = await page.$('.toast .toast__close');
  if (close) {
    await close.click();
    await page.waitForFunction(() => !document.querySelector('.toast'));
  }
  await page.evaluate(async (alter) => {
    const { sampleSchool } = await import('./data/sample-school.js');
    const project = sampleSchool();
    if (alter) new Function('project', alter)(project);
    globalThis.sv2.store.replace(project);
  }, change || null);
  await go(page, '#scenarios');
  await ready(page);
}

// A typed text read only from an element that is on screen.
async function seen(page, selector) {
  return page.$eval(selector, (el) => {
    if (el.getClientRects().length === 0) throw new Error(selector + ' has no box');
    return el.textContent;
  });
}

const chips = (page) => page.$$eval('.scn-chip', (items) => items.map((item) => ({ index: Number(item.dataset.index), kind: item.dataset.kind, text: item.querySelector('.scn-chip__words').textContent })));
const scenarioOf = (page) => page.evaluate(() => JSON.parse(JSON.stringify(globalThis.sv2.store.project.scenario)));
const slotRoom = (page, groupId, dayTypeId, period) => page.evaluate((g, d, p) => globalThis.sv2.store.project.groups.find((each) => each.id === g).days[d][p].room, groupId, dayTypeId, period);

async function start(page, name) {
  await page.click('#scenario-start-name');
  if (name) await page.keyboard.type(name);
  await page.click('[data-action="start"]');
  await page.waitForFunction(() => document.querySelector('.scn').dataset.mode === 'open');
  await ready(page);
  // the form's kind is the lab's memory for this project's id, which every
  // case here shares: each starts on the move form
  if (await page.$eval('.scn-form', (el) => el.dataset.kind) !== 'move') await chooseKind(page, 'move');
}

// A room picked from the move form's picker by pointer: the field, then the option.
async function pickRoom(page, label) {
  await page.click('.scn-field--room input');
  await page.waitForSelector('.scn-field--room .picker__list:not([hidden])');
  const clicked = await page.$$eval('.scn-field--room .picker__option', (items, wanted) => {
    const item = items.find((each) => each.textContent.startsWith(wanted));
    if (!item) return false;
    item.scrollIntoView({ block: 'nearest' });
    return true;
  }, label);
  assert.ok(clicked, 'the picker should offer ' + label);
  const handle = await page.evaluateHandle((wanted) => Array.from(document.querySelectorAll('.scn-field--room .picker__option')).find((each) => each.textContent.startsWith(wanted)), label);
  await handle.click();
}

async function addByPointer(page) {
  await page.click('.scn-add [data-action="add-change"]');
  await ready(page);
}

async function chooseKind(page, kind) {
  await page.click('.scn-add .seg input[value="' + kind + '"] + .seg__label');
  await page.waitForFunction((k) => document.querySelector('.scn-form').dataset.kind === k, {}, kind);
}

const A = 'dsample00a';
const B = 'dsample00b';

test('nothing open: the first line says so, and a scenario starts with a name typed in', async () => {
  const page = wide.page;
  await fresh(page);
  assert.match(await seen(page, '#scenario-line'), /No scenario is open/);
  assert.deepEqual(await page.$eval('.scn-bar', (el) => [el.dataset.open, el.getBoundingClientRect().height, el.querySelector('.scn-bar__buttons').hidden]), ['false', 0, true], 'no bar while nothing is staged');
  // with no bar, the zoom buttons and a message still stand at the stage's foot
  const low = await page.evaluate(() => {
    const stage = document.querySelector('.scn .mov-stage').getBoundingClientRect();
    const zoom = document.querySelector('.scn .mov-zoom').getBoundingClientRect();
    return { stage: stage.bottom, zoom: zoom.bottom };
  });
  assert.ok(low.stage - low.zoom < 40, 'the zoom buttons are at the stage’s foot: ' + JSON.stringify(low));
  assert.equal(await page.$eval('.scn-add', (el) => el.hidden), true, 'no forms before a scenario is open');
  assert.match(await seen(page, '.scn-compare'), /Start a scenario/);
  await start(page, 'Move the sevens');
  assert.equal((await scenarioOf(page)).name, 'Move the sevens');
  assert.match(await seen(page, '#scenario-line'), /Trying Move the sevens: no changes, not applied/);
  assert.equal(await seen(page, '.scn-bar__text'), 'Not applied yet: no changes');
  // the name field has the focus: the open scenario's first control
  assert.equal(await page.evaluate(() => document.activeElement.id), 'scenario-name');
});

test('the name is renamed by keyboard on Enter and on leaving the field, and Escape puts it back', async () => {
  const page = wide.page;
  await fresh(page);
  await start(page, '');
  assert.equal((await scenarioOf(page)).name, 'New scenario');
  await page.focus('#scenario-name');
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.keyboard.type('Second try');
  await page.keyboard.press('Escape');
  assert.equal(await page.$eval('#scenario-name', (el) => el.value), 'New scenario', 'Escape puts back the name the field held');
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.keyboard.type('Second try');
  await page.keyboard.press('Enter');
  await ready(page);
  assert.equal((await scenarioOf(page)).name, 'Second try');
  assert.match(await seen(page, '#scenario-line'), /Trying Second try/);
  // leaving the field commits too
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.keyboard.type('Third');
  await page.keyboard.press('Tab');
  await ready(page);
  assert.equal((await scenarioOf(page)).name, 'Third');
  // a blank name is the action's refusal, said, and the field goes back
  await page.click('#scenario-name', { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  assert.equal((await scenarioOf(page)).name, 'Third');
  assert.equal(await page.$eval('#scenario-name', (el) => el.value), 'Third');
  assert.match(await seen(page, '.scn-status'), /name/i);
});

test('hostile and non-Latin names are shown exactly as typed', async () => {
  const page = wide.page;
  await fresh(page, "project.groups[3].name = '<b>7A</b> & co'; project.groups[4].name = 'سابع ب';");
  await start(page, HOSTILE);
  assert.equal(await seen(page, '#scenario-line bdi'), HOSTILE);
  await page.select('#scenario-move-group', 'gsample07a');
  await pickRoom(page, 'Gym');
  await addByPointer(page);
  await chooseKind(page, 'swapRooms');
  await page.select('#scenario-rooms-a', 'gsample07b');
  await page.select('#scenario-rooms-b', 'gsample07c');
  await addByPointer(page);
  const shown = await chips(page);
  assert.ok(shown[0].text.startsWith('<b>7A</b> & co · A Day'), shown[0].text);
  assert.ok(shown[1].text.startsWith('سابع ب ↔ 7C'), shown[1].text);
  await page.focus('#scenario-name');
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.keyboard.type(ARABIC);
  await page.keyboard.press('Enter');
  await ready(page);
  assert.equal(await seen(page, '#scenario-line bdi'), ARABIC);
  assert.equal(await page.evaluate(() => window.__hit), undefined, 'no markup typed in a name ever ran');
  assert.equal(await page.$$eval('.scn img, .inspector img', (items) => items.length), 0);
  // the comparison's group rows carry the names as typed
  const names = await page.$$eval('.scn-groups tbody th bdi', (items) => items.map((item) => item.textContent));
  assert.ok(names.includes('<b>7A</b> & co'), names.join(' | '));
});

test('a move, a swap of periods and a swap of rooms are each added by pointer, each with its own words', async () => {
  const page = wide.page;
  await fresh(page);
  await start(page, 'Pointer');
  // a move: group, day type, period, then the room from the picker's list
  await page.select('#scenario-move-group', 'gsample07a');
  await page.select('#scenario-move-period', '2');
  assert.equal(await seen(page, '.scn-form__now'), 'Now: Library.');
  await pickRoom(page, '101');
  assert.match(await seen(page, '.scn-form__preview'), /^The change: 7A · A Day · Period 3: Library → 101, taught by Ms\. Halloran instead of Mr\. Pennywhistle$/);
  assert.equal(await page.$eval('.scn-form__follow', (el) => el.hidden), false, 'a move that changes who teaches says that teachers follow rooms');
  assert.match(await seen(page, '.scn-form__follow'), /Teachers follow rooms/);
  await addByPointer(page);
  // a swap of two of a group's periods
  await chooseKind(page, 'swapPeriods');
  await page.select('#scenario-periods-group', 'gsample06a');
  await page.select('#scenario-periods-day', B);
  await page.select('#scenario-periods-a', '0');
  await page.select('#scenario-periods-b', '3');
  await addByPointer(page);
  // a swap of two groups' rooms
  await chooseKind(page, 'swapRooms');
  await page.select('#scenario-rooms-a', 'gsample08a');
  await page.select('#scenario-rooms-b', 'gsample08b');
  await page.select('#scenario-rooms-period', '1');
  await addByPointer(page);
  const scenario = await scenarioOf(page);
  assert.deepEqual(scenario.changes, [
    { kind: 'move', dayTypeId: A, groupId: 'gsample07a', period: 2, roomId: 'rsample101' },
    { kind: 'swapPeriods', dayTypeId: B, groupId: 'gsample06a', periodA: 0, periodB: 3 },
    { kind: 'swapRooms', dayTypeId: A, groupA: 'gsample08a', groupB: 'gsample08b', period: 1 },
  ]);
  const shown = await chips(page);
  assert.deepEqual(shown.map((chip) => chip.kind), ['move', 'swapPeriods', 'swapRooms']);
  assert.equal(shown[1].text, '6A · B Day · Period 1 ↔ Period 4: 201 ↔ Cafeteria');
  assert.match(shown[2].text, /^8A ↔ 8B · A Day · Period 2: 202 ↔ 101/);
  assert.equal(await seen(page, '.scn-bar__text'), 'Not applied yet: 3 changes');
  assert.match(await seen(page, '.scn-status'), /^Added: 8A ↔ 8B/);
});

test('a move, a swap of periods and a swap of rooms are each added by keyboard', async () => {
  const page = wide.page;
  await fresh(page);
  await start(page, 'Keys');
  // the move form: the group by arrows from the first, the room typed and Enter, then Tab to the button
  await page.select('#scenario-move-group', 'gsample06a');
  await page.select('#scenario-move-period', '0');
  await page.focus('#scenario-move-group');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.$eval('#scenario-move-group', (el) => el.value), 'gsample06c');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'scenario-move-day');
  await page.keyboard.press('Tab');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.$eval('#scenario-move-period', (el) => el.value), '1');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.closest('.scn-field--room') !== null), true, 'Tab reaches the room picker');
  await page.keyboard.type('Gym');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'add-change');
  await page.keyboard.press('Enter');
  await ready(page);
  // the kind by arrow keys in the choice, then the swap of periods
  await page.focus('.scn-add .seg input:checked');
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.scn-form').dataset.kind === 'swapPeriods');
  assert.equal(await page.evaluate(() => document.activeElement.value), 'swapPeriods', 'the choice keeps the focus as the form is drawn again');
  // each form starts from its first choices (the lab keeps a form's fields for the project)
  await page.select('#scenario-periods-group', 'gsample06a');
  await page.select('#scenario-periods-day', A);
  await page.select('#scenario-periods-a', '0');
  await page.select('#scenario-periods-b', '1');
  await page.focus('#scenario-periods-b');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.focus('[data-action="add-change"]');
  await page.keyboard.press('Enter');
  await ready(page);
  // the swap of rooms
  await page.focus('.scn-add .seg input:checked');
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.scn-form').dataset.kind === 'swapRooms');
  await page.select('#scenario-rooms-a', 'gsample06a');
  await page.select('#scenario-rooms-b', 'gsample06b');
  await page.select('#scenario-rooms-day', A);
  await page.select('#scenario-rooms-period', '0');
  await page.focus('#scenario-rooms-b');
  await page.keyboard.press('ArrowDown');
  await page.focus('#scenario-rooms-period');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.focus('[data-action="add-change"]');
  await page.keyboard.press(' ');
  await ready(page);
  assert.deepEqual((await scenarioOf(page)).changes, [
    { kind: 'move', dayTypeId: A, groupId: 'gsample06c', period: 1, roomId: 'rsamplegym' },
    { kind: 'swapPeriods', dayTypeId: A, groupId: 'gsample06a', periodA: 0, periodB: 3 },
    { kind: 'swapRooms', dayTypeId: A, groupA: 'gsample06a', groupB: 'gsample06c', period: 2 },
  ]);
  // the same period twice is no swap: said under the form, nothing added
  await chooseKind(page, 'swapPeriods');
  await page.select('#scenario-periods-a', '2');
  await page.select('#scenario-periods-b', '2');
  await page.click('[data-action="add-change"]');
  assert.equal(await seen(page, '.scn-form__line'), 'Pick two different periods.');
  assert.equal((await scenarioOf(page)).changes.length, 3);
});

test('the day types offered are those that are their own copy, with the ones that follow them named', async () => {
  const page = wide.page;
  await fresh(page, "project.dayTypes[1].own = false; for (const group of project.groups) delete group.days.dsample00b;");
  await start(page, 'Days');
  const days = await page.$$eval('#scenario-move-day option', (items) => items.map((item) => [item.value, item.textContent]));
  assert.deepEqual(days, [[A, 'A Day (B Day is the same)']]);
});

test('× takes a chip out, and the focus goes to the chip now in its place', async () => {
  const page = wide.page;
  await fresh(page);
  await start(page, 'Chips');
  await page.evaluate(async () => {
    const { addScenarioChange } = await import('./engine/actions.js');
    const store = globalThis.sv2.store;
    store.apply(addScenarioChange, { change: { kind: 'move', dayTypeId: 'dsample00a', groupId: 'gsample07a', period: 2, roomId: 'rsample101' } });
    store.apply(addScenarioChange, { change: { kind: 'move', dayTypeId: 'dsample00a', groupId: 'gsample07b', period: 2, roomId: 'rsample103' } });
    store.apply(addScenarioChange, { change: { kind: 'move', dayTypeId: 'dsample00a', groupId: 'gsample07c', period: 2, roomId: 'rsample202' } });
  });
  await ready(page);
  assert.equal((await chips(page)).length, 3);
  const label = await page.$eval('.scn-chip[data-index="1"] [data-action="remove"]', (el) => el.getAttribute('aria-label'));
  assert.match(label, /^Remove: 7B · A Day · Period 3/);
  await page.click('.scn-chip[data-index="1"] [data-action="remove"]');
  await ready(page);
  const left = await scenarioOf(page);
  assert.deepEqual(left.changes.map((change) => change.groupId), ['gsample07a', 'gsample07c']);
  await page.waitForFunction(() => document.activeElement && document.activeElement.dataset.action === 'remove');
  assert.equal(await page.evaluate(() => document.activeElement.closest('.scn-chip').dataset.index), '1', 'the focus is on the chip now in its place');
  // the last one out leaves the focus on the panel's first control
  await page.keyboard.press('Enter');
  await ready(page);
  await page.waitForFunction(() => document.activeElement && document.activeElement.dataset.action === 'remove');
  await page.keyboard.press('Enter');
  await ready(page);
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'scenario-name');
  assert.match(await seen(page, '.scn-none'), /No changes yet/);
});

test('a change that puts the schedule back as it is takes itself out, and says so', async () => {
  const page = wide.page;
  await fresh(page);
  await start(page, 'Back again');
  await page.select('#scenario-move-group', 'gsample07a');
  await page.select('#scenario-move-period', '2');
  await pickRoom(page, '101');
  await addByPointer(page);
  assert.equal((await chips(page)).length, 1);
  // 7A's Period 3 back to the Library, where the schedule has it
  await pickRoom(page, 'Library');
  await addByPointer(page);
  assert.equal((await chips(page)).length, 0);
  assert.equal((await scenarioOf(page)).changes.length, 0);
  assert.equal(await seen(page, '.scn-status'), 'That puts the schedule back as it is: 7A · A Day · Period 3: Library → Library. Nothing is added, and 1 earlier change on the same slot is taken out.');
  // and on its own, with nothing before it
  await addByPointer(page);
  assert.equal(await seen(page, '.scn-status'), 'That puts the schedule back as it is: 7A · A Day · Period 3: Library → Library. Nothing is added.');
});

test('a change whose room is deleted no longer applies, is listed with why, and Undo brings it back', async () => {
  const page = wide.page;
  await fresh(page);
  await start(page, 'Dropped');
  await page.evaluate(async () => {
    const { addScenarioChange } = await import('./engine/actions.js');
    const store = globalThis.sv2.store;
    store.apply(addScenarioChange, { change: { kind: 'move', dayTypeId: 'dsample00a', groupId: 'gsample07a', period: 2, roomId: 'rsample101' } });
    store.apply(addScenarioChange, { change: { kind: 'swapPeriods', dayTypeId: 'dsample00a', groupId: 'gsample06a', periodA: 0, periodB: 3 } });
  });
  await ready(page);
  assert.equal(await page.$eval('.scn-dropped', (el) => el.hidden), true);
  await page.evaluate(async () => {
    const { deleteSpaces } = await import('./engine/actions.js');
    globalThis.sv2.store.apply(deleteSpaces, { spaceIds: ['rsample101'] });
  });
  await ready(page);
  assert.equal(await page.$eval('.scn-dropped', (el) => el.hidden), false);
  assert.equal(await seen(page, '.scn-dropped__item'), '7A · A Day · Period 3: Library → a room no longer in the building: the room it moves to is no longer in the building.');
  assert.deepEqual((await chips(page)).map((chip) => chip.kind), ['swapPeriods'], 'the chips are the changes that apply');
  assert.equal((await scenarioOf(page)).changes.length, 2, 'the scenario keeps the change: reconcile is a view');
  assert.equal(await seen(page, '.scn-bar__text'), 'Not applied yet: 1 change, 1 skipped');
  await page.evaluate(() => globalThis.sv2.store.undo());
  await ready(page);
  assert.equal(await page.$eval('.scn-dropped', (el) => el.hidden), true);
  assert.deepEqual((await chips(page)).map((chip) => chip.kind), ['move', 'swapPeriods']);
  // Remove them: the dropped changes leave the scenario for good
  await page.evaluate(async () => {
    const { deleteSpaces } = await import('./engine/actions.js');
    globalThis.sv2.store.apply(deleteSpaces, { spaceIds: ['rsample101'] });
  });
  await ready(page);
  await page.click('[data-action="remove-dropped"]');
  await ready(page);
  assert.deepEqual((await scenarioOf(page)).changes.map((change) => change.kind), ['swapPeriods']);
  assert.equal(await page.$eval('.scn-dropped', (el) => el.hidden), true);
});

test('SV2-72d 1: "Remove them" takes every change that no longer applies out as one step of undo, and one Undo brings them back', async () => {
  const page = wide.page;
  await fresh(page);
  await start(page, 'Two dropped');
  await page.evaluate(async () => {
    const { addScenarioChange } = await import('./engine/actions.js');
    const store = globalThis.sv2.store;
    store.apply(addScenarioChange, { change: { kind: 'move', dayTypeId: 'dsample00a', groupId: 'gsample07a', period: 2, roomId: 'rsample101' } });
    store.apply(addScenarioChange, { change: { kind: 'move', dayTypeId: 'dsample00a', groupId: 'gsample07a', period: 4, roomId: 'rsample101' } });
    store.apply(addScenarioChange, { change: { kind: 'swapPeriods', dayTypeId: 'dsample00a', groupId: 'gsample06a', periodA: 0, periodB: 3 } });
    const { deleteSpaces } = await import('./engine/actions.js');
    store.apply(deleteSpaces, { spaceIds: ['rsample101'] });
  });
  await ready(page);
  assert.equal(await page.$$eval('.scn-dropped__item', (items) => items.length), 2);
  assert.equal(await seen(page, '[data-action="remove-dropped"]'), 'Remove them');
  const entries = await page.evaluate(() => globalThis.sv2.store.history.past.length);
  await page.click('[data-action="remove-dropped"]');
  await ready(page);
  assert.deepEqual((await scenarioOf(page)).changes.map((change) => change.kind), ['swapPeriods']);
  assert.equal(await page.evaluate(() => globalThis.sv2.store.history.past.length), entries + 1, 'one step of undo for both');
  assert.equal(await page.evaluate(() => globalThis.sv2.store.undoLabel), 'Remove from scenario Two dropped: 2 changes');
  assert.equal(await seen(page, '.scn-status'), 'Removed 2 changes that no longer applied.');
  // one Undo: both are back, still listed as no longer applying (the room is still gone)
  await page.evaluate(() => globalThis.sv2.store.undo());
  await ready(page);
  assert.deepEqual((await scenarioOf(page)).changes.map((change) => change.kind), ['move', 'move', 'swapPeriods']);
  assert.equal(await page.$$eval('.scn-dropped__item', (items) => items.length), 2);
});

// How many lines a cell's own words take, its "better" or "worse" mark left
// out: the distinct tops of its text's line boxes. Read only from a cell
// that has a box.
const LINES = `(cell) => {
  if (cell.getClientRects().length === 0) throw new Error('a cell with no box');
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT, { acceptNode: (node) => (node.parentElement.closest('.scn-trend') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  const tops = new Set();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) if (rect.width > 0) tops.add(Math.round(rect.top));
  }
  return tops.size;
}`;

test('SV2-72d 3 (W3): in the inspector’s 320 px a time of an hour or more reads in hours, no figure breaks inside itself, and no label takes three lines', async () => {
  const page = wide.page;
  await fresh(page);
  await start(page, 'Hours');
  await page.evaluate(async () => {
    const { addScenarioChange } = await import('./engine/actions.js');
    const store = globalThis.sv2.store;
    store.apply(addScenarioChange, { change: { kind: 'move', dayTypeId: 'dsample00a', groupId: 'gsample07c', period: 1, roomId: 'rsample204' } });
    store.apply(addScenarioChange, { change: { kind: 'move', dayTypeId: 'dsample00a', groupId: 'gsample08a', period: 6, roomId: 'rsample101' } });
  });
  await ready(page);
  const width = await page.$eval('#inspector-body', (el) => Math.round(el.getBoundingClientRect().width));
  assert.ok(width <= 320, 'the inspector is its 320 px, ' + width);
  // the sample's walking over the day is 153 min 48 s before and 153 min after
  const walking = await page.$$eval('.scn-figures tr[data-figure="walking"] td', (cells) => cells.map((cell) => cell.childNodes[0].textContent));
  assert.deepEqual(walking, ['2\u00a0h\u00a034\u00a0min', '2\u00a0h\u00a033\u00a0min', '−1\u00a0min'], 'hours and minutes, and the difference that of the two as shown');
  const lines = await page.evaluate((source) => {
    const count = new Function('return ' + source)();
    const of = (selector) => Array.from(document.querySelectorAll(selector)).map((cell) => [cell.closest('tr').dataset.figure || cell.closest('tr').dataset.group, cell.textContent, count(cell)]);
    return { figures: of('.scn-figures td.num'), groups: of('.scn-groups td.num'), labels: of('.scn-figures tbody th'), tableWide: Math.round(document.querySelector('.scn-figures').getBoundingClientRect().right) <= Math.round(document.querySelector('#inspector-body').getBoundingClientRect().right) };
  }, LINES);
  assert.ok(lines.figures.length >= 24 && lines.groups.length >= 3, 'figures and groups shown');
  for (const [row, text, n] of lines.figures.concat(lines.groups)) {
    // a sentence ("1 walk more with no way through") may wrap; a figure never
    if (/[a-z]{4,}/i.test(text.replace(/better|worse|no change/g, ''))) continue;
    assert.equal(n, 1, row + ': "' + text + '" is on one line');
  }
  for (const [row, text, n] of lines.labels) assert.ok(n <= 2, row + ': "' + text + '" takes ' + n + ' lines');
  assert.ok(lines.tableWide, 'and the table stays inside the inspector');
});

test('the comparison is the scenario lane’s answer, figure by figure, edited groups marked in words', async () => {
  const page = wide.page;
  await fresh(page);
  await start(page, 'Compared');
  await page.evaluate(async () => {
    const { addScenarioChange } = await import('./engine/actions.js');
    const store = globalThis.sv2.store;
    store.apply(addScenarioChange, { change: { kind: 'move', dayTypeId: 'dsample00a', groupId: 'gsample07a', period: 2, roomId: 'rsample101' } });
    store.apply(addScenarioChange, { change: { kind: 'swapPeriods', dayTypeId: 'dsample00a', groupId: 'gsample06a', periodA: 0, periodB: 3 } });
    store.apply(addScenarioChange, { change: { kind: 'move', dayTypeId: 'dsample00a', groupId: 'gsample08a', period: 5, roomId: 'rsamplelib' } });
  });
  await ready(page);
  const found = await page.evaluate(async () => {
    const { figureRows, groupRows } = await import('./ui/scenarios/model.js');
    const answer = await globalThis.sv2.store.derived.scenario({ dayTypeId: null, transition: null });
    const project = globalThis.sv2.store.project;
    const rows = figureRows(answer.compare).map((row) => [row.id, row.label, row.before, row.after, row.difference + (row.worse === null ? '' : row.worse ? 'worse' : 'better')]);
    const shown = Array.from(document.querySelectorAll('.scn-figures tbody tr')).map((tr) => [tr.dataset.figure, ...Array.from(tr.children).map((cell) => cell.textContent)]);
    const groups = groupRows(project, answer.compare).rows.map((row) => [row.groupId, String(row.edited)]);
    const shownGroups = Array.from(document.querySelectorAll('.scn-groups tbody tr')).map((tr) => [tr.dataset.group, tr.dataset.edited]);
    const tags = Array.from(document.querySelectorAll('.scn-groups tbody tr[data-edited="true"] .scn-tag')).map((tag) => tag.textContent);
    const edited = Array.from(document.querySelectorAll('.scn-groups tbody tr[data-edited="true"]')).length;
    return {
      rows,
      shown,
      groups,
      shownGroups,
      tags,
      edited,
      busier: answer.compare.places.busier.map((row) => row.placeId),
      shownBusier: Array.from(document.querySelectorAll('[data-part="busier"] li')).map((li) => li.dataset.place),
      quieter: answer.compare.places.quieter.map((row) => row.placeId),
      shownQuieter: Array.from(document.querySelectorAll('[data-part="quieter"] li')).map((li) => li.dataset.place),
      fresh: answer.compare.findings.new.map((finding) => finding.id),
      shownNew: Array.from(document.querySelectorAll('[data-part="new"] li')).map((li) => li.dataset.finding),
      resolved: answer.compare.findings.resolved.map((finding) => finding.id),
      shownResolved: Array.from(document.querySelectorAll('[data-part="resolved"] li')).map((li) => li.dataset.finding),
      unchanged: answer.compare.findings.unchanged.length,
      unchangedLabel: document.querySelector('[data-part="unchanged"] summary').textContent,
    };
  });
  assert.equal(found.shown.length, 8, 'eight figures: walking, crowding, busiest, late, failed walks, and findings by severity');
  assert.deepEqual(found.shown, found.rows.map(([id, label, a, b, d]) => [id, label, a, b, d]));
  assert.deepEqual(found.shownGroups, found.groups);
  assert.equal(found.edited, 3, 'each edited group is in the table, its time changed or not');
  assert.deepEqual(found.tags, new Array(found.edited).fill('edited'), 'every edited row says so in words');
  assert.deepEqual(found.shownBusier, found.busier);
  assert.deepEqual(found.shownQuieter, found.quieter);
  assert.ok(found.busier.length + found.quieter.length > 0, 'the changes move load somewhere');
  assert.deepEqual(found.shownNew, found.fresh);
  assert.deepEqual(found.shownResolved, found.resolved);
  assert.equal(found.unchangedLabel, 'Unchanged (' + found.unchanged + ')');
  // one day type and one transition are asked of the lane in turn
  await page.select('#scenario-compare-day', B);
  await ready(page);
  const day = await page.evaluate(() => document.querySelector('.scn').scenarios.compare.dayTypeId);
  assert.equal(day, B);
  await page.select('#scenario-compare-day', '');
  await page.select('#scenario-compare-when', '1');
  await ready(page);
  assert.equal(await seen(page, '#scenario-places-title'), 'Places that change most in this transition');
  await page.select('#scenario-compare-when', '');
  await ready(page);
});

test('while the lane is working the inspector says so and keeps the last answer, marked as old', async () => {
  const page = wide.page;
  await fresh(page);
  await start(page, 'Waiting');
  await page.evaluate(async () => {
    const { addScenarioChange } = await import('./engine/actions.js');
    globalThis.sv2.store.apply(addScenarioChange, { change: { kind: 'move', dayTypeId: 'dsample00a', groupId: 'gsample07a', period: 2, roomId: 'rsample101' } });
  });
  await ready(page);
  const before = await page.$eval('.scn-figures', (el) => el.textContent);
  // the lane held back: the next asking does not settle until released
  await page.evaluate(async () => {
    const derived = globalThis.sv2.store.derived;
    const real = derived.scenario;
    globalThis.__lane = { real, release: null };
    derived.scenario = (options) => new Promise((resolve) => {
      globalThis.__lane.release = () => resolve(real.call(derived, options));
    });
    const { addScenarioChange } = await import('./engine/actions.js');
    globalThis.sv2.store.apply(addScenarioChange, { change: { kind: 'move', dayTypeId: 'dsample00a', groupId: 'gsample07b', period: 2, roomId: 'rsample103' } });
  });
  await page.waitForFunction(() => document.querySelector('.scn-compare').dataset.state === 'old');
  assert.equal(await seen(page, '.scn-compare__status'), 'Working out the comparison again. The figures below are from before your last change.');
  assert.equal(await page.$eval('.scn-figures', (el) => el.textContent), before, 'the last answer stays up');
  assert.equal(await page.$eval('.scn', (el) => el.dataset.compare), 'pending');
  await page.evaluate(() => {
    globalThis.sv2.store.derived.scenario = globalThis.__lane.real;
    globalThis.__lane.release();
  });
  await ready(page);
  assert.equal(await page.$eval('.scn-compare', (el) => el.dataset.state), 'ready');
  assert.equal(await page.$eval('.scn-compare__status', (el) => el.textContent), '');
  // with no scenario the lane answers null, and the panel says what it is for
  await page.evaluate(async () => {
    const { discardScenario } = await import('./engine/actions.js');
    globalThis.sv2.store.apply(discardScenario, {});
  });
  await ready(page);
  assert.equal(await page.evaluate(() => globalThis.sv2.store.derived.scenario({})), null);
  assert.match(await seen(page, '.scn-compare__body'), /Start a scenario, and this compares it/);
});

test('Apply… shows what will change and what is skipped, applies as one step, and one Undo brings back both', async () => {
  const page = wide.page;
  await fresh(page);
  await start(page, 'To apply');
  await page.evaluate(async () => {
    const { addScenarioChange } = await import('./engine/actions.js');
    const store = globalThis.sv2.store;
    store.apply(addScenarioChange, { change: { kind: 'move', dayTypeId: 'dsample00a', groupId: 'gsample07a', period: 2, roomId: 'rsample101' } });
    store.apply(addScenarioChange, { change: { kind: 'swapPeriods', dayTypeId: 'dsample00b', groupId: 'gsample06a', periodA: 0, periodB: 3 } });
    store.apply(addScenarioChange, { change: { kind: 'move', dayTypeId: 'dsample00a', groupId: 'gsample08b', period: 3, roomId: 'rsample102' } });
  });
  await ready(page);
  // the third no longer applies once its room is gone
  await page.evaluate(async () => {
    const { deleteSpaces } = await import('./engine/actions.js');
    globalThis.sv2.store.apply(deleteSpaces, { spaceIds: ['rsample102'] });
  });
  await ready(page);
  const scenarioBefore = await scenarioOf(page);
  const pastBefore = await page.evaluate(() => globalThis.sv2.store.history.past.length);
  const slots = { a: await slotRoom(page, 'gsample07a', A, 2), b0: await slotRoom(page, 'gsample06a', B, 0), b3: await slotRoom(page, 'gsample06a', B, 3) };
  await page.click('[data-action="apply"]');
  await page.waitForSelector('#scenario-apply[open]');
  const summary = await page.evaluate(() => {
    const dialog = document.getElementById('scenario-apply');
    return {
      title: dialog.querySelector('.dialog__title').textContent,
      applies: Array.from(dialog.querySelectorAll('[data-part="applies"] li')).map((li) => li.textContent),
      skipped: Array.from(dialog.querySelectorAll('[data-part="skipped"] li')).map((li) => li.textContent),
      buttons: Array.from(dialog.querySelectorAll('.dialog__buttons button')).map((button) => button.textContent),
      focused: document.activeElement.textContent,
      text: dialog.textContent,
    };
  });
  assert.equal(summary.title, 'Apply the scenario “To apply”?');
  assert.deepEqual(summary.applies, (await chips(page)).map((chip) => chip.text));
  assert.equal(summary.applies.length, 2);
  assert.equal(summary.skipped.length, 1);
  assert.match(summary.skipped[0], /^8B · A Day · Period 4: 203 → a room no longer in the building: /);
  assert.match(summary.text, /Teachers follow rooms/);
  assert.deepEqual(summary.buttons, ['Apply 2 changes', 'Keep it as a scenario']);
  assert.equal(summary.focused, 'Keep it as a scenario', 'the safe button has the focus');
  // keeping it changes nothing
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#scenario-apply[open]'));
  assert.deepEqual(await scenarioOf(page), scenarioBefore);
  await page.click('[data-action="apply"]');
  await page.waitForSelector('#scenario-apply[open]');
  await page.click('#scenario-apply .btn--primary');
  await ready(page);
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.scenario), null);
  assert.equal(await slotRoom(page, 'gsample07a', A, 2), 'rsample101');
  assert.equal(await slotRoom(page, 'gsample06a', B, 0), slots.b3);
  assert.equal(await slotRoom(page, 'gsample06a', B, 3), slots.b0);
  assert.equal(await page.evaluate(() => globalThis.sv2.store.history.past.length), pastBefore + 1, 'one entry of undo');
  assert.equal(await page.evaluate(() => globalThis.sv2.store.history.past.at(-1).label), 'Apply scenario To apply: 2 changes');
  assert.match(await seen(page, '#scenario-line'), /No scenario is open/);
  await page.waitForFunction(() => /Applied “To apply”: 2 changes made to the schedule\./.test(document.querySelector('.toasts').textContent));
  // one Undo: the schedule and the scenario back together
  await page.evaluate(() => globalThis.sv2.store.undo());
  await ready(page);
  assert.deepEqual(await scenarioOf(page), scenarioBefore);
  assert.equal(await slotRoom(page, 'gsample07a', A, 2), slots.a);
  assert.equal(await slotRoom(page, 'gsample06a', B, 0), slots.b0);
  assert.equal(await slotRoom(page, 'gsample06a', B, 3), slots.b3);
  assert.equal(await page.$eval('.scn', (el) => el.dataset.mode), 'open');
});

test('Discard… asks first; keeping it changes nothing, discarding closes it, and Undo brings it back', async () => {
  const page = wide.page;
  await fresh(page);
  await start(page, 'To discard');
  await page.evaluate(async () => {
    const { addScenarioChange } = await import('./engine/actions.js');
    globalThis.sv2.store.apply(addScenarioChange, { change: { kind: 'move', dayTypeId: 'dsample00a', groupId: 'gsample07a', period: 2, roomId: 'rsample101' } });
  });
  await ready(page);
  const kept = await scenarioOf(page);
  await page.click('[data-action="discard"]');
  await page.waitForSelector('dialog[open]');
  const asked = await page.evaluate(() => {
    const dialog = document.querySelector('dialog[open]');
    return { title: dialog.querySelector('.dialog__title').textContent, buttons: Array.from(dialog.querySelectorAll('.dialog__buttons button')).map((button) => button.textContent), focused: document.activeElement.textContent };
  });
  assert.equal(asked.title, 'Discard the scenario “To discard”?');
  assert.deepEqual(asked.buttons, ['Discard the scenario', 'Keep the scenario']);
  assert.equal(asked.focused, 'Keep the scenario');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));
  assert.deepEqual(await scenarioOf(page), kept, 'Keep the scenario keeps it');
  await page.click('[data-action="discard"]');
  await page.waitForSelector('dialog[open]');
  await page.click('dialog[open] .btn--danger');
  await ready(page);
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.scenario), null);
  assert.equal(await page.evaluate(() => globalThis.sv2.store.history.past.at(-1).label), 'Discard scenario To discard');
  await page.evaluate(() => globalThis.sv2.store.undo());
  await ready(page);
  assert.deepEqual(await scenarioOf(page), kept);
});

// A project file of the sample school with some differences, written here.
function writeFile(name, alter) {
  const project = sampleSchool();
  alter(project);
  const file = path.join(SCRATCH, name);
  fs.writeFileSync(file, writeProjectFile(project));
  return file;
}

test('compare with another project file of the same building: its differences become the scenario', async () => {
  const page = wide.page;
  await fresh(page);
  const file = writeFile('next-year.json', (project) => {
    const a7 = project.groups.find((group) => group.id === 'gsample07a');
    a7.days.dsample00a[2] = { ...a7.days.dsample00a[2], room: 'rsample101' };
    project.groups.find((group) => group.id === 'gsample08b').name = '8B next year';
  });
  const input = await page.$('input[data-file="compare"]');
  await input.uploadFile(file);
  await page.waitForFunction(() => /^Compared with/.test(document.querySelector('.scn-file__result').textContent));
  await ready(page);
  const scenario = await scenarioOf(page);
  assert.deepEqual(scenario.changes, [{ kind: 'move', dayTypeId: A, groupId: 'gsample07a', period: 2, roomId: 'rsample101' }]);
  assert.deepEqual(scenario.compared, { fileName: 'next-year.json', addedGroups: ['8B next year'], removedGroups: ['8B'] });
  assert.equal(await seen(page, '.scn-file__result'), 'Compared with “next-year.json”: 1 change.');
  assert.equal(await seen(page, '.scn-file__groups'), 'From next-year.json. Added there (only in that file): 8B next year. Removed there (only in this project): 8B.');
  assert.match((await chips(page))[0].text, /^7A · A Day · Period 3: Library → 101/);
  // a second file over an open scenario asks first; keeping it changes nothing
  const kept = await scenarioOf(page);
  await input.uploadFile(file);
  await page.waitForSelector('dialog[open]');
  assert.match(await page.$eval('dialog[open] .dialog__title', (el) => el.textContent), /^Replace the scenario “Compare with next-year.json”|^Replace the scenario/);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => /was read and not compared/.test(document.querySelector('.scn-file__result').textContent));
  assert.deepEqual(await scenarioOf(page), kept);
});

test('compare with a file of another building is refused with the count of rooms that differ, and nothing changes', async () => {
  const page = wide.page;
  await fresh(page);
  const file = writeFile('other-building.json', (project) => {
    const floor = project.building.floors[0];
    floor.spaces.find((space) => space.id === 'rsample101').number = '101A';
  });
  const input = await page.$('input[data-file="compare"]');
  await input.uploadFile(file);
  await page.waitForFunction(() => /was not compared/.test(document.querySelector('.scn-file__result').textContent));
  assert.equal(await seen(page, '.scn-file__result'), '“other-building.json” was not compared, and nothing has changed. This file describes a different building: 1 room is missing and 1 is added.');
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.scenario), null);
  // and a file that is no project at all
  const junk = path.join(SCRATCH, 'junk.json');
  fs.writeFileSync(junk, '{"hello": 1}');
  await input.uploadFile(junk);
  await page.waitForFunction(() => /junk\.json” was not compared/.test(document.querySelector('.scn-file__result').textContent));
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.scenario), null);
});

test('the congestion report’s button opens the print preview of the congestion report, with its scenario section', async () => {
  const page = wide.page;
  await fresh(page);
  await start(page, 'Printed');
  await page.evaluate(async () => {
    const { addScenarioChange } = await import('./engine/actions.js');
    globalThis.sv2.store.apply(addScenarioChange, { change: { kind: 'move', dayTypeId: 'dsample00a', groupId: 'gsample07a', period: 2, roomId: 'rsample101' } });
  });
  await ready(page);
  const chip = (await chips(page))[0].text;
  await page.click('[data-action="congestion"]');
  // the preview asks the scenario lane itself (SV2-71) and lays the report
  // out again with its answer: data-scenario goes 'asked', then 'answered'
  await page.waitForSelector('#print-preview[open][data-ready="true"][data-scenario="answered"]', { timeout: 30000 });
  const doc = await page.evaluate(() => {
    const frame = document.querySelector('#print-preview iframe').contentDocument;
    const section = frame.querySelector('.doc-scenario');
    return { output: frame.documentElement.dataset.output, section: section ? section.textContent : null };
  });
  assert.equal(doc.output, 'congestion');
  assert.ok(doc.section !== null, 'the report has its scenario section');
  // the section names the change, in the chip's words (SV2-71)
  assert.ok(doc.section.includes(chip), 'the report names the lab’s change: ' + doc.section);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#print-preview[open]'));
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'congestion', 'the focus comes back to the button');
});

test('spec 18 journey: run a scenario and apply it, by the screen alone', async () => {
  const page = wide.page;
  await fresh(page);
  // from the rail, as a counsellor would
  await go(page, '#movement');
  await page.click('.rail a[href="#scenarios"]');
  await ready(page);
  await page.click('#scenario-start-name');
  await page.keyboard.type('Library swap');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.scn').dataset.mode === 'open');
  await ready(page);
  // 8A's long walk out of the Gym in Period 6: try the Library instead
  await page.select('#scenario-move-group', 'gsample08a');
  await page.select('#scenario-move-period', '5');
  assert.equal(await seen(page, '.scn-form__now'), 'Now: Gym.');
  await pickRoom(page, 'Library');
  await addByPointer(page);
  assert.equal((await chips(page)).length, 1);
  // the comparison is there before anything is applied
  const walking = await page.$eval('.scn-figures tr[data-figure="walking"]', (tr) => tr.textContent);
  assert.match(walking, /^Total walking time/);
  assert.equal(await page.$eval('.scn-groups tbody tr[data-group="gsample08a"]', (tr) => tr.dataset.edited), 'true');
  assert.equal(await slotRoom(page, 'gsample08a', A, 5), 'rsamplegym', 'nothing applied yet');
  await page.click('[data-action="apply"]');
  await page.waitForSelector('#scenario-apply[open]');
  await page.click('#scenario-apply .btn--primary');
  await ready(page);
  assert.equal(await slotRoom(page, 'gsample08a', A, 5), 'rsamplelib');
  // the schedule shows it: the group's slot reads the Library
  await go(page, '#schedule/groups/gsample08a/dsample00a/5');
  await page.waitForFunction(() => {
    const field = document.activeElement;
    return field && field.matches('input[role="combobox"]') && /^Library/.test(field.value);
  }, { timeout: 15000 });
  await go(page, '#scenarios');
  await ready(page);
});

test('the stage keeps its least, the bar sticks at the section’s foot and a message lies above it at 1280 by 800', async () => {
  const page = wide.page;
  await fresh(page);
  await start(page, 'Bar');
  const box = await page.evaluate(() => {
    const bar = document.querySelector('.scn-bar').getBoundingClientRect();
    const root = document.querySelector('.scn').getBoundingClientRect();
    const stage = document.querySelector('.scn .mov-stage').getBoundingClientRect();
    const panel = document.querySelector('.scn-panel').getBoundingClientRect();
    return { bar: { top: bar.top, bottom: bar.bottom }, root: { bottom: root.bottom }, stage: { height: stage.height, left: stage.left }, panel: { right: panel.right } };
  });
  assert.ok(Math.abs(box.bar.bottom - box.root.bottom) <= 1, 'the bar is at the section’s foot: ' + JSON.stringify(box));
  assert.ok(box.stage.height >= 320, 'the stage keeps 320 px at the least here: ' + box.stage.height);
  assert.ok(box.panel.right <= box.stage.left + 1, 'the panel stands beside the map at this width');
  // a message lies above the bar
  await page.evaluate(() => globalThis.sv2.ctx.toast({ text: 'A message' }));
  await page.waitForFunction(() => document.querySelector('.toast'));
  const toast = await page.evaluate(() => document.querySelector('.toast').getBoundingClientRect().bottom);
  assert.ok(toast <= box.bar.top + 1, 'the message lies above the bar: ' + toast + ' over ' + box.bar.top);
});

test('SV2-72d 4: from 1200 px a message starts right of the lab’s panel, never over its forms, and the surface keeps no left edge once the lab is left', async () => {
  const page = wide.page;
  await fresh(page);
  await start(page, 'Message');
  await page.evaluate(() => globalThis.sv2.ctx.toast({ text: 'A message from the lab' }));
  await page.waitForFunction(() => {
    const toast = document.querySelector('.toast');
    return toast && toast.getClientRects().length > 0 && toast.getAnimations().every((each) => each.playState !== 'running');
  });
  const box = await page.evaluate(() => ({
    toast: document.querySelector('.toast').getBoundingClientRect().toJSON(),
    panel: document.querySelector('.scn-panel').getBoundingClientRect().toJSON(),
    stage: document.querySelector('.scn .mov-stage').getBoundingClientRect().toJSON(),
  }));
  assert.ok(box.panel.right <= box.stage.left + 1, 'the panel stands beside the map at 1280');
  assert.ok(box.toast.left >= box.panel.right, 'the message starts right of the panel: ' + box.toast.left + ' against ' + box.panel.right);
  assert.ok(box.toast.left - box.panel.right <= 24, 'and beside it, at the usual gap: ' + (box.toast.left - box.panel.right));
  await page.click('.toast .toast__close');
  await page.waitForFunction(() => !document.querySelector('.toast'));
  await go(page, '#schedule/groups');
  assert.equal(await page.$eval('#surface', (el) => el.style.getPropertyValue('--toast-left')), '', 'Schedule’s messages keep the usual left edge');
  await go(page, '#scenarios');
  await ready(page);
});

// A phone, with touch: the panel under the map, the bar sticky at the foot
// however far the section is scrolled, and a change added and applied by taps.
for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test('with touch at ' + size.width + ' by ' + size.height + ': taps add and apply a change, the bar stays at the foot', async () => {
    // a browser of its own: a second planner page in the wide one's browser
    // would be a follower tab, which changes nothing (ARCHITECTURE 16, SV2-38)
    const phone = await openPlanner({ server, width: size.width, height: size.height, mobile: true, hash: '#scenarios', theme: 'light' });
    try {
      const page = phone.page;
      assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), true, 'the page is touched, not clicked');
      await fresh(page);
      await page.tap('#scenario-start-name');
      await page.keyboard.type('Phone');
      await page.tap('[data-action="start"]');
      await page.waitForFunction(() => document.querySelector('.scn').dataset.mode === 'open');
      await ready(page);
      const order = await page.evaluate(() => {
        const stage = document.querySelector('.scn .mov-stage').getBoundingClientRect();
        const panel = document.querySelector('.scn-panel').getBoundingClientRect();
        return { stage: stage.top, panel: panel.top, height: stage.height };
      });
      assert.ok(order.panel > order.stage, 'the map comes first, the panel under it');
      await page.select('#scenario-move-group', 'gsample07a');
      await page.select('#scenario-move-period', '2');
      await page.tap('.scn-field--room input');
      await page.waitForSelector('.scn-field--room .picker__list:not([hidden])');
      const option = await page.evaluateHandle(() => Array.from(document.querySelectorAll('.scn-field--room .picker__option')).find((each) => each.textContent.startsWith('101')));
      await option.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await option.tap();
      await page.tap('[data-action="add-change"]');
      await ready(page);
      assert.equal((await chips(page)).length, 1);
      // the bar at the foot, scrolled to the top and to the end
      for (const where of ['top', 'end']) {
        const placed = await page.evaluate((at) => {
          const root = document.querySelector('.scn');
          root.scrollTop = at === 'top' ? 0 : root.scrollHeight;
          const bar = document.querySelector('.scn-bar').getBoundingClientRect();
          const box = root.getBoundingClientRect();
          return { bar: bar.bottom, root: box.bottom, height: bar.height, buttons: Array.from(document.querySelectorAll('.scn-bar .btn')).map((button) => button.getBoundingClientRect().height) };
        }, where);
        assert.ok(Math.abs(placed.bar - placed.root) <= 1, 'the bar sits at the foot scrolled to the ' + where + ': ' + JSON.stringify(placed));
        assert.ok(placed.buttons.every((height) => height >= 44), 'a finger’s targets: ' + placed.buttons.join(', '));
      }
      // the stage keeps its room (the plan map's --mov-room, never under its
      // least), and a message lies above the bar
      const stage = await page.evaluate(() => {
        const root = document.querySelector('.scn');
        const room = parseFloat(root.style.getPropertyValue('--mov-room'));
        const floor = Math.min(Math.max(0.45 * innerHeight, 320), room);
        return { height: document.querySelector('.scn .mov-stage').getBoundingClientRect().height, floor, room };
      });
      assert.ok(stage.room > 0 && stage.height >= stage.floor - 1, 'the stage keeps its room: ' + JSON.stringify(stage));
      await page.evaluate(() => {
        document.querySelector('.scn').scrollTop = 0;
        globalThis.sv2.ctx.toast({ text: 'A message' });
      });
      await page.waitForFunction(() => document.querySelector('.toast'));
      const lies = await page.evaluate(() => ({ toast: document.querySelector('.toast').getBoundingClientRect().bottom, bar: document.querySelector('.scn-bar').getBoundingClientRect().top }));
      assert.ok(lies.toast <= lies.bar + 1, 'the message lies above the bar: ' + JSON.stringify(lies));
      // chips' × are a finger's size too
      const remove = await page.$eval('.scn-chip__remove', (el) => {
        const box = el.getBoundingClientRect();
        return { width: box.width, height: box.height };
      });
      assert.ok(remove.width >= 44 && remove.height >= 44);
      await page.tap('[data-action="apply"]');
      await page.waitForSelector('#scenario-apply[open]');
      await page.tap('#scenario-apply .btn--primary');
      await ready(page);
      assert.equal(await slotRoom(page, 'gsample07a', A, 2), 'rsample101');
      assert.equal(await page.evaluate(() => globalThis.sv2.store.project.scenario), null);
      assert.deepEqual(phone.problems().errors, []);
    } finally {
      await phone.close();
    }
  });
}

// ---- SV2-68b: the review's findings

const addChange = (page, change) => page.evaluate(async (c) => {
  const { addScenarioChange } = await import('./engine/actions.js');
  globalThis.sv2.store.apply(addScenarioChange, { change: c });
}, change);

const MOVE_7A = { kind: 'move', dayTypeId: 'dsample00a', groupId: 'gsample07a', period: 2, roomId: 'rsample101' };
const MOVE_7B = { kind: 'move', dayTypeId: 'dsample00a', groupId: 'gsample07b', period: 2, roomId: 'rsample103' };

// The lane held: each asking waits in globalThis.__held.calls until a case
// settles it; restoreLane() puts the real one back.
async function holdLane(page) {
  await page.evaluate(() => {
    const derived = globalThis.sv2.store.derived;
    const real = derived.scenario;
    globalThis.__held = { real, calls: [] };
    derived.scenario = (options) => {
      const call = { options };
      call.promise = new Promise((resolve, reject) => {
        call.resolve = resolve;
        call.reject = reject;
      });
      globalThis.__held.calls.push(call);
      return call.promise;
    };
  });
}

async function restoreLane(page) {
  await page.evaluate(() => {
    if (globalThis.__held) globalThis.sv2.store.derived.scenario = globalThis.__held.real;
  });
}

// Settle held asking `i` with the real lane's answer for its options; returns
// once the section's own handler of it has run.
async function answerHeld(page, i, name) {
  await page.evaluate(async (at, key) => {
    const held = globalThis.__held;
    const call = held.calls.at(at);
    const answer = await held.real.call(globalThis.sv2.store.derived, call.options);
    globalThis[key] = answer;
    call.resolve(answer);
    // the section's handler was added first, so it has run once this resumes
    await call.promise;
  }, i, name);
}

// Where the focus is just after each store change has been drawn and the
// code that made it has finished (a microtask after the change).
async function watchFocus(page) {
  await page.evaluate(() => {
    if (globalThis.__focusOff) globalThis.__focusOff();
    globalThis.__focus = [];
    globalThis.__focusOff = globalThis.sv2.store.subscribe(() => queueMicrotask(() => {
      const el = document.activeElement;
      globalThis.__focus.push({ id: el.id, tag: el.tagName, action: (el.dataset && el.dataset.action) || null, shown: el !== document.body && el.getClientRects().length > 0 });
    }));
  });
}

async function focusSeen(page) {
  return page.evaluate(() => {
    const seen = globalThis.__focus;
    globalThis.__focus = [];
    return seen;
  });
}

async function unwatchFocus(page) {
  await page.evaluate(() => {
    if (globalThis.__focusOff) globalThis.__focusOff();
    globalThis.__focusOff = null;
  });
}

test('SV2-68b 1: the floors row, the theme and a change elsewhere ask the lane nothing; a change of the scenario still asks', async () => {
  const page = wide.page;
  await fresh(page);
  await start(page, 'Quiet');
  await addChange(page, MOVE_7A);
  await ready(page);
  await page.evaluate(() => {
    const derived = globalThis.sv2.store.derived;
    const real = derived.scenario;
    const el = document.querySelector('.scn');
    const spy = { real, asked: 0, states: [] };
    spy.observer = new MutationObserver(() => spy.states.push(el.dataset.compare));
    spy.observer.observe(el, { attributes: true, attributeFilter: ['data-compare'] });
    derived.scenario = (options) => {
      spy.asked += 1;
      return real.call(derived, options);
    };
    globalThis.__spy = spy;
  });
  try {
    // one floor on the map, then all of them again
    await page.click('.mov-floors input[name="scenarios-floors"][value="fsample002"] + .seg__label');
    await page.waitForFunction(() => document.querySelector('.scn').scenarios.memory.floors === 'fsample002');
    await page.click('.mov-floors input[name="scenarios-floors"][value="all"] + .seg__label');
    await page.waitForFunction(() => document.querySelector('.scn').scenarios.memory.floors === 'auto');
    // the theme, dark and back: the section is drawn again each time
    for (const theme of ['dark', 'light']) {
      await page.evaluate(async (value) => {
        const { setSetting } = await import('./engine/actions.js');
        globalThis.sv2.store.apply(setSetting, { key: 'theme', value });
      }, theme);
      await page.waitForFunction((value) => document.documentElement.dataset.theme === value, {}, theme);
    }
    // the attribute is written on each drawing; only what it says counts
    const quiet = await page.evaluate(() => ({ asked: globalThis.__spy.asked, states: globalThis.__spy.states.filter((state) => state !== 'ready') }));
    assert.equal(quiet.asked, 0, 'nothing the comparison is for changed, so the lane was not asked');
    assert.deepEqual(quiet.states, [], 'and the inspector never said it was working the comparison out again');
    assert.equal(await page.$eval('.scn-compare__status', (el) => el.textContent), '');
    // a change of the scenario asks
    await addChange(page, MOVE_7B);
    await ready(page);
    assert.ok(await page.evaluate(() => globalThis.__spy.asked) >= 1, 'a new scenario object asks again');
  } finally {
    await page.evaluate(() => {
      globalThis.sv2.store.derived.scenario = globalThis.__spy.real;
      globalThis.__spy.observer.disconnect();
    });
  }
});

test('SV2-68b 2: after Apply the focus goes straight to the start field, after Undo from the message to the name field', async () => {
  const page = wide.page;
  await fresh(page);
  await start(page, 'Focus apply');
  await addChange(page, MOVE_7A);
  await ready(page);
  await watchFocus(page);
  try {
    await page.click('[data-action="apply"]');
    await page.waitForSelector('#scenario-apply[open]');
    await page.click('#scenario-apply .btn--primary');
    await ready(page);
    const applied = await focusSeen(page);
    assert.ok(applied.length > 0, 'the store changed');
    assert.deepEqual(applied.at(-1), { id: 'scenario-start-name', tag: 'INPUT', action: null, shown: true }, 'once Apply has run, the start field has the focus, never the page or a hidden button: ' + JSON.stringify(applied));
    assert.equal(await page.evaluate(() => document.activeElement.id), 'scenario-start-name');
    // Undo from the message: the scenario comes back, and the focus with it to its name field
    await page.waitForSelector('.toast .toast__action');
    assert.equal(await page.$eval('.toast .toast__action', (el) => el.textContent), 'Undo');
    await page.click('.toast .toast__action');
    await page.waitForFunction(() => document.querySelector('.scn').dataset.mode === 'open');
    await ready(page);
    const undone = await focusSeen(page);
    assert.deepEqual(undone.at(-1), { id: 'scenario-name', tag: 'INPUT', action: null, shown: true }, 'after Undo the focus is on the scenario’s name field: ' + JSON.stringify(undone));
    assert.equal(await page.evaluate(() => document.activeElement.id), 'scenario-name');
  } finally {
    await unwatchFocus(page);
  }
});

test('SV2-68b 2: after Discard the focus goes straight to the start field', async () => {
  const page = wide.page;
  await fresh(page);
  await start(page, 'Focus discard');
  await addChange(page, MOVE_7A);
  await ready(page);
  await watchFocus(page);
  try {
    await page.click('[data-action="discard"]');
    await page.waitForSelector('dialog[open]');
    await page.click('dialog[open] .btn--danger');
    await ready(page);
    const seenFocus = await focusSeen(page);
    assert.deepEqual(seenFocus.at(-1), { id: 'scenario-start-name', tag: 'INPUT', action: null, shown: true }, 'once Discard has run, the start field has the focus: ' + JSON.stringify(seenFocus));
    assert.equal(await page.evaluate(() => document.activeElement.id), 'scenario-start-name');
  } finally {
    await unwatchFocus(page);
  }
});

test('SV2-68b 3: Redo after undoing an Apply applies it again and closes the scenario', async () => {
  const page = wide.page;
  await fresh(page);
  await start(page, 'Redo');
  await addChange(page, MOVE_7A);
  await ready(page);
  const before = await slotRoom(page, 'gsample07a', A, 2);
  await page.click('[data-action="apply"]');
  await page.waitForSelector('#scenario-apply[open]');
  await page.click('#scenario-apply .btn--primary');
  await ready(page);
  await page.evaluate(() => globalThis.sv2.store.undo());
  await ready(page);
  assert.equal(await slotRoom(page, 'gsample07a', A, 2), before);
  assert.equal(await page.$eval('.scn', (el) => el.dataset.mode), 'open');
  await page.evaluate(() => globalThis.sv2.store.redo());
  await page.waitForFunction(() => document.querySelector('.scn').dataset.mode === 'none');
  assert.equal(await page.$eval('.scn', (el) => el.dataset.compare), 'none', 'the comparison of the closed scenario is let go');
  assert.equal(await slotRoom(page, 'gsample07a', A, 2), 'rsample101', 'Redo writes the change again');
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.scenario), null, 'and closes the scenario again');
  assert.equal(await page.$eval('.scn', (el) => el.dataset.mode), 'none');
  assert.match(await seen(page, '#scenario-line'), /No scenario is open/);
  assert.equal(await page.$eval('.scn-compare', (el) => el.dataset.state), 'none');
});

test('SV2-68b 3: an older answer of the lane that comes after a newer one is never shown', async () => {
  const page = wide.page;
  await fresh(page);
  await start(page, 'Race');
  await addChange(page, MOVE_7A);
  await ready(page);
  await holdLane(page);
  try {
    await page.select('#scenario-compare-day', B);
    await page.select('#scenario-compare-day', '');
    await page.waitForFunction(() => globalThis.__held.calls.length === 2);
    // the newer first
    await answerHeld(page, 1, '__newer');
    await page.waitForFunction(() => document.querySelector('.scn').scenarios.answer === globalThis.__newer && document.querySelector('.scn').dataset.compare === 'ready');
    // then the older, for B Day
    await answerHeld(page, 0, '__older');
    const shown = await page.evaluate(() => {
      const el = document.querySelector('.scn');
      return { newer: el.scenarios.answer === globalThis.__newer, day: el.scenarios.compare.dayTypeId, olderDay: globalThis.__older.compare.dayTypeId, state: el.dataset.compare };
    });
    assert.equal(shown.olderDay, B, 'the older asking was for B Day');
    assert.equal(shown.newer, true, 'the newer answer stays up: ' + JSON.stringify(shown));
    assert.notEqual(shown.day, B);
    assert.equal(shown.state, 'ready');
  } finally {
    await restoreLane(page);
  }
});

test('SV2-68b 3: a lane that fails is said in the lab, the last figures kept and marked', async () => {
  const page = wide.page;
  await fresh(page);
  await start(page, 'Fails');
  await addChange(page, MOVE_7A);
  await ready(page);
  const figuresBefore = await page.$eval('.scn-figures', (el) => el.textContent);
  await page.evaluate(() => {
    const derived = globalThis.sv2.store.derived;
    globalThis.__held = { real: derived.scenario, calls: [] };
    derived.scenario = () => Promise.reject(new Error('The lane fell over.'));
  });
  try {
    await addChange(page, MOVE_7B);
    await page.waitForFunction(() => !document.querySelector('.scn').scenarios.pending);
    assert.equal(await page.$eval('.scn', (el) => el.dataset.compare), 'failed');
    assert.equal(await seen(page, '.scn-compare__status'), 'The comparison could not be worked out: The lane fell over. The figures below are from before your last change.');
    assert.equal(await page.$eval('.scn-compare', (el) => el.dataset.state), 'old');
    assert.equal(await page.$eval('.scn-figures', (el) => el.textContent), figuresBefore);
  } finally {
    await restoreLane(page);
  }
});

test('SV2-68b 3: the section taken off the page while the lane works: no error, and nothing written after', async () => {
  const page = wide.page;
  await fresh(page);
  await start(page, 'Leaving');
  await addChange(page, MOVE_7A);
  await ready(page);
  await holdLane(page);
  try {
    await addChange(page, MOVE_7B);
    await page.waitForFunction(() => globalThis.__held.calls.length >= 1 && document.querySelector('.scn').dataset.compare === 'pending');
    await page.evaluate(() => {
      const el = document.querySelector('.scn');
      globalThis.__left = { el, answer: el.scenarios.answer };
    });
    await go(page, '#movement');
    await page.waitForFunction(() => !globalThis.__left.el.isConnected);
    await answerHeld(page, 0, '__late');
    const after = await page.evaluate(() => ({ compare: globalThis.__left.el.dataset.compare, same: globalThis.__left.el.scenarios.answer === globalThis.__left.answer, pending: globalThis.__left.el.scenarios.pending }));
    assert.deepEqual(after, { compare: 'pending', same: true, pending: true }, 'the answer came after the section left, and nothing of it was written');
    assert.deepEqual(wide.problems().errors, []);
  } finally {
    await restoreLane(page);
    await go(page, '#scenarios');
  }
});

test('SV2-68b 4: a group deleted under the lab: the forms fall back, the old answer names it as gone', async () => {
  const page = wide.page;
  await fresh(page);
  await start(page, 'Group gone');
  await addChange(page, MOVE_7A);
  await ready(page);
  await page.select('#scenario-move-group', 'gsample07a');
  assert.equal(await page.$eval('.scn-groups tr[data-group="gsample07a"] th bdi', (el) => el.textContent), '7A');
  await holdLane(page);
  try {
    await page.evaluate(async () => {
      const { deleteGroup } = await import('./engine/actions.js');
      globalThis.sv2.store.apply(deleteGroup, { id: 'gsample07a' });
    });
    await page.waitForFunction(() => document.querySelector('.scn-compare').dataset.state === 'old');
    // the answer up is from before the deletion; its row for the group says it is gone
    const row = await page.$eval('.scn-groups tr[data-group="gsample07a"] th', (el) => ({ text: el.textContent, typed: el.querySelector('bdi') !== null }));
    assert.deepEqual(row, { text: 'A group no longer in the project' + 'edited', typed: false });
    // the move form falls back to the first group there is
    const form = await page.evaluate(() => ({ value: document.getElementById('scenario-move-group').value, options: Array.from(document.querySelectorAll('#scenario-move-group option')).map((option) => option.value) }));
    assert.equal(form.value, 'gsample06a');
    assert.ok(!form.options.includes('gsample07a'), form.options.join(' '));
    // the change names a group gone: it no longer applies
    assert.equal(await page.$eval('.scn-dropped', (el) => el.hidden), false);
    // the lane answers for the project as it is now: no row for the group
    await answerHeld(page, -1, '__after');
    await restoreLane(page);
    await ready(page);
    assert.equal(await page.$('.scn-groups tr[data-group="gsample07a"]'), null, 'the new answer has no row for it');
  } finally {
    await restoreLane(page);
  }
});

test('SV2-68b 4, 5: a scenario from a file, then edited: its comparison and the slots not compared stay; Undo of the file drops the result line', async () => {
  const page = wide.page;
  await fresh(page);
  const file = writeFile('edited.json', (project) => {
    const a7 = project.groups.find((group) => group.id === 'gsample07a');
    a7.days.dsample00a[2] = { ...a7.days.dsample00a[2], room: 'rsample101' };
    const b7 = project.groups.find((group) => group.id === 'gsample07b');
    b7.days.dsample00a[0] = { ...b7.days.dsample00a[0], room: null };
    project.groups.find((group) => group.id === 'gsample08b').name = '8B next year';
  });
  const input = await page.$('input[data-file="compare"]');
  await input.uploadFile(file);
  await page.waitForFunction(() => /^Compared with/.test(document.querySelector('.scn-file__result').textContent));
  await ready(page);
  const compared = (await scenarioOf(page)).compared;
  const shown = async () => page.evaluate(() => ({
    groups: document.querySelector('.scn-file__groups').hidden ? null : document.querySelector('.scn-file__groups').textContent,
    skipped: document.querySelector('.scn-file__skipped').hidden ? null : Array.from(document.querySelectorAll('.scn-file__skipped li')).map((li) => li.dataset.reason),
  }));
  const first = await shown();
  assert.deepEqual(first.skipped, ['no-room']);
  assert.match(first.groups, /8B next year/);
  assert.equal(await page.$eval('.scn-file__result [role="status"]', (el) => el.textContent), 'Compared with “edited.json”: 1 change. 1 slot could not be compared; they are listed below.');
  // a chip added by the form, then the file's own chip taken out
  await page.select('#scenario-move-group', 'gsample08a');
  await page.select('#scenario-move-period', '5');
  await pickRoom(page, 'Library');
  await addByPointer(page);
  assert.equal((await chips(page)).length, 2);
  assert.deepEqual((await scenarioOf(page)).compared, compared);
  assert.deepEqual(await shown(), first, 'added to: the comparison and its slots not compared stay');
  await page.click('.scn-chip[data-index="0"] [data-action="remove"]');
  await ready(page);
  assert.deepEqual((await scenarioOf(page)).changes.map((change) => change.groupId), ['gsample08a']);
  assert.deepEqual((await scenarioOf(page)).compared, compared);
  assert.deepEqual(await shown(), first, 'taken from: they stay');
  // SV2-68b 10: taking a chip out is said where adding one is
  assert.match(await seen(page, '.scn-status'), /^Removed: 7A · A Day · Period 3: Library → 101/);
  // back to before the file: the line about it goes
  for (let i = 0; i < 3; i += 1) await page.evaluate(() => globalThis.sv2.store.undo());
  await ready(page);
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.scenario), null);
  assert.equal(await page.$eval('.scn-file__result', (el) => el.textContent), '', 'no line about a comparison no longer open');
});

test('SV2-68b 5: the slots not compared belong to their comparison, not to a file of the same name', async () => {
  const page = wide.page;
  await fresh(page);
  const once = (dir, nulls) => {
    fs.mkdirSync(path.join(SCRATCH, dir), { recursive: true });
    return writeFile(path.join(dir, 'proposal.json'), (project) => {
      const a7 = project.groups.find((group) => group.id === 'gsample07a');
      a7.days.dsample00a[2] = { ...a7.days.dsample00a[2], room: 'rsample101' };
      const b7 = project.groups.find((group) => group.id === 'gsample07b');
      for (let p = 0; p < nulls; p += 1) b7.days.dsample00a[p] = { ...b7.days.dsample00a[p], room: null };
    });
  };
  const one = once('one', 1);
  const two = once('two', 2);
  const input = await page.$('input[data-file="compare"]');
  await input.uploadFile(one);
  await page.waitForFunction(() => /^Compared with/.test(document.querySelector('.scn-file__result').textContent));
  await ready(page);
  assert.equal(await page.$$eval('.scn-file__skipped li', (items) => items.length), 1);
  // the second, of the same name, over it
  await page.evaluate(() => {
    globalThis.__firstCompared = globalThis.sv2.store.project.scenario.compared;
  });
  await input.uploadFile(two);
  await page.waitForSelector('dialog[open]');
  // while the question is up, the project changes under it: 7B's first slot
  // empties here too, so that slot is no longer one the file differs in
  await page.evaluate(async () => {
    const { setSlot } = await import('./engine/actions.js');
    globalThis.sv2.store.apply(setSlot, { groupId: 'gsample07b', dayTypeId: 'dsample00a', period: 0, slot: { room: null } });
  });
  await page.click('dialog[open] .btn--primary, dialog[open] .btn--danger');
  await page.waitForFunction(() => globalThis.sv2.store.project.scenario.compared !== globalThis.__firstCompared && /^Compared with/.test(document.querySelector('.scn-file__result').textContent));
  await ready(page);
  assert.deepEqual(await page.$$eval('.scn-file__skipped li', (items) => items.map((li) => li.textContent)), ['7B · A Day · Period 2: the file has no room there.'], 'worked out against the project as it is once the question is answered');
  // Undo of the second: the first comparison is back, and the second's slots are not its
  await page.evaluate(() => globalThis.sv2.store.undo());
  await ready(page);
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.scenario.compared.fileName), 'proposal.json');
  assert.equal(await page.$eval('.scn-file__skipped', (el) => el.hidden), true, 'another comparison’s slots are not listed under this one');
  assert.equal(await page.$eval('.scn-file__result', (el) => el.textContent), '', 'nor its result line');
});

test('SV2-68b 5: the section left while it asks whether to replace the scenario: answering writes nothing', async () => {
  const page = wide.page;
  await fresh(page);
  await start(page, 'Kept');
  await addChange(page, MOVE_7A);
  await ready(page);
  const kept = await scenarioOf(page);
  const file = writeFile('while-away.json', (project) => {
    const b7 = project.groups.find((group) => group.id === 'gsample07b');
    b7.days.dsample00a[2] = { ...b7.days.dsample00a[2], room: 'rsample101' };
  });
  const input = await page.$('input[data-file="compare"]');
  await input.uploadFile(file);
  await page.waitForSelector('dialog[open]');
  await page.evaluate(() => {
    globalThis.__away = document.querySelector('.scn');
    location.hash = '#movement';
  });
  await page.waitForFunction(() => !globalThis.__away.isConnected && document.querySelector('dialog[open]'));
  await page.click('dialog[open] .btn--primary, dialog[open] .btn--danger');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));
  // the store's change, had there been one, is drawn at once: none came
  assert.deepEqual(await scenarioOf(page), kept, 'the section had gone, so the scenario is not replaced');
  assert.equal(await page.evaluate(() => globalThis.__away.querySelector('.scn-file__result').textContent), '');
  assert.deepEqual(wide.problems().errors, []);
  await go(page, '#scenarios');
});

test('SV2-68b 5: a file refused is said as an alert', async () => {
  const page = wide.page;
  await fresh(page);
  const junk = path.join(SCRATCH, 'refused.json');
  fs.writeFileSync(junk, '{"hello": 1}');
  const input = await page.$('input[data-file="compare"]');
  await input.uploadFile(junk);
  await page.waitForFunction(() => /refused\.json” was not compared/.test(document.querySelector('.scn-file__result').textContent));
  assert.equal(await page.$eval('.scn-file__result p', (el) => el.getAttribute('role')), 'alert');
});

test('SV2-68b 7: Undo of a rename while the name field has the focus shows the name back, and leaving the field keeps it', async () => {
  const page = wide.page;
  await fresh(page);
  await start(page, 'One');
  await page.focus('#scenario-name');
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.keyboard.type('Two');
  await page.keyboard.press('Enter');
  await ready(page);
  assert.equal((await scenarioOf(page)).name, 'Two');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'scenario-name');
  await page.evaluate(() => globalThis.sv2.store.undo());
  await ready(page);
  assert.equal((await scenarioOf(page)).name, 'One');
  assert.equal(await page.$eval('#scenario-name', (el) => el.value), 'One', 'the field shows the name Undo put back');
  await page.keyboard.press('Tab');
  await ready(page);
  assert.equal((await scenarioOf(page)).name, 'One', 'leaving the field does not write the old text over the Undo');
  // what is typed is still committed on leaving
  await page.focus('#scenario-name');
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.keyboard.type('Three');
  await page.keyboard.press('Tab');
  await ready(page);
  assert.equal((await scenarioOf(page)).name, 'Three');
});

test('SV2-68b 8: with nothing that applies, Apply’s button says it closes the scenario', async () => {
  const page = wide.page;
  await fresh(page);
  await start(page, 'Empty');
  await page.click('[data-action="apply"]');
  await page.waitForSelector('#scenario-apply[open]');
  const buttons = await page.$$eval('#scenario-apply .dialog__buttons button', (items) => items.map((button) => button.textContent));
  assert.deepEqual(buttons, ['Close the scenario: no change of it applies', 'Keep it as a scenario']);
  await page.click('#scenario-apply .btn--primary');
  await ready(page);
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.scenario), null);
  await page.waitForFunction(() => /Closed “Empty”: no change of it applied, and the schedule is as it was\./.test(document.querySelector('.toasts').textContent));
});

test('SV2-68b 9: the room picked shows its label as it is after a rename, and the picker lists rooms by number', async () => {
  const page = wide.page;
  await fresh(page);
  await start(page, 'Labels');
  await page.select('#scenario-move-group', 'gsample07a');
  await pickRoom(page, '101');
  assert.equal(await page.$eval('.scn-field--room input', (el) => el.value), '101 — Ms. Halloran');
  await page.evaluate(async () => {
    const { editTeacher } = await import('./engine/actions.js');
    globalThis.sv2.store.apply(editTeacher, { id: 'tsample001', name: 'Ms. Halloran-Byrne' });
  });
  await ready(page);
  assert.equal(await page.$eval('.scn-field--room input', (el) => el.value), '101 — Ms. Halloran-Byrne');
  // the list, opened on an empty field, in the order of the rooms' numbers
  await page.click('.scn-field--room input', { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.waitForSelector('.scn-field--room .picker__list:not([hidden])');
  const listed = await page.$$eval('.scn-field--room .picker__option', (items) => items.map((item) => item.textContent.split(' — ')[0]));
  const numbers = await page.evaluate(async () => {
    const { allRooms } = await import('./engine/schema.js');
    return allRooms(globalThis.sv2.store.project).map((room) => room.number).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  });
  assert.deepEqual(listed.map((text) => numbers.find((n) => text.startsWith(n))), numbers);
  await page.keyboard.press('Escape');
});

test('nothing went wrong on the page', () => {
  assert.deepEqual(wide.problems().errors, []);
});
