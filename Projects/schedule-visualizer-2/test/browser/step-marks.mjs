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
  // several cells: the menu is about one cell, so Marks… is not offered (the Step tick covers the selection)
  assert.equal(await exists('#cell-marks'), false, 'no Marks… with 16 cells selected');
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
  // a native checkbox with `indeterminate` is "mixed" to a screen reader: no aria-checked of its own to fall out of step
  assert.equal(await page.$eval('#cell-step', (el) => el.hasAttribute('aria-checked')), false);
  // a refused commit: the tick goes back mixed (not plain), still unchecked
  await page.evaluate(() => {
    const { store } = globalThis.sv2;
    globalThis.realApply = store.apply;
    store.apply = () => {
      throw new Error('Refused on purpose.');
    };
  });
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('#inspector-properties .field__refusal:not([hidden])') !== null);
  await page.evaluate(() => {
    globalThis.sv2.store.apply = globalThis.realApply;
  });
  assert.deepEqual(await page.$eval('#cell-step', (el) => ({ checked: el.checked, indeterminate: el.indeterminate, aria: el.hasAttribute('aria-checked') })), { checked: false, indeterminate: true, aria: false }, 'a refused tick is mixed again');
  assert.equal((await building()).floors[0].notStepFree.length, 15, 'nothing was changed');
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
  assert.match(await text('#refuge-used'), /^(Used by \d+ rooms?\.|Not used by any room\.)$/, 'the refuge says how many rooms use it');
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
  assert.deepEqual(lines, ['Area of refuge, Gym <b>door</b> lawn', 'Area of refuge 2'], 'describeFloor\'s words: a name that already says it stands alone');
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

// ---------------------------------------------------------------- the focus after a change that replaces its button

// Take every step and every area of refuge off the first floor, through the actions.
async function bare() {
  await page.evaluate(async () => {
    const actions = await import('./engine/actions.js');
    const { store } = globalThis.sv2;
    const floor = store.project.building.floors[0];
    if ((floor.notStepFree || []).length > 0) store.apply(actions.setStepCells, { floorId: floor.id, cells: floor.notStepFree.slice(), stepFree: true });
    for (const refuge of (store.project.building.floors[0].refuges || []).slice()) store.apply(actions.removeRefuge, { floorId: floor.id, refugeId: refuge.id });
  });
}

// Press Enter on a control that has the focus; wait until the store holds `count` undo entries more.
async function pressOn(selector, entriesMore) {
  const before = await entries();
  await page.focus(selector);
  await page.keyboard.press('Enter');
  await page.waitForFunction((count) => globalThis.sv2.store.history.past.length === count, {}, before + entriesMore);
}

test('Remove refuge and Make refuge in a cell\'s Properties: the focus goes to the panel title, then to the new name field', async () => {
  await bare();
  await openFloor(0);
  const ids = await floorIds();
  await act('addRefuge', { floorId: ids[0], cell: cellOf(10, 10) });
  await propertiesOf(cellOf(10, 10), 'Properties of this cell');
  await pressOn('#inspector-properties [data-action="remove-refuge"]', 1);
  await page.waitForFunction(() => document.querySelector('#inspector-properties [data-action="make-refuge"]') !== null);
  assert.equal((await focusIs()).key, 'panel-title', 'after Remove the focus is on the panel\'s title, not the page');
  await pressOn('#inspector-properties [data-action="make-refuge"]', 1);
  await page.waitForFunction(() => document.getElementById('refuge-name') !== null);
  assert.equal((await focusIs()).id, 'refuge-name', 'after Make the focus is on the new area\'s name field');
  await act('removeRefuge', { floorId: ids[0], refugeId: (await building()).floors[0].refuges[0].id });
});

test('Disconnect in a stop\'s Properties: the focus goes to the next row\'s Disconnect, else to the panel title', async () => {
  await openFloor(1);
  const ids = await floorIds();
  const car = (await building()).connections.find((connection) => connection.kind === 'elevator').car;
  await propertiesOf(STOP, 'Properties of elevator ' + car);
  assert.deepEqual(await page.$$eval('#stop-others li .bi-row__text', (all) => all.map((el) => el.textContent)), ['Floor 1', 'Floor 3']);
  // Floor 1 goes; Floor 3 is still joined, and its row takes the focus
  await pressOn('#stop-others [data-key="disconnect-stop:' + ids[0] + '"]', 1);
  await page.waitForFunction(() => document.querySelectorAll('#stop-others li').length === 1);
  assert.equal((await focusIs()).key, 'disconnect-stop:' + ids[2]);
  await page.evaluate(() => globalThis.sv2.store.undo());
  await page.waitForFunction(() => document.querySelectorAll('#stop-others li').length === 2);
  // from Floor 1, Floor 2's row cuts both: no row is left and the title takes the focus
  await openFloor(0);
  await propertiesOf(STOP, 'Properties of elevator ' + car);
  await pressOn('#stop-others [data-key="disconnect-stop:' + ids[1] + '"]', 1);
  await page.waitForFunction(() => document.getElementById('stop-others') === null);
  assert.equal((await focusIs()).key, 'panel-title');
  await page.evaluate(() => globalThis.sv2.store.undo());
  await page.waitForFunction(() => globalThis.sv2.store.project.building.connections.filter((connection) => connection.kind === 'elevator').length === 2);
});

test('Clear the step on the Floor tab: the focus goes to the next row\'s button, else to the floor name', async () => {
  await bare();
  await openFloor(0);
  const ids = await floorIds();
  await act('setStepCells', { floorId: ids[0], cells: [cellOf(6, 10)], stepFree: false });
  await act('setStepCells', { floorId: ids[0], cells: [cellOf(12, 10)], stepFree: false });
  await tab('floor');
  await page.waitForFunction(() => document.querySelectorAll('#floor-steps li').length === 2);
  await pressOn('#floor-steps [data-key="clear-step:' + cellOf(6, 10) + '"]', 1);
  await page.waitForFunction(() => document.querySelectorAll('#floor-steps li').length === 1);
  assert.equal((await focusIs()).key, 'clear-step:' + cellOf(12, 10));
  await pressOn('#floor-steps [data-key="clear-step:' + cellOf(12, 10) + '"]', 1);
  await page.waitForFunction(() => document.getElementById('floor-no-steps').hidden === false);
  assert.equal((await focusIs()).id, 'floor-name');
});

test('Remove on the Exits tab\'s refuge rows: the focus goes to the next row\'s Remove, else to the Exits title', async () => {
  await bare();
  const ids = await floorIds();
  await act('addRefuge', { floorId: ids[0], cell: cellOf(10, 10) });
  await act('addRefuge', { floorId: ids[0], cell: cellOf(11, 10) });
  const refuges = (await building()).floors[0].refuges;
  await tab('exits');
  await page.waitForFunction(() => document.querySelectorAll('#exits-refuge-list li').length === 2);
  await pressOn('#exits-refuge-list [data-key="remove-refuge:' + refuges[0].id + '"]', 1);
  await page.waitForFunction(() => document.querySelectorAll('#exits-refuge-list li').length === 1);
  assert.equal((await focusIs()).key, 'remove-refuge:' + refuges[1].id, 'the next row\'s Remove, so the next one can be taken off too');
  await pressOn('#exits-refuge-list [data-key="remove-refuge:' + refuges[1].id + '"]', 1);
  await page.waitForFunction(() => document.querySelectorAll('#exits-refuge-list li').length === 0);
  assert.equal((await focusIs()).key, 'panel-title');
});

// ---------------------------------------------------------------- names, counts and words

// The accessible names of the buttons, inputs, selects and links in a panel, as the page would give them.
function namesIn(selector) {
  return page.evaluate((root) => {
    const words = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
    const nameOf = (el) => {
      if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
      const by = el.getAttribute('aria-labelledby');
      if (by) return by.split(/\s+/).map((id) => words(document.getElementById(id))).join(' ');
      if (el.labels && el.labels.length > 0) return Array.from(el.labels).map(words).join(' ');
      return words(el);
    };
    return Array.from(document.querySelector(root).querySelectorAll('button, input, select, textarea, a[href]'))
      .filter((el) => !el.closest('[hidden]') && el.getClientRects().length > 0 && el.type !== 'hidden')
      .map((el) => ({ name: nameOf(el), visible: el.tagName === 'BUTTON' || el.tagName === 'A' ? words(el) : el.labels && el.labels.length > 0 ? words(el.labels[0]) : '' }));
  }, selector);
}

// No two controls of a panel have one name, and a name that has a visible label says it.
function assertNamed(list, where) {
  const names = list.map((entry) => entry.name);
  assert.ok(names.length > 0, where + ' has no controls');
  assert.deepEqual(names.filter((name, index) => names.indexOf(name) !== index), [], where + ': two controls are called the same');
  assert.deepEqual(names.filter((name) => name.trim() === ''), [], where + ': a control has no name');
  for (const entry of list) {
    if (entry.visible !== '') assert.ok(entry.name.toLowerCase().includes(entry.visible.toLowerCase()), where + ': "' + entry.name + '" does not contain the visible "' + entry.visible + '"');
  }
}

test('accessible names are unique in the Floor tab, the Exits tab, a stop\'s Properties and a room\'s doors, and contain what is visible', async () => {
  await bare();
  const ids = await floorIds();
  await openFloor(0);
  // two unconnected stops on the first floor, two refuges, two exits, two steps
  await act('placeLift', { floorId: ids[0], cells: [cellOf(24, 10), cellOf(26, 10)] });
  await act('addRefuge', { floorId: ids[0], cell: cellOf(10, 10) });
  await act('addRefuge', { floorId: ids[0], cell: cellOf(11, 10) });
  await act('markExit', { floorId: ids[0], cell: cellOf(20, 10), doorName: 'Door B' });
  await act('setStepCells', { floorId: ids[0], cells: [cellOf(6, 10)], stepFree: false });
  await act('setStepCells', { floorId: ids[0], cells: [cellOf(12, 10)], stepFree: false });
  await tab('floor');
  await page.waitForFunction(() => document.querySelectorAll('#floor-steps li').length === 4 && document.querySelectorAll('#floor-elevators li').length === 3);
  assertNamed(await namesIn('#inspector-floor'), 'the Floor tab');
  await tab('exits');
  await page.waitForFunction(() => document.querySelectorAll('#exits-list li').length === 2);
  assertNamed(await namesIn('#inspector-exits'), 'the Exits tab');
  // a stop's Properties, a room's doors
  const car = (await building()).connections.find((connection) => connection.kind === 'elevator').car;
  await openFloor(1);
  await propertiesOf(STOP, 'Properties of elevator ' + car);
  assertNamed(await namesIn('#inspector-properties'), 'a stop\'s Properties');
  await openFloor(0);
  await page.evaluate(() => {
    const editor = document.querySelector('.bld').editor;
    editor.select([editor.floor.spaces.find((space) => space.number === '101').id]);
  });
  await tab('properties');
  await page.waitForSelector('#room-doors li');
  assertNamed(await namesIn('#inspector-properties'), 'a room\'s Properties');
});

test('two unconnected stops on a floor are told apart by their column, and each refuge name field says where its area is', async () => {
  await tab('floor');
  const rows = await page.$$eval('#floor-elevators li[data-connected="false"] .bi-row__text', (all) => all.map((el) => el.textContent));
  assert.deepEqual(rows, ['Floor 1 stop at column 25, row 11: not connected', 'Floor 1 stop at column 27, row 11: not connected']);
  assert.deepEqual(await page.$$eval('#floor-elevators li[data-connected="false"] [data-action="show-stop"]', (all) => all.map((el) => el.getAttribute('aria-label'))), ['Show me: the elevator stop at column 25, row 11', 'Show me: the elevator stop at column 27, row 11']);
  await tab('exits');
  const labels = await page.$$eval('#exits-refuge-list input.field__input', (all) => all.map((el) => el.getAttribute('aria-label')));
  assert.deepEqual(labels, ['Name of the area of refuge at column 11, row 11 on Floor 1', 'Name of the area of refuge at column 12, row 11 on Floor 1']);
  assert.equal(await page.$eval('#exits-refuge-list li:first-child [data-action="remove-refuge"]', (el) => el.getAttribute('aria-label')), 'Remove Area of refuge, area of refuge', 'the accessible name holds the visible "Remove"');
});

test('the Floor tab\'s rows are kept while a floor is renamed and resized, and their words and labels tell the floor as it is', async () => {
  const ids = await floorIds();
  await openFloor(0);
  await tab('floor');
  await page.waitForFunction(() => document.querySelectorAll('#floor-elevators li[data-connected="false"]').length === 2);
  const row = () => page.$eval('#floor-elevators li[data-connected="false"] .bi-row__text', (el) => el.textContent);
  const label = () => page.$eval('#floor-elevators li[data-connected="false"] [data-action="show-stop"]', (el) => el.getAttribute('aria-label'));
  const size = () => page.evaluate(() => ({ width: globalThis.sv2.store.project.building.floors[0].width, height: globalThis.sv2.store.project.building.floors[0].height }));
  const first = await size();
  assert.equal(await row(), 'Floor 1 stop at column 25, row 11: not connected');
  // the row stays (the stop is the same one) while the name changes under it
  await act('renameFloor', { id: ids[0], name: 'Annex' });
  await page.waitForFunction(() => document.querySelector('#floor-elevators li[data-connected="false"] .bi-row__text')?.textContent.startsWith('Annex'));
  assert.equal(await row(), 'Annex stop at column 25, row 11: not connected');
  // more rows at the bottom: the stop keeps its cell number and its place
  await act('resizeFloor', { floorId: ids[0], bottom: 5 });
  await page.waitForFunction((height) => globalThis.sv2.store.project.building.floors[0].height === height, {}, first.height + 5);
  assert.equal(await label(), 'Show me: the elevator stop at column 25, row 11');
  // cells added at the left: the stop is in a new column, and its label says so
  await act('resizeFloor', { floorId: ids[0], left: 4 });
  await page.waitForFunction((width) => globalThis.sv2.store.project.building.floors[0].width === width, {}, first.width + 4);
  await page.waitForFunction(() => document.querySelector('#floor-elevators li[data-connected="false"] [data-action="show-stop"]')?.getAttribute('aria-label').endsWith('column 29, row 11'));
  assert.equal(await label(), 'Show me: the elevator stop at column 29, row 11');
  assert.equal(await row(), 'Annex stop at column 29, row 11: not connected');
  for (let n = 0; n < 3; n += 1) await page.evaluate(() => globalThis.sv2.store.undo());
  await page.waitForFunction((width) => globalThis.sv2.store.project.building.floors[0].name === 'Floor 1' && globalThis.sv2.store.project.building.floors[0].width === width, {}, first.width);
});

test('the menu on a middle stop names the other floor in each Disconnect, and the words say it', async () => {
  await openFloor(1);
  const car = (await building()).connections.find((connection) => connection.kind === 'elevator').car;
  const items = (await menuOn(STOP)).filter((item) => item.startsWith('Disconnect'));
  assert.deepEqual(items, ['Disconnect Elevator ' + car + ' from Floor 1', 'Disconnect Elevator ' + car + ' from Floor 3']);
  await choose('Disconnect Elevator ' + car + ' from Floor 3');
  await saidIs('Disconnected Elevator ' + car + ' from Floor 3. The stop stays where it is.');
  await page.evaluate(() => globalThis.sv2.store.undo());
  await page.waitForFunction(() => globalThis.sv2.store.project.building.connections.filter((connection) => connection.kind === 'elevator').length === 2);
});

test('"Used by N rooms" is part of the panel: a room that leaves through the refuge counts, and a tick elsewhere redraws the number', async () => {
  await bare();
  const ids = await floorIds();
  await openFloor(0);
  // the one exit has a step outside its door, so Room 101 can leave step-free only through the refuge
  const exits = (await building()).floors[0].exits;
  for (const exit of exits) if (exit.doorName !== 'Door A') await act('unmarkExit', { floorId: ids[0], exitId: exit.id });
  const doorA = (await building()).floors[0].exits[0];
  await act('setExitStepFree', { floorId: ids[0], exitId: doorA.id, stepFree: false });
  await act('addRefuge', { floorId: ids[0], cell: cellOf(8, 10) });
  await propertiesOf(cellOf(8, 10), 'Properties of this cell');
  await page.waitForFunction(() => document.getElementById('refuge-used') !== null);
  assert.equal(await text('#refuge-used'), 'Used by 1 room.');
  // the refuge's own Properties: unique names, and "Remove <name>" says its visible words
  assertNamed(await namesIn('#inspector-properties'), 'a refuge\'s Properties');
  // the exit is ticked step-free elsewhere (as the Exits tab does): the panel redraws with no room using the refuge
  await act('setExitStepFree', { floorId: ids[0], exitId: doorA.id, stepFree: true });
  await page.waitForFunction(() => document.getElementById('refuge-used')?.textContent === 'Not used by any room.');
  await act('setExitStepFree', { floorId: ids[0], exitId: doorA.id, stepFree: false });
  await page.waitForFunction(() => document.getElementById('refuge-used')?.textContent === 'Used by 1 room.');
  await act('setExitStepFree', { floorId: ids[0], exitId: doorA.id, stepFree: true });
  await bare();
});

test('the Floor tab\'s rows, and the door and exit ticks, are 44 px at a mouse too', async () => {
  const heights = (selector) => page.$$eval(selector, (all) => all.map((el) => {
    const box = el.getBoundingClientRect();
    return { name: (el.getAttribute('aria-label') || el.textContent).slice(0, 40), width: Math.round(box.width), height: Math.round(box.height) };
  }));
  const bigEnough = (list, where) => assert.deepEqual(list.filter((each) => each.height < 44 || each.width < 44), [], where + ' has a target under 44 px');
  assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), false, 'this page has a mouse');
  await openFloor(0);
  await tab('floor');
  await page.waitForFunction(() => document.querySelector('#floor-elevators li') !== null);
  bigEnough(await heights('#floor-elevators .bi-small, #floor-steps .bi-small, #floor-connections .bi-small'), 'the Floor tab\'s lists');
  assert.ok((await heights('#floor-elevators .bi-small')).length > 0);
  await tab('exits');
  await page.waitForFunction(() => document.querySelector('#exits-list li') !== null);
  bigEnough(await heights('#exits-list .bi-small'), 'the Exits tab\'s exits');
  assert.deepEqual((await heights('#exits-list .bi-check')).filter((each) => each.height < 44), [], 'the exit ticks\' rows are 44 px');
  assert.ok((await page.$$eval('#exits-list .bi-check__label', (all) => all.every((el) => el.getBoundingClientRect().height >= 36))), 'the label, which is the target, is tall');
  await page.evaluate(() => {
    const editor = document.querySelector('.bld').editor;
    editor.select([editor.floor.spaces.find((space) => space.number === '101').id]);
  });
  await tab('properties');
  await page.waitForSelector('#room-doors li');
  bigEnough(await heights('#room-doors .bi-small'), 'the door rows\' Remove');
  assert.deepEqual((await heights('#room-doors .bi-check')).filter((each) => each.height < 44), [], 'the door ticks\' rows are 44 px');
  assert.deepEqual((await heights('#room-doors li')).filter((each) => each.height < 44), []);
  // nothing in the panel spills sideways at 1280
  assert.equal(await page.evaluate(() => { const el = document.querySelector('#inspector-properties'); return el.scrollWidth <= el.clientWidth; }), true);
});

test('a markup-looking elevator letter shows as text in the panel, the menu and the Floor tab', async () => {
  const letter = '<b>E</b> & "x"';
  // a loaded file may carry any letter: the car's letter is written into its connections
  await page.evaluate((typed) => {
    const { store } = globalThis.sv2;
    const project = JSON.parse(JSON.stringify(store.project));
    for (const connection of project.building.connections) if (connection.kind === 'elevator') connection.car = typed;
    store.replace(project);
  }, letter);
  await page.waitForFunction((typed) => globalThis.sv2.store.project.building.connections.some((connection) => connection.car === typed), {}, letter);
  await openFloor(1);
  await propertiesOf(STOP, 'Properties of elevator ' + letter);
  assert.equal(await panelTitle(), 'Elevator ' + letter);
  assert.equal(await page.$$eval('#inspector-properties b, #inspector-properties i', (all) => all.length), 0, 'the panel shows it as text');
  const items = await menuOn(STOP);
  assert.ok(items.includes('Disconnect Elevator ' + letter + ' from Floor 1'), items.join(' | '));
  assert.equal(await page.$$eval('.menu b', (all) => all.length), 0, 'the menu shows it as text');
  await page.keyboard.press('Escape');
  await tab('floor');
  await page.waitForFunction(() => document.querySelector('#floor-elevators li') !== null);
  assert.equal(await text('#floor-elevators li .bi-row__text'), 'Elevator ' + letter + ': Floor 1, Floor 2 and Floor 3 \u00b7 staff only');
  assert.equal(await page.$$eval('#inspector-floor b', (all) => all.length), 0);
  assert.equal(await page.$$eval('#floor-elevators li button', (all) => all.some((button) => button.getAttribute('aria-label').includes('<b>'))), false, 'the names are never parsed as markup');
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
    await still(page);
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
    // several cells are selected: Marks… is not offered. One cell: it is
    assert.equal(await page.$('#cell-marks'), null, 'no Marks… with 16 cells selected');
    await page.evaluate(async (floorId, cell) => {
      const { focusCells } = await import('./ui/building/inspector/cell-focus.js');
      focusCells(document.querySelector('.bld').editor, floorId, [cell]);
    }, (await floorIds())[0], cellOf(12, 10));
    await page.waitForFunction(() => document.querySelector('#inspector-properties [data-key="panel-title"]')?.textContent === 'Corridor cell' && document.getElementById('cell-marks') !== null);
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

test('at 390 px with touch: the Floor tab, the door and exit ticks, the Exits tab and Remove are each 44 px and work by a finger, and nothing scrolls sideways', async () => {
  const phone = await openPlanner({ hash: '#building', width: 390, height: 844, mobile: true });
  const kept = page;
  page = phone.page;
  try {
    const cdp = typeof page.createCDPSession === 'function' ? await page.createCDPSession() : await page.context().newCDPSession(page);
    if (!(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) && typeof page.setViewport === 'function') {
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    }
    assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), true, 'the page has no coarse pointer');
    await startEmpty(page);
    await page.evaluate(async () => {
      const actions = await import('./engine/actions.js');
      const { store } = globalThis.sv2;
      const floor = store.project.building.floors[0];
      store.apply(actions.paintCorridor, { floorId: floor.id, from: 10 * 40 + 5, to: 10 * 40 + 20 });
      store.apply(actions.placeLift, { floorId: floor.id, cells: [10 * 40 + 22, 10 * 40 + 24] });
      store.apply(actions.placeRoom, { floorId: floor.id, rect: { x: 5, y: 7, w: 4, h: 3 }, number: '101' });
      const room = store.project.building.floors[0].spaces.find((space) => space.number === '101');
      store.apply(actions.addDoor, { roomId: room.id, cell: 9 * 40 + 6, side: 's' });
      store.apply(actions.addDoor, { roomId: room.id, cell: 9 * 40 + 7, side: 's' });
      store.apply(actions.markExit, { floorId: floor.id, cell: 10 * 40 + 5, doorName: 'Door A' });
      store.apply(actions.markExit, { floorId: floor.id, cell: 10 * 40 + 20, doorName: 'Door B' });
      store.apply(actions.addRefuge, { floorId: floor.id, cell: 10 * 40 + 10 });
      store.apply(actions.addRefuge, { floorId: floor.id, cell: 10 * 40 + 11 });
      store.apply(actions.setStepCells, { floorId: floor.id, cells: [10 * 40 + 14], stepFree: false });
      store.apply(actions.setStepCells, { floorId: floor.id, cells: [10 * 40 + 17], stepFree: false });
    });
    await planReady(page);
    await still(page);
    await page.evaluate(() => {
      globalThis.pointerTypes = [];
      document.addEventListener('pointerdown', (event) => globalThis.pointerTypes.push(event.pointerType), true);
    });
    const noSideways = async (where) => {
      const wide = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth - window.innerWidth,
        panels: Array.from(document.querySelectorAll('.bld-inspector__panel')).filter((el) => el.getClientRects().length > 0).map((el) => el.scrollWidth - el.clientWidth),
      }));
      assert.ok(wide.page <= 0, where + ': the page scrolls sideways by ' + wide.page + ' px');
      assert.ok(wide.panels.every((extra) => extra <= 0), where + ': a panel scrolls sideways: ' + wide.panels.join(', '));
    };
    const small = async (selector) => {
      const all = await page.$$eval(selector, (list) => list.map((el) => {
        el.scrollIntoView({ block: 'center' });
        const box = el.getBoundingClientRect();
        return { name: (el.getAttribute('aria-label') || el.textContent).slice(0, 40), width: Math.round(box.width), height: Math.round(box.height) };
      }));
      assert.ok(all.length > 0, 'nothing matches ' + selector);
      assert.deepEqual(all.filter((each) => each.width < 44 || each.height < 44), [], selector + ' has a target under 44 px');
    };
    const inspector = (id) => page.evaluate((wanted) => document.querySelector('.bld').editor.inspector.showTab(wanted), id);

    // the Floor tab
    await inspector('floor');
    await page.waitForFunction(() => document.querySelectorAll('#floor-steps li').length === 4);
    await small('#floor-elevators .bi-small');
    await small('#floor-steps .bi-small');
    await noSideways('the Floor tab');
    const before = await entries();
    await tapOn(page, cdp, '#floor-steps [data-action="clear-step"]');
    await page.waitForFunction((count) => globalThis.sv2.store.history.past.length === count, {}, before + 1);
    assert.equal((await focusIs()).key.startsWith('clear-step:'), true, 'the focus went to the next step\'s button');

    // a room's doors: each tick's row, its words, Remove
    await page.evaluate(() => {
      const editor = document.querySelector('.bld').editor;
      editor.select([editor.floor.spaces.find((space) => space.number === '101').id]);
    });
    await inspector('properties');
    await page.waitForSelector('#room-doors li');
    await small('#room-doors .bi-small');
    for (const row of await page.$$eval('#room-doors .bi-check', (all) => all.map((el) => Math.round(el.getBoundingClientRect().height)))) assert.ok(row >= 44, 'a door tick\'s row is ' + row + ' px');
    await noSideways('a room\'s Properties');
    const doors = await entries();
    await tapOn(page, cdp, '#room-doors li:first-child .bi-check__label', undefined, { size: false });
    await page.waitForFunction((count) => globalThis.sv2.store.history.past.length === count, {}, doors + 1);
    assert.equal((await building()).floors[0].spaces.find((space) => space.number === '101').doors.filter((door) => door.stepFree === false).length, 1);

    // the Exits tab: the exit ticks, Show me and Remove, the refuge rows
    await inspector('exits');
    await page.waitForFunction(() => document.querySelectorAll('#exits-list li').length === 2);
    await small('#exits-list .bi-small');
    await small('#exits-refuge-list .bi-small');
    for (const row of await page.$$eval('#exits-list .bi-check', (all) => all.map((el) => Math.round(el.getBoundingClientRect().height)))) assert.ok(row >= 44, 'an exit tick\'s row is ' + row + ' px');
    await noSideways('the Exits tab');
    await tapOn(page, cdp, '#exits-list li:first-child .bi-check__label', undefined, { size: false });
    await saidIs('The exit has a step outside its door.');
    const refuges = await entries();
    await tapOn(page, cdp, '#exits-refuge-list [data-action="remove-refuge"]');
    await page.waitForFunction((count) => globalThis.sv2.store.history.past.length === count, {}, refuges + 1);
    assert.equal((await building()).floors[0].refuges.length, 1);
    assert.equal((await focusIs()).key.startsWith('remove-refuge:'), true, 'the focus went to the other refuge\'s Remove');
    await tapOn(page, cdp, '#exits-list li:first-child [data-action="remove-exit"]');
    await page.waitForFunction(() => globalThis.sv2.store.project.building.floors[0].exits.length === 1);
    assert.equal((await focusIs()).key.startsWith('remove:'), true, 'the focus went to the other exit\'s Remove');
    await noSideways('the Exits tab after Remove');
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
