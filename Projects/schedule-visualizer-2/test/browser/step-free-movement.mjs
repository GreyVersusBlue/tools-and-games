// A step-free group in the schedule, in Settings and in Movement, in a real
// browser: node test/browser/step-free-movement.mjs
//
// The journey: a small school with an elevator is built through the store's
// actions (the sample school gets one only in SV2-106): two floors, a corridor
// and rooms on each, an elevator joining them, Ada with 20 students and Bo
// who stays on Floor 1. Then, by the interface: the group editor's Needs
// step-free routes tick (pointer and keyboard) and the list's mark in words;
// Movement with Ada riding (the Summary's and the travel table's Riding, the
// hotspot row Elevator D with "in use" while a group holds the car, the
// stop's ring steady under reduced motion, the dot resting on the stop, the
// Late cell's cause); Settings' Elevators fields (0 allowed for the wait,
// the range refused beyond it). At 390 px with touch the same ticks and
// fields, each a finger's size.
//
// Nothing here waits on a first paint or a fixed time: each step waits on a
// state the page sets (the editor open on the group, a section's
// `data-pending` gone with the results for this project, the playback bar's
// own `data-riding`, a field's `aria-invalid`).

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, waitForSection } from './harness.mjs';
import { startEmpty, planReady } from './draw-pointer.mjs';

const WIDTH = 40;
const cellOf = (x, y) => y * WIDTH + x;
const STOP = cellOf(22, 10);

let session;
let page;
let ada;
let bo;

const view = (fn, ...args) => page.evaluate(fn, ...args);
const frame = () => view(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const text = (selector) => page.$eval(selector, (el) => el.textContent.trim());
const exists = async (selector) => (await page.$(selector)) !== null;
const project = () => view(() => JSON.parse(JSON.stringify(globalThis.sv2.store.project)));

// Build the school by the actions, in whatever page is given.
async function buildSchool(target) {
  return target.evaluate(async () => {
    const actions = await import('./engine/actions.js');
    const { store } = globalThis.sv2;
    store.apply(actions.addFloor, { likeFloorId: store.project.building.floors[0].id });
    const floors = store.project.building.floors;
    for (const floor of floors) {
      store.apply(actions.paintCorridor, { floorId: floor.id, from: 10 * 40 + 5, to: 10 * 40 + 21 });
      store.apply(actions.placeLift, { floorId: floor.id, cells: [10 * 40 + 22] });
    }
    const rooms = [[0, 5, '101'], [0, 12, '102'], [1, 5, '201']];
    for (const [floor, x, number] of rooms) {
      store.apply(actions.placeRoom, { floorId: floors[floor].id, rect: { x, y: 7, w: 4, h: 3 }, number });
      const room = store.project.building.floors[floor].spaces.find((space) => space.number === number);
      store.apply(actions.addDoor, { roomId: room.id, cell: 9 * 40 + x + 1, side: 's' });
    }
    store.apply(actions.connectStairs, { a: { floorId: floors[0].id, cell: 10 * 40 + 22 }, b: { floorId: floors[1].id, cell: 10 * 40 + 22 } });
    // a minute between periods: the three trips of a class of 20 cannot make it
    store.apply(actions.setSetting, { key: 'defaultPassingSeconds', value: 60 });
    const dayTypeId = store.project.dayTypes[0].id;
    const roomOf = (number) => store.project.building.floors.flatMap((floor) => floor.spaces).find((space) => space.number === number).id;
    store.apply(actions.addGroup, { name: 'Ada', grade: '7', headCount: 20 });
    store.apply(actions.addGroup, { name: 'Bo', grade: '7' });
    const groups = store.project.groups;
    const days = { Ada: ['101', '201'], Bo: ['101', '102'] };
    for (const group of groups) {
      days[group.name].forEach((number, period) => store.apply(actions.setSlot, { groupId: group.id, dayTypeId, period, slot: { room: roomOf(number) } }));
    }
    return { ada: groups.find((group) => group.name === 'Ada').id, bo: groups.find((group) => group.name === 'Bo').id };
  });
}

before(async () => {
  session = await openPlanner({ hash: '#building', width: 1280, height: 900 });
  page = session.page;
  await startEmpty(page);
  ({ ada, bo } = await buildSchool(page));
  await planReady(page);
});

after(async () => {
  if (session) await session.close();
});

// ---------------------------------------------------------------- the group editor

async function openEditor(groupId) {
  await view((id) => {
    location.hash = '#schedule/groups/' + id;
  }, groupId);
  await page.waitForFunction((id) => document.querySelector('.sch-editor')?.dataset.group === id, {}, groupId);
}

const flagOf = async (groupId) => (await project()).groups.find((group) => group.id === groupId).stepFree === true;

test('the group editor has Needs step-free routes, off for a new group, with its line and no advice to make a group of one', async () => {
  await openEditor(ada);
  assert.equal(await text('.sch-stepfree label'), 'Needs step-free routes');
  assert.equal(await page.$eval('[data-key="group-stepfree"]', (el) => el.checked), false);
  assert.equal(await text('.sch-stepfree .sch-hint'), 'Routes for this group use elevators, never stairs. For one person’s day, print a route sheet.');
  // the hint is tied to the tick, so a screen reader reads it with the tick
  const described = await page.$eval('[data-key="group-stepfree"]', (el) => document.getElementById(el.getAttribute('aria-describedby')).textContent);
  assert.match(described, /never stairs/);
  assert.equal(await exists('[data-action="route-sheet"]'), false, 'the Route sheet button is a later unit\'s: no placeholder');
});

test('a tick by pointer sets the flag, one undo step, and the list says step-free in words beside the name', async () => {
  const before = await view(() => globalThis.sv2.store.history.past.length);
  await page.click('[data-key="group-stepfree"]');
  await page.waitForFunction((id) => globalThis.sv2.store.project.groups.find((group) => group.id === id).stepFree === true, {}, ada);
  assert.equal(await view(() => globalThis.sv2.store.history.past.length), before + 1, 'one tick is one undo step');
  const row = '.sch-group[data-group="' + ada + '"]';
  await page.waitForSelector(row + ' [data-part="step-free"]');
  assert.match(await text(row + ' [data-part="step-free"]'), /step-free\.?$/);
  // the symbol is only a mark beside the words: hidden from a screen reader, which hears the words
  assert.equal(await page.$eval(row + ' [data-part="step-free"] [aria-hidden="true"]', (el) => el.textContent.trim().length > 0), true);
  assert.equal(await exists('.sch-group[data-group="' + bo + '"] [data-part="step-free"]'), false, 'a group without the flag has no mark');
});

test('by keyboard: Space unticks and ticks again, the focus stays on the tick', async () => {
  await page.focus('[data-key="group-stepfree"]');
  await page.keyboard.press('Space');
  await page.waitForFunction((id) => globalThis.sv2.store.project.groups.find((group) => group.id === id).stepFree !== true, {}, ada);
  assert.equal(await flagOf(ada), false);
  // the list is drawn from the store a moment after it: wait for the page's own redraw
  await page.waitForFunction((id) => document.querySelector('.sch-group[data-group="' + id + '"]') !== null && document.querySelector('.sch-group[data-group="' + id + '"] [data-part="step-free"]') === null, {}, ada);
  assert.equal(await exists('.sch-group[data-group="' + ada + '"] [data-part="step-free"]'), false);
  assert.equal(await view(() => document.activeElement?.dataset.key), 'group-stepfree', 'the focus is still on the tick after the page redrew');
  await page.keyboard.press('Space');
  await page.waitForFunction((id) => globalThis.sv2.store.project.groups.find((group) => group.id === id).stepFree === true, {}, ada);
  assert.equal(await view(() => document.activeElement?.dataset.key), 'group-stepfree');
});

// ---------------------------------------------------------------- Movement

async function settled() {
  await page.waitForFunction(() => {
    const section = document.querySelector('.mov');
    if (!section || section.dataset.styled !== 'true' || section.dataset.pending === 'true') return false;
    const movement = section.movement;
    return movement.state !== null && movement.state.results !== null && movement.state.project === globalThis.sv2.store.project && movement.view.width > 0;
  }, { timeout: 15000 });
  await frame();
}

async function change(patch) {
  await view((next) => document.querySelector('.mov').movement.change(next), patch);
  await settled();
}

async function tab(id) {
  await page.click('#inspector [role="tab"][data-tab="' + id + '"]');
  await page.waitForSelector('#inspector [data-panel="' + id + '"]');
}

// the letter the building gave the elevator
const carLetter = async () => (await project()).building.connections.find((connection) => connection.kind === 'elevator').car;
const bar = (fn, ...args) => page.$eval('[data-bar="playback"]', fn, ...args);

async function scrubTo(seconds) {
  await page.$eval('[data-control="scrubber"]', (el, value) => {
    el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, seconds);
  await frame();
}

// Ada's walk in the first transition, from the crowd model's own results: the
// seconds at which her head is in the car's one slot, and where the car's stop is.
function carSeconds() {
  return view(async () => {
    const { routePath } = await import(new URL('engine/crowd.js', location.href).href);
    const { routingGraph } = await import(new URL('engine/routing.js', location.href).href);
    const state = document.querySelector('.mov').movement.state;
    const day = state.picture.dayTypeId;
    const id = state.project.groups.find((group) => group.name === 'Ada').id;
    const crowd = state.results.crowd.days.find((each) => each.dayTypeId === day).transitions[0];
    const walker = crowd.groups.find((each) => each.groupId === id);
    const route = state.results.routes.days.find((each) => each.dayTypeId === day).groups.find((each) => each.groupId === id).routes[0];
    const graph = routingGraph(state.project, state.graph);
    const path = routePath(graph, route);
    const slot = Array.from(path.rides).findIndex((floors) => floors > 0);
    const held = [];
    walker.positions.forEach((position, second) => {
      if (position === slot) held.push(second);
    });
    const stop = route.cells[route.connectionAt[0]];
    return { slot, first: held[0], last: held[held.length - 1], held: held.length, stop, total: walker.total, arrived: walker.arrived, late: walker.late, riding: walker.riding, walking: walker.walking };
  });
}

test('Movement draws Ada\'s ride as one link between the stops she rode, from her route, and the table names Elevator D', async () => {
  await view(() => {
    location.hash = '#movement';
  });
  await waitForSection(page, 'movement');
  await settled();
  await change({ who: 'groups', groupIds: [ada], transition: null });
  const links = await view(() => document.querySelector('.mov').movement.state.picture.links.map((link) => ({ id: link.id, label: link.label, elevator: link.elevator === true, floors: [link.a.floorId, link.b.floorId], cells: [link.a.cell, link.b.cell], groups: link.groupIds })));
  const floors = (await project()).building.floors;
  assert.equal(links.length, 1, 'one ride, one link');
  assert.equal(links[0].label, 'Elevator ' + await carLetter());
  assert.equal(links[0].elevator, true);
  assert.deepEqual(links[0].floors.slice().sort(), floors.map((floor) => floor.id).sort(), 'from Floor 1\'s stop to Floor 2\'s: the route\'s ends');
  assert.deepEqual(links[0].cells, [STOP, STOP]);
  assert.deepEqual(links[0].groups, [ada]);
  await tab('hotspots');
  const letter = await carLetter();
  const rows = await page.$$eval('#inspector .mov-hot__row', (all) => all.map((row) => ({ kind: row.dataset.kind, name: row.querySelector('.mov-hot__name').textContent.trim(), delay: row.children[2].dataset.delay, load: row.dataset.load, use: row.querySelector('[data-part="in-use"]') ? row.querySelector('[data-part="in-use"]').hidden : null })));
  const car = rows.find((row) => row.name === 'Elevator ' + letter);
  assert.ok(car, 'the hotspot row Elevator ' + letter + ': ' + JSON.stringify(rows));
  assert.equal(car.kind, 'connection');
  assert.equal(car.load, '20', 'the group is charged to the car once');
  assert.equal(car.delay, '0', 'nobody queues for it: its delay is none');
  assert.equal(car.use, true, 'with nothing playing, the words "in use" are not shown');
});

test('the Summary and the travel table have Riding, and the Late cell names the trips, the car and the wait', async () => {
  await tab('summary');
  assert.equal(await page.$$eval('#inspector .mov-groups__table thead th', (all) => all.map((th) => th.textContent.trim()).join('|')), 'Group|Walking|Riding|Lost to crowds|Stairs');
  const riding = await text('#inspector .mov-groups__table tbody tr [data-cell="riding"]');
  const now = await carSeconds();
  assert.equal(riding, Math.floor(now.riding / 60) + ' min ' + (now.riding % 60) + ' s', 'the figure is the crowd model\'s riding, 3 trips');
  assert.equal(await page.$eval('#inspector .mov-groups__table tbody tr td:last-child', (el) => el.textContent), 'No', 'an elevator is not stairs');
  assert.match(await text('#inspector .mov-groups__table tbody th'), /Ada.*step-free/, 'the flag in words after the name');
  await tab('tables');
  assert.deepEqual(await page.$$eval('#inspector [data-travel="day"] thead th', (all) => all.map((th) => th.textContent.trim())), ['Walking', 'Riding', 'Waiting', 'Total']);
  assert.match(await text('#inspector [data-travel="lead"]'), /Riding is the time held in an elevator/);
  await change({ transition: 0 });
  await tab('tables');
  const late = await text('#inspector [data-travel="transition"] .mov-groups__late');
  assert.match(late, new RegExp('^Late by .*· 3 trips of 8 in Elevator ' + await carLetter() + ', 30 s wait$'), late);
  assert.match(await text('#inspector [data-travel="transition"] .mov-travel__group th'), /Ada.*step-free/);
});

test('while a group holds the car, the hotspot row says in use, the stop has its ring and the dot rests on it; after, none of them', async () => {
  await change({ transition: 0 });
  await tab('hotspots');
  const letter = await carLetter();
  const now = await carSeconds();
  assert.ok(now.held >= 3, 'she holds the car for ' + now.held + ' seconds');
  const mid = Math.floor((now.first + now.last) / 2);
  // before she boards: nothing is held
  await scrubTo(0);
  assert.equal(await bar((el) => el.dataset.riding), '', 'at 0 s nobody holds the car');
  assert.equal(await page.$eval('#inspector .mov-hot__row[data-kind="connection"] [data-part="in-use"]', (el) => el.hidden), true);
  await scrubTo(mid);
  await page.waitForFunction((wanted) => document.querySelector('[data-bar="playback"]').dataset.riding === wanted, {}, letter);
  const use = '#inspector .mov-hot__row[data-kind="connection"] [data-part="in-use"]';
  assert.equal(await page.$eval(use, (el) => el.hidden), false, 'in use, said in words');
  assert.equal(await text(use), ', in use');
  assert.equal(await text('#inspector .mov-hot__row[data-kind="connection"] .mov-hot__name'), 'Elevator ' + letter);
  // the dot rests on the stop she boarded at
  const at = await view((floorId, cell) => new Promise((resolve) => {
    const env = document.querySelector('.mov').movement.env;
    const ask = (g, map) => {
      env.marks.splice(env.marks.indexOf(ask), 1);
      resolve({ point: map.point(floorId, cell), size: map.view.size });
    };
    env.marks.push(ask);
    env.paint();
  }), now.stop.floorId, now.stop.cell);
  const dot = await bar((el, id) => el.playback.mark.drawn.get(id) || null, ada);
  assert.ok(dot, 'the group has a dot');
  assert.ok(Math.abs(dot.x - at.point.x) <= 2 && Math.abs(dot.y - at.point.y) <= 2, 'the dot is on the stop: ' + JSON.stringify(dot) + ' against ' + JSON.stringify(at.point));
  // the ring around the stop is on the marks' layer
  const ring = () => view((x, y, size) => {
    const layer = document.querySelector('[data-bar="playback"]').playback.layer;
    const ratio = layer.width / layer.clientWidth;
    const g = layer.getContext('2d');
    let seen = 0;
    for (let dy = -size; dy <= size; dy += 1) {
      for (let dx = -size; dx <= size; dx += 1) {
        const distance = Math.hypot(dx, dy);
        if (distance < size * 0.5 || distance > size * 1.0) continue;
        if (g.getImageData(Math.round((x + dx) * ratio), Math.round((y + dy) * ratio), 1, 1).data[3] > 0) seen += 1;
      }
    }
    return seen;
  }, at.point.x, at.point.y, Math.round(at.size));
  const during = await ring();
  assert.ok(during > 0, 'a ring around the stop');
  // after she has left the car, there is none, and the words go
  await scrubTo(now.last + 12);
  await page.waitForFunction(() => document.querySelector('[data-bar="playback"]').dataset.riding === '');
  assert.equal(await page.$eval(use, (el) => el.hidden), true);
  // the walker's own tail may cross the same ring of pixels, so the ring's going shows as fewer of them, and the page's own list of riders is empty
  assert.ok(await ring() < during, 'the ring is gone once the car is free');
  assert.equal(await view(() => document.querySelector('.mov').movement.env.rides.now.length), 0);
  await scrubTo(mid);
  await page.waitForFunction((wanted) => document.querySelector('[data-bar="playback"]').dataset.riding === wanted, {}, letter);

  // reduced motion: the ring is steady, drawn the same each time, and the words are still the signal
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.waitForFunction(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  await scrubTo(mid + 1);
  await scrubTo(mid);
  // the hotspot rings pulse over the same stop for a moment after a change: wait until they are still
  await page.waitForFunction(() => document.querySelector('#inspector [data-panel="hotspots"]').dataset.pulse !== 'moving');
  for (let draws = 0; draws < 2; draws += 1) {
    await view(() => document.querySelector('.mov').movement.env.paintMarks());
    await frame();
  }
  const first = await ring();
  await view(() => document.querySelector('.mov').movement.env.paintMarks());
  assert.ok(first > 0, 'under reduced motion the ring is there');
  await frame();
  const again = [await ring(), await ring()];
  assert.equal(again[0], again[1], 'and steady: the same ring on each draw ' + JSON.stringify(again));
  assert.ok(again[0] >= first, 'it does not shrink either');
  assert.equal(await page.$eval(use, (el) => el.hidden), false);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
});

test('with the flag off Ada has no way up (the elevator is staff only), nobody rides, and the Riding columns go', async () => {
  await openEditor(ada);
  await page.focus('[data-key="group-stepfree"]');
  await page.keyboard.press('Space');
  await page.waitForFunction((id) => globalThis.sv2.store.project.groups.find((group) => group.id === id).stepFree !== true, {}, ada);
  await view(() => {
    location.hash = '#movement';
  });
  await waitForSection(page, 'movement');
  await settled();
  await tab('summary');
  await page.waitForSelector('#inspector .mov-groups__table');
  assert.equal(await page.$$eval('#inspector .mov-groups__table thead th', (all) => all.map((th) => th.textContent.trim()).join('|')), 'Group|Walking|Lost to crowds|Stairs', 'no group rides: today\'s columns');
  await openEditor(ada);
  await page.focus('[data-key="group-stepfree"]');
  await page.keyboard.press('Space');
  await page.waitForFunction((id) => globalThis.sv2.store.project.groups.find((group) => group.id === id).stepFree === true, {}, ada);
});

// ---------------------------------------------------------------- Settings

const settingOf = (key) => view((name) => globalThis.sv2.store.project.settings[name], key);

test('Settings has an Elevators group: three fields with their ranges, 0 allowed for the wait, a wait past 300 refused', async () => {
  await view(() => {
    location.hash = '#project';
  });
  await page.waitForSelector('.settings__group[aria-labelledby]');
  const group = await page.$$eval('.settings__group', (all) => all.map((el) => el.querySelector('.settings__title').textContent.trim()));
  assert.ok(group.includes('Elevators'), group.join(', '));
  assert.equal(await text('[data-part="elevators-note"]'), 'Used only when the building has an elevator.');
  const hints = await page.$$eval('.settings__group[aria-labelledby] .setting', (all) => all.map((el) => [el.querySelector('.setting__label').textContent, el.querySelector('.setting__hint').textContent]).filter(([label]) => ['Wait', 'Ride per floor', 'People per trip'].includes(label)));
  assert.deepEqual(hints.map((row) => row[0]), ['Wait', 'Ride per floor', 'People per trip']);
  assert.match(hints[0][1], /From 0 to 300\. Write 0 for no wait\./);
  assert.match(hints[1][1], /From 1 to 60\./);
  assert.match(hints[2][1], /From 1 to 40\./);
  // an older project has none stored: the fields show the defaults
  assert.equal(await settingOf('elevatorWaitSeconds'), undefined);
  assert.equal(await page.$eval('input[name="elevatorWaitSeconds"]', (el) => el.value), '30');
  assert.equal(await page.$eval('input[name="elevatorSecondsPerFloor"]', (el) => el.value), '6');
  assert.equal(await page.$eval('input[name="elevatorPeoplePerTrip"]', (el) => el.value), '8');
  // 0 is allowed: no wait
  const wait = 'input[name="elevatorWaitSeconds"]';
  await page.click(wait, { clickCount: 3 });
  await page.keyboard.type('0');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => globalThis.sv2.store.project.settings.elevatorWaitSeconds === 0);
  assert.equal(await page.$eval(wait, (el) => el.value), '0');
  assert.equal(await page.$eval(wait, (el) => el.getAttribute('aria-invalid')), null);
  // past the range: refused in words, nothing saved
  await page.click(wait, { clickCount: 3 });
  await page.keyboard.type('301');
  await page.keyboard.press('Enter');
  await page.waitForFunction((selector) => document.querySelector(selector).getAttribute('aria-invalid') === 'true', {}, wait);
  assert.equal(await settingOf('elevatorWaitSeconds'), 0, 'the refused number was not saved');
  assert.match(await page.$eval(wait, (el) => document.getElementById(el.getAttribute('aria-describedby').split(' ').pop()).textContent), /elevator wait/i);
  await page.keyboard.press('Escape');
  assert.equal(await page.$eval(wait, (el) => el.value), '0');
});

test('the wait of 0 reaches Movement: the Late cell says no wait, and the riding figure is the ride and its trips alone', async () => {
  await view(() => {
    location.hash = '#movement';
  });
  await waitForSection(page, 'movement');
  await settled();
  await change({ who: 'groups', groupIds: [ada], transition: 0 });
  await tab('tables');
  const late = await text('#inspector [data-travel="transition"] .mov-groups__late');
  assert.match(late, new RegExp('· 3 trips of 8 in Elevator ' + await carLetter() + ', no wait$'), late);
  const now = await carSeconds();
  // 6 s for the floor and two round trips of 2 × (6 + 10) s: the 30 s wait is gone
  assert.ok(now.riding < 91, 'riding fell from 91 s to ' + now.riding);
  // put the wait back: one undo step, and the cell says 30 s again
  await view(() => globalThis.sv2.store.undo());
  await settled();
  assert.match(await text('#inspector [data-travel="transition"] .mov-groups__late'), /, 30 s wait$/);
});

// ---------------------------------------------------------------- 390 px, by touch

async function finger(cdp, type, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y), id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
}

async function tapOn(cdp, selector, label) {
  const at = await page.evaluate((wanted, words) => {
    const el = Array.from(document.querySelectorAll(wanted)).find((each) => words === undefined || each.textContent.trim() === words);
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const box = el.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, width: box.width, height: box.height, covered: !(hit && (hit === el || el.contains(hit) || hit.contains(el))) };
  }, selector, label);
  assert.ok(at, 'nothing matches ' + selector);
  assert.equal(at.covered, false, selector + ' is covered');
  assert.ok(Math.min(at.width, at.height) >= 44 || at.height >= 44, selector + ' is ' + Math.round(at.width) + ' by ' + Math.round(at.height) + ' px: under a finger\'s 44');
  await finger(cdp, 'touchStart', at.x, at.y);
  await finger(cdp, 'touchEnd');
}

test('at 390 px with touch: the tick and the Elevators fields are a finger\'s size and work, and Movement says Riding and in use', async () => {
  const phone = await openPlanner({ hash: '#building', width: 390, height: 844, mobile: true });
  const kept = page;
  page = phone.page;
  try {
    const cdp = typeof page.createCDPSession === 'function' ? await page.createCDPSession() : await page.context().newCDPSession(page);
    if (!(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) && typeof page.setViewport === 'function') {
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    }
    assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), true, 'the page has no coarse pointer');
    await startEmpty(page);
    const made = await buildSchool(page);
    await planReady(page);

    // the group editor, on a phone the list and the editor take turns
    await view((id) => {
      location.hash = '#schedule/groups/' + id;
    }, made.ada);
    await page.waitForFunction((id) => document.querySelector('.sch-editor')?.dataset.group === id, {}, made.ada);
    await tapOn(cdp, '.sch-stepfree label');
    await page.waitForFunction((id) => globalThis.sv2.store.project.groups.find((group) => group.id === id).stepFree === true, {}, made.ada);
    assert.equal(await page.$eval('[data-key="group-stepfree"]', (el) => el.checked), true);

    // Settings: the three fields, each tall enough, no sideways scroll
    await view(() => {
      location.hash = '#project';
    });
    await page.waitForSelector('input[name="elevatorWaitSeconds"]');
    for (const name of ['elevatorWaitSeconds', 'elevatorSecondsPerFloor', 'elevatorPeoplePerTrip']) {
      const box = await page.$eval('input[name="' + name + '"]', (el) => {
        el.scrollIntoView({ block: 'center' });
        const rect = el.getBoundingClientRect();
        return { height: rect.height, right: rect.right };
      });
      assert.ok(box.height >= 40, name + ' is ' + Math.round(box.height) + ' px tall');
      assert.ok(box.right <= 390, name + ' fits the 390 px width');
    }
    await page.evaluate(() => {
      document.querySelector('input[name="elevatorPeoplePerTrip"]').focus();
    });
    await page.$eval('input[name="elevatorPeoplePerTrip"]', (el) => el.select());
    await page.keyboard.type('10');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => globalThis.sv2.store.project.settings.elevatorPeoplePerTrip === 10);
    assert.equal(await view(() => document.documentElement.scrollWidth <= 390), true, 'the page does not scroll sideways');

    // Movement: Ada alone, the Summary's Riding column in a scroller the keyboard reaches, the hotspot row in use
    await view(() => {
      location.hash = '#movement';
    });
    await waitForSection(page, 'movement');
    await settled();
    await view((id) => document.querySelector('.mov').movement.change({ who: 'groups', groupIds: [id], transition: 0 }), made.ada);
    await settled();
    await tapOn(cdp, '#inspector-toggle');
    await page.waitForFunction(() => document.getElementById('inspector').dataset.open === 'true');
    await tab('summary');
    assert.equal(await page.$$eval('#inspector .mov-groups__table thead th', (all) => all.map((th) => th.textContent.trim()).join('|')), 'Group|Walking|Riding|Lost to crowds|Stairs');
    assert.equal(await page.$eval('#inspector [data-summary="groups"]', (el) => el.getAttribute('tabindex')), '0', 'the wider table scrolls in a region the keyboard reaches');
    await tab('hotspots');
    const now = await carSeconds();
    await scrubTo(Math.floor((now.first + now.last) / 2));
    const letter = await carLetter();
    await page.waitForFunction((wanted) => document.querySelector('[data-bar="playback"]').dataset.riding === wanted, {}, letter);
    assert.equal(await text('#inspector .mov-hot__row[data-kind="connection"] [data-part="in-use"]'), ', in use');
    assert.equal(await view(() => document.documentElement.scrollWidth <= 390), true, 'Movement does not scroll sideways either');
  } finally {
    await phone.close();
    page = kept;
  }
});
