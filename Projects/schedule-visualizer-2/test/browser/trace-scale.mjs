// Scaling the traced image from a length (SV2-73a), in a real browser:
// node test/browser/trace-scale.mjs
//
// Devon: "place two points on the image, then say how many feet wide it is."
// On the Floor tab, "Scale the image from a length" starts a mode said in the
// status line and in a banner with Cancel; two points go on the image by
// mouse, by keyboard (the plan's cursor and Enter) and by touch at 390 by 844
// (where the finger lifts, at a marker above it); the form takes a length in
// feet, metres or cells, asks "One cell is how many feet?" the first time feet
// are given and keeps the answer as the project's Cell scale; the image is
// scaled in one undo step with the first point where it was. A zero, a
// negative and a non-number are refused in a sentence, a locked image is
// refused with the reason, Escape and Cancel change nothing, and Settings
// shows, changes and clears the Cell scale. axe on the Floor tab with the
// mode open, and on Settings, in both themes.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openPlanner, launch, startServer, loadModule, assertTouch, go, TOOL_DIR } from './harness.mjs';
import { startEmpty, planReady, point, state, wholeFloor, clearToast, drag } from './draw-pointer.mjs';
import { floorPoint } from '../../ui/building/scale-tool.js';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'images', 'floor-plan.png');
const AXE = path.join(TOOL_DIR, 'test', 'vendor', 'axe-core', 'axe.min.js');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

let browser;
let server;
let session;
let page;

const near = (a, b, what, within) => assert.ok(Math.abs(a - b) <= within, what + ': ' + a + ' is not within ' + within + ' of ' + b);
const project = (p = page) => p.evaluate(() => JSON.parse(JSON.stringify(globalThis.sv2.store.project)));
// how many undo steps there are, on any section
const entries = (p = page) => p.evaluate(() => globalThis.sv2.store.history.past.length);
const text = (selector, p = page) => p.$eval(selector, (el) => el.textContent);
const hidden = (selector, p = page) => p.$eval(selector, (el) => el.hidden || el.closest('[hidden]') !== null);

// The points placed so far, in cells on the floor.
const points = (p = page) => p.evaluate(() => document.querySelector('.bld').editor.trace.scaling.points);
const active = (p = page) => p.evaluate(() => document.querySelector('.bld').editor.trace.scaling.active);

async function upload(p) {
  const input = await p.$('#trace-file');
  await input.uploadFile(FIXTURE);
  await p.waitForFunction(() => globalThis.sv2.store.project.building.floors[0].image !== null);
}

// The image as it was fitted to the empty floor: 1600 by 1200 pixels drawn 40
// by 30 cells, its corner at 0, 0, and no Cell scale.
async function freshImage(p) {
  await p.evaluate(() => {
    const { store } = globalThis.sv2;
    const { setTraceImage, setSetting } = globalThis.sv2modules.actions;
    const floorId = store.project.building.floors[0].id;
    store.apply(setTraceImage, { floorId, image: { scale: 0.025, x: 0, y: 0, rotation: 0, locked: false, visible: true } });
    if (store.project.settings.cellScale) store.apply(setSetting, { key: 'cellScale', value: null });
  });
}

// Where an image place (in its own pixels) lies on the floor now, in cells.
function onFloor(image, u, v) {
  return { x: image.x + u * image.scale, y: image.y + v * image.scale };
}

// One corridor cell in the far corner, so the floor is not empty: on an empty
// floor the "This is the building" card stands in the middle of the plan, over
// the image, and a click there presses its buttons. Then the Corridor tool,
// which a click on the plan would paint with were the mode not in the way.
async function notEmpty(p) {
  await p.evaluate(() => {
    const { store } = globalThis.sv2;
    const floor = store.project.building.floors[0];
    store.apply(globalThis.sv2modules.actions.paintCorridor, { floorId: floor.id, cells: [floor.width * floor.height - 1] });
  });
  await p.waitForFunction(() => document.getElementById('empty-floor').hidden);
  await p.evaluate(() => document.querySelector('.bld').editor.setTool('corridor'));
}

async function floorTab(p) {
  if (await p.$eval('#inspector', (el) => el.dataset.open) === 'false') await p.evaluate(() => globalThis.sv2.ctx.openInspector());
  await p.waitForSelector('#inspector [data-tab="floor"]', { visible: true });
  await p.click('#inspector [data-tab="floor"]');
  await p.waitForSelector('#trace-heading');
}

before(async () => {
  server = await startServer();
  browser = await launch();
  session = await openPlanner({ browser, server, hash: '#building', theme: 'light' });
  page = session.page;
  await loadModule(page, 'actions', 'engine/actions.js');
  await startEmpty(page);
  await floorTab(page);
  await upload(page);
  await notEmpty(page);
  await wholeFloor(page);
  await clearToast(page);
});

after(async () => {
  if (session) await session.close();
  if (browser) await browser.close();
  if (server) await server.close();
});

// ---------------------------------------------------------------- by mouse

test('by mouse: two points, a length in feet, the Cell scale asked for once and kept, the image scaled in one step with the first point where it was', async () => {
  await freshImage(page);
  const start = await project();
  const before = await entries();
  assert.equal((await state(page)).tool, 'corridor', 'the Corridor tool, which a click would paint with');
  await page.click('#trace-scale');
  assert.equal(await active(), true);
  assert.equal(await hidden('#scale-banner'), false);
  assert.match(await text('#scale-text'), /^Scaling the image: place the first point at one end of a length you know/);
  assert.equal((await state(page)).hint, await text('#scale-text'), 'the mode is said in the status line');
  assert.equal(await hidden('#scale-form'), true, 'no form before two points');

  // the image's pixels 220, 220 and 620, 220: cells 5.5, 5.5 and 15.5, 5.5
  const a = await point(page, 5, 5);
  await page.mouse.click(a.x, a.y);
  assert.equal((await points()).length, 1);
  assert.match(await text('#scale-text'), /^First point at 5\.5, 5\.5 cells\. Now place the second point/);
  const b = await point(page, 15, 5);
  await page.mouse.click(b.x, b.y);
  const placed = await points();
  assert.equal(placed.length, 2);
  near(placed[0].x, 5.5, 'first x', 1e-6);
  near(placed[1].x, 15.5, 'second x', 1e-6);
  assert.equal(await hidden('#scale-form'), false);
  assert.equal(await text('#scale-line'), 'The line is 10 cells long on the floor now.');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'scale-length', 'a mouse leaves the length field ready to type in');
  assert.equal(await page.$eval('input[name="scale-unit"]:checked', (el) => el.value), 'feet', 'feet first');
  assert.equal(await hidden('#scale-cell-part'), false, 'no Cell scale yet, so the form asks for one');
  assert.equal(await text('#scale-cell-part label'), 'One cell is how many feet?');
  assert.equal((await project()).building.floors[0].cells, start.building.floors[0].cells, 'the Corridor tool painted nothing');
  assert.equal(await entries(), before, 'placing points is no change to the project');

  await page.keyboard.type('100');
  await page.click('#scale-cell');
  await page.keyboard.type('5');
  await page.keyboard.press('Enter');
  const image = (await project()).building.floors[0].image;
  // a click lands on a whole CSS pixel, so the points are the ones placed, not 5.5 exactly
  const pixels = Math.hypot(placed[1].x - placed[0].x, placed[1].y - placed[0].y) / 0.025;
  near(image.scale, 20 / pixels, 'scale: 100 feet at 5 feet a cell is 20 cells', 1e-12);
  const first = onFloor(image, placed[0].x / 0.025, placed[0].y / 0.025);
  near(first.x, placed[0].x, 'the first point stays put, x', 1e-9);
  near(first.y, placed[0].y, 'the first point stays put, y', 1e-9);
  const second = onFloor(image, placed[1].x / 0.025, placed[1].y / 0.025);
  near(Math.hypot(second.x - first.x, second.y - first.y), 20, 'the line is 20 cells', 1e-9);
  assert.deepEqual((await project()).settings.cellScale, { unit: 'feet', length: 5 });
  assert.equal(await entries(), before + 1, 'the image and the Cell scale are one undo step');
  assert.equal((await state(page)).label, 'Scale the traced image on Floor 1');
  assert.equal((await state(page)).toast, 'Scaled the image: the line is 100 feet, 20 cells, and the image is 80 cells wide. One cell is 5 feet is kept as the project\'s Cell scale, in Settings.');
  assert.equal(await active(), false);
  assert.equal(await hidden('#scale-mode'), true);
  assert.match((await state(page)).hint, /^Corridor:/, 'the status line is the tool\'s again');
  assert.equal(await page.$eval('#trace-width', (el) => el.value), '80');

  // with the Cell scale set, the form says it and does not ask
  await page.click('#trace-scale');
  await page.mouse.click(a.x, a.y);
  await page.mouse.click(b.x, b.y);
  assert.equal(await hidden('#scale-cell-part'), true);
  assert.equal(await text('#scale-cell-known'), 'One cell is 5 feet, the project\'s Cell scale. Change it in Settings.');
  await page.click('input[name="scale-unit"][value="metres"] + .seg__label');
  assert.equal(await text('#scale-cell-known'), 'One cell is 5 feet (1.52 metres), the project\'s Cell scale. Change it in Settings.');
  await page.keyboard.press('Escape');
  assert.equal(await active(), false);
  assert.equal(await entries(), before + 1, 'Escape changed nothing');
  await page.click('#undo');
  assert.equal((await project()).settings.cellScale, undefined, 'one undo takes back the Cell scale too');
  assert.ok(Math.abs((await project()).building.floors[0].image.scale - 0.025) < 1e-12);
  await clearToast(page);
});

test('a length of nothing, a negative, a non-number and a Cell scale of nothing are refused in a sentence, and nothing changes', async () => {
  await freshImage(page);
  const before = await entries();
  await page.click('#trace-scale');
  assert.equal(await active(), true, 'the mode did not start: ' + JSON.stringify(await state(page)));
  await page.mouse.click(...Object.values(await point(page, 5, 20)));
  await page.mouse.click(...Object.values(await point(page, 25, 20)));
  assert.equal((await points()).length, 2);
  assert.equal(await hidden('#scale-form'), false);
  const refusal = () => page.$eval('#scale-refusal', (el) => (el.hidden ? null : el.textContent));
  const typeLength = async (value) => {
    await page.click('#scale-length', { clickCount: 3 });
    await page.keyboard.press('Backspace');
    if (value) await page.keyboard.type(value);
    await page.click('#scale-apply');
  };
  await page.click('input[name="scale-unit"][value="cells"] + .seg__label');
  assert.equal(await hidden('#scale-cell-part'), true, 'cells need no Cell scale');
  for (const [typed, said] of [['0', 'The line needs a length above 0.'], ['-4', 'The line cannot be shorter than nothing. Type a length above 0.'], ['twelve', '"twelve" is not a number. Type how long the line is, like 30.'], ['', 'Type how long the line is, like 30.']]) {
    await typeLength(typed);
    assert.equal(await refusal(), said, typed);
    assert.equal(await page.$eval('#scale-length', (el) => el.getAttribute('aria-invalid') + ' ' + el.getAttribute('aria-describedby')), 'true scale-refusal');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'scale-length');
  }
  await page.click('input[name="scale-unit"][value="feet"] + .seg__label');
  await typeLength('40');
  assert.equal(await refusal(), 'Type how long one cell is, like 5.');
  await page.click('#scale-cell');
  await page.keyboard.type('0');
  await page.click('#scale-apply');
  assert.equal(await refusal(), 'One cell needs a length above 0.');
  assert.equal(await page.$eval('#scale-cell', (el) => el.getAttribute('aria-invalid')), 'true');
  // an image grown past any floor
  await page.click('input[name="scale-unit"][value="cells"] + .seg__label');
  await typeLength('1200');
  assert.equal(await refusal(), 'That would make the image 2,400 cells across, far larger than any floor can be (200 cells). Check the length and its unit.');
  assert.equal(await entries(), before, 'no refusal changed the project');
  assert.equal(await active(), true, 'the mode goes on after a refusal');
  await page.click('#scale-cancel');
  assert.equal(await active(), false);
  assert.equal((await state(page)).said, 'Cancelled. The image is as it was.');
});

test('a point can be placed again before finishing: near the second, it moves the second; Place the points again starts over', async () => {
  await freshImage(page);
  await page.click('#trace-scale');
  await page.mouse.click(...Object.values(await point(page, 5, 10)));
  await page.mouse.click(...Object.values(await point(page, 15, 10)));
  await page.mouse.click(...Object.values(await point(page, 18, 12)));
  let placed = await points();
  near(placed[0].x, 5.5, 'the first stays', 1e-6);
  near(placed[1].x, 18.5, 'the second moved, x', 1e-6);
  near(placed[1].y, 12.5, 'the second moved, y', 1e-6);
  await page.mouse.click(...Object.values(await point(page, 3, 9)));
  placed = await points();
  near(placed[0].x, 3.5, 'near the first, the first moves', 1e-6);
  await page.click('#scale-again');
  assert.equal((await points()).length, 0);
  assert.match(await text('#scale-text'), /^Scaling the image: place the first point/);
  // a second point in the same place as the first is refused
  await page.mouse.click(...Object.values(await point(page, 3, 9)));
  await page.mouse.click(...Object.values(await point(page, 3, 9)));
  assert.equal(await page.evaluate(() => document.querySelector('.toast .toast__text').textContent), 'The two points are in the same place on the image. Place the second point at the other end of a length you know.');
  assert.equal((await points()).length, 1, 'the point in the same place is taken away, the first kept');
  assert.equal(await hidden('#scale-form'), true);
  await page.keyboard.press('Escape');
  await clearToast(page);
});

test('a locked image is refused with the reason, and the plan\'s tool is in hand again', async () => {
  await freshImage(page);
  await page.click('#trace-locked');
  assert.equal((await project()).building.floors[0].image.locked, true);
  await page.click('#trace-scale');
  assert.equal(await active(), false);
  assert.equal((await state(page)).toast, 'The image is locked, so it cannot be scaled. Untick "Lock the image" first.');
  await page.click('#trace-locked');
  // locking it while the mode lasts ends the mode
  await page.click('#trace-scale');
  assert.equal(await active(), true);
  await page.click('#trace-locked');
  assert.equal(await active(), false, 'locking the image ends the mode');
  assert.equal(await hidden('#scale-mode'), true);
  assert.match((await state(page)).hint, /^Corridor:/);
  await page.click('#trace-locked');
  await clearToast(page);
});

// ---------------------------------------------------------------- by keyboard

test('by keyboard: the button by Enter brings up the plan\'s cursor, Enter places each point, and a length in cells scales it', async () => {
  await freshImage(page);
  const before = await entries();
  await page.evaluate(() => document.querySelector('.bld').editor.cursor.moveTo(5, 12, false));
  await page.focus('#trace-scale');
  await page.keyboard.press('Enter');
  assert.equal(await active(), true);
  let now = await state(page);
  assert.equal(now.focus, 'plan', 'the plan has the focus');
  assert.notEqual(now.cursor, null, 'the cursor shows');
  const [cx, cy] = now.cursor;
  await page.keyboard.press('Enter');
  assert.equal((await points()).length, 1, 'Enter on the plan places the first point');
  for (let i = 0; i < 8; i += 1) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  const placed = await points();
  near(placed[0].x, cx + 0.5, 'first at the cursor cell\'s middle', 1e-6);
  near(placed[1].x, cx + 8.5, 'second eight cells along', 1e-6);
  near(placed[1].y, cy + 0.5, 'second on the same row', 1e-6);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'scale-length');
  await page.keyboard.type('16');
  // Tab into the units, which are one Tab stop moved by arrows
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.name + ':' + document.activeElement.value), 'scale-unit:feet');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => document.activeElement.value), 'cells');
  assert.equal(await hidden('#scale-cell-part'), true);
  await page.keyboard.down('Shift');
  await page.keyboard.press('Tab');
  await page.keyboard.up('Shift');
  await page.keyboard.press('Enter');
  const image = (await project()).building.floors[0].image;
  near(image.scale, 0.05, 'scale: 16 cells over 8 cells is twice', 1e-9);
  const first = onFloor(image, (cx + 0.5) / 0.025, (cy + 0.5) / 0.025);
  near(first.x, cx + 0.5, 'the first point stays put, x', 1e-9);
  near(first.y, cy + 0.5, 'the first point stays put, y', 1e-9);
  assert.equal((await project()).settings.cellScale, undefined, 'cells keep no Cell scale');
  assert.equal(await entries(), before + 1);
  now = await state(page);
  assert.equal(now.focus, 'plan', 'the focus goes back to the plan');
  assert.equal(now.said, 'Scaled the image: the line is 16 cells, and the image is 80 cells wide.');
  await clearToast(page);
});

// ---------------------------------------------------------------- Settings

test('Settings shows the Cell scale, changes its length and unit, and clears it, each one undo step', async () => {
  await freshImage(page);
  await go(page, '#project');
  const row = () => page.evaluate(() => {
    const field = document.querySelector('#settings input[name="cellScale"]');
    const setting = field.closest('.setting');
    return { value: field.value, placeholder: field.placeholder, now: setting.querySelector('.setting__summary').textContent, unit: setting.querySelector('input[name="cellScale.unit"]:checked').value, clear: setting.querySelector('[data-action="clear-cell-scale"]').disabled, hint: setting.querySelector('.setting__hint').textContent };
  });
  let shown = await row();
  assert.deepEqual([shown.value, shown.placeholder, shown.now, shown.unit, shown.clear], ['', 'Not set', 'Not set.', 'feet', true]);
  assert.match(shown.hint, /Building uses it to scale a traced image from a length\. Real distances in directions and reports, and walking speed as a speed, are not in the tool yet\.$/);
  const before = await entries();
  await page.click('#settings input[name="cellScale"]');
  await page.keyboard.type('2,5');
  await page.keyboard.press('Enter');
  assert.deepEqual((await project()).settings.cellScale, { unit: 'feet', length: 2.5 });
  assert.equal(await page.$eval('#undo', (el) => el.getAttribute('aria-label')), 'Undo: Change the cell scale');
  shown = await row();
  assert.deepEqual([shown.value, shown.now, shown.clear], ['2.5', 'One cell is 2.5 feet.', false]);
  await page.click('#settings input[name="cellScale.unit"][value="metres"] + .seg__label');
  assert.deepEqual((await project()).settings.cellScale, { unit: 'metres', length: 2.5 });
  assert.equal((await row()).now, 'One cell is 2.5 metres.');
  await page.click('#settings input[name="cellScale"]', { clickCount: 3 });
  await page.keyboard.type('0');
  await page.keyboard.press('Enter');
  assert.equal(await page.$eval('#settings input[name="cellScale"]', (el) => el.closest('.field').querySelector('.field__refusal').textContent), 'One cell needs a length above 0.');
  await page.keyboard.press('Escape');
  await page.click('#settings [data-action="clear-cell-scale"]');
  assert.equal((await project()).settings.cellScale, null);
  shown = await row();
  assert.deepEqual([shown.value, shown.now, shown.clear], ['', 'Not set.', true]);
  assert.equal(await entries(), before + 3, 'set, a unit and a clear: three steps; a refusal none');
  await go(page, '#building');
  await planReady(page);
  await floorTab(page);
});

// ---------------------------------------------------------------- axe

test('axe finds nothing on the Floor tab with the mode open and its form, nor on Settings, in the light theme or the dark', async () => {
  await freshImage(page);
  for (const theme of ['light', 'dark']) {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), theme);
    await floorTab(page);
    await page.click('#trace-scale');
    await page.mouse.click(...Object.values(await point(page, 5, 20)));
    await page.mouse.click(...Object.values(await point(page, 25, 20)));
    await page.click('#scale-apply');
    assert.equal(await page.$eval('#scale-refusal', (el) => el.hidden), false, 'the refusal is in the page for axe to read');
    await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
    if (!(await page.evaluate(() => Boolean(globalThis.axe)))) await page.addScriptTag({ path: AXE });
    const found = await page.evaluate((tags) => globalThis.axe.run(document, { runOnly: { type: 'tag', values: tags } }).then((result) => ({ passes: result.passes.length, violations: result.violations.map((v) => v.id + ': ' + v.nodes.map((n) => n.target.join(' ')).join(', ')) })), TAGS);
    assert.ok(found.passes > 10, 'axe ran very few rules');
    assert.deepEqual(found.violations, [], 'the Floor tab and the mode in the ' + theme + ' theme');
    await page.keyboard.press('Escape');
    await go(page, '#project');
    const settings = await page.evaluate((tags) => globalThis.axe.run(document.querySelector('#settings'), { runOnly: { type: 'tag', values: tags } }).then((result) => result.violations.map((v) => v.id + ': ' + v.nodes.map((n) => n.target.join(' ')).join(', '))), TAGS);
    assert.deepEqual(settings, [], 'Settings in the ' + theme + ' theme');
    await go(page, '#building');
    await planReady(page);
  }
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
});

// ---------------------------------------------------------------- by touch

test('by touch at 390 by 844: the sheet steps aside, each point goes in where the finger lifts at the marker above it, and the keyboard does not rise by itself', async () => {
  // its own server, so its own origin: its own IndexedDB and tab lock, not a second tab of the page above
  const phone = await openPlanner({ browser, hash: '#building', width: 390, height: 844, mobile: true });
  try {
    const p = phone.page;
    await assertTouch(p, 'trace-scale at 390 by 844');
    await loadModule(p, 'actions', 'engine/actions.js');
    await startEmpty(p);
    await floorTab(p);
    await upload(p);
    await notEmpty(p);
    await freshImage(p);
    await wholeFloor(p);
    await clearToast(p);
    const cdp = await p.createCDPSession();
    const finger = (type, at) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: at ? [{ x: Math.round(at.x), y: Math.round(at.y), id: 1, radiusX: 4, radiusY: 4, force: 1 }] : [] });
    await p.$eval('#trace-scale', (el) => el.scrollIntoView({ block: 'center' }));
    const button = await p.$eval('#trace-scale', (el) => el.getBoundingClientRect().height);
    assert.ok(button >= 44, 'the button is a finger\'s height: ' + button);
    await p.tap('#trace-scale');
    await p.waitForFunction(() => document.querySelector('.bld').editor.trace.scaling.active);
    await p.waitForFunction(() => document.querySelector('#inspector').dataset.open === 'false');
    await still(p);
    assert.equal(await p.$eval('#scale-cancel', (el) => el.getBoundingClientRect().height >= 44), true, 'Cancel is a finger\'s height');
    const banner = await p.$eval('#scale-mode', (el) => el.getBoundingClientRect().bottom);
    await loadModule(p, 'scale', 'ui/building/scale-tool.js');
    const offset = await p.evaluate(() => globalThis.sv2modules.scale.OFFSET);
    assert.equal(offset, 56);
    const placeBy = async (x, y, count) => {
      const at = await point(p, x, y);
      assert.ok(at.y > banner + 4, 'cell ' + x + ', ' + y + ' is below the banner');
      const under = await p.evaluate((x, y) => {
        const el = document.elementFromPoint(x, y);
        return el ? el.id || el.className : 'nothing';
      }, at.x, at.y + offset);
      assert.equal(under, 'plan', 'the plan is under the finger at cell ' + x + ', ' + y);
      // the finger lands under the point, slides a little, and lifts
      await finger('touchStart', { x: at.x + 12, y: at.y + offset + 9 });
      await finger('touchMove', { x: at.x, y: at.y + offset });
      await finger('touchEnd', null);
      await p.waitForFunction((n) => document.querySelector('.bld').editor.trace.scaling.points.length === n, {}, count);
    };
    const size = await p.evaluate(() => document.querySelector('.bld').editor.view.size);
    await placeBy(8, 18, 1);
    await placeBy(28, 18, 2);
    const placed = await points(p);
    // a touch lands on a whole CSS pixel: within one pixel of the cell's middle
    near(placed[0].x, 8.5, 'first x', 1 / size);
    near(placed[0].y, 18.5, 'first y', 1 / size);
    near(placed[1].x, 28.5, 'second x', 1 / size);
    assert.equal(await hidden('#scale-form', p), false);
    assert.notEqual(await p.evaluate(() => document.activeElement.id), 'scale-length', 'a finger does not raise the on-screen keyboard by itself');
    const cells = Math.hypot(placed[1].x - placed[0].x, placed[1].y - placed[0].y);
    await p.tap('#scale-length');
    await p.keyboard.type('60');
    await p.tap('#scale-cell');
    await p.keyboard.type('1.5');
    const before = (await state(p)).entries;
    await p.tap('#scale-apply');
    await p.waitForFunction(() => !document.querySelector('.bld').editor.trace.scaling.active);
    const image = (await project(p)).building.floors[0].image;
    // 60 feet at 1.5 feet a cell: 40 cells
    near(image.scale, 0.025 * (40 / cells), 'scale', 1e-9);
    const first = onFloor(image, placed[0].x / 0.025, placed[0].y / 0.025);
    near(first.x, placed[0].x, 'the first point stays put, x', 1e-9);
    near(first.y, placed[0].y, 'the first point stays put, y', 1e-9);
    assert.deepEqual((await project(p)).settings.cellScale, { unit: 'feet', length: 1.5 });
    assert.equal((await state(p)).entries, before + 1);
    // a second finger calls off the point being placed
    await clearToast(p);
    await p.evaluate(() => globalThis.sv2.ctx.openInspector());
    await p.tap('#trace-scale');
    await p.waitForFunction(() => document.querySelector('.bld').editor.trace.scaling.active);
    await p.waitForFunction(() => document.querySelector('#inspector').dataset.open === 'false');
    await still(p);
    const at = await point(p, 10, 20);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(at.x), y: Math.round(at.y + offset), id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(at.x), y: Math.round(at.y + offset), id: 1 }, { x: Math.round(at.x + 60), y: Math.round(at.y + offset), id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    // the next finger's point is the first: the two fingers placed none
    await placeBy(12, 20, 1);
    near((await points(p))[0].x, 12.5, 'the one point is the lone finger\'s', 1 / size);
    await p.tap('#scale-cancel');
    assert.equal(await active(p), false);
  } finally {
    await phone.close();
  }
});

// ---------------------------------------------------------------- SV2-73b

// Placing the image by two points (two points on the image, then the two
// places on the floor they belong at), the corner handles and + and - while
// moving, "Fit the image to the floor", "Fit the floor to the image", and the
// empty floor's card yielding to a note over a traced image.

// a mouse lands on a fraction of a pixel that a float carries to about 1e-7 of a cell
const MOUSE = 1e-4;
const kind = (p = page) => p.evaluate(() => document.querySelector('.bld').editor.trace.scaling.kind);
const targets = (p = page) => p.evaluate(() => document.querySelector('.bld').editor.trace.scaling.targets);
const image0 = async (p = page) => (await project(p)).building.floors[0].image;

// Where an image place (its pixels) lies on the floor for this image, turned or not.
function landed(image, u, v) {
  return floorPoint(image, { u, v });
}

// The plan at rest, before a place on it is read to press at. Folding the
// sheet away (or a hint that wraps) gives the plan another size at once, but
// the view learns it from a ResizeObserver a frame later and refits then, so
// a point() read in between is where the floor was, not where it is: the CI
// runner pressed the image's top right corner for its bottom right that way
// (SV2-73d). At rest is the view measured to the canvas's own box, and that
// box and the view the same two frames running.
async function still(p = page) {
  const rest = await p.evaluate(() => new Promise((resolve) => {
    const read = () => {
      const editor = document.querySelector('.bld').editor;
      const box = editor.canvas.getBoundingClientRect();
      const { view } = editor;
      return { measured: view.width === box.width && view.height === box.height, at: [box.left, box.top, box.width, box.height, view.width, view.height, view.zoom, view.x, view.y].join(' ') };
    };
    let last = read();
    let frames = 0;
    const next = () => requestAnimationFrame(() => {
      const now = read();
      frames += 1;
      if (now.measured && now.at === last.at) resolve({ ok: true, at: now.at });
      else if (frames >= 120) resolve({ ok: false, at: now.at, measured: now.measured });
      else {
        last = now;
        next();
      }
    });
    next();
  }));
  assert.ok(rest.ok, 'the plan came to rest within 120 frames: box and view ' + rest.at + (rest.measured ? '' : ', the view not measured to the box'));
}

// Which corner handle a corner drag (no Shift) had caught, from what it did:
// the image resized about the opposite corner, so the corner that stayed put
// is two from the one caught. The drag under way is the editor's own and not
// readable, so this is read from the result. Corners in cornerPixels' order.
const CORNER_NAMES = ['top left', 'top right', 'bottom right', 'bottom left'];
function caughtCorner(before, after) {
  const corners = (image) => [[0, 0], [image.width, 0], [image.width, image.height], [0, image.height]].map(([u, v]) => floorPoint(image, { u, v }));
  const was = corners(before);
  const now = corners(after);
  const moved = was.map((corner, i) => Math.hypot(corner.x - now[i].x, corner.y - now[i].y));
  const stayed = moved.indexOf(Math.min(...moved));
  return (stayed + 2) % 4;
}

// A smaller image inside the floor: 1600 by 1200 pixels drawn 20 by 15 cells,
// its corner at 5, 5, unturned; corners at 5, 5 / 25, 5 / 25, 20 / 5, 20.
async function smallImage(p) {
  await p.evaluate(() => {
    const { store } = globalThis.sv2;
    const floorId = store.project.building.floors[0].id;
    store.apply(globalThis.sv2modules.actions.setTraceImage, { floorId, image: { scale: 0.0125, x: 5, y: 5, rotation: 0, locked: false, visible: true } });
  });
}

// Press a dialog's button by its words.
async function answer(p, label) {
  await p.waitForSelector('dialog[open]');
  const pressed = await p.$$eval('dialog[open] button', (buttons, words) => {
    const button = buttons.find((each) => each.textContent.trim() === words);
    if (button) button.click();
    return buttons.map((each) => each.textContent.trim());
  }, label);
  assert.ok(pressed.includes(label), 'the dialog has "' + label + '": ' + pressed.join(' | '));
  await p.waitForFunction(() => !document.querySelector('dialog[open]'));
}

const toastText = (p = page) => p.evaluate(() => {
  const toast = document.querySelector('.toast .toast__text');
  return toast ? toast.textContent : null;
});

test('placing by mouse: two points on the image, then the two places they belong at; the image lands on both in one undo step', async () => {
  await floorTab(page);
  await freshImage(page);
  await wholeFloor(page);
  await clearToast(page);
  const start = await project();
  const before = await entries();
  assert.equal((await state(page)).tool, 'corridor', 'the Corridor tool, which a click would paint with');
  await page.click('#trace-place');
  assert.equal(await active(), true);
  assert.equal(await kind(), 'place');
  assert.match(await text('#scale-text'), /^Placing the image: put the first point on a mark of the image/);
  assert.equal((await state(page)).hint, await text('#scale-text'), 'the mode is said in the status line');
  assert.equal(await hidden('#scale-form'), true, 'placing has no length form');
  assert.equal(await hidden('#place-again'), true, 'nothing to start again yet');

  // the image's pixels 220, 220 and 620, 220 (cells 5.5, 5.5 and 15.5, 5.5)
  for (const [x, y] of [[5, 5], [15, 5]]) {
    const at = await point(page, x, y);
    await page.mouse.click(at.x, at.y);
  }
  assert.equal((await points()).length, 2);
  assert.match(await text('#scale-text'), /^Both points are on the image\. Now click or tap the place on the floor where the first point belongs\./);
  assert.equal(await hidden('#place-again'), false);
  // they belong at cells 10.5, 10.5 and 10.5, 25.5: straight down, half as far again
  const t1 = await point(page, 10, 10);
  await page.mouse.click(t1.x, t1.y);
  const placedAt = (await targets())[0];
  near(placedAt.x, 10.5, 'the first place, x', MOUSE);
  near(placedAt.y, 10.5, 'the first place, y', MOUSE);
  assert.match(await text('#scale-text'), /^The first point belongs at 10\.5, 10\.5 cells\. Now the place on the floor where the second point belongs\./);
  assert.equal((await image0()).scale, 0.025, 'nothing moves before the fourth');
  const t2 = await point(page, 10, 25);
  await page.mouse.click(t2.x, t2.y);
  await page.waitForFunction(() => !document.querySelector('.bld').editor.trace.scaling.active);
  const image = await image0();
  const first = landed(image, 220, 220);
  const second = landed(image, 620, 220);
  near(first.x, 10.5, 'the first point lands on its place, x', MOUSE);
  near(first.y, 10.5, 'the first point lands on its place, y', MOUSE);
  near(second.x, 10.5, 'the second point lands on its place, x', MOUSE);
  near(second.y, 25.5, 'the second point lands on its place, y', MOUSE);
  near(image.rotation, 90, 'turned a quarter, clockwise', 1e-3);
  near(image.scale, 0.0375, '15 cells over 400 pixels', 1e-6);
  assert.equal(await entries(), before + 1, 'one undo step');
  assert.equal((await state(page)).label, 'Place the traced image by two points on Floor 1');
  assert.equal(await toastText(), 'Placed the image by two points: it is 60 cells wide, turned 90 degrees.', 'said to a tenth');
  assert.equal((await project()).building.floors[0].cells, start.building.floors[0].cells, 'the Corridor tool painted nothing');
  assert.match((await state(page)).hint, /^Corridor:/, 'the tool\'s hint is back');
  await page.evaluate(() => globalThis.sv2.ctx.undo());
  assert.deepEqual(await image0(), start.building.floors[0].image, 'one Undo puts it back');

  // Start again clears every point; Escape changes nothing
  await clearToast(page);
  await page.click('#trace-place');
  for (const [x, y] of [[5, 5], [15, 5], [20, 20]]) {
    const at = await point(page, x, y);
    await page.mouse.click(at.x, at.y);
  }
  assert.equal((await targets()).length, 1);
  await page.click('#place-again');
  assert.deepEqual([(await points()).length, (await targets()).length], [0, 0]);
  assert.equal(await hidden('#place-again'), true);
  await page.keyboard.press('Escape');
  assert.equal(await active(), false);
  assert.deepEqual(await image0(), start.building.floors[0].image, 'Escape changed nothing');
  assert.equal(await entries(), before, 'the step undone, and none made by Start again or Escape');
});

test('two places in one spot are refused in a sentence and the second is placed again; a locked, hidden or missing image is refused with the reason', async () => {
  await freshImage(page);
  await clearToast(page);
  const before = await entries();
  await page.click('#trace-place');
  for (const [x, y] of [[5, 5], [15, 5], [10, 10], [10, 10]]) {
    const at = await point(page, x, y);
    await page.mouse.click(at.x, at.y);
  }
  assert.equal(await toastText(), 'The two places on the floor are in the same place. Place the second where the second point belongs, as far from the first as you can.');
  assert.equal(await active(), true, 'the mode goes on');
  assert.equal((await targets()).length, 1, 'the second place is taken back');
  assert.equal(await entries(), before);
  const again = await point(page, 30, 10);
  await page.mouse.click(again.x, again.y);
  await page.waitForFunction(() => !document.querySelector('.bld').editor.trace.scaling.active);
  near((await image0()).rotation, 0, 'the same way round', 1e-3);
  near((await image0()).scale, 0.05, '20 cells over 400 pixels', 1e-6);
  assert.equal(await entries(), before + 1);

  const refusedFor = async (patch, words) => {
    await clearToast(page);
    await page.evaluate((patch) => {
      const { store } = globalThis.sv2;
      store.apply(globalThis.sv2modules.actions.setTraceImage, { floorId: store.project.building.floors[0].id, image: patch });
    }, patch);
    await page.evaluate(() => document.getElementById('trace-place').click());
    assert.equal(await active(), false, JSON.stringify(patch) + ': refused');
    assert.equal(await toastText(), words);
  };
  await refusedFor({ locked: true }, 'The image is locked, so it cannot be placed. Untick "Lock the image" first.');
  await refusedFor({ locked: false, visible: false }, 'The image is hidden, so the points cannot be placed on it. Tick "Show the image" first.');
  await refusedFor({ visible: true, missing: true }, 'The image is not on this device, so there is nothing to place the points on. Choose the file again first.');
  await freshImage(page);
  await page.evaluate(() => {
    const { store } = globalThis.sv2;
    store.apply(globalThis.sv2modules.actions.setTraceImage, { floorId: store.project.building.floors[0].id, image: { missing: false } });
  });
  await clearToast(page);
});

test('placing by keyboard: the button by Enter brings up the plan\'s cursor, and Enter at each of the four places places the image', async () => {
  await freshImage(page);
  const before = await entries();
  await page.evaluate(() => document.querySelector('.bld').editor.cursor.moveTo(5, 5, false));
  await page.focus('#trace-place');
  await page.keyboard.press('Enter');
  assert.equal(await active(), true);
  assert.equal(await kind(), 'place');
  let now = await state(page);
  assert.equal(now.focus, 'plan');
  assert.deepEqual(now.cursor, [5, 5], 'the cursor shows where it was');
  const keys = async (key, times) => {
    for (let i = 0; i < times; i += 1) await page.keyboard.press(key);
  };
  await page.keyboard.press('Enter');
  await keys('ArrowRight', 10);
  await page.keyboard.press('Enter');
  near((await points())[1].x, 15.5, 'the second point ten cells along', 1e-6);
  assert.match((await state(page)).said, /^Both points are on the image\./);
  await keys('ArrowLeft', 5);
  await keys('ArrowDown', 5);
  await page.keyboard.press('Enter');
  assert.deepEqual(await targets(), [{ x: 10.5, y: 10.5 }]);
  await keys('ArrowDown', 15);
  await page.keyboard.press('Enter');
  assert.equal(await active(), false);
  const image = await image0();
  near(landed(image, 620, 220).y, 25.5, 'the second point lands on its place', 1e-9);
  near(image.rotation, 90, 'turned a quarter', 1e-9);
  assert.equal(await entries(), before + 1);
  now = await state(page);
  assert.equal(now.focus, 'plan', 'the focus stays on the plan');
  assert.equal(now.said, 'Placed the image by two points: it is 60 cells wide, turned 90 degrees.');
  await clearToast(page);
});

test('corner handles while moving: a corner dragged resizes about the opposite corner with the shape kept, with Shift about the middle, one step a drag; + and - by 5 % with the width said', async () => {
  await smallImage(page);
  await wholeFloor(page);
  await clearToast(page);
  const before = await entries();
  const zoom = (await state(page)).zoom;
  await page.click('#trace-move');
  assert.match((await state(page)).hint, /^Drag the image to where it belongs, or a corner to resize it/);
  await still();
  // the bottom right corner (25, 20) out along the diagonal to (35, 27.5): half as large again
  const from = await point(page, 25, 20, 0, 0);
  const to = await point(page, 35, 27.5, 0, 0);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  assert.equal(await page.$eval('#plan', (el) => el.dataset.dragging), 'corner', 'the press caught the handle');
  assert.equal(await entries(), before, 'nothing kept until the drag ends');
  await page.mouse.up();
  const size = await page.evaluate(() => document.querySelector('.bld').editor.view.size);
  let image = await image0();
  near(image.scale * 1600, 30, 'the image is 30 cells wide', 2 / size);
  near(image.x, 5, 'the opposite corner stays, x', 1e-9);
  near(image.y, 5, 'the opposite corner stays, y', 1e-9);
  assert.equal(await entries(), before + 1, 'one undo step for the drag');
  assert.equal((await state(page)).label, 'Resize the traced image on Floor 1');
  assert.match((await state(page)).said, /^Resized the image\. The image is 30 cells wide\.$/);

  // with Shift, the top left corner (5, 5) in to halfway to the middle (20, 16.25): half the size, the middle kept
  const a = await point(page, 5, 5, 0, 0);
  const b = await point(page, 12.5, 10.625, 0, 0);
  await page.mouse.move(a.x, a.y);
  await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  image = await image0();
  near(image.scale * 1600, 15, 'half as wide', 2 / size);
  near(image.x + (image.scale * 1600) / 2, 20, 'the middle stays, x', 1e-6);
  near(image.y + (image.scale * 1200) / 2, 16.25, 'the middle stays, y', 1e-6);
  assert.equal(await entries(), before + 2);

  // + and - by keyboard, on the plan: 5 % about the middle, the width said, one step each, no zoom
  await page.focus('#plan');
  const width = image.scale * 1600;
  await page.keyboard.press('+');
  image = await image0();
  near(image.scale * 1600, width * 1.05, '5 % larger', 1e-9);
  near(image.x + (image.scale * 1600) / 2, 20, 'about the middle', 1e-6);
  assert.equal((await state(page)).said, 'The image is ' + Math.round(width * 1.05 * 10) / 10 + ' cells wide.');
  await page.keyboard.press('-');
  near((await image0()).scale * 1600, width, 'and back', 1e-9);
  assert.equal(await entries(), before + 4, 'one step a press');
  assert.equal((await state(page)).zoom, zoom, '- resized the image and did not zoom the plan');
  // a drag in the image's middle still moves it
  const left = (await image0()).x;
  await drag(page, [15, 15], [17, 16]);
  near((await image0()).x, left + 2, 'moved two cells', 0.05);
  await page.focus('#plan');
  await page.keyboard.press('Escape');
  assert.equal(await page.$eval('#trace-move', (el) => el.getAttribute('aria-pressed')), 'false');
  await page.keyboard.press('+');
  near((await image0()).scale * 1600, width, 'out of the mode, + is the zoom\'s again', 1e-9);
  await page.keyboard.press('0');
  await wholeFloor(page);
});

test('Fit the image to the floor keeps the turn and puts the whole image in the middle; Fit the floor to the image asks, then fits, and refuses to cut', async () => {
  await freshImage(page);
  await page.evaluate(() => {
    const { store } = globalThis.sv2;
    store.apply(globalThis.sv2modules.actions.setTraceImage, { floorId: store.project.building.floors[0].id, image: { rotation: 30 } });
  });
  await clearToast(page);
  let before = await entries();
  assert.equal(await text('#trace-fit'), 'Fit the image to the floor');
  await page.click('#trace-fit');
  let image = await image0();
  assert.equal(image.rotation, 30, 'the turn is kept');
  const corners = [[0, 0], [1600, 0], [1600, 1200], [0, 1200]].map(([u, v]) => landed(image, u, v));
  for (const at of corners) assert.ok(at.x >= -1e-6 && at.x <= 40 + 1e-6 && at.y >= -1e-6 && at.y <= 30 + 1e-6, 'a corner off the floor: ' + JSON.stringify(at));
  near((Math.min(...corners.map((c) => c.y)) + Math.max(...corners.map((c) => c.y))) / 2, 15, 'in the middle, down', 1e-6);
  near((Math.min(...corners.map((c) => c.x)) + Math.max(...corners.map((c) => c.x))) / 2, 20, 'in the middle, across', 1e-6);
  assert.equal(await entries(), before + 1);
  assert.equal((await state(page)).label, 'Fit the traced image to Floor 1');

  // the image 20 by 15 cells at 5, 5; the far corner's corridor cell lies outside it
  await smallImage(page);
  await clearToast(page);
  before = await entries();
  await page.click('#trace-floor-fit');
  assert.equal(await page.$('dialog[open]'), null, 'refused before asking');
  assert.equal(await toastText(), 'Fitting Floor 1 to the image would cut 1 corridor cell, outside the image. Move them over the image first, or resize the floor by its edges instead.');
  assert.equal(await entries(), before);
  // the corridor cell moved inside the image: asked, kept, then fitted
  await page.evaluate(() => {
    const { store } = globalThis.sv2;
    const { paintCorridor, eraseCells } = globalThis.sv2modules.actions;
    const floor = store.project.building.floors[0];
    store.apply(paintCorridor, { floorId: floor.id, cells: [10 * floor.width + 10] });
    store.apply(eraseCells, { floorId: floor.id, cells: [floor.width * floor.height - 1] });
  });
  await clearToast(page);
  before = await entries();
  await page.click('#trace-floor-fit');
  assert.equal(await page.$eval('dialog[open] h2, dialog[open] [id$="title"]', (el) => el.textContent), 'Make Floor 1 20 × 15 cells, the size of its image?');
  await answer(page, 'Keep 40 × 30');
  assert.equal(await entries(), before, 'kept: nothing changed');
  await page.click('#trace-floor-fit');
  await answer(page, 'Make it 20 × 15');
  const floor = (await project()).building.floors[0];
  assert.deepEqual([floor.width, floor.height], [20, 15]);
  assert.deepEqual([floor.image.x, floor.image.y], [0, 0], 'the image at the corner');
  assert.equal(floor.cells[5 * 20 + 5], '#', 'the corridor cell under the same part of the image');
  assert.equal(await entries(), before + 1);
  assert.equal((await state(page)).label, 'Fit Floor 1 to its traced image, 20 by 15');
  assert.equal(await toastText(), 'Floor 1 is 20 × 15 cells now, the size of its image.');
  await clearToast(page);
  await page.click('#trace-floor-fit');
  assert.equal(await page.$('dialog[open]'), null, 'already fitted: nothing to ask');
  assert.equal(await toastText(), 'Floor 1 is already the size of its image.');
  // back as the other cases want it: 40 by 30, the corridor cell in the far corner
  await page.evaluate(() => globalThis.sv2.ctx.undo());
  await page.evaluate(() => globalThis.sv2.ctx.undo());
  await page.evaluate(() => globalThis.sv2.ctx.undo());
  assert.equal((await project()).building.floors[0].width, 40);
  await page.evaluate(() => {
    const { store } = globalThis.sv2;
    store.apply(globalThis.sv2modules.actions.setTraceImage, { floorId: store.project.building.floors[0].id, image: { locked: true } });
  });
  assert.deepEqual(await page.$$eval('#trace-fit, #trace-floor-fit', (all) => all.map((el) => el.disabled)), [true, true], 'a locked image is not fitted either way');
  await freshImage(page);
  await wholeFloor(page);
  await clearToast(page);
});

test('the empty floor\'s card yields over a traced image: a one-line note at the top that takes no click, away while scaling, placing or moving; a click in the plan\'s middle reaches the image', async () => {
  await freshImage(page);
  // the floor emptied: only the image is on it
  await page.evaluate(() => {
    const { store } = globalThis.sv2;
    const floor = store.project.building.floors[0];
    store.apply(globalThis.sv2modules.actions.eraseCells, { floorId: floor.id, cells: [floor.width * floor.height - 1] });
  });
  await wholeFloor(page);
  await clearToast(page);
  await page.waitForFunction(() => !document.getElementById('empty-floor').hidden);
  const card = () => page.evaluate(() => {
    const el = document.getElementById('empty-floor');
    const stage = el.parentElement.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const middle = document.elementFromPoint(stage.left + stage.width / 2, stage.top + stage.height / 2);
    return {
      hidden: el.hidden,
      shape: el.dataset.shape,
      note: el.querySelector('#empty-floor-note').hidden ? null : el.querySelector('#empty-floor-note').textContent,
      buttons: Array.from(el.querySelectorAll('button')).filter((button) => button.getClientRects().length > 0).length,
      top: Math.round(box.top - stage.top),
      lines: Math.round(box.height / parseFloat(getComputedStyle(el.querySelector('#empty-floor-note')).lineHeight || '20')),
      middle: middle ? middle.id : null,
    };
  });
  let now = await card();
  assert.equal(now.hidden, false);
  assert.equal(now.shape, 'note');
  assert.equal(now.note, 'Draw over the image: a corridor first, then rooms along it.');
  assert.equal(now.buttons, 0, 'no buttons to catch a click');
  assert.ok(now.top <= 16, 'at the top of the stage: ' + now.top);
  assert.equal(now.middle, 'plan', 'the plan, not the card, is in the middle');

  // placing: the note is away, and a click in the plan's middle places the first point there
  await page.click('#trace-place');
  await page.waitForFunction(() => document.getElementById('empty-floor').hidden);
  const middle = await page.evaluate(() => {
    const box = document.getElementById('plan').getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  });
  await page.mouse.click(middle.x, middle.y);
  const placed = await points();
  assert.equal(placed.length, 1, 'the click reached the image');
  const expected = await page.evaluate((x, y) => {
    const editor = document.querySelector('.bld').editor;
    const box = editor.canvas.getBoundingClientRect();
    return editor.view.toCell(x - box.left, y - box.top);
  }, middle.x, middle.y);
  near(placed[0].x, expected.x, 'where the click was, x', 1e-6);
  near(placed[0].y, expected.y, 'where the click was, y', 1e-6);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('empty-floor').hidden);
  // scaling and moving put it away too
  await page.click('#trace-scale');
  assert.equal((await card()).hidden, true, 'away while scaling');
  await page.keyboard.press('Escape');
  await page.click('#trace-move');
  assert.equal((await card()).hidden, true, 'away while moving');
  await page.click('#trace-move');
  assert.equal((await card()).hidden, false, 'back when done');
  // with no image the card is the card, with its three buttons, as before
  await page.evaluate(() => {
    const { store } = globalThis.sv2;
    store.apply(globalThis.sv2modules.actions.setTraceImage, { floorId: store.project.building.floors[0].id, image: null });
  });
  now = await card();
  assert.equal(now.shape, 'card');
  assert.equal(now.note, null);
  assert.equal(now.buttons, 3, 'Trace, Change the size and Load the sample school');
  assert.equal(await page.$eval('#empty-floor h1', (el) => el.textContent), 'This is the building.');
  await page.evaluate(() => globalThis.sv2.ctx.undo());
  assert.equal((await card()).shape, 'note');
  await notEmpty(page);
  await clearToast(page);
});

test('axe finds nothing on the Floor tab while placing, with the handles up, or with the note over the image, in the light theme or the dark', async () => {
  await freshImage(page);
  for (const theme of ['light', 'dark']) {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
    await floorTab(page);
    const sweep = async (what) => {
      await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
      if (!(await page.evaluate(() => Boolean(globalThis.axe)))) await page.addScriptTag({ path: AXE });
      const found = await page.evaluate((tags) => globalThis.axe.run(document, { runOnly: { type: 'tag', values: tags } }).then((result) => ({ passes: result.passes.length, violations: result.violations.map((v) => v.id + ': ' + v.nodes.map((n) => n.target.join(' ')).join(', ')) })), TAGS);
      assert.ok(found.passes > 10, 'axe ran very few rules');
      assert.deepEqual(found.violations, [], what + ' in the ' + theme + ' theme');
    };
    await page.click('#trace-place');
    for (const [x, y] of [[5, 5], [15, 5], [10, 10]]) {
      const at = await point(page, x, y);
      await page.mouse.click(at.x, at.y);
    }
    assert.equal(await hidden('#place-again'), false);
    await sweep('placing');
    await page.keyboard.press('Escape');
    await page.click('#trace-move');
    await sweep('moving with the handles');
    await page.click('#trace-move');
    await page.evaluate(() => {
      const { store } = globalThis.sv2;
      const floor = store.project.building.floors[0];
      store.apply(globalThis.sv2modules.actions.eraseCells, { floorId: floor.id, cells: [floor.width * floor.height - 1] });
    });
    await page.waitForFunction(() => document.getElementById('empty-floor').dataset.shape === 'note' && !document.getElementById('empty-floor').hidden);
    await sweep('the note over the image');
    await notEmpty(page);
  }
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
});

test('by touch at 390 by 844: placing by two points with the marker above the finger, and a corner handle dragged by a finger', async () => {
  const phone = await openPlanner({ browser, hash: '#building', width: 390, height: 844, mobile: true });
  try {
    const p = phone.page;
    await assertTouch(p, 'trace-scale (SV2-73b) at 390 by 844');
    await loadModule(p, 'actions', 'engine/actions.js');
    await startEmpty(p);
    await floorTab(p);
    await upload(p);
    await notEmpty(p);
    await freshImage(p);
    await wholeFloor(p);
    await clearToast(p);
    const cdp = await p.createCDPSession();
    const finger = (type, at) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: at ? [{ x: Math.round(at.x), y: Math.round(at.y), id: 1, radiusX: 4, radiusY: 4, force: 1 }] : [] });
    await p.$eval('#trace-place', (el) => el.scrollIntoView({ block: 'center' }));
    assert.ok(await p.$eval('#trace-place', (el) => el.getBoundingClientRect().height) >= 44, 'the button is a finger\'s height');
    await p.tap('#trace-place');
    await p.waitForFunction(() => document.querySelector('.bld').editor.trace.scaling.active);
    await p.waitForFunction(() => document.querySelector('#inspector').dataset.open === 'false');
    await still(p);
    assert.ok(await p.$eval('#place-again', (el) => el.hidden || el.getBoundingClientRect().height >= 44), 'Start again is a finger\'s height');
    const banner = await p.$eval('#scale-mode', (el) => el.getBoundingClientRect().bottom);
    const offset = 56;
    const size = await p.evaluate(() => document.querySelector('.bld').editor.view.size);
    const placeBy = async (x, y, wait) => {
      const at = await point(p, x, y);
      assert.ok(at.y > banner + 4, 'cell ' + x + ', ' + y + ' is below the banner');
      await finger('touchStart', { x: at.x + 10, y: at.y + offset + 8 });
      await finger('touchMove', { x: at.x, y: at.y + offset });
      await finger('touchEnd', null);
      await p.waitForFunction(wait);
    };
    await placeBy(8, 12, () => document.querySelector('.bld').editor.trace.scaling.points.length === 1);
    await placeBy(28, 12, () => document.querySelector('.bld').editor.trace.scaling.points.length === 2);
    assert.equal(await hidden('#place-again', p), false);
    assert.ok(await p.$eval('#place-again', (el) => el.getBoundingClientRect().height) >= 44, 'Start again is a finger\'s height');
    await placeBy(10, 14, () => document.querySelector('.bld').editor.trace.scaling.targets.length === 1);
    const before = (await state(p)).entries;
    await placeBy(30, 14, () => !document.querySelector('.bld').editor.trace.scaling.active);
    const image = await image0(p);
    // each point within a pixel of the cell's middle it was put on
    const first = landed(image, 8.5 / 0.025, 12.5 / 0.025);
    near(first.x, 10.5, 'the first point lands on its place, x', 2 / size);
    near(first.y, 14.5, 'the first point lands on its place, y', 2 / size);
    near(image.scale, 0.025, 'the same length apart, the same scale', 0.025 * 4 / (size * 20));
    assert.equal((await state(p)).entries, before + 1);
    assert.notEqual(await p.evaluate(() => document.activeElement.tagName), 'INPUT', 'no field took the focus under a finger');

    // a corner handle by a finger: the image 20 by 15 at 5, 5, its bottom right corner dragged out to 35, 27.5
    await smallImage(p);
    await wholeFloor(p);
    await clearToast(p);
    await p.evaluate(() => globalThis.sv2.ctx.openInspector());
    await p.$eval('#trace-move', (el) => el.scrollIntoView({ block: 'center' }));
    await p.tap('#trace-move');
    await p.evaluate(() => globalThis.sv2.ctx.closeInspector());
    await p.waitForFunction(() => document.querySelector('#inspector').dataset.open === 'false');
    await wholeFloor(p);
    await still(p);
    const steps = (await state(p)).entries;
    const small = await image0(p);
    // the finger lands a little off the corner, inside a finger's reach
    const from = await point(p, 25, 20, 0, 0);
    const to = await point(p, 35, 27.5, 0, 0);
    await finger('touchStart', { x: from.x + 8, y: from.y + 8 });
    await p.waitForFunction(() => document.getElementById('plan').dataset.dragging === 'corner');
    for (let i = 1; i <= 6; i += 1) await finger('touchMove', { x: from.x + 8 + ((to.x - from.x) * i) / 6, y: from.y + 8 + ((to.y - from.y) * i) / 6 });
    await finger('touchEnd', null);
    await p.waitForFunction((n) => globalThis.sv2.store.history.past.length === n, {}, steps + 1);
    const resized = await image0(p);
    const caught = caughtCorner(small, resized);
    assert.equal(caught, 2, 'the finger caught corner ' + caught + ' (' + CORNER_NAMES[caught] + '), not 2 (bottom right)');
    near(resized.x, 5, 'the opposite corner stays, x', 1e-9);
    near(resized.y, 5, 'the opposite corner stays, y', 1e-9);
    near(resized.scale * 1600, 30, 'the corner followed the finger', 3 / size);
  } finally {
    await phone.close();
  }
});

// ---------------------------------------------------------------- SV2-73c

// Review faults in SV2-73b: placing by two points where the image already
// is, the width "Fit the image to the floor" says, '=' while moving, keys
// with a dialog open over moving, the floor made another size under scaling
// or placing, and the words each mode ends with.

const moving = (p = page) => p.evaluate(() => document.querySelector('.bld').editor.trace.moving);
const errorsNow = () => session.problems().errors.length;
// two frames, so an overlay that throws has thrown
const frames = (p = page) => p.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

// Each case below starts from a quiet planner whatever the case before it
// left behind when it failed: no dialog open, no moving, scaling or placing,
// Floor 1 on show with the Floor tab up, and the image as fitted to it.
async function settle(p = page) {
  await p.evaluate(() => {
    for (const open of document.querySelectorAll('dialog[open]')) open.close();
    const editor = document.querySelector('.bld').editor;
    editor.trace.stopMoving();
    editor.trace.scaling.cancel(false);
    const first = globalThis.sv2.store.project.building.floors[0];
    if (editor.floor.id !== first.id) editor.openFloor(first.id);
  });
  await p.waitForFunction(() => document.querySelector('.bld').editor.floor.name === 'Floor 1');
  await floorTab(p);
  await freshImage(p);
  await wholeFloor(p);
  await clearToast(p);
  await still(p);
}

// An image larger than the floor: 1600 by 1200 pixels drawn 48 by 36 cells
// from -4, -3, so "Fit the floor to the image" grows the floor to 48 by 36 and
// cuts nothing (the corridor cell at 39, 29 is under it).
async function largeImage(p) {
  await p.evaluate(() => {
    const { store } = globalThis.sv2;
    store.apply(globalThis.sv2modules.actions.setTraceImage, { floorId: store.project.building.floors[0].id, image: { scale: 0.03, x: -4, y: -3, rotation: 0, locked: false, visible: true } });
  });
}

test('placing by keyboard where the image already is: the mode ends saying so, nothing changed, and no place is kept for another Enter to add to', async () => {
  await settle();
  await floorTab(page);
  await freshImage(page);
  await wholeFloor(page);
  await clearToast(page);
  const before = await entries();
  const errors = errorsNow();
  const keys = async (key, times) => {
    for (let i = 0; i < times; i += 1) await page.keyboard.press(key);
  };
  await page.evaluate(() => document.querySelector('.bld').editor.cursor.moveTo(5, 5, false));
  await page.focus('#trace-place');
  await page.keyboard.press('Enter');
  assert.equal(await kind(), 'place');
  // the image's points at 5.5, 5.5 and 15.5, 5.5, and their places the same cells
  await page.keyboard.press('Enter');
  await keys('ArrowRight', 10);
  await page.keyboard.press('Enter');
  await keys('ArrowLeft', 10);
  await page.keyboard.press('Enter');
  assert.equal((await targets()).length, 1);
  await keys('ArrowRight', 10);
  await page.keyboard.press('Enter');
  assert.equal(await active(), false, 'the mode ends when the image is already there, not waiting on a third place');
  const now = await state(page);
  assert.equal(now.said, 'The image is already there: each point is on its place. Nothing changed.');
  assert.equal(now.toast, 'The image is already there: each point is on its place. Nothing changed.');
  assert.equal(now.focus, 'plan');
  assert.equal(await entries(), before, 'no undo step');
  assert.match(now.hint, /^Corridor:/, 'the tool\'s hint is back');
  // no place is kept for a third Enter to add to, and nothing is thrown while drawing
  assert.deepEqual(await targets(), []);
  await frames();
  assert.deepEqual(session.problems().errors.slice(errors), [], 'no error on the page');
  await clearToast(page);
});

test('Fit the image to the floor says the width the image has after the fit', async () => {
  await settle();
  await smallImage(page);
  await clearToast(page);
  await page.click('#trace-fit');
  const image = await image0();
  near(image.scale * 1600, 40, 'fitted to the floor\'s 40 cells', 1e-9);
  assert.equal((await state(page)).said, 'The whole image fits Floor 1, in its middle. The image is 40 cells wide.', 'the width after the fit, not the 20 before it');
  await freshImage(page);
  await clearToast(page);
});

test('while moving, = resizes like + (the unshifted key) and does not zoom the plan', async () => {
  await settle();
  await smallImage(page);
  await wholeFloor(page);
  await clearToast(page);
  const before = await entries();
  const zoom = (await state(page)).zoom;
  await page.click('#trace-move');
  await page.focus('#plan');
  await page.keyboard.press('=');
  const image = await image0();
  near(image.scale * 1600, 21, '= made it 5 % larger', 1e-9);
  near(image.x + (image.scale * 1600) / 2, 15, 'about the middle', 1e-6);
  assert.equal((await state(page)).said, 'The image is 21 cells wide.');
  assert.equal(await entries(), before + 1, 'one step');
  assert.equal((await state(page)).zoom, zoom, '= resized the image and did not zoom the plan');
  await page.keyboard.press('Escape');
  assert.equal(await moving(), false);
  await page.keyboard.press('0');
  await freshImage(page);
  await wholeFloor(page);
  await clearToast(page);
});

test('while moving, a dialog has the keys: - resizes nothing behind it and Escape closes it; Fit the floor to the image stops moving before it asks', async () => {
  await settle();
  await largeImage(page);
  await wholeFloor(page);
  await clearToast(page);
  const before = await entries();
  const start = await image0();
  await page.click('#trace-move');
  assert.equal(await moving(), true);
  // any dialog over the plan while moving
  await page.evaluate(() => {
    globalThis.sv2test = { answered: null };
    globalThis.sv2.ctx.confirm({ title: 'A question', body: 'Is this a question?', action: 'Yes', keep: 'No' }).then((ok) => {
      globalThis.sv2test.answered = ok;
    });
  });
  await page.waitForSelector('dialog[open]');
  await page.keyboard.press('-');
  assert.deepEqual(await image0(), start, '- behind the dialog resized nothing');
  assert.equal(await entries(), before);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));
  assert.equal(await page.evaluate(() => globalThis.sv2test.answered), false, 'Escape closed the dialog');
  assert.equal(await moving(), true, 'Escape went to the dialog, not to moving');

  // Fit the floor to the image: moving ends at the press, before the dialog asks
  await page.click('#trace-floor-fit');
  await page.waitForSelector('dialog[open]');
  assert.equal(await moving(), false, 'moving stopped when Fit the floor to the image was pressed');
  assert.equal(await page.$eval('#trace-move', (el) => el.getAttribute('aria-pressed')), 'false');
  await answer(page, 'Keep 40 × 30');
  assert.deepEqual(await image0(), start);
  assert.equal(await entries(), before);
  await freshImage(page);
  await wholeFloor(page);
  await clearToast(page);
});

test('Fit the floor to the image ends placing at the press, and an undo that changes the floor\'s size ends it with a sentence', async () => {
  await settle();
  await largeImage(page);
  await wholeFloor(page);
  await clearToast(page);
  const before = await entries();
  await page.click('#trace-place');
  for (const [x, y] of [[5, 5], [15, 5], [10, 10]]) {
    const at = await point(page, x, y);
    await page.mouse.click(at.x, at.y);
  }
  assert.equal((await targets()).length, 1);
  await page.click('#trace-floor-fit');
  await page.waitForSelector('dialog[open]');
  assert.equal(await active(), false, 'placing ended at the press, before the floor moved under its kept place');
  await answer(page, 'Make it 48 × 36');
  let floor = (await project()).building.floors[0];
  assert.deepEqual([floor.width, floor.height], [48, 36]);
  assert.equal(await entries(), before + 1);
  await wholeFloor(page);
  await clearToast(page);

  // placing again, then the fit undone: the floor is 40 by 30 once more and the mode ends, saying why
  await page.click('#trace-place');
  for (const [x, y] of [[5, 5], [15, 5], [10, 10]]) {
    const at = await point(page, x, y);
    await page.mouse.click(at.x, at.y);
  }
  assert.equal((await targets()).length, 1);
  await page.evaluate(() => globalThis.sv2.store.undo());
  floor = (await project()).building.floors[0];
  assert.deepEqual([floor.width, floor.height], [40, 30], 'the fit undone');
  assert.equal(await active(), false, 'a floor made another size ends placing');
  assert.equal((await state(page)).said, 'Floor 1 is 40 × 30 cells now, so placing the image has stopped. Start it again to place the points afresh.');
  // a move of the image alone keeps the mode, as before
  await page.click('#trace-scale');
  await page.mouse.click(...Object.values(await point(page, 5, 5)));
  await page.evaluate(() => {
    const { store } = globalThis.sv2;
    store.apply(globalThis.sv2modules.actions.setTraceImage, { floorId: store.project.building.floors[0].id, image: { x: -3 } });
  });
  assert.equal(await active(), true, 'moving the image keeps scaling going');
  await page.keyboard.press('Escape');
  await freshImage(page);
  await wholeFloor(page);
  await clearToast(page);
});

test('placing ends in words about placing, scaling in words about scaling: the image hidden, locked or gone, and another floor on show', async () => {
  await settle();
  await freshImage(page);
  await clearToast(page);
  const patch = (image) => page.evaluate((image) => {
    const { store } = globalThis.sv2;
    store.apply(globalThis.sv2modules.actions.setTraceImage, { floorId: store.project.building.floors[0].id, image });
  }, image);
  const ended = async (how, change, words) => {
    await page.click(how === 'place' ? '#trace-place' : '#trace-scale');
    assert.equal(await kind(), how);
    await change();
    assert.equal(await active(), false, words);
    assert.equal((await state(page)).said, words);
  };
  await ended('place', () => patch({ visible: false }), 'The image is hidden now, so placing it has stopped.');
  await patch({ visible: true });
  await ended('place', () => patch({ locked: true }), 'The image is locked now, so placing it has stopped.');
  await patch({ locked: false });
  await ended('scale', () => patch({ locked: true }), 'The image is locked now, so scaling it has stopped.');
  await patch({ locked: false });
  await ended('place', () => patch(null), 'The image is gone, so placing it has stopped.');
  await page.evaluate(() => globalThis.sv2.store.undo());
  assert.notEqual(await image0(), null, 'the image back');
  // another floor on show: Page Down from the plan to a second floor
  await page.evaluate(() => globalThis.sv2.store.apply(globalThis.sv2modules.actions.addFloor, {}));
  await page.click('.bld-floors [role="tab"]:first-child');
  await floorTab(page);
  assert.equal((await state(page)).floor, 'Floor 1');
  await ended('place', async () => {
    await page.focus('#plan');
    await page.keyboard.press('PageDown');
    await page.waitForFunction(() => document.querySelector('.bld').editor.floor.name === 'Floor 2');
    await frames();
  }, 'Another floor is on show, so placing the image has stopped.');
  await page.keyboard.press('PageUp');
  await page.waitForFunction(() => document.querySelector('.bld').editor.floor.name === 'Floor 1');
  await page.evaluate(() => globalThis.sv2.store.undo());
  assert.equal((await project()).building.floors.length, 1, 'the second floor taken back');
  await floorTab(page);
  await wholeFloor(page);
  await clearToast(page);
});

test('a small image while moving: a press inside it moves it, though it is within a mouse\'s reach of a corner; a press just outside a corner is the corner', async () => {
  await settle();
  // 1600 by 1200 pixels drawn 0.8 by 0.6 cells at 10, 10
  await page.evaluate(() => {
    const { store } = globalThis.sv2;
    store.apply(globalThis.sv2modules.actions.setTraceImage, { floorId: store.project.building.floors[0].id, image: { scale: 0.8 / 1600, x: 10, y: 10, rotation: 0, locked: false, visible: true } });
  });
  await wholeFloor(page);
  await clearToast(page);
  const size = await page.evaluate(() => document.querySelector('.bld').editor.view.size);
  assert.ok(0.6 * size < 3 * 10 && 0.6 * size > 8, 'the image is small on screen, and has an inside to press: ' + 0.6 * size + ' pixels high');
  await page.click('#trace-move');
  await still();
  // 6 and 4 pixels in from the top left corner: 7.2 pixels from it, inside a mouse's 10
  const corner = await point(page, 10, 10, 0, 0);
  await page.mouse.move(corner.x + 6, corner.y + 4);
  await page.mouse.down();
  assert.equal(await page.$eval('#plan', (el) => el.dataset.dragging), 'image', 'a press inside the small image moves it');
  await page.mouse.up();
  // 4 and 4 pixels out from the bottom right corner
  const far = await point(page, 10.8, 10.6, 0, 0);
  await page.mouse.move(far.x + 4, far.y + 4);
  await page.mouse.down();
  assert.equal(await page.$eval('#plan', (el) => el.dataset.dragging), 'corner', 'just outside a corner, the corner');
  await page.mouse.up();
  await page.focus('#plan');
  await page.keyboard.press('Escape');
  assert.equal(await moving(), false);
  await freshImage(page);
  await wholeFloor(page);
  await clearToast(page);
});
