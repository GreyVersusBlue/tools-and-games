// An arc of two chords bowed off a wall that is not square to its
// neighbours (#994). Run `node --test 'test/*.test.mjs'` from
// Projects/school-generator.
//
// #976 read two equal chords as a curve only when the wall they were bowed
// off was square to both neighbours. Any two equal chords are an arc off the
// wall between their ends, so the question is which walls are told apart from
// a chamfer or a saw. A wall whose two ends turn alike (a trapezoid's end, a
// wedge, a splayed bay) is, once it turns at least 45 degrees at each end:
// two equal teeth of a saw, or a shallow V cut in a straight wall, read as a
// wall that turns under 42.5 degrees, since a curve's chords turn under 85.
// A wall whose two ends turn unlike (a parallelogram's end) is not: bowed in
// two chords it is the same polygon as a chamfer as long as the wall before
// it, which #976's test keeps straight, so it keeps its rectangles.

import test from 'node:test';
import assert from 'node:assert/strict';

import { hasCurve, roofPlan, roofCover, skeletonRoofsOf } from '../js/roof.js';
import { addShape, curveSegment } from '../js/shapes.js';
import { createState } from '../js/grid.js';

const P = (a) => a.map(([x, z]) => ({ x, z }));
const turned = (pts, rot) => pts.map(({ x, z }) =>
  ({ x: x * Math.cos(rot) - z * Math.sin(rot), z: x * Math.sin(rot) + z * Math.cos(rot) }));
const area = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) a += pts[i].x * pts[(i + 1) % pts.length].z - pts[(i + 1) % pts.length].x * pts[i].z;
  return a / 2;
};

// A room whose east wall, from (40, 0) to (40, 24), turns `deg` degrees at
// each end (its neighbours splay out or in alike), bowed into two chords
// with the tip `s` ft out (in, for a negative `s`).
const trapezoid = (deg, s) => {
  const k = 40 / Math.tan((deg * Math.PI) / 180);   // how far the west end's walls splay
  return P([[0, -k], [40, 0], [40 + s, 12], [40, 24], [0, 24 + k]]);
};

test('an arc of two chords off a wall whose ends turn alike, not square, is a curve', () => {
  for (const deg of [50, 60, 78.7, 100, 120, 135]) {
    for (const s of [0.5, 3, 6, -2, -5]) {
      for (const rot of [0, 0.3, 2]) {
        assert.equal(hasCurve(turned(trapezoid(deg, s), rot)), true, `ends ${deg} tip ${s} turned ${rot}`);
      }
      assert.equal(hasCurve(trapezoid(deg, s).reverse()), true, `ends ${deg} tip ${s} wound the other way`);
    }
  }
  // #976's square wall, unchanged.
  for (const s of [0.5, 6, -6]) assert.equal(hasCurve(P([[0, 0], [40, 0], [40 + s, 12], [40, 24], [0, 24]])), true, `square, tip ${s}`);
});

test('two equal chords whose wall turns alike under 45 degrees, or unlike, are not a curve', () => {
  // A shallow V cut in a straight wall: its wall turns 0 degrees at each end.
  assert.equal(hasCurve(P([[0, 0], [10, 0], [15, 3], [20, 0], [20, 10], [0, 10]])), false, 'a V in a wall');
  // A saw of two equal teeth at 80 degrees: read as a wall turning 40 at each end.
  const c = 10 * Math.cos((80 * Math.PI) / 180), sn = 10 * Math.sin((80 * Math.PI) / 180);
  assert.equal(hasCurve(P([[0, 0], [10, 0], [10 + c, sn], [20 + c, sn], [20 + 2 * c, 2 * sn], [20 + 2 * c, 40], [0, 40]])), false, 'an 80 degree saw');
  // A parallelogram's end, 67.4 and 112.6 degrees, bowed 3ft: the chamfer's case.
  const tip = [45 + (3 * 24) / 26, 12 - (3 * 10) / 26];
  assert.equal(hasCurve(P([[0, 0], [40, 0], tip, [50, 24], [10, 24]])), false, 'a parallelogram\'s end');
  // Square at one end, 81.5 at the other (#976's own case), still not.
  assert.equal(hasCurve(P([[0, 0], [40, 0], [46, 12], [40, 24], [0, 30]])), false, 'square at one end');
});

// A hall whose east wall splays 78.7 degrees at both ends, beside a square
// room, the east wall bowed by the curve tool in two chords.
const school = (bulge, style) => {
  const s = createState(30, 20);
  const hall = addShape(s, 0, P([[24, 4], [64, 12], [64, 36], [24, 44]]));
  addShape(s, 0, P([[8, 4], [24, 4], [24, 44], [8, 44]]));
  assert.equal(curveSegment(hall, 0, 1, bulge, 2), 2, 'two chords');
  s.roof = { style, pitch: 6, facade: 'brick' };
  return s;
};

test('a hipped hall whose splayed wall is bowed in two chords stands on its skeleton', () => {
  for (const bulge of [-0.2, 0.2]) {
    const s = school(bulge, 'hip');
    const [sk] = skeletonRoofsOf(s);
    assert.ok(sk, `bulge ${bulge}`);
    assert.equal(sk.outline.length, 7, 'the two rooms\' six corners plus the arc\'s tip');
    const c = roofCover(s);
    assert.equal(c.skeleton, 1);
    assert.ok(Math.abs(c.footprint - area(sk.outline)) < 1e-6, `${c.footprint}`);
  }
});

test('under a parapet the same hall runs on its chords, decked as its outline', () => {
  for (const bulge of [-0.2, 0.2]) {
    const plan = roofPlan(school(bulge, 'parapet'));
    assert.equal(plan.deckPolys.length, 1, `bulge ${bulge}`);
    assert.equal(plan.outlines.length, 1);
    assert.ok(hasCurve(plan.outlines[0]), 'the parapet stands on the chords');
    assert.equal(plan.outlines[0].length, 7);
  }
});
