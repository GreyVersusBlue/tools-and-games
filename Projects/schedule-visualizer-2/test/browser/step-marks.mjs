// Marking step-free in the building editor, in a real browser:
// node test/browser/step-marks.mjs
//
// The journey: an elevator, its steps and a refuge built through the store's
// actions (the sample school gets them only in SV2-106), then marked by the
// interface: a stop's Properties (the car-wide tick and its live words, the
// timings and their link, Connect to another floor…, the other stops with
// Show and Disconnect), the Floor tab's elevator list, steps, refuges and
// legend, a door's and an exit's own Step-free tick, corridor cells with the
// counted and the mixed tick and Select this corridor, areas of refuge, and
// the Marks… menu with the focus back on the cell. By pointer, by keyboard,
// and at 390 px with touch.
//
// Nothing here waits on a first paint or a fixed time: each step waits on a
// state the page sets (the plan at rest, the announcer's words, the
// building in the store, a menu or a dialog that is open).

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, still } from './harness.mjs';
import { startEmpty, point, state, planReady } from './draw-pointer.mjs';

let session;
let page;

const WIDTH = 40;
const cellOf = (x, y) => y * WIDTH + x;
// the plan: a corridor along row 10 from column 5 to 20, Room 101 above it
// with a door on its south edge, an elevator stop at column 22 on every
// floor, and stairs at column 3 on floors 1 and 2
const STOP = cellOf(22, 10);
const STAIRS = cellOf(3, 10);

const building = () => page.evaluate(() => JSON.parse(JSON.stringify(globalThis.sv2.store.project.building)));
const said = () => page.evaluate(() => document.getElementById('announcer').textContent);
const entries = () => page.evaluate(() => globalThis.sv2.store.history.past.length);
const floorName = () => page.evaluate(() => document.querySelector('.bld').editor.floor.name);

// Wait until the announcer says what is wanted: the page's own word that an action has been made.
async function saidIs(expected) {
  await page.waitForFunction((wanted) => document.getElementById('announcer').textContent === wanted, {}, expected);
}

// Run an action through the store, in the page, as the interface would.
async function act(name, payload) {
  return page.evaluate(async (which, args) => {
    const actions = await import('./engine/actions.js');
    return globalThis.sv2.store.apply(actions[which], args) && true;
  }, name, payload);
}

async function floorIds() {
  return (await building()).floors.map((floor) => floor.id);
}

// Show a floor and wait until the editor has it, at rest.
async function openFloor(index) {
  const id = (await floorIds())[index];
  await page.evaluate((target) => {
    location.hash = '#building/' + target;
  }, id);
  await page.waitForFunction((target) => document.querySelector('.bld')?.editor?.floor.id === target, {}, id);
  await still(page);
}

async function tab(id) {
  await page.evaluate((wanted) => document.querySelector('[role="tab"][data-tab="' + wanted + '"]').click(), id);
  await page.waitForFunction((wanted) => document.querySelector('[role="tab"][data-tab="' + wanted + '"]').getAttribute('aria-selected') === 'true', {}, id);
}

// The menu of a cell with the right button; its entries come back.
async function menuOn(cell) {
  const x = cell % WIDTH;
  const y = Math.floor(cell / WIDTH);
  const at = await point(page, x, y);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await page.waitForSelector('.menu[role="menu"]');
  return page.$$eval('.menu [role="menuitem"]', (all) => all.map((item) => item.textContent.trim()));
}

async function choose(label) {
  const done = await page.evaluate((wanted) => {
    const item = Array.from(document.querySelectorAll('.menu [role="menuitem"]')).find((each) => each.textContent.trim() === wanted);
    if (!item) return false;
    item.click();
    return true;
  }, label);
  assert.equal(done, true, 'the menu has no "' + label + '"');
}

// Properties of a cell, by its menu: wait until the panel is about it.
async function propertiesOf(cell, item) {
  const items = await menuOn(cell);
  assert.ok(items.includes(item), 'the menu has "' + item + '": ' + items.join(' | '));
  await choose(item);
  await page.waitForFunction(() => document.querySelector('#inspector-properties [data-key="panel-title"]') !== null);
}

const text = (selector) => page.$eval(selector, (el) => el.textContent);
const exists = async (selector) => (await page.$(selector)) !== null;
const panelTitle = () => text('#inspector-properties [data-key="panel-title"]');
const focusIs = () => page.evaluate(() => {
  const el = document.activeElement;
  return el ? { id: el.id, key: el.dataset ? el.dataset.key || '' : '', tag: el.tagName } : null;
});

before(async () => {
  session = await openPlanner({ hash: '#building', width: 1280, height: 900 });
  page = session.page;
  await startEmpty(page);
  // three floors; a corridor, a room, stairs and an elevator stop on each, built by the actions
  await page.evaluate(async () => {
    const actions = await import('./engine/actions.js');
    const { store } = globalThis.sv2;
    const first = store.project.building.floors[0].id;
    store.apply(actions.addFloor, { likeFloorId: first });
    store.apply(actions.addFloor, { likeFloorId: first });
    const floors = store.project.building.floors;
    for (const floor of floors) {
      store.apply(actions.paintCorridor, { floorId: floor.id, from: 10 * 40 + 5, to: 10 * 40 + 20 });
      store.apply(actions.placeLift, { floorId: floor.id, cells: [10 * 40 + 22] });
    }
    for (const floor of floors.slice(0, 2)) store.apply(actions.placeStairs, { floorId: floor.id, cells: [10 * 40 + 3] });
    store.apply(actions.placeRoom, { floorId: floors[0].id, rect: { x: 5, y: 7, w: 4, h: 3 }, number: '101' });
    const room = store.project.building.floors[0].spaces.find((space) => space.number === '101');
    store.apply(actions.addDoor, { roomId: room.id, cell: 9 * 40 + 6, side: 's' });
    store.apply(actions.addDoor, { roomId: room.id, cell: 9 * 40 + 7, side: 's' });
    store.apply(actions.connectStairs, { a: { floorId: floors[0].id, cell: 10 * 40 + 3 }, b: { floorId: floors[1].id, cell: 10 * 40 + 3 } });
    // the elevator joins floors 1 and 2 here; floor 3's stop is joined through the interface
    store.apply(actions.connectStairs, { a: { floorId: floors[0].id, cell: 10 * 40 + 22 }, b: { floorId: floors[1].id, cell: 10 * 40 + 22 } });
  });
  await planReady(page);
  await still(page);
});

after(async () => {
  if (session) await session.close();
});

// ---------------------------------------------------------------- the built school

test('the school built by the actions has an elevator of two stops, a third stop not joined, and stairs A', async () => {
  const b = await building();
  assert.equal(b.floors.length, 3);
  const elevators = b.connections.filter((connection) => connection.kind === 'elevator');
  assert.equal(elevators.length, 1);
  assert.equal(elevators[0].staffOnly, true, 'a new elevator is staff and authorised only');
  assert.equal(b.connections.filter((connection) => connection.kind !== 'elevator').length, 1);
  assert.deepEqual(b.floors.map((floor) => floor.lifts || []), [[STOP], [STOP], [STOP]]);
});

// ---------------------------------------------------------------- the Floor tab

test('the Floor tab lists the elevator apart from the stairs, the unconnected stop as a row of its own, and the legend', async () => {
  await tab('floor');
  const car = (await building()).connections.find((connection) => connection.kind === 'elevator').car;
  assert.match(await text('#floor-connections'), /Joins Floor 1 and Floor 2/, 'the stairs connection is listed');
  assert.equal(await page.$$eval('#floor-connections li', (all) => all.length), 1, 'the elevator is not in the stairs list');
  assert.equal(await page.$$eval('#floor-elevators li', (all) => all.length), 1);
  assert.equal(await text('#floor-elevators li .bi-row__text'), 'Elevator ' + car + ': Floor 1 and Floor 2 · staff only');
  // an elevator runs both ways: no "Which way" fieldset in its row
  assert.equal(await exists('#floor-elevators .bi-way'), false);
  assert.equal(await exists('#floor-connections .bi-way'), true, 'the stairs keep theirs');
  await openFloor(2);
  assert.equal(await text('#floor-elevators li .bi-row__text'), 'Floor 3 stop: not connected');
  assert.equal(await page.$eval('#floor-elevators li', (el) => el.dataset.connected), 'false');
  assert.ok(await exists('#floor-elevators [data-action="stop-connect"]'), 'an unconnected stop has Connect…');
  // the legend names the four glyphs in words
  const words = await page.$$eval('#floor-legend li', (all) => all.map((li) => li.textContent.trim()));
  assert.deepEqual(words, ['Elevator stop', 'Staff and authorised only (on the elevator\'s letter)', 'Step: step-free routes go round it', 'Area of refuge']);
  assert.equal(await page.$$eval('#floor-legend svg[aria-hidden="true"]', (all) => all.length), 4, 'every glyph is hidden from a screen reader: the words carry it');
  await openFloor(0);
});

test('Clear and Delete on the Floor tab count stairs cells and elevator stops apart', async () => {
  await tab('floor');
  const clearing = await page.evaluate(() => Array.from(document.querySelectorAll('#inspector-floor p')).map((p) => p.textContent).find((words) => words.startsWith('Removes everything drawn on')));
  assert.match(clearing, /1 stairs cell/);
  assert.match(clearing, /1 elevator stop/);
  assert.match(clearing, /1 stairs connection/);
  assert.match(clearing, /1 elevator connection/);
});

// ---------------------------------------------------------------- a stop's Properties

test('a stop\'s Properties name its elevator and floors, the timings and their link, and the car-wide tick says how many stops it applied to', async () => {
  await openFloor(0);
  const car = (await building()).connections.find((connection) => connection.kind === 'elevator').car;
  await propertiesOf(STOP, 'Properties of elevator ' + car);
  assert.equal(await panelTitle(), 'Elevator ' + car);
  assert.equal(await text('#stop-floors'), 'Stops at Floor 1 and Floor 2.');
  assert.equal(await text('#stop-timings'), 'Wait 30 s · 6 s a floor · 8 people a trip · change in Project › Settings.');
  assert.equal(await page.$eval('#stop-settings-link', (a) => a.getAttribute('href')), '#project');
  const tick = '#inspector-properties [data-key="staff-only"]';
  assert.equal(await page.$eval(tick, (el) => el.checked), true);
  assert.equal(await text('label[for="stop-staff-only"]'), 'Elevator ' + car + ': staff and authorised only (all stops)');
  assert.match(await text('#stop-staff-only-hint'), /Students on step-free routes, and staff, may use it; other students' routes do not\. Untick it only if everyone may\./);
  const before = await entries();
  await page.click(tick);
  await saidIs('Applied to 2 stops.');
  assert.equal(await entries(), before + 1, 'one tick is one undo step');
  assert.equal((await building()).connections.filter((connection) => connection.kind === 'elevator').every((connection) => connection.staffOnly !== true), true);
  assert.equal(await page.$eval(tick, (el) => el.checked), false);
  await page.click(tick);
  await saidIs('Applied to 2 stops.');
  assert.equal((await building()).connections.find((connection) => connection.kind === 'elevator').staffOnly, true);
});

test('Connect to another floor… starts the existing connect mode from the stop, and Cancel puts the focus back', async () => {
  assert.ok(await exists('#inspector-properties [data-action="stop-connect"]'));
  await page.click('#inspector-properties [data-action="stop-connect"]');
  await page.waitForFunction(() => !document.getElementById('connect-banner').hidden);
  assert.equal(await page.$eval('#plan', (el) => el.dataset.connecting), 'true');
  await page.click('#connect-cancel');
  await page.waitForFunction(() => document.getElementById('connect-banner').hidden);
  assert.equal((await focusIs()).id, 'plan');
});

test('the third stop is joined in connect mode from its own Properties: the stop is accepted as an end', async () => {
  await openFloor(2);
  await propertiesOf(STOP, 'Properties of this elevator stop');
  assert.match(await panelTitle(), /not connected/);
  assert.equal(await exists('#inspector-properties [data-key="staff-only"]'), false, 'an unconnected stop has no car to set');
  await page.click('#inspector-properties [data-action="stop-connect"]');
  await page.waitForFunction(() => !document.getElementById('connect-banner').hidden);
  // the other end: floor 2's stop, by the plan
  await openFloor(1);
  const at = await point(page, 22, 10);
  await page.mouse.click(at.x, at.y);
  await page.waitForFunction(() => document.getElementById('connect-banner').hidden);
  const b = await building();
  const elevators = b.connections.filter((connection) => connection.kind === 'elevator');
  assert.equal(elevators.length, 2, 'the mode joined the two stops');
  assert.equal(new Set(elevators.map((connection) => connection.car)).size, 1, 'one elevator, one letter on both connections');
  assert.match(await said(), /^Connected /);
});

test('the other stops are listed with Show and Disconnect; Show brings that floor up and Properties follow', async () => {
  await openFloor(0);
  const car = (await building()).connections.find((connection) => connection.kind === 'elevator').car;
  await propertiesOf(STOP, 'Properties of elevator ' + car);
  assert.equal(await text('#stop-floors'), 'Stops at Floor 1, Floor 2 and Floor 3.');
  const rows = await page.$$eval('#stop-others li', (all) => all.map((li) => li.querySelector('.bi-row__text').textContent));
  assert.deepEqual(rows, ['Floor 2', 'Floor 3']);
  // Show on Floor 3: the plan changes floor and the panel is about that stop
  await page.click('#stop-others [data-key="show-stop:' + (await floorIds())[2] + '"]');
  await page.waitForFunction(() => document.querySelector('.bld').editor.floor.name === 'Floor 3');
  await page.waitForFunction(() => document.getElementById('stop-floors') !== null);
  assert.equal(await text('#stop-floors'), 'Stops at Floor 1, Floor 2 and Floor 3.');
  assert.equal((await focusIs()).key, 'panel-title', 'the focus lands in the panel, not on the lost Show button');
  const others = await page.$$eval('#stop-others li', (all) => all.map((li) => li.querySelector('.bi-row__text').textContent));
  assert.deepEqual(others, ['Floor 1', 'Floor 2']);
});

test('Disconnect cuts the stop off and leaves it standing, in one undo step', async () => {
  const before = await entries();
  const ids = await floorIds();
  // from Floor 3's panel: the Floor 1 stop is reached through Floor 2's stop (the chain 3 - 2 - 1)
  await page.click('#stop-others [data-key="disconnect-stop:' + ids[1] + '"]');
  await page.waitForFunction((count) => globalThis.sv2.store.history.past.length === count, {}, before + 1);
  assert.match(await said(), /^Disconnected Floor 2 from Elevator /);
  const b = await building();
  assert.equal(b.connections.filter((connection) => connection.kind === 'elevator').length, 1);
  assert.deepEqual(b.floors.map((floor) => floor.lifts || []).map((l) => l.length > 0), [true, true, true], 'every stop is still standing');
  await page.evaluate(async () => {
    const { store } = globalThis.sv2;
    store.undo();
  });
  await page.waitForFunction((count) => globalThis.sv2.store.history.past.length === count, {}, before);
  assert.equal((await building()).connections.filter((connection) => connection.kind === 'elevator').length, 2);
});

// ---------------------------------------------------------------- doors and exits

test('each door of a room has a Step-free tick with its own name, on by default, and a door with a step says so', async () => {
  await openFloor(0);
  await page.evaluate(() => {
    const editor = document.querySelector('.bld').editor;
    const room = editor.floor.spaces.find((space) => space.number === '101');
    editor.select([room.id]);
  });
  await tab('properties');
  await page.waitForSelector('#room-doors li');
  const names = await page.$$eval('#room-doors input[type="checkbox"]', (all) => all.map((input) => input.getAttribute('aria-label')));
  assert.deepEqual(names, ['Door on the south wall, column 7, step-free', 'Door on the south wall, column 8, step-free'], 'two doors on one wall are told apart by their column');
  const labels = await page.$$eval('#room-doors li', (all) => all.map((li) => li.querySelector('.bi-row__text').textContent));
  assert.notEqual(labels[0], labels[1], 'each row says which door it is');
  const before = await entries();
  await page.click('#room-doors li:first-child input[type="checkbox"]');
  await page.waitForFunction((count) => globalThis.sv2.store.history.past.length === count, {}, before + 1);
  assert.match(await said(), /^The door on the south wall of Room 101 has a step\.$/);
  const room = (await building()).floors[0].spaces.find((space) => space.number === '101');
  assert.equal(room.doors.filter((door) => door.stepFree === false).length, 1);
  assert.equal(await page.$eval('#room-doors li:first-child input[type="checkbox"]', (el) => el.checked), false);
  assert.equal(await page.$eval('#room-doors li:last-child input[type="checkbox"]', (el) => el.checked), true);
  await page.click('#room-doors li:first-child input[type="checkbox"]');
  await page.waitForFunction((count) => globalThis.sv2.store.history.past.length === count, {}, before + 2);
  assert.equal((await building()).floors[0].spaces.find((space) => space.number === '101').doors.every((door) => door.stepFree !== false), true);
});

test('an exit has its own Step-free tick in the Exits tab, named by its door', async () => {
  await act('markExit', { floorId: (await floorIds())[0], cell: cellOf(5, 10), doorName: 'Door A' });
  await tab('exits');
  await page.waitForSelector('#exits-list li');
  assert.equal(await page.$eval('#exits-list input[data-exit-step-free]', (el) => el.getAttribute('aria-label')), 'Exit Door A, step-free');
  const before = await entries();
  await page.click('#exits-list input[data-exit-step-free]');
  await saidIs('The exit has a step outside its door.');
  assert.equal(await entries(), before + 1);
  assert.equal((await building()).floors[0].exits[0].stepFree, false);
  await page.click('#exits-list input[data-exit-step-free]');
  await saidIs('The exit is step-free.');
  assert.equal((await building()).floors[0].exits[0].stepFree === false, false);
});

// ---------------------------------------------------------------- corridor steps

test('Select this corridor selects the stretch between junctions and the tick is counted, then mixed', async () => {
  await openFloor(0);
  await propertiesOf(cellOf(12, 10), 'Properties of this cell');
  assert.equal(await panelTitle(), 'Corridor cell');
  assert.equal(await text('#cell-where'), 'Floor 1, column 13, row 11.');
  assert.equal(await text('label[for="cell-step"]'), 'Step here (blocks step-free routes)');
  await page.click('#inspector-properties [data-action="select-corridor"]');
  await saidIs('Selected the stretch of corridor between junctions, 16 cells.');
  assert.equal(await panelTitle(), '16 cells selected');
  assert.equal(await text('label[for="cell-step"]'), 'Step here (blocks step-free routes), 16 cells selected');
  assert.equal((await focusIs()).key, 'step', 'the tick takes the focus so the keyboard can mark them at once');
  const before = await entries();
  await page.keyboard.press('Space');
  await saidIs('Marked 16 cells.');
  assert.equal(await entries(), before + 1);
  assert.equal((await building()).floors[0].notStepFree.length, 16);
  assert.equal(await page.$eval('#cell-step', (el) => el.checked), true);
  assert.equal(await page.$eval('#cell-step', (el) => el.indeterminate), false);
  // one cell is cleared from the menu: the tick of the whole stretch is now mixed
  await act('setStepCells', { floorId: (await floorIds())[0], cells: [cellOf(12, 10)], stepFree: true });
  await page.waitForFunction(() => document.getElementById('cell-step')?.indeterminate === true);
  assert.equal(await page.$eval('#cell-step', (el) => el.getAttribute('aria-checked')), 'mixed');
  await page.keyboard.press('Space');
  await saidIs('Marked 1 cell.');
  assert.equal((await building()).floors[0].notStepFree.length, 16, 'a mixed tick, pressed, marks them all');
  await page.keyboard.press('Space');
  await saidIs('Cleared the step from 16 cells.');
  assert.deepEqual((await building()).floors[0].notStepFree || [], []);
});

test('a selection with cells that are not corridor says how many were left out', async () => {
  await page.evaluate(() => {
    const editor = document.querySelector('.bld').editor;
    return editor;
  });
  const ids = await floorIds();
  await page.evaluate(async (floorId, cells) => {
    const { focusCells } = await import('./ui/building/inspector/cell-focus.js');
    focusCells(document.querySelector('.bld').editor, floorId, cells);
  }, ids[0], [cellOf(10, 10), cellOf(11, 10), cellOf(12, 10), cellOf(12, 9), cellOf(13, 3)]);
  await page.waitForFunction(() => document.querySelector('#inspector-properties [data-key="panel-title"]')?.textContent === '5 cells selected');
  assert.equal(await text('label[for="cell-step"]'), 'Step here (blocks step-free routes), 3 cells selected');
  assert.equal(await text('#cell-step-hint'), '2 selected cells are not corridor and are left out.');
  await page.click('#cell-step');
  await saidIs('Marked 3 cells; 2 skipped, not corridor.');
});

test('the Floor tab names every step run, with Show me and Clear the step', async () => {
  await tab('floor');
  const lines = await page.$$eval('#floor-steps li .bi-row__text', (all) => all.map((p) => p.textContent));
  assert.deepEqual(lines, ['A step in the corridor, 3 cells']);
  const before = await entries();
  await page.click('#floor-steps [data-action="clear-step"]');
  await page.waitForFunction((count) => globalThis.sv2.store.history.past.length === count, {}, before + 1);
  assert.deepEqual((await building()).floors[0].notStepFree || [], []);
  assert.equal(await text('#floor-no-steps'), 'No step and no area of refuge is marked on this floor. Open the menu on a corridor cell (right-click, or the Menu key) and choose Step here or Make this an area of refuge.');
});

// ---------------------------------------------------------------- areas of refuge

test('an area of refuge is made from the menu, named, refused a name another has, listed in Floor and Exits, and removed', async () => {
  await openFloor(0);
  const items = await menuOn(cellOf(15, 10));
  assert.ok(items.includes('Make this an area of refuge'));
  await choose('Make this an area of refuge');
  await saidIs('Made the cell Area of refuge, an area of refuge.');
  await act('addRefuge', { floorId: (await floorIds())[0], cell: cellOf(16, 10) });
  await page.waitForFunction(() => globalThis.sv2.store.project.building.floors[0].refuges?.length === 2);
  assert.deepEqual((await building()).floors[0].refuges.map((refuge) => refuge.name), ['Area of refuge', 'Area of refuge 2']);
  await propertiesOf(cellOf(15, 10), 'Properties of this cell');
  assert.equal(await page.$eval('#refuge-name', (el) => el.value), 'Area of refuge');
  // a name another area has is refused, in words, and the field keeps the user's text
  await page.focus('#refuge-name');
  await page.$eval('#refuge-name', (el) => el.select());
  await page.keyboard.type('area of REFUGE 2');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#inspector-properties .field__refusal:not([hidden])') !== null);
  assert.match(await text('#inspector-properties .field__refusal:not([hidden])'), /There is already an area of refuge called Area of refuge 2/);
  await page.$eval('#refuge-name', (el) => el.select());
  await page.keyboard.type('Gym <b>door</b> lawn');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => globalThis.sv2.store.project.building.floors[0].refuges.some((refuge) => refuge.name === 'Gym <b>door</b> lawn'));
  // listed under its own heading in Exits, and in Floor, the name exactly as typed
  await tab('exits');
  const exitsRefuges = await page.$$eval('#exits-refuge-list input.field__input', (all) => all.map((input) => input.value));
  assert.deepEqual(exitsRefuges, ['Gym <b>door</b> lawn', 'Area of refuge 2']);
  await tab('floor');
  const lines = await page.$$eval('#floor-steps li .bi-row__text', (all) => all.map((p) => p.textContent));
  assert.deepEqual(lines, ['Area of refuge, Gym <b>door</b> lawn', 'Area of refuge, Area of refuge 2'], 'describeFloor\'s words: only the default name stands alone');
  assert.equal(await page.$$eval('#floor-steps b', (all) => all.length), 0, 'a name is text, never markup');
  // removed from Exits
  const before = await entries();
  await tab('exits');
  await page.click('#exits-refuge-list [data-action="remove-refuge"]');
  await page.waitForFunction((count) => globalThis.sv2.store.history.past.length === count, {}, before + 1);
  assert.equal((await building()).floors[0].refuges.length, 1);
  assert.match(await said(), /^Took the area of refuge Gym <b>door<\/b> lawn off\. The cell stays\.$/);
});

test('the stop of an elevator offers no area of refuge, and a stairs cell may have one', async () => {
  const items = await menuOn(STOP);
  assert.equal(items.includes('Make this an area of refuge'), false);
  await page.keyboard.press('Escape');
  const stairs = await menuOn(STAIRS);
  assert.ok(stairs.includes('Make this an area of refuge'));
  await page.keyboard.press('Escape');
});

// ---------------------------------------------------------------- Marks… and the focus

test('Marks… opens the cell\'s menu from Properties, and after an action the focus is on the plan with the cursor on that cell', async () => {
  await openFloor(0);
  await propertiesOf(cellOf(12, 10), 'Properties of this cell');
  assert.ok(await exists('#cell-marks'));
  assert.equal(await page.$eval('#cell-marks', (el) => el.getAttribute('aria-haspopup')), 'menu');
  await page.click('#cell-marks');
  await page.waitForSelector('.menu[role="menu"]');
  const items = await page.$$eval('.menu [role="menuitem"]', (all) => all.map((item) => item.textContent.trim()));
  assert.ok(items.includes('Step here') && items.includes('Make this an area of refuge') && items.includes('Properties of this cell'), items.join(' | '));
  await choose('Step here');
  await saidIs('Marked the cell as a step. Step-free routes go round it.');
  const now = await state(page);
  assert.equal(now.focus, 'plan', 'the focus is back on the plan');
  assert.deepEqual(now.cursor, [12, 10], 'the cursor is on the cell the menu was about');
  assert.equal(await page.$eval('#cell-step', (el) => el.checked), true, 'Properties follow the mark');
  // Escape closes the menu with no action: the focus goes back to the button that opened it
  await page.click('#cell-marks');
  await page.waitForSelector('.menu[role="menu"]');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.menu[role="menu"]') === null);
  assert.equal((await focusIs()).id, 'cell-marks');
  await act('setStepCells', { floorId: (await floorIds())[0], cells: [cellOf(12, 10)], stepFree: true });
});

test('a room\'s Properties have Marks… too, and a door\'s step is marked from its menu', async () => {
  await page.evaluate(() => {
    const editor = document.querySelector('.bld').editor;
    editor.select([editor.floor.spaces.find((space) => space.number === '101').id]);
  });
  await tab('properties');
  await page.waitForSelector('#room-doors li');
  await page.click('#cell-marks');
  await page.waitForSelector('.menu[role="menu"]');
  const items = await page.$$eval('.menu [role="menuitem"]', (all) => all.map((item) => item.textContent.trim()));
  assert.ok(items.some((label) => /^Add a door on the north edge$/.test(label)), items.join(' | '));
  await page.keyboard.press('Escape');
  // the menu on a cell with a door
  const doorCell = cellOf(6, 9);
  const onDoor = await menuOn(doorCell);
  assert.ok(onDoor.includes('The door on the south edge has a step'), onDoor.join(' | '));
  await choose('The door on the south edge has a step');
  await saidIs('The door on the south edge of Room 101 now has a step.');
  const again = await menuOn(doorCell);
  assert.ok(again.includes('The door on the south edge is step-free'));
  await choose('The door on the south edge is step-free');
  await saidIs('The door on the south edge of Room 101 is now step-free.');
});

test('by keyboard alone: the Menu key on the cursor\'s cell, a letter to jump, Enter to act, and the focus stays on the plan', async () => {
  await openFloor(0);
  await page.evaluate(() => {
    const editor = document.querySelector('.bld').editor;
    editor.cursor.moveTo(13, 10, true);
    editor.canvas.focus();
  });
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.bld').editor.cursor.x === 14);
  await page.keyboard.press('ContextMenu');
  await page.waitForSelector('.menu[role="menu"]');
  // the menu opens on its first item; "S" jumps to "Step here"
  await page.keyboard.press('s');
  const on = await page.evaluate(() => document.activeElement.textContent.trim());
  assert.equal(on, 'Step here');
  await page.keyboard.press('Enter');
  await saidIs('Marked the cell as a step. Step-free routes go round it.');
  assert.deepEqual((await building()).floors[0].notStepFree, [cellOf(14, 10)]);
  const now = await state(page);
  assert.equal(now.focus, 'plan');
  assert.deepEqual(now.cursor, [14, 10]);
  // and "No step here" takes it off again
  await page.keyboard.press('ContextMenu');
  await page.waitForSelector('.menu[role="menu"]');
  assert.ok((await page.$$eval('.menu [role="menuitem"]', (all) => all.map((item) => item.textContent.trim()))).includes('No step here'));
  // "N" jumps to the next item that starts with it: "Name this corridor…" first, then "No step here"
  await page.keyboard.press('n');
  assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), 'Name this corridor…');
  await page.keyboard.press('n');
  assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), 'No step here');
  await page.keyboard.press('Enter');
  await saidIs('Took the step off the cell.');
  assert.deepEqual((await building()).floors[0].notStepFree || [], []);
});

test('a name typed into a corridor, a refuge or an exit shows as typed in the new lists', async () => {
  const ids = await floorIds();
  await act('nameCorridor', { floorId: ids[0], cells: [cellOf(16, 10), cellOf(17, 10)], name: '"North" <i>Hall</i> & Co' });
  await act('setStepCells', { floorId: ids[0], cells: [cellOf(16, 10), cellOf(17, 10)], stepFree: false });
  await openFloor(0);
  await tab('floor');
  await page.waitForFunction(() => document.querySelector('#floor-steps li') !== null);
  const lines = await page.$$eval('#floor-steps li .bi-row__text', (all) => all.map((p) => p.textContent));
  assert.ok(lines.includes('A step on "North" <i>Hall</i> & Co, 2 cells'), lines.join(' | '));
  assert.equal(await page.$$eval('#floor-steps i', (all) => all.length), 0);
});

// ---------------------------------------------------------------- 390 px, by touch

// A finger: the browser's own touch pipeline, so the page gets real touch Pointer Events.
async function finger(phone, cdp, type, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y), id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
}

// The middle of the first element that matches and has these words (any, when none are given),
// brought into view, and checked: nothing covers its middle, and a finger can hit it (44 px).
async function target(phone, selector, words) {
  const at = await phone.evaluate((wanted, label) => {
    const el = Array.from(document.querySelectorAll(wanted)).find((each) => label === undefined || each.textContent.trim() === label);
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const box = el.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, width: box.width, height: box.height, covered: !(hit && (hit === el || el.contains(hit) || hit.contains(el))), on: hit ? hit.tagName.toLowerCase() + (hit.id ? '#' + hit.id : '') : 'nothing' };
  }, selector, words);
  assert.ok(at, 'nothing matches ' + selector + (words ? ' "' + words + '"' : ''));
  assert.equal(at.covered, false, selector + ' is covered by ' + at.on);
  return at;
}

async function tapOn(phone, cdp, selector, words, options) {
  const at = await target(phone, selector, words);
  if (!options || options.size !== false) assert.ok(Math.min(at.width, at.height) >= 44, selector + (words ? ' "' + words + '"' : '') + ' is ' + Math.round(at.width) + ' by ' + Math.round(at.height) + ' px: under a finger\'s 44');
  await finger(phone, cdp, 'touchStart', at.x, at.y);
  await finger(phone, cdp, 'touchEnd');
  return at;
}

// A finger held on a cell until the page opens its menu.
async function holdOn(phone, cdp, cell) {
  const at = await point(phone, cell % WIDTH, Math.floor(cell / WIDTH));
  await finger(phone, cdp, 'touchStart', at.x, at.y);
  await phone.waitForSelector('.menu[role="menu"]');
  await finger(phone, cdp, 'touchEnd');
}

test('at 390 px with touch: a stop\'s Properties, the car-wide tick, Marks…, Select this corridor and the counted tick, each target 44 px, no pointer but a finger', async () => {
  const phone = await openPlanner({ hash: '#building', width: 390, height: 844, mobile: true });
  const kept = page;
  page = phone.page;
  try {
    const cdp = typeof page.createCDPSession === 'function' ? await page.createCDPSession() : await page.context().newCDPSession(page);
    // a touch device: a coarse pointer, said again if opening the planner cost it
    if (!(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) && typeof page.setViewport === 'function') {
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    }
    assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), true, 'the page has no coarse pointer');
    await startEmpty(page);
    await page.evaluate(async () => {
      const actions = await import('./engine/actions.js');
      const { store } = globalThis.sv2;
      store.apply(actions.addFloor, { likeFloorId: store.project.building.floors[0].id });
      const floors = store.project.building.floors;
      for (const floor of floors) {
        store.apply(actions.paintCorridor, { floorId: floor.id, from: 10 * 40 + 5, to: 10 * 40 + 20 });
        store.apply(actions.placeLift, { floorId: floor.id, cells: [10 * 40 + 22] });
      }
      store.apply(actions.connectStairs, { a: { floorId: floors[0].id, cell: 10 * 40 + 22 }, b: { floorId: floors[1].id, cell: 10 * 40 + 22 } });
    });
    await planReady(page);
    await still(page);
    await page.evaluate(() => {
      globalThis.pointerTypes = [];
      document.addEventListener('pointerdown', (event) => globalThis.pointerTypes.push(event.pointerType), true);
    });
    const car = (await building()).connections.find((connection) => connection.kind === 'elevator').car;

    // long-press the stop, tap its Properties
    await holdOn(page, cdp, STOP);
    await tapOn(page, cdp, '.menu [role="menuitem"]', 'Properties of elevator ' + car);
    await page.waitForFunction(() => document.getElementById('inspector').dataset.open === 'true');
    await page.waitForFunction(() => document.querySelector('#inspector-properties [data-key="panel-title"]')?.textContent.startsWith('Elevator'));
    assert.equal(await text('#stop-floors'), 'Stops at Floor 1 and Floor 2.');
    // the targets of the panel, each a finger's size
    for (const selector of ['#cell-marks', '#inspector-properties [data-action="stop-connect"]', '#stop-others [data-action="show-stop"]', '#stop-others [data-action="disconnect-stop"]']) {
      const at = await target(page, selector);
      assert.ok(Math.min(at.width, at.height) >= 44, selector + ' is ' + Math.round(at.width) + ' by ' + Math.round(at.height) + ' px');
    }
    const row = await target(page, '#inspector-properties .bi-check');
    assert.ok(row.height >= 44, 'the tick\'s row is ' + Math.round(row.height) + ' px tall');
    // the car-wide tick, by a finger on its words
    const before = await entries();
    await tapOn(page, cdp, 'label[for="stop-staff-only"]', undefined, { size: false });
    await saidIs('Applied to 2 stops.');
    assert.equal(await entries(), before + 1);
    assert.equal((await building()).connections.find((connection) => connection.kind === 'elevator').staffOnly === true, false);
    // Marks… opens the cell's menu under the finger's reach, and a tap on an item acts
    await tapOn(page, cdp, '#cell-marks');
    await page.waitForSelector('.menu[role="menu"]');
    const items = await page.$$eval('.menu [role="menuitem"]', (all) => all.map((item) => item.textContent.trim()));
    assert.ok(items.includes('Connect to another floor…'), items.join(' | '));
    assert.ok(await page.$$eval('.menu [role="menuitem"]', (all) => all.every((item) => item.getBoundingClientRect().height >= 40)), 'the menu\'s items are a finger\'s height');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('.menu[role="menu"]') === null);

    // a corridor: the sheet is folded by its handle, a long-press asks for the cell's Properties
    await tapOn(page, cdp, '#inspector-toggle', undefined, { size: false });
    await page.waitForFunction(() => document.getElementById('inspector').dataset.open !== 'true');
    await holdOn(page, cdp, cellOf(12, 10));
    await tapOn(page, cdp, '.menu [role="menuitem"]', 'Properties of this cell');
    await page.waitForFunction(() => document.getElementById('inspector').dataset.open === 'true');
    await page.waitForFunction(() => document.querySelector('#inspector-properties [data-key="panel-title"]')?.textContent === 'Corridor cell');
    await tapOn(page, cdp, '#inspector-properties [data-action="select-corridor"]');
    await saidIs('Selected the stretch of corridor between junctions, 16 cells.');
    await page.waitForFunction(() => document.getElementById('cell-step') !== null && document.querySelector('#inspector-properties [data-key="panel-title"]').textContent === '16 cells selected');
    await tapOn(page, cdp, 'label[for="cell-step"]', undefined, { size: false });
    await saidIs('Marked 16 cells.');
    assert.equal((await building()).floors[0].notStepFree.length, 16);
    // an area of refuge from Marks…
    await tapOn(page, cdp, '#cell-marks');
    await page.waitForSelector('.menu[role="menu"]');
    await tapOn(page, cdp, '.menu [role="menuitem"]', 'Make this an area of refuge');
    await saidIs('Made the cell Area of refuge, an area of refuge.');
    assert.equal((await building()).floors[0].refuges.length, 1);
    // every pointer the page saw was a finger
    const types = await page.evaluate(() => globalThis.pointerTypes);
    assert.ok(types.length > 0 && types.every((type) => type === 'touch'), 'pointers: ' + types.join(', '));
  } finally {
    page = kept;
    await phone.close();
  }
});

test('the page made no error and no request outside its own folder', async () => {
  const problems = session.problems();
  assert.deepEqual(problems.errors, []);
  assert.equal(session.offsite.length, 0);
});
