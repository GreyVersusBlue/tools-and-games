// Playback, in a real browser: node test/browser/playback.mjs
//
// Opens the sample school's movement view and plays a transition the way a
// person does: the scrubber, Play under frames whose times the test hands
// over, the settings behind More. What is checked is where a marker is on the
// map against the crowd model's `positions`, what the bar and the cell card
// say, and what the device keeps.
//
// The transition is Period 6 to Period 7 on A Days: the sample school's long
// walk. 8A goes from the Gym to Room 303 by two stairs connections and is in
// its room after 261 seconds, against 240 of passing time.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, waitForSection } from './harness.mjs';

const DAY = 'dsample00a';
const TRANSITION = 5;
const LATE_GROUP = 'gsample08a';
const LATE_COLOUR = '#8c6d31';

let session;
let page;

const view = (fn, ...args) => page.evaluate(fn, ...args);
const frame = () => view(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const bar = (fn, ...args) => page.$eval('[data-bar="playback"]', fn, ...args);
const part = (name) => page.$eval('[data-bar="playback"] [data-part="' + name + '"]', (el) => (el.hidden ? null : el.textContent));

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

// Move the scrubber as a person's hand does: its value, then the event.
async function scrubTo(seconds) {
  await page.$eval('[data-control="scrubber"]', (el, value) => {
    el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, seconds);
  await frame();
}

// What the crowd results say of one group in the transition, worked out here
// from the results and the engine's routePath, with nothing of the markers'
// own: per tick the head's index, and for each index of the path its cell
// (or null on the stairs).
function walkOf(groupId) {
  return view(async (day, period, id) => {
    const { routePath } = await import(new URL('engine/crowd.js', location.href).href);
    const { routingGraph } = await import(new URL('engine/routing.js', location.href).href);
    const state = document.querySelector('.mov').movement.state;
    const crowd = state.results.crowd.days.find((each) => each.dayTypeId === day).transitions[period];
    const walker = crowd.groups.find((each) => each.groupId === id);
    const route = state.results.routes.days.find((each) => each.dayTypeId === day).groups.find((each) => each.groupId === id).routes[period];
    const graph = routingGraph(state.project, state.graph);
    const path = routePath(graph, route);
    const cells = [];
    for (let i = 0; i < path.length; i += 1) cells.push(path.links[i] === -1 ? { floorId: graph.floors[graph.nodeFloor[path.nodes[i]]].id, cell: graph.nodeCell[path.nodes[i]] } : null);
    return { positions: Array.from(walker.positions), cells, slots: walker.slots, total: walker.total, late: walker.late, passing: crowd.passingSeconds, to: { floorId: route.to.floorId, cell: route.to.cell } };
  }, DAY, TRANSITION, groupId);
}

// A cell's middle on the map, as a mark is told it: asked through an entry on
// env.marks, which is handed `map` like the markers' own entry.
async function mapPoint(floorId, cell) {
  await view((floor, at) => {
    const env = document.querySelector('.mov').movement.env;
    globalThis.probe = null;
    const ask = (g, map) => {
      globalThis.probe = map.point(floor, at);
      env.marks.splice(env.marks.indexOf(ask), 1);
    };
    env.marks.push(ask);
    env.paint();
  }, floorId, cell);
  await frame();
  return view(() => globalThis.probe);
}

const drawn = (groupId) => bar((el, id) => el.playback.mark.drawn.get(id) || null, groupId);

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

function close(a, b, slack, what) {
  assert.ok(a && b, what + ': a place on the map, got ' + JSON.stringify(a) + ' and ' + JSON.stringify(b));
  assert.ok(Math.abs(a.x - b.x) <= slack && Math.abs(a.y - b.y) <= slack, what + ': ' + JSON.stringify(a) + ' is not at ' + JSON.stringify(b));
}

// Frames whose times the test gives: the playback clock asks this for its
// next frame, and `run(ms)` calls it with that time.
async function pinFrames() {
  await bar((el) => {
    const queue = [];
    globalThis.pinned = {
      asked: 0,
      run(stamp) {
        const fn = queue.shift();
        if (fn) fn(stamp);
        return Boolean(fn);
      },
    };
    el.playback.frames({
      request(fn) {
        queue.push(fn);
        globalThis.pinned.asked += 1;
        return globalThis.pinned.asked;
      },
      cancel() {
        queue.length = 0;
      },
    });
  });
}
const runFrame = (stamp) => view((at) => globalThis.pinned.run(at), stamp);
const seconds = () => bar((el) => Number(el.dataset.seconds));

before(async () => {
  session = await openPlanner({ hash: '#movement', theme: 'light', width: 1440, height: 900 });
  page = session.page;
  await settled();
});

after(async () => {
  if (session) await session.close();
});

test('nothing is on the map until playback is started, and the bar says how to start', async () => {
  assert.equal(await bar((el) => el.playback.mark.drawn.size), 0);
  assert.equal(await bar((el) => el.dataset.started), 'false');
  assert.equal(await part('note'), 'Playback walks one transition at a time. Press Play for the first, or choose one above.');
  assert.equal(await page.$eval('[data-control="scrubber"]', (el) => el.disabled), true, 'the scrubber waits for a transition');
  assert.equal(await page.$eval('[data-action="previous"]', (el) => el.getAttribute('aria-disabled')), 'true');
  // every control of spec 8.1 is there, the four of More behind its button
  for (const selector of ['[data-action="play"]', '[data-action="previous"]', '[data-action="next"]', '[data-control="scrubber"]', '[data-control="speed"]', '[data-control="loop"]', '[data-part="clock"]', '[data-part="countdown"]', '[data-action="more"]']) {
    assert.equal(await page.$$eval('[data-bar="playback"] ' + selector, (found) => found.length), 1, selector);
  }
  assert.deepEqual(await page.$$eval('[data-control="speed"] option', (found) => found.map((each) => each.textContent)), ['0.5×', '1×', '2×', '4×']);
  assert.equal(await page.$eval('[data-part="more"]', (el) => el.hidden), true);
  await page.click('[data-action="more"]');
  assert.equal(await page.$eval('[data-action="more"]', (el) => el.getAttribute('aria-expanded')), 'true');
  for (const key of ['pace', 'style', 'size', 'order']) {
    assert.equal(await page.$$eval('[data-part="more"] [data-control="' + key + '"] input[type="radio"]', (found) => found.length), 2, key);
  }
  await page.click('[data-action="more"]');
});

test('scrubbing to a second puts a group’s marker on the cell the crowd results name', async () => {
  await change({ transition: TRANSITION });
  const walk = await walkOf(LATE_GROUP);
  assert.equal(walk.total, 261, 'the sample school’s long walk');
  assert.equal(await page.$eval('[data-control="scrubber"]', (el) => el.max), '261', 'the scrubber runs to the last group’s arrival');

  // a second on which the head has just stepped onto a corridor cell
  let tick = 40;
  while (!(walk.positions[tick] !== walk.positions[tick - 1] && walk.cells[walk.positions[tick]] && walk.cells[walk.positions[tick - 1]])) tick += 1;
  const place = walk.cells[walk.positions[tick]];
  const expected = await mapPoint(place.floorId, place.cell);
  assert.ok(expected, 'the cell is on the map');

  assert.equal(await bar((el) => el.playback.mark.drawn.size), 0, 'a transition is chosen and nothing is played yet: no marker');

  // the second before, the head is still on the cell behind and its marker is
  // part of the way over: not yet on the middle of this one
  const behind = walk.cells[walk.positions[tick - 1]];
  const from = await mapPoint(behind.floorId, behind.cell);
  await scrubTo(tick - 1);
  const early = await drawn(LATE_GROUP);
  const gap = Math.hypot(expected.x - from.x, expected.y - from.y);
  assert.ok(Math.hypot(early.x - expected.x, early.y - expected.y) > gap * 0.2, 'a second early the marker is short of the cell: ' + JSON.stringify([from, early, expected]));
  assert.ok(Math.hypot(early.x - from.x, early.y - from.y) < gap, 'and no farther than it: ' + JSON.stringify([from, early, expected]));

  await scrubTo(tick);
  assert.equal(await seconds(), tick);
  assert.equal(await bar((el) => el.dataset.started), 'true');
  const marker = await drawn(LATE_GROUP);
  close(marker, expected, 0.01, 'the marker at second ' + tick);
  assert.equal(marker.state, 'walking');
  assert.equal(marker.late, false);
  // and it is on the canvas there, in the group's colour
  const seen = await pixel(marker.x, marker.y);
  const wanted = rgb(LATE_COLOUR);
  assert.ok(seen.every((value, index) => Math.abs(value - wanted[index]) <= 12), 'the pixel under the marker is ' + seen + ', the group is ' + wanted);

  // the clock is the time of day, to the second, and the countdown runs to the bell
  const bell = await view(() => document.querySelector('.mov').movement.picture.transition.from);
  const [hours, minutes] = bell.split(':').map(Number);
  const total = hours * 3600 + minutes * 60 + tick;
  const hour = Math.floor(total / 3600) % 12 === 0 ? 12 : Math.floor(total / 3600) % 12;
  assert.equal(await part('clock'), hour + ':' + String(Math.floor(total / 60) % 60).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0'));
  const left = walk.passing - tick;
  assert.equal(await part('countdown'), Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0') + ' to the bell');

  // the keyboard's way: an arrow key on the scrubber is one second
  await page.focus('[data-control="scrubber"]');
  await page.keyboard.press('ArrowRight');
  await frame();
  assert.equal(await seconds(), tick + 1);
  assert.match(await page.$eval('[data-control="scrubber"]', (el) => el.getAttribute('aria-valuetext')), /into Period 6 to Period 7, \d:\d\d to the bell$/);
});

test('on the stairs a marker leaves one end of the link and arrives at the other', async () => {
  const walk = await walkOf(LATE_GROUP);
  // the first run of stairs indexes on the path, and the cells either side
  const first = walk.cells.findIndex((cell) => cell === null);
  let last = first;
  while (walk.cells[last + 1] === null) last += 1;
  const a = walk.cells[first - 1];
  const b = walk.cells[last + 1];
  assert.notEqual(a.floorId, b.floorId, 'the connection changes floor');
  const endA = await mapPoint(a.floorId, a.cell);
  const endB = await mapPoint(b.floorId, b.cell);

  await scrubTo(walk.positions.indexOf(first - 1));
  close(await drawn(LATE_GROUP), endA, 0.01, 'stepping onto the stairs cell');
  await scrubTo(walk.positions.indexOf(first));
  const on = await drawn(LATE_GROUP);
  assert.equal(on.state, 'stairs');
  const along = Math.hypot(endB.x - endA.x, endB.y - endA.y);
  assert.ok(Math.hypot(on.x - endA.x, on.y - endA.y) > 2 && Math.hypot(on.x - endB.x, on.y - endB.y) > 2 && Math.hypot(on.x - endA.x, on.y - endA.y) < along, 'between the two ends: ' + JSON.stringify([endA, on, endB]));
  await scrubTo(walk.positions.indexOf(last + 1));
  const off = await drawn(LATE_GROUP);
  close(off, endB, 0.01, 'stepping off at the other end');
  assert.equal(off.state, 'walking');
});

test('playing advances the clock by the frames’ time, and a group still walking after the bell is late', async () => {
  await pinFrames();
  await page.select('[data-control="speed"]', '4');
  await page.click('[data-action="more"]');
  await page.click('[data-control="pace"] input[value="real"]');
  await bar((el) => el.playback.seek(236));
  await frame();
  assert.equal(await bar((el) => el.dataset.late), '0');
  assert.equal(await part('late'), null);

  await page.click('[data-action="play"]');
  assert.equal(await bar((el) => el.dataset.playing), 'true');
  assert.equal(await page.$eval('[data-action="play"]', (el) => el.textContent), 'Pause');
  // the first frame only starts the clock; then three frames half a second apart at 4×
  for (const stamp of [1000, 1500, 2000, 2500]) assert.equal(await runFrame(stamp), true, 'a frame was asked for');
  assert.equal(await seconds(), 242);
  // a slow machine: one frame 900 ms later is 3.6 seconds, not one frame's worth
  await runFrame(3400);
  assert.equal(await seconds(), 245.6);
  await frame();

  assert.equal(await part('countdown'), '0:05 after the bell');
  assert.equal(await page.$eval('[data-part="countdown"]', (el) => el.dataset.over), 'true');
  assert.equal(await bar((el) => el.dataset.late), '1');
  assert.equal(await part('late'), 'Late, still walking after the passing time: 8A.');
  let marker = await drawn(LATE_GROUP);
  assert.equal(marker.late, true, 'the marker is drawn late');
  assert.equal(marker.state, 'walking');
  // every other group on screen is in its room, and not late
  const others = await bar((el) => Array.from(el.playback.mark.drawn).filter(([id]) => id !== 'gsample08a').map(([, each]) => each));
  assert.ok(others.length > 0 && others.every((each) => each.state === 'arrived' && each.late === false), JSON.stringify(others));

  // the card of the cell it is on says who is there now, and that it is late
  await page.click('[data-action="play"]');
  assert.equal(await bar((el) => el.dataset.playing), 'false');
  // (brought to the middle of the map first, out from under the legend)
  const walk = await walkOf(LATE_GROUP);
  const under = walk.cells[walk.positions[245]];
  await view((floor, cell) => document.querySelector('.mov').movement.env.show(floor, [cell]), under.floorId, under.cell);
  await frame();
  marker = await drawn(LATE_GROUP);
  const box = await page.$eval('#movement-plan', (el) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.left, y: rect.top };
  });
  await page.mouse.move(box.x + marker.x, box.y + marker.y);
  await page.waitForSelector('.mov-card:not([hidden]) [data-part="now"]');
  assert.match(await page.$eval('.mov-card [data-part="now"]', (el) => el.textContent), /^Here at \d+:\d\d:\d\d: 8A \(late\)\.$/);
  await page.mouse.move(box.x + 2, box.y + 2);
});

test('played once it stops at the end; the whole day goes on to the next transition', async () => {
  const end = await bar((el) => el.playback.end);
  await bar((el) => el.playback.seek(el.playback.end - 1));
  await page.click('[data-action="play"]');
  await runFrame(10000);
  await runFrame(10500);
  assert.equal(await seconds(), end);
  assert.equal(await bar((el) => el.dataset.playing), 'false');
  assert.equal(await view(() => globalThis.pinned.run(11000)), false, 'no frame is asked for once it has stopped');
  assert.equal(await page.$eval('#announcer', (el) => el.textContent), 'Period 6 to Period 7 is played to its end. Late: 8A.');

  await page.select('[data-control="loop"]', 'day');
  await bar((el) => el.playback.seek(el.playback.end - 1));
  await page.click('[data-action="play"]');
  await runFrame(20000);
  await runFrame(20500);
  assert.equal(await view(() => document.querySelector('.mov').movement.choice.transition), TRANSITION + 1);
  assert.equal(await seconds(), 0);
  assert.equal(await bar((el) => el.dataset.playing), 'true', 'and it is still playing');
  await page.click('[data-action="play"]');

  // Previous and Next are the strip's neighbours
  await page.click('[data-action="previous"]');
  await settled();
  assert.equal(await view(() => document.querySelector('.mov').movement.choice.transition), TRANSITION);
  assert.equal(await seconds(), 0, 'a transition starts at its first second');
});

test('one after another: each group has its own turn, on its own clock', async () => {
  await page.click('[data-control="order"] input[value="turns"]');
  await frame();
  const scene = await bar((el) => el.playback.scene.walkers.map((walker) => ({ id: walker.groupId, name: walker.name, span: walker.span, offset: walker.offset })));
  assert.ok(scene.length > 1);
  assert.equal(await page.$eval('[data-control="scrubber"]', (el) => el.max), String(scene.reduce((sum, each) => sum + each.span, 0)));
  const second = scene[1];
  await scrubTo(second.offset + 9);
  assert.equal(await part('turn'), second.name + ', group 2 of ' + scene.length + '.');
  assert.deepEqual(await bar((el) => Array.from(el.playback.mark.drawn.keys())), [second.id], 'one marker: the group whose turn it is');
  const walk = await walkOf(second.id);
  const place = walk.cells[walk.positions[9]];
  // on a cell, and standing on its middle when its last step was at this second
  assert.equal(await bar((el) => el.playback.now().clock), 9);
  if (place && walk.positions[9] !== walk.positions[8]) close(await drawn(second.id), await mapPoint(place.floorId, place.cell), 0.01, 'its marker nine seconds into its own walk');
  await page.click('[data-control="order"] input[value="together"]');
});

test('a change is kept in sv2:device, beside what else is there, and is back after a reload', async () => {
  await page.click('[data-control="size"] input[value="large"]');
  await page.click('[data-control="style"] input[value="route"]');
  const kept = await view(() => JSON.parse(localStorage.getItem('sv2:device')));
  assert.deepEqual(kept.playback, { speed: 4, loop: 'day', pace: 'real', style: 'route', size: 'large', order: 'together' });
  assert.equal(kept.lastSection, 'movement', 'the shell’s own key is still there');
  // the larger marker is the larger on the map
  await scrubTo(60);
  const large = await drawn(LATE_GROUP);
  await page.click('[data-control="size"] input[value="small"]');
  await frame();
  assert.ok(large.radius > (await drawn(LATE_GROUP)).radius);
  await page.click('[data-control="size"] input[value="large"]');

  await page.reload({ waitUntil: 'load' });
  await waitForSection(page, 'movement');
  await settled();
  assert.equal(await page.$eval('[data-control="speed"]', (el) => el.value), '4');
  assert.equal(await page.$eval('[data-control="loop"]', (el) => el.value), 'day');
  for (const [key, value] of [['pace', 'real'], ['style', 'route'], ['size', 'large'], ['order', 'together']]) {
    assert.equal(await page.$eval('[data-control="' + key + '"] input:checked', (el) => el.value), value, key);
  }
});

test('with reduced motion nothing plays: the scrubber is the only way to move, and the bar says so', async () => {
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
  await change({ transition: TRANSITION });
  await pinFrames();
  assert.equal(await part('note'), 'Reduced motion is on, so nothing moves by itself: move the scrubber to walk the groups.');
  assert.equal(await page.$eval('[data-action="play"]', (el) => el.getAttribute('aria-disabled')), 'true');
  assert.equal(await page.$eval('[data-control="speed"]', (el) => el.disabled), true);
  await page.click('[data-action="play"]');
  assert.equal(await bar((el) => el.dataset.playing), 'false');
  assert.equal(await view(() => globalThis.pinned.asked), 0, 'no frame was asked for');
  assert.equal(await bar((el) => el.playback.mark.drawn.size), 0);

  const walk = await walkOf(LATE_GROUP);
  await scrubTo(250);
  assert.equal(await seconds(), 250);
  const marker = await drawn(LATE_GROUP);
  assert.equal(marker.late, true);
  assert.equal(walk.positions[250] < walk.slots, true, 'still on its way at 250 seconds');

  // "All" on the strip puts the markers away
  await change({ transition: null });
  assert.equal(await bar((el) => el.playback.mark.drawn.size), 0);
  assert.equal(await part('note'), 'Playback walks one transition at a time. Choose one above, or press Next for the first.');
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
});

test('the page asked for nothing offsite and reported no error', () => {
  const problems = session.problems();
  assert.deepEqual(problems.errors, []);
  assert.deepEqual(session.offsite, []);
});
