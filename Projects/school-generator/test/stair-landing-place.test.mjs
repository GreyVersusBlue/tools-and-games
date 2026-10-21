// A stair's 4ft top landing asked the ramp's other three questions (#989): a
// wall or a doorway in it or shutting its far end, the landing off the floor
// above, and another link's hole or footprint in it. Asked by `landingFit` in
// clearance.js, the lines `rampLandingFit` asks a ramp's with, and reported
// on the same `stair-landing` warning as #987's prop and swing, moving nothing.
//
// The fixture, by hand: a 12ft storey's stair is 19.25ft of run and lands on
// 4ft more. Turned to climb toward +X along z 22 with its foot at x, the run
// tops out at x + 19.25 and the landing is x + 19.25 to x + 23.25, z 20 to 24.
// Foot at 60.75 puts it on x 80 to 84. Cells are 4ft, so `twoRooms`' wall
// stands on x 84 and `shortHall` ends there; the long walls are z 4 and 36.
//
// Run with: node --test test/stair-landing-place.test.mjs  (from the project folder)

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, addFloor } from '../js/grid.js';
import { sheet } from './build.mjs';
import { addStair } from '../js/stairs.js';
import { stairLandingFit } from '../js/clearance.js';
import { accessibleAnalysis } from '../js/egress.js';
import { buildReport } from '../js/report.js';
import { catalogEntry } from '../js/catalog.js';
import { shapesOf } from '../js/shapes.js';

const find = (list, code) => list.find((f) => f.code === code);
const round = (v) => Math.round(v * 100) / 100;

function school(x, upper, opts = {}) {
  const s = createState(60, 20);
  addFloor(s);
  if (opts.storeys === 3) addFloor(s);
  const g = sheet(s, 0);
  g.box(1, 1, 40, 8, { name: 'Ground Hall' }).door(1, 4, false);
  g.bake();
  const u = sheet(s, 1);
  upper(u);
  u.bake();
  if (opts.storeys === 3) sheet(s, 2).box(1, 1, 40, 8, { name: 'Top Hall' }).bake();
  const { link } = addStair(s, 0, { type: 'stair', x, z: 22, rotationY: Math.PI / 2, ...opts.stair });
  return { s, stair: link };
}
const oneHall = (u) => u.box(1, 1, 40, 8, { name: 'Upper Hall' });
const twoRooms = (u) => { u.box(1, 1, 20, 8, { name: 'Upper Hall' }); u.box(21, 1, 40, 8, { name: 'Far Room' }); };
const shortHall = (u) => u.box(1, 1, 20, 8, { name: 'Upper Hall' });
const withDoor = (u) => { twoRooms(u); u.door(21, 5, false); };
const swingBack = (s) => {
  for (const sh of shapesOf(s.floors[1])) {
    for (const ring of sh.rings) for (const o of ring.openings) o.sw = o.sw === -1 ? 1 : -1;
  }
};
const why = ({ s, stair }) => {
  const fit = stairLandingFit(s, stair, undefined, catalogEntry);
  return fit && fit.why;
};

test('a clear stair, in the open and against open floor, raises nothing', () => {
  assert.equal(why(school(60.75, oneHall)), null);
  // The upper hall stops at 84; a landing to 81.5 has its foot of floor at 82.5.
  assert.equal(why(school(58.25, shortHall)), null);
  // Its far end at a doorway whose leaf swings away: the way off.
  const open = school(60.75, withDoor);
  swingBack(open.s);
  assert.equal(why(open), null);
  assert.equal(find(buildReport(open.s).findings, 'stair-landing'), undefined);
});

test('a wall shutting the far end, and a wall or a doorway across the landing', () => {
  // The wall on 84 is the landing's far end, with no doorway in it.
  assert.deepEqual(why(school(60.75, twoRooms)), ['wall']);
  // Half a foot further on, the same wall runs across the landing.
  assert.deepEqual(why(school(61.25, twoRooms)), ['wall']);
  // The doorway half a foot inside it: across it, and its leaf sweeps it
  // whichever way it turns.
  const through = school(61.25, withDoor);
  swingBack(through.s);
  assert.deepEqual(why(through), ['wall', 'swing']);
  // That one is caught by the jambs, 0.2ft inside a 4ft stair's sides. A 3ft
  // stair passes between them, and the doorway itself is what is across it.
  const narrow = school(61.25, withDoor, { stair: { width: 3 } });
  swingBack(narrow.s);
  assert.deepEqual(why(narrow), ['wall', 'swing']);
});

test('a landing off the floor above, or with no floor past its end', () => {
  // Landing to 83.5, short of the wall on 84, and 84.5 is off the floor.
  assert.deepEqual(why(school(60.25, shortHall)), ['edge']);
  // The landing itself past the edge, through the outside wall.
  assert.deepEqual(why(school(62.75, shortHall)), ['wall', 'edge']);
  // Off the side: along z 35 one side of it is a foot past the long wall.
  const side = school(60.75, oneHall);
  side.stair.z = 35;
  assert.deepEqual(why(side), ['wall', 'edge']);
});

test('another link in the landing: a floor opening, a lift, a stair standing on it; not a stair beside it', () => {
  const hole = school(60.75, oneHall);
  addStair(hole.s, 0, { type: 'opening', x: 82, z: 22, w: 3, d: 3 });
  assert.deepEqual(why(hole), ['link']);
  const lift = school(60.75, oneHall);
  addStair(lift.s, 0, { type: 'elevator', x: 82, z: 22 });
  assert.deepEqual(why(lift), ['link']);
  const up = school(60.75, oneHall, { storeys: 3 });
  addStair(up.s, 1, { type: 'stair', x: 82, z: 22, rotationY: Math.PI / 2 });
  assert.deepEqual(why(up), ['link']);
  // A second stair in the next lane: the two holes share a line and neither
  // landing is in the other's hole.
  const pair = school(60.75, oneHall);
  const { link: beside } = addStair(pair.s, 0, { type: 'stair', x: 60.75, z: 26, rotationY: Math.PI / 2 });
  assert.equal(why(pair), null);
  assert.equal(stairLandingFit(pair.s, beside, undefined, catalogEntry), null);
});

test('the finding names each reason, counts them, rings the landing and moves nothing', () => {
  const { s, stair } = school(60.25, shortHall);
  const f = find(accessibleAnalysis(s).findings, 'stair-landing');
  assert.ok(f, 'a stair-landing finding');
  assert.equal(f.level, 'warn');
  assert.match(f.title, /^1 stair with something in the top landing$/);
  assert.match(f.detail, /Here it runs off the floor it arrives on \(1\)\./);
  assert.equal(f.cite, undefined, 'no section is invented');
  assert.deepEqual(f.doors.map((m) => [m.id, m.floor, round(m.x), round(m.z)]), [[stair.id, 1, 81.5, 22]]);
  assert.deepEqual([stair.x, stair.z], [60.25, 22], 'the stair was not moved');
  assert.equal(find(accessibleAnalysis(s).findings, 'ramp-landing'), undefined, 'a stair is not a ramp');

  const two = school(60.75, twoRooms);
  addStair(two.s, 0, { type: 'opening', x: 82, z: 22, w: 3, d: 3 });
  addStair(two.s, 0, { type: 'stair', x: 60.75, z: 30, rotationY: Math.PI / 2 });
  const g = find(buildReport(two.s).findings, 'stair-landing');
  assert.match(g.title, /^2 stairs with something in the top landing$/);
  assert.match(g.detail, /Here a wall or a doorway stands in it \(2\); another stair, ramp, lift or floor opening is in it \(1\)\./);
});
