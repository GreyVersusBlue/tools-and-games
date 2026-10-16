// A curved building whose 4ft mask cells touch another building's (#988). Run
// `node --test 'test/*.test.mjs'` from Projects/school-generator.
//
// Two buildings whose walls do not meet can still have mask cells side by
// side, and then `maskOutlines` gives them one loop. #973 kept that loop on
// its steps. Now the curved one takes its chords where no cell of anything
// else reaches inside them, and the other building keeps its own cells, its
// own loop round them and the rectangles they had. Where a cell of the
// other building does reach inside the chords the pair stays as it was:
// what a parapet does there is a question, not arithmetic.

import test from 'node:test';
import assert from 'node:assert/strict';

import { roofPlan, roofOutline, roofMask, maskOutlines, maskRects, roofCover } from '../js/roof.js';
import { addShape, curveSegment, pointInRing } from '../js/shapes.js';
import { createState, CELL } from '../js/grid.js';

const R4 = (x0, z0, x1, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
const area = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) a += pts[i].x * pts[(i + 1) % pts.length].z - pts[(i + 1) % pts.length].x * pts[i].z;
  return a / 2;
};

// A 40 by 24 hall bowed east past its 24ft east wall, a 16ft room on its west
// side, and (optional) a box to the east. A bow of 0.3125 reaches x 71.46;
// the box at x 72.5 covers the cell from 72 to 76, beside the hall's cell from
// 68 to 72, so the mask joins them while the hall's chords stay west of 72.
function school({ bow = -0.3125, box = 72.5, style = 'parapet' } = {}) {
  const s = createState(50, 30);
  const hall = addShape(s, 0, R4(24, 8, 64, 32));
  addShape(s, 0, R4(8, 8, 24, 32));
  assert.ok(curveSegment(hall, 0, 1, bow) > 3, 'the curve tool laid a curve');
  if (box != null) addShape(s, 0, R4(box, 16, 95, 24));
  s.roof = { style, pitch: 6, facade: 'brick' };
  return s;
}
// The box alone on the same surface: what its own roof is with no hall beside it.
function boxAlone(box = 72.5) {
  const s = createState(50, 30);
  addShape(s, 0, R4(box, 16, 95, 24));
  s.roof = { style: 'parapet', pitch: 6, facade: 'brick' };
  return s;
}
const maskOf = (s) => roofMask(s.floors[0], s.w, s.h);

test('the pair is two buildings whose mask cells touch: one mask loop', () => {
  const s = school();
  const { loops } = roofOutline(s.floors[0]);
  assert.equal(loops.length, 2, 'two buildings, both accepted');
  assert.equal(maskOutlines(maskOf(s)).length, 1, 'the mask joins them');
  const hall = loops.find((l) => l.length > 4);
  assert.ok(Math.max(...hall.map((p) => p.x)) < 72, 'the chords stay west of the box\'s first cell');
});

test('the curved hall takes its chords: parapet and deck on its own outline', () => {
  const s = school();
  const plan = roofPlan(s);
  const hall = roofOutline(s.floors[0]).loops.find((l) => l.length > 4);
  assert.equal(plan.deckPolys?.length, 1, 'one chord deck');
  assert.deepEqual(plan.deckPolys[0].pts, hall);
  const sum = plan.deckPolys[0].tris.reduce((a, t) => a + Math.abs(area(t.map((k) => hall[k]))), 0);
  assert.ok(Math.abs(sum - area(hall)) < 1e-6, `triangles ${sum} against outline ${area(hall)}`);
  assert.equal(plan.outlines.length, 2, 'the hall\'s chords and the box\'s own loop');
  assert.deepEqual(plan.outlines[plan.outlines.length - 1], hall, 'the chords, point for point');
});

test('the box keeps its own cells: its loop and rectangles are the ones it has alone', () => {
  const plan = roofPlan(school());
  const alone = roofPlan(boxAlone());
  assert.deepEqual(plan.outlines.slice(0, -1), alone.outlines, 'the box\'s loop, as if the hall were not there');
  assert.deepEqual(plan.deckRects.map(({ x0, z0, x1, z1 }) => ({ x0, z0, x1, z1 })),
    alone.deckRects.map(({ x0, z0, x1, z1 }) => ({ x0, z0, x1, z1 })), 'the box\'s rectangles, and nothing of the hall\'s');
});

test('no deck rectangle stands inside the hall, and none reaches into it', () => {
  const s = school();
  const plan = roofPlan(s);
  const hall = plan.deckPolys[0].pts;
  for (const r of plan.deckRects) {
    for (let x = r.x0 + CELL / 2; x < r.x1; x += CELL) {
      for (let z = r.z0 + CELL / 2; z < r.z1; z += CELL) assert.ok(!pointInRing(hall, x, z), `cell ${x},${z}`);
    }
  }
});

test('a rectangle that straddles the two is cut at the hall, the box\'s part kept', () => {
  // Built so the greedy cut lays one rectangle across both: a box as tall as
  // the hall's flank, the whole of it beside the hall's cells.
  const s = school({ box: 72.5 });
  const m = maskOf(s);
  const hall = roofOutline(s.floors[0]).loops.find((l) => l.length > 4);
  const straddles = maskRects(m).some((r) => {
    const cx = (x) => pointInRing(hall, x, r.z0 + CELL / 2);
    return cx(r.x0 + CELL / 2) !== cx(r.x1 - CELL / 2);
  });
  assert.ok(straddles, 'the joint mask has a rectangle across both buildings');
  const plan = roofPlan(s);
  const cells = (rs) => rs.reduce((a, r) => a + ((r.x1 - r.x0) * (r.z1 - r.z0)) / (CELL * CELL), 0);
  assert.equal(cells(plan.deckRects), cells(roofPlan(boxAlone()).deckRects));
});

test('the takeoff counts the hall off its chords and the box off its cells', () => {
  const both = roofCover(school());
  const hallOnly = roofCover(school({ box: null }));
  const boxOnly = roofCover(boxAlone());
  assert.equal(both.chords, 1);
  assert.ok(Math.abs(both.footprint - (hallOnly.footprint + boxOnly.footprint)) < 1e-9,
    `${both.footprint} against ${hallOnly.footprint} + ${boxOnly.footprint}`);
});

test('a box beside a wall on a cell line touches it and does not reach inside', () => {
  // West of the hall's west room (x 8, on the lattice): the box's cells end
  // at 8, so the loop clipped to them is a line with no area. The box starts
  // further north than the hall, so the shared mask loop is walked from one
  // of the box's cells first.
  const s = school({ box: null });
  addShape(s, 0, R4(0.5, 0.5, 7.5, 20));
  const alone = createState(50, 30);
  addShape(alone, 0, R4(0.5, 0.5, 7.5, 20));
  alone.roof = s.roof;
  assert.equal(maskOutlines(maskOf(s)).length, 1, 'the mask joins them');
  const plan = roofPlan(s);
  assert.equal(plan.deckPolys?.length, 1, 'the hall takes its chords');
  assert.deepEqual(plan.outlines.slice(0, -1), roofPlan(alone).outlines, 'the box\'s own loop, and not the shared one');
});

test('a box in the notch of a curved L, its cells against the wall\'s cell line, does not reach inside', () => {
  // The west room runs south to z 48, so the hall and it make an L whose
  // notch (x 24 to 64, z 32 to 48) lies inside the L's bounds; the box's
  // cells there meet the hall's south wall (z 32) along a line with no area.
  const s = createState(50, 30);
  const hall = addShape(s, 0, R4(24, 8, 64, 32));
  addShape(s, 0, R4(8, 8, 24, 48));
  assert.ok(curveSegment(hall, 0, 1, -0.3125) > 3);
  addShape(s, 0, R4(28, 32.5, 60, 44));
  s.roof = { style: 'parapet', pitch: 6, facade: 'brick' };
  assert.equal(roofOutline(s.floors[0]).loops.length, 2, 'two buildings');
  assert.equal(maskOutlines(maskOf(s)).length, 1, 'the mask joins them');
  assert.equal(roofPlan(s).deckPolys?.length, 1, 'the L takes its chords');
});

test('a box whose cell reaches inside the chords keeps the pair on its steps', () => {
  // The bow reaches x 73.56 and the box starts at 73.8, so the box's cell from
  // 72 to 76 lies 1.56ft inside the hall's chords. Two parapets would stand
  // inside one another there; which gives way is Devon's call (WISHLIST).
  const s = school({ bow: -0.4, box: 73.8 });
  const plan = roofPlan(s);
  assert.ok(!('deckPolys' in plan));
  assert.deepEqual(plan.outlines, maskOutlines(maskOf(s)));
  assert.equal(roofCover(s).chords, 0);
});

test('only the parapet: flat, gable and hip over the touching pair are as they were', () => {
  for (const style of ['flat', 'gable']) assert.ok(!('deckPolys' in roofPlan(school({ style }))), style);
  assert.ok(!('deckPolys' in roofPlan(school({ style: 'hip' }))), 'hip');
});
