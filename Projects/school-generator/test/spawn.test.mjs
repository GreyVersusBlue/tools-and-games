// spawn.test.mjs — where a walk of a storey begins.
//
// The record is three numbers and an optional room id on `floor.spawn`, and it
// is the sixteenth application of the same rule the save file has kept since
// v3: a storey nobody has chosen a start point on writes no `spawn` key, so
// every file written before this build round-trips through it as the same
// bytes it went in as.
//
// The *use* of the record lives in walkthrough.js, which imports three.js and
// so cannot be loaded here. What can be tested without a browser is the half
// that decides whether a design keeps what it was told — which is the half
// that silently loses somebody's work when it is wrong.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createState } from '../js/grid.js';
import { serialize, deserialize } from '../js/save-load.js';
import { boxRoom } from './build.mjs';

test('a storey with no chosen start point writes no key', () => {
  const s = createState(20, 20);
  assert.equal(JSON.parse(serialize(s)).floors[0].spawn, undefined);
});

test('a chosen start point survives a save and a load', () => {
  const s = createState(20, 20);
  s.floors[0].spawn = { x: 42.5, z: 18, yaw: 1.25, room: 7 };
  const back = deserialize(serialize(s));
  assert.deepEqual(back.floors[0].spawn, { x: 42.5, z: 18, yaw: 1.25, room: 7 });
  assert.equal(serialize(back), serialize(s), 'and round-trips byte for byte');
});

test('a start point picked by standing somewhere carries no room', () => {
  const s = createState(20, 20);
  s.floors[0].spawn = { x: 10, z: 10, yaw: 0 };
  const back = deserialize(serialize(s));
  assert.equal(back.floors[0].spawn.room, undefined);
});

test('a cleared start point leaves no key behind', () => {
  const s = createState(20, 20);
  s.floors[0].spawn = { x: 10, z: 10, yaw: 0 };
  s.floors[0].spawn = null;
  const written = JSON.parse(serialize(s));
  assert.ok(!('spawn' in written.floors[0]), 'a null is a key; it goes too');
  assert.equal(deserialize(serialize(s)).floors[0].spawn, undefined);
});

test('each storey keeps its own start point', () => {
  const s = createState(20, 20);
  s.floors.push({ ...s.floors[0], shapes: [] });
  s.floors[0].spawn = { x: 4, z: 4, yaw: 0 };
  s.floors[1].spawn = { x: 60, z: 60, yaw: Math.PI / 2 };
  const back = deserialize(serialize(s));
  assert.equal(back.floors[0].spawn.x, 4);
  assert.equal(back.floors[1].spawn.x, 60);
});

// A record that arrived from somewhere else — an older build, a hand-edited
// file, a bug — must read as "no start point chosen" rather than as a walk
// that begins in the car park.
test('a start point that is not two numbers is no start point at all', () => {
  const s = createState(20, 20);
  for (const bad of [{}, { x: 1 }, { x: 'a', z: 2 }, { x: NaN, z: 0 },
    { x: 1e9, z: 0 }, 'nope', 7, null]) {
    const raw = JSON.parse(serialize(s));
    raw.floors[0].spawn = bad;
    assert.equal(deserialize(JSON.stringify(raw)).floors[0].spawn, undefined,
      `${JSON.stringify(bad)} should not become a start point`);
  }
});

test('a facing outside one turn comes back inside it, and a missing one reads as north', () => {
  const s = createState(20, 20);
  const read = (yaw) => {
    const raw = JSON.parse(serialize(s));
    raw.floors[0].spawn = { x: 8, z: 8, yaw };
    return deserialize(JSON.stringify(raw)).floors[0].spawn.yaw;
  };
  assert.ok(Math.abs(read(Math.PI * 2 + 0.5) - 0.5) < 1e-9);
  assert.ok(Math.abs(read(-Math.PI * 4)) < 1e-9);
  assert.equal(read(undefined), 0);
});

// The point of the whole record: a storey whose biggest room is the gym does
// not have to begin every walk in the gym.
test('a start point is a room away from the one the default would pick', () => {
  const s = createState(30, 30);
  const gym = boxRoom(s, 0, 2, 2, 14, 14);        // the biggest room
  const entry = boxRoom(s, 0, 18, 2, 22, 6);      // a small one, far from it
  assert.ok(gym && entry);
  s.floors[0].spawn = { x: 80, z: 16, yaw: 0, room: entry.id };
  const back = deserialize(serialize(s));
  assert.equal(back.floors[0].spawn.room, entry.id);
  assert.notEqual(back.floors[0].spawn.room, gym.id);
});
