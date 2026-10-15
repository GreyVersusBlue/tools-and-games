// Two rooms meeting at a corner, and an arc of two chords (#976). Run
// `node --test 'test/*.test.mjs'` from Projects/school-generator.
//
// Where the top storey's outline touches itself at a point, the union is
// split there into loops judged one by one: at the shared corner each wall
// arriving goes on along the wall that turns hardest towards the rooms, so
// each loop keeps its own rooms and is a simple polygon. An overlap and a
// courtyard are still refused. An arc of two chords is read as a curve when
// it was bowed off a wall square to both its neighbours, which a chamfer, a
// saw-tooth wall and a prow of 45 degree walls are not.

import test from 'node:test';
import assert from 'node:assert/strict';

import { roofOutline, roofPlan, roofCover, hasCurve, skeletonRoofsOf } from '../js/roof.js';
import { addShape, curveSegment } from '../js/shapes.js';
import { createState } from '../js/grid.js';

const room = (pts) => ({ rings: [{ pts: pts.map(([x, z]) => ({ x, z })), walls: [], openings: [] }] });
const floorOf = (...rooms) => ({ shapes: rooms });
const R = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const R4 = (x0, z0, x1, z1) => R(x0, z0, x1, z1).map(([x, z]) => ({ x, z }));
const P = (a) => a.map(([x, z]) => ({ x, z }));
const area = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) a += pts[i].x * pts[(i + 1) % pts.length].z - pts[(i + 1) % pts.length].x * pts[i].z;
  return a / 2;
};
const keys = (loop) => loop.map((p) => `${p.x},${p.z}`).sort().join(' ');

// ---------- the outline at a pinch ----------

test('two rooms meeting at a corner are two loops, one room each', () => {
  for (const [a, b] of [
    [R(0, 0, 20, 16), R(20, 16, 40, 32)],       // south-west and north-east
    [R(20, 0, 40, 16), R(0, 16, 20, 32)],       // south-east and north-west
    [R(20, 16, 40, 32), R(0, 0, 20, 16)],       // either order
  ]) {
    const o = roofOutline(floorOf(room(a), room(b)));
    assert.equal(o.refused, undefined);
    assert.equal(o.loops.length, 2);
    assert.deepEqual(o.loops.map(keys).sort(), [a, b].map((r) => keys(P(r))).sort());
    for (const l of o.loops) assert.equal(area(l), 320);
  }
});

test('a corner meeting the middle of a wall is split there too', () => {
  // A square turned 45 degrees, standing on its corner at x 20 of a 40ft room's north wall.
  const o = roofOutline(floorOf(room(R(0, 0, 40, 16)), room([[20, 16], [28, 24], [20, 32], [12, 24]])));
  assert.equal(o.loops.length, 2);
  assert.deepEqual(o.loops.map((l) => area(l)).sort((u, v) => u - v), [128, 640]);
  // The 40ft room's north wall is one wall again, the cut at x 20 merged away.
  assert.ok(o.loops.some((l) => l.length === 4 && area(l) === 640));
});

test('a building of several rooms touching another at one corner is two loops', () => {
  // An L of two rooms, and a square on the L's outer corner.
  const o = roofOutline(floorOf(room(R(0, 0, 20, 16)), room(R(0, 16, 12, 32)), room(R(20, 16, 36, 32))));
  assert.equal(o.loops.length, 2);
  assert.deepEqual(o.loops.map((l) => area(l)).sort((u, v) => u - v), [256, 320 + 192]);
});

test('a pinch still refuses a room inside another, and a courtyard', () => {
  // A small room in a bigger one's corner: both walls leave that corner into the same room.
  const corner = roofOutline(floorOf(room([[0, 0], [10, 0], [0, 10]]), room([[0, 0], [2, 1], [1, 2]])));
  assert.equal(corner.loops, null);
  assert.match(corner.refused, /overlap/);
  // Four rooms round a 20ft courtyard that reaches the outside at one corner (30, 30).
  const court = roofOutline(floorOf(room(R(0, 0, 40, 10)), room(R(30, 10, 40, 30)), room(R(0, 10, 10, 40)), room(R(10, 30, 30, 40))));
  assert.equal(court.loops, null);
  assert.match(court.refused, /courtyard/);
});

// ---------- a curved building at a pinch takes its skeleton ----------

// A 40 by 24 hall whose east wall the curve tool bows out to x 73.6, and a
// 16ft room standing on its north-west corner, touching it at (24, 32) only.
function pinched(style = 'hip') {
  const s = createState(30, 20);
  const hall = addShape(s, 0, R4(24, 8, 64, 32));
  assert.ok(curveSegment(hall, 0, 1, -0.4) > 3, 'the curve tool laid a curve');
  addShape(s, 0, R4(8, 32, 24, 48));
  s.roof = { style, pitch: 6, facade: 'brick' };
  return s;
}

test('a curved hall touching a room at one corner stands on its skeleton', () => {
  const s = pinched();
  const o = roofOutline(s.floors[0]);
  assert.equal(o.loops.length, 2);
  const [sk] = skeletonRoofsOf(s);
  assert.ok(sk, 'the hall takes the skeleton');
  assert.equal(skeletonRoofsOf(s).length, 1, 'the square room does not');
  const hallArea = area(s.floors[0].shapes[0].rings[0].pts);
  assert.ok(Math.abs(Math.abs(hallArea) - area(sk.outline)) < 1e-6);
  const plan = roofPlan(s);
  assert.equal(plan.blocks.filter((b) => b.skeleton).length, 1);
  // The room keeps its rectangle: one block over x 8 to 24, z 32 to 48.
  const rects = plan.blocks.filter((b) => !b.skeleton);
  assert.ok(rects.length >= 1);
  for (const b of rects) assert.ok(b.rect.x0 >= 8 && b.rect.x1 <= 24 && b.rect.z0 >= 32 && b.rect.z1 <= 48, JSON.stringify(b.rect));
  // The takeoff counts the hall off its chords and the room off its cells.
  const c = roofCover(s);
  assert.equal(c.skeleton, 1);
  assert.ok(Math.abs(c.footprint - (area(sk.outline) + 256)) < 1e-6, `${c.footprint}`);
});

// ---------- an arc of two chords ----------

// A 40 by 24 room whose east wall bows into an arc of two chords, the tip
// `s` ft out (in, for a negative `s`), turned through `rot` radians.
const twoChord = (s, rot = 0) => P([[0, 0], [40, 0], [40 + s, 12], [40, 24], [0, 24]]).map(({ x, z }) =>
  ({ x: x * Math.cos(rot) - z * Math.sin(rot), z: x * Math.sin(rot) + z * Math.cos(rot) }));

test('an arc of two chords bowed off a square wall is a curve, either way and at any angle', () => {
  for (const s of [0.5, 3, 6, 10, -2, -6]) {
    for (const rot of [0, 0.3, Math.PI / 4, 2]) {
      assert.equal(hasCurve(twoChord(s, rot)), true, `tip ${s} turned ${rot}`);
    }
  }
  // Wound the other way.
  assert.equal(hasCurve(twoChord(6).reverse()), true);
});

test('two equal walls that are not an arc bowed off a square wall are not a curve', () => {
  const r = Math.SQRT1_2 * 10;
  // A 45 degree chamfer as long as the wall before it.
  assert.equal(hasCurve(P([[0, 0], [10, 0], [10 + r, r], [10 + r, 24], [0, 24]])), false, 'a chamfer');
  // A saw-tooth wall of 10ft pieces, square and at 45 degrees by turns.
  assert.equal(hasCurve(P([[0, 0], [10, 0], [10 + r, r], [20 + r, r], [20 + 2 * r, 2 * r], [20 + 2 * r, 30], [0, 30]])), false, 'a saw');
  // A prow of 45 degree walls turns 90 degrees at its tip.
  assert.equal(hasCurve(P([[0, 0], [40, 0], [52, 12], [40, 24], [0, 24]])), false, 'a 45 degree prow');
  // Square ends, but the two walls are not one length.
  assert.equal(hasCurve(P([[0, 0], [40, 0], [46, 10], [40, 24], [0, 24]])), false, 'a lopsided prow');
  // Both ends turn 60 degrees and the tip 60, square by the sum, but the
  // ends are offset 10ft, so the walls are 3.9ft and 23.9ft long.
  const c = Math.cos(Math.PI / 3), sn = Math.sin(Math.PI / 3), t = (24 / sn - 20) / 2;
  assert.equal(hasCurve(P([[0, 0], [40, 0], [40 + t * c, t * sn], [30, 24], [0, 24]])), false, 'square ends offset');
  // One length, square at one end only.
  assert.equal(hasCurve(P([[0, 0], [40, 0], [46, 12], [40, 24], [0, 30]])), false, 'square at one end');
  // A wall in two equal pieces, square at both ends, does not turn at all.
  assert.equal(hasCurve(P([[0, 0], [10, 0], [20, 0], [20, 10], [0, 10]])), false, 'a wall in two pieces');
});

test('a hipped hall whose wall the curve tool bowed in two chords stands on its skeleton', () => {
  for (const bulge of [-0.2, 0.2]) {
    const s = createState(30, 20);
    const hall = addShape(s, 0, R4(24, 8, 64, 32));
    addShape(s, 0, R4(8, 8, 24, 32));
    assert.equal(curveSegment(hall, 0, 1, bulge, 2), 2, 'two chords');
    s.roof = { style: 'hip', pitch: 6, facade: 'brick' };
    const [sk] = skeletonRoofsOf(s);
    assert.ok(sk, `bulge ${bulge}`);
    assert.equal(sk.outline.length, 5, 'the two rooms\' rectangle plus the arc\'s tip');
    const c = roofCover(s);
    assert.ok(Math.abs(c.footprint - area(sk.outline)) < 1e-6);
  }
});
