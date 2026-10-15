// A flat roof's parapet follows a curved wall (#973). Run
// `node --test 'test/*.test.mjs'` from Projects/school-generator.
//
// Where a building's true outline is accepted by `roofOutline` and has a
// curve in it (`curvedLoopsOf`, the same test the hipped roof's skeleton
// takes), the parapet runs along the rooms' own chords and the deck is that
// outline; every other building keeps the mask's 4ft loop and rectangles.

import test from 'node:test';
import assert from 'node:assert/strict';

import { roofPlan, roofOutline, roofMask, maskOutlines, maskRects, hasCurve } from '../js/roof.js';
import { addShape, curveSegment, shapesOf, pointInRing } from '../js/shapes.js';
import { createState, CELL } from '../js/grid.js';

const R4 = (x0, z0, x1, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
const area = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) a += pts[i].x * pts[(i + 1) % pts.length].z - pts[(i + 1) % pts.length].x * pts[i].z;
  return a / 2;
};

// West: a 40 by 24 hall whose east wall is bowed out to x 73.6, a 16ft room
// on its west side. East (optional): four rooms round an open courtyard.
function school({ curved = true, court = false, style = 'parapet' } = {}) {
  const s = createState(50, 30);
  if (curved) {
    const hall = addShape(s, 0, R4(24, 8, 64, 32));
    addShape(s, 0, R4(8, 8, 24, 32));
    assert.ok(curveSegment(hall, 0, 1, -0.4) > 3, 'the curve tool laid a curve');
  } else {
    addShape(s, 0, R4(24, 8, 64, 32));
    addShape(s, 0, R4(8, 8, 24, 32));
  }
  if (court) {
    addShape(s, 0, R4(110, 8, 150, 16));
    addShape(s, 0, R4(110, 40, 150, 48));
    addShape(s, 0, R4(110, 16, 118, 40));
    addShape(s, 0, R4(142, 16, 150, 40));
  }
  s.roof = { style, pitch: 6, facade: 'brick' };
  return s;
}
const maskOf = (s) => {
  const f = s.floors[s.floors.length - 1];
  return roofMask(f, s.w, s.h);
};

test('over an L with a curved end the parapet runs along the chords, on the walls', () => {
  const s = school();
  const plan = roofPlan(s);
  const [loop] = roofOutline(s.floors[0]).loops;
  assert.ok(hasCurve(loop));
  assert.equal(plan.outlines.length, 1, 'one parapet loop, not the mask loop beside it');
  assert.deepEqual(plan.outlines[0], loop, 'the outline, point for point');
  // Every corner of the parapet is a corner of some room's own ring, so the
  // parapet stands on the walls and not on a 4ft step.
  const corners = new Set(shapesOf(s.floors[0]).flatMap((sh) => sh.rings.flatMap((r) => r.pts.map((p) => `${p.x},${p.z}`))));
  for (const p of plan.outlines[0]) assert.ok(corners.has(`${p.x},${p.z}`), `${p.x},${p.z} is a room corner`);
  // A corner off the 4ft lattice: the old stepped loop had none.
  assert.ok(plan.outlines[0].some((p) => p.x % CELL !== 0 || p.z % CELL !== 0));
});

test('the deck under it is the outline, in triangles that cover it once', () => {
  const s = school();
  const plan = roofPlan(s);
  const [loop] = roofOutline(s.floors[0]).loops;
  assert.equal(plan.deckPolys.length, 1);
  const { pts, tris } = plan.deckPolys[0];
  assert.deepEqual(pts, loop);
  const sum = tris.reduce((a, t) => a + Math.abs(area(t.map((k) => pts[k]))), 0);
  assert.ok(Math.abs(sum - area(loop)) < 1e-6, `triangles ${sum} against outline ${area(loop)}`);
  // No deck rectangle is left inside the curved building to stand past it.
  for (const r of plan.deckRects) assert.ok(!pointInRing(loop, r.x0 + CELL / 2, r.z0 + CELL / 2));
  assert.equal(plan.deckRects.length, 0);
});

test('a rectilinear building keeps the mask loop and rectangles, key for key', () => {
  const s = school({ curved: false, court: true });
  const plan = roofPlan(s);
  const m = maskOf(s);
  assert.deepEqual(plan.outlines, maskOutlines(m));
  assert.deepEqual(plan.deckRects, maskRects(m));
  assert.ok(!('deckPolys' in plan), 'no new key on a roof that did not move');
});

test('a courtyard building beside a curved one keeps its stepped loops', () => {
  const both = roofPlan(school({ court: true }));
  const courtOnly = roofPlan(school({ curved: false, court: true }));
  const courtLoops = maskOutlines(maskOf(school({ curved: false, court: true })))
    .filter((l) => l.every((p) => p.x >= 100));
  assert.equal(courtLoops.length, 2, 'the courtyard building is an outer and an inner loop');
  for (const l of courtLoops) assert.ok(both.outlines.some((o) => JSON.stringify(o) === JSON.stringify(l)), 'kept on its steps');
  assert.equal(both.outlines.length, 3);
  assert.ok(both.outlines.some((o) => hasCurve(o)), 'and the curved building on its chords');
  // Its deck rectangles are the ones it had alone.
  const east = (rs) => rs.filter((r) => r.x0 >= 100);
  assert.deepEqual(east(both.deckRects), east(courtOnly.deckRects));
});

test('only the parapet moves: flat, gable and hip over the same curve are as they were', () => {
  for (const style of ['flat', 'gable', 'hip']) {
    const plan = roofPlan(school({ style }));
    assert.ok(!('deckPolys' in plan), style);
  }
});

test('two buildings a cell apart share a mask loop, and that loop stays stepped', () => {
  const s = school();
  // A box 0.2ft east of the bow's widest point (x 73.6): its bounds do not touch the
  // hall's, so it is a building of its own, but its mask cells touch.
  addShape(s, 0, R4(73.8, 16, 95, 24));
  assert.equal(roofOutline(s.floors[0]).loops.length, 2, 'two buildings, both accepted');
  const plan = roofPlan(s);
  const m = maskOf(s);
  assert.equal(maskOutlines(m).length, 1, 'the mask joins them');
  assert.deepEqual(plan.outlines, maskOutlines(m));
  assert.ok(!('deckPolys' in plan));
});
