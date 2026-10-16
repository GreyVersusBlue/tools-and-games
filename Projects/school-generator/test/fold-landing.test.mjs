// A folded ramp's top landing is asked what a straight ramp's is (#985): a
// wall or a doorway in it, a landing off the floor it arrives on, another
// link in it, a floor-standing prop, a door leaf sweeping into it. Same
// function, same reasons, same `ramp-landing` warning, nothing moved.
//
// The fixture, by hand: a 12ft storey at 1:6 is 72ft of run. The ramp is 4ft
// wide and turned to climb toward +X along z 22, so local +X (where the lanes
// stack) is world -Z. Three runs of 24ft: lanes at local x -2..2, 2..6, 6..10,
// an odd count, so the top landing is the third lane's far end, local z 24 to
// 29, which is world x foot + 24 to foot + 29 and z 12 to 16, and the way off
// is toward +X. Two runs of 36ft: the top landing is the second lane's NEAR
// end, local z -5 to 0, world x foot - 5 to foot and z 16 to 20, and the way
// off is toward -X, past the foot. Cells are 4ft, so the halls run x 4 to 164
// and z 4 to 36, and a wall drawn after cell 20 stands on x 84.
//
// Run with: node --test test/fold-landing.test.mjs  (from the project folder)

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, addFloor } from '../js/grid.js';
import { sheet } from './build.mjs';
import { addStair, stairMetrics, rampLayout, rampTopLanding, rampLandingBox } from '../js/stairs.js';
import { rampLandingFit } from '../js/clearance.js';
import { accessibleAnalysis } from '../js/egress.js';
import { addProp } from '../js/props.js';
import { catalogEntry } from '../js/catalog.js';
import { shapesOf } from '../js/shapes.js';
import { serialize, deserialize } from '../js/save-load.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const find = (list, code) => list.find((f) => f.code === code);

function school(x, upper, runs = 3, opts = {}) {
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
  const { link: ramp } = addStair(s, 0, { type: 'ramp', x, z: 22, rotationY: Math.PI / 2, slope: 6, runs });
  return { s, ramp };
}
const oneHall = (u) => u.box(1, 1, 40, 8, { name: 'Upper Hall' });
const twoRooms = (u) => { u.box(1, 1, 20, 8, { name: 'Upper Hall' }); u.box(21, 1, 40, 8, { name: 'Far Room' }); };
// A doorway in the wall on x 84, on the row the three-run landing is on.
const doorAhead = (u) => { twoRooms(u); u.door(21, 3, false); };
const swingBack = (s) => {
  for (const sh of shapesOf(s.floors[1])) {
    for (const ring of sh.rings) for (const o of ring.openings) o.sw = o.sw === -1 ? 1 : -1;
  }
};
const desk = (s, x, z) => addProp(s, 'student-desk', { floor: 1, x, z, rotationY: 0 });
const fit = (t, cat = catalogEntry) => rampLandingFit(t.s, t.ramp, undefined, cat);

// ---------- which landing, and which way off ----------

test('the top landing asked is the layout\'s own, and the way off is its open edge', () => {
  const odd = school(8, oneHall, 3);
  const m = stairMetrics(odd.s);
  const top = rampTopLanding(odd.ramp, m);
  const layout = rampLayout(odd.ramp, m);
  assert.deepEqual(top.box, layout.landings[2].box, 'the same box the deck is drawn from');
  assert.deepEqual(top.box, { x0: 6, x1: 10, z0: 24, z1: 29 });
  assert.equal(top.out, 1, 'three runs: off the far end');
  const even = school(12, oneHall, 2);
  const t2 = rampTopLanding(even.ramp, stairMetrics(even.s));
  assert.deepEqual(t2.box, { x0: 2, x1: 6, z0: -5, z1: 0 });
  assert.equal(t2.out, -1, 'two runs: off the near end, beside the foot');
  // A straight ramp's is the box it always had, off its far end.
  const straight = school(8, oneHall, 1);
  const m1 = stairMetrics(straight.s);
  assert.deepEqual(rampTopLanding(straight.ramp, m1), { box: rampLandingBox(straight.ramp, m1), out: 1 });
  // A stair is not asked, folded or not.
  assert.equal(rampTopLanding({ ...odd.ramp, type: 'stair' }, m), null);
});

// ---------- clear ----------

test('a folded ramp with open floor round its top landing and past it is not flagged', () => {
  for (const runs of [3, 5]) {
    const t = school(8, oneHall, runs);
    assert.equal(fit(t), null, `${runs} runs`);
  }
  const even = school(12, oneHall, 2);
  assert.equal(fit(even), null, 'two runs, landing x 7 to 12, floor asked at 6');
});

// ---------- each reason alone ----------

test('a wall across a folded ramp\'s top landing', () => {
  // Foot at 57.5: the landing is x 81.5 to 86.5, the wall stands on 84.
  const t = school(57.5, twoRooms);
  const f = fit(t);
  assert.deepEqual(f.why, ['wall']);
  assert.deepEqual([f.id, f.floor], [t.ramp.id, 1]);
  assert.ok(near(f.x, 84) && near(f.z, 14), `at the middle of the landing, not the ramp's: ${f.x}, ${f.z}`);
});

test('a doorway at a folded ramp\'s far end is the way off; the same doorway inside the landing is not', () => {
  // Foot at 55: the landing ends on 84, where the doorway is, and its leaf
  // swings away.
  const open = school(55, doorAhead);
  swingBack(open.s);
  assert.equal(fit(open), null, 'ADA 405.7.5');
  // Foot at 55.5: the doorway is half a foot inside the landing.
  const through = school(55.5, doorAhead);
  swingBack(through.s);
  assert.ok(fit(through).why.includes('wall'), JSON.stringify(fit(through)));
});

test('a folded ramp\'s top landing off the floor it arrives on: the near end of an even fold', () => {
  // Two runs at foot 8: the landing is x 3 to 8 and the hall starts at 4, so
  // it is over the outside wall; at foot 9.5 it is x 4.5 to 9.5 and the floor
  // asked a foot past it, at 3.5, is outside.
  const over = school(8, oneHall, 2);
  assert.ok(fit(over).why.includes('edge'), JSON.stringify(fit(over)));
  const lip = school(9.5, oneHall, 2);
  assert.deepEqual(fit(lip).why, ['edge']);
  // The far end of the same ramp is 36ft away and on the floor: asking the
  // straight ramp's end would have passed it.
  const ok = school(12, oneHall, 2);
  assert.equal(fit(ok), null);
});

test('the way off is asked at the top lane\'s middle, not on the ramp\'s axis', () => {
  // Foot at 55: the landing is x 79 to 84, z 12 to 16, and ends on the wall at
  // 84. Past it the far room only runs z 20 to 36, so the floor a foot past the
  // landing's middle (85, 14) is outside, where (85, 22) on the axis is not.
  const t = school(55, (u) => { u.box(1, 1, 20, 8, { name: 'Upper Hall' }); u.box(21, 5, 40, 8, { name: 'Far Room' }); });
  assert.deepEqual(fit(t).why, ['wall', 'edge']);
});

test('the wall asked across the way off is at the open end of an even fold', () => {
  // Two runs at foot 13: the landing is x 8 to 13 and is left by its x 8 edge,
  // where a wall stands the length of the hall. Its other end, at 13, is where
  // it meets the run, and has nothing across it.
  const t = school(13, (u) => { u.box(1, 1, 1, 8, { name: 'Strip' }); u.box(2, 1, 40, 8, { name: 'Upper Hall' }); }, 2);
  assert.deepEqual(fit(t).why, ['wall']);
});

test('another link in a folded ramp\'s top landing', () => {
  // Foot at 8: the landing is x 32 to 37, z 12 to 16.
  const hole = school(8, oneHall);
  addStair(hole.s, 0, { type: 'opening', x: 34.5, z: 14, w: 3, d: 3 });
  assert.deepEqual(fit(hole).why, ['link']);
  const lift = school(8, oneHall);
  addStair(lift.s, 0, { type: 'elevator', x: 34.5, z: 14 });
  assert.deepEqual(fit(lift).why, ['link']);
  const stair = school(8, oneHall, 3, { storeys: 3 });
  addStair(stair.s, 1, { type: 'stair', x: 34.5, z: 14, rotationY: Math.PI / 2 });
  assert.deepEqual(fit(stair).why, ['link']);
});

test('a desk on a folded ramp\'s top landing, alone, and moved nowhere', () => {
  const t = school(8, oneHall);
  const d = desk(t.s, 34.5, 14);
  assert.deepEqual(fit(t).why, ['prop']);
  assert.equal(fit(t, null), null, 'no catalog, not asked, as for a straight ramp');
  assert.deepEqual([d.x, d.z, t.s.props.length], [34.5, 14, 1]);
  // On the turn landing at the far end of lanes 0 and 1 (local x -2 to 6),
  // which is not the top landing.
  const turn = school(8, oneHall);
  desk(turn.s, 34.5, 20);
  assert.equal(fit(turn), null);
});

test('a door swinging into a folded ramp\'s top landing, alone; swinging away it is the way off', () => {
  const t = school(55, doorAhead);
  assert.deepEqual(fit(t).why, ['swing']);
  swingBack(t.s);
  assert.equal(fit(t), null);
});

// ---------- the finding ----------

test('the warning names a folded ramp, moves nothing, and is not saved', () => {
  const t = school(57.5, twoRooms);
  const text = serialize(t.s);
  const links = JSON.stringify(t.s.links);
  const a = accessibleAnalysis(t.s);
  assert.equal(JSON.stringify(t.s.links), links, 'asking changes no link');
  assert.equal(a.summary.tightLandings, 1);
  const f = find(a.findings, 'ramp-landing');
  assert.equal(f.title, '1 ramp with no room for the top landing');
  assert.match(f.detail, /a wall or a doorway stands in it \(1\)\./);
  assert.deepEqual(f.doors.map((d) => [d.id, d.floor]), [[t.ramp.id, 1]]);
  assert.equal(serialize(deserialize(text)), text, 'nothing about it is stored');
});
