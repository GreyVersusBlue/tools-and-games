// A curve bowed into the building tighter than the 1.5ft eave stands on its
// skeleton (#993). Run `node --test 'test/*.test.mjs'` from
// Projects/school-generator.
//
// The mitred eave of #967 turns a chord end for end once the overhang is more
// than the curve's radius, and the loop kept its rectangles. Now the eave is
// carried out the way the skeleton's own wavefront runs: a chord that closes
// up on the way out is gone from there on, so a dent the overhang covers is
// covered, and the roof stands on what the eave line is. A V notch closes the
// same way; a notch whose two sides meet head on is still refused.

import test from 'node:test';
import assert from 'node:assert/strict';

import { roofOutline, hasCurve, roofPlan, roofCover, curvedRoofs, EAVE } from '../js/roof.js';
import { arcPoints, addShape } from '../js/shapes.js';
import { createState } from '../js/grid.js';
import { eavePolygon, cleanPolygon } from '../js/skeleton.js';

const area = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) a += pts[i].x * pts[(i + 1) % pts.length].z - pts[(i + 1) % pts.length].x * pts[i].z;
  return a / 2;
};
const inside = (ring, x, z) => {
  let on = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) on = !on;
  }
  return on;
};

// The hall of test/roof-curve.test.mjs's "too tight" case: 40 by 24, its east
// wall pushed in by a semicircle of radius r between z 20 - r and 20 + r.
function dented(r, steps = 8) {
  const s = createState(30, 30);
  const arc = arcPoints({ x: 64, z: 20 - r }, { x: 64, z: 20 + r }, 0.5, steps);
  addShape(s, 0, [{ x: 24, z: 8 }, { x: 64, z: 8 }, ...arc, { x: 64, z: 32 }, { x: 24, z: 32 }]);
  s.roof = { style: 'hip', pitch: 6 };
  return s;
}
const loopOf = (s) => roofOutline(s.floors[0]).loops[0];

test('the 1ft dent: a curve, and a mitred eave that crosses itself', () => {
  const s = dented(1);
  const loop = loopOf(s);
  assert.ok(hasCurve(loop), 'the outline reads a curve');
  assert.ok(Math.min(...loop.filter((p) => p.z > 19 && p.z < 21).map((p) => p.x)) < 63.5, 'the dent goes into the hall');
  assert.equal(eavePolygon(loop, EAVE), null, 'the mitred eave is refused, as before');
});

test('the 1ft dent stands on its skeleton, the eave closing over it', () => {
  const s = dented(1);
  const [roof] = curvedRoofs(s.floors[0], 12, 6);
  assert.ok(roof, 'a skeleton roof');
  // The dent is 2ft across and 1ft deep, so a 1.5ft overhang closes over it
  // and the eave is the hall's rectangle carried out 1.5ft each way.
  const eave = cleanPolygon(roof.eave);
  assert.equal(eave.length, 4, `${eave.length} corners`);
  const xs = eave.map((p) => p.x).sort((a, b) => a - b), zs = eave.map((p) => p.z).sort((a, b) => a - b);
  for (const [got, want] of [[xs[0], 22.5], [xs[3], 65.5], [zs[0], 6.5], [zs[3], 33.5]]) assert.ok(Math.abs(got - want) < 1e-9, `${got} against ${want}`);
  // A 43 by 27 hip at 6 in 12 rises half of 13.5ft.
  assert.ok(Math.abs(roof.rise - 6.75) < 1e-9, `rise ${roof.rise}`);
  // Every wall corner, the dent's included, is under the roof.
  for (const p of loopOf(s)) assert.ok(inside(roof.eave, p.x, p.z), `${p.x},${p.z} outside the eave`);
});

test('the 1ft dent: the plan drops its rectangles, and the takeoff counts the hall off its chords', () => {
  const s = dented(1);
  const plan = roofPlan(s);
  assert.equal(plan.blocks.length, 1, 'one block');
  assert.ok(plan.blocks[0].skeleton, 'and it is the skeleton');
  assert.equal(plan.deckRects.length, 0, 'no deck rectangle under it');
  const cover = roofCover(s);
  assert.equal(cover.skeleton, 1);
  const want = Math.abs(area(loopOf(s)));
  assert.ok(want < 960 && want > 960 - Math.PI / 2, `the hall less the dent: ${want}`);
  assert.ok(Math.abs(cover.footprint - want) < 1e-9, `${cover.footprint} against ${want}`);
});

test('a dent the eave does not close keeps the mitred eave, corner for corner', () => {
  for (const r of [1.6, 4]) {
    const s = dented(r, 16);
    const loop = loopOf(s);
    const mitred = eavePolygon(loop, EAVE);
    assert.ok(mitred, `r ${r}: the mitred eave stands`);
    const [roof] = curvedRoofs(s.floors[0], 12, 6);
    assert.deepEqual(roof.eave, mitred, `r ${r}`);
  }
});

// The hall bowed out on the east, and a notch in its west wall between z 19
// and 21 (or as drawn), 3ft deep where it is a notch at all.
function notched(pts) {
  const s = createState(30, 30);
  const arc = arcPoints({ x: 64, z: 8 }, { x: 64, z: 32 }, -0.15, 8);
  addShape(s, 0, [{ x: 24, z: 8 }, ...arc, { x: 24, z: 32 }, ...pts.map(([x, z]) => ({ x, z }))]);
  s.roof = { style: 'hip', pitch: 6 };
  const loop = loopOf(s);
  assert.ok(hasCurve(loop), 'a curve');
  assert.ok(Math.max(...loop.map((p) => p.x)) > 66, 'bowed out');
  assert.equal(eavePolygon(loop, EAVE), null, 'the mitred eave crosses itself');
  return s;
}

test('a notch whose sides meet head on is still refused', () => {
  for (const [name, pts] of Object.entries({
    square: [[24, 21], [27, 21], [27, 19], [24, 19]],
    slot: [[24, 20.25], [30, 20.25], [30, 19.75], [24, 19.75]],
    dovetail: [[24, 20.5], [27, 21.5], [27, 18.5], [24, 19.5]],
  })) {
    const s = notched(pts);
    assert.deepEqual(curvedRoofs(s.floors[0], 12, 6), [], name);
    assert.ok(!roofPlan(s).blocks.some((b) => b.skeleton), `${name}: the rectangles stay`);
  }
});

test('a V notch closes from its point outward, like the dent, and the eave runs straight past it', () => {
  const s = notched([[24, 21], [27, 20], [24, 19]]);
  const [roof] = curvedRoofs(s.floors[0], 12, 6);
  assert.ok(roof, 'a skeleton roof');
  // The west eave is the wall's line carried out 1.5ft, unbroken.
  const west = roof.eave.filter((p) => p.x < 30);
  assert.ok(west.length >= 2 && west.every((p) => Math.abs(p.x - 22.5) < 1e-9), JSON.stringify(west));
  for (const p of loopOf(s)) assert.ok(inside(roof.eave, p.x, p.z), `${p.x},${p.z} outside the eave`);
});
