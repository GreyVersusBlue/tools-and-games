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
async function mount(page, name, { slot = 'flex: 0 0 600px; height: 480px', foot = 0, head = 0 } = {}) {
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
    const parts = {};
    if (args.foot > 0) {
      parts.foot = document.createElement('div');
      parts.foot.style.cssText = 'flex: none; height: ' + args.foot + 'px; background: var(--card);';
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
  }, { name, slot, foot, head });
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
