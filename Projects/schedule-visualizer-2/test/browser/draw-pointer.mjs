// Drawing a building with a mouse, in a real browser: node test/browser/draw-pointer.mjs
//
// Real pointer events on the plan: a corridor, three rooms and stairs, then
// everything else a mouse does there (select, move, erase, a straight line,
// an other space, copy and paste, the floors, zoom and pan). After each
// gesture the project in the store is checked, and that the gesture made
// exactly one undo entry. The canvas is checked by reading pixels back.
//
// draw-keyboard.mjs and draw-touch.mjs import the helpers below, and
// draw-keyboard.mjs draws this same building by keys and compares the two.
// The tests in this file are registered only when it is the file being run.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

import { openPlanner } from './harness.mjs';

const MAIN = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

export const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- helpers

// An empty project on screen, Getting started put away, the plan measured.
export async function startEmpty(page) {
  await page.evaluate(async () => {
    const { store } = globalThis.sv2;
    const actions = await import('./engine/actions.js');
    const { newProject } = await import('./engine/schema.js');
    const { createIds, seededRandom } = await import('./engine/ids.js');
    const project = newProject(createIds(seededRandom(6)), () => new Date('2026-09-01T12:00:00Z'));
    project.onboarding.dismissed = true;
    store.apply(actions.replaceProject, { project, label: 'Start an empty project' });
    if (location.hash !== '#building') location.hash = '#building';
  });
  await planReady(page);
}

export async function planReady(page) {
  await page.waitForFunction(() => {
    const section = document.querySelector('.bld');
    return Boolean(section) && section.dataset.styled === 'true' && section.editor.view.width > 0;
  });
  // one frame, so the fit that follows a change of layout has happened
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

// The place in the window of a point inside a cell: (0.5, 0.5) is its middle.
export function point(page, x, y, fx = 0.5, fy = 0.5) {
  return page.evaluate((cx, cy, ax, ay) => {
    const editor = document.querySelector('.bld').editor;
    const box = editor.canvas.getBoundingClientRect();
    const at = editor.view.toScreen(cx + ax, cy + ay);
    return { x: box.left + at.x, y: box.top + at.y };
  }, x, y, fx, fy);
}

export async function click(page, x, y, options) {
  const at = await point(page, x, y);
  await page.mouse.click(at.x, at.y, options);
}

export async function drag(page, from, to, options) {
  const a = await point(page, from[0], from[1]);
  const b = await point(page, to[0], to[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down(options);
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up(options);
}

// What the editor and the store say now.
export function state(page) {
  return page.evaluate(() => {
    const editor = document.querySelector('.bld').editor;
    const { store } = globalThis.sv2;
    const toast = document.querySelector('.toast .toast__text');
    return {
      tool: editor.tool.id,
      pressed: Array.from(document.querySelectorAll('.bld-tool[aria-pressed="true"]'), (button) => button.dataset.tool),
      entries: store.history.past.length,
      label: store.undoLabel,
      selection: editor.selection.slice(),
      zoom: editor.view.zoom,
      x: editor.view.x,
      y: editor.view.y,
      floor: editor.floor.name,
      floorId: editor.floor.id,
      said: document.getElementById('announcer').textContent,
      toast: toast ? toast.textContent : null,
      hint: document.getElementById('plan-hint').textContent,
      cell: document.getElementById('plan-cell').textContent,
      focus: document.activeElement ? document.activeElement.id : '',
      cursor: editor.cursor.showing ? [editor.cursor.x, editor.cursor.y] : null,
      preview: editor.preview ? editor.preview.kind : null,
      hash: location.hash,
    };
  });
}

// The building, without the ids, so two buildings drawn two ways can be compared.
export function snapshot(page) {
  return page.evaluate(() => {
    const { building } = globalThis.sv2.store.project;
    return {
      floors: building.floors.map((floor) => ({
        name: floor.name,
        width: floor.width,
        height: floor.height,
        cells: floor.cells,
        spaces: floor.spaces.map((space) => ({
          kind: space.kind,
          cells: space.cells.slice().sort((a, b) => a - b),
          name: space.kind === 'room' ? space.number : space.label,
          doors: space.kind === 'room' ? space.doors.length : 0,
        })).sort((a, b) => a.cells[0] - b.cells[0]),
        exits: floor.exits.length,
      })),
      connections: building.connections.length,
    };
  });
}

export function rect(width, x, y, w, h) {
  const cells = [];
  for (let row = y; row < y + h; row += 1) for (let column = x; column < x + w; column += 1) cells.push(row * width + column);
  return cells;
}

// The building both suites draw, on the 40 by 30 floor of a new project: a
// corridor along row 10, two rooms of 4 by 3 above it, a one-cell room, and
// stairs at the corridor's east end.
export const PLAN = {
  corridor: { from: [5, 10], to: [20, 10] },
  rooms: [
    { from: [5, 7], to: [8, 9], number: '101' },
    { from: [10, 7], to: [13, 9], number: '102' },
    { from: [15, 9], to: [15, 9], number: 'Gym <b>2</b>' },
  ],
  stairs: [21, 10],
};

export function expectedPlan() {
  const width = 40;
  const cells = new Array(width * 30).fill('.');
  for (let x = PLAN.corridor.from[0]; x <= PLAN.corridor.to[0]; x += 1) cells[10 * width + x] = '#';
  cells[PLAN.stairs[1] * width + PLAN.stairs[0]] = 'S';
  return {
    floors: [{
      name: 'Floor 1',
      width,
      height: 30,
      cells: cells.join(''),
      spaces: PLAN.rooms.map((room) => ({ kind: 'room', cells: rect(width, room.from[0], room.from[1], room.to[0] - room.from[0] + 1, room.to[1] - room.from[1] + 1), name: room.number, doors: 0 })),
      exits: 0,
    }],
    connections: 0,
  };
}

// Draw PLAN with the mouse. Returns the undo labels, one per gesture.
export async function drawByPointer(page) {
  const labels = [];
  const note = async () => labels.push((await state(page)).label);
  await page.keyboard.press('c');
  await drag(page, PLAN.corridor.from, PLAN.corridor.to);
  await note();
  await page.keyboard.press('r');
  for (const room of PLAN.rooms) {
    if (room.from[0] === room.to[0] && room.from[1] === room.to[1]) await click(page, room.from[0], room.from[1]);
    else await drag(page, room.from, room.to);
    await note();
    await page.keyboard.type(room.number);
    await page.keyboard.press('Enter');
    // the focus goes back to the plan once the field has kept the number
    await page.waitForFunction(() => document.activeElement.id === 'plan');
    await note();
  }
  await page.keyboard.press('s');
  await click(page, PLAN.stairs[0], PLAN.stairs[1]);
  await note();
  return labels;
}

export const PLAN_LABELS = [
  'Paint corridor on Floor 1',
  'Place a room on Floor 1', 'Edit an unnumbered room',
  'Place a room on Floor 1', 'Edit an unnumbered room',
  'Place a room on Floor 1', 'Edit an unnumbered room',
  'Place stairs on Floor 1',
];

// The colour of one pixel of the plan, as #rrggbb, after a fresh draw.
export function pixel(page, x, y, fx, fy) {
  return page.evaluate((cx, cy, ax, ay) => {
    const editor = document.querySelector('.bld').editor;
    editor.drawNow();
    const at = editor.view.toScreen(cx + ax, cy + ay);
    const ratio = editor.canvas.width / editor.view.width;
    const data = editor.canvas.getContext('2d').getImageData(Math.round(at.x * ratio), Math.round(at.y * ratio), 1, 1).data;
    return '#' + [data[0], data[1], data[2]].map((value) => value.toString(16).padStart(2, '0')).join('');
  }, x, y, fx, fy);
}

// The whole floor in the window, whatever was zoomed or moved before, so a
// test can point at any cell.
export async function wholeFloor(page) {
  await page.evaluate(() => {
    const editor = document.querySelector('.bld').editor;
    editor.fitTo({ x: 0, y: 0, w: editor.floor.width, h: editor.floor.height });
    editor.drawNow();
  });
}

// Put away a message that is still showing, so the next one read is the next one shown.
export async function clearToast(page) {
  await page.evaluate(() => {
    const close = document.querySelector('.toast .toast__close');
    if (close) close.click();
  });
}

export async function floorIs(page, name) {
  await page.waitForFunction((wanted) => document.querySelector('.bld').editor.floor.name === wanted, { timeout: 5000 }, name);
}

export function roomCells(page, number) {
  return page.evaluate((wanted) => {
    for (const floor of globalThis.sv2.store.project.building.floors) {
      const room = floor.spaces.find((space) => space.kind === 'room' && space.number === wanted);
      if (room) return room.cells.slice().sort((a, b) => a - b);
    }
    return null;
  }, number);
}

// ---------------------------------------------------------------- the tests

if (MAIN) {
  let session;
  let page;

  const text = (selector) => page.$eval(selector, (el) => el.textContent);
  const entries = async () => (await state(page)).entries;

  before(async () => {
    session = await openPlanner({ theme: 'light', width: 1280, height: 900 });
    page = session.page;
    await planReady(page);
  });

  after(async () => {
    if (session) await session.close();
  });

  test('the sample school opens on its plan with the Select tool, and the plan fits the window', async () => {
    const now = await state(page);
    assert.equal(now.tool, 'select', 'Select is the tool on a floor with something drawn');
    assert.deepEqual(now.pressed, ['select']);
    assert.equal(now.floor, 'Floor 1');
    assert.equal(await page.$eval('#empty-floor', (el) => el.hidden), true);
    const inside = await page.evaluate(() => {
      const editor = document.querySelector('.bld').editor;
      const a = editor.view.toScreen(0, 0);
      const b = editor.view.toScreen(editor.floor.width, editor.floor.height);
      return a.x >= 0 && a.y >= 0 && b.x <= editor.view.width && b.y <= editor.view.height;
    });
    assert.equal(inside, true, 'the floor is not wholly in the window after the first fit');
    assert.equal(await page.$eval('#plan', (el) => el.getAttribute('role')), 'application');
    assert.equal(await page.$eval('#plan', (el) => el.getAttribute('aria-label')), 'The floor plan of Floor 1');
    assert.deepEqual(await page.$$eval('#plan-counts li', (all) => all.map((li) => [li.dataset.count, li.textContent])), [
      ['rooms', '13 of 13 rooms numbered'],
      ['corridor', '121 corridor cells'],
      ['connections', '2 stairs connections'],
      ['exits', '2 exits'],
      ['floors', '3 floors'],
    ]);
  });

  test('the tool strip has the tools in order, each with its word and its key, and a divider after Pan', async () => {
    const strip = await page.$$eval('.bld-strip > *', (all) => all.map((el) => (el.getAttribute('role') === 'separator' ? '|' : el.dataset.tool + ':' + el.querySelector('.bld-tool__label').firstChild.textContent + ':' + el.querySelector('.bld-tool__key').textContent)));
    assert.deepEqual(strip, ['select:Select:V', 'corridor:Corridor:C', 'room:Room:R', 'eraser:Eraser:E', 'pan:Pan:H', '|', 'line:Line:L', 'stairs:Stairs:S', 'other:Other:O']);
    assert.equal(await page.$eval('.bld-strip', (el) => Math.round(el.getBoundingClientRect().width)), 64);
    assert.equal(await page.$$eval('.bld-strip [tabindex="0"]', (all) => all.length), 1, 'the strip is one Tab stop');
    await page.click('.bld-tool[data-tool="room"]');
    assert.equal((await state(page)).tool, 'room');
    assert.equal(await text('#plan-hint'), 'Room: click for one cell, drag for a rectangle. Hold Space or use two fingers to move the map.');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.tool), 'eraser', 'the arrows move inside the strip');
    assert.equal((await state(page)).tool, 'room', 'moving the focus in the strip changed the tool');
  });

  test('an empty floor opens with its card, the Corridor tool in hand and the whole floor in the window', async () => {
    await startEmpty(page);
    const now = await state(page);
    assert.equal(now.tool, 'corridor');
    assert.equal(now.entries, 1, 'the project that was just put in place');
    assert.equal(await page.$eval('#empty-floor', (el) => el.hidden), false);
    assert.equal(await text('#empty-floor h1'), 'This is the building.');
    assert.equal(await text('#empty-floor .intro__first'), 'Draw a corridor, then rooms along it.');
    assert.deepEqual(await page.$$eval('#empty-floor button', (all) => all.map((button) => button.textContent)), [
      'Trace over a photo of your floor plan',
      'Change the size (Floor 1 is 40 × 30 squares)',
      'Load the sample school',
    ]);
    assert.equal(await page.$$eval('h1', (all) => all.length), 1);
    const shape = await page.evaluate(() => {
      const editor = document.querySelector('.bld').editor;
      const a = editor.view.toScreen(0, 0);
      const b = editor.view.toScreen(40, 30);
      return { left: a.x, top: a.y, right: editor.view.width - b.x, bottom: editor.view.height - b.y };
    });
    assert.ok(shape.left >= 0 && shape.top >= 0, 'the floor starts outside the window');
    assert.ok(Math.abs(shape.left - shape.right) < 1 && Math.abs(shape.top - shape.bottom) < 1, 'the floor is not in the middle of the window');
    assert.equal(await text('#plan-counts [data-count="rooms"]'), 'No rooms');

    await page.click('#empty-floor [data-action="size"]');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.tab), 'floor', 'the size button did not open the Floor tab');
    assert.match(await text('#inspector [role="tabpanel"]'), /Floor 1 is 40 × 30 squares\./);
    await page.click('#empty-floor [data-action="trace"]');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.tab), 'floor');
  });

  test('the card does not stand in the way: a drag that starts on its words draws on the plan under it, and undo brings the card back', async () => {
    const before = await entries();
    const words = await page.$eval('#empty-floor .intro__first', (el) => {
      const box = el.getBoundingClientRect();
      return { x: box.left + 20, y: box.top + box.height / 2 };
    });
    await page.mouse.move(words.x, words.y);
    await page.mouse.down();
    await page.mouse.move(words.x + 60, words.y, { steps: 4 });
    assert.equal(await page.$eval('#empty-floor', (el) => el.hidden), true, 'the card stayed while a corridor was being drawn through it');
    await page.mouse.up();
    let now = await state(page);
    assert.equal(now.entries, before + 1);
    assert.equal(now.label, 'Paint corridor on Floor 1');
    await page.click('#undo');
    now = await state(page);
    assert.equal(now.entries, before);
    assert.equal(await page.$eval('#empty-floor', (el) => el.hidden), false, 'undo emptied the floor and the card did not come back');
    assert.equal(await text('#empty-floor h1'), 'This is the building.');
    await clearToast(page);
  });

  test('a drag with the Corridor tool paints a corridor, as one undo entry with the action\'s label', async () => {
    const before = await entries();
    await drag(page, PLAN.corridor.from, PLAN.corridor.to);
    const now = await state(page);
    assert.equal(now.entries, before + 1);
    assert.equal(now.label, 'Paint corridor on Floor 1');
    assert.equal(now.said, 'Painted 16 corridor cells.');
    assert.equal(now.preview, null, 'the preview outlived the gesture');
    assert.equal(await page.$eval('#empty-floor', (el) => el.hidden), true, 'the card stayed over a floor with a corridor on it');
    assert.equal(await page.$$eval('h1', (all) => all.length), 1);
    assert.equal(await text('#plan-counts [data-count="corridor"]'), '16 corridor cells');
    assert.equal(await page.evaluate(() => globalThis.sv2.store.project.building.floors[0].cells.slice(400, 440)), '.....################...................');
    // a fast drag reports few places; the cells between them are filled in
    const a = await point(page, 5, 14);
    const b = await point(page, 20, 14);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y);
    await page.mouse.up();
    assert.equal(await page.evaluate(() => globalThis.sv2.store.project.building.floors[0].cells.slice(560, 600)), '.....################...................');
    assert.equal(await entries(), before + 2);
    await page.click('#undo');
    assert.equal(await entries(), before + 1);
  });

  test('painting over what is corridor already changes nothing and makes no entry', async () => {
    const before = await entries();
    await drag(page, [6, 10], [9, 10]);
    const now = await state(page);
    assert.equal(now.entries, before);
    assert.equal(now.said, 'That is corridor already.');
  });

  test('the Room tool places a rectangle, selects it and puts the cursor in its number; Enter goes back to the plan', async () => {
    const before = await entries();
    await clearToast(page);
    await page.keyboard.press('r');
    const room = PLAN.rooms[0];
    await drag(page, room.from, room.to);
    let now = await state(page);
    assert.equal(now.entries, before + 1);
    assert.equal(now.label, 'Place a room on Floor 1');
    assert.equal(now.said, 'Placed a room, 4 by 3. Type its number.');
    assert.equal(now.selection.length, 1, 'the new room is not selected');
    assert.equal(now.focus, 'room-number', 'the number field does not have the focus');
    assert.equal(now.toast, null, 'a message for a room that replaced nothing');
    await page.keyboard.type(room.number);
    await page.keyboard.press('Enter');
    now = await state(page);
    assert.equal(now.focus, 'plan', 'Enter did not go back to the plan');
    assert.equal(now.tool, 'room', 'the Room tool is no longer in hand');
    assert.equal(now.entries, before + 2);
    assert.deepEqual(await roomCells(page, '101'), rect(40, 5, 7, 4, 3));
    assert.equal(await text('#inspector-title'), 'Room 101');
  });

  test('a second room by a drag, and a one-cell room by a click whose name is kept as typed', async () => {
    const before = await entries();
    await drag(page, PLAN.rooms[1].from, PLAN.rooms[1].to);
    await page.keyboard.type(PLAN.rooms[1].number);
    await page.keyboard.press('Enter');
    await click(page, 15, 9);
    assert.equal((await state(page)).said, 'Placed a room, 1 by 1. Type its number.');
    await page.keyboard.type(PLAN.rooms[2].number);
    await page.keyboard.press('Enter');
    assert.equal(await entries(), before + 4);
    assert.deepEqual(await roomCells(page, 'Gym <b>2</b>'), [9 * 40 + 15]);
    assert.equal(await text('#inspector-title'), 'Room Gym <b>2</b>');
    assert.equal(await page.$('#inspector-title b'), null, 'a typed name was read as markup');
    assert.equal(await text('#plan-counts [data-count="rooms"]'), '3 of 3 rooms numbered');
  });

  test('a number another room has is refused under the field, and the focus stays there', async () => {
    const before = await entries();
    await drag(page, [25, 3], [26, 4]);
    await page.keyboard.type('101');
    await page.keyboard.press('Enter');
    const now = await state(page);
    assert.equal(now.focus, 'room-number');
    assert.equal(now.entries, before + 1, 'only the room itself');
    assert.match(await text('#inspector .field__refusal'), /101/);
    // Enter on a number that was not changed still goes back to the plan
    await page.keyboard.press('Escape');
    assert.equal(await page.$eval('#room-number', (el) => el.value), '');
    await page.keyboard.press('Enter');
    assert.equal((await state(page)).focus, 'plan');
    await page.click('#undo');
    assert.equal(await entries(), before);
  });

  test('stairs by a click', async () => {
    const before = await entries();
    await page.keyboard.press('s');
    await click(page, PLAN.stairs[0], PLAN.stairs[1]);
    const now = await state(page);
    assert.equal(now.entries, before + 1);
    assert.equal(now.label, 'Place stairs on Floor 1');
    assert.equal(now.said, 'Placed 1 stairs cell. Not connected yet.');
  });

  test('the project in the store is the plan that was drawn, and the canvas shows it', async () => {
    assert.deepEqual(await snapshot(page), expectedPlan());
    await page.mouse.move(2, 2);
    assert.equal(await pixel(page, 6, 10, 0.5, 0.5), '#ffffff', 'a corridor cell');
    assert.equal(await pixel(page, 5, 7, 0.5, 0.5), '#e9e4d9', 'a cell of a room with no subject');
    assert.equal(await pixel(page, 21, 10, 0.15, 0.85), '#d9ece9', 'a stairs cell, clear of its marks');
    assert.equal(await pixel(page, 30, 20, 0.5, 0.5), '#e8e3d8', 'an empty cell');
    // the mark on stairs with no connection: a dot in the cell's top right corner
    const side = 24 * (await state(page)).zoom;
    const radius = Math.max(2, Math.min(7, side * 0.22));
    assert.equal(await pixel(page, 21, 10, (side - radius - 1 - radius * 0.6) / side, (radius + 1) / side), '#b3261e', 'the mark on stairs with no connection');
    const outside = await page.evaluate(() => {
      const editor = document.querySelector('.bld').editor;
      editor.drawNow();
      const data = editor.canvas.getContext('2d').getImageData(2, 2, 1, 1).data;
      return [data[0], data[1], data[2]].join(',');
    });
    assert.equal(outside, '246,243,236', 'off the floor is paper');
  });

  test('a room drawn over part of the corridor replaces it, says so in a message, and is one step to undo', async () => {
    const before = await entries();
    await page.keyboard.press('r');
    await drag(page, [18, 9], [19, 10]);
    let now = await state(page);
    assert.equal(now.entries, before + 1);
    assert.equal(now.label, 'Place a room on Floor 1, replacing 2 corridor cells');
    assert.equal(now.said, 'Placed a room, 2 by 2, replaced 2 corridor cells. Type its number.');
    assert.equal(now.toast, 'Placed a room, 2 by 2, replaced 2 corridor cells. Type its number.');
    await page.click('.toast .toast__action');
    now = await state(page);
    assert.equal(now.entries, before);
    assert.deepEqual(await snapshot(page), expectedPlan());
  });

  test('the status line says what a click will do, and names the cell under the pointer', async () => {
    await page.keyboard.press('e');
    assert.equal((await state(page)).hint, 'Eraser: click or drag over what to remove. Part of a room asks whether to take the whole room.');
    const cells = [[6, 8, 'Column 7, row 9 · Room 101'], [7, 10, 'Column 8, row 11 · Corridor'], [21, 10, 'Column 22, row 11 · Stairs, not connected'], [30, 20, 'Column 31, row 21 · Empty'], [15, 9, 'Column 16, row 10 · Room Gym <b>2</b>']];
    for (const [x, y, words] of cells) {
      const at = await point(page, x, y);
      await page.mouse.move(at.x, at.y);
      assert.equal((await state(page)).cell, words);
    }
    await page.mouse.move(5, 5);
    assert.equal((await state(page)).cell, '', 'a cell is named with the pointer off the plan');
    await page.keyboard.press('v');
  });

  test('the plan keeps its size whatever the status line says: every tool, the pointer on a cell and off', async () => {
    const size = () => page.evaluate(() => {
      const stage = document.querySelector('.bld-stage').getBoundingClientRect();
      return stage.width + ' by ' + stage.height;
    });
    const first = await size();
    const at = await point(page, 6, 8);
    for (const key of ['v', 'c', 'r', 'e', 'h', 'l', 's', 'o']) {
      await page.keyboard.press(key);
      await page.mouse.move(at.x, at.y);
      assert.equal(await size(), first, 'the plan changed size with the tool on ' + key);
      await page.mouse.move(5, 5);
      assert.equal(await size(), first);
    }
    assert.equal(await page.$eval('#plan-hint', (el) => el.scrollHeight <= el.clientHeight + 1), true, 'the status line cuts its sentence short');
    // in a narrow window the sentence takes two lines for some tools and one
    // for others; the line keeps room for two either way
    await page.setViewport({ width: 1000, height: 900 });
    await planReady(page);
    const narrow = await size();
    assert.notEqual(narrow, first);
    for (const key of ['h', 'r', 'e', 'v']) {
      await page.keyboard.press(key);
      assert.equal(await size(), narrow, 'in a narrow window the plan changed size with the tool on ' + key);
      assert.equal(await page.$eval('#plan-hint', (el) => el.scrollHeight <= el.clientHeight + 1), true, 'in a narrow window the status line cuts the sentence short for ' + key);
    }
    await page.setViewport({ width: 1280, height: 900 });
    await planReady(page);
    assert.equal(await size(), first);
    await wholeFloor(page);
  });

  test('a tool letter does nothing while Ctrl, Alt or Meta is held, or while a field has the focus', async () => {
    await page.keyboard.press('v');
    for (const modifier of ['Control', 'Alt', 'Meta']) {
      await page.keyboard.down(modifier);
      await page.keyboard.press('e');
      await page.keyboard.up(modifier);
      assert.equal((await state(page)).tool, 'select', modifier + '+E changed the tool');
    }
    await click(page, 6, 8);
    assert.equal((await state(page)).selection.length, 1);
    await page.click('#room-number');
    await page.keyboard.type('re');
    assert.equal((await state(page)).tool, 'select', 'a letter typed into the room number changed the tool');
    assert.equal(await page.$eval('#room-number', (el) => el.value), '101re');
    await page.keyboard.press('Escape');
    assert.equal(await page.$eval('#room-number', (el) => el.value), '101');
    await page.click('#search');
    await page.keyboard.type('c0=');
    assert.equal((await state(page)).tool, 'select', 'a letter typed into the search box changed the tool');
    await page.$eval('#search', (el) => {
      el.value = '';
      el.blur();
    });
    await page.keyboard.press('e');
    assert.equal((await state(page)).tool, 'eraser', 'E alone did not pick the Eraser');
    await page.keyboard.press('v');
  });

  test('Select: a click selects, a drag moves the room and keeps its number, and a move onto something is refused', async () => {
    const before = await entries();
    await click(page, 6, 8);
    let now = await state(page);
    assert.equal(now.selection.length, 1);
    assert.equal(now.entries, before, 'selecting is not a change');
    assert.equal(await text('#inspector-title'), 'Room 101');
    await drag(page, [6, 8], [6, 5]);
    now = await state(page);
    assert.equal(now.entries, before + 1);
    assert.equal(now.label, 'Move Room 101');
    assert.equal(now.said, 'Moved Room 101 3 up.');
    assert.deepEqual(await roomCells(page, '101'), rect(40, 5, 4, 4, 3));
    assert.equal(now.selection.length, 1, 'the moved room is no longer selected');
    // onto Room 102: refused, in the engine's own words, with nothing changed
    await drag(page, [6, 5], [11, 8]);
    now = await state(page);
    assert.equal(now.entries, before + 1);
    assert.match(now.toast, /^That would put Room 101 on top of Room 102 on Floor 1\./);
    assert.deepEqual(await roomCells(page, '101'), rect(40, 5, 4, 4, 3));
    await page.click('#undo');
    assert.deepEqual(await snapshot(page), expectedPlan());
  });

  test('with Select, a drag that starts on empty floor moves the map and changes nothing; a click there selects nothing', async () => {
    await click(page, 6, 8);
    assert.equal((await state(page)).selection.length, 1);
    const before = await state(page);
    await drag(page, [30, 20], [33, 22]);
    const now = await state(page);
    assert.equal(now.entries, before.entries);
    assert.ok(Math.abs(now.x - before.x - 3 * 24 * before.zoom) < 1.5, 'the map moved ' + (now.x - before.x) + ' px across');
    assert.ok(Math.abs(now.y - before.y - 2 * 24 * before.zoom) < 1.5, 'the map moved ' + (now.y - before.y) + ' px down');
    assert.equal(now.zoom, before.zoom);
    assert.equal(now.selection.length, 1, 'moving the map dropped the selection');
    await click(page, 30, 20);
    assert.equal((await state(page)).selection.length, 0, 'a click on empty floor kept the selection');
    await wholeFloor(page);
  });

  test('Shift-click adds to the selection, a Shift-drag box selects what it touches, and Delete removes them in one step', async () => {
    const before = await entries();
    await click(page, 6, 8);
    await page.keyboard.down('Shift');
    await click(page, 11, 8);
    await page.keyboard.up('Shift');
    let now = await state(page);
    assert.equal(now.selection.length, 2);
    assert.equal(await text('#inspector .bld-inspector__title'), '2 spaces are selected');
    await page.keyboard.down('Shift');
    await click(page, 11, 8);
    await page.keyboard.up('Shift');
    assert.equal((await state(page)).selection.length, 1, 'Shift-click on a selected room did not take it out');
    await click(page, 30, 20);
    await page.keyboard.down('Shift');
    await drag(page, [3, 5], [16, 9]);
    await page.keyboard.up('Shift');
    now = await state(page);
    assert.equal(now.selection.length, 3, 'the box did not select the three rooms');
    assert.equal(now.entries, before);
    // a drag that starts on the corridor draws a box too
    await click(page, 30, 20);
    await drag(page, [12, 10], [9, 8]);
    assert.equal((await state(page)).selection.length, 1);
    await page.keyboard.down('Shift');
    await drag(page, [3, 5], [16, 9]);
    await page.keyboard.up('Shift');
    await page.keyboard.press('Delete');
    now = await state(page);
    assert.equal(now.entries, before + 1);
    assert.equal(now.label, 'Delete 3 spaces');
    assert.equal(await text('#plan-counts [data-count="rooms"]'), 'No rooms');
    await page.click('#undo');
    assert.deepEqual(await snapshot(page), expectedPlan());
  });

  test('the Eraser asks about part of a room, the whole room first; a corridor cell just goes', async () => {
    const before = await entries();
    await page.keyboard.press('e');
    await click(page, 13, 9);
    await page.waitForSelector('#erase-dialog[open]');
    assert.equal(await text('#erase-dialog .dialog__title'), 'Erase all of Room 102, or only this cell?');
    assert.deepEqual(await page.$$eval('#erase-dialog .dialog__buttons button', (all) => all.map((button) => button.textContent)), ['Erase all of Room 102', 'Erase only this cell', 'Erase nothing']);
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Erase nothing', 'the safe answer does not have the focus');
    await page.keyboard.press('Enter');
    let now = await state(page);
    assert.equal(now.entries, before, 'Erase nothing erased something');
    assert.equal(now.said, 'Erased nothing.');
    assert.equal(now.focus, 'plan', 'the focus did not go back to the plan');

    await click(page, 13, 9);
    await page.waitForSelector('#erase-dialog[open]');
    await page.click('#erase-dialog .dialog__buttons button:nth-child(2)');
    now = await state(page);
    assert.equal(now.entries, before + 1);
    assert.equal(now.label, 'Erase 1 cell of Room 102 on Floor 1');
    assert.equal((await roomCells(page, '102')).length, 11, 'a room need not be a rectangle');
    assert.equal(await pixel(page, 13, 9, 0.5, 0.5), '#e8e3d8', 'the erased cell is still drawn as room');
    assert.equal(await pixel(page, 12, 9, 0.5, 0.5), '#e9e4d9');

    await click(page, 7, 10);
    now = await state(page);
    assert.equal(now.entries, before + 2, 'a corridor cell asked a question');
    assert.equal(now.said, 'Erased 1 corridor cell.');

    await click(page, 10, 7);
    await page.waitForSelector('#erase-dialog[open]');
    await page.click('#erase-dialog .dialog__buttons button:first-child');
    now = await state(page);
    assert.equal(now.entries, before + 3);
    assert.equal(now.label, 'Erase Room 102 on Floor 1');
    assert.equal(await roomCells(page, '102'), null);

    await click(page, 30, 20);
    now = await state(page);
    assert.equal(now.entries, before + 3);
    assert.equal(now.said, 'Nothing to erase there.');
    // a drag over one row of a room is the same question; over all of it, none
    await drag(page, [5, 7], [8, 7]);
    await page.waitForSelector('#erase-dialog[open]');
    assert.equal(await text('#erase-dialog .dialog__title'), 'Erase all of Room 101, or only these 4 cells?');
    await page.keyboard.press('Escape');
    assert.equal(await entries(), before + 3);
    await drag(page, [15, 9], [15, 9]);
    assert.equal(await page.$('#erase-dialog[open]'), null, 'erasing every cell of a room asked a question');
    assert.equal(await entries(), before + 4);
    await page.click('#undo');
    for (let i = 0; i < 3; i += 1) await page.click('#undo');
    assert.deepEqual(await snapshot(page), expectedPlan());
  });

  test('Line: a click where the corridor starts and a click where it ends; Escape forgets the start', async () => {
    const before = await entries();
    await page.keyboard.press('l');
    assert.equal((await state(page)).hint, 'Line: click where a straight corridor starts, then where it ends.');
    await click(page, 20, 11);
    let now = await state(page);
    assert.equal(now.entries, before, 'the first click of a line changed the building');
    assert.equal(now.preview, 'anchor');
    assert.equal(now.hint, 'Line: now click where the corridor ends. Esc forgets the start.');
    const over = await point(page, 20, 16);
    await page.mouse.move(over.x, over.y);
    assert.equal((await state(page)).preview, 'cells', 'the line does not follow the pointer');
    await page.keyboard.press('Escape');
    now = await state(page);
    assert.equal(now.preview, null);
    assert.equal(now.hint, 'Line: click where a straight corridor starts, then where it ends.');
    await click(page, 20, 11);
    await click(page, 20, 18);
    now = await state(page);
    assert.equal(now.entries, before + 1);
    assert.equal(now.label, 'Paint corridor on Floor 1');
    assert.equal(now.said, 'Painted a straight corridor of 8 cells.');
    // and as one drag
    await drag(page, [22, 18], [27, 18]);
    assert.equal(await entries(), before + 2);
    assert.equal(await text('#plan-counts [data-count="corridor"]'), '30 corridor cells');
    await page.click('#undo');
    await page.click('#undo');
    assert.deepEqual(await snapshot(page), expectedPlan());
  });

  test('an other space by a drag is selected and not asked for a number', async () => {
    const before = await entries();
    await page.keyboard.press('o');
    await drag(page, [24, 12], [26, 13]);
    const now = await state(page);
    assert.equal(now.entries, before + 1);
    assert.equal(now.label, 'Place other space on Floor 1');
    assert.equal(now.selection.length, 1);
    assert.notEqual(now.focus, 'room-number');
    assert.equal(await text('#inspector-title'), 'An other space');
    assert.equal(await pixel(page, 24, 12, 0.3, 0.3), '#b9bdbe', 'an other space is its colour at 60% over the grid');
    await page.click('#undo');
  });

  test('zoom runs from 25% to 300% about the pointer; the wheel, the middle button and Space with a drag move the map', async () => {
    await page.keyboard.press('c');
    await page.click('.bld-status [data-action="fit"]');
    const before = await state(page);
    // a mouse reports whole pixels, so the pointer goes to one, and the place
    // on the floor under that pixel is what has to stay still
    const corner = await point(page, 10, 10, 0.3, 0.6);
    const at = { x: Math.round(corner.x), y: Math.round(corner.y) };
    const under = () => page.evaluate((px, py) => {
      const editor = document.querySelector('.bld').editor;
      const box = editor.canvas.getBoundingClientRect();
      return editor.view.toCell(px - box.left, py - box.top);
    }, at.x, at.y);
    const was = await under();
    await page.mouse.move(at.x, at.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel({ deltaY: -300 });
    await page.keyboard.up('Control');
    let now = await state(page);
    assert.ok(now.zoom > before.zoom * 1.4, 'Ctrl and the wheel did not zoom in');
    const still = await under();
    assert.ok(Math.abs(still.x - was.x) < 1e-6 && Math.abs(still.y - was.y) < 1e-6, 'the place under the pointer moved while zooming: ' + JSON.stringify([was, still]));
    await page.keyboard.down('Control');
    await page.mouse.wheel({ deltaY: -20000 });
    now = await state(page);
    assert.equal(now.zoom, 3);
    assert.equal(await text('#plan-zoom'), '300%');
    await page.mouse.wheel({ deltaY: 40000 });
    await page.keyboard.up('Control');
    now = await state(page);
    assert.equal(now.zoom, 0.25);
    assert.equal(await text('#plan-zoom'), '25%');
    assert.equal(now.entries, before.entries);

    await page.keyboard.press('0');
    now = await state(page);
    assert.ok(Math.abs(now.zoom - before.zoom) < 1e-9 && Math.abs(now.x - before.x) < 1e-6, 'Fit did not bring the plan back');
    await page.keyboard.press('=');
    assert.ok(Math.abs((await state(page)).zoom - before.zoom * 1.25) < 1e-9);
    await page.click('.bld-status [data-action="zoom-out"]');
    assert.ok(Math.abs((await state(page)).zoom - before.zoom) < 1e-9);

    // the wheel alone moves the map: the plan under the pointer, not the page
    const rest = await state(page);
    await page.mouse.move(at.x, at.y);
    await page.mouse.wheel({ deltaY: 50, deltaX: 30 });
    now = await state(page);
    assert.ok(Math.abs(now.x - (rest.x - 30)) < 1e-6 && Math.abs(now.y - (rest.y - 50)) < 1e-6, 'the wheel moved the map by ' + (now.x - rest.x) + ', ' + (now.y - rest.y));
    assert.equal(now.zoom, rest.zoom);
    assert.equal(await page.evaluate(() => document.getElementById('surface').scrollTop), 0, 'the wheel scrolled the page');

    // the middle button, with a drawing tool in hand
    const a = await point(page, 12, 13);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(a.x + 40, a.y + 25, { steps: 4 });
    await page.mouse.up({ button: 'middle' });
    let moved = await state(page);
    assert.ok(Math.abs(moved.x - now.x - 40) < 1e-6 && Math.abs(moved.y - now.y - 25) < 1e-6, 'the middle button did not move the map');
    assert.equal(moved.entries, before.entries, 'the middle button painted');

    // Space held, with the focus on a tool button: the plan takes the focus
    await page.focus('.bld-tool[data-tool="corridor"]');
    await page.mouse.move(a.x, a.y);
    await page.keyboard.down('Space');
    await page.mouse.down();
    await page.mouse.move(a.x - 60, a.y - 10, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up('Space');
    now = await state(page);
    assert.ok(Math.abs(now.x - moved.x + 60) < 1e-6 && Math.abs(now.y - moved.y + 10) < 1e-6, 'Space with a drag did not move the map');
    assert.equal(now.entries, before.entries, 'Space with a drag painted');
    assert.equal(now.tool, 'corridor');
    // and with Space let go, the same drag paints again
    await page.mouse.down();
    await page.mouse.up();
    moved = await state(page);
    assert.equal(moved.entries, before.entries + 1);
    await page.click('#undo');
    await wholeFloor(page);
  });

  test('the fit follows the window until the map is moved by hand', async () => {
    const before = await state(page);
    await page.setViewport({ width: 1000, height: 700 });
    await planReady(page);
    let now = await state(page);
    assert.ok(now.zoom < before.zoom, 'the plan did not fit the smaller window');
    await page.mouse.move(600, 400);
    await page.mouse.wheel({ deltaY: 10 });
    const moved = await state(page);
    await page.setViewport({ width: 1280, height: 900 });
    await planReady(page);
    now = await state(page);
    assert.equal(now.zoom, moved.zoom, 'a plan that was moved by hand was fitted again');
    await wholeFloor(page);
  });

  test('floor tabs: + adds a floor the size of this one; switching keeps the tool and the zoom; copy and paste cross floors', async () => {
    const before = await state(page);
    await page.keyboard.press('v');
    await click(page, 6, 8);
    await page.keyboard.down('Control');
    await page.keyboard.press('c');
    await page.keyboard.up('Control');
    assert.equal((await state(page)).said, 'Copied Room 101.');
    await page.keyboard.press('r');
    await page.keyboard.press('=');
    const zoomed = await state(page);

    assert.deepEqual(await page.$$eval('.bld-floors [role="tab"]', (all) => all.map((tab) => [tab.textContent, tab.getAttribute('aria-selected')])), [['Floor 1', 'true']]);
    await page.click('#add-floor');
    await floorIs(page, 'Floor 2');
    let now = await state(page);
    assert.equal(now.floor, 'Floor 2');
    assert.equal(now.label, 'Add Floor 2');
    assert.equal(now.entries, before.entries + 1);
    assert.equal(now.hash, '#building/' + now.floorId);
    assert.equal(now.tool, 'room', 'the tool changed with the floor');
    assert.equal(now.zoom, zoomed.zoom, 'the zoom changed with the floor');
    assert.equal(now.x, zoomed.x);
    assert.deepEqual(await page.evaluate(() => {
      const floor = globalThis.sv2.store.project.building.floors[1];
      return [floor.width, floor.height, floor.level];
    }), [40, 30, 2]);
    assert.equal(await page.$eval('#empty-floor', (el) => el.hidden), false, 'the new floor is empty and has no card');
    assert.equal(await page.$eval('#plan', (el) => el.getAttribute('aria-label')), 'The floor plan of Floor 2');
    assert.deepEqual(await page.$$eval('.bld-floors [role="tab"]', (all) => all.map((tab) => [tab.textContent, tab.getAttribute('aria-selected')])), [['Floor 1', 'false'], ['Floor 2', 'true']]);

    // paste the copy of Room 101 here: a room, with no number since 101 is taken
    const at = await point(page, 6, 8);
    await page.mouse.move(at.x, at.y);
    await page.focus('#plan');
    await page.keyboard.down('Control');
    await page.keyboard.press('v');
    await page.keyboard.up('Control');
    now = await state(page);
    assert.equal(now.label, 'Paste 1 space on Floor 2');
    assert.equal(now.entries, before.entries + 2);
    assert.equal(now.selection.length, 1);
    assert.deepEqual(await page.evaluate(() => {
      const space = globalThis.sv2.store.project.building.floors[1].spaces[0];
      return [space.kind, space.number, space.cells.length, space.cells[0]];
    }), ['room', '', 12, 8 * 40 + 6]);
    assert.equal(await text('#plan-counts [data-count="rooms"]'), '3 of 4 rooms numbered');

    // that room touches no corridor: a problem, counted on the floor's tab
    assert.equal(await text('.bld-floors [role="tab"][aria-selected="true"] .bld-floors__badge'), '1 problem');
    assert.equal(await page.$('.bld-floors [role="tab"][aria-selected="false"] .bld-floors__badge'), null, 'Floor 1 has no problem and shows a count');

    // back by the tab, on by Page Down, back by Page Up
    await page.click('.bld-floors [role="tab"]:first-child');
    await floorIs(page, 'Floor 1');
    now = await state(page);
    assert.equal(now.floor, 'Floor 1');
    assert.equal(now.hash, '#building/' + now.floorId);
    assert.equal(now.tool, 'room');
    assert.equal(now.zoom, zoomed.zoom);
    assert.equal(now.selection.length, 0, 'a selection crossed floors');
    await page.focus('#plan');
    await page.keyboard.press('PageDown');
    await floorIs(page, 'Floor 2');
    await page.keyboard.press('PageDown');
    assert.equal((await state(page)).said, 'Floor 2 is the last floor.');
    await page.keyboard.press('PageUp');
    await floorIs(page, 'Floor 1');
    await page.goBack();
    await floorIs(page, 'Floor 2');

    // undo past the floor's own entry: the floor on screen is gone, and the first one shows
    await page.click('#undo');
    await page.click('#undo');
    now = await state(page);
    assert.equal(now.floor, 'Floor 1');
    assert.equal(now.hash, '#building');
    assert.equal(now.entries, before.entries);
    assert.deepEqual(await snapshot(page), expectedPlan());
    await wholeFloor(page);
  });

  test('"Show" on an undo message goes to the floor the change was on', async () => {
    await page.click('#redo');
    await page.click('#redo');
    assert.equal((await state(page)).floor, 'Floor 1');
    await page.click('#undo');
    await page.waitForSelector('.toast .toast__action');
    assert.equal(await text('.toast .toast__text'), 'Undid: Paste 1 space on Floor 2');
    await page.click('.toast .toast__action');
    await floorIs(page, 'Floor 2');
    await page.click('#undo');
    assert.equal((await state(page)).floor, 'Floor 1');
  });

  test('leaving the section and coming back keeps the floor, the tool and the zoom', async () => {
    await page.keyboard.press('s');
    await page.keyboard.press('=');
    const before = await state(page);
    await page.keyboard.press('7');
    await page.waitForFunction(() => document.querySelector('.surface__layout').dataset.section === 'project');
    assert.equal(await page.$('#plan'), null);
    assert.equal(await page.$eval('#topbar-row2', (el) => el.hidden), true, 'the floor tabs stayed on another section');
    await page.keyboard.press('s');
    await page.keyboard.press('1');
    await planReady(page);
    const now = await state(page);
    assert.equal(now.tool, 'stairs');
    assert.equal(now.zoom, before.zoom);
    assert.equal(now.x, before.x);
    assert.equal(now.entries, before.entries);
    await page.keyboard.press('v');
  });

  test('only what is in the window is drawn, and one painted cell is redrawn within the budget at the promised size', async (t) => {
    await page.evaluate(async () => {
      const { bigProject } = await import('./test/fixtures/big.mjs');
      const actions = await import('./engine/actions.js');
      const project = bigProject({ seed: 1 });
      project.onboarding.dismissed = true;
      globalThis.sv2.store.apply(actions.replaceProject, { project, label: 'Load the timing fixture' });
    });
    await planReady(page);
    const count = () => page.evaluate(() => {
      const editor = document.querySelector('.bld').editor;
      const proto = CanvasRenderingContext2D.prototype;
      const real = { fillText: proto.fillText, fillRect: proto.fillRect };
      const calls = { fillText: 0, fillRect: 0 };
      proto.fillText = function fillText(...args) {
        calls.fillText += 1;
        return real.fillText.apply(this, args);
      };
      proto.fillRect = function fillRect(...args) {
        calls.fillRect += 1;
        return real.fillRect.apply(this, args);
      };
      editor.drawNow();
      proto.fillText = real.fillText;
      proto.fillRect = real.fillRect;
      return calls;
    });
    const whole = await count();
    assert.ok(whole.fillRect > 150, 'the whole floor drew only ' + whole.fillRect + ' rectangles');
    const at = await point(page, 6, 7);
    await page.mouse.move(at.x, at.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel({ deltaY: -20000 });
    await page.keyboard.up('Control');
    const part = await count();
    assert.ok(part.fillRect < whole.fillRect / 3, 'at 300% the plan drew ' + part.fillRect + ' rectangles, against ' + whole.fillRect + ' for the whole floor');
    assert.ok(part.fillText > 0 && part.fillText < 40, 'at 300% the plan drew ' + part.fillText + ' labels');
    await page.keyboard.press('0');

    // Paint one cell and redraw the floor (ARCHITECTURE 14: under 16 ms). The
    // time is from the store action to the pixels being readable, with the
    // whole floor in the window.
    const times = await page.evaluate(async () => {
      const { store } = globalThis.sv2;
      const actions = await import('./engine/actions.js');
      const editor = document.querySelector('.bld').editor;
      const g = editor.canvas.getContext('2d');
      const floor = editor.floor;
      const out = [];
      // The first time pixels are read back, this Chromium moves the canvas
      // out of the graphics process, which takes about a second and happens
      // once, to a test and never to a person. It is done before the clock starts.
      g.getImageData(0, 0, 1, 1);
      editor.drawNow();
      g.getImageData(0, 0, 1, 1);
      for (let row = 0; row < floor.height; row += 1) {
        const started = performance.now();
        store.apply(actions.paintCorridor, { floorId: floor.id, cells: [row * floor.width] });
        editor.drawNow();
        g.getImageData(0, 0, 1, 1);
        out.push(performance.now() - started);
      }
      return out;
    });
    const sorted = times.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const worst = sorted[sorted.length - 1];
    t.diagnostic('paint one cell and redraw, 4 floors of 60 by 40, 150 rooms, the whole floor in the window: median ' + median.toFixed(2) + ' ms, worst ' + worst.toFixed(2) + ' ms over ' + times.length + ' cells (budget 16 ms, fails at 32)');
    console.log('# paint-and-redraw: median ' + median.toFixed(2) + ' ms, worst ' + worst.toFixed(2) + ' ms, first ' + times[0].toFixed(2) + ' ms');
    assert.ok(median < 32, 'painting one cell and redrawing took ' + median.toFixed(2) + ' ms at the median; the budget is 16 ms and the test fails at twice that');
    assert.equal(await page.evaluate(() => globalThis.sv2.store.history.past.length >= 40), true);
  });

  test('after all of that the page has logged no error', () => {
    assert.deepEqual(session.problems(), { errors: [], blocked: [], shimmed: [] });
  });
}
