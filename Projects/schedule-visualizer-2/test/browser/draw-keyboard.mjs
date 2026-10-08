// Drawing a building with the keyboard alone: node test/browser/draw-keyboard.mjs
//
// The plan has a cursor cell. Arrows move it, Enter does what a click would,
// Shift with the arrows is a drag that ends when Shift is let go, and Space
// only moves the map. This suite draws the building of draw-pointer.mjs with
// no pointer at all, checks one undo entry a gesture, then draws it again with
// the mouse in a second page and requires the two projects to be the same.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner } from './harness.mjs';
import { startEmpty, planReady, state, snapshot, expectedPlan, drawByPointer, pixel, roomCells, rect, wholeFloor, clearToast, PLAN, PLAN_LABELS } from './draw-pointer.mjs';

let session;
let page;

const text = (selector) => page.$eval(selector, (el) => el.textContent);
const entries = async () => (await state(page)).entries;

async function press(target, key, times = 1) {
  for (let i = 0; i < times; i += 1) await target.keyboard.press(key);
}

// Where the cursor is, shown or not.
const cursorAt = (target) => target.evaluate(() => {
  const editor = document.querySelector('.bld').editor;
  return [editor.cursor.x, editor.cursor.y];
});

// Walk the cursor to a cell with the arrow keys.
async function walk(target, x, y) {
  const [cx, cy] = await cursorAt(target);
  await press(target, x > cx ? 'ArrowRight' : 'ArrowLeft', Math.abs(x - cx));
  await press(target, y > cy ? 'ArrowDown' : 'ArrowUp', Math.abs(y - cy));
  assert.deepEqual(await cursorAt(target), [x, y], 'the cursor did not get to the cell');
}

// A drag by keys: Shift down, the arrows, Shift up.
async function shiftDrag(target, from, to) {
  await walk(target, from[0], from[1]);
  await target.keyboard.down('Shift');
  await press(target, to[0] > from[0] ? 'ArrowRight' : 'ArrowLeft', Math.abs(to[0] - from[0]));
  await press(target, to[1] > from[1] ? 'ArrowDown' : 'ArrowUp', Math.abs(to[1] - from[1]));
  await target.keyboard.up('Shift');
}

// Draw PLAN by keys. Returns the undo labels, one per gesture.
async function drawByKeys(target) {
  const labels = [];
  const note = async () => labels.push((await state(target)).label);
  await target.focus('#plan');
  await target.keyboard.press('c');
  await shiftDrag(target, PLAN.corridor.from, PLAN.corridor.to);
  await note();
  await target.keyboard.press('r');
  for (const room of PLAN.rooms) {
    if (room.from[0] === room.to[0] && room.from[1] === room.to[1]) {
      await walk(target, room.from[0], room.from[1]);
      await target.keyboard.press('Enter');
    } else {
      await shiftDrag(target, room.from, room.to);
    }
    await note();
    assert.equal((await state(target)).focus, 'room-number', 'the number field does not have the focus after a room drawn by keys');
    await target.keyboard.type(room.number);
    await target.keyboard.press('Enter');
    assert.equal((await state(target)).focus, 'plan', 'Enter in the number field did not go back to the plan');
    await note();
  }
  await target.keyboard.press('s');
  await walk(target, PLAN.stairs[0], PLAN.stairs[1]);
  await target.keyboard.press('Enter');
  await note();
  return labels;
}

before(async () => {
  session = await openPlanner({ theme: 'light', width: 1280, height: 900 });
  page = session.page;
  await planReady(page);
  await startEmpty(page);
});

after(async () => {
  if (session) await session.close();
});

test('Tab goes from the tool strip to the plan; the cursor shows there and the keyboard mode is said', async () => {
  await page.focus('.bld-tool[aria-pressed="true"]');
  await page.keyboard.press('Tab');
  const now = await state(page);
  assert.equal(now.focus, 'plan');
  assert.deepEqual(now.cursor, [20, 15], 'the cursor is not showing in the middle of the empty floor');
  assert.equal(now.said, 'The floor plan of Floor 1. Corridor tool. Arrow keys move the cursor, Enter acts.');
  assert.match(await page.$eval('#plan-keys', (el) => el.textContent), /Hold Shift and press the arrows to drag/);
  assert.equal(await page.$eval('#plan', (el) => el.getAttribute('aria-describedby')), 'plan-keys plan-hint');
  // the cursor is drawn: a dotted outline just inside the cell, dark dots on a
  // light line, gone when the focus goes. The first few pixels of the cell's
  // middle row are read, since where the line falls depends on the zoom.
  const edge = () => page.evaluate(() => {
    const editor = document.querySelector('.bld').editor;
    editor.drawNow();
    const at = editor.view.toScreen(20, 15.5);
    const data = editor.canvas.getContext('2d').getImageData(Math.round(at.x), Math.round(at.y), 6, 1).data;
    const found = [];
    for (let i = 0; i < data.length; i += 4) found.push('#' + [data[i], data[i + 1], data[i + 2]].map((value) => value.toString(16).padStart(2, '0')).join(''));
    return found;
  });
  const drawn = await edge();
  assert.ok(drawn.includes('#1f2328') || drawn.includes('#fffdf8'), 'no cursor is drawn on its cell: ' + drawn.join(' '));
  await page.focus('.bld-tool[aria-pressed="true"]');
  const gone = await edge();
  assert.ok(!gone.includes('#1f2328') && !gone.includes('#fffdf8'), 'the cursor is drawn while the plan does not have the focus: ' + gone.join(' '));
  await page.keyboard.press('Tab');
});

test('the arrows move the cursor one cell and say what is there and the tool; it stops at the floor\'s edge', async () => {
  await page.keyboard.press('ArrowRight');
  let now = await state(page);
  assert.deepEqual(now.cursor, [21, 15]);
  assert.equal(now.said, 'Empty, column 22, row 16. Corridor tool.');
  assert.equal(now.cell, 'Column 22, row 16 · Empty');
  assert.equal(now.entries, 1, 'moving the cursor changed the project');
  await press(page, 'ArrowUp', 40);
  await press(page, 'ArrowLeft', 60);
  now = await state(page);
  assert.deepEqual(now.cursor, [0, 0]);
  await press(page, 'ArrowDown', 40);
  await press(page, 'ArrowRight', 60);
  assert.deepEqual((await state(page)).cursor, [39, 29]);
  assert.equal((await state(page)).said, 'Empty, column 40, row 30. Corridor tool.');
});

test('the building is drawn by keys alone: one undo entry a gesture, each with the action\'s label', async () => {
  const before = await entries();
  const labels = await drawByKeys(page);
  assert.deepEqual(labels, PLAN_LABELS);
  assert.equal(await entries(), before + PLAN_LABELS.length);
  assert.deepEqual(await snapshot(page), expectedPlan());
  assert.equal((await state(page)).said, 'Placed 1 stairs cell. Not connected yet.');
  assert.equal(await pixel(page, 6, 10, 0.5, 0.5), '#ffffff', 'the corridor is not on the canvas');
  assert.equal(await text('#plan-counts [data-count="rooms"]'), '3 of 3 rooms numbered');
});

test('the same building drawn with the mouse in another page is the same project', async () => {
  // a browser of its own: a second tab of this one would be the same saved
  // project, open twice, and read-only
  const other = await openPlanner({ server: session.server, theme: 'light', width: 1280, height: 900 });
  try {
    await planReady(other.page);
    await startEmpty(other.page);
    assert.deepEqual(await drawByPointer(other.page), PLAN_LABELS);
    const byMouse = await snapshot(other.page);
    const byKeys = await snapshot(page);
    assert.deepEqual(byKeys, byMouse);
    assert.deepEqual(other.problems(), { errors: [], blocked: [], shimmed: [] });
  } finally {
    await other.close();
  }
});

test('while a drag by keys goes on, what it will do is said; Escape calls it off with nothing changed', async () => {
  const before = await entries();
  await page.focus('#plan');
  await page.keyboard.press('r');
  await walk(page, 25, 20);
  await page.keyboard.down('Shift');
  await press(page, 'ArrowRight', 2);
  let now = await state(page);
  assert.equal(now.said, 'Room: 3 by 1');
  assert.equal(now.preview, 'rect');
  assert.equal(now.entries, before, 'the drag changed the project before Shift was let go');
  await page.keyboard.press('ArrowDown');
  assert.equal((await state(page)).said, 'Room: 3 by 2');
  await page.keyboard.press('Escape');
  now = await state(page);
  assert.equal(now.said, 'Cancelled. Nothing was changed.');
  assert.equal(now.preview, null);
  await page.keyboard.up('Shift');
  now = await state(page);
  assert.equal(now.entries, before, 'a cancelled drag made an undo entry');
  assert.equal(now.focus, 'plan');
  // letting go of Shift is what finishes a drag
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowRight');
  assert.equal(await entries(), before);
  await page.keyboard.up('Shift');
  now = await state(page);
  assert.equal(now.entries, before + 1);
  assert.equal(now.focus, 'room-number');
  await page.keyboard.press('Escape');
  await page.focus('#plan');
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  assert.equal(await entries(), before);
});

test('Space only moves the map: alone it does nothing, and with an arrow the map goes and the cursor keeps its cell', async () => {
  await page.focus('#plan');
  await page.keyboard.press('r');
  await walk(page, 30, 20);
  const before = await state(page);
  await page.keyboard.press('Space');
  let now = await state(page);
  assert.equal(now.entries, before.entries, 'Space acted like a click');
  assert.equal(now.x, before.x);
  assert.equal(now.focus, 'plan');
  await page.keyboard.down('Space');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.up('Space');
  now = await state(page);
  const side = 24 * before.zoom;
  assert.ok(Math.abs(now.x - (before.x - side)) < 1e-6, 'Space and Right did not move the map one cell');
  assert.ok(Math.abs(now.y - (before.y - 2 * side)) < 1e-6, 'Space and Down did not move the map');
  assert.deepEqual(now.cursor, [30, 20], 'the cursor moved with the map');
  assert.equal(now.entries, before.entries);
  // with Space let go the arrows move the cursor again
  await page.keyboard.press('ArrowLeft');
  assert.deepEqual((await state(page)).cursor, [29, 20]);
  await wholeFloor(page);
});

test('a tool letter typed into the room number is a letter, and does nothing with Ctrl or Alt held', async () => {
  const before = await entries();
  await page.focus('#plan');
  await page.keyboard.press('r');
  await walk(page, 30, 4);
  await page.keyboard.press('Enter');
  assert.equal((await state(page)).focus, 'room-number');
  await page.keyboard.type('Chorus 0=-');
  assert.equal((await state(page)).tool, 'room', 'a letter typed into the room number changed the tool');
  await page.keyboard.press('Enter');
  assert.deepEqual(await roomCells(page, 'Chorus 0=-'), [4 * 40 + 30]);
  let now = await state(page);
  assert.equal(now.focus, 'plan');
  for (const [modifier, key] of [['Control', 'e'], ['Alt', 'c'], ['Meta', 's']]) {
    await page.keyboard.down(modifier);
    await page.keyboard.press(key);
    await page.keyboard.up(modifier);
    assert.equal((await state(page)).tool, 'room', modifier + '+' + key + ' changed the tool');
  }
  await page.keyboard.press('e');
  assert.equal((await state(page)).tool, 'eraser');
  assert.equal((await state(page)).said, 'Eraser: click or drag over what to remove. Part of a room asks whether to take the whole room.');
  // erase it again: one cell, the whole room, no question
  await page.keyboard.press('Enter');
  now = await state(page);
  assert.equal(now.entries, before + 3);
  assert.equal(now.label, 'Erase Chorus 0=- on Floor 1');
  assert.deepEqual(await snapshot(page), expectedPlan());
});

test('Enter with the Eraser on part of a room asks, and the answer is given by keys', async () => {
  const before = await entries();
  await page.focus('#plan');
  await page.keyboard.press('e');
  await walk(page, 13, 9);
  assert.equal((await state(page)).said, 'Room 102, column 14, row 10. Eraser tool.');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#erase-dialog[open]');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Erase nothing');
  await page.keyboard.down('Shift');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.up('Shift');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Erase all of Room 102');
  await page.keyboard.press('Enter');
  let now = await state(page);
  assert.equal(now.entries, before + 1);
  assert.equal(now.label, 'Erase Room 102 on Floor 1');
  assert.equal(now.focus, 'plan', 'the focus did not come back to the plan');
  assert.deepEqual(now.cursor, [13, 9], 'the cursor is not where it was');
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  now = await state(page);
  assert.equal(now.toast, 'Undid: Erase Room 102 on Floor 1');
  assert.deepEqual(await snapshot(page), expectedPlan());
  await clearToast(page);
});

test('Select by keys: Enter selects, Shift and the arrows move the room, a drag from empty floor is a box, Delete removes', async () => {
  const before = await entries();
  await page.focus('#plan');
  await page.keyboard.press('v');
  await walk(page, 6, 8);
  await page.keyboard.press('Enter');
  let now = await state(page);
  assert.equal(now.selection.length, 1);
  assert.equal(now.said, 'Selected Room 101.');
  assert.equal(now.entries, before);
  assert.equal(now.focus, 'plan', 'selecting took the focus off the plan');
  await page.keyboard.down('Shift');
  await press(page, 'ArrowUp', 2);
  assert.equal((await state(page)).said, 'Move Room 101 2 up');
  assert.equal((await state(page)).preview, 'move');
  await page.keyboard.up('Shift');
  now = await state(page);
  assert.equal(now.entries, before + 1);
  assert.equal(now.label, 'Move Room 101');
  assert.equal(now.said, 'Moved Room 101 2 up.');
  assert.deepEqual(await roomCells(page, '101'), rect(40, 5, 5, 4, 3));
  // Enter on nothing selects nothing
  await walk(page, 2, 2);
  await page.keyboard.press('Enter');
  assert.equal((await state(page)).selection.length, 0);
  // a box from empty floor over the three rooms
  await shiftDrag(page, [3, 4], [16, 9]);
  now = await state(page);
  assert.equal(now.selection.length, 3);
  assert.equal(now.said, '3 spaces selected.');
  assert.equal(now.entries, before + 1);
  await page.keyboard.press('Escape');
  assert.equal((await state(page)).selection.length, 0, 'Escape did not select nothing');
  await walk(page, 15, 9);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Delete');
  now = await state(page);
  assert.equal(now.entries, before + 2);
  assert.equal(now.label, 'Delete Gym <b>2</b>');
  for (let i = 0; i < 2; i += 1) {
    await page.keyboard.down('Control');
    await page.keyboard.press('z');
    await page.keyboard.up('Control');
  }
  assert.deepEqual(await snapshot(page), expectedPlan());
  await clearToast(page);
});

test('Line by keys: Enter where it starts, the arrows, Enter where it ends', async () => {
  const before = await entries();
  await page.focus('#plan');
  await page.keyboard.press('l');
  await walk(page, 20, 11);
  await page.keyboard.press('Enter');
  let now = await state(page);
  assert.equal(now.entries, before);
  assert.equal(now.said, 'The line starts at column 21, row 12. Pick where it ends.');
  await press(page, 'ArrowDown', 7);
  now = await state(page);
  assert.equal(now.preview, 'cells', 'the line does not follow the cursor');
  await page.keyboard.press('Enter');
  now = await state(page);
  assert.equal(now.entries, before + 1);
  assert.equal(now.said, 'Painted a straight corridor of 8 cells.');
  assert.equal(await text('#plan-counts [data-count="corridor"]'), '24 corridor cells');
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  assert.deepEqual(await snapshot(page), expectedPlan());
  await clearToast(page);
});

test('=, - and 0 zoom in, out and fit; Page Down and Page Up change floor and keep the tool', async () => {
  await page.focus('#plan');
  await page.keyboard.press('0');
  const fitted = await state(page);
  assert.match(fitted.said, /^The plan fits the window, at \d+%\.$/);
  await page.keyboard.press('=');
  let now = await state(page);
  assert.ok(Math.abs(now.zoom - Math.min(3, fitted.zoom * 1.25)) < 1e-9);
  assert.equal(now.said, 'Zoom ' + Math.round(now.zoom * 100) + '%.');
  await page.keyboard.press('-');
  await page.keyboard.press('-');
  now = await state(page);
  assert.ok(now.zoom < fitted.zoom);
  await page.keyboard.press('0');
  now = await state(page);
  assert.ok(Math.abs(now.zoom - fitted.zoom) < 1e-9 && Math.abs(now.x - fitted.x) < 1e-6);

  await page.keyboard.press('PageDown');
  assert.equal((await state(page)).said, 'Floor 1 is the last floor.');
  await page.keyboard.press('PageUp');
  assert.equal((await state(page)).said, 'Floor 1 is the first floor.');
  await page.focus('#add-floor');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.bld').editor.floor.name === 'Floor 2');
  now = await state(page);
  assert.equal(now.tool, 'line');
  assert.equal(now.zoom, fitted.zoom);
  await page.focus('#plan');
  await page.keyboard.press('PageUp');
  await page.waitForFunction(() => document.querySelector('.bld').editor.floor.name === 'Floor 1');
  assert.equal((await state(page)).said, 'Floor 1.');
  // the floor tabs are a tab list: Right goes to the next floor and takes the focus with it
  await page.focus('.bld-floors [role="tab"][aria-selected="true"]');
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.bld').editor.floor.name === 'Floor 2');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Floor 2');
  assert.equal(await page.$$eval('.bld-floors [role="tab"][tabindex="0"]', (all) => all.length), 1);
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  assert.equal((await state(page)).floor, 'Floor 1');
  assert.deepEqual(await snapshot(page), expectedPlan());
});

test('the Menu key and Shift+F10 ask for the menu of the cell the cursor is on', async () => {
  await page.focus('#plan');
  await wholeFloor(page);
  await walk(page, 6, 8);
  // without a menu to open, nothing happens
  await page.keyboard.down('Shift');
  await page.keyboard.press('F10');
  await page.keyboard.up('Shift');
  await page.evaluate(() => {
    globalThis.asked = [];
    document.querySelector('.bld').editor.menu = (ev) => globalThis.asked.push([ev.x, ev.y, ev.source]);
  });
  await page.keyboard.down('Shift');
  await page.keyboard.press('F10');
  await page.keyboard.up('Shift');
  assert.deepEqual(await page.evaluate(() => globalThis.asked), [[6, 8, 'keyboard']]);
  await page.evaluate(() => {
    document.querySelector('.bld').editor.menu = null;
  });
});

test('the plan\'s keys are listed for Help to show, one for every tool', async () => {
  const rows = await page.evaluate(async () => (await import('./ui/building/index.js')).PLAN_KEYS.map((row) => row.shown + ' ' + row.does));
  for (const wanted of ['V The Select tool', 'C The Corridor tool', 'R The Room tool', 'E The Eraser tool', 'H The Pan tool', 'L The Line tool', 'S The Stairs tool', 'O The Other space tool', 'Arrows Move the cursor one cell', 'Shift+Arrows Drag: let go of Shift to finish', 'Space+Arrows Move the map', '0 Fit the plan to the window']) {
    assert.ok(rows.includes(wanted), 'the list has no "' + wanted + '"');
  }
  assert.equal(await page.$$eval('.bld-tool', (all) => all.length), rows.filter((row) => / tool$/.test(row)).length);
});

test('after all of that the page has logged no error', () => {
  assert.deepEqual(session.problems(), { errors: [], blocked: [], shimmed: [] });
});
