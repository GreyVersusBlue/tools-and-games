// Drawing with a finger and with a pen, in a real browser: node test/browser/draw-touch.mjs
//
// Touch events and pen events go in through the browser's own input pipeline
// (the DevTools protocol), so the page receives real Pointer Events of type
// "touch" and "pen". One finger draws; the moment a second lands the drawing
// is called off and the two fingers pan and pinch; a finger held still asks
// for the menu; a pen draws, its barrel button pans, and a palm resting while
// the pen is down does nothing. The page is opened as a touch device, so the
// sizes of the targets are checked against a coarse pointer too.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner } from './harness.mjs';
import { startEmpty, planReady, state, point, roomCells, rect, pause, wholeFloor } from './draw-pointer.mjs';

let session;
let page;
let cdp;

const entries = async () => (await state(page)).entries;

// Fingers: each is { x, y, id }. A move and an end name every finger still down.
function touch(type, fingers) {
  return cdp.send('Input.dispatchTouchEvent', { type, touchPoints: fingers.map((finger) => ({ x: Math.round(finger.x), y: Math.round(finger.y), id: finger.id, radiusX: 4, radiusY: 4, force: 1 })) });
}

// One finger from one place to another, in steps.
async function swipe(from, to, steps = 6) {
  await touch('touchStart', [{ ...from, id: 1 }]);
  for (let i = 1; i <= steps; i += 1) await touch('touchMove', [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps, id: 1 }]);
  await touch('touchEnd', []);
}

function pen(type, at, button, buttons) {
  return cdp.send('Input.dispatchMouseEvent', { type, x: Math.round(at.x), y: Math.round(at.y), button, buttons, clickCount: type === 'mouseMoved' ? 0 : 1, pointerType: 'pen' });
}

before(async () => {
  session = await openPlanner({ theme: 'light', width: 1000, height: 800, mobile: true });
  page = session.page;
  cdp = typeof page.createCDPSession === 'function' ? await page.createCDPSession() : await page.context().newCDPSession(page);
  // Opening the planner empties the saved project through a protocol session
  // of its own, and when that session goes this Chromium stops reporting a
  // coarse pointer. Saying again that this is a touch device brings it back.
  if (!(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) && typeof page.setViewport === 'function') {
    await page.setViewport({ width: 1000, height: 800, deviceScaleFactor: 1 });
    await page.setViewport({ width: 1000, height: 800, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  }
  await planReady(page);
  await startEmpty(page);
  await page.evaluate(() => {
    globalThis.pointerTypes = [];
    document.getElementById('plan').addEventListener('pointerdown', (event) => globalThis.pointerTypes.push(event.pointerType + ':' + event.button));
  });
});

after(async () => {
  if (session) await session.close();
});

test('on a coarse pointer every target of the plan is at least 44 px, and the plan keeps the browser\'s own gestures off', async () => {
  assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), true, 'this page is not a touch device, so the sizes below prove nothing');
  const sizes = await page.evaluate(() => Array.from(document.querySelectorAll('.bld-tool, .bld-floors__tab, #add-floor, .bld-status__btn'), (el) => {
    const box = el.getBoundingClientRect();
    return { what: el.dataset.tool || el.dataset.action || el.id || el.textContent, width: Math.round(box.width), height: Math.round(box.height) };
  }));
  assert.ok(sizes.length >= 13, 'found only ' + sizes.length + ' targets');
  assert.deepEqual(sizes.filter((size) => size.width < 44 || size.height < 44), []);
  const style = await page.$eval('#plan', (el) => {
    const computed = getComputedStyle(el);
    return [computed.touchAction, computed.userSelect, computed.webkitTouchCallout || 'unknown here'];
  });
  assert.equal(style[0], 'none');
  assert.equal(style[1], 'none');
});

test('one finger paints with the tool in hand, as one undo entry', async () => {
  const before = await entries();
  assert.equal((await state(page)).tool, 'corridor');
  await swipe(await point(page, 5, 10), await point(page, 20, 10));
  const now = await state(page);
  assert.equal(now.entries, before + 1);
  assert.equal(now.label, 'Paint corridor on Floor 1');
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.building.floors[0].cells.slice(400, 440)), '.....################...................');
  assert.equal(await page.evaluate(() => globalThis.pointerTypes.join(' ')), 'touch:0');
  assert.equal(await page.$eval('#empty-floor', (el) => el.hidden), true);
});

test('a room drawn by a finger is selected, and the number field is left alone so no keyboard rises over the plan', async () => {
  const before = await entries();
  await page.keyboard.press('r');
  await swipe(await point(page, 5, 7), await point(page, 8, 9));
  const now = await state(page);
  assert.equal(now.entries, before + 1);
  assert.equal(now.selection.length, 1, 'the new room is not selected');
  assert.notEqual(now.focus, 'room-number', 'a finger put the cursor in the number field');
  assert.equal(await page.$('#room-number') !== null, true, 'the field is there to be tapped');
  await page.evaluate(async () => {
    const actions = await import('./engine/actions.js');
    const editor = document.querySelector('.bld').editor;
    globalThis.sv2.store.apply(actions.setRoomFields, { roomId: editor.selection[0], number: '101' });
  });
});

test('the moment a second finger lands the drawing is called off, and the two fingers move the map', async () => {
  const before = await state(page);
  const a = await point(page, 20, 15);
  const b = { x: a.x + 120, y: a.y + 10 };
  await touch('touchStart', [{ ...a, id: 1 }]);
  await touch('touchMove', [{ x: a.x + 40, y: a.y + 30, id: 1 }]);
  let now = await state(page);
  assert.equal(now.preview, 'rect', 'one finger with the Room tool is not drawing');
  await touch('touchStart', [{ x: a.x + 40, y: a.y + 30, id: 1 }, { ...b, id: 2 }]);
  now = await state(page);
  assert.equal(now.preview, null, 'the second finger did not call off the drawing');
  assert.equal(now.said, 'Cancelled. Nothing was changed.');
  // both fingers 50 across and 30 down, the same distance apart
  for (let i = 1; i <= 5; i += 1) await touch('touchMove', [{ x: a.x + 40 + 10 * i, y: a.y + 30 + 6 * i, id: 1 }, { x: b.x + 10 * i, y: b.y + 6 * i, id: 2 }]);
  now = await state(page);
  assert.ok(Math.abs(now.x - before.x - 50) < 1 && Math.abs(now.y - before.y - 30) < 1, 'two fingers moved the map by ' + (now.x - before.x) + ', ' + (now.y - before.y));
  assert.ok(Math.abs(now.zoom - before.zoom) < 1e-9, 'two fingers the same distance apart changed the zoom');
  // one finger lifts: the one left does nothing until every finger is up
  await touch('touchEnd', [{ x: a.x + 90, y: a.y + 60, id: 1 }]);
  await touch('touchMove', [{ x: a.x + 150, y: a.y + 120, id: 1 }]);
  now = await state(page);
  assert.equal(now.preview, null, 'the finger left over started drawing');
  assert.ok(Math.abs(now.x - before.x - 50) < 1, 'the finger left over moved the map');
  await touch('touchEnd', []);
  now = await state(page);
  assert.equal(now.entries, before.entries, 'a drawing that was called off made an undo entry');
  // and then one finger draws again
  await swipe(await point(page, 25, 20), await point(page, 26, 20));
  assert.equal(await entries(), before.entries + 1);
  await page.click('#undo');
  await wholeFloor(page);
});

test('two fingers pinch: the zoom follows the distance between them, about the point between them', async () => {
  const before = await state(page);
  const centre = await point(page, 20, 15, 0, 0);
  const mid = { x: Math.round(centre.x), y: Math.round(centre.y) };
  const under = () => page.evaluate((px, py) => {
    const editor = document.querySelector('.bld').editor;
    const box = editor.canvas.getBoundingClientRect();
    return editor.view.toCell(px - box.left, py - box.top);
  }, mid.x, mid.y);
  const was = await under();
  await touch('touchStart', [{ x: mid.x - 40, y: mid.y, id: 1 }]);
  await touch('touchStart', [{ x: mid.x - 40, y: mid.y, id: 1 }, { x: mid.x + 40, y: mid.y, id: 2 }]);
  for (const reach of [50, 60, 70, 80]) await touch('touchMove', [{ x: mid.x - reach, y: mid.y, id: 1 }, { x: mid.x + reach, y: mid.y, id: 2 }]);
  let now = await state(page);
  assert.ok(Math.abs(now.zoom - before.zoom * 2) < 0.01, 'fingers twice as far apart made the zoom ' + now.zoom + ', from ' + before.zoom);
  const still = await under();
  assert.ok(Math.abs(still.x - was.x) < 0.02 && Math.abs(still.y - was.y) < 0.02, 'the point between the fingers moved: ' + JSON.stringify([was, still]));
  // together again, and far past: the zoom stops at 25%
  for (const reach of [60, 40, 20, 10, 5, 2, 1]) await touch('touchMove', [{ x: mid.x - reach, y: mid.y, id: 1 }, { x: mid.x + reach, y: mid.y, id: 2 }]);
  now = await state(page);
  assert.equal(now.zoom, 0.25);
  await touch('touchEnd', []);
  assert.equal(await entries(), before.entries);
  await wholeFloor(page);
});

test('a finger held still for half a second asks for the menu of its cell and draws nothing; one that moves draws', async () => {
  const before = await entries();
  await page.keyboard.press('c');
  await page.evaluate(() => {
    globalThis.asked = [];
    document.querySelector('.bld').editor.menu = (ev) => globalThis.asked.push([ev.x, ev.y, ev.pointerType]);
  });
  const at = await point(page, 30, 20);
  await touch('touchStart', [{ ...at, id: 1 }]);
  await touch('touchMove', [{ x: at.x + 3, y: at.y + 2, id: 1 }]);
  await pause(650);
  assert.deepEqual(await page.evaluate(() => globalThis.asked), [[30, 20, 'touch']]);
  assert.equal((await state(page)).preview, null, 'the held finger is still drawing');
  await touch('touchEnd', []);
  assert.equal(await entries(), before, 'a long press painted');

  // 14 px of movement is a drag, not a press: no menu, and it paints
  await page.evaluate(() => {
    globalThis.asked = [];
  });
  await touch('touchStart', [{ ...at, id: 1 }]);
  await pause(150);
  await touch('touchMove', [{ x: at.x + 14, y: at.y, id: 1 }]);
  await pause(550);
  assert.deepEqual(await page.evaluate(() => globalThis.asked), []);
  await touch('touchEnd', []);
  assert.equal(await entries(), before + 1);
  await page.click('#undo');

  // with no menu to open, a held finger just goes on drawing
  await page.evaluate(() => {
    document.querySelector('.bld').editor.menu = null;
  });
  await touch('touchStart', [{ ...at, id: 1 }]);
  await pause(650);
  await touch('touchEnd', []);
  assert.equal(await entries(), before + 1);
  await page.click('#undo');
});

test('with Select, a finger grabs a selected room from up to 40 px outside it', async () => {
  const before = await entries();
  await page.keyboard.press('v');
  const inside = await point(page, 6, 8);
  await touch('touchStart', [{ ...inside, id: 1 }]);
  await touch('touchEnd', []);
  assert.equal((await state(page)).selection.length, 1, 'a tap did not select the room');
  // 30 px to the left of the room's edge, on empty floor: the room comes along
  const edge = await point(page, 5, 8, 0, 0.5);
  const side = 24 * (await state(page)).zoom;
  await swipe({ x: edge.x - 30, y: edge.y }, { x: edge.x - 30, y: edge.y - 3 * side });
  let now = await state(page);
  assert.equal(now.entries, before + 1, 'the room was not grabbed from 30 px outside it');
  assert.deepEqual(await roomCells(page, '101'), rect(40, 5, 4, 4, 3));
  // from 60 px outside it is empty floor: the map moves and the room stays
  const far = await point(page, 5, 5, 0, 0.5);
  await swipe({ x: far.x - 60, y: far.y }, { x: far.x - 60, y: far.y + 2 * side });
  now = await state(page);
  assert.equal(now.entries, before + 1);
  assert.deepEqual(await roomCells(page, '101'), rect(40, 5, 4, 4, 3));
  await page.click('#undo');
  await wholeFloor(page);
});

test('a cancelled touch calls off the drawing', async () => {
  const before = await entries();
  await page.keyboard.press('c');
  const at = await point(page, 30, 22);
  await touch('touchStart', [{ ...at, id: 1 }]);
  await touch('touchMove', [{ x: at.x + 40, y: at.y, id: 1 }]);
  // The browser hands the page each touch when it gets to it, not when the
  // test sent it: on a busy machine the cancel had not always arrived when
  // the state was read. Wait for what the page shows, then read.
  const previewIs = (wanted) => page.waitForFunction((kind) => {
    const preview = document.querySelector('.bld').editor.preview;
    return (preview ? preview.kind : null) === kind;
  }, { timeout: 5000 }, wanted).then(() => true, () => false);
  assert.equal(await previewIs('cells'), true, 'the drag never showed what it would draw');
  await touch('touchCancel', []);
  assert.equal(await previewIs(null), true, 'the preview is still there five seconds after the touch was cancelled');
  const now = await state(page);
  assert.equal(now.preview, null);
  assert.equal(now.entries, before);
});

test('a pen draws, and a newly drawn room takes the number as a mouse\'s would', async () => {
  const before = await entries();
  await page.evaluate(() => {
    globalThis.pointerTypes.length = 0;
  });
  await page.keyboard.press('r');
  const from = await point(page, 10, 7);
  const to = await point(page, 13, 9);
  await pen('mouseMoved', from, 'none', 0);
  await pen('mousePressed', from, 'left', 1);
  await pen('mouseMoved', to, 'left', 1);
  await pen('mouseReleased', to, 'left', 0);
  const now = await state(page);
  assert.equal(await page.evaluate(() => globalThis.pointerTypes.join(' ')), 'pen:0', 'the browser did not report a pen');
  assert.equal(now.entries, before + 1);
  assert.equal(now.focus, 'room-number', 'a pen is not a finger: the number field should have the focus');
  await page.keyboard.type('102');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement.id === 'plan');
  assert.deepEqual(await roomCells(page, '102'), rect(40, 10, 7, 4, 3));
});

test('the pen\'s barrel button moves the map, and a palm that rests while the pen is down does nothing', async () => {
  const before = await state(page);
  await page.keyboard.press('c');
  const at = await point(page, 30, 20);
  await pen('mouseMoved', at, 'none', 0);
  await pen('mousePressed', at, 'right', 2);
  await pen('mouseMoved', { x: at.x + 35, y: at.y - 20 }, 'right', 2);
  await pen('mouseReleased', { x: at.x + 35, y: at.y - 20 }, 'right', 0);
  let now = await state(page);
  assert.ok(Math.abs(now.x - before.x - 35) < 1 && Math.abs(now.y - before.y + 20) < 1, 'the barrel button moved the map by ' + (now.x - before.x) + ', ' + (now.y - before.y));
  assert.equal(now.entries, before.entries, 'the barrel button painted');
  await wholeFloor(page);

  // the pen goes down and paints; a palm lands and slides; the pen finishes its stroke
  const a = await point(page, 25, 22);
  const b = await point(page, 30, 22);
  const palm = await point(page, 32, 26);
  const view = await state(page);
  await pen('mouseMoved', a, 'none', 0);
  await pen('mousePressed', a, 'left', 1);
  // a palm is seldom one point: two land, and slide apart as two fingers would to zoom
  await touch('touchStart', [{ ...palm, id: 7 }]);
  await touch('touchStart', [{ ...palm, id: 7 }, { x: palm.x + 40, y: palm.y, id: 8 }]);
  await touch('touchMove', [{ x: palm.x - 30, y: palm.y + 30, id: 7 }, { x: palm.x + 90, y: palm.y + 30, id: 8 }]);
  assert.equal((await state(page)).preview, 'cells', 'the palm called off the pen\'s stroke');
  await pen('mouseMoved', b, 'left', 1);
  await touch('touchEnd', []);
  await pen('mouseReleased', b, 'left', 0);
  now = await state(page);
  assert.equal(now.entries, before.entries + 1);
  assert.equal(now.label, 'Paint corridor on Floor 1');
  assert.equal(now.x, view.x, 'the palm moved the map');
  assert.equal(now.zoom, view.zoom);
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.building.floors[0].cells.slice(22 * 40 + 24, 22 * 40 + 32)), '.######.');

  // a palm that was down first: the pen takes over, and the palm's stroke is called off
  await page.click('#undo');
  await touch('touchStart', [{ ...palm, id: 7 }]);
  await touch('touchMove', [{ x: palm.x + 30, y: palm.y, id: 7 }]);
  await pen('mousePressed', a, 'left', 1);
  await pen('mouseMoved', b, 'left', 1);
  await pen('mouseReleased', b, 'left', 0);
  await touch('touchEnd', []);
  now = await state(page);
  assert.equal(now.entries, before.entries + 1, 'the palm and the pen made ' + (now.entries - before.entries) + ' entries between them');
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.building.floors[0].cells.slice(22 * 40 + 24, 22 * 40 + 32)), '.######.');
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.building.floors[0].cells.slice(26 * 40 + 31, 26 * 40 + 36)), '.....', 'the palm painted');
});

test('after all of that the page has logged no error', () => {
  assert.deepEqual(session.problems(), { errors: [], blocked: [], shimmed: [] });
});
