// The movement view, in a real browser: node test/browser/movement.mjs
//
// Opens the sample school's movement view and works it the way a person
// does: who is shown, the day type, the transition, the floors, the scale.
// What is checked is what is on the screen: the first line's sentence, the
// pixels of the lanes on the canvas, the numbers in the legend, the card of
// a corridor cell, the figures and route health in the inspector.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, go, waitForSection } from './harness.mjs';

let session;
let page;
const dialogs = [];

const text = (selector) => page.$eval(selector, (el) => el.textContent);
const visible = (selector) => page.$eval(selector, (el) => !el.hidden && el.getClientRects().length > 0);
const line = () => text('#movement-line .mov-line__words');
const view = (fn, ...args) => page.evaluate(fn, ...args);

// The view has the answer for the project as it is now, and has drawn it.
async function settled() {
  await page.waitForFunction(() => {
    const section = document.querySelector('.mov');
    if (!section || section.dataset.styled !== 'true' || section.dataset.pending === 'true') return false;
    const movement = section.movement;
    return movement.state !== null && movement.state.results !== null && movement.state.project === globalThis.sv2.store.project && movement.view.width > 0;
  }, { timeout: 15000 });
  // one frame, so the canvas has what the state says
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function change(patch) {
  await view((next) => document.querySelector('.mov').movement.change(next), patch);
  await settled();
}

// Everything as the view opens it, whatever the case before left chosen.
const OPEN = { who: 'all', groupIds: [], dayTypeId: 'dsample00a', transition: null, measure: 'busiest', floors: 'auto', labels: true, constantWidth: false };

// Bring one cell to the middle of the map at three times the fitted size, so
// a lane is several pixels wide and a cell's edge strip can be read.
async function closeUp(floorId, cell) {
  await view((floor, at) => {
    const movement = document.querySelector('.mov').movement;
    movement.fit();
    movement.env.show(floor, [at]);
    movement.view.zoomAbout(Math.max(2, movement.view.zoom * 3), movement.view.width / 2, movement.view.height / 2);
    movement.env.paint();
  }, floorId, cell);
  await view(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

// The colour of one pixel of the map, as [r, g, b].
function pixel(x, y) {
  return view((px, py) => {
    const canvas = document.querySelector('#movement-plan');
    const ratio = canvas.width / canvas.clientWidth;
    return Array.from(canvas.getContext('2d').getImageData(Math.round(px * ratio), Math.round(py * ratio), 1, 1).data.slice(0, 3));
  }, x, y);
}

function rgb(hex) {
  return [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
}

function near(a, b, slack) {
  return a.every((value, index) => Math.abs(value - b[index]) <= (slack === undefined ? 10 : slack));
}

// Corridor cells of a floor that every one of these groups has a lane
// through, each with the place on the canvas of every lane.
function sharedCells(floorId, groupIds) {
  return view((floor, ids) => {
    const movement = document.querySelector('.mov').movement;
    const cells = movement.state.project.building.floors.find((each) => each.id === floor).cells;
    const found = [];
    for (let cell = 0; cell < cells.length; cell += 1) {
      if (cells[cell] !== '#') continue;
      const lanes = ids.map((id) => movement.laneAt(id, floor, cell));
      if (lanes.every(Boolean) && lanes.every((lane) => lane.x > 20 && lane.y > 20 && lane.x < movement.view.width - 20 && lane.y < movement.view.height - 20)) found.push({ cell, lanes });
    }
    return found;
  }, floorId, groupIds);
}

async function pickGroup(name) {
  await page.click('[data-control="add-group"]');
  await page.keyboard.type(name);
  await page.waitForSelector('.mov-ctl__more--groups .picker__option');
  await page.keyboard.press('Enter');
  await settled();
}

before(async () => {
  session = await openPlanner({ hash: '#movement', theme: 'light', width: 1440, height: 900 });
  page = session.page;
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    dialog.dismiss();
  });
  await settled();
});

after(async () => {
  if (session) await session.close();
});

test('the view opens on every group, the first day type and all transitions, and its first line is a sentence', async () => {
  assert.deepEqual(session.problems(), { errors: [], blocked: [], shimmed: [] });
  assert.equal(await line(), 'Showing 8 groups on A Day, all transitions. No route failed.');
  assert.equal(await text('#surface h1'), 'This is the movement view.');
  assert.equal(await page.$eval('#movement-line [data-action="show-me"]', (el) => el.hidden), true, 'nothing failed, so there is nothing to show');
  const seen = await view(() => {
    const movement = document.querySelector('.mov').movement;
    return {
      where: movement.state.results.where,
      choice: movement.choice,
      mode: movement.picture.mode,
      floors: movement.world.slots.map((slot) => slot.floor.name),
      pressed: Array.from(document.querySelectorAll('.mov-strip__item[aria-pressed="true"]')).map((item) => item.dataset.transition),
      strip: Array.from(document.querySelectorAll('.mov-strip__item')).map((item) => item.querySelector('.mov-strip__name').textContent + ' ' + (item.querySelector('.mov-strip__time') || { textContent: '' }).textContent),
      who: document.querySelector('input[name="movement-who"]:checked').value,
      day: document.querySelector('[data-control="day"]').selectedOptions[0].textContent,
      tab: document.querySelector('#inspector [role="tab"][aria-selected="true"]').textContent,
      tabs: Array.from(document.querySelectorAll('#inspector [role="tab"]')).map((tab) => tab.textContent),
      bar: document.querySelector('.mov-bar') !== null,
    };
  });
  assert.equal(seen.where, 'worker', 'the routes came from the worker');
  assert.equal(seen.choice.who, 'all');
  assert.equal(seen.choice.transition, null);
  assert.equal(seen.mode, 'load');
  assert.deepEqual(seen.floors, ['Floor 1', 'Floor 2', 'Floor 3'], 'every floor is on the map');
  assert.deepEqual(seen.pressed, ['all']);
  assert.deepEqual(seen.strip, ['All day', '1 to 2 4 min', '2 to 3 4 min', '3 to 4 4 min', '4 to 5 4 min', '5 to 6 4 min', '6 to 7 4 min', '7 to 8 4 min']);
  assert.equal(seen.who, 'all');
  assert.equal(seen.day, 'A Day');
  assert.deepEqual(seen.tabs, ['Hotspots', 'Travel time', 'Summary', 'Export']);
  assert.equal(seen.tab, 'Summary');
  assert.equal(seen.bar, true, 'the playback bar has its place');
});

test('opening the view ticks the last step of Getting started, and makes no undo entry', async () => {
  await page.waitForFunction(() => document.querySelector('#getting-started .steps__step[data-step="movement"]').dataset.done === 'true');
  assert.equal(await text('#getting-started .getting-started__tally'), 'All five are done.');
  assert.equal(await view(() => globalThis.sv2.store.undoLabel), null, 'nothing to undo: the tick is not the user\'s work');
});

test('the legend gives the five bands in numbers, the unit, the scale and the exclusion zones', async () => {
  const legend = await view(() => {
    const el = document.querySelector('.mov-legend');
    return {
      hidden: el.hidden,
      unit: el.dataset.unit,
      mode: el.dataset.mode,
      measure: el.dataset.measure,
      what: el.querySelector('[data-legend="what"]').textContent,
      ranges: Array.from(el.querySelectorAll('.mov-legend__range')).map((each) => each.textContent),
      said: Array.from(el.querySelectorAll('.mov-legend__band .vh')).map((each) => each.textContent),
      scale: el.querySelector('[data-legend="scale"]').textContent,
      zones: el.querySelector('[data-legend="zones"]').textContent,
      checked: Array.from(el.querySelectorAll('input:checked')).map((input) => input.value),
    };
  });
  assert.equal(legend.hidden, false);
  assert.equal(legend.unit, 'students');
  assert.equal(legend.mode, 'relative');
  assert.equal(legend.what, 'Busiest moment: the most students crossing a corridor cell in any one transition.');
  assert.deepEqual(legend.ranges, ['1–35', '36–70', '71–106', '107–141', '142–177']);
  assert.equal(legend.said[0], 'Band 1, quiet: 1 to 35 students');
  assert.equal(legend.said[4], 'Band 5, busy: 142 to 177 students');
  assert.equal(legend.scale, 'Relative: fifths of the busiest cell on screen, 177.');
  assert.equal(legend.zones, '1 exclusion zone is left out of the scale.');
  assert.deepEqual(legend.checked, ['busiest', 'relative']);
});

test('the busiest corridor cell is drawn in the top band\'s colour, and a zone cell is not coloured', async () => {
  // one floor, close up, so the strip along a corridor's wall is many pixels
  await change({ ...OPEN, floors: 'fsample001' });
  const zoneCell = await view(() => {
    const zone = globalThis.sv2.store.project.building.zones[0];
    return zone.y * 40 + zone.x + 1;
  });
  await closeUp('fsample001', await view(() => document.querySelector('.mov').movement.picture.busiest.cell));
  const seen = await view(() => {
    const movement = document.querySelector('.mov').movement;
    const busiest = movement.picture.busiest;
    const zone = movement.state.project.building.zones[0];
    const style = getComputedStyle(document.querySelector('#movement-plan'));
    return {
      busiest: movement.cellAt(busiest.floorId, busiest.cell),
      // the top left corner of a cell, clear of the lanes down its middle
      size: movement.view.size,
      zone: movement.cellAt(zone.floorId, zone.y * 40 + zone.x + 1),
      top: style.getPropertyValue('--load-5').trim(),
      bands: [1, 2, 3, 4, 5].map((band) => style.getPropertyValue('--load-' + band).trim()),
    };
  });
  const corner = (at) => pixel(at.x - seen.size * 0.42, at.y - seen.size * 0.42);
  assert.ok(near(await corner(seen.busiest), rgb(seen.top)), 'the busiest cell is ' + (await corner(seen.busiest)) + ', not band 5 ' + rgb(seen.top));
  await closeUp('fsample001', zoneCell);
  const zoned = await corner(await view((cell) => document.querySelector('.mov').movement.cellAt('fsample001', cell), zoneCell));
  for (const band of seen.bands) assert.ok(!near(zoned, rgb(band), 6), 'a cell in the exclusion zone is drawn in a band colour: ' + zoned);
});

test('two chosen groups are two lanes of different colours through a corridor cell they share', async () => {
  await change(OPEN);
  await page.click('input[name="movement-who"][value="groups"]');
  await settled();
  assert.match(await line(), /^Nothing is shown\./);
  await pickGroup('6A');
  assert.equal(await line(), 'Showing 6A on A Day, all transitions. No route failed.');
  await pickGroup('7A');
  assert.equal(await line(), 'Showing 2 groups on A Day, all transitions. No route failed.');
  assert.deepEqual(await page.$$eval('.mov-chips .chip', (all) => all.map((chip) => chip.querySelector('bdi').textContent)), ['6A', '7A']);
  // Floor 1 alone, from the floors row, so the lanes are wide enough to read a pixel of each
  await page.click('.mov-floors input[name="movement-floors"][value="fsample001"]');
  await settled();
  const anywhere = await view(() => {
    const movement = document.querySelector('.mov').movement;
    const cells = movement.state.project.building.floors[0].cells;
    for (let cell = 0; cell < cells.length; cell += 1) {
      if (cells[cell] === '#' && movement.laneAt('gsample06a', 'fsample001', cell) && movement.laneAt('gsample07a', 'fsample001', cell)) return cell;
    }
    return -1;
  });
  assert.notEqual(anywhere, -1, 'the two groups share no corridor cell on Floor 1');
  await closeUp('fsample001', anywhere);
  const shared = await sharedCells('fsample001', ['gsample06a', 'gsample07a']);
  assert.ok(shared.length > 0, 'no shared cell is on screen');
  const groups = await view(() => globalThis.sv2.store.project.groups.filter((group) => ['6A', '7A'].includes(group.name)).map((group) => group.colour));
  for (const { cell, lanes } of shared.slice(0, 6)) {
    const [a, b] = lanes;
    assert.ok(a.width >= 2, 'a lane is ' + a.width + ' px wide at this zoom');
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.width, 'cell ' + cell + ': the two lanes are one on top of the other');
    const first = await pixel(a.x, a.y);
    const second = await pixel(b.x, b.y);
    assert.ok(near(first, rgb(a.colour)), 'cell ' + cell + ': 6A\'s lane is ' + first + ', not ' + rgb(a.colour));
    assert.ok(near(second, rgb(b.colour)), 'cell ' + cell + ': 7A\'s lane is ' + second + ', not ' + rgb(b.colour));
    assert.ok(!near(first, second, 40), 'cell ' + cell + ': the two lanes are the same colour');
  }
  // on a light corridor the line is the group's own colour, as typed
  assert.deepEqual([shared[0].lanes[0].colour, shared[0].lanes[1].colour], groups);
  assert.equal(await page.$eval('.mov', (el) => el.dataset.mode), 'load');
});

test('a fifth group is refused, and the reason is on screen', async () => {
  await change({ ...OPEN, who: 'groups', groupIds: ['gsample06a', 'gsample07a'] });
  await pickGroup('7B');
  await pickGroup('8A');
  assert.equal(await line(), 'Showing 4 groups on A Day, all transitions. No route failed.');
  assert.equal(await visible('[data-reason="limit"]'), true);
  assert.equal(await text('[data-reason="limit"]'), 'Four groups at most are compared at once: with more, the lines are too thin to tell apart. Take one off to add another, or show a grade or every group.');
  assert.equal(await page.$eval('[data-control="add-group"]', (el) => el.getAttribute('aria-disabled') + ' ' + el.readOnly), 'true true');
  assert.equal(await page.$eval('[data-control="add-group"]', (el) => el.placeholder), 'Four groups are shown');
  // the picker's own way in is shut, and the view's refuses too
  const before = await view(() => document.querySelector('.mov').movement.choice.groupIds.slice());
  await page.click('[data-control="add-group"]');
  await page.keyboard.type('6B');
  await page.keyboard.press('Enter');
  assert.deepEqual(await view(() => document.querySelector('.mov').movement.choice.groupIds.slice()), before);
  assert.equal(await page.$('.toast'), null, 'the reason is under the chips; a message over the map as well would cover the legend');
  // taking one off opens it again, and the focus goes to the field
  await page.click('.mov-chips .chip[data-group="gsample08a"] .chip__remove');
  await settled();
  assert.equal(await visible('[data-reason="limit"]').catch(() => false), false);
  assert.equal(await page.$eval('[data-control="add-group"]', (el) => el.getAttribute('aria-disabled') + ' ' + (document.activeElement === el)), 'false true');
  assert.equal(await line(), 'Showing 3 groups on A Day, all transitions. No route failed.');
});

test('the absolute scale puts the school\'s own numbers in the legend, and undo puts the relative ones back', async () => {
  const ranges = () => page.$$eval('.mov-legend__range', (all) => all.map((each) => each.textContent));
  await change({ ...OPEN, who: 'groups', groupIds: ['gsample06a', 'gsample07a', 'gsample07b'] });
  const relative = await ranges();
  assert.equal(relative.length, 5);
  assert.notDeepEqual(relative, ['1–9', '10–24', '25–49', '50–99', '100+']);
  await page.click('.mov-legend input[name="movement-scale"][value="absolute"]');
  await page.waitForFunction(() => globalThis.sv2.store.project.settings.colourScale.mode === 'absolute', { timeout: 5000 });
  await settled();
  assert.deepEqual(await ranges(), ['1–9', '10–24', '25–49', '50–99', '100+']);
  assert.equal(await page.$eval('.mov-legend', (el) => el.dataset.mode), 'absolute');
  assert.equal(await text('.mov-legend [data-legend="scale"]'), 'Absolute: fixed loads, set in Project, so two pictures compare.');
  assert.equal(await view(() => globalThis.sv2.store.project.settings.colourScale.mode), 'absolute');
  assert.equal(await view(() => globalThis.sv2.store.undoLabel), 'Change the colour scale');
  // the same numbers whoever is shown
  await page.click('input[name="movement-who"][value="all"]');
  await settled();
  assert.deepEqual(await ranges(), ['1–9', '10–24', '25–49', '50–99', '100+']);
  await view(() => globalThis.sv2.store.undo());
  await settled();
  assert.deepEqual(await ranges(), ['1–35', '36–70', '71–106', '107–141', '142–177']);
  assert.equal(await page.$eval('.mov-legend input[name="movement-scale"]:checked', (el) => el.value), 'relative');
});

test('total over the day is a second picture, named as such', async () => {
  await change(OPEN);
  await page.click('.mov-legend input[name="movement-measure"][value="total"]');
  await settled();
  assert.equal(await page.$eval('.mov-legend', (el) => el.dataset.measure), 'total');
  assert.match(await text('.mov-legend [data-legend="what"]'), /^Total over the day: students crossing a corridor cell, every transition added up\.$/);
  assert.equal((await page.$$eval('.mov-legend__range', (all) => all.map((each) => each.textContent)))[4], '641–800');
  assert.equal(await text('#inspector [data-figure="busiest"] dt'), 'Highest total over the day');
  await page.click('.mov-legend input[name="movement-measure"][value="busiest"]');
  await settled();
  assert.match(await text('.mov-legend [data-legend="what"]'), /^Busiest moment: /);
  assert.equal(await text('#inspector [data-figure="busiest"] dt'), 'Busiest load');
});

test('choosing one transition shows its passing time and only its walks', async () => {
  await change(OPEN);
  await page.click('.mov-strip__item[data-transition="5"]');
  await settled();
  assert.equal(await line(), 'Showing 8 groups on A Day, Period 6 to Period 7 (1:08 to 1:12). No route failed.');
  assert.deepEqual(await page.$$eval('.mov-strip__item[aria-pressed="true"]', (all) => all.map((item) => item.dataset.transition)), ['5']);
  assert.equal(await text('#inspector [data-figure="routes"] .mov-figure__value'), '8');
  assert.equal(await text('#inspector [data-figure="late"] .mov-figure__value'), '1 group');
  assert.equal(await text('#inspector [data-figure="late"] .mov-figure__more'), '8A: Period 6 to Period 7.');
  assert.equal(await page.$eval('.mov-legend [data-legend="what"]', (el) => el.textContent), 'Students crossing a corridor cell in Period 6 to Period 7.');
  // B Day is its own copy in the sample: the day type changes the picture
  await page.select('[data-control="day"]', 'dsample00b');
  await settled();
  assert.match(await line(), /^Showing 8 groups on B Day, Period 6 to Period 7 /);
  await page.select('[data-control="day"]', 'dsample00a');
  await page.click('.mov-strip__item[data-transition="all"]');
  await settled();
  assert.equal(await line(), 'Showing 8 groups on A Day, all transitions. No route failed.');
});

test('one group alone is a line in its own colour, with no load colouring', async () => {
  await change({ ...OPEN, who: 'groups', groupIds: ['gsample08a'], floors: 'fsample001' });
  await closeUp('fsample001', await view(() => {
    const movement = document.querySelector('.mov').movement;
    const cells = movement.state.project.building.floors[0].cells;
    for (let cell = 0; cell < cells.length; cell += 1) if (cells[cell] === '#' && movement.laneAt('gsample08a', 'fsample001', cell)) return cell;
    return 0;
  }));
  assert.equal(await page.$eval('.mov', (el) => el.dataset.mode), 'single');
  assert.equal(await line(), 'Showing 8A on A Day, all transitions. No route failed.');
  assert.match(await text('.mov-legend [data-legend="single"]'), /8A: the line is the group’s own colour\./);
  assert.equal(await page.$eval('.mov-legend__body', (el) => el.hidden), true, 'no bands to explain');
  const seen = await view(() => {
    const movement = document.querySelector('.mov').movement;
    const floor = movement.state.project.building.floors[0];
    const style = getComputedStyle(document.querySelector('#movement-plan'));
    let lane = null;
    let cell = -1;
    for (let at = 0; at < floor.cells.length && !lane; at += 1) {
      if (floor.cells[at] !== '#') continue;
      lane = movement.laneAt('gsample08a', floor.id, at);
      cell = at;
    }
    return { lane, middle: movement.cellAt(floor.id, cell), size: movement.view.size, corridor: style.getPropertyValue('--corridor').trim(), colour: floor && movement.state.project.groups.find((group) => group.id === 'gsample08a').colour };
  });
  assert.ok(seen.lane, '8A walks no corridor of Floor 1');
  assert.equal(seen.lane.colour, seen.colour);
  assert.ok(near(await pixel(seen.lane.x, seen.lane.y), rgb(seen.colour)), 'the lane is not the group\'s colour');
  const corner = await pixel(seen.middle.x - seen.size * 0.42, seen.middle.y - seen.size * 0.42);
  assert.ok(near(corner, rgb(seen.corridor)), 'the corridor under it is ' + corner + ', not the plain corridor ' + rgb(seen.corridor));
});

test('a line keeps its width when zoomed only when asked to', async () => {
  const width = () => view(() => {
    const movement = document.querySelector('.mov').movement;
    const floor = movement.state.project.building.floors[0];
    for (let at = 0; at < floor.cells.length; at += 1) {
      const lane = floor.cells[at] === '#' ? movement.laneAt('gsample08a', floor.id, at) : null;
      if (lane) return lane.width;
    }
    return null;
  });
  await change({ ...OPEN, who: 'groups', groupIds: ['gsample08a'], floors: 'fsample001' });
  await page.click('.mov-zoom [data-action="fit"]');
  await page.click('.mov-zoom [data-action="zoom-in"]');
  const fitted = await width();
  await page.click('.mov-zoom [data-action="zoom-in"]');
  await page.click('.mov-zoom [data-action="zoom-in"]');
  const closer = await width();
  assert.ok(closer > fitted * 1.4, 'zoomed in, the line is ' + closer + ' px against ' + fitted);
  await page.click('[data-control="constant-width"]');
  await settled();
  const constant = await width();
  await page.click('.mov-zoom [data-action="zoom-out"]');
  await page.click('.mov-zoom [data-action="zoom-out"]');
  await page.click('.mov-zoom [data-action="zoom-out"]');
  assert.equal(await width(), constant, 'the width changed with the zoom');
  assert.equal(constant, 2.5);
  await page.click('[data-control="constant-width"]');
  await page.click('.mov-zoom [data-action="fit"]');
  await settled();
  assert.equal(await view(() => document.querySelector('.mov').movement.fitted), true);
  // period labels: the option reaches the drawing
  assert.equal(await view(() => document.querySelector('.mov').movement.choice.labels), true);
  await page.click('[data-control="labels"]');
  await settled();
  assert.equal(await view(() => document.querySelector('.mov').movement.choice.labels), false);
  await page.click('[data-control="labels"]');
  await settled();
});

test('the floors are side by side, stacked, or one at a time', async () => {
  await change(OPEN);
  await page.click('input[name="movement-who"][value="all"]');
  await page.click('.mov-floors input[name="movement-floors"][value="all"]');
  await settled();
  const world = () => view(() => {
    const movement = document.querySelector('.mov').movement;
    return { how: movement.world.how, slots: movement.world.slots.map((slot) => [slot.floor.name, slot.x, slot.y]), checked: (document.querySelector('.mov-floors input[name="movement-arrange"]:checked') || {}).value, links: movement.picture.links.length };
  });
  await page.click('.mov-floors input[name="movement-arrange"][value="side"]');
  await settled();
  let now = await world();
  assert.equal(now.how, 'side');
  assert.equal(now.checked, 'side');
  assert.equal(now.slots.length, 3);
  assert.ok(now.slots[1][1] > now.slots[0][1] && now.slots[1][2] === now.slots[0][2], 'Floor 2 is beside Floor 1');
  assert.equal(now.links, 2, 'both stairs connections are in use, and linked');
  await page.click('.mov-floors input[name="movement-arrange"][value="stacked"]');
  await settled();
  now = await world();
  assert.equal(now.how, 'stacked');
  assert.ok(now.slots[1][2] > now.slots[0][2] && now.slots[1][1] === now.slots[0][1], 'Floor 2 is under Floor 1');
  await page.click('.mov-floors input[name="movement-floors"][value="fsample002"]');
  await settled();
  now = await world();
  assert.deepEqual(now.slots.map((slot) => slot[0]), ['Floor 2']);
  assert.equal(await page.$eval('.mov-floors input[name="movement-arrange"]', (el) => el.closest('.seg').hidden), true, 'nothing to arrange with one floor');
  await page.click('.mov-floors input[name="movement-floors"][value="all"]');
  await settled();
  assert.equal((await world()).slots.length, 3);
});

test('a corridor cell under the pointer, tapped, or under the keyboard cursor shows its card', async () => {
  await change(OPEN);
  const at = await view(() => {
    const movement = document.querySelector('.mov').movement;
    const busiest = movement.picture.busiest;
    const box = movement.canvas.getBoundingClientRect();
    const place = movement.cellAt(busiest.floorId, busiest.cell);
    const slot = movement.world.slots.find((each) => each.floor.id === busiest.floorId);
    return { x: box.left + place.x, y: box.top + place.y, column: slot.x + (busiest.cell % 40) - slot.box.x, row: slot.y + Math.floor(busiest.cell / 40) - slot.box.y, room: movement.cellAt('fsample001', movement.state.project.building.floors[0].spaces[0].cells[0]), left: box.left, top: box.top };
  });
  const card = () => view(() => {
    const el = document.querySelector('.mov-card');
    return el.hidden ? null : { place: el.querySelector('.mov-card__place').textContent, load: el.querySelector('.mov-card__load').textContent, groups: Array.from(el.querySelectorAll('.mov-card__groups li[data-group]')).map((li) => li.textContent) };
  });
  assert.equal(await card(), null);
  await page.mouse.move(at.x, at.y);
  await page.waitForSelector('.mov-card:not([hidden])');
  let shown = await card();
  assert.equal(shown.place, 'Main Corridor, by Door B · Floor 1');
  assert.equal(shown.load, '177 students at its busiest, Period 4 to Period 5.');
  assert.equal(await page.$eval('.mov-card__groups', (el) => Array.from(el.childNodes).every((node) => node.nodeName === 'LI')), true, 'the list holds something that is not an item');
  assert.ok(shown.groups.length >= 4 && shown.groups.every((words) => /^\d[A-C](once|twice|\d+ times)$/.test(words)), 'the groups and how many times: ' + shown.groups.join(' | '));
  // over a room there is no card
  await page.mouse.move(at.left + at.room.x, at.top + at.room.y);
  await page.waitForFunction(() => document.querySelector('.mov-card').hidden);
  // a click (a tap) keeps the card while the pointer moves away; a second puts it away
  await page.mouse.click(at.x, at.y);
  await page.waitForSelector('.mov-card:not([hidden])');
  await page.mouse.move(at.left + at.room.x, at.top + at.room.y);
  assert.equal((await card()).place, 'Main Corridor, by Door B · Floor 1');
  await page.mouse.click(at.x, at.y);
  await page.waitForFunction(() => document.querySelector('.mov-card').hidden);
  await page.mouse.move(at.left + 2, at.top + 2);
  // the keyboard cursor: from the map's top left corner to the same cell
  await page.focus('#movement-plan');
  for (let i = 0; i < at.row; i += 1) await page.keyboard.press('ArrowDown');
  for (let i = 0; i < at.column; i += 1) await page.keyboard.press('ArrowRight');
  await page.waitForSelector('.mov-card:not([hidden])');
  shown = await card();
  assert.equal(shown.place, 'Main Corridor, by Door B · Floor 1');
  assert.match(await text('#announcer'), /^Main Corridor, by Door B, Floor 1\. 177 students at its busiest, Period 4 to Period 5\. /);
  await page.keyboard.press('Escape');
  assert.equal(await card(), null);
  // one step up is a room: said, with no card
  await page.keyboard.press('ArrowUp');
  assert.equal(await text('#announcer'), 'Floor 1: not a corridor.');
  assert.equal(await card(), null);
});

test('the summary has the figures, and a row for each group on screen', async () => {
  await change(OPEN);
  const figure = (key) => view((which) => {
    const el = document.querySelector('#inspector [data-figure="' + which + '"]');
    return [el.querySelector('dt').textContent, el.querySelector('.mov-figure__value').textContent, (el.querySelector('.mov-figure__more') || { textContent: '' }).textContent];
  }, key);
  assert.deepEqual(await figure('routes'), ['Routes drawn', '56', '']);
  assert.deepEqual(await figure('busiest'), ['Busiest load', '177 students', 'Main Corridor, by Door B on Floor 1, Period 4 to Period 5.']);
  assert.deepEqual(await figure('late'), ['Cannot make a transition in time', '1 group', '8A: Period 6 to Period 7.']);
  assert.deepEqual(await figure('failed'), ['Routes that failed', 'None', '']);
  const rows = await page.$$eval('#inspector [data-summary="groups"] tbody tr', (all) => all.map((row) => [row.querySelector('th bdi').textContent, row.cells[1].textContent, row.cells[2].textContent, row.cells[3].textContent, row.dataset.late, row.dataset.failed]));
  assert.equal(rows.length, 8);
  assert.deepEqual(rows[0], ['6A', '8 min 51 s', '4 s', 'Yes', '0', '0']);
  assert.deepEqual(rows[6].slice(0, 1).concat(rows[6].slice(4)), ['8A', '1', '0']);
  assert.equal(await text('#inspector [data-summary="groups"] tr[data-group="gsample08a"] .mov-groups__late'), 'late once');
});

test('route health lists a failed route by name with why, and its link opens the slot', async () => {
  await change(OPEN);
  assert.equal(await text('#inspector [data-summary="health-line"]'), 'Every route was found: 8 groups on 2 day types.');
  assert.equal(await page.$$eval('#inspector [data-summary="health"] li', (all) => all.length), 0);
  // 7A loses its Period 3 room on A Day: the walk into it and the walk out of it cannot be drawn
  await view(async () => {
    const { setSlot } = await import(new URL('engine/actions.js', location.href).href);
    globalThis.sv2.store.apply(setSlot, { groupId: 'gsample07a', dayTypeId: 'dsample00a', period: 2, slot: { room: null } });
  });
  await settled();
  assert.equal(await line(), 'Showing 8 groups on A Day, all transitions. 2 routes failed. The first: 7A, Period 3, no room is set for this period.');
  assert.equal(await text('#inspector [data-figure="failed"] .mov-figure__value'), '2');
  assert.equal(await text('#inspector [data-figure="routes"] .mov-figure__value'), '54');
  assert.equal(await text('#inspector [data-summary="health-line"]'), '2 routes failed, of every group on all 2 day types. Each is a transition nobody can be drawn walking.');
  const items = await page.$$eval('#inspector [data-summary="health"] li', (all) => all.map((li) => [li.dataset.group, li.dataset.day, li.dataset.period, li.dataset.reason, li.querySelector('.mov-health__text').textContent, li.querySelector('button').textContent]));
  assert.deepEqual(items, [
    // the walk into Period 3 and the walk out of it: both name the period with no room (SV2-39 item 1)
    ['gsample07a', 'dsample00a', '1', 'no-room', '7A, Period 3 on A Day, no room is set for this period.', 'Fix it in the schedule'],
    ['gsample07a', 'dsample00a', '2', 'no-room', '7A, Period 3 on A Day, no room is set for this period.', 'Fix it in the schedule'],
  ]);
  assert.equal(await text('#inspector [data-summary="groups"] tr[data-group="gsample07a"] .mov-groups__failed'), '2 failed routes');
  // B Day shows no failure of its own, and says where the others are
  await page.select('[data-control="day"]', 'dsample00b');
  await settled();
  assert.equal(await line(), 'Showing 8 groups on B Day, all transitions. No route failed here; 2 routes failed elsewhere.');
  // "Show me" goes to route health, wherever the inspector was
  await page.click('#inspector [role="tab"][data-tab="hotspots"]');
  assert.equal(await text('#inspector [role="tab"][aria-selected="true"]'), 'Hotspots');
  await page.click('#movement-line [data-action="show-me"]');
  assert.equal(await text('#inspector [role="tab"][aria-selected="true"]'), 'Summary');
  assert.equal(await view(() => document.activeElement.dataset.action), 'fix', 'the focus is on the first failed route\'s link');
  // the link: the Schedule's Groups tab, 7A chosen, the cursor in Period 3 of A Day
  await page.keyboard.press('Enter');
  await waitForSection(page, 'schedule');
  await page.waitForFunction(() => {
    const row = document.activeElement && document.activeElement.closest ? document.activeElement.closest('.sch-slot') : null;
    return row !== null && row.dataset.period === '2' && row.closest('.sch-day').dataset.day === 'dsample00a';
  }, { timeout: 5000 });
  assert.equal(await page.$eval('.sch-group[aria-current="true"]', (el) => el.dataset.group), 'gsample07a');
  // put right, the view is whole again. The field is left first: the Schedule
  // section keeps what a focused field holds across a redraw, so an undo
  // with the cursor still in it would be typed over when the field is left.
  await view(() => document.activeElement.blur());
  await view(() => globalThis.sv2.store.undo());
  assert.equal(await view(() => globalThis.sv2.store.project.groups.find((group) => group.id === 'gsample07a').days.dsample00a[2].room), 'rsamplelib');
  await go(page, '#movement');
  await settled();
  assert.equal(await page.$eval('[data-control="day"]', (el) => el.value), 'dsample00b', 'the view remembers what was chosen');
  assert.equal(await line(), 'Showing 8 groups on B Day, all transitions. No route failed.');
  assert.equal(await text('#inspector [data-summary="health-line"]'), 'Every route was found: 8 groups on 2 day types.');
  await page.select('[data-control="day"]', 'dsample00a');
  await settled();
});

test('Clear empties the view, and choosing who fills it again', async () => {
  await change(OPEN);
  await page.click('.mov-strip__item[data-transition="2"]');
  await page.click('[data-action="clear"]');
  await settled();
  assert.equal(await line(), 'Nothing is shown. Choose a group, a grade or every group to see where they walk.');
  const seen = await view(() => {
    const movement = document.querySelector('.mov').movement;
    return { mode: movement.picture.mode, lanes: movement.picture.lanes ? Array.from(movement.picture.lanes.floors.values()).flat().length : 0, legend: document.querySelector('.mov-legend').hidden, who: document.querySelector('input[name="movement-who"]:checked').value, chips: document.querySelectorAll('.mov-chips .chip').length, transition: movement.choice.transition };
  });
  assert.deepEqual(seen, { mode: 'empty', lanes: 0, legend: true, who: 'groups', chips: 0, transition: null });
  assert.equal(await text('#inspector [data-figure="routes"] .mov-figure__value'), '0');
  // a grade
  await page.click('input[name="movement-who"][value="grade"]');
  await settled();
  assert.equal(await line(), 'Showing 3 groups of grade 6 on A Day, all transitions. No route failed.');
  await page.select('[data-control="grade"]', '8');
  await settled();
  assert.equal(await line(), 'Showing 2 groups of grade 8 on A Day, all transitions. No route failed.');
  await page.click('input[name="movement-who"][value="all"]');
  await settled();
  assert.equal(await line(), 'Showing 8 groups on A Day, all transitions. No route failed.');
});

test('a group\'s name is shown exactly as typed, on the chips, in the line, on the card and in the summary', async () => {
  const hostile = '<img src=x onerror=alert(1)> & "7A"';
  await view(async (name) => {
    const { editGroup } = await import(new URL('engine/actions.js', location.href).href);
    globalThis.sv2.store.apply(editGroup, { id: 'gsample07a', name });
  }, hostile);
  await settled();
  await change({ who: 'groups', groupIds: ['gsample07a'] });
  assert.equal(await line(), 'Showing ' + hostile + ' on A Day, all transitions. No route failed.');
  assert.equal(await text('.mov-chips .chip bdi'), hostile);
  assert.equal(await text('#inspector [data-summary="groups"] tbody th bdi'), hostile);
  assert.match(await text('.mov-legend [data-legend="single"]'), /<img src=x onerror=alert\(1\)> & "7A": the line/);
  assert.equal(await page.$$eval('.mov img, #inspector img', (all) => all.length), 0, 'the name became an element');
  assert.deepEqual(dialogs, [], 'the name ran as script');
  await view(() => globalThis.sv2.store.undo());
  await change({ who: 'all', groupIds: [] });
});

// ---------------------------------------------------------------- SV2-39: the review of SV2-17

// Stand something else in for the engine, by the store's own way in
// (store.derived.use), and put the real one back.
const standIn = (kind) => view((which) => {
  const derived = globalThis.sv2.store.derived;
  if (!globalThis.sv2Kept) globalThis.sv2Kept = derived.engine;
  const real = globalThis.sv2Kept;
  // The failure comes in a later task, as a worker's does. (A promise already
  // rejected when it is handed over, inside the page call that changes the
  // project, makes Chromium report that call's own promise as collected.)
  if (which === 'fails') derived.use({ results: () => new Promise((resolve, reject) => { setTimeout(() => reject(new Error('The engine stopped')), 0); }) });
  else if (which === 'waits') {
    // answers only once it is let go
    const gate = new Promise((resolve) => { globalThis.sv2LetGo = resolve; });
    derived.use({ results: () => gate.then(() => real.results()) });
  } else derived.use(real);
}, kind);

test('SV2-39 item 2: when the routes cannot be worked out after a change, the first line says so and the old picture is marked as from before the change', async () => {
  await change(OPEN);
  assert.equal(await page.$eval('.mov', (el) => el.dataset.stale || null), null);
  await standIn('fails');
  await view(async () => {
    const { editGroup } = await import(new URL('engine/actions.js', location.href).href);
    globalThis.sv2.store.apply(editGroup, { id: 'gsample07a', name: '7A East' });
  });
  await page.waitForFunction(() => document.querySelector('.mov').dataset.stale === 'true', { timeout: 5000 });
  const said = 'The routes could not be worked out: The engine stopped. The map and the figures are from before your last change.';
  assert.equal(await line(), said);
  assert.equal(await text('#announcer'), said, 'it is said as well as shown');
  assert.equal(await page.$eval('#movement-line [data-action="show-me"]', (el) => el.hidden), true);
  const seen = await view(() => {
    const section = document.querySelector('.mov');
    const movement = section.movement;
    return {
      pending: section.dataset.pending || null,
      old: movement.state.project !== globalThis.sv2.store.project,
      results: movement.state.results !== null,
      drawn: movement.picture.drawn,
      name: movement.state.project.groups.find((group) => group.id === 'gsample07a').name,
      now: globalThis.sv2.store.project.groups.find((group) => group.id === 'gsample07a').name,
      map: document.querySelector('.mov-map').hidden,
    };
  });
  assert.deepEqual(seen, { pending: null, old: true, results: true, drawn: 56, name: '7A', now: '7A East', map: false }, 'the last good picture is still drawn, against its own project');
  assert.equal(await text('#inspector [data-figure="routes"] .mov-figure__value'), '56');
  // a choice made meanwhile still draws from the old answer, and is still marked
  await view(() => document.querySelector('.mov').movement.change({ transition: 5 }));
  assert.equal(await page.$eval('.mov', (el) => el.dataset.stale), 'true');
  assert.equal(await line(), said);
  assert.equal(await text('#inspector [data-figure="routes"] .mov-figure__value'), '8');
  // the engine back and the project changed again: an answer comes, and nothing is stale
  await standIn('real');
  await view(() => globalThis.sv2.store.undo());
  await settled();
  assert.equal(await page.$eval('.mov', (el) => el.dataset.stale || null), null);
  await change(OPEN);
  assert.equal(await line(), 'Showing 8 groups on A Day, all transitions. No route failed.');
});

test('SV2-39 item 3: while the answer for a new scale is awaited, the legend\'s toggle shows the scale just chosen', async () => {
  await change(OPEN);
  const scale = () => view(() => ({
    checked: document.querySelector('.mov-legend input[name="movement-scale"]:checked').value,
    setting: globalThis.sv2.store.project.settings.colourScale.mode,
    picture: document.querySelector('.mov-legend').dataset.mode,
    pending: document.querySelector('.mov').dataset.pending || null,
    last: document.querySelectorAll('.mov-legend__range')[4].textContent,
  }));
  assert.deepEqual(await scale(), { checked: 'relative', setting: 'relative', picture: 'relative', pending: null, last: '142–177' });
  await standIn('waits');
  await page.click('.mov-legend input[name="movement-scale"][value="absolute"]');
  await page.waitForFunction(() => globalThis.sv2.store.project.settings.colourScale.mode === 'absolute' && document.querySelector('.mov').dataset.pending === 'true', { timeout: 5000 });
  await view(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  // the numbers are still the old picture's; the toggle is not put back to them
  assert.deepEqual(await scale(), { checked: 'absolute', setting: 'absolute', picture: 'relative', pending: 'true', last: '142–177' });
  // a choice made while waiting redraws the legend: the toggle stays where it was put
  await view(() => document.querySelector('.mov').movement.change({ labels: false }));
  assert.equal((await scale()).checked, 'absolute');
  await view(() => globalThis.sv2LetGo());
  await settled();
  assert.deepEqual(await scale(), { checked: 'absolute', setting: 'absolute', picture: 'absolute', pending: null, last: '100+' });
  await standIn('real');
  await view(() => globalThis.sv2.store.undo());
  await settled();
  assert.deepEqual(await scale(), { checked: 'relative', setting: 'relative', picture: 'relative', pending: null, last: '142–177' });
  await change(OPEN);
});

test('SV2-39 items 4 and 5: the legend counts the zones of the floors on screen, and a group chosen twice is one chip', async () => {
  await change(OPEN);
  assert.equal(await text('.mov-legend [data-legend="zones"]'), '1 exclusion zone is left out of the scale.');
  await change({ ...OPEN, floors: 'fsample003' });
  assert.equal(await text('.mov-legend [data-legend="zones"]'), 'No exclusion zones.', 'the one zone is on Floor 1, which is not on screen');
  await change({ ...OPEN, who: 'groups', groupIds: ['gsample06a', 'gsample06a', 'gsample07a', 'gsample06a'] });
  assert.deepEqual(await page.$$eval('.mov-chips .chip', (all) => all.map((chip) => chip.dataset.group)), ['gsample06a', 'gsample07a']);
  assert.deepEqual(await view(() => document.querySelector('.mov').movement.choice.groupIds), ['gsample06a', 'gsample07a']);
  assert.equal(await page.$eval('[data-control="add-group"]', (el) => el.getAttribute('aria-disabled')), 'false', 'two groups are not the limit');
  await change(OPEN);
});

test('SV2-39 item 6: a pointer moving inside one cell does not work the card out again', async () => {
  await change(OPEN);
  await view(() => document.querySelector('.mov').movement.fit());
  const at = await view(() => {
    const movement = document.querySelector('.mov').movement;
    const busiest = movement.picture.busiest;
    const box = movement.canvas.getBoundingClientRect();
    const place = movement.cellAt(busiest.floorId, busiest.cell);
    return { x: box.left + place.x, y: box.top + place.y, size: movement.view.size, cell: busiest.cell };
  });
  assert.ok(at.size >= 6, 'a cell is ' + at.size + ' px: too small to move inside');
  await page.mouse.move(at.x, at.y);
  await page.waitForSelector('.mov-card:not([hidden])');
  // every change to the card from here on is counted
  await view(() => {
    globalThis.sv2CardChanges = 0;
    globalThis.sv2CardWatch = new MutationObserver((records) => { globalThis.sv2CardChanges += records.length; });
    globalThis.sv2CardWatch.observe(document.querySelector('.mov-card'), { childList: true, subtree: true, characterData: true, attributes: true });
  });
  const drawnBefore = await view(() => Number(document.querySelector('#movement-plan').dataset.drawn));
  const nudge = Math.max(1, Math.floor(at.size / 4));
  for (const [dx, dy] of [[nudge, 0], [nudge, nudge], [0, nudge], [-nudge, 0], [0, -nudge], [0, 0]]) await page.mouse.move(at.x + dx, at.y + dy);
  await view(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const still = await view(() => ({ changes: globalThis.sv2CardChanges + globalThis.sv2CardWatch.takeRecords().length, cell: document.querySelector('.mov-card').dataset.cell, hidden: document.querySelector('.mov-card').hidden, drawn: Number(document.querySelector('#movement-plan').dataset.drawn) }));
  assert.deepEqual(still, { changes: 0, cell: String(at.cell), hidden: false, drawn: drawnBefore }, 'six moves inside the cell changed the card or painted the map');
  // into the next cell: a new card, as before
  await page.mouse.move(at.x + at.size, at.y);
  await page.waitForFunction((cell) => document.querySelector('.mov-card').dataset.cell !== String(cell) || document.querySelector('.mov-card').hidden, {}, at.cell);
  assert.ok(await view(() => globalThis.sv2CardChanges + globalThis.sv2CardWatch.takeRecords().length) > 0, 'the watch saw nothing when the card did change');
  // back, and the picture changes under a pointer that then moves inside the cell: the card follows
  await page.mouse.move(at.x, at.y);
  await page.waitForFunction((cell) => !document.querySelector('.mov-card').hidden && document.querySelector('.mov-card').dataset.cell === String(cell), {}, at.cell);
  assert.equal(await text('.mov-card__load'), '177 students at its busiest, Period 4 to Period 5.');
  const first = await page.$eval('.mov-card__groups li[data-group]', (li) => li.dataset.group);
  await view(async (id) => {
    const { editGroup } = await import(new URL('engine/actions.js', location.href).href);
    globalThis.sv2.store.apply(editGroup, { id, name: 'Renamed' });
  }, first);
  await settled();
  await page.mouse.move(at.x + nudge, at.y);
  await page.waitForFunction((id) => document.querySelector('.mov-card__groups li[data-group="' + id + '"] bdi').textContent === 'Renamed', { timeout: 5000 }, first);
  await view(() => globalThis.sv2.store.undo());
  await settled();
  await view(() => { globalThis.sv2CardWatch.disconnect(); });
  await page.mouse.move(2, 2);
});

test('SV2-39 item 7: the graph the view draws on is the one the store keeps for the building', async () => {
  await change(OPEN);
  const same = () => view(() => {
    const movement = document.querySelector('.mov').movement;
    let made = 0;
    const kept = globalThis.sv2.store.derived.get('graph', ['building'], () => {
      made += 1;
      return null;
    });
    return { same: kept === movement.state.graph, made, count: movement.state.graph.count, loads: movement.state.results.loads[0].cells.busiest.length };
  });
  let now = await same();
  assert.equal(now.made, 0, 'the store had no graph for this building: the view keeps its own');
  assert.equal(now.same, true);
  assert.equal(now.count, now.loads);
  // a change to the schedule leaves the building, and its graph, as they are
  const before = await view(() => { globalThis.sv2Graph = document.querySelector('.mov').movement.state.graph; return true; });
  assert.equal(before, true);
  await view(async () => {
    const { editGroup } = await import(new URL('engine/actions.js', location.href).href);
    globalThis.sv2.store.apply(editGroup, { id: 'gsample07a', name: '7A East' });
  });
  await settled();
  assert.equal(await view(() => document.querySelector('.mov').movement.state.graph === globalThis.sv2Graph), true, 'a renamed group built the graph again');
  await view(() => globalThis.sv2.store.undo());
  await settled();
  // a change to the building: until its answer comes the old picture keeps the old graph; then both are new
  await standIn('waits');
  await view(async () => {
    const { paintCorridor } = await import(new URL('engine/actions.js', location.href).href);
    // the top left corner of Floor 3, which is empty
    globalThis.sv2.store.apply(paintCorridor, { floorId: 'fsample003', cells: [0] });
  });
  await page.waitForFunction(() => document.querySelector('.mov').dataset.pending === 'true', { timeout: 5000 });
  const waiting = await view(() => {
    const movement = document.querySelector('.mov').movement;
    return { old: movement.state.graph === globalThis.sv2Graph, fits: movement.state.graph.count === movement.state.results.loads[0].cells.busiest.length, building: movement.state.project.building !== globalThis.sv2.store.project.building };
  });
  assert.deepEqual(waiting, { old: true, fits: true, building: true }, 'the old answer is drawn on the old building\'s graph');
  await view(() => globalThis.sv2LetGo());
  await settled();
  now = await same();
  assert.deepEqual([now.made, now.same, now.count === now.loads], [0, true, true]);
  assert.equal(await view(() => document.querySelector('.mov').movement.state.graph !== globalThis.sv2Graph), true, 'a new building, a new graph');
  await standIn('real');
  await view(() => globalThis.sv2.store.undo());
  await settled();
  assert.equal(await line(), 'Showing 8 groups on A Day, all transitions. No route failed.');
});

test('with no groups there is no map: the screen says what the view is and what to do first', async () => {
  await go(page, '#project');
  await page.click('#sample-school [data-action="sample"]');
  await page.waitForFunction(() => document.getElementById('sample-chip').hidden);
  await go(page, '#movement');
  await page.waitForFunction(() => document.querySelector('.mov-empty') && !document.querySelector('.mov-empty').hidden);
  assert.equal(await text('#surface h1:not([hidden])'), 'This is the movement view.');
  assert.equal(await page.$$eval('#surface h1', (all) => all.filter((each) => !each.hidden).length), 1, 'one headline on the screen');
  assert.match(await text('.mov-empty .intro__first'), /^It draws every group’s walk between one period and the next/);
  assert.equal(await text('.mov-empty .intro__facts'), 'There is nothing to draw yet: this project has no rooms and no groups.');
  assert.equal(await page.$eval('#inspector', (el) => el.hidden), true);
  assert.equal(await page.$eval('.mov-map', (el) => el.hidden), true);
  assert.equal(await view(() => globalThis.sv2.store.project.onboarding.steps.movement === true), false, 'an empty view is not the movement view looked at');
  // the sample back: the map is there again without leaving the section
  await view(() => globalThis.sv2.store.undo());
  await settled();
  assert.equal(await page.$eval('.mov-map', (el) => el.hidden), false);
  assert.equal(await page.$eval('#inspector', (el) => el.hidden), false);
  assert.equal(await line(), 'Showing 8 groups on A Day, all transitions. No route failed.');
});

test('nothing went wrong on the way, and nothing was asked of another origin', async () => {
  assert.deepEqual(session.problems(), { errors: [], blocked: [], shimmed: [] });
  assert.deepEqual(session.offsite, []);
  assert.deepEqual(dialogs, []);
});
