// Doors, stairs connections, exits, corridor names, left-out areas and the
// cell's menu, in a real browser: node test/browser/doors-stairs.mjs
//
// The journey: draw two rooms across a corridor, add a door by clicking an
// edge, have a door on the far side refused with the reason, connect stairs
// across floors in connect mode (the banner, a change of floor, Escape), see
// the letter at both ends, connect two stairs on one floor after being asked,
// delete a floor and see its connections go in that one undo step. Then the
// three tools this unit adds (Exit, Name, Leave out) and the menu.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner } from './harness.mjs';
import { startEmpty, point, click, drag, state, wholeFloor, clearToast, floorIs, drawByPointer, PLAN } from './draw-pointer.mjs';

let session;
let page;

const text = (selector) => page.$eval(selector, (el) => el.textContent);
const entries = async () => (await state(page)).entries;
const building = () => page.evaluate(() => JSON.parse(JSON.stringify(globalThis.sv2.store.project.building)));
const room = async (number) => (await building()).floors.flatMap((floor) => floor.spaces).find((space) => space.number === number);
const cellOf = (x, y) => y * 40 + x;
const toastText = () => page.evaluate(() => {
  const toast = document.querySelector('.toast .toast__text');
  return toast ? toast.textContent : null;
});

// A click at a place inside a cell: (0.5, 0.95) is the middle of its south edge.
async function clickAt(x, y, fx, fy, options) {
  const at = await point(page, x, y, fx, fy);
  await page.mouse.click(at.x, at.y, options);
}

// Open the menu on a cell with the right button, and return its entries.
async function menuOn(x, y) {
  await clickAt(x, y, 0.5, 0.5, { button: 'right' });
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

const bannerShown = () => page.$eval('#connect-banner', (el) => !el.hidden);

before(async () => {
  session = await openPlanner({ hash: '#building' });
  page = session.page;
  await startEmpty(page);
  await drawByPointer(page);
  await wholeFloor(page);
});

after(async () => {
  if (session) await session.close();
});

// ---------------------------------------------------------------- doors

test('a click on an edge of the selected room adds a door there, as one undo step', async () => {
  await page.keyboard.press('v');
  await click(page, 6, 8);
  assert.equal((await state(page)).selection.length, 1);
  const before = await entries();
  // Room 101 is columns 5 to 8, rows 7 to 9; the corridor is row 10
  await clickAt(6, 9, 0.5, 0.95);
  const now = await state(page);
  assert.equal(now.entries, before + 1);
  assert.equal(now.label, 'Add a door to Room 101');
  assert.equal(now.said, 'Added a door on the south edge of Room 101.');
  assert.deepEqual((await room('101')).doors, [{ cell: cellOf(6, 9), side: 's' }]);
  assert.equal(await page.$$eval('#room-doors li', (all) => all.length), 1);
  assert.match(await text('#room-doors li'), /On the south edge, column 7, row 10/);
  assert.match(await text('#room-doors-note'), /entered only through this door/);
});

test('a door on the far side is refused, and the refusal says which side and what is there', async () => {
  const before = await entries();
  await clearToast(page);
  await clickAt(6, 7, 0.5, 0.05);
  const now = await state(page);
  assert.equal(now.entries, before, 'a refused door made an undo entry');
  assert.equal(now.toast, 'The north side of that cell faces a wall, so a door there would lead nowhere. Put the door on a side that faces a corridor or stairs.');
  assert.equal(now.said, now.toast);
  assert.equal((await room('101')).doors.length, 1);
  await clearToast(page);
});

test('a click in the middle of the selected room, and a click on an edge of a room that is not selected, add no door', async () => {
  const before = await entries();
  await click(page, 6, 8);
  assert.equal(await entries(), before);
  // Room 102 is not the selected room: the click on its edge selects it, no more
  await clickAt(11, 9, 0.5, 0.95);
  assert.equal(await entries(), before);
  assert.equal((await room('102')).doors.length, 0);
  assert.equal(await text('#inspector-title'), 'Room 102');
});

test('a click on a door removes it, and the Remove button in the inspector does the same', async () => {
  await click(page, 6, 8);
  let before = await entries();
  await clickAt(6, 9, 0.5, 0.95);
  let now = await state(page);
  assert.equal(now.entries, before + 1);
  assert.equal(now.said, 'Removed the door on the south edge of Room 101.');
  assert.equal((await room('101')).doors.length, 0);
  assert.match(await text('#room-doors-note'), /No door is drawn/);
  await clickAt(7, 9, 0.5, 0.95);
  assert.equal((await room('101')).doors.length, 1);
  before = await entries();
  await page.click('#room-doors [data-action="remove-door"]');
  now = await state(page);
  assert.equal(now.entries, before + 1);
  assert.equal(now.label, 'Remove a door from Room 101');
  assert.equal((await room('101')).doors.length, 0);
});

test('the menu of a room cell adds a door on any of its four edges without a pointer, and refuses the same way', async () => {
  await page.focus('#plan');
  await page.evaluate(() => {
    const editor = document.querySelector('.bld').editor;
    editor.cursor.moveTo(8, 9, true);
  });
  await page.keyboard.down('Shift');
  await page.keyboard.press('F10');
  await page.keyboard.up('Shift');
  await page.waitForSelector('.menu[role="menu"]');
  const items = await page.$$eval('.menu [role="menuitem"]', (all) => all.map((item) => item.textContent.trim()));
  assert.deepEqual(items, ['Edit Room 101', 'Add a door on the north edge', 'Add a door on the east edge', 'Add a door on the south edge', 'Add a door on the west edge', 'Delete Room 101']);
  const before = await entries();
  await choose('Add a door on the south edge');
  assert.deepEqual((await room('101')).doors, [{ cell: cellOf(8, 9), side: 's' }]);
  assert.equal(await entries(), before + 1);
  assert.equal((await state(page)).focus, 'plan', 'the focus did not go back to the plan');

  // the east edge of that cell faces nothing: refused, with the reason
  await clearToast(page);
  await page.keyboard.down('Shift');
  await page.keyboard.press('F10');
  await page.keyboard.up('Shift');
  await page.waitForSelector('.menu[role="menu"]');
  assert.ok((await page.$$eval('.menu [role="menuitem"]', (all) => all.map((item) => item.textContent.trim()))).includes('Remove the door on the south edge'), 'the menu does not offer to remove the door that is there');
  await choose('Add a door on the east edge');
  assert.match(await toastText(), /^The east side of that cell faces a wall, so a door there would lead nowhere\./);
  assert.equal(await entries(), before + 1);
  await clearToast(page);
});

// ---------------------------------------------------------------- stairs

test('Connect on a stairs cell starts connect mode: a banner says what to do', async () => {
  // a second floor with stairs of its own, and a corridor to stand them on
  await page.click('#add-floor');
  await floorIs(page, 'Floor 2');
  await wholeFloor(page);
  await page.keyboard.press('c');
  await drag(page, [18, 10], [20, 10]);
  await page.keyboard.press('s');
  await click(page, 21, 10);
  await click(page, 3, 3);
  await page.click('.bld-floors__tab');
  await floorIs(page, 'Floor 1');
  await wholeFloor(page);
  await page.keyboard.press('v');

  const items = await menuOn(PLAN.stairs[0], PLAN.stairs[1]);
  assert.equal(items[0], 'Connect these stairs…');
  assert.equal(await bannerShown(), false);
  await choose('Connect these stairs…');
  assert.equal(await bannerShown(), true);
  assert.equal(await text('#connect-text'), 'Connecting stairs A from Floor 1: click the other stairs, on any floor. Esc cancels.');
  assert.equal((await state(page)).said, await text('#connect-text'));
});

test('connect mode outlives a change of floor, refuses a cell that is not stairs, and ends on Escape with nothing connected', async () => {
  const before = await entries();
  await page.click('.bld-floors__tab[aria-selected="false"]');
  await floorIs(page, 'Floor 2');
  await wholeFloor(page);
  assert.equal(await bannerShown(), true, 'the banner went when the floor changed');
  await clearToast(page);
  await click(page, 19, 10);
  assert.equal(await toastText(), 'That is not a stairs cell. Click the stairs at the other end, on any floor. Esc cancels.');
  assert.equal(await bannerShown(), true);
  assert.equal(await entries(), before, 'a click in connect mode reached the tool in hand');
  await clearToast(page);
  await page.keyboard.press('Escape');
  assert.equal(await bannerShown(), false);
  assert.equal((await state(page)).said, 'Cancelled. No stairs were connected.');
  assert.equal((await building()).connections.length, 0);
  assert.equal(await entries(), before);
});

test('a click on the other stairs, on another floor, connects them as A, in one undo step, and the letter is at both ends', async () => {
  await page.click('.bld-floors__tab');
  await floorIs(page, 'Floor 1');
  await wholeFloor(page);
  await menuOn(PLAN.stairs[0], PLAN.stairs[1]);
  await choose('Connect these stairs…');
  await page.click('.bld-floors__tab[aria-selected="false"]');
  await floorIs(page, 'Floor 2');
  await wholeFloor(page);
  const before = await entries();
  await click(page, 21, 10);
  const now = await state(page);
  assert.equal(now.entries, before + 1);
  assert.equal(now.label, 'Connect stairs A: Floor 1 to Floor 2');
  assert.equal(now.said, 'Connected stairs A: Floor 1 to Floor 2. The letter is on both ends.');
  assert.equal(await bannerShown(), false);
  const made = await building();
  assert.equal(made.connections.length, 1);
  assert.equal(made.connections[0].label, 'A');
  assert.deepEqual([made.connections[0].a.cell, made.connections[0].b.cell], [cellOf(21, 10), cellOf(21, 10)]);
  assert.notEqual(made.connections[0].a.floorId, made.connections[0].b.floorId);

  // the letter at this end, and at the other
  const here = await point(page, 21, 10);
  await page.mouse.move(here.x, here.y);
  assert.match((await state(page)).cell, /Stairs A$/);
  await page.click('#inspector [data-tab="floor"]');
  assert.equal(await page.$eval('#floor-connections input', (el) => el.value), 'A');
  assert.match(await text('#floor-connections li'), /Joins Floor 1 and Floor 2\./);
  await page.click('.bld-floors__tab');
  await floorIs(page, 'Floor 1');
  await wholeFloor(page);
  const there = await point(page, 21, 10);
  await page.mouse.move(there.x, there.y);
  assert.match((await state(page)).cell, /Stairs A$/);
  assert.equal(await page.$eval('#floor-connections input', (el) => el.value), 'A');
});

test('the same two stairs cannot be connected twice, and the refusal names the connection', async () => {
  await menuOn(PLAN.stairs[0], PLAN.stairs[1]);
  await choose('Connect these stairs…');
  await page.click('.bld-floors__tab[aria-selected="false"]');
  await floorIs(page, 'Floor 2');
  await wholeFloor(page);
  await clearToast(page);
  await click(page, 21, 10);
  assert.equal(await toastText(), 'Those two stairs are already connected, as A.');
  assert.equal(await bannerShown(), true, 'a refusal ended connect mode');
  await page.keyboard.press('Escape');
  await clearToast(page);
});

test('two stairs on one floor are connected only after the tool has asked', async () => {
  const before = await entries();
  await menuOn(21, 10);
  await choose('Connect these stairs…');
  assert.equal(await text('#connect-text'), 'Connecting stairs B from Floor 2: click the other stairs, on any floor. Esc cancels.');
  await click(page, 3, 3);
  await page.waitForSelector('dialog.dialog[open]');
  assert.equal(await text('dialog.dialog[open] .dialog__title'), 'Connect two stairs on Floor 2?');
  assert.deepEqual(await page.$$eval('dialog.dialog[open] .dialog__buttons button', (all) => all.map((button) => button.textContent)), ['Connect them on Floor 2', 'Do not connect them']);
  // the safe answer has the focus: Enter keeps things as they are
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('dialog.dialog[open]') === null);
  assert.equal((await building()).connections.length, 1);
  assert.equal(await entries(), before);
  assert.equal(await bannerShown(), true, 'saying no ended connect mode');

  await click(page, 3, 3);
  await page.waitForSelector('dialog.dialog[open]');
  await page.click('dialog.dialog[open] .btn--primary');
  await page.waitForFunction(() => document.querySelector('dialog.dialog[open]') === null);
  const made = await building();
  assert.equal(made.connections.length, 2);
  assert.equal(made.connections[1].label, 'B');
  assert.equal(made.connections[1].a.floorId, made.connections[1].b.floorId);
  assert.equal(await entries(), before + 1);
  assert.equal((await state(page)).label, 'Connect stairs B: two places on Floor 2');
  assert.equal(await bannerShown(), false);
  assert.match(await text('#floor-connections'), /Joins two places on Floor 2: column 22, row 11 and column 4, row 4\./);
});

test('deleting a floor takes its stairs connections with it in the one undo step, and undo brings both back', async () => {
  const before = await entries();
  assert.equal(await text('#floor-delete'), 'Delete Floor 2');
  await page.click('#floor-delete');
  await page.waitForSelector('dialog.dialog[open]');
  assert.equal(await text('dialog.dialog[open] .dialog__title'), 'Delete Floor 2?');
  assert.match(await text('dialog.dialog[open] .dialog__body'), /With it go 2 stairs connections\./);
  await page.click('dialog.dialog[open] .btn--danger');
  await page.waitForFunction(() => document.querySelector('dialog.dialog[open]') === null);
  await floorIs(page, 'Floor 1');
  let made = await building();
  assert.equal(made.floors.length, 1);
  assert.equal(made.connections.length, 0, 'a connection outlived its floor');
  const now = await state(page);
  assert.equal(now.entries, before + 1);
  assert.equal(now.label, 'Delete Floor 2');
  assert.equal(now.said, 'Deleted Floor 2 and 2 stairs connections with it.');
  // the only floor cannot be deleted, and the tab says why
  assert.equal(await page.$eval('#floor-delete', (el) => el.disabled), true);
  assert.equal(await page.$eval('#floor-last', (el) => el.hidden), false);

  await page.click('#undo');
  made = await building();
  assert.equal(made.floors.length, 2);
  assert.deepEqual(made.connections.map((connection) => connection.label), ['A', 'B']);
  assert.equal(await entries(), before);
  await clearToast(page);
});

test('a connection is renamed and disconnected from the Floor tab, and a letter in use is refused', async () => {
  await wholeFloor(page);
  await page.click('#inspector [data-tab="floor"]');
  const before = await entries();
  await page.click('#floor-connections input', { clickCount: 3 });
  await page.keyboard.type('East stairs');
  await page.keyboard.press('Enter');
  assert.equal((await building()).connections[0].label, 'East stairs');
  assert.equal(await entries(), before + 1);
  await page.click('#floor-connections [data-action="disconnect"]');
  assert.equal((await building()).connections.length, 1);
  assert.equal((await state(page)).said, 'Disconnected stairs East stairs.');
  assert.equal(await entries(), before + 2);
  await page.click('#undo');
  await page.click('#undo');
  assert.deepEqual((await building()).connections.map((connection) => connection.label), ['A', 'B']);
  await clearToast(page);
});

// ---------------------------------------------------------------- exits

test('the Exit tool marks a corridor cell on the edge, and the door name is typed at once', async () => {
  await page.keyboard.press('x');
  assert.equal((await state(page)).tool, 'exit');
  const before = await entries();
  await click(page, 5, 10);
  let now = await state(page);
  assert.equal(now.entries, before + 1);
  assert.equal(now.label, 'Mark an exit on Floor 1');
  assert.equal(now.said, 'Marked an exit at column 6, row 11. Type its door name.');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.exit !== undefined), true, 'the door name does not have the focus');
  await page.keyboard.type('Door <B>');
  await page.keyboard.press('Enter');
  now = await state(page);
  assert.equal(now.focus, 'plan', 'Enter did not go back to the plan');
  assert.equal(now.tool, 'exit', 'the Exit tool is no longer in hand');
  assert.deepEqual((await building()).floors[0].exits.map((exit) => [exit.cell, exit.doorName]), [[cellOf(5, 10), 'Door <B>']]);
  assert.equal(await text('#exits-lead'), 'The building has 1 exit.');
  assert.equal(await page.$('#exits-list b'), null, 'a typed door name was read as markup');
});

test('a cell that cannot be an exit is refused, with the reason and what to do', async () => {
  const before = await entries();
  await clearToast(page);
  await click(page, 6, 8);
  assert.equal(await toastText(), 'An exit is on a corridor cell, and that cell is part of a room. Paint a corridor to the building\'s edge and mark its last cell.');
  assert.equal(await entries(), before);
  assert.equal((await building()).floors[0].exits.length, 1);
  await clearToast(page);
});

test('a click on an exit with the Exit tool takes the mark off', async () => {
  const before = await entries();
  await click(page, 5, 10);
  assert.equal((await building()).floors[0].exits.length, 0);
  const now = await state(page);
  assert.equal(now.entries, before + 1);
  assert.equal(now.label, 'Remove the exit Door <B>');
  await page.click('#undo');
  assert.equal((await building()).floors[0].exits.length, 1);
  await clearToast(page);
});

// ---------------------------------------------------------------- corridor names

test('the Name tool names the whole straight run through a clicked cell, in one action', async () => {
  await page.keyboard.press('n');
  const before = await entries();
  await click(page, 12, 10);
  await page.waitForSelector('#corridor-name-dialog[open]');
  assert.equal(await text('#corridor-name-dialog .dialog__title'), 'What is this corridor called?');
  assert.match(await text('#corridor-name-dialog .dialog__body'), /The name goes on 16 corridor cells/);
  await page.keyboard.type('North "Corridor"');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('dialog.dialog[open]') === null);
  const named = (await building()).floors[0].corridors;
  assert.equal(named.length, 1);
  assert.equal(named[0].name, 'North "Corridor"');
  assert.equal(named[0].cells.length, 16);
  const now = await state(page);
  assert.equal(now.entries, before + 1);
  assert.equal(now.said, 'Named 16 corridor cells North "Corridor".');
  assert.equal(now.focus, 'plan');
});

test('a drag with the Name tool names just those cells, which leave the name they had; Escape in the dialog changes nothing', async () => {
  let before = await entries();
  await drag(page, [5, 10], [7, 10]);
  await page.waitForSelector('#corridor-name-dialog[open]');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('dialog.dialog[open]') === null);
  assert.equal(await entries(), before);
  assert.equal((await state(page)).said, 'The corridor was left as it is.');

  await drag(page, [5, 10], [7, 10]);
  await page.waitForSelector('#corridor-name-dialog[open]');
  assert.equal(await page.$eval('#ask-text', (el) => el.value), 'North "Corridor"', 'the name the cells have is not offered');
  await page.keyboard.type('West end');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('dialog.dialog[open]') === null);
  const named = (await building()).floors[0].corridors;
  assert.deepEqual(named.map((corridor) => [corridor.name, corridor.cells.length]).sort(), [['North "Corridor"', 13], ['West end', 3]]);
  assert.equal(await entries(), before + 1);

  // renamed, and taken off, from the Floor tab
  await page.click('#inspector [data-tab="floor"]');
  assert.equal(await page.$$eval('#floor-corridors li', (all) => all.length), 2);
  before = await entries();
  await page.click('#floor-corridors [data-action="unname"]');
  assert.equal((await building()).floors[0].corridors.length, 1);
  assert.equal(await entries(), before + 1);
  await clearToast(page);
});

// ---------------------------------------------------------------- left-out areas

test('the Leave out tool draws an area that is left out of the colour scale, and its label is typed at once', async () => {
  await page.keyboard.press('z');
  assert.equal((await state(page)).tool, 'zone');
  const before = await entries();
  await drag(page, [14, 9], [16, 11]);
  let now = await state(page);
  assert.equal(now.entries, before + 1);
  assert.equal(now.label, 'Add an exclusion zone on Floor 1');
  assert.equal(now.said, 'Left 3 by 3 squares out of the colour scale. Type a label for the area.');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.zone !== undefined), true, 'the label does not have the focus');
  await page.keyboard.type('Gym doors');
  await page.keyboard.press('Enter');
  now = await state(page);
  assert.equal(now.focus, 'plan');
  assert.equal(now.entries, before + 2);
  const zones = (await building()).zones;
  assert.deepEqual(zones.map((zone) => [zone.label, zone.x, zone.y, zone.w, zone.h]), [['Gym doors', 14, 9, 3, 3]]);
  assert.match(await text('#floor-zones li'), /3 × 3 squares from column 15, row 10\./);
});

test('the menu of a cell inside a left-out area puts it back in the colour scale', async () => {
  await page.keyboard.press('v');
  const items = await menuOn(14, 11);
  assert.ok(items.includes('Label the left-out area Gym doors…'));
  const before = await entries();
  await choose('Put the left-out area Gym doors back in the colour scale');
  assert.equal((await building()).zones.length, 0);
  assert.equal(await entries(), before + 1);
});

// ---------------------------------------------------------------- the menu

test('the menu of an empty cell offers what can be placed there, and each entry is one action', async () => {
  const items = await menuOn(30, 20);
  assert.deepEqual(items, ['Make this a corridor cell', 'Make this a stairs cell', 'Place a room here', 'Place an other space here']);
  assert.equal(await page.$eval('.menu[role="menu"]', (el) => el.getAttribute('aria-label')), 'What can be done with this empty cell');
  const before = await entries();
  await choose('Make this a corridor cell');
  assert.equal((await building()).floors[0].cells[cellOf(30, 20)], '#');
  assert.equal(await entries(), before + 1);
  assert.equal((await state(page)).focus, 'plan');
});

test('the menu of a corridor cell marks an exit, names the corridor, changes its type and erases it', async () => {
  const items = await menuOn(30, 20);
  assert.deepEqual(items, ['Mark as an exit', 'Name this corridor…', 'Make this a stairs cell', 'Place a room here', 'Place an other space here', 'Erase this cell']);
  let before = await entries();
  await choose('Mark as an exit');
  assert.equal((await building()).floors[0].exits.length, 2);
  assert.equal(await entries(), before + 1);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.exit !== undefined), true);
  assert.deepEqual((await menuOn(30, 20)).slice(0, 2), ['Edit the exit', 'Take the exit mark off']);
  before = await entries();
  await choose('Place a room here');
  // the room replaced the corridor cell, and the exit that was on it went in the same step
  const made = await building();
  assert.equal(made.floors[0].exits.length, 1);
  assert.equal(made.floors[0].spaces.filter((space) => space.cells.includes(cellOf(30, 20))).length, 1);
  assert.equal(await entries(), before + 1);
  assert.equal((await state(page)).focus, 'room-number');
  await page.keyboard.press('Escape');
});

test('Escape closes the menu with nothing done, and the menu of a room deletes it', async () => {
  const before = await entries();
  const items = await menuOn(30, 20);
  assert.equal(items[items.length - 1], 'Delete a room with no number');
  await page.keyboard.press('Escape');
  assert.equal(await page.$('.menu[role="menu"]'), null);
  assert.equal(await entries(), before);
  await menuOn(30, 20);
  await choose('Delete a room with no number');
  assert.equal((await building()).floors[0].spaces.some((space) => space.cells.includes(cellOf(30, 20))), false);
  assert.equal(await entries(), before + 1);
  await clearToast(page);
});

test('after all of that the page has logged no error', () => {
  assert.deepEqual(session.problems(), { errors: [], blocked: [], shimmed: [] });
});
