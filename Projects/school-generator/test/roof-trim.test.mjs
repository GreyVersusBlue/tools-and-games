// A neighbour's 4ft mask cell that reaches inside a curved building's chords
// gives way (#990). Run `node --test 'test/*.test.mjs'` from
// Projects/school-generator.
//
// #988 took the curved building's chord parapet where another building's
// cells only touch its mask, and kept the pair on one stepped parapet where a
// cell reached inside the chords. Devon (2026-10-16): the neighbour gives way.
// Its cells are cut back to the curve, so the curved building keeps its chord
// parapet and deck, the neighbour's parapet follows the cut, and its deck is
// its whole cells plus what is left of each cut one.

import test from 'node:test';
import assert from 'node:assert/strict';

import { roofPlan, roofOutline, roofMask, maskOutlines, roofCover } from '../js/roof.js';
import { addShape, curveSegment, pointInRing } from '../js/shapes.js';
import { createState, CELL } from '../js/grid.js';
import { takeoff } from '../js/takeoff.js';
import { quantities } from '../js/cost.js';

const R4 = (x0, z0, x1, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
const area = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) a += pts[i].x * pts[(i + 1) % pts.length].z - pts[(i + 1) % pts.length].x * pts[i].z;
  return a / 2;
};
// The part of `pts` inside an axis-aligned box, by clipping to each of its
// four sides in turn: a second way to the overlap, not the code's own.
function clipArea(pts, x0, z0, x1, z1) {
  for (const [axis, at, keep] of [['x', x0, 1], ['x', x1, -1], ['z', z0, 1], ['z', z1, -1]]) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const ia = (a[axis] - at) * keep >= 0, ib = (b[axis] - at) * keep >= 0;
      if (ia) out.push(a);
      if (ia !== ib) {
        const t = (at - a[axis]) / (b[axis] - a[axis]);
        out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      }
    }
    pts = out;
    if (!pts.length) return 0;
  }
  return Math.abs(area(pts));
}

// The hall of test/roof-touch.test.mjs: 40 by 24, a 16ft room on its west
// side, its east wall bowed out. With a bow of 0.4 it reaches x 73.56, and a
// box from x 73.8 (0.24ft clear of it) has its first mask cell from 72 to 76,
// 1.56ft inside the chords: #988's case that stayed stepped.
function school({ bow = -0.4, box = 73.8, style = 'parapet', curve = true } = {}) {
  const s = createState(50, 30);
  const hall = addShape(s, 0, R4(24, 8, 64, 32));
  addShape(s, 0, R4(8, 8, 24, 32));
  if (curve) assert.ok(curveSegment(hall, 0, 1, bow) > 3, 'the curve tool laid a curve');
  if (box != null) addShape(s, 0, R4(box, 16, 95, 24));
  s.roof = { style, pitch: 6, facade: 'brick' };
  return s;
}
const hallOf = (s) => roofOutline(s.floors[0]).loops.find((l) => l.length > 4);
const maskOf = (s) => roofMask(s.floors[0], s.w, s.h);
// The box's cells on their own run from x 72 to 96, z 16 to 24.
const BOX = [72, 16, 96, 24];

test('the reaching pair: a cell of the box lies inside the hall\'s chords', () => {
  const s = school();
  const hall = hallOf(s);
  assert.equal(roofOutline(s.floors[0]).loops.length, 2, 'two buildings, both accepted');
  assert.equal(maskOutlines(maskOf(s)).length, 1, 'the mask joins them');
  assert.ok(Math.max(...hall.map((p) => p.x)) > 73, 'the bow passes the box\'s first cell line');
  assert.ok(clipArea(hall, 72, 16, 76, 24) > 1, 'the box\'s first cells overlap the hall');
});

test('the hall keeps its chord parapet and deck', () => {
  const s = school();
  const plan = roofPlan(s);
  const hall = hallOf(s);
  const chords = (plan.deckPolys || []).filter((d) => !d.trim);
  assert.equal(chords.length, 1, 'one chord deck');
  assert.deepEqual(chords[0].pts, hall);
  assert.deepEqual(plan.outlines[plan.outlines.length - 1], hall, 'the chords, point for point, as the parapet');
});

test('the box\'s parapet follows the cut: its loop is its cells less the hall', () => {
  const s = school();
  const plan = roofPlan(s);
  const hall = hallOf(s);
  const boxLoops = plan.outlines.slice(0, -1);
  assert.equal(boxLoops.length, 1, 'one loop for the box');
  const loop = boxLoops[0];
  const overlap = clipArea(hall, ...BOX);
  const whole = (BOX[2] - BOX[0]) * (BOX[3] - BOX[1]);
  assert.ok(Math.abs(Math.abs(area(loop)) - (whole - overlap)) < 1e-6,
    `box loop ${Math.abs(area(loop))} against ${whole} less ${overlap}`);
  // Nothing of it inside the hall: every point on or outside the chords.
  for (const p of loop) assert.ok(!pointInRing(hall, p.x - 1e-6, p.z) || !pointInRing(hall, p.x + 1e-6, p.z), `${p.x},${p.z}`);
  // Its points off the 4ft lattice are on the hall's chords, where it was cut.
  const off = loop.filter((p) => p.x % CELL !== 0 || p.z % CELL !== 0);
  assert.ok(off.length >= 2, 'the cut adds corners off the lattice');
  for (const p of off) {
    const d = Math.min(...hall.map((a, i) => {
      const b = hall[(i + 1) % hall.length];
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / ((b.x - a.x) ** 2 + (b.z - a.z) ** 2)));
      return Math.hypot(a.x + (b.x - a.x) * t - p.x, a.z + (b.z - a.z) * t - p.z);
    }));
    assert.ok(d < 1e-9, `corner ${p.x},${p.z} is ${d}ft off the chords`);
  }
});

test('the box\'s deck is its whole cells plus the cut ones, and none of it in the hall', () => {
  const s = school();
  const plan = roofPlan(s);
  const hall = hallOf(s);
  const trims = plan.deckPolys.filter((d) => d.trim);
  assert.ok(trims.length >= 1, 'the cut cells are deck pieces');
  let deck = 0;
  for (const r of plan.deckRects) {
    assert.ok(clipArea(hall, r.x0, r.z0, r.x1, r.z1) < 1e-9, `rectangle ${r.x0},${r.z0} overlaps the hall`);
    deck += (r.x1 - r.x0) * (r.z1 - r.z0);
  }
  for (const d of trims) {
    const sum = d.tris.reduce((a, t) => a + Math.abs(area(t.map((k) => d.pts[k]))), 0);
    assert.ok(Math.abs(sum - Math.abs(area(d.pts))) < 1e-9, 'the triangles cover the piece');
    for (const t of d.tris) {
      const c = t.map((k) => d.pts[k]).reduce((a, p) => ({ x: a.x + p.x / 3, z: a.z + p.z / 3 }), { x: 0, z: 0 });
      assert.ok(!pointInRing(hall, c.x, c.z), `a piece's triangle at ${c.x},${c.z} is in the hall`);
      assert.ok(c.x > BOX[0] && c.x < BOX[2] && c.z > BOX[1] && c.z < BOX[3], 'and in the box\'s cells');
    }
    deck += Math.abs(area(d.pts));
  }
  const loop = plan.outlines[0];
  assert.ok(Math.abs(deck - Math.abs(area(loop))) < 1e-6, `deck ${deck} against the parapet's ${Math.abs(area(loop))}`);
});

test('the takeoff and the estimate count the hall off its chords and the box less the cut', () => {
  const s = school();
  const cover = roofCover(s);
  const hall = hallOf(s);
  const whole = (BOX[2] - BOX[0]) * (BOX[3] - BOX[1]);
  const want = area(hall) + whole - clipArea(hall, ...BOX);
  assert.equal(cover.chords, 1, 'one chord loop');
  assert.ok(Math.abs(cover.footprint - want) < 1e-6, `${cover.footprint} against ${want}`);
  assert.ok(Math.abs(cover.area - want) < 1e-6, 'flat: the area is the footprint');
  // The drawn deck, rectangles and pieces, is the same figure.
  const plan = roofPlan(s);
  const drawn = plan.deckRects.reduce((a, r) => a + (r.x1 - r.x0) * (r.z1 - r.z0), 0) +
    plan.deckPolys.reduce((a, d) => a + Math.abs(area(d.pts)), 0);
  assert.ok(Math.abs(drawn - cover.footprint) < 1e-6, `drawn ${drawn} against counted ${cover.footprint}`);
  assert.ok(Math.abs(takeoff(s).roof.footprint - want) < 1e-6, 'the takeoff\'s roof footprint');
  const membrane = [...quantities(s).all.entries()].find(([k]) => /^roof:membrane/.test(k));
  assert.ok(membrane && Math.abs(membrane[1] - want) < 1e-6, `estimate ${membrane && membrane[1]} against ${want}`);
});

test('a pair whose cells only touch (#988) has nothing cut', () => {
  const s = school({ bow: -0.3125, box: 72.5 });
  const plan = roofPlan(s);
  assert.equal(plan.deckPolys.length, 1, 'the chord deck only');
  assert.ok(!plan.deckPolys.some((d) => d.trim), 'no piece');
  assert.ok(plan.outlines[0].every((p) => p.x % CELL === 0 && p.z % CELL === 0), 'the box\'s loop stays on the lattice');
});

test('a rectilinear pair has no chords and nothing cut', () => {
  const s = school({ curve: false, box: 64.5 });
  const plan = roofPlan(s);
  assert.ok(!('deckPolys' in plan));
  assert.deepEqual(plan.outlines, maskOutlines(maskOf(s)));
});

test('only the parapet: flat, gable and hip over the reaching pair are as they were', () => {
  for (const style of ['flat', 'gable', 'hip']) assert.ok(!('deckPolys' in roofPlan(school({ style }))), style);
});
