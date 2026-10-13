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
// its room after 261 seconds, against 240 of passing time. 7B is in its room
// after 147.
//
// The cases run in order and share the page. Each one that changes the
// project (a setting, the bells) takes its change back before it ends.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, waitForSection } from './harness.mjs';

const DAY = 'dsample00a';
const TRANSITION = 5;
const LATE_GROUP = 'gsample08a';
const LATE_COLOUR = '#8c6d31';
const EARLY_GROUP = 'gsample07b';
const REFUSED_TOAST = 'This browser did not keep the playback settings: they last until the page is closed.';

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

// A change to the project, as the planner makes one, and taking it back.
async function apply(name, payload) {
  await view(async (action, given) => {
    const actions = await import(new URL('engine/actions.js', location.href).href);
    globalThis.sv2.store.apply(actions[action], given);
  }, name, payload);
  await settled();
}

async function undo() {
  await view(() => globalThis.sv2.store.undo());
  await settled();
}

// A case on a changed project: the changes are taken back when it ends,
// passed or failed, so the cases after it start from the sample school.
async function changed(changes, run) {
  let made = 0;
  try {
    for (const [name, payload] of changes) {
      await apply(name, payload);
      made += 1;
    }
    await run();
  } finally {
    for (; made > 0; made -= 1) await undo();
  }
}

// The playback settings, set as the controls set them.
async function set(patch) {
  await bar((el, next) => el.playback.set(next), patch);
  await frame();
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
function walkOf(groupId, period) {
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
    return { positions: Array.from(walker.positions), cells, slots: walker.slots, length: walker.length, total: walker.total, arrived: walker.arrived, late: walker.late, passing: crowd.passingSeconds, margin: crowd.marginSeconds, seconds: crowd.seconds, cap: crowd.cap, to: { floorId: route.to.floorId, cell: route.to.cell } };
  }, DAY, period === undefined ? TRANSITION : period, groupId);
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

// What is seen at a place of the map: the map's canvas with the markers'
// layer over it.
function pixel(x, y) {
  return view((px, py) => {
    const plan = document.querySelector('#movement-plan');
    const ratio = plan.width / plan.clientWidth;
    const both = document.createElement('canvas');
    both.width = 1;
    both.height = 1;
    const g = both.getContext('2d');
    for (const canvas of [plan, document.querySelector('[data-bar="playback"]').playback.layer]) g.drawImage(canvas, -Math.round(px * ratio), -Math.round(py * ratio));
    return Array.from(g.getImageData(0, 0, 1, 1).data.slice(0, 3));
  }, x, y);
}

// What the markers' layer alone has at a place: red, green, blue and how
// solid (0 where nothing of playback is drawn).
function layerPixel(x, y) {
  return view((px, py) => {
    const layer = document.querySelector('[data-bar="playback"]').playback.layer;
    const ratio = layer.width / layer.clientWidth;
    return Array.from(layer.getContext('2d').getImageData(Math.round(px * ratio), Math.round(py * ratio), 1, 1).data);
  }, x, y);
}

const drawnCount = () => view(() => ({ map: Number(document.querySelector('#movement-plan').dataset.drawn), layer: Number(document.querySelector('[data-bar="playback"]').playback.layer.dataset.drawn) }));

// Put the pointer on a cell of the map and wait for its card.
async function hover(floorId, cell) {
  await view((floor, at) => document.querySelector('.mov').movement.env.show(floor, [at]), floorId, cell);
  await frame();
  const at = await mapPoint(floorId, cell);
  const box = await page.$eval('#movement-plan', (el) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.left, y: rect.top };
  });
  await page.mouse.move(box.x + at.x, box.y + at.y);
  await page.waitForFunction((floor, wanted) => {
    const card = document.querySelector('.mov-card');
    return !card.hidden && card.dataset.floor === floor && card.dataset.cell === String(wanted) && card.querySelector('[data-part="now"]') !== null;
  }, { timeout: 5000 }, floorId, cell);
}

async function pointerAway() {
  const box = await page.$eval('#movement-plan', (el) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.left, y: rect.top };
  });
  await page.mouse.move(box.x + 2, box.y + 2);
  await page.waitForFunction(() => document.querySelector('.mov-card').hidden);
}

const nowLine = () => page.$eval('.mov-card [data-part="now"]', (el) => el.textContent);

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
      cancelled: 0,
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
        globalThis.pinned.cancelled += 1;
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
  assert.ok(gap > 4, 'the two cells are apart on the map: ' + gap);
  assert.ok(Math.hypot(early.x - expected.x, early.y - expected.y) > gap * 0.2, 'a second early the marker is short of the cell: ' + JSON.stringify([from, early, expected]));
  assert.ok(Math.hypot(early.x - from.x, early.y - from.y) > gap * 0.2, 'and it has left the cell behind: it is on its way, not standing there: ' + JSON.stringify([from, early, expected]));
  assert.ok(Math.hypot(early.x - from.x, early.y - from.y) < gap, 'and no farther than the cell ahead: ' + JSON.stringify([from, early, expected]));

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

  // with only the floor it leaves on the map, the far end of the link is
  // nowhere: the marker waits on the end that is shown for the stair time,
  // and is gone once it is on the other floor
  await change({ floors: a.floorId });
  const shownEnd = await mapPoint(a.floorId, a.cell);
  assert.equal(await mapPoint(b.floorId, b.cell), null, 'the other end is not on the map');
  await scrubTo(walk.positions.indexOf(first));
  const waiting = await drawn(LATE_GROUP);
  assert.equal(waiting.state, 'stairs');
  close(waiting, shownEnd, 0.01, 'on the stairs, at the end that is shown');
  await scrubTo(walk.positions.indexOf(last));
  close(await drawn(LATE_GROUP), shownEnd, 0.01, 'on the last of the stairs slots');
  await scrubTo(walk.positions.indexOf(last + 1));
  assert.equal(await drawn(LATE_GROUP), null, 'off the stairs on a floor that is not shown: no marker');
  await change({ floors: 'auto' });
  close(await drawn(LATE_GROUP), await mapPoint(b.floorId, b.cell), 0.01, 'and back on the map with its floor');
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
  assert.equal(await page.$eval('[data-part="countdown"]', (el) => el.dataset.late), 'true', 'the sample school has no margin: late from the bell');
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
  assert.match(await nowLine(), /^Here at \d+:\d\d:\d\d: 8A \(late\)\.$/);
  await pointerAway();
});

test('a group that is in its room is on no corridor cell: the card outside its door says nobody is there', async () => {
  const walk = await walkOf(EARLY_GROUP);
  assert.equal(walk.total, 147, '7B is in its room after 147 seconds');
  const door = walk.cells[walk.slots - 1];
  assert.ok(door, 'the last cell of its walk is a corridor cell');
  // the bell: 7B has been in its room for a minute and a half
  await scrubTo(240);
  assert.equal((await drawn(EARLY_GROUP)).state, 'arrived');
  await hover(door.floorId, door.cell);
  assert.equal(await nowLine(), 'Nobody is here at ' + await part('clock') + '.');
  // the second its head steps in, the column behind it is still on the cell
  await scrubTo(walk.total);
  assert.equal(await nowLine(), 'Here at ' + await part('clock') + ': 7B.');
  // and once the last of the column has followed it in, nobody is
  await scrubTo(walk.total + (walk.length - 1) * 3);
  assert.equal(await nowLine(), 'Nobody is here at ' + await part('clock') + '.');
  await pointerAway();
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
  // 8A is in its room now. It got there late: its marker keeps the late
  // shape, and the line names it under its own words, not as still walking
  const there = await drawn(LATE_GROUP);
  assert.equal(there.state, 'arrived');
  assert.equal(there.late, true);
  assert.equal(await part('late'), 'In their room, late: 8A.');
  assert.equal(await bar((el) => el.dataset.late), '0', 'nobody is still walking');
  assert.equal(await bar((el) => el.dataset.lateIn), '1');
  // a second before, it was still on its way
  await scrubTo(end - 1);
  assert.equal(await part('late'), 'Late, still walking after the passing time: 8A.');
  assert.equal(await bar((el) => el.dataset.late), '1');

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

  // from the day's last transition the whole day goes round to its first
  const lastOne = await view(() => document.querySelector('.mov').movement.picture.transitions.length - 1);
  assert.equal(lastOne, 6);
  await change({ transition: lastOne });
  assert.equal(await page.$eval('[data-action="next"]', (el) => el.getAttribute('aria-disabled')), 'true', 'there is no next transition');
  await bar((el) => el.playback.seek(el.playback.end - 1));
  await page.click('[data-action="play"]');
  await runFrame(30000);
  await runFrame(30500);
  await settled();
  assert.equal(await view(() => document.querySelector('.mov').movement.choice.transition), 0);
  assert.equal(await seconds(), 0);
  assert.equal(await bar((el) => el.dataset.playing), 'true', 'and it is still playing');
  await page.click('[data-action="play"]');
  await change({ transition: TRANSITION });
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
  assert.equal(await bar((el) => el.playback.now().clock), 9);
  // a second of its own walk on which its head has just stepped onto a
  // corridor cell: its marker stands on the middle of that cell
  const walk = await walkOf(second.id);
  const tick = walk.positions.findIndex((index, t) => t > 0 && index !== walk.positions[t - 1] && Boolean(walk.cells[index]));
  assert.ok(tick > 0, 'the second group walks a corridor: ' + JSON.stringify(walk.positions.slice(0, 12)));
  const place = walk.cells[walk.positions[tick]];
  await scrubTo(second.offset + tick);
  assert.equal(await bar((el) => el.playback.now().clock), tick);
  close(await drawn(second.id), await mapPoint(place.floorId, place.cell), 0.01, 'its marker ' + tick + ' seconds into its own walk');

  // one group on screen: its turn is the only one
  await change({ who: 'groups', groupIds: [LATE_GROUP] });
  await scrubTo(30);
  assert.equal(await part('turn'), '8A, group 1 of 1.');
  assert.equal(await page.$eval('[data-control="scrubber"]', (el) => el.max), '261');
  assert.deepEqual(await bar((el) => Array.from(el.playback.mark.drawn.keys())), [LATE_GROUP]);
  // nobody on screen: there is no turn to take, and the bar says why nothing moves
  await change({ who: 'groups', groupIds: [] });
  await scrubTo(30);
  assert.equal(await part('turn'), null);
  assert.equal(await part('note'), 'Nobody on screen walks in Period 6 to Period 7.');
  assert.equal(await bar((el) => el.playback.mark.drawn.size), 0);
  assert.equal(await page.$eval('[data-control="scrubber"]', (el) => el.max), '240', 'the scrubber is the passing time');
  assert.equal(await seconds(), 30);
  await change({ who: 'all' });
  await page.click('[data-control="order"] input[value="together"]');
});

test('the two paces are told apart: a fixed 20 seconds a transition, or the seconds the frames took', async () => {
  await pinFrames();
  await set({ speed: 1, loop: 'once', pace: 'fixed', order: 'together' });
  const end = await bar((el) => el.playback.end);
  assert.equal(end, 261);
  await bar((el) => el.playback.seek(0));
  await page.click('[data-action="play"]');
  // the first frame starts the clock; one second later, a twentieth of the transition
  await runFrame(1000);
  await runFrame(2000);
  assert.equal(await bar((el) => el.playback.seconds), end / 20);
  await page.click('[data-action="play"]');

  await set({ pace: 'real' });
  await bar((el) => el.playback.seek(0));
  await page.click('[data-action="play"]');
  await runFrame(5000);
  await runFrame(6000);
  assert.equal(await bar((el) => el.playback.seconds), 1, 'at real pace a second is a second');
  await page.click('[data-action="play"]');

  // one after another, the fixed pace is 8 seconds a group
  await set({ pace: 'fixed', order: 'turns' });
  const first = await bar((el) => el.playback.scene.walkers[0].span);
  await bar((el) => el.playback.seek(0));
  await page.click('[data-action="play"]');
  await runFrame(9000);
  await runFrame(10000);
  assert.equal(await bar((el) => el.playback.seconds), first / 8);
  await page.click('[data-action="play"]');
  await set({ order: 'together' });
});

test('the two styles are told apart: the whole route behind the marker, or only a tail', async () => {
  await change({ who: 'groups', groupIds: [LATE_GROUP] });
  const walk = await walkOf(LATE_GROUP);
  // a corridor cell early on its route, long behind it two minutes in
  const index = walk.cells.findIndex((cell, at) => at >= 3 && cell !== null && walk.cells[at - 1] !== null && walk.cells[at + 1] !== null);
  assert.ok(index >= 3 && walk.positions[120] > index + 12, 'the head is far past index ' + index + ' at 120 s: ' + walk.positions[120]);
  const at = await mapPoint(walk.cells[index].floorId, walk.cells[index].cell);
  const wanted = rgb(LATE_COLOUR);

  await set({ style: 'route' });
  await scrubTo(120);
  const route = await layerPixel(at.x, at.y);
  assert.ok(route[3] > 100, 'the route is drawn through the cell: ' + route);
  assert.ok(route.slice(0, 3).every((value, each) => Math.abs(value - wanted[each]) <= 12), 'in the group’s colour: ' + route + ' against ' + wanted);
  const seen = await pixel(at.x, at.y);

  await set({ style: 'tail' });
  assert.equal(await seconds(), 120, 'the style changes nothing about the clock');
  assert.equal((await layerPixel(at.x, at.y))[3], 0, 'a tail leaves the cell as the map has it');
  const plain = await pixel(at.x, at.y);
  assert.ok(plain.some((value, each) => Math.abs(value - seen[each]) > 12), 'and the two look different there: ' + seen + ' and ' + plain);
  // the tail itself is just behind the marker
  const marker = await drawn(LATE_GROUP);
  assert.equal((await layerPixel(marker.x, marker.y))[3], 255, 'the marker is solid');
  await change({ who: 'all' });
});

test('a frame of playback draws the markers and leaves the map as it is', async () => {
  await pinFrames();
  await set({ speed: 1, pace: 'real', loop: 'once', order: 'together' });
  await bar((el) => el.playback.seek(60));
  // the map at rest: a hotspot's rings pulse for some seconds after a change
  // of who is shown, and each beat of that paints the map
  await view(async () => {
    const plan = document.querySelector('#movement-plan');
    const twoFrames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    for (let still = 0, last = plan.dataset.drawn, tries = 0; still < 10 && tries < 900; tries += 1) {
      await twoFrames();
      still = plan.dataset.drawn === last ? still + 1 : 0;
      last = plan.dataset.drawn;
    }
  });
  const before = await drawnCount();
  const places = [await drawn(LATE_GROUP)];
  await page.click('[data-action="play"]');
  for (const stamp of [1000, 1500, 2000, 2500, 3000]) {
    await runFrame(stamp);
    await frame();
    places.push(await drawn(LATE_GROUP));
  }
  await page.click('[data-action="play"]');
  await frame();
  const after = await drawnCount();
  assert.equal(await seconds(), 62);
  assert.equal(after.map, before.map, 'the map was not painted again by ' + (after.layer - before.layer) + ' draws of the markers');
  assert.ok(after.layer - before.layer >= 5, 'each frame drew the markers: ' + JSON.stringify([before, after]));
  assert.ok(Math.hypot(places[5].x - places[0].x, places[5].y - places[0].y) > 2, 'and the marker moved: ' + JSON.stringify([places[0], places[5]]));
  // when the map itself moves, the markers go with it: with another part of
  // the building brought to the middle, the marker is on its cell where that
  // cell now is
  const walk = await walkOf(LATE_GROUP);
  const tick = walk.positions.findIndex((index, t) => t > 62 && index !== walk.positions[t - 1] && Boolean(walk.cells[index]));
  const place = walk.cells[walk.positions[tick]];
  await scrubTo(tick);
  const was = await drawn(LATE_GROUP);
  await view((floor, cell) => document.querySelector('.mov').movement.env.show(floor, [cell]), walk.to.floorId, walk.to.cell);
  await frame();
  const panned = await drawnCount();
  assert.ok(panned.map > after.map, 'moving the map paints it: ' + JSON.stringify([after, panned]));
  const now = await drawn(LATE_GROUP);
  close(now, await mapPoint(place.floorId, place.cell), 0.01, 'the marker on its cell after the map moved');
  assert.ok(Math.hypot(now.x - was.x, now.y - was.y) > 1, 'which is not where it was: ' + JSON.stringify([was, now]));
  await view(() => document.querySelector('.mov').movement.fit());
  await frame();
  close(await drawn(LATE_GROUP), await mapPoint(place.floorId, place.cell), 0.01, 'and after the fit');
});

test('a change is kept in sv2:device, beside what else is there, and is back after a reload', async () => {
  await set({ speed: 4, loop: 'day', pace: 'real', style: 'tail', size: 'small', order: 'together' });
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

test('a browser that will not keep the settings is said once, and the choice holds for the visit', async () => {
  const before = await view(() => localStorage.getItem('sv2:device'));
  // this browser refuses to write the device's choices from here on
  await view(() => {
    globalThis.realSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key, value) {
      if (key === 'sv2:device') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return globalThis.realSetItem.call(this, key, value);
    };
    globalThis.toasts = [];
    globalThis.toastWatch = new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1 && node.matches('.toast')) globalThis.toasts.push(node.querySelector('.toast__text').textContent);
    });
    globalThis.toastWatch.observe(document.body, { childList: true, subtree: true });
  });
  if (await page.$eval('[data-part="more"]', (el) => el.hidden)) await page.click('[data-action="more"]');
  await page.click('[data-control="size"] input[value="small"]');
  await frame();
  assert.deepEqual(await view(() => globalThis.toasts), [REFUSED_TOAST]);
  assert.equal(await page.$eval('.toast .toast__text', (el) => el.textContent), REFUSED_TOAST);
  assert.equal(await page.$eval('[data-control="size"] input:checked', (el) => el.value), 'small', 'the choice is on screen');
  assert.equal(await bar((el) => el.playback.prefs.size), 'small');
  await change({ transition: TRANSITION });
  await scrubTo(60);
  const small = (await drawn(LATE_GROUP)).radius;
  // a second and a third choice: taken, and not said again
  await page.select('[data-control="speed"]', '2');
  await page.click('[data-control="style"] input[value="tail"]');
  await frame();
  assert.deepEqual(await view(() => globalThis.toasts), [REFUSED_TOAST], 'said once');
  assert.deepEqual(await bar((el) => el.playback.prefs), { speed: 2, loop: 'day', pace: 'real', style: 'tail', size: 'small', order: 'together' });
  assert.equal(await view(() => localStorage.getItem('sv2:device')), before, 'and nothing was written');
  await page.click('[data-control="size"] input[value="large"]');
  await frame();
  assert.ok((await drawn(LATE_GROUP)).radius > small, 'the marker follows the choice all the same');

  // the browser keeps things again: the next choice is written with the ones it refused
  await view(() => {
    Storage.prototype.setItem = globalThis.realSetItem;
    globalThis.toastWatch.disconnect();
  });
  await page.select('[data-control="loop"]', 'once');
  assert.deepEqual(await view(() => JSON.parse(localStorage.getItem('sv2:device')).playback), { speed: 2, loop: 'once', pace: 'real', style: 'tail', size: 'large', order: 'together' });
  assert.deepEqual(await view(() => globalThis.toasts), [REFUSED_TOAST]);
  await page.click('[data-action="more"]');
});

test('the countdown and the markers turn late at the same moment: the passing time and the school’s margin', async () => {
  await changed([['setSetting', { key: 'checks.passingMarginSeconds', value: 30 }], ['setSetting', { key: 'secondsPerCell', value: 4 }]], async () => {
    // a school that allows 30 seconds past the bell, and walks slowly enough
    // for 8A to be out longer than that
    await change({ transition: TRANSITION });
    const walk = await walkOf(LATE_GROUP);
    assert.equal(walk.passing, 240);
    assert.equal(walk.margin, 30);
    assert.ok(walk.total > 280, '8A is still walking 40 seconds after the bell: ' + walk.total);
    const problem = await view(() => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--problem)';
      document.querySelector('[data-bar="playback"]').append(probe);
      const colour = getComputedStyle(probe).color;
      probe.remove();
      return colour;
    });
    const countdown = () => page.$eval('[data-part="countdown"]', (el) => ({ text: el.textContent, over: el.dataset.over, late: el.dataset.late, colour: getComputedStyle(el).color }));

    // five seconds after the bell: the words say so, in plain ink, and nobody is late
    await scrubTo(245);
    let read = await countdown();
    assert.equal(read.text, '0:05 after the bell');
    assert.equal(read.over, 'true');
    assert.equal(read.late, 'false');
    assert.notEqual(read.colour, problem, 'the countdown is not in the problem colour inside the margin');
    assert.equal((await drawn(LATE_GROUP)).late, false);
    assert.equal(await part('late'), null);
    assert.equal(await bar((el) => el.dataset.late), '0');
    // the last second of the margin
    await scrubTo(270);
    read = await countdown();
    assert.equal(read.text, '0:30 after the bell');
    assert.equal(read.late, 'false');
    assert.equal((await drawn(LATE_GROUP)).late, false);
    // and the first second past it: both at once
    await scrubTo(271);
    read = await countdown();
    assert.equal(read.text, '0:31 after the bell');
    assert.equal(read.late, 'true');
    assert.equal(read.colour, problem);
    assert.equal((await drawn(LATE_GROUP)).late, true);
    assert.equal(await part('late'), 'Late, still walking after the passing time: 8A.');
    assert.equal(await bar((el) => el.dataset.late), '1');
  });
  assert.equal((await walkOf(LATE_GROUP)).total, 261, 'the sample school is as it was');
});

test('a group stopped at the cap: the scrubber ends there and its marker stands where it was stopped', async () => {
  await changed([['setSetting', { key: 'secondsPerCell', value: 10 }]], async () => {
    // ten seconds a cell: 8A's walk is longer than three passing times
    await change({ transition: TRANSITION });
    const walk = await walkOf(LATE_GROUP);
    assert.equal(walk.arrived, false, '8A does not arrive');
    assert.equal(walk.cap, 720);
    assert.equal(walk.total, walk.cap);
    assert.equal(walk.positions.length - 1, walk.seconds);
    assert.equal(await page.$eval('[data-control="scrubber"]', (el) => el.max), String(walk.seconds), 'the scrubber runs to the transition’s last tick');
    assert.equal(await bar((el) => el.playback.end), walk.seconds);
    // where it was stopped: the last cell its head took, still short of its room
    const stopped = walk.positions[walk.seconds];
    assert.ok(stopped < walk.slots && walk.cells[stopped], 'stopped on a corridor cell, index ' + stopped + ' of ' + walk.slots);
    const lastStep = walk.positions.indexOf(stopped);
    await scrubTo(walk.seconds);
    const marker = await drawn(LATE_GROUP);
    close(marker, await mapPoint(walk.cells[stopped].floorId, walk.cells[stopped].cell), 0.01, 'the marker at the cap');
    assert.equal(marker.state, 'walking');
    assert.equal(marker.late, true);
    assert.match(await part('late'), /^Late, still walking after the passing time: (.+, )?8A[,.]/);
    // it has stood there since its last step, and playing on does not move it
    await scrubTo(lastStep);
    close(await drawn(LATE_GROUP), marker, 0.01, 'the marker at its last step, second ' + lastStep);
    await pinFrames();
    await set({ speed: 4, pace: 'real', loop: 'once', order: 'together' });
    await bar((el) => el.playback.seek(el.playback.end - 2));
    await page.click('[data-action="play"]');
    for (const stamp of [1000, 1900, 2800]) await runFrame(stamp);
    await frame();
    assert.equal(await seconds(), walk.seconds);
    assert.equal(await bar((el) => el.dataset.playing), 'false');
    close(await drawn(LATE_GROUP), marker, 0.01, 'the marker at the end');
  });
  assert.equal((await walkOf(LATE_GROUP)).total, 261);
});

test('bells not entered: the clock counts the seconds, and the countdown is the passing time', async () => {
  await changed([['setBells', { dayTypeId: DAY, bells: new Array(8).fill(null) }]], async () => {
    await change({ transition: TRANSITION });
    assert.equal(await view(() => document.querySelector('.mov').movement.picture.transition.times), '');
    await scrubTo(37);
    assert.equal(await part('clock'), '0:37');
    assert.equal(await part('countdown'), '3:23 of the passing time left');
    assert.equal(await page.$eval('[data-control="scrubber"]', (el) => el.getAttribute('aria-valuetext')), '0:37 into Period 6 to Period 7, 3:23 of the passing time left');
    await scrubTo(240);
    assert.equal(await part('countdown'), '0:00 of the passing time left');
    await scrubTo(245);
    assert.equal(await part('clock'), '4:05');
    assert.equal(await part('countdown'), '0:05 over the passing time');
  });
  assert.match(await view(() => document.querySelector('.mov').movement.picture.transitions[5].times), /^\d+:\d\d to \d+:\d\d$/);
});

test('a day of two periods has one transition: the whole day plays it round', async () => {
  await changed([['setSetting', { key: 'periods', value: 2 }]], async () => {
    assert.equal(await view(() => document.querySelector('.mov').movement.picture.transitions.length), 1);
    await pinFrames();
    await set({ speed: 4, pace: 'real', loop: 'day', order: 'together' });
    await change({ transition: 0 });
    assert.equal(await page.$eval('[data-action="next"]', (el) => el.getAttribute('aria-disabled')), 'true');
    assert.equal(await page.$eval('[data-action="previous"]', (el) => el.getAttribute('aria-disabled')), 'true');
    const end = await bar((el) => el.playback.end);
    await bar((el) => el.playback.seek(el.playback.end - 1));
    await page.click('[data-action="play"]');
    await runFrame(1000);
    await runFrame(1500);
    assert.equal(await seconds(), 0, 'from its first second again');
    assert.equal(await view(() => document.querySelector('.mov').movement.choice.transition), 0);
    assert.equal(await bar((el) => el.dataset.playing), 'true', 'and still playing');
    await runFrame(2000);
    assert.equal(await seconds(), 2);
    assert.equal(await bar((el) => el.playback.end), end);
    await page.click('[data-action="play"]');
  });
  assert.equal(await view(() => document.querySelector('.mov').movement.picture.transitions.length), 7);
});

test('a day of one period has nothing to play, and a button’s title is only ever why it cannot be pressed now', async () => {
  await changed([['setSetting', { key: 'periods', value: 1 }]], async () => {
    assert.equal(await part('note'), 'There is nothing to play: the day has one period.');
    assert.equal(await page.$eval('[data-action="play"]', (el) => el.getAttribute('aria-disabled')), 'true');
    assert.equal(await page.$eval('[data-action="play"]', (el) => el.getAttribute('title')), null);
    assert.equal(await page.$eval('[data-action="next"]', (el) => el.getAttribute('aria-disabled')), 'true');
    assert.equal(await page.$eval('[data-control="scrubber"]', (el) => el.disabled), true);
    assert.equal(await part('clock'), '');
    await page.click('[data-action="play"]');
    assert.equal(await bar((el) => el.dataset.playing), 'false');
    assert.equal(await bar((el) => el.playback.mark.drawn.size), 0);

    // with reduced motion asked for, Play says so in its title; when it is no
    // longer asked for, Play still cannot be pressed (one period) and the title
    // about reduced motion is gone
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.waitForFunction(() => document.querySelector('[data-bar="playback"]').dataset.reduced === 'true');
    assert.equal(await page.$eval('[data-action="play"]', (el) => el.getAttribute('title')), 'Reduced motion is on: use the scrubber.');
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await page.waitForFunction(() => document.querySelector('[data-bar="playback"]').dataset.reduced === 'false');
    assert.equal(await page.$eval('[data-action="play"]', (el) => el.getAttribute('aria-disabled')), 'true');
    assert.equal(await page.$eval('[data-action="play"]', (el) => el.getAttribute('title')), null, 'a title left from reduced motion');
  });
  assert.equal(await page.$eval('[data-action="play"]', (el) => el.getAttribute('aria-disabled')), null);
  assert.equal(await page.$eval('[data-action="play"]', (el) => el.getAttribute('title')), null);
});

test('with reduced motion nothing plays: the scrubber is the only way to move, and the bar says so', async () => {
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
  await change({ transition: TRANSITION });
  await pinFrames();
  assert.equal(await part('note'), 'Reduced motion is on, so nothing moves by itself: move the scrubber to walk the groups.');
  assert.equal(await page.$eval('[data-action="play"]', (el) => el.getAttribute('aria-disabled')), 'true');
  assert.equal(await page.$eval('[data-action="play"]', (el) => el.getAttribute('title')), 'Reduced motion is on: use the scrubber.');
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
  // how to start is said until playback has been started once on this device (test/browser/m3-pass.mjs); it has been, above
  assert.equal(await part('note'), null);
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.waitForFunction(() => document.querySelector('[data-bar="playback"]').dataset.reduced === 'false');
  assert.equal(await page.$eval('[data-action="play"]', (el) => el.getAttribute('aria-disabled')), null);
  assert.equal(await page.$eval('[data-action="play"]', (el) => el.getAttribute('title')), null, 'and Play has no title once it can be pressed');
});

// ---------------------------------------------------------------- SV2-43: the review of SV2-44

test('44a: a setting written in one tab does not undo another tab’s: a write is the change, over what is stored', async () => {
  await set({ speed: 1, loop: 'once', pace: 'fixed', style: 'tail', size: 'small', order: 'together' });
  // a second tab that has read the same settings
  const other = await openPlanner({ server: session.server, browser: session.browser, hash: '#movement', keep: true, theme: 'light', width: 1440, height: 900 });
  try {
    await other.page.waitForFunction(() => Boolean(document.querySelector('[data-bar="playback"]')?.playback));
    assert.deepEqual(await other.page.$eval('[data-bar="playback"]', (el) => el.playback.prefs), { speed: 1, loop: 'once', pace: 'fixed', style: 'tail', size: 'small', order: 'together' });
    // this tab changes the marker's size; the other, which read before that, the speed
    await set({ size: 'large' });
    await other.page.$eval('[data-bar="playback"]', (el) => el.playback.set({ speed: 4 }));
    assert.deepEqual(await view(() => JSON.parse(localStorage.getItem('sv2:device')).playback), { speed: 4, loop: 'once', pace: 'fixed', style: 'tail', size: 'large', order: 'together' });
    // and back the other way: this tab's next change keeps the other's speed
    await set({ loop: 'day' });
    assert.deepEqual(await view(() => JSON.parse(localStorage.getItem('sv2:device')).playback), { speed: 4, loop: 'day', pace: 'fixed', style: 'tail', size: 'large', order: 'together' });
    // a choice of what the tab already shows writes nothing
    const writes = await view(() => {
      const real = Storage.prototype.setItem;
      let count = 0;
      Storage.prototype.setItem = function setItem(key, value) {
        if (key === 'sv2:device') count += 1;
        return real.call(this, key, value);
      };
      document.querySelector('[data-bar="playback"]').playback.set({ loop: 'day' });
      document.querySelector('[data-bar="playback"]').playback.set({ loop: 'transition' });
      Storage.prototype.setItem = real;
      return count;
    });
    assert.equal(writes, 1);
  } finally {
    await other.page.close();
  }
  await set({ speed: 1, loop: 'once', size: 'small' });
});

test('44b: a group stopped at the cap is late in playback whatever the margin, as the crowd model has it', async () => {
  await changed([['setSetting', { key: 'secondsPerCell', value: 10 }], ['setSetting', { key: 'checks.passingMarginSeconds', value: 480 }]], async () => {
    await change({ transition: TRANSITION });
    const walk = await walkOf(LATE_GROUP);
    assert.deepEqual([walk.arrived, walk.late, walk.cap, walk.passing, walk.margin], [false, true, 720, 240, 480], 'stopped at 720 s, which is the passing time and the margin exactly: not "more than" them');
    await scrubTo(walk.seconds);
    assert.equal((await drawn(LATE_GROUP)).late, true, 'the marker of a group that never arrives is late once it is stopped');
    assert.match(await part('late'), /^Late, still walking after the passing time: (.+, )?8A[,.]/);
    assert.equal(await page.$eval('[data-part="countdown"]', (el) => el.dataset.late), 'true');
    assert.equal(await bar((el) => el.dataset.late !== '0'), true);
    // a second before it is stopped it is inside the margin, like anyone
    await scrubTo(walk.seconds - 1);
    assert.equal((await drawn(LATE_GROUP)).late, false);
  });
});

// The boxes of the map's canvas and of the marks' canvas over it.
const canvases = () => view(() => {
  const plan = document.querySelector('#movement-plan');
  const marks = document.querySelector('.mov-marks');
  const box = (el) => {
    const rect = el.getBoundingClientRect();
    return [rect.left, rect.top, rect.width, rect.height];
  };
  return { ratio: devicePixelRatio, plan: [plan.width, plan.height], marks: [marks.width, marks.height], planBox: box(plan), marksBox: box(marks), stage: [document.querySelector('.mov-stage').clientWidth, document.querySelector('.mov-stage').clientHeight] };
});

// The map has been drawn at the size the stage has now, at this pixel ratio.
const sized = (ratio) => page.waitForFunction((wanted) => {
  const movement = document.querySelector('.mov').movement;
  const stage = document.querySelector('.mov-stage');
  const plan = document.querySelector('#movement-plan');
  return devicePixelRatio === wanted && plan.dataset.ratio === String(wanted) && movement.view.width === stage.clientWidth && movement.view.height === stage.clientHeight && plan.width === Math.round(stage.clientWidth * wanted);
}, { timeout: 8000 }, ratio);

test('44e: the marks’ canvas is the map’s, box for box and pixel for pixel: at a device pixel ratio of 2, after the window changes, and with the floors stacked', async () => {
  await change({ transition: TRANSITION });
  await set({ size: 'large', style: 'tail' });
  try {
    for (const [what, act] of [
      ['at a ratio of 2', () => page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 })],
      ['after the window changed', () => page.setViewport({ width: 1180, height: 760, deviceScaleFactor: 2 })],
      ['stacked', () => change({ floors: 'stacked' })],
    ]) {
      await act();
      await sized(2);
      await scrubTo(100);
      const at = await canvases();
      assert.equal(at.ratio, 2);
      assert.deepEqual(at.marks, at.plan, what + ': the marks’ canvas has other pixels than the map’s');
      assert.deepEqual(at.marks, [at.stage[0] * 2, at.stage[1] * 2], what + ': not two pixels a CSS pixel');
      assert.deepEqual(at.marksBox, at.planBox, what + ': the marks’ canvas is not the map’s box');
      // a marker is on its own cell's pixels, not on half or twice the way there
      const walk = await walkOf(LATE_GROUP);
      const cell = walk.cells[walk.positions[100]];
      const marker = await drawn(LATE_GROUP);
      close(marker, await mapPoint(cell.floorId, cell.cell), 40, what);
      assert.ok((await layerPixel(marker.x, marker.y))[3] > 200, what + ': nothing is drawn where the marker is said to be');
    }
  } finally {
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await change({ floors: 'auto', transition: TRANSITION });
    await sized(1);
    await set({ size: 'small' });
  }
});

test('44f: the marks have one canvas, the view’s own: a paint of the map, a frame of playback and a tick of the pulse move nothing in the document', async () => {
  assert.deepEqual(await view(() => Array.from(document.querySelectorAll('.mov-stage canvas')).map((canvas) => canvas.id || canvas.className)), ['movement-plan', 'mov-marks']);
  assert.equal(await view(() => document.querySelector('.mov-marks').previousElementSibling.id), 'movement-plan');
  assert.equal(await view(() => document.querySelectorAll('.mov-pb__layer, .mov-rings').length), 0);
  await view(() => {
    globalThis.stageMoves = [];
    globalThis.stageWatch = new MutationObserver((records) => {
      for (const record of records) globalThis.stageMoves.push(Array.from(record.addedNodes).concat(Array.from(record.removedNodes)).map((node) => node.className || node.nodeName).join(','));
    });
    globalThis.stageWatch.observe(document.querySelector('.mov-stage'), { childList: true });
  });
  const before = await drawnCount();
  // a new transition: the map is painted, and the rings set out
  await change({ transition: 2 });
  await page.waitForFunction(() => document.querySelector('.mov').movement.env.marks.some((mark) => mark.id === 'hotspots') && document.querySelector('#inspector [data-panel="hotspots"]')?.dataset.pulse === 'moving', { timeout: 5000 });
  await scrubTo(40);
  await pinFrames();
  await page.click('[data-action="play"]');
  for (const stamp of [1000, 1100, 1200]) await runFrame(stamp);
  await page.click('[data-action="play"]');
  // three ticks of the pulse and more
  const ticks = await view(() => document.querySelector('#inspector [data-panel="hotspots"]').hotspots.frames);
  await page.waitForFunction((had) => document.querySelector('#inspector [data-panel="hotspots"]').hotspots.frames >= had + 3, { timeout: 5000 }, ticks);
  const after = await drawnCount();
  assert.ok(after.map > before.map && after.layer >= before.layer + 6, 'the map and the marks were drawn: ' + JSON.stringify([before, after]));
  assert.deepEqual(await view(() => {
    globalThis.stageWatch.disconnect();
    return globalThis.stageMoves.concat(globalThis.stageWatch.takeRecords().map(() => 'late'));
  }), [], 'a canvas was put into the stage, or taken out of it');
  await change({ transition: TRANSITION });
});

test('44g: the hotspot rings and the keyboard cursor are drawn over the markers, whatever order the marks were added in; set(null) changes nothing', async () => {
  await change({ transition: TRANSITION });
  // the order the marks are drawn in is their `order`, not their place in the list
  const called = await view(() => {
    const env = document.querySelector('.mov').movement.env;
    const original = env.marks.slice();
    const seen = [];
    env.marks.splice(0, env.marks.length, ...original.slice().reverse().map((mark) => {
      const told = (g, map) => {
        seen.push(mark.id);
        return mark(g, map);
      };
      told.id = mark.id;
      told.order = mark.order;
      return told;
    }));
    env.paintMarks();
    env.marks.splice(0, env.marks.length, ...original);
    env.paintMarks();
    return { seen, listed: original.map((mark) => mark.id) };
  });
  assert.deepEqual(called.seen, ['playback', 'hotspots'], 'the marks as listed: ' + called.listed);

  // the cursor over a marker: zoomed far out, the ring of the cursor is 14 px and a large late marker reaches under its line
  await set({ size: 'large', style: 'tail', pace: 'real', order: 'together' });
  await scrubTo(250);
  try {
    const seen = await view(async (group) => {
      const movement = document.querySelector('.mov').movement;
      movement.view.zoomAbout(0.25, movement.view.width / 2, movement.view.height / 2);
      movement.env.paint();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const marker = document.querySelector('[data-bar="playback"]').playback.mark.drawn.get(group);
      const cell = movement.view.toCell(marker.x, marker.y);
      movement.canvas.focus();
      movement.cursor.moveTo(Math.floor(cell.x), Math.floor(cell.y), true);
      movement.env.paintMarks();
      const layer = movement.env.layer;
      // the cursor is one of the marks: without it there is nothing over the marker to read
      if (layer.dataset.cursor === undefined) return { marker, cursor: null };
      const [x, y, side] = layer.dataset.cursor.split(',').map(Number);
      const g = layer.getContext('2d');
      const at = (px, py) => Array.from(g.getImageData(Math.round(px), Math.round(py), 1, 1).data);
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      // the middle of the ring's left line, and of its top line
      return { marker, cursor: { x, y, side }, left: at(x + 1, y + side / 2), top: at(x + side / 2, y + 1), accent, size: movement.view.size };
    }, LATE_GROUP);
    assert.ok(seen.cursor, 'the keyboard cursor was not drawn with the marks');
    assert.equal(seen.marker.late, true, 'a late marker, the widest there is');
    assert.equal(seen.cursor.side, 14, 'at 25 % a cell is ' + seen.size + ' px and the cursor’s ring is 14');
    assert.ok(Math.abs(seen.marker.x - (seen.cursor.x + 7)) <= seen.size / 2 + 0.5 && Math.abs(seen.marker.y - (seen.cursor.y + 7)) <= seen.size / 2 + 0.5, 'the cursor is on the marker’s cell: ' + JSON.stringify(seen));
    assert.ok(seen.marker.radius * 1.25 >= 6, 'the marker reaches under the ring’s line: radius ' + seen.marker.radius);
    for (const [name, got] of [['left', seen.left], ['top', seen.top]]) {
      assert.ok(Math.abs(got[0] - rgb(seen.accent)[0]) <= 12 && Math.abs(got[1] - rgb(seen.accent)[1]) <= 12 && Math.abs(got[2] - rgb(seen.accent)[2]) <= 12 && got[3] === 255, 'the ring’s ' + name + ' line is not in the focus colour over the marker: ' + got + ' against ' + seen.accent);
    }
  } finally {
    await view(() => {
      const movement = document.querySelector('.mov').movement;
      movement.canvas.blur();
      movement.fit();
    });
    await frame();
  }

  // a patch that is nothing is no change, and no error
  const prefs = await bar((el) => el.playback.prefs);
  await bar((el) => {
    el.playback.set(null);
    el.playback.set(undefined);
    el.playback.set('fast');
    el.playback.set([]);
  });
  assert.deepEqual(await bar((el) => el.playback.prefs), prefs);
  await set({ size: 'small' });
});

test('a card the reader tapped open is put beside its cell again once playback’s line is in it, and stays on its cell when the whole day goes on to the next transition', async () => {
  await change({ transition: TRANSITION });
  await pinFrames();
  await set({ speed: 1, pace: 'real', loop: 'day', order: 'together', style: 'tail', size: 'small' });
  await pointerAway().catch(() => {});
  const cell = (await walkOf(EARLY_GROUP)).cells[0];
  // the cell near the foot of the map, so that its card has to stand above it
  await view((floor, at) => {
    const movement = document.querySelector('.mov').movement;
    movement.fit();
    movement.env.show(floor, [at]);
    movement.view.panBy(0, movement.view.height / 2 - 40);
    movement.env.paint();
  }, cell.floorId, cell.cell);
  await frame();
  const middle = await mapPoint(cell.floorId, cell.cell);
  const plan = await page.$eval('#movement-plan', (el) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.left, y: rect.top };
  });
  // playback is started, so a card that comes up is given its line of who is here a moment after it is shown
  await scrubTo(30);
  const cardBox = () => view(() => {
    const card = document.querySelector('.mov-card').getBoundingClientRect();
    const stage = document.querySelector('.mov-stage').getBoundingClientRect();
    return { top: card.top - stage.top, bottom: card.bottom - stage.top, height: card.height, size: document.querySelector('.mov').movement.view.size };
  });
  // the pointer comes onto the cell: the card, then playback's line in it, which makes it a line taller
  await page.mouse.move(plan.x + middle.x, plan.y + middle.y);
  await page.waitForFunction((floor, wanted) => {
    const card = document.querySelector('.mov-card');
    return !card.hidden && card.dataset.floor === floor && card.dataset.cell === String(wanted) && card.querySelector('[data-part="now"]') !== null;
  }, { timeout: 5000 }, cell.floorId, cell.cell);
  const hovered = await cardBox();
  // above the cell, its foot 10 px over the cell's top edge: not hanging down over the cell it is about
  assert.ok(Math.abs(hovered.bottom - (middle.y - hovered.size / 2 - 10)) <= 1.5, 'the card was left where it stood before playback’s line made it taller: ' + JSON.stringify({ hovered, cellTop: middle.y - hovered.size / 2 }));
  assert.ok(hovered.top >= 8, 'the card runs out of the top of the map');
  // a click keeps it
  await page.mouse.click(plan.x + middle.x, plan.y + middle.y);
  await page.waitForFunction((floor, wanted) => {
    const card = document.querySelector('.mov-card');
    const point = document.querySelector('.mov').movement.point;
    return !card.hidden && card.dataset.floor === floor && card.dataset.cell === String(wanted) && point !== null && point.source === 'tap';
  }, { timeout: 5000 }, cell.floorId, cell.cell);
  const placed = await cardBox();
  assert.ok(Math.abs(placed.bottom - (middle.y - placed.size / 2 - 10)) <= 1.5, JSON.stringify({ placed, cellTop: middle.y - placed.size / 2 }));

  // the whole day: at the transition's end playback goes on to the next, and the card is still up on its cell
  await bar((el) => el.playback.seek(el.playback.end - 1));
  await page.click('[data-action="play"]');
  // at real pace a frame a second on is a second of the walk: the last one, and one over
  for (const stamp of [40000, 41000, 42000]) await runFrame(stamp);
  await settled();
  assert.equal(await view(() => document.querySelector('.mov').movement.choice.transition), TRANSITION + 1);
  const held = await view(() => {
    const card = document.querySelector('.mov-card');
    const point = document.querySelector('.mov').movement.point;
    return { hidden: card.hidden, floor: card.dataset.floor, cell: card.dataset.cell, source: point ? point.source : null, load: card.querySelector('.mov-card__load').textContent };
  });
  assert.deepEqual([held.hidden, held.floor, held.cell, held.source], [false, cell.floorId, String(cell.cell), 'tap'], 'the card the reader was holding was put away at the end of the transition');
  assert.match(held.load, /Period 7 to Period 8\.$|^Nobody on screen crosses here\.$/, 'the card is of the transition before: ' + held.load);
  await page.click('[data-action="play"]');
  // put away as the reader does: the same cell again
  await page.mouse.click(plan.x + middle.x, plan.y + middle.y);
  await page.waitForFunction(() => document.querySelector('.mov-card').hidden);
  await pointerAway().catch(() => {});
  await view(() => document.querySelector('.mov').movement.fit());
  await set({ loop: 'once' });
  await change({ transition: TRANSITION });
});

test('44d: a frame of playback, through the clock, the bar and the marks on a real canvas: under 16 ms', async () => {
  await change({ transition: TRANSITION });
  await set({ speed: 1, pace: 'real', loop: 'transition', order: 'together', style: 'route', size: 'large' });
  await pinFrames();
  await bar((el) => el.playback.seek(0));
  await page.click('[data-action="play"]');
  const measured = await view(() => {
    const layer = document.querySelector('.mov-marks');
    const plan = document.querySelector('#movement-plan');
    const had = { layer: Number(layer.dataset.drawn), map: Number(plan.dataset.drawn) };
    const each = [];
    // 120 frames, a second of the walk apart
    for (let n = 1; n <= 120; n += 1) {
      const started = performance.now();
      globalThis.pinned.run(n * 1000);
      // the pixels are asked for, so the drawing is done inside the measure
      layer.getContext('2d').getImageData(0, 0, 1, 1);
      each.push(performance.now() - started);
    }
    each.sort((a, b) => a - b);
    return { median: each[60], worst: each[119], frames: Number(layer.dataset.drawn) - had.layer, map: Number(plan.dataset.drawn) - had.map, markers: document.querySelector('[data-bar="playback"]').playback.mark.drawn.size, seconds: Number(document.querySelector('[data-bar="playback"]').dataset.seconds) };
  });
  await page.click('[data-action="play"]');
  console.log('# playback frame in the page, ' + measured.markers + ' markers with the whole route behind: median ' + measured.median.toFixed(2) + ' ms, worst ' + measured.worst.toFixed(2) + ' ms over 120 frames (budget 16, fails at 32)');
  assert.equal(measured.frames, 120, 'each frame drew the marks once');
  assert.equal(measured.map, 0, 'and the map not at all');
  assert.equal(measured.markers, 8);
  assert.ok(measured.seconds > 100, 'the clock went on: ' + measured.seconds);
  assert.ok(measured.median < 32, 'a frame takes ' + measured.median.toFixed(2) + ' ms at the median');
  await set({ loop: 'once', style: 'tail', size: 'small' });
});

test('leaving the view stops the frames and lets go of everything the bar listened to', async () => {
  await change({ transition: TRANSITION });
  await pinFrames();
  await set({ speed: 1, pace: 'real', loop: 'once', order: 'together' });
  await scrubTo(100);
  await pointerAway().catch(() => {});
  await page.click('[data-action="play"]');
  await runFrame(1000);
  assert.equal(await bar((el) => el.dataset.playing), 'true');
  const door = (await walkOf(EARLY_GROUP)).cells[0];
  await view(() => {
    const movement = document.querySelector('.mov').movement;
    const element = document.querySelector('[data-bar="playback"]');
    globalThis.left = { bar: element, layer: element.playback.layer, card: movement.env.card.element, marks: movement.env.marks, marked: movement.env.marks.length, cancelled: globalThis.pinned.cancelled, dropped: [] };
    const real = MediaQueryList.prototype.removeEventListener;
    MediaQueryList.prototype.removeEventListener = function removeEventListener(type, listener, options) {
      globalThis.left.dropped.push(this.media + ' ' + type);
      return real.call(this, type, listener, options);
    };
  });
  assert.equal(await view(() => globalThis.left.layer.isConnected), true, 'the markers’ layer is on the map');
  await view(() => {
    location.hash = '#project';
  });
  await waitForSection(page, 'project');

  const left = await view(() => ({ connected: globalThis.left.bar.isConnected, playing: globalThis.left.bar.playback.playing, cancelled: globalThis.pinned.cancelled - globalThis.left.cancelled, layer: globalThis.left.layer.isConnected, marks: globalThis.left.marks.length - globalThis.left.marked, ids: globalThis.left.marks.map((mark) => mark.id || 'unnamed'), dropped: globalThis.left.dropped }));
  assert.equal(left.connected, false, 'the bar has left the page');
  assert.equal(left.playing, false, 'it is not playing');
  assert.equal(left.cancelled, 1, 'the frame it had asked for was cancelled as it left');
  assert.equal(await runFrame(2000), false, 'and no frame is waiting');
  assert.ok(left.dropped.includes('(prefers-reduced-motion: reduce) change'), 'the reduced-motion listener was dropped: ' + JSON.stringify(left.dropped));
  assert.equal(left.layer, false, 'the marks’ canvas went with the view');
  // 44c: the bar's own mark is off the list (and the hotspot rings', by their panel): two fewer, and neither is playback's
  assert.equal(left.marks, -2, 'the marks left on the list: ' + JSON.stringify(left.ids));
  assert.equal(left.ids.includes('playback'), false, 'the map would still call the bar when it paints');
  // the card it watched: a change to it is nobody's business any more
  const filled = await view(async (floor, cell) => {
    const card = globalThis.left.card;
    card.dataset.floor = floor;
    card.dataset.cell = String(cell);
    card.hidden = false;
    await new Promise((resolve) => setTimeout(resolve, 50));
    return card.querySelector('[data-part="now"]') !== null;
  }, door.floorId, door.cell);
  assert.equal(filled, false, 'the card’s observer was disconnected');
});

test('44g: a browser that keeps nothing is said once a visit, not once each time the view is opened', async () => {
  // the case above left the view; it said so once already, earlier in this visit
  await view(() => {
    location.hash = '#movement';
  });
  await waitForSection(page, 'movement');
  await settled();
  const said = await view(() => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key, value) {
      if (key === 'sv2:device') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return real.call(this, key, value);
    };
    const toasts = [];
    const watch = new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1 && node.matches('.toast')) toasts.push(node.querySelector('.toast__text').textContent);
    });
    watch.observe(document.body, { childList: true, subtree: true });
    const playback = document.querySelector('[data-bar="playback"]').playback;
    const was = playback.prefs.speed;
    playback.set({ speed: was === 2 ? 4 : 2 });
    const held = playback.prefs.speed;
    const records = watch.takeRecords();
    for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1 && node.matches('.toast')) toasts.push(node.querySelector('.toast__text').textContent);
    watch.disconnect();
    Storage.prototype.setItem = real;
    // the browser keeps things again: the refused choice goes with the next one
    playback.set({ speed: was });
    return { toasts, held, was, stored: JSON.parse(localStorage.getItem('sv2:device')).playback.speed };
  });
  assert.deepEqual(said.toasts, [], 'said a second time in one visit');
  assert.notEqual(said.held, said.was, 'the choice holds on screen all the same');
  assert.equal(said.stored, said.was);
});

test('the page asked for nothing offsite and reported no error', () => {
  const problems = session.problems();
  assert.deepEqual(problems.errors, []);
  assert.deepEqual(session.offsite, []);
});
