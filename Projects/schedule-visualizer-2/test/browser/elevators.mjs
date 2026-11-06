// Drawing an elevator, in a real browser: node test/browser/elevators.mjs
//
// The Elevator tool (U) is the twelfth in the strip; a stop is drawn with its
// glyph and its car's letter; connect mode joins stops on three floors by a
// pointer, by keys alone, and at 390 px with a finger, with Cancel, with a
// click on a stairs cell refused in the banner's own live region, and with
// "Connect another floor" and "Done". Every wait is on a state the page sets
// (the plan at rest, the banner, the list of stops), never on a first paint or
// a fixed sleep. node test/browser/elevators.mjs

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, still } from './harness.mjs';
import { startEmpty, planReady, point, click, drag, state, wholeFloor, floorIs, clearToast, pixel } from './draw-pointer.mjs';

let session;
let page;
let cdp = null;

const building = () => page.evaluate(() => JSON.parse(JSON.stringify(globalThis.sv2.store.project.building)));
const entries = async () => (await state(page)).entries;
const text = (selector) => page.$eval(selector, (el) => el.textContent);
const shown = (selector) => page.$eval(selector, (el) => !el.hidden);
const cellOf = (x, y) => y * 40 + x;
const FLOOR_NAMES = ['Floor 1', 'Floor 2', 'Floor 3'];

// A fresh project of three floors, each with a corridor along row 10 (columns
// 5 to 20) and, on Floor 2, a stairs cell at column 14: built through the
// actions, as the sample school gets its elevator only in SV2-106. Floor 1 on screen.
async function threeFloors() {
  await startEmpty(page);
  await page.evaluate(async () => {
    const { store } = globalThis.sv2;
    const actions = await import('./engine/actions.js');
    store.apply(actions.addFloor, {});
    store.apply(actions.addFloor, {});
    for (const floor of store.project.building.floors) store.apply(actions.paintCorridor, { floorId: floor.id, from: 5 + 10 * 40, to: 20 + 10 * 40 });
    store.apply(actions.placeStairs, { floorId: store.project.building.floors[1].id, cells: [14 + 10 * 40] });
  });
  await showFloor('Floor 1');
}

async function showFloor(name) {
  await page.evaluate((wanted) => {
    const tab = Array.from(document.querySelectorAll('.bld-floors__tab')).find((each) => each.textContent.includes(wanted));
    tab.click();
  }, name);
  await floorIs(page, name);
  await still(page);
  await wholeFloor(page);
}

// An elevator stop where the tool in hand is clicked, by the pointer.
async function stopByPointer(name, x, y) {
  await showFloor(name);
  await click(page, x, y);
  await page.waitForFunction((wanted) => (document.querySelector('.bld').editor.floor.lifts || []).includes(wanted), {}, cellOf(x, y));
  await clearToast(page);
}

const connectFrom = (floorIndex, x, y) => page.evaluate(([index, cell]) => {
  const editor = document.querySelector('.bld').editor;
  editor.connect.start({ floorId: globalThis.sv2.store.project.building.floors[index].id, cell });
}, [floorIndex, cellOf(x, y)]);

const bannerHasFocus = () => page.waitForFunction(() => document.activeElement && document.activeElement.id === 'connect-banner');
const listed = (count) => page.waitForFunction((wanted) => document.querySelectorAll('#connect-stops [data-cell]').length === wanted, {}, count);
const said = () => page.$eval('#announcer', (el) => el.textContent);

before(async () => {
  session = await openPlanner({ theme: 'light', hash: '#building' });
  page = session.page;
  await startEmpty(page);
});

after(async () => {
  if (session) await session.close();
});

// ---------------------------------------------------------------- the tool

test('the Elevator tool is the twelfth in the strip, with its key U, which nothing else in the page uses', async () => {
  const tools = await page.$$eval('.bld-tool', (all) => all.map((each) => ({ id: each.dataset.tool, keys: each.getAttribute('aria-keyshortcuts'), title: each.title })));
  assert.equal(tools.length, 12);
  assert.deepEqual(tools[11], { id: 'elevator', keys: 'U', title: 'Elevator (U)' });
  assert.equal(new Set(tools.map((tool) => tool.keys)).size, 12, 'two tools share a key');
  // every key the page lists in Help is listed once
  const helped = await page.evaluate(async () => {
    const { PLAN_KEYS } = await import('./ui/building/index.js');
    return PLAN_KEYS.filter((key) => key.shown === 'U').map((key) => key.id);
  });
  assert.deepEqual(helped, ['tool-elevator']);
  await page.keyboard.press('u');
  const now = await state(page);
  assert.equal(now.tool, 'elevator');
  assert.deepEqual(now.pressed, ['elevator']);
  assert.equal(now.hint, 'Elevator: click to place a stop. Then Connect… it to a stop on another floor.');
});

test('a click with the tool places a stop: a stairs cell in the floor\'s list, drawn, worded, counted and not yet connected', async () => {
  await threeFloors();
  await page.keyboard.press('u');
  const before = await entries();
  await click(page, 6, 10);
  const now = await state(page);
  assert.equal(now.entries, before + 1);
  assert.match(now.label, /^Place an elevator stop on Floor 1/);
  assert.match(now.said, /^Placed 1 elevator stop, replaced 1 corridor cell\. Not connected yet\.$/);
  const floor = (await building()).floors[0];
  assert.equal(floor.cells[cellOf(6, 10)], 'S');
  assert.deepEqual(floor.lifts, [cellOf(6, 10)]);
  assert.equal(await text('[data-count="elevators"]'), '1 elevator stop, not connected');
  assert.equal(await text('[data-count="connections"]'), '0 stairs connections', 'stairs and elevators are counted apart');
  // the cursor line names it, with the letter it will take, from the first placement
  const at = await point(page, 6, 10);
  await page.mouse.move(at.x, at.y);
  await page.waitForFunction(() => document.getElementById('plan-cell').textContent.includes('Elevator A, not connected'));
  // drawn with its own glyph: the ink of the triangles over the stairs colour
  const dark = (hex) => [1, 3, 5].every((at) => parseInt(hex.slice(at, at + 2), 16) < 0x50);
  assert.equal(dark(await pixel(page, 6, 10, 0.5, 0.21)), true, 'no dark glyph in the stop\'s top half');
  // the stairs chevron is not what is drawn there: its pixels are the stairs colour
  assert.notEqual(await pixel(page, 6, 10, 0.5, 0.21), await pixel(page, 6, 10, 0.05, 0.05));
});

test('undo takes the stop away and redo brings it back', async () => {
  await page.focus('#plan');
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await page.waitForFunction(() => (globalThis.sv2.store.project.building.floors[0].lifts || []).length === 0);
  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.keyboard.press('z');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  await page.waitForFunction(() => globalThis.sv2.store.project.building.floors[0].lifts.length === 1);
  await clearToast(page);
});

// ---------------------------------------------------------------- connect mode, by the pointer

test('three floors by the pointer: the banner, its list, a refused stairs click, a second stop on a floor refused, and the join', async () => {
  await stopByPointer('Floor 2', 6, 10);
  await stopByPointer('Floor 3', 6, 10);
  await showFloor('Floor 1');
  const before = await entries();
  await connectFrom(0, 6, 10);
  // focus goes to the banner, which says what to do
  await bannerHasFocus();
  assert.equal(await text('#connect-text'), 'Connecting Elevator A: click its stop on another floor.');
  assert.equal((await state(page)).said, await text('#connect-text'));
  // 44 px Cancel, and the stops it can join, each with its own button
  const cancel = await page.$eval('#connect-cancel', (el) => ({ ...JSON.parse(JSON.stringify(el.getBoundingClientRect())), text: el.textContent }));
  assert.equal(cancel.text, 'Cancel');
  assert.ok(cancel.height >= 44 && cancel.width >= 44, 'Cancel is ' + cancel.width + ' by ' + cancel.height);
  await listed(2);
  assert.deepEqual(await page.$$eval('#connect-stops li', (all) => all.map((each) => each.querySelector('span').textContent)), ['Floor 2, stop not connected', 'Floor 3, stop not connected']);
  assert.deepEqual(await page.$$eval('#connect-stops button', (all) => all.map((each) => each.textContent)), ['Connect here', 'Connect here']);

  // the mode outlives a change of floor; a click on a stairs cell there is refused in the banner
  await showFloor('Floor 2');
  assert.equal(await shown('#connect-banner'), true);
  await clearToast(page);
  await click(page, 14, 10);
  await page.waitForFunction(() => !document.getElementById('connect-note').hidden);
  assert.match(await text('#connect-note'), /^An elevator stop joins only another elevator stop/);
  assert.equal(await entries(), before, 'a refused click made an undo entry');
  assert.equal(await page.$eval('#connect-note', (el) => el.closest('#connect-banner') !== null), true, 'the refusal is outside the banner, a live region');
  assert.equal(await page.evaluate(() => document.querySelector('.toast .toast__text') === null), true, 'the refusal went to a toast as well as the banner');

  // the join: a click on the Floor 2 stop
  await click(page, 6, 10);
  await page.waitForFunction(() => !document.getElementById('connect-done').hidden);
  assert.equal(await text('#connect-text'), 'Elevator A: Floors 1 and 2. Connected.');
  assert.equal((await state(page)).said, 'Elevator A: Floors 1 and 2. Connected.');
  assert.equal(await entries(), before + 1);
  const joined = (await building()).connections;
  assert.equal(joined.length, 1);
  assert.deepEqual([joined[0].kind, joined[0].car, joined[0].staffOnly, joined[0].direction], ['elevator', 'A', true, 'both']);
  assert.equal(await shown('#connect-another'), true);
  assert.equal(await text('#connect-another'), 'Connect another floor');
  assert.equal(await shown('#connect-cancel'), false);
  assert.equal(await text('[data-count="elevators"]'), '1 elevator, 1 stop not connected');

  // a second stop on Floor 2 is refused: Elevator A stops there already
  await stopByPointer('Floor 2', 9, 10);
  await page.click('#connect-another');
  await page.waitForFunction(() => document.getElementById('connect-text').textContent === 'Connecting Elevator A: click its stop on another floor.');
  await click(page, 9, 10);
  await page.waitForFunction(() => !document.getElementById('connect-note').hidden);
  assert.match(await text('#connect-note'), /Elevator A already stops on Floor 2/);
  assert.equal((await building()).connections.length, 1);
  // the list holds only the stop on Floor 3 (the second Floor 2 stop and the first are not joinable)
  await listed(1);
  assert.equal(await text('#connect-stops li span'), 'Floor 3, stop not connected');
  await page.click('#connect-stops button');
  await page.waitForFunction(() => document.getElementById('connect-text').textContent.includes('Floors 1, 2 and 3'));
  assert.equal(await text('#connect-text'), 'Elevator A: Floors 1, 2 and 3. Connected.');
  assert.equal((await building()).connections.length, 2);

  // Done: the banner goes, and the focus is back on the plan at the stop the mode began on
  await page.click('#connect-done');
  await page.waitForFunction(() => document.getElementById('connect-banner').hidden);
  const now = await state(page);
  assert.equal(now.focus, 'plan');
  assert.equal(now.floor, 'Floor 1');
  assert.deepEqual(now.cursor, [6, 10]);
});

test('Escape ends the mode with nothing connected, and the focus goes back to the stop', async () => {
  await showFloor('Floor 2');
  await connectFrom(1, 9, 10);
  await bannerHasFocus();
  await listed(0);
  assert.match(await text('#connect-stops'), /No other elevator stop is free to join/);
  const before = await entries();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('connect-banner').hidden);
  assert.equal(await entries(), before);
  const now = await state(page);
  assert.equal(now.focus, 'plan');
  assert.equal(now.said, 'Cancelled. No elevator was connected.');
  assert.deepEqual(now.cursor, [9, 10]);
});

// ---------------------------------------------------------------- by keys alone

test('three floors by keys alone: place, start, Tab to the list, Enter, Another floor, Done', async () => {
  await threeFloors();
  const walk = async (x, y) => {
    const [cx, cy] = await page.evaluate(() => [document.querySelector('.bld').editor.cursor.x, document.querySelector('.bld').editor.cursor.y]);
    for (let i = 0; i < Math.abs(x - cx); i += 1) await page.keyboard.press(x > cx ? 'ArrowRight' : 'ArrowLeft');
    for (let i = 0; i < Math.abs(y - cy); i += 1) await page.keyboard.press(y > cy ? 'ArrowDown' : 'ArrowUp');
  };
  // Page Down and Page Up change the floor; the plan keeps the keys, so it has the focus first
  const turn = async (key, name) => {
    await page.focus('#plan');
    await page.keyboard.press(key);
    await floorIs(page, name);
    await still(page);
  };
  await page.focus('#plan');
  await page.keyboard.press('u');
  for (let floor = 0; floor < 3; floor += 1) {
    await walk(7, 10);
    await page.keyboard.press('Enter');
    await page.waitForFunction((index) => globalThis.sv2.store.project.building.floors[index].lifts.length === 1, {}, floor);
    if (floor < 2) await turn('PageDown', FLOOR_NAMES[floor + 1]);
  }
  await turn('PageUp', 'Floor 2');
  await turn('PageUp', 'Floor 1');
  const before = await entries();
  await connectFrom(0, 7, 10);
  await bannerHasFocus();
  await listed(2);
  // Tab reaches Cancel, then the first Connect here: the whole mode is reachable by keys
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'connect-cancel');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Connect here: Floor 2, stop not connected');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.getElementById('connect-done').hidden);
  assert.equal(await text('#connect-text'), 'Elevator A: Floors 1 and 2. Connected.');
  // the focus is on the next thing to do
  assert.equal(await page.evaluate(() => document.activeElement.id), 'connect-another');
  await page.keyboard.press('Enter');
  await listed(1);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Connect here: Floor 3, stop not connected');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('connect-text').textContent.includes('Floors 1, 2 and 3'));
  assert.equal(await entries() - before, 2);
  assert.equal(await said(), 'Elevator A: Floors 1, 2 and 3. Connected.');
  // Escape in the joined state is Done
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('connect-banner').hidden);
  const now = await state(page);
  assert.equal(now.focus, 'plan');
  assert.deepEqual(now.cursor, [7, 10]);
});

// ---------------------------------------------------------------- Select on cells

test('Select on a stop or a corridor cell puts it in Properties, Shift adds one more, and Enter does the same from the keys', async () => {
  await threeFloors();
  await page.evaluate(async () => {
    const { store } = globalThis.sv2;
    const actions = await import('./engine/actions.js');
    store.apply(actions.placeLift, { floorId: store.project.building.floors[0].id, cells: [7 + 10 * 40] });
  });
  await page.focus('#plan');
  await page.keyboard.press('v');
  // the stop's Properties are SV2-101b's: the title names an elevator and says it is not connected
  const isStop = () => page.waitForFunction(() => document.getElementById('inspector-title') && /^Elevator.*, not connected$/.test(document.getElementById('inspector-title').textContent));
  await click(page, 7, 10);
  await isStop();
  await click(page, 10, 10);
  await page.waitForFunction(() => document.getElementById('inspector-title') && document.getElementById('inspector-title').textContent === 'Corridor cell');
  await page.keyboard.down('Shift');
  await click(page, 11, 10);
  await page.keyboard.up('Shift');
  await page.waitForFunction(() => document.getElementById('inspector-title') && document.getElementById('inspector-title').textContent === '2 cells selected');
  // a click on bare floor lets them go
  await click(page, 30, 25);
  await page.waitForFunction(() => document.querySelector('#inspector-properties h2').textContent === 'Nothing is selected');
  // from the keys: the cursor on the stop, Enter
  await page.focus('#plan');
  const [cx, cy] = await page.evaluate(() => [document.querySelector('.bld').editor.cursor.x, document.querySelector('.bld').editor.cursor.y]);
  for (let i = 0; i < Math.abs(7 - cx); i += 1) await page.keyboard.press(7 > cx ? 'ArrowRight' : 'ArrowLeft');
  for (let i = 0; i < Math.abs(10 - cy); i += 1) await page.keyboard.press(10 > cy ? 'ArrowDown' : 'ArrowUp');
  await page.keyboard.press('Enter');
  await isStop();
});

// ---------------------------------------------------------------- SV2-101e: mending what SV2-101 left

// Stops on the three floors of threeFloors, placed through the actions (Floor 2's first).
async function stopsOnAll(order = [1, 2, 0]) {
  await page.evaluate(async (floors) => {
    const { store } = globalThis.sv2;
    const actions = await import('./engine/actions.js');
    for (const index of floors) store.apply(actions.placeLift, { floorId: store.project.building.floors[index].id, cells: [6 + 10 * 40] });
  }, order);
}

const undo = async () => {
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
};

test('only the note and the words of the banner are live regions, not the list of stops', async () => {
  await threeFloors();
  await stopsOnAll();
  await showFloor('Floor 1');
  await connectFrom(0, 6, 10);
  await listed(2);
  const live = await page.evaluate(() => {
    const banner = document.getElementById('connect-banner');
    const inLive = (el) => el.closest('[role="status"], [aria-live]') !== null;
    return {
      banner: banner.getAttribute('role'),
      words: inLive(document.getElementById('connect-text')),
      note: inLive(document.getElementById('connect-note')),
      list: inLive(document.getElementById('connect-stops')),
      buttons: Array.from(banner.querySelectorAll('button')).some(inLive),
    };
  });
  assert.deepEqual(live, { banner: 'group', words: true, note: true, list: false, buttons: false });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('connect-banner').hidden);
});

test('undo after a join takes the banner back to picking, with the list, and does not leave "Connected." with Done', async () => {
  await showFloor('Floor 1');
  await connectFrom(0, 6, 10);
  await listed(2);
  await page.click('#connect-stops button');
  await page.waitForFunction(() => !document.getElementById('connect-done').hidden);
  assert.equal(await text('#connect-text'), 'Elevator A: Floors 1 and 2. Connected.');
  await page.focus('#plan');
  await undo();
  await page.waitForFunction(() => globalThis.sv2.store.project.building.connections.length === 0);
  await page.waitForFunction(() => document.getElementById('connect-done').hidden);
  assert.equal(await shown('#connect-banner'), true, 'the mode ended');
  assert.equal(await text('#connect-text'), 'Connecting Elevator A: click its stop on another floor.');
  assert.equal(await shown('#connect-another'), false);
  assert.equal(await shown('#connect-cancel'), true);
  await listed(2);
  // the mode is live again: the list joins
  await page.click('#connect-stops button');
  await page.waitForFunction(() => !document.getElementById('connect-done').hidden);
  await page.click('#connect-done');
  await page.waitForFunction(() => document.getElementById('connect-banner').hidden);
});

test('when the stop being connected is undone away, the banner goes and the plan has the focus', async () => {
  await threeFloors();
  await stopsOnAll();
  await showFloor('Floor 1');
  await connectFrom(0, 6, 10);
  await bannerHasFocus();
  await undo();
  await page.waitForFunction(() => document.getElementById('connect-banner').hidden);
  assert.equal(((await building()).floors[0].lifts || []).length, 0);
  assert.equal((await state(page)).focus, 'plan');
  assert.match(await said(), /The elevator stop being connected is gone/);
});

test('Shift-click on a stop or a corridor cell keeps the selected spaces, and a Shift-drag that finds nothing keeps the cells in Properties', async () => {
  await threeFloors();
  await page.evaluate(async () => {
    const { store } = globalThis.sv2;
    const actions = await import('./engine/actions.js');
    const floorId = store.project.building.floors[0].id;
    store.apply(actions.placeLift, { floorId, cells: [7 + 10 * 40] });
    store.apply(actions.placeRoom, { floorId, rect: { x: 20, y: 3, w: 3, h: 3 } });
  });
  await showFloor('Floor 1');
  await page.focus('#plan');
  await page.keyboard.press('v');
  await click(page, 21, 4);
  await page.waitForFunction(() => document.querySelector('.bld').editor.selection.length === 1);
  const entriesBefore = await entries();
  await page.keyboard.down('Shift');
  await click(page, 7, 10);
  await click(page, 10, 10);
  await page.keyboard.up('Shift');
  const now = await state(page);
  assert.equal(now.selection.length, 1, 'a Shift-click on a cell dropped the space selection');
  assert.equal(await entries(), entriesBefore);
  // the cells without Shift, then a Shift-drag over bare floor
  await click(page, 7, 10);
  await page.waitForFunction(() => document.getElementById('inspector-title') && /^Elevator.*, not connected$/.test(document.getElementById('inspector-title').textContent));
  await page.keyboard.down('Shift');
  await drag(page, [30, 20], [33, 23], undefined);
  await page.keyboard.up('Shift');
  await still(page);
  assert.match(await text('#inspector-title'), /^Elevator.*, not connected$/, 'a Shift-drag that found nothing dropped the cell focus');
});

// ---------------------------------------------------------------- 390 px, with a finger

test('at 390 px: two rows of six tools, 44 px each, and a stop joined with a finger, Cancel, and a refused stairs tap', async () => {
  await session.close();
  session = await openPlanner({ theme: 'light', width: 390, height: 844, mobile: true });
  page = session.page;
  cdp = typeof page.createCDPSession === 'function' ? await page.createCDPSession() : await page.context().newCDPSession(page);
  if (!(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) && typeof page.setViewport === 'function') {
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  }
  await planReady(page);
  await threeFloors();
  const boxes = await page.$$eval('.bld-tool', (all) => all.map((each) => {
    const box = each.getBoundingClientRect();
    return { id: each.dataset.tool, top: Math.round(box.top), left: Math.round(box.left), width: Math.round(box.width), height: Math.round(box.height) };
  }));
  assert.equal(boxes.length, 12);
  assert.deepEqual([...new Set(boxes.map((box) => box.top))].length, 2, 'the tools are not in two rows: ' + JSON.stringify(boxes.map((box) => box.top)));
  assert.equal(boxes.filter((box) => box.top === boxes[0].top).length, 6);
  assert.deepEqual(boxes.filter((box) => box.width < 44 || box.height < 44), []);
  assert.equal(boxes[11].id, 'elevator');

  const tap = async (cellX, cellY) => {
    const at = await point(page, cellX, cellY);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(at.x), y: Math.round(at.y), id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  for (const [index, name] of FLOOR_NAMES.entries()) {
    await showFloor(name);
    if (index === 0) await page.click('[data-tool="elevator"]');
    await tap(6, 10);
    await page.waitForFunction((n) => globalThis.sv2.store.project.building.floors[n].lifts.length === 1, {}, index);
  }
  await clearToast(page);
  await showFloor('Floor 1');
  await connectFrom(0, 6, 10);
  await bannerHasFocus();
  await listed(2);
  const targets = await page.$$eval('#connect-banner button', (all) => all.filter((each) => each.offsetParent !== null).map((each) => ({ text: each.textContent, width: Math.round(each.getBoundingClientRect().width), height: Math.round(each.getBoundingClientRect().height) })));
  assert.equal(targets.length, 3);
  assert.deepEqual(targets.filter((target) => target.width < 44 || target.height < 44), []);

  // a tap on a stairs cell on Floor 2 is refused where the banner says it
  await showFloor('Floor 2');
  const before = await entries();
  await tap(14, 10);
  await page.waitForFunction(() => !document.getElementById('connect-note').hidden);
  assert.match(await text('#connect-note'), /^An elevator stop joins only another elevator stop/);
  assert.equal(await entries(), before);

  // Cancel, by a finger: the banner goes and the plan has the focus again
  const cancel = await page.$eval('#connect-cancel', (el) => {
    const box = el.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(cancel.x), y: Math.round(cancel.y), id: 2, radiusX: 4, radiusY: 4, force: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForFunction(() => document.getElementById('connect-banner').hidden);
  assert.equal(await entries(), before);
  assert.equal((await state(page)).floor, 'Floor 1', 'the focus went back to the stop, on its floor');
  assert.equal((await state(page)).focus, 'plan');
  assert.equal(await said(), 'Cancelled. No elevator was connected.');

  // and a join by "Connect here", a finger on the list
  await connectFrom(0, 6, 10);
  await bannerHasFocus();
  await listed(2);
  const connect = await page.$eval('#connect-stops button', (el) => {
    const box = el.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(connect.x), y: Math.round(connect.y), id: 3, radiusX: 4, radiusY: 4, force: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForFunction(() => document.getElementById('connect-text').textContent === 'Elevator A: Floors 1 and 2. Connected.');
  assert.equal((await building()).connections.length, 1);
});

// ---------------------------------------------------------------- 390 px, eight floors, and two fingers

// Eight floors, each with a stop at column 6, row 10; Floor 1 on screen.
async function eightFloors() {
  await startEmpty(page);
  await page.evaluate(async () => {
    const { store } = globalThis.sv2;
    const actions = await import('./engine/actions.js');
    for (let i = 0; i < 7; i += 1) store.apply(actions.addFloor, {});
    for (const floor of store.project.building.floors) {
      store.apply(actions.paintCorridor, { floorId: floor.id, from: 5 + 10 * 40, to: 20 + 10 * 40 });
      store.apply(actions.placeLift, { floorId: floor.id, cells: [6 + 10 * 40] });
    }
  });
  await showFloor('Floor 1');
}

const swipeBy = async (from, to) => {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(from.x), y: Math.round(from.y), id: 7, radiusX: 4, radiusY: 4, force: 1 }] });
  for (let i = 1; i <= 6; i += 1) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: Math.round(from.x + ((to.x - from.x) * i) / 6), y: Math.round(from.y + ((to.y - from.y) * i) / 6), id: 7, radiusX: 4, radiusY: 4, force: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};

test('at 390 px with eight floors the banner is held to 60% of the stage and every "Connect here" is reached by touch and scrolling', async () => {
  await eightFloors();
  await connectFrom(0, 6, 10);
  await bannerHasFocus();
  await listed(7);
  const size = await page.evaluate(() => {
    const banner = document.getElementById('connect-banner');
    const stage = banner.parentElement;
    return { banner: banner.getBoundingClientRect().height, stage: stage.getBoundingClientRect().height, scroll: banner.scrollHeight, client: banner.clientHeight, overflow: getComputedStyle(banner).overflowY };
  });
  assert.ok(size.banner <= size.stage * 0.6 + 1, 'the banner is ' + size.banner + ' px of a ' + size.stage + ' px stage');
  assert.ok(size.scroll > size.client, 'the banner does not overflow, so the test shows nothing: ' + JSON.stringify(size));
  assert.equal(size.overflow, 'auto');
  const reach = (index) => page.evaluate((i) => {
    const button = document.querySelectorAll('#connect-stops button')[i];
    const banner = document.getElementById('connect-banner');
    const box = button.getBoundingClientRect();
    const cage = banner.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    return { x, y, inside: y > cage.top && y < cage.bottom, top: document.elementFromPoint(x, y) === button, cage: { x: cage.left + cage.width / 2, top: cage.top, bottom: cage.bottom } };
  }, index);
  for (let index = 0; index < 7; index += 1) {
    let found = await reach(index);
    for (let tries = 0; tries < 40 && !(found.inside && found.top); tries += 1) {
      const before = await page.$eval('#connect-banner', (el) => el.scrollTop);
      const mid = (found.cage.top + found.cage.bottom) / 2;
      await swipeBy({ x: found.cage.x, y: mid + 40 }, { x: found.cage.x, y: mid - 40 });
      await page.waitForFunction((was) => document.getElementById('connect-banner').scrollTop !== was, { timeout: 2000 }, before).catch(() => {});
      found = await reach(index);
    }
    assert.equal(found.inside && found.top, true, 'the ' + (index + 1) + 'th Connect here cannot be reached: ' + JSON.stringify(found));
  }
});

test('in connect mode two fingers still pan and pinch the plan, and nothing is connected or drawn', async () => {
  const before = await entries();
  const zoom = () => page.evaluate(() => document.querySelector('.bld').editor.view.zoom);
  const start = await zoom();
  // two fingers on the bare floor below the banner
  const box = await page.$eval('#plan', (el) => {
    const b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.bottom - 30 };
  });
  assert.equal(await page.evaluate(([x, y]) => document.elementFromPoint(x, y).id, [box.x, box.y]), 'plan', 'the fingers would not land on the plan');
  const two = (gap, type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [{ x: Math.round(box.x - gap), y: Math.round(box.y), id: 21, radiusX: 4, radiusY: 4, force: 1 }, { x: Math.round(box.x + gap), y: Math.round(box.y), id: 22, radiusX: 4, radiusY: 4, force: 1 }] });
  await two(20, 'touchStart');
  for (const gap of [30, 45, 60, 80, 100]) await two(gap, 'touchMove');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForFunction((was) => document.querySelector('.bld').editor.view.zoom !== was, { timeout: 3000 }, start).catch(() => {});
  assert.ok((await zoom()) > start, 'the pinch did not zoom: ' + start + ' to ' + (await zoom()));
  assert.equal(await entries(), before, 'the tool in hand drew something');
  assert.equal((await building()).connections.length, 0);
  assert.equal(await shown('#connect-banner'), true, 'the mode ended');
  await page.evaluate(() => document.querySelector('.bld').editor.connect.cancel(true));
});
