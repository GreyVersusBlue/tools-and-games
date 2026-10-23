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
import { startEmpty, planReady, point, state, wholeFloor, clearToast } from './draw-pointer.mjs';

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
