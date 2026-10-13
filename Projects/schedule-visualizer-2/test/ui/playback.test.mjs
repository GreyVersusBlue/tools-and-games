// The parts of playback that are plain functions: what the device keeps
// (storage/device.js), where a marker is at a second
// (ui/surface/overlays/markers.js) and what the bar's clock reads
// (ui/movement/playback.js).
//
//   node test/ui/playback.test.mjs
//
// Nothing here opens a page. The walks are the sample school's, worked out by
// the engines; the transition is Period 6 to Period 7 on A Days, where 7B is
// in its room after 147 seconds and 8A after 261.

import test from 'node:test';
import assert from 'node:assert/strict';

import { DEVICE_KEY, readDevice, PLAYBACK_DEFAULTS, playbackOf, playbackWith, readPlayback, writePlayback, movementOf, readMovement, writeMovement } from '../../storage/device.js';
import { trackOf, headAt, coveredBy, stairPoint, pointOn } from '../../ui/surface/overlays/markers.js';
import { drawStairLink } from '../../ui/surface/overlays/lanes.js';
import { clockText, minutesText } from '../../ui/movement/playback.js';
import { createPipeline } from '../../engine/worker.js';
import { buildGraph } from '../../engine/graph.js';
import { routingGraph } from '../../engine/routing.js';
import { routePath } from '../../engine/crowd.js';
import { school } from '../engine/helpers.mjs';

const DAY = 'dsample00a';
const TRANSITION = 5;

// A localStorage that keeps what it is given, or refuses every write.
function storageOf(device, refuse) {
  const kept = new Map();
  if (device !== undefined) kept.set(DEVICE_KEY, typeof device === 'string' ? device : JSON.stringify(device));
  return {
    writes: 0,
    getItem: (key) => (kept.has(key) ? kept.get(key) : null),
    setItem(key, value) {
      if (refuse) throw new Error('refused');
      this.writes += 1;
      kept.set(key, String(value));
    },
  };
}

const project = school();
const results = createPipeline().run(project);
const routing = routingGraph(project, buildGraph(project));
const crowd = results.crowd.days.find((day) => day.dayTypeId === DAY).transitions[TRANSITION];
const routes = results.routes.days.find((day) => day.dayTypeId === DAY);

// One group's walk in the transition: the crowd model's figures and its track.
function walkOf(name) {
  const group = project.groups.find((each) => each.name === name);
  const walker = crowd.groups.find((each) => each.groupId === group.id);
  const route = routes.groups.find((each) => each.groupId === group.id).routes[TRANSITION];
  const path = routePath(routing, route);
  return { walker, route, path, track: trackOf(routing, route, path) };
}

// The corridor and stairs cells of a track, each once.
function cellsOf(track) {
  const seen = new Map();
  for (const place of track.places) if (!place.a) seen.set(place.floorId + ':' + place.cell, place);
  return Array.from(seen.values());
}

// ------------------------------------------------- what the device keeps

// The movement view's own field (SV2-43, W1): the folded controls and the
// hint that playback has been seen.
test('movementOf: a stored value without the field, or with a malformed one, is nothing chosen and nothing played', () => {
  for (const device of [undefined, null, 'x', [], {}, { theme: 'dark', playback: { speed: 2 } }, { movement: null }, { movement: 'folded' }, { movement: [] }, { movement: { controls: 'shut', played: 'yes' } }, { movement: { controls: 1, played: 1 } }]) {
    assert.deepEqual(movementOf(device), { controls: null, played: false }, JSON.stringify(device));
  }
  assert.deepEqual(movementOf({ movement: { controls: 'folded' } }), { controls: 'folded', played: false });
  assert.deepEqual(movementOf({ movement: { controls: 'open', played: true } }), { controls: 'open', played: true });
  assert.deepEqual(readMovement(storageOf('not json')), { controls: null, played: false });
});

test('writeMovement: one field of sv2:device, the others kept, a key changed only when it is one of the choices', () => {
  const storage = storageOf({ theme: 'dark', lastSection: 'movement', playback: { speed: 2 } });
  assert.deepEqual(writeMovement({ controls: 'folded' }, storage), { controls: 'folded', played: false });
  assert.deepEqual(readDevice(storage), { theme: 'dark', lastSection: 'movement', playback: { speed: 2 }, movement: { controls: 'folded' } });
  // the other key of the field survives a write of one
  assert.deepEqual(writeMovement({ played: true }, storage), { controls: 'folded', played: true });
  assert.deepEqual(readDevice(storage).movement, { controls: 'folded', played: true });
  // what is not a choice changes nothing, and played is never taken back
  assert.deepEqual(writeMovement({ controls: 'shut', played: false }, storage), { controls: 'folded', played: true });
  assert.deepEqual(writeMovement({ controls: 'open' }, storage), { controls: 'open', played: true });
  // the storage key is the device's own: nothing else was written
  assert.deepEqual(Object.keys(readDevice(storage)).sort(), ['lastSection', 'movement', 'playback', 'theme']);
  assert.throws(() => writeMovement({ controls: 'open' }, storageOf({}, true)), /refused/);
});

test('playbackOf: a playback that is not an object is every default', () => {
  for (const playback of ['x', [], null, undefined, 4, true]) {
    assert.deepEqual(playbackOf({ playback }), { ...PLAYBACK_DEFAULTS }, JSON.stringify(playback));
  }
  assert.deepEqual(playbackOf(null), { ...PLAYBACK_DEFAULTS });
  assert.deepEqual(playbackOf('x'), { ...PLAYBACK_DEFAULTS });
});

test('readPlayback: a malformed sv2:device falls back, whole or key by key', () => {
  for (const playback of ['x', [], null]) {
    assert.deepEqual(readPlayback(storageOf({ theme: 'dark', playback })), { ...PLAYBACK_DEFAULTS }, 'playback: ' + JSON.stringify(playback));
  }
  assert.deepEqual(readPlayback(storageOf('{not json')), { ...PLAYBACK_DEFAULTS });
  assert.deepEqual(readPlayback(storageOf()), { ...PLAYBACK_DEFAULTS });
  const good = { speed: 2, loop: 'day', pace: 'real', style: 'route', size: 'large', order: 'turns' };
  assert.deepEqual(readPlayback(storageOf({ playback: good })), good);
  // each of these falls back alone: the keys beside it are kept
  for (const [key, value] of [['speed', '4'], ['speed', 3], ['loop', 'forever'], ['pace', null], ['style', ['tail']], ['size', 'huge'], ['order', 0]]) {
    assert.deepEqual(readPlayback(storageOf({ playback: { ...good, [key]: value } })), { ...good, [key]: PLAYBACK_DEFAULTS[key] }, key + ': ' + JSON.stringify(value));
  }
});

test('writePlayback: the other keys of sv2:device survive, and every playback key is written', () => {
  const storage = storageOf({ theme: 'dark', paper: { size: 'a4', orientation: 'landscape' }, lastSection: 'movement' });
  const next = writePlayback({ speed: 4 }, storage);
  assert.deepEqual(next, { ...PLAYBACK_DEFAULTS, speed: 4 });
  assert.deepEqual(readDevice(storage), { theme: 'dark', paper: { size: 'a4', orientation: 'landscape' }, lastSection: 'movement', playback: { ...PLAYBACK_DEFAULTS, speed: 4 } });
  writePlayback({ loop: 'transition', order: 'turns' }, storage);
  assert.deepEqual(readDevice(storage).playback, { ...PLAYBACK_DEFAULTS, speed: 4, loop: 'transition', order: 'turns' });
  assert.equal(readDevice(storage).theme, 'dark');
});

test('writePlayback: a key of the patch that is not one of the choices keeps what was stored, not the default', () => {
  const stored = { speed: 4, loop: 'day', pace: 'real', style: 'route', size: 'large', order: 'turns' };
  for (const [key, value] of [['speed', 3], ['speed', '2'], ['loop', 'forever'], ['pace', undefined], ['style', null], ['size', 'huge'], ['order', 1]]) {
    const storage = storageOf({ playback: stored });
    assert.deepEqual(writePlayback({ [key]: value }, storage), stored, key + ': ' + JSON.stringify(value));
    assert.deepEqual(readDevice(storage).playback, stored, key + ' as stored');
  }
  // the good key beside a bad one is still taken, and a key nobody knows is dropped
  const storage = storageOf({ playback: stored });
  assert.deepEqual(writePlayback({ speed: 3, size: 'small', colour: 'red' }, storage), { ...stored, size: 'small' });
  assert.deepEqual(playbackWith(stored, { loop: 'forever', pace: 'fixed' }), { ...stored, pace: 'fixed' });
  assert.deepEqual(playbackWith(stored, null), stored);
});

test('writePlayback: a browser that refuses the write throws, as writeDevice does', () => {
  assert.throws(() => writePlayback({ speed: 2 }, storageOf({ theme: 'dark' }, true)), /refused/);
});

// ------------------------------------------------- where the head is

test('headAt: a head that was refused stands (u = 0) until `step` seconds before it takes the next slot', () => {
  // on slot 0 at tick 1, refused twice, on slot 1 at tick 6; a step is 3 s
  const positions = Int16Array.from([-1, 0, 0, 0, 0, 0, 1, 1, 1, 2]);
  assert.deepEqual(headAt(positions, 1, 3, 10), { index: 0, u: 0 });
  assert.deepEqual(headAt(positions, 2.5, 3, 10), { index: 0, u: 0 });
  assert.deepEqual(headAt(positions, 3, 3, 10), { index: 0, u: 0 }, 'next - step itself');
  assert.equal(headAt(positions, 4, 3, 10).index, 0);
  assert.ok(Math.abs(headAt(positions, 4, 3, 10).u - 1 / 3) < 1e-9);
  assert.ok(Math.abs(headAt(positions, 5.5, 3, 10).u - 2.5 / 3) < 1e-9);
  assert.deepEqual(headAt(positions, 6, 3, 10), { index: 1, u: 0 }, 'on the middle of the cell it stepped onto');
  // out of the room it is the same rule: a head let out on the first tick is
  // already two thirds of its step along when the transition starts, and one
  // kept in its room stands there
  assert.equal(headAt(positions, 0, 3, 10).index, -1);
  assert.ok(Math.abs(headAt(positions, 0, 3, 10).u - 2 / 3) < 1e-9);
  const kept = Int16Array.from([-1, -1, -1, -1, -1, 0, 0, 0, 1]);
  assert.deepEqual(headAt(kept, 0, 3, 10), { index: -1, u: 0 });
  assert.deepEqual(headAt(kept, 2, 3, 10), { index: -1, u: 0 });
  assert.ok(Math.abs(headAt(kept, 4, 3, 10).u - 2 / 3) < 1e-9);
});

test('headAt: one tick, no tick, past the last tick, and a second that is no number', () => {
  assert.deepEqual(headAt(Int16Array.from([-1]), 0, 3, 10), { index: -1, u: 0 });
  assert.deepEqual(headAt(Int16Array.from([-1]), 40, 3, 10), { index: -1, u: 0 });
  assert.deepEqual(headAt(new Int16Array(0), 5, 3, 10), { index: -1, u: 0 });
  const positions = Int16Array.from([-1, 0, 0, 0, 1, 1, 1, 2]);
  assert.deepEqual(headAt(positions, 7, 3, 10), { index: 2, u: 0 }, 'the last tick');
  assert.deepEqual(headAt(positions, 700, 3, 10), { index: 2, u: 0 }, 'past it: where it was left');
  assert.deepEqual(headAt(positions, -4, 3, 10), headAt(positions, 0, 3, 10), 'before the first second is the first second');
  assert.deepEqual(headAt(positions, NaN, 3, 10), headAt(positions, 0, 3, 10));
  assert.equal(headAt(positions, NaN, 3, 10).index, -1);
  assert.deepEqual(headAt(positions, 6.5, 3, 10), { index: 1, u: 2.5 / 3 });
});

test('headAt: at and past `slots` the index is the crowd model’s, not the room', () => {
  // a path of 3 slots and a column of 3: the head is in the room at tick 9
  // (index 3) and the tail follows it in at tick 15 (index 5 = slots + length - 1)
  const positions = Int16Array.from([-1, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5]);
  assert.deepEqual(headAt(positions, 10, 3, 3), { index: 3, u: 0 }, 'the head in the room');
  assert.deepEqual(headAt(positions, 13, 3, 3), { index: 4, u: 0 });
  assert.deepEqual(headAt(positions, 16, 3, 3), { index: 5, u: 0 }, 'the tail in the room');
  assert.deepEqual(headAt(positions, 18, 3, 3), { index: 5, u: 0 });
  assert.equal(headAt(positions, 12, 3, 3).index, 3);
  assert.ok(headAt(positions, 12, 3, 3).u > 0.6, 'and it goes on stepping between them');
});

test('pointOn: a head at or past `slots` is placed in the room it walks to', () => {
  const { track, walker } = walkOf('7B');
  const map = { point: (floorId, cell) => ({ x: cell, y: floorId === track.to.floorId ? 1 : 0 }) };
  const room = map.point(track.to.floorId, track.to.cell);
  for (const index of [walker.slots, walker.slots + 1, walker.slots + walker.length - 1]) {
    assert.deepEqual(pointOn(track, index, 0, map), room, 'index ' + index);
    assert.deepEqual(pointOn(track, index, 0.5, map), room, 'index ' + index + ', half a step on');
  }
});

// ------------------------------------------------- the track

test('trackOf: one place an index, the stairs as a share of the way between their two ends', () => {
  const { track, path, route, walker } = walkOf('8A');
  assert.equal(track.slots, path.length);
  assert.equal(track.slots, walker.slots, 'the crowd model walked the same path');
  assert.equal(track.places.length, path.length);
  assert.deepEqual(track.from, { floorId: route.from.floorId, cell: route.from.cell });
  assert.deepEqual(track.to, { floorId: route.to.floorId, cell: route.to.cell });
  let runs = 0;
  for (let p = 0; p < path.length; p += 1) {
    const place = track.places[p];
    if (path.links[p] === -1) {
      assert.deepEqual(place, { floorId: routing.floors[routing.nodeFloor[path.nodes[p]]].id, cell: routing.nodeCell[path.nodes[p]] }, 'index ' + p);
      continue;
    }
    if (path.links[p - 1] === -1) runs += 1;
    assert.ok(place.a && place.b && place.u > 0 && place.u < 1, 'index ' + p + ' is on a connection: ' + JSON.stringify(place));
    assert.notEqual(place.a.floorId, place.b.floorId);
    if (path.links[p - 1] !== -1) assert.ok(place.u > track.places[p - 1].u, 'and further along it than the index before');
  }
  assert.equal(runs, 2, '8A climbs two connections');
});

test('trackOf: nothing to walk gives null', () => {
  const { route, path } = walkOf('8A');
  assert.equal(trackOf(null, route, path), null);
  assert.equal(trackOf(routing, null, path), null);
  assert.equal(trackOf(routing, route, null), null);
});

// ------------------------------------------------- who is on a cell

test('coveredBy: the column is on its head’s cell and the cells behind it, and nowhere else', () => {
  const { track, walker } = walkOf('8A');
  // a stretch of corridor well clear of the stairs
  let at = walker.length + 1;
  while (track.places.slice(at - walker.length, at + 2).some((place) => place.a)) at += 1;
  const head = { index: at, u: 0 };
  for (let back = 0; back < walker.length; back += 1) {
    const place = track.places[at - back];
    assert.equal(coveredBy(track, head, walker.length, place.floorId, place.cell), true, back + ' behind the head');
  }
  const behind = track.places[at - walker.length];
  const ahead = track.places[at + 1];
  assert.equal(coveredBy(track, head, walker.length, behind.floorId, behind.cell), false, 'the cell the tail has left');
  assert.equal(coveredBy(track, head, walker.length, ahead.floorId, ahead.cell), false, 'the cell ahead');
  // more than half way through its step the head counts on the cell it is stepping onto
  assert.equal(coveredBy(track, { index: at, u: 0.49 }, walker.length, ahead.floorId, ahead.cell), false);
  assert.equal(coveredBy(track, { index: at, u: 0.5 }, walker.length, ahead.floorId, ahead.cell), true);
  assert.equal(coveredBy(track, { index: at, u: 0.5 }, walker.length, track.places[at - walker.length + 1].floorId, track.places[at - walker.length + 1].cell), false, 'and its tail has left the last one');
  // another floor's cell of the same number is not this one
  assert.equal(coveredBy(track, head, walker.length, 'nowhere', track.places[at].cell), false);
});

test('coveredBy: a head still in the room it leaves covers nothing until it is half way out', () => {
  const { track, walker } = walkOf('8A');
  const first = track.places[0];
  for (const place of cellsOf(track)) assert.equal(coveredBy(track, { index: -1, u: 0 }, walker.length, place.floorId, place.cell), false);
  assert.equal(coveredBy(track, { index: -1, u: 0.49 }, walker.length, first.floorId, first.cell), false);
  assert.equal(coveredBy(track, { index: -1, u: 0.5 }, walker.length, first.floorId, first.cell), true);
});

test('coveredBy: once a group is in its room no corridor cell has it (the sample school, 240 s in)', () => {
  const step = routing.secondsPerCell;
  let checked = 0;
  for (const walker of crowd.groups) {
    if (!(walker.arrived && walker.total <= 150)) continue;
    const group = project.groups.find((each) => each.id === walker.groupId);
    const { track } = walkOf(group.name);
    const head = headAt(walker.positions, 240, step, track.slots);
    assert.equal(head.index, walker.slots + walker.length - 1, group.name + ': the head index the crowd model left it at');
    for (const place of cellsOf(track)) {
      assert.equal(coveredBy(track, head, walker.length, place.floorId, place.cell), false, group.name + ' is in its room, not on ' + JSON.stringify(place));
    }
    checked += 1;
  }
  assert.ok(checked >= 6, 'the sample school has groups in by 150 s: ' + checked);
});

test('coveredBy: while the tail follows the head in, the cell outside the door is still the column’s', () => {
  const step = routing.secondsPerCell;
  const { track, walker } = walkOf('7B');
  const door = track.places[track.slots - 1];
  assert.equal(walker.total, 147, '7B is in its room after 147 s');
  // the head stepped in at 147; a column of `length` takes length - 1 steps more
  const cleared = walker.total + (walker.length - 1) * step;
  assert.equal(coveredBy(track, headAt(walker.positions, walker.total, step, track.slots), walker.length, door.floorId, door.cell), true, 'the second the head steps in');
  assert.equal(coveredBy(track, headAt(walker.positions, cleared - step, step, track.slots), walker.length, door.floorId, door.cell), true, 'the last of the column on the cell');
  assert.equal(coveredBy(track, headAt(walker.positions, cleared, step, track.slots), walker.length, door.floorId, door.cell), false, 'the tail in the room');
  assert.equal(coveredBy(track, headAt(walker.positions, 240, step, track.slots), walker.length, door.floorId, door.cell), false, 'and at the bell');
});

// ------------------------------------------------- the stairs

test('stairPoint: from one end to the other', () => {
  const a = { x: 10, y: 20 };
  const b = { x: 110, y: 60 };
  assert.deepEqual(stairPoint(a, b, 0), a);
  assert.deepEqual(stairPoint(a, b, 1), b);
  const mid = stairPoint(a, b, 0.5);
  assert.ok(Math.hypot(mid.x - 60, mid.y - 40) > 5, 'the middle is off the straight line: the link is an arc');
  // the same two ends, however far along: one arc
  const quarter = stairPoint(a, b, 0.25);
  assert.ok(quarter.x > a.x && quarter.x < mid.x);
});

test('stairPoint: the marker rides the arc drawStairLink draws', () => {
  // what the lanes draw, read off the calls they make on the canvas
  function drawnArc(from, to) {
    const curves = [];
    const g = new Proxy({}, {
      get(target, name) {
        if (name === 'quadraticCurveTo') return (cx, cy, x, y) => curves.push({ cx, cy, x, y });
        if (name === 'measureText') return () => ({ width: 0 });
        return name in target ? target[name] : () => {};
      },
      set(target, name, value) {
        target[name] = value;
        return true;
      },
    });
    drawStairLink(g, from, to, { colour: '#000', edge: '#fff', width: 2, font: 'sans-serif', ink: '#000' });
    assert.ok(curves.length > 0, 'the link is drawn as a curve');
    return curves[0];
  }
  for (const [a, b] of [[{ x: 100, y: 400 }, { x: 180, y: 90 }], [{ x: 0, y: 0 }, { x: 1000, y: 0 }], [{ x: 50, y: 50 }, { x: 40, y: 300 }], [{ x: 30, y: 30 }, { x: 36, y: 22 }]]) {
    const curve = drawnArc(a, b);
    for (const u of [0.25, 0.5, 0.75]) {
      const v = 1 - u;
      const wanted = { x: v * v * a.x + 2 * v * u * curve.cx + u * u * curve.x, y: v * v * a.y + 2 * v * u * curve.cy + u * u * curve.y };
      const got = stairPoint(a, b, u);
      assert.ok(Math.hypot(got.x - wanted.x, got.y - wanted.y) < 1e-6, 'at ' + u + ' of ' + JSON.stringify([a, b]) + ': the marker is at ' + JSON.stringify(got) + ', the dots at ' + JSON.stringify(wanted));
    }
  }
});

// ------------------------------------------------- the clock's words

test('minutesText: whole seconds as minutes and seconds', () => {
  assert.equal(minutesText(0), '0:00');
  assert.equal(minutesText(37), '0:37');
  assert.equal(minutesText(59.9), '0:59');
  assert.equal(minutesText(240), '4:00');
  assert.equal(minutesText(725), '12:05');
  assert.equal(minutesText(-3), '0:00');
});

test('clockText: the time of day to the second, on either clock', () => {
  assert.equal(clockText('13:08', 37, '12h'), '1:08:37');
  assert.equal(clockText('13:08', 37, '24h'), '13:08:37');
  assert.equal(clockText('08:59', 60, '12h'), '9:00:00');
  assert.equal(clockText('11:59', 75.9, '12h'), '12:00:15');
  assert.equal(clockText('00:00', 5, '12h'), '12:00:05');
  assert.equal(clockText('13:08', -5, '24h'), '13:08:00');
  assert.equal(clockText('08:05', 9, '24h'), '08:05:09');
});

test('clockText: a transition that runs past midnight starts the day again', () => {
  assert.equal(clockText('23:58', 150, '24h'), '00:00:30');
  assert.equal(clockText('23:58', 150, '12h'), '12:00:30');
  assert.equal(clockText('23:59', 61, '24h'), '00:00:01');
});

test('clockText: no bell, no clock', () => {
  assert.equal(clockText(null, 10, '12h'), '');
  assert.equal(clockText('', 10, '12h'), '');
  assert.equal(clockText('soon', 10, '12h'), '');
});
