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
  await page.waitForSelector('#print-preview[open][data-ready="true"]', { timeout: 30000 });
  const doc = await page.evaluate(() => {
    const frame = document.querySelector('#print-preview iframe').contentDocument;
    const section = frame.querySelector('.doc-scenario');
    return { output: frame.documentElement.dataset.output, section: section ? section.textContent : null };
  });
  assert.equal(doc.output, 'congestion');
  assert.ok(doc.section !== null, 'the report has its scenario section');
  // the section names the change once the report prints the comparison (SV2-71)
  if (!/not built yet/.test(doc.section)) assert.ok(doc.section.includes(chip.split(':')[0]), doc.section);
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

test('nothing went wrong on the page', () => {
  assert.deepEqual(wide.problems().errors, []);
});
