// The plan map (ui/surface/plan-map.js) in a real browser, mounted through
// the module as a Scenarios or Safety unit mounts it, in a container the test
// makes: node test/browser/plan-map.mjs
//
// The shell's layout of a plan holds for Scenarios and Safety only while a
// map is mounted in them (data-plan-map), so with none mounted they sit as
// their stubs did before the map came out of Movement (SV2-65b, measured at
// 3c0eee81 with Getting started up on a new device). Both sections mount
// maps of their own now (Safety since SV2-67, Scenarios since SV2-68), so
// each case here takes the scenario lab away first and puts in its place the
// Scenarios stub as it was at 3c0eee81 (bare()): the section then stands as
// a plan-map section with no map mounted, and the maps made here are alone.
// The surface's --toast-clear is the last mounted map's, and an earlier map's value comes
// back when the later one goes. A pan or a zoom past the edge keeps
// KEEP_ON_STAGE px of the floors on the stage, and the stage is never under
// its least however little the section has.

import test, { after, afterEach, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, go } from './harness.mjs';

let wide;

before(async () => {
  wide = await openPlanner({ width: 1280, height: 800, hash: '#scenarios', theme: 'light' });
});

after(async () => {
  if (wide) await wide.close();
});

// a case that failed half way leaves no map behind it for the next
afterEach(async () => {
  if (!wide) return;
  await wide.page.evaluate(() => {
    for (const { map } of Object.values(globalThis.planMaps || {})) map.unmount();
    globalThis.planMaps = {};
    const holder = document.querySelector('[data-test="plan-maps"]');
    if (holder) holder.remove();
  });
});

// What the stubs looked like at 3c0eee81, before app.css took Scenarios and
// Safety into the plan's layout: the layout's padding (the bottom one is the
// band a message lies on, --toast-room), its faint grid, the stub's card and
// Getting started as [left, top, width, height], and the messages' bottom.
const BEFORE = {
  '1280 #scenarios': { padding: '32px 32px 76px', grid: true, stub: [124, 113, 704, 285], started: [888, 81, 360, 520], toasts: '16px' },
  '1280 #safety': { padding: '32px 32px 76px', grid: true, stub: [124, 113, 704, 285], started: [888, 81, 360, 520], toasts: '16px' },
  '390 #scenarios': { padding: '16px 12px 76px', grid: true, stub: [12, 246, 366, 372], started: [12, 65, 366, 65], toasts: '12px' },
  '390 #safety': { padding: '16px 12px 76px', grid: true, stub: [12, 274, 366, 316], started: [12, 65, 366, 65], toasts: '12px' },
};

// The Scenarios section with no map mounted: the lab mounted afresh, its map
// unmounted and its element taken off the page, and in its place the stub it
// replaced, made as that stub made itself (ui/scenarios/index.js at
// 8e265fa6, for the sample school with no scenario open).
async function bare(page) {
  await go(page, '#project');
  await go(page, '#scenarios');
  await page.waitForFunction(() => document.querySelector('.scn') && document.querySelector('.scn').dataset.styled === 'true', { timeout: 15000 });
  await page.evaluate(async () => {
    globalThis.planMapCard = await import('./ui/components/card.js');
  });
  await page.evaluate(() => {
    const lab = document.querySelector('.scn');
    lab.scenarios.plan.unmount();
    // the stub had no inspector and no row of floors in the top bar
    globalThis.sv2.ctx.setInspector(null);
    globalThis.sv2.ctx.setSecondRow(null);
    const { intro, NOT_BUILT } = globalThis.planMapCard;
    const stub = document.createElement('div');
    stub.className = 'stub';
    stub.append(intro({
      headline: 'This is the scenario lab.',
      first: 'Try a change to the schedule here: move a group, swap two rooms. See what it does to the corridors, then apply it or discard it. The real schedule is not touched until you apply.',
      facts: 'No scenario is open.',
      note: NOT_BUILT,
    }));
    lab.replaceWith(stub);
  });
}

async function stubShape(page) {
  return page.evaluate(() => {
    const layout = document.querySelector('.surface__layout');
    const style = getComputedStyle(layout);
    const box = (el) => {
      if (!el || el.hidden) return null;
      const r = el.getBoundingClientRect();
      return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
    };
    return {
      padding: style.padding,
      grid: style.backgroundImage.startsWith('linear-gradient'),
      stub: box(document.querySelector('.stub')),
      started: box(document.querySelector('.surface__layout > .getting-started')),
      toasts: getComputedStyle(document.querySelector('.toasts')).bottom,
    };
  });
}

// A map made through the module, in a slot of a test-only container put in
// the section after what the section drew. `slot` sizes the slot; `foot` and
// `head` are heights for a bar docked under the stage and a first line over it.
// `sticky` makes the foot sticky at the section's foot, as Movement's
// playback bar is; `lift` puts in a building whose top rows are painted
// right across and whose lower rows leave the zoom buttons' columns empty.
async function mount(page, name, { slot = 'flex: 0 0 600px; height: 480px', foot = 0, head = 0, low = false, sticky = false, lift = false } = {}) {
  // the modules first, in an evaluate of their own: an async evaluate that
  // also mounts the map came back "Promise was collected" from the protocol
  await page.evaluate(async () => {
    globalThis.planMapModules = { map: await import('./ui/surface/plan-map.js'), sample: await import('./data/sample-school.js') };
  });
  await page.evaluate((args) => {
    const { createPlanMap } = globalThis.planMapModules.map;
    const { sampleSchool } = globalThis.planMapModules.sample;
    globalThis.planMaps = globalThis.planMaps || {};
    let holder = document.querySelector('[data-test="plan-maps"]');
    if (!holder) {
      holder = document.createElement('div');
      holder.dataset.test = 'plan-maps';
      holder.style.cssText = 'display: flex; align-items: flex-start; width: 100%;';
      document.getElementById('section').append(holder);
    }
    const project = sampleSchool();
    // a building one row high: its floors' box at Fit is under what the zoom buttons need
    if (args.low) {
      const width = 160;
      project.building.floors = [{ ...project.building.floors[0], width, height: 1, cells: '#'.repeat(width), spaces: [], exits: [], corridors: [], image: null }];
      project.building.connections = [];
      project.building.zones = [];
    }
    // 130 cells by 12: rows 0 to 3 a corridor across, rows 4 to 11 one from column 40 on
    if (args.lift) {
      const width = 130;
      const height = 12;
      const cells = Array.from({ length: width * height }, (_, cell) => (Math.floor(cell / width) < 4 || cell % width >= 40 ? '#' : '.')).join('');
      project.building.floors = [{ ...project.building.floors[0], width, height, cells, spaces: [], exits: [], corridors: [], image: null }];
      project.building.connections = [];
      project.building.zones = [];
    }
    const parts = {};
    if (args.foot > 0) {
      parts.foot = document.createElement('div');
      parts.foot.style.cssText = 'flex: none; height: ' + args.foot + 'px; background: var(--card);' + (args.sticky ? ' position: sticky; bottom: 0; z-index: 2;' : '');
      parts.after = [parts.foot];
    }
    if (args.head > 0) {
      parts.head = document.createElement('div');
      parts.line = document.createElement('p');
      parts.line.style.cssText = 'margin: 0; height: ' + args.head + 'px;';
      parts.line.textContent = 'A first line';
      parts.head.append(parts.line);
      parts.before = [parts.head];
    }
    const map = createPlanMap({ ctx: { store: { project } }, label: 'The ' + args.name + ' map', name: args.name, frame: () => parts });
    const place = document.createElement('div');
    place.style.cssText = args.slot;
    place.append(map.root);
    holder.append(place);
    map.setProject(project, null);
    globalThis.planMaps[args.name] = { map, place };
  }, { name, slot, foot, head, low, sticky, lift });
  // styled by the module (data-styled), measured, drawn and docked
  await page.waitForFunction((which) => {
    const { map } = globalThis.planMaps[which];
    return map.root.dataset.styled === 'true' && map.view.width > 0 && Number(map.canvas.dataset.drawn || 0) > 0 && map.root.dataset.dockedAt !== undefined;
  }, { timeout: 15000 }, name);
}

async function unmount(page, name) {
  await page.evaluate((which) => {
    const { map, place } = globalThis.planMaps[which];
    map.unmount();
    place.remove();
    delete globalThis.planMaps[which];
    const holder = document.querySelector('[data-test="plan-maps"]');
    if (holder && holder.childElementCount === 0) holder.remove();
  }, name);
}

const clearOf = (page) => page.evaluate(() => document.querySelector('.surface').style.getPropertyValue('--toast-clear'));

// How much of the floors' box is on the stage each way, in CSS pixels.
const onStage = (page, name) => page.evaluate((which) => {
  const { map } = globalThis.planMaps[which];
  const view = map.view;
  const left = view.x;
  const top = view.y;
  const right = view.x + map.world.width * view.size;
  const bottom = view.y + map.world.height * view.size;
  return { x: Math.min(right, view.width) - Math.max(left, 0), y: Math.min(bottom, view.height) - Math.max(top, 0), box: [right - left, bottom - top], stage: [view.width, view.height], zoom: view.zoom };
}, name);

function kept(shown, keep, why) {
  for (const [axis, at] of [['x', 0], ['y', 1]]) {
    const want = Math.min(keep, shown.box[at], shown.stage[at]);
    assert.ok(shown[axis] >= want - 0.5, why + ': ' + shown[axis].toFixed(1) + ' px of the floors on the stage across ' + axis + ', under ' + want + ' (' + JSON.stringify(shown) + ')');
  }
}

// ---------------------------------------------------------------- item 1

async function stubsAsBefore(session, size) {
  // Safety mounts its own map since SV2-67 and Scenarios since SV2-68: the
  // Scenarios section with its map taken away stands for a section with none
  for (const hash of ['#scenarios']) {
    await bare(session.page);
    const shape = await stubShape(session.page);
    const was = BEFORE[size + ' ' + hash];
    assert.equal(await session.page.evaluate(() => document.querySelector('.surface__layout').dataset.planMap), undefined, hash + ': the layout says a plan map is mounted where none is');
    assert.equal(shape.padding, was.padding, hash + ': the layout lost its padding, or the band a message lies on under the stub');
    assert.equal(shape.grid, was.grid, hash + ': the layout lost its faint grid');
    assert.deepEqual(shape.stub, was.stub, hash + ': the stub\'s card moved');
    assert.deepEqual(shape.started, was.started, hash + ': Getting started moved (pushed under an empty row as tall as the window?)');
    assert.equal(shape.toasts, was.toasts, hash + ': a message no longer sits where it did over the stub');
  }
  assert.deepEqual(session.problems().errors, []);
}

test('SV2-65b item 1: the Scenarios stub at 1280 by 800 keeps the padding, the card and the band under it they had before the plan map', async () => {
  await stubsAsBefore(wide, '1280');
});

test('SV2-65b item 1: the Scenarios stub at 390 by 844 with touch keeps the padding, the card and the band under it they had before the plan map', async () => {
  // a browser of its own, opened and closed here: one at a time
  const phone = await openPlanner({ width: 390, height: 844, mobile: true, hash: '#scenarios', theme: 'light' });
  try {
    await stubsAsBefore(phone, '390');
  } finally {
    await phone.close();
  }
});

test('SV2-65b item 1: a map mounted in Scenarios puts the plan\'s layout on it, and its unmount takes it away again', async () => {
  const page = wide.page;
  await bare(page);
  await mount(page, 'lab-one');
  const on = await page.evaluate(() => ({ mark: document.querySelector('.surface__layout').dataset.planMap, padding: getComputedStyle(document.querySelector('.surface__layout')).padding }));
  assert.deepEqual(on, { mark: 'lab-one', padding: '0px' }, 'the map in Scenarios is not edge to edge');
  await unmount(page, 'lab-one');
  assert.equal(await page.evaluate(() => document.querySelector('.surface__layout').dataset.planMap), undefined, 'the mark outlived the map');
  assert.deepEqual(await stubShape(page), BEFORE['1280 #scenarios'], 'the stub is not as it was once the map went');
});

// ---------------------------------------------------------------- item 2

test('SV2-65b item 2: two maps in one page: the later one\'s --toast-clear holds, and when it goes the earlier one\'s stands', async () => {
  const page = wide.page;
  await bare(page);
  await mount(page, 'lab-a', { slot: 'flex: 0 0 500px; height: 480px' });
  const alone = await clearOf(page);
  assert.match(alone, /^[1-9]\d*px$/, 'the first map measured nothing: ' + alone);
  // the second stands its zoom buttons 160 px higher, over a bar of its own
  await mount(page, 'lab-b', { slot: 'flex: 0 0 500px; height: 480px', foot: 160 });
  const both = await clearOf(page);
  assert.match(both, /^[1-9]\d*px$/);
  assert.notEqual(both, alone, 'the fixture no longer gives the two maps different values');
  // the earlier map measuring again (its section scrolled, its stage resized) does not take the surface
  await page.evaluate(() => globalThis.planMaps['lab-a'].map.dock());
  assert.equal(await clearOf(page), both, 'the earlier map overwrote the later one\'s --toast-clear');
  await unmount(page, 'lab-b');
  assert.equal(await clearOf(page), alone, 'the later map\'s unmount took the earlier one\'s --toast-clear with it');
  assert.equal(await page.evaluate(() => document.querySelector('.surface__layout').dataset.planMap), 'lab-a', 'the layout lost its mark with a map still mounted');
  await unmount(page, 'lab-a');
  assert.equal(await clearOf(page), '', 'the last map left its --toast-clear on the surface');
  // and the earlier one going first leaves the later one's alone
  await mount(page, 'lab-c', { slot: 'flex: 0 0 500px; height: 480px', foot: 160 });
  await mount(page, 'lab-d', { slot: 'flex: 0 0 500px; height: 480px' });
  const top = await clearOf(page);
  await unmount(page, 'lab-c');
  assert.equal(await clearOf(page), top, 'an earlier map\'s unmount took the later one\'s --toast-clear');
  await unmount(page, 'lab-d');
  assert.equal(await clearOf(page), '');
  assert.deepEqual(wide.problems().errors, []);
});

// ---------------------------------------------------------------- item 4

test('SV2-65b item 4: a wheel and the zoom past the edge leave KEEP_ON_STAGE px of the floors on the stage, through createPlanMap', async () => {
  const page = wide.page;
  await bare(page);
  await mount(page, 'lab-keep');
  const keep = await page.evaluate(async () => (await import('./ui/surface/plan-map.js')).KEEP_ON_STAGE);
  assert.equal(keep, 48);
  kept(await onStage(page, 'lab-keep'), keep, 'the fitted map');
  const box = await page.evaluate(() => {
    const r = globalThis.planMaps['lab-keep'].map.canvas.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  // the wheel drags the map far off down and to the right (input.js pans, then host.viewChanged)
  await page.mouse.move(box.x, box.y);
  await page.mouse.wheel({ deltaX: -6000, deltaY: -6000 });
  await page.waitForFunction(() => globalThis.planMaps['lab-keep'].map.fitted === false, { timeout: 5000 });
  const wheeled = await onStage(page, 'lab-keep');
  kept(wheeled, keep, 'a wheel past the edge (host.viewChanged)');
  // zoomed in about the stage's middle with the floors at its edge: the zoom alone would take them off
  const before = wheeled.zoom;
  await page.evaluate(() => {
    const button = globalThis.planMaps['lab-keep'].map.stage.querySelector('[data-action="zoom-in"]');
    for (let press = 0; press < 3; press += 1) button.click();
  });
  const zoomed = await onStage(page, 'lab-keep');
  assert.ok(zoomed.zoom > before * 1.5, 'the zoom buttons did not zoom: ' + before + ' to ' + zoomed.zoom);
  kept(zoomed, keep, 'Zoom in with the floors at the edge (zoomBy)');
  await unmount(page, 'lab-keep');
  assert.deepEqual(wide.problems().errors, []);
});

test('SV2-65b item 4: with little room under its first line the stage keeps its least and the section scrolls, through createPlanMap', async () => {
  const page = wide.page;
  await bare(page);
  // 220 px of section, 160 of them a first line: 60 px under it
  await mount(page, 'lab-least', { slot: 'flex: 0 0 600px; height: 220px', head: 160 });
  await page.waitForFunction(() => globalThis.planMaps['lab-least'].map.root.style.getPropertyValue('--mov-room') !== '', { timeout: 5000 });
  const got = await page.evaluate(async () => {
    const { stageLeast, ZOOM_ROOM, STAGE_LEAST } = await import('./ui/surface/plan-layout.js');
    const { map } = globalThis.planMaps['lab-least'];
    return {
      stage: map.stage.getBoundingClientRect().height,
      least: stageLeast(map.world, map.stage.clientWidth, ZOOM_ROOM),
      STAGE_LEAST,
      scrolls: map.root.scrollHeight > map.root.clientHeight,
      section: map.root.clientHeight,
    };
  });
  assert.equal(got.section, 220);
  assert.equal(got.least, got.STAGE_LEAST, 'the sample school no longer has a least of ' + got.STAGE_LEAST + ' px at this width');
  assert.ok(got.stage >= got.least - 0.5, 'the stage is ' + got.stage + ' px, under its least of ' + got.least + ' (stageRoom bypassed?)');
  assert.equal(got.scrolls, true, 'the section does not scroll to its stage');
  await unmount(page, 'lab-least');
  assert.deepEqual(wide.problems().errors, []);
});

// ---------------------------------------------------------------- SV2-72c

test('SV2-72c item 7: a renderer read off the page has the page\'s colours, and keeps none of them once it is put in a dark island', async () => {
  const page = wide.page;
  await page.evaluate(async () => {
    globalThis.planMapRenderer = await import('./ui/surface/renderer.js');
  });
  const got = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const renderer = globalThis.planMapRenderer.createRenderer(canvas);
    const off = { ...renderer.theme() };
    const island = document.createElement('div');
    island.dataset.theme = 'dark';
    island.style.cssText = 'position:fixed;left:0;top:0;width:10px;height:10px;visibility:hidden';
    island.append(canvas);
    document.body.append(island);
    const on = { ...renderer.theme() };
    const read = (el) => ['--ink', '--corridor', '--accent'].map((name) => getComputedStyle(el).getPropertyValue(name).trim());
    const page = read(document.documentElement);
    const dark = read(island);
    island.remove();
    return { off: [off.ink, off.corridor, off.accent], page, on: [on.ink, on.corridor, on.accent], island: dark };
  });
  assert.deepEqual(got.off, got.page, 'off the page the renderer did not read the page\'s tokens (#888888 for every one?)');
  assert.notDeepEqual(got.page, got.island, 'the page and the island have the same colours: the case tests nothing');
  assert.deepEqual(got.on, got.island, 'the colours read off the page were kept once the canvas was in the document');
  assert.deepEqual(wide.problems().errors, []);
});

test('SV2-72c item 8: a frame foot laid out with no box is no foot: the zoom buttons stay at the stage\'s foot and the room is measured without it', async () => {
  const page = wide.page;
  await bare(page);
  await mount(page, 'lab-foot', { slot: 'flex: 0 0 600px; height: 480px', foot: 60 });
  const read = () => page.evaluate(() => {
    const { map } = globalThis.planMaps['lab-foot'];
    const stage = map.stage.getBoundingClientRect();
    const zoom = map.stage.querySelector('.mov-zoom').getBoundingClientRect();
    return { under: map.stage.style.getPropertyValue('--mov-under'), bar: map.root.style.getPropertyValue('--mov-bar'), measured: map.root.dataset.measuredBar, gap: Math.round(stage.bottom - zoom.bottom) };
  });
  const shown = await read();
  assert.equal(shown.bar, '60px', 'the fixture\'s foot was not measured');
  // the foot taken out of the layout, as a bar with display: none
  await page.evaluate(() => {
    const { map } = globalThis.planMaps['lab-foot'];
    map.root.querySelector('.mov-map > div:last-child').style.display = 'none';
    map.remeasure();
  });
  await page.waitForFunction(() => globalThis.planMaps['lab-foot'].map.root.dataset.measuredBar === '0', { timeout: 5000 });
  const none = await read();
  assert.equal(none.under, '0px', 'the zoom buttons were lifted over a foot that is not there (its box read as the window\'s top)');
  assert.equal(none.bar, '0px', 'a foot with no box was measured as a bar');
  assert.equal(none.gap, 12, 'the zoom buttons are not at the stage\'s foot: ' + JSON.stringify(none));
  await unmount(page, 'lab-foot');
  assert.deepEqual(wide.problems().errors, []);
});

// the keydown listeners on an element, through the protocol
async function keydowns(page, selector) {
  const cdp = await page.createCDPSession();
  try {
    const { result } = await cdp.send('Runtime.evaluate', { expression: 'document.querySelector(' + JSON.stringify(selector) + ')' });
    const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
    return listeners.filter((each) => each.type === 'keydown').length;
  } finally {
    await cdp.detach();
  }
}

test('SV2-72c item 6: Enter on the cursor\'s cell is an onCell kind of its own, \'enter\', at the cursor\'s cell; Safety reads no key of the canvas itself', async () => {
  const page = wide.page;
  await bare(page);
  await mount(page, 'lab-enter');
  await page.evaluate(() => {
    globalThis.planMapEvents = [];
    globalThis.planMaps['lab-enter'].map.onCell((ev) => {
      globalThis.planMapEvents.push({ kind: ev.kind, x: ev.x, y: ev.y });
      return ev.kind === 'enter';
    });
    globalThis.planMaps['lab-enter'].map.focus();
  });
  for (const key of ['ArrowRight', 'ArrowRight', 'ArrowDown', 'Enter']) await page.keyboard.press(key);
  const events = await page.evaluate(() => globalThis.planMapEvents);
  assert.deepEqual(events.filter((ev) => ev.kind === 'keyboard').map((ev) => [ev.x, ev.y]), [[1, 0], [2, 0], [2, 1]]);
  assert.deepEqual(events.filter((ev) => ev.kind === 'enter'), [{ kind: 'enter', x: 2, y: 1 }], 'Enter was not said to the section (a press on this map is a pan)');
  const bareMap = await keydowns(page, '#lab-enter-plan');
  await unmount(page, 'lab-enter');
  await go(page, '#safety');
  await page.waitForFunction(() => document.querySelector('.sfy') && document.querySelector('.sfy').dataset.styled === 'true');
  assert.equal(await keydowns(page, '#safety-plan'), bareMap, 'Safety listens for keys on the map\'s canvas beside the map\'s own');
  assert.deepEqual(wide.problems().errors, []);
});

// ---------------------------------------------------------------- SV2-72c item 1 (W1)

// The sizes of the M5 walk-through: two desktop windows, a phone upright and on its side with touch.
const W1_SIZES = [
  { width: 1440, height: 900, mobile: false },
  { width: 1280, height: 800, mobile: false },
  { width: 390, height: 844, mobile: true },
  { width: 844, height: 390, mobile: true },
];
const W1_SECTIONS = ['#movement', '#scenarios', '#safety'];

// Every pixel of the map's own canvas under the zoom buttons' box (and a
// gap of 4 px round it) that is not the paper, the empty floor or a floor's
// edge line: read from the canvas, so a painted cell under the box shows
// whatever drew it there.
async function paintedUnderZoom(page) {
  return page.evaluate(() => {
    const canvas = Array.from(document.querySelectorAll('#section canvas.mov-plan')).find((each) => each.getClientRects().length > 0);
    const zoom = canvas.parentElement.querySelector('.mov-zoom');
    const theme = (name) => getComputedStyle(canvas).getPropertyValue(name).trim();
    const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const allowed = ['--paper', '--grid', '--line'].map((name) => rgb(theme(name)));
    const c = canvas.getBoundingClientRect();
    const z = zoom.getBoundingClientRect();
    const ratio = canvas.width / c.width;
    const x0 = Math.max(0, Math.floor((z.left - c.left - 4) * ratio));
    const y0 = Math.max(0, Math.floor((z.top - c.top - 4) * ratio));
    const x1 = Math.min(canvas.width, Math.ceil((z.right - c.left + 4) * ratio));
    const y1 = Math.min(canvas.height, Math.ceil((z.bottom - c.top + 4) * ratio));
    const data = canvas.getContext('2d').getImageData(x0, y0, x1 - x0, y1 - y0).data;
    let painted = 0;
    const seen = new Map();
    for (let i = 0; i < data.length; i += 4) {
      const px = [data[i], data[i + 1], data[i + 2]];
      if (allowed.some((ok) => ok.every((value, k) => Math.abs(value - px[k]) <= 6))) continue;
      painted += 1;
      const key = '#' + px.map((v) => v.toString(16).padStart(2, '0')).join('');
      seen.set(key, (seen.get(key) || 0) + 1);
    }
    // SV2-72f: whether the fit could clear the buttons, and every floor whole on the stage
    const root = canvas.closest('.mov');
    const plan = root.movement ? root.movement.plan : root.safety ? root.safety.plan : root.scenarios ? root.scenarios.plan : document.querySelector('.scn').scenarios.plan;
    const size = 24 * plan.view.zoom;
    const whole = plan.world.slots.every((slot) => plan.view.x + slot.x * size >= -0.5 && plan.view.x + (slot.x + slot.w) * size <= plan.view.width + 0.5 && plan.view.y + (slot.y - 2) * size >= -0.5 && plan.view.y + (slot.y + slot.h) * size <= plan.view.height + 0.5);
    return { painted, of: data.length / 4, colours: Array.from(seen.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4), fit: canvas.parentElement.dataset.fit, clear: canvas.parentElement.dataset.fitClear, whole, zoom: zoom.textContent };
  });
}

// SV2-72f: where no band clears the zoom buttons with every floor whole on
// the stage, Fit is the plain fit, whole, with the buttons over some of it.
// Of these sizes that is Movement on a phone on its side alone (its stage
// 110 px, the floors 96 px tall at 25 %).
const NOT_CLEAR = ['844 by 390 #movement'];

// each size as the sections open, then the desktop sizes with Getting
// started shown and with a scenario open (the lab's bar under its map)
const W1_CASES = [...W1_SIZES, ...W1_SIZES.filter((each) => !each.mobile).flatMap((each) => [{ ...each, started: true }, { ...each, scenario: true }])];
for (const size of W1_CASES) {
  test('SV2-72c item 1 (W1): at Fit no painted cell lies under the zoom buttons in Movement, Scenarios and Safety, at ' + size.width + ' by ' + size.height + (size.mobile ? ' with touch' : '') + (size.started ? ', Getting started shown' : '') + (size.scenario ? ', a scenario open' : ''), async () => {
    const session = await openPlanner({ width: size.width, height: size.height, mobile: size.mobile, hash: '#project', theme: 'light' });
    const page = session.page;
    try {
      await page.evaluate(async (started) => {
        const { sampleSchool } = await import('./data/sample-school.js');
        const project = sampleSchool();
        project.onboarding.dismissed = !started;
        globalThis.sv2.store.replace(project);
      }, size.started === true);
      if (size.scenario) {
        await page.evaluate(async () => {
          const actions = await import('./engine/actions.js');
          globalThis.sv2.store.apply(actions.newScenario, { name: 'Trial' });
        });
      }
      const found = {};
      for (const hash of W1_SECTIONS) {
        await go(page, hash);
        await page.waitForFunction(() => {
          const canvas = Array.from(document.querySelectorAll('#section canvas.mov-plan')).find((each) => each.getClientRects().length > 0);
          return canvas && canvas.closest('.mov').dataset.styled === 'true' && Number(canvas.dataset.drawn || 0) > 0 && canvas.parentElement.dataset.fit !== undefined;
        }, { timeout: 20000 });
        // Fit pressed, and the map painted since
        const was = await page.evaluate(() => {
          const canvas = Array.from(document.querySelectorAll('#section canvas.mov-plan')).find((each) => each.getClientRects().length > 0);
          const drawn = Number(canvas.dataset.drawn);
          canvas.parentElement.querySelector('[data-action="fit"]').click();
          return drawn;
        });
        await page.waitForFunction((n) => Number(Array.from(document.querySelectorAll('#section canvas.mov-plan')).find((each) => each.getClientRects().length > 0).dataset.drawn) > n, { timeout: 10000 }, was);
        found[hash] = await paintedUnderZoom(page);
      }
      const covered = Object.entries(found).filter(([, got]) => got.painted > 0 && got.clear !== 'false');
      assert.deepEqual(covered, [], 'painted cells under the zoom buttons at Fit: ' + JSON.stringify(found));
      const named = (hash) => size.width + ' by ' + size.height + ' ' + hash;
      assert.deepEqual(Object.keys(found).filter((hash) => found[hash].clear === 'false').map(named), size.started || size.scenario ? [] : W1_SECTIONS.map(named).filter((each) => NOT_CLEAR.includes(each)), 'a fit that could not clear the zoom buttons where one could, or none where none can: ' + JSON.stringify(found));
      assert.deepEqual(Object.entries(found).filter(([, got]) => !got.whole), [], 'a floor off the stage at Fit: ' + JSON.stringify(found));
      assert.deepEqual(session.problems().errors, []);
    } finally {
      await session.close();
    }
  });
}

// ---------------------------------------------------------------- SV2-72c item 9

// The stage's height, and what the zoom buttons need of it as drawn now.
const zoomNeed = (page, name) => page.evaluate((which) => {
  const { map } = globalThis.planMaps[which];
  const zoom = map.stage.querySelector('.mov-zoom');
  const margin = parseFloat(getComputedStyle(zoom).left) || 0;
  return { stage: map.stage.getBoundingClientRect().height, need: zoom.offsetHeight + margin * 2, coarse: matchMedia('(pointer: coarse)').matches, root: getComputedStyle(document.documentElement).fontSize };
}, name);

// The section measured with the zoom box as it is drawn now: the map's
// room() writes the need it measured (data-zoom-room); a map that did not
// measure again keeps the old one, and this fails saying so.
async function measuredAgain(page, name, why) {
  try {
    await page.waitForFunction((which) => {
      const { map } = globalThis.planMaps[which];
      const zoom = map.stage.querySelector('.mov-zoom');
      return map.root.dataset.zoomRoom === String(zoom.offsetHeight + (parseFloat(getComputedStyle(zoom).left) || 0) * 2);
    }, { timeout: 5000 }, name);
  } catch (error) {
    assert.fail(why + ' and the section was not measured again: ' + JSON.stringify(await zoomNeed(page, name)) + ', data-zoom-room ' + (await page.evaluate((which) => globalThis.planMaps[which].map.root.dataset.zoomRoom, name)));
  }
}

test('SV2-72c item 9 (the SV2-57 review): a building one row high gets what the zoom buttons need under a mouse, again when the pointer turns to a finger, and under a large root font', async () => {
  const session = await openPlanner({ width: 1280, height: 800, hash: '#scenarios', theme: 'light' });
  const page = session.page;
  try {
    await bare(page);
    // 300 px of section under a 240 px first line: the stage is at its least
    await mount(page, 'lab-low', { slot: 'flex: 0 0 844px; height: 300px', head: 240, low: true });
    const mouse = await zoomNeed(page, 'lab-low');
    assert.equal(mouse.coarse, false);
    assert.equal(mouse.need, 62, 'the zoom buttons under a mouse are not 62 px with their margins: ' + JSON.stringify(mouse));
    const box = await page.evaluate(() => {
      const { map } = globalThis.planMaps['lab-low'];
      return map.world.height * 24 * map.view.zoom + 40;
    });
    assert.ok(box < mouse.need, 'the floors\' box at Fit is not under what the zoom needs: the case tests nothing (' + box + ')');
    assert.ok(mouse.stage >= mouse.need - 0.5, 'under a mouse the stage is under what the zoom needs: ' + JSON.stringify(mouse));
    // the pointer turns to a finger: the buttons grow to 44 px, and the stage
    // with them. Through the protocol, on a session kept open for the case
    // (setViewport with hasTouch reloads the page; a session closed takes
    // its touch emulation with it, SV2-72b)
    const cdp = await page.createCDPSession();
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    if (!(await page.evaluate(() => matchMedia('(pointer: coarse)').matches))) await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }] });
    await page.waitForFunction(() => matchMedia('(pointer: coarse)').matches, { timeout: 5000 });
    await measuredAgain(page, 'lab-low', 'the pointer turned to a finger');
    const finger = await zoomNeed(page, 'lab-low');
    assert.equal(finger.need, 70, 'the zoom buttons under a finger are not 70 px with their margins: ' + JSON.stringify(finger));
    assert.ok(finger.stage >= finger.need - 0.5, 'the pointer turned to a finger and the stage was not measured again: ' + JSON.stringify(finger));
    // back to a mouse, and a root font twice the size: the buttons' line grows past 36 px
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await cdp.send('Emulation.setEmulatedMedia', { features: [] });
    await page.waitForFunction(() => !matchMedia('(pointer: coarse)').matches, { timeout: 5000 });
    await cdp.detach();
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '32px';
    });
    await page.waitForFunction(() => {
      const { map } = globalThis.planMaps['lab-low'];
      const zoom = map.stage.querySelector('.mov-zoom');
      return zoom.offsetHeight > 38;
    }, { timeout: 5000 });
    await measuredAgain(page, 'lab-low', 'the root font grew');
    const large = await zoomNeed(page, 'lab-low');
    assert.ok(large.need > 62, 'a root font of 32 px did not grow the zoom buttons: the case tests nothing: ' + JSON.stringify(large));
    assert.ok(large.stage >= large.need - 0.5, 'under a large root font the stage is under what the zoom needs: ' + JSON.stringify(large));
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '';
    });
    await unmount(page, 'lab-low');
    assert.deepEqual(session.problems().errors, []);
  } finally {
    await session.close();
  }
});

// ---------------------------------------------------------------- SV2-72c2

test('SV2-72c2 item 2: where Fit puts the floors beside the zoom buttons, Movement\'s legend is docked when its card would lie on a floor there, though a plain fit leaves its corner empty', async () => {
  // a fourth floor, short and wide, stacked under the sample's three: a plain
  // fit leaves the bottom right empty beside it, and the band beside the
  // zoom buttons moves every floor right, under the card's corner
  const session = await openPlanner({ width: 760, height: 560, hash: '#project', theme: 'light' });
  const page = session.page;
  try {
    await page.evaluate(async () => {
      const { sampleSchool } = await import('./data/sample-school.js');
      const project = sampleSchool();
      project.onboarding.dismissed = true;
      const third = project.building.floors[2];
      project.building.floors.push({ ...third, id: 'fsample004', name: 'Floor 4', level: 4, width: 80, height: 3, cells: '#'.repeat(240), spaces: [], exits: [], corridors: [], image: null });
      globalThis.sv2.store.replace(project);
    });
    await go(page, '#movement');
    await page.waitForFunction(() => document.querySelector('.mov') && document.querySelector('.mov').dataset.styled === 'true' && Number(document.querySelector('#movement-plan').dataset.drawn || 0) > 0, { timeout: 20000 });
    await page.click('input[name="movement-arrange"][value="stacked"]');
    await page.waitForFunction(() => document.querySelector('.mov').movement.world.how === 'stacked' && document.querySelector('.mov').movement.world.slots.length === 4, { timeout: 10000 });
    const was = await page.evaluate(() => {
      const drawn = Number(document.querySelector('#movement-plan').dataset.drawn);
      document.querySelector('.mov [data-action="fit"]').click();
      return drawn;
    });
    await page.waitForFunction((n) => Number(document.querySelector('#movement-plan').dataset.drawn) > n, { timeout: 10000 }, was);
    const got = await page.evaluate(async () => {
      const { fitClear, FIT_MARGIN } = await import('./ui/surface/plan-layout.js');
      const movement = document.querySelector('.mov').movement;
      const card = document.querySelector('.mov-legend');
      const stage = movement.plan.stage;
      const s = stage.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      const line = document.querySelector('.mov-legend-line');
      return {
        fit: stage.dataset.fit,
        docked: card.dataset.docked,
        width: movement.view.width,
        height: movement.view.height,
        line: line && !line.hidden ? line.offsetHeight : 0,
        card: { left: c.left - s.left, top: c.top - s.top, right: c.right - s.left, bottom: c.bottom - s.top, w: card.offsetWidth, h: card.offsetHeight, right0: parseFloat(getComputedStyle(card).right) || 0, bottom0: parseFloat(getComputedStyle(card).bottom) || 0 },
        view: { x: movement.view.x, y: movement.view.y, size: movement.view.size },
        slots: movement.world.slots.map((slot) => ({ x: slot.x, y: slot.y, w: slot.w, h: slot.h })),
        plain: (() => {
          const world = movement.world;
          const height = movement.view.height + (line && !line.hidden ? line.offsetHeight : 0);
          const place = fitClear(world, movement.view.width, height, null, FIT_MARGIN);
          return { ...place, height };
        })(),
      };
    });
    const boxes = (place, size) => got.slots.map((slot) => ({ left: place.x + slot.x * size, top: place.y + slot.y * size, right: place.x + (slot.x + slot.w) * size, bottom: place.y + (slot.y + slot.h) * size }));
    const meets = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    // the card where it rests on the stage as coversFloor reads it, on the undocked stage
    const resting = { left: got.width - got.card.right0 - got.card.w, right: got.width - got.card.right0, top: got.plain.height - got.card.bottom0 - got.card.h, bottom: got.plain.height - got.card.bottom0 };
    assert.equal(got.fit, 'beside', 'Fit did not put the floors beside the zoom buttons: the case tests nothing: ' + JSON.stringify(got));
    assert.equal(boxes(got.plain, 24 * got.plain.zoom).some((box) => meets(box, resting)), false, 'a plain fit puts a floor under the card too: the case tests nothing: ' + JSON.stringify(got));
    if (got.docked !== 'true') {
      const shown = boxes(got.view, got.view.size).filter((box) => meets(box, got.card));
      assert.deepEqual(shown, [], 'the legend\'s card stands over a floor at Fit (asked where a plain fit puts the floors): ' + JSON.stringify(got));
    }
    assert.deepEqual(session.problems().errors, []);
  } finally {
    await session.close();
  }
});

// Pixels of a mounted map's canvas under its zoom buttons as drawn now (and
// 4 px round them) that are not the paper, the empty floor or an edge line.
const paintedUnderBox = (page, name) => page.evaluate((which) => {
  const { map } = globalThis.planMaps[which];
  const canvas = map.canvas;
  const zoom = map.stage.querySelector('.mov-zoom');
  const theme = (token) => getComputedStyle(canvas).getPropertyValue(token).trim();
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const allowed = ['--paper', '--grid', '--line'].map((token) => rgb(theme(token)));
  const c = canvas.getBoundingClientRect();
  const z = zoom.getBoundingClientRect();
  const ratio = canvas.width / c.width;
  const x0 = Math.max(0, Math.floor((z.left - c.left - 4) * ratio));
  const y0 = Math.max(0, Math.floor((z.top - c.top - 4) * ratio));
  const x1 = Math.min(canvas.width, Math.ceil((z.right - c.left + 4) * ratio));
  const y1 = Math.min(canvas.height, Math.ceil((z.bottom - c.top + 4) * ratio));
  const data = canvas.getContext('2d').getImageData(x0, y0, x1 - x0, y1 - y0).data;
  let painted = 0;
  for (let i = 0; i < data.length; i += 4) {
    const px = [data[i], data[i + 1], data[i + 2]];
    if (!allowed.some((ok) => ok.every((value, k) => Math.abs(value - px[k]) <= 6))) painted += 1;
  }
  // and the floors, each with its name row (2 cells), that Fit left off the stage (SV2-32a)
  const size = 24 * map.view.zoom;
  const off = map.world.slots.filter((slot) => map.view.x + slot.x * size < -0.01 || map.view.y + (slot.y - 2) * size < -0.01 || map.view.x + (slot.x + slot.w) * size > map.view.width + 0.01 || map.view.y + (slot.y + slot.h) * size > map.view.height + 0.01).map((slot) => slot.floor.name);
  return { painted, fit: map.stage.dataset.fit, clearSaid: map.stage.dataset.fitClear, fitIn: map.stage.dataset.fitIn, off, under: map.stage.style.getPropertyValue('--mov-under'), top: map.root.scrollTop, zoomTop: z.top - c.top, coarse: matchMedia('(pointer: coarse)').matches };
}, name);

// Fit pressed, and the map drawn since.
async function pressFit(page, name) {
  const was = await page.evaluate((which) => {
    const { map } = globalThis.planMaps[which];
    const drawn = Number(map.canvas.dataset.drawn);
    map.stage.querySelector('[data-action="fit"]').click();
    return drawn;
  }, name);
  await page.waitForFunction((which, n) => Number(globalThis.planMaps[which].map.canvas.dataset.drawn) > n, { timeout: 10000 }, name, was);
}

test('SV2-72c2 item 1, SV2-32a: on a phone on its side with a sticky foot over the stage, Fit keeps every floor on the stage: the zoom buttons over the floors where they are lifted over the foot at the section\'s top and no clear band holds the floors, clear of them at rest at its end', async () => {
  const session = await openPlanner({ width: 844, height: 390, mobile: true, hash: '#scenarios', theme: 'light' });
  const page = session.page;
  try {
    await bare(page);
    // 230 px of section: a 100 px first line, the stage at its least, a 74 px sticky foot over the stage's foot
    await mount(page, 'lab-lift', { slot: 'flex: 0 0 788px; height: 230px', head: 100, foot: 74, sticky: true, lift: true });
    // SV2-72g: the floors cannot be whole above the foot with the first line
    // kept, so the map scrolls the line away, the stage clear of the foot
    await page.waitForFunction(() => {
      const { map } = globalThis.planMaps['lab-lift'];
      return map.root.scrollTop > 0 && map.root.dataset.dockedAt === String(Math.round(map.root.scrollTop)) && map.stage.style.getPropertyValue('--mov-under') === '0px';
    }, { timeout: 10000 });
    // the reader scrolls back to the top, the buttons lifted over the foot as
    // far as they go (50 px), and the foot shrinks there (playback's More
    // folded): the lift moves with no scroll, and the fitted map is fitted
    // again round the buttons where they are drawn, 40 px up
    await page.evaluate(() => {
      globalThis.planMaps['lab-lift'].map.root.scrollTop = 0;
    });
    await page.waitForFunction(() => {
      const { map } = globalThis.planMaps['lab-lift'];
      return map.root.dataset.dockedAt === '0' && parseFloat(map.stage.style.getPropertyValue('--mov-under')) > 0;
    }, { timeout: 10000 });
    const shrunk = await page.evaluate(() => {
      const { map } = globalThis.planMaps['lab-lift'];
      const drawn = Number(map.canvas.dataset.drawn);
      const under = map.stage.style.getPropertyValue('--mov-under');
      const foot = map.element.lastElementChild;
      foot.style.height = '50px';
      return { drawn, under };
    });
    await page.waitForFunction((was) => {
      const { map } = globalThis.planMaps['lab-lift'];
      return map.stage.style.getPropertyValue('--mov-under') !== was.under && Number(map.canvas.dataset.drawn) > was.drawn && map.root.dataset.dockedAt === '0';
    }, { timeout: 10000 }, shrunk);
    const top = await paintedUnderBox(page, 'lab-lift');
    assert.equal(top.top, 0, 'the section is not at its top: the case tests nothing: ' + JSON.stringify(top));
    assert.equal(top.under, '40px', 'the buttons are not lifted 40 px over the foot: the case tests nothing: ' + JSON.stringify({ shrunk, top }));
    assert.equal(top.coarse, true, 'the page is not under a finger');
    assert.ok(parseFloat(top.under) >= 24, 'the zoom buttons are not lifted over the foot: the case tests nothing: ' + JSON.stringify(top));
    // SV2-32a moved this: the floors cannot be whole above the foot here, and
    // no band clear of the lifted buttons holds them whole on the stage, so
    // Fit is the plain fit, every floor on the stage and the buttons over
    // some of it, said by data-fit-clear. It asserted the buttons clear, and
    // what kept them clear was the band beside them with the floors run off
    // the stage's right edge. No longer covered here: the buttons clear of
    // every painted cell at the section's top on this stage.
    assert.equal(top.fitIn, 'stage', 'the floors were fitted above the foot: the case tests nothing: ' + JSON.stringify(top));
    assert.deepEqual(top.off, [], 'floors off the stage at Fit with the zoom buttons lifted over the foot: ' + JSON.stringify(top));
    assert.equal(top.painted > 0 ? top.clearSaid : 'false', 'false', 'painted cells under the lifted zoom buttons, and the stage says they are clear: ' + JSON.stringify(top));
    // scrolled to its end the buttons rest at the stage's foot; Fit pressed there clears them where they rest
    await page.evaluate(() => {
      const { map } = globalThis.planMaps['lab-lift'];
      map.root.scrollTop = map.root.scrollHeight;
    });
    await page.waitForFunction(() => {
      const { map } = globalThis.planMaps['lab-lift'];
      return map.root.scrollTop > 0 && map.root.dataset.dockedAt === String(Math.round(map.root.scrollTop)) && map.stage.style.getPropertyValue('--mov-under') === '0px';
    }, { timeout: 10000 });
    await pressFit(page, 'lab-lift');
    const end = await paintedUnderBox(page, 'lab-lift');
    assert.equal(end.painted, 0, 'painted cells under the zoom buttons at rest: ' + JSON.stringify(end));
    assert.deepEqual(end.off, [], 'floors off the stage at Fit with the zoom buttons at rest: ' + JSON.stringify(end));
    await unmount(page, 'lab-lift');
    assert.deepEqual(session.problems().errors, []);
  } finally {
    await session.close();
  }
});
