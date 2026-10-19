// The courtyard that meets the outside at one corner (DESIGN-roof-holes.md
// increment 6, #1001). Run `node --test 'test/*.test.mjs'` from
// Projects/school-generator.
//
// Rooms closed round a court that touches the outside at a single corner give
// one loop through that corner twice. `cleanPolygon({ pinch })` lets that
// corner by where the two wedges of building at it keep apart, the skeleton
// and the stopped wavefront take it, and `roofOutline` keeps the loop with
// `pinch` set. Run out to the eave the two visits come apart, so the eave is
// the one round the outside and the court's own, not touching.

import test from 'node:test';
import assert from 'node:assert/strict';

import { cleanPolygon, straightSkeleton, offsetRing, eavePolygon } from '../js/skeleton.js';
import { roofOutline, roofPlan, roofCover, roofMask, parapetRuns, skeletonRoofsOf, curvedLoopsOf, inFootprint } from '../js/roof.js';
import { roofHeightAt } from '../js/elevation.js';
import { addShape, curveSegment } from '../js/shapes.js';
import { createState } from '../js/grid.js';

const P = (a) => a.map(([x, z]) => ({ x, z }));
const R4 = (x0, z0, x1, z1) => P([[x0, z0], [x1, z0], [x1, z1], [x0, z1]]);
const area = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) a += pts[i].x * pts[(i + 1) % pts.length].z - pts[(i + 1) % pts.length].x * pts[i].z;
  return a / 2;
};
const key = (p) => `${Math.round(p.x * 1e6)},${Math.round(p.z * 1e6)}`;
const sameRing = (a, b) => assert.deepEqual(new Set(a.map(key)), new Set(b.map(key)));

// The L of the design's section 2.3: arms 40ft long and 20 wide, its 10ft
// court touching the inner corner (20, 20), as one ring through it twice.
const L_RING = P([[0, 0], [40, 0], [40, 20], [20, 20], [20, 10], [10, 10], [10, 20], [20, 20], [20, 40], [0, 40]]);

// ---------- cleanPolygon ----------

test('without pinch the L is refused exactly as before; with it, kept corner for corner', () => {
  assert.equal(cleanPolygon(L_RING), null);
  assert.equal(cleanPolygon(L_RING, { pinch: false }), null);
  const c = cleanPolygon(L_RING, { pinch: true });
  assert.ok(c, 'the pinch is let by');
  assert.deepEqual(c, L_RING);
  // Wound the other way, it comes back counter-clockwise, still through (20, 20) twice.
  const back = cleanPolygon(L_RING.slice().reverse(), { pinch: true });
  assert.ok(area(back) > 0);
  assert.equal(back.filter((p) => p.x === 20 && p.z === 20).length, 2);
});

test('with pinch, a corner on an edge, a point three times and wedges that overlap are refused', () => {
  // The notch's foot (20, 0) on the middle of the south wall.
  assert.equal(cleanPolygon(P([[0, 0], [40, 0], [40, 40], [22, 40], [20, 0], [18, 40], [0, 40]]), { pinch: true }), null);
  // Two triangular courts touching the square's corner (0, 0), each walked so
  // its wedges keep apart: the point stands three times, which is refused.
  const three = P([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0], [1, 3], [2, 3], [0, 0], [3, 2], [3, 1]]);
  assert.equal(cleanPolygon(three, { pinch: true }), null);
  // Either court alone is a pinch.
  assert.ok(cleanPolygon(P([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0], [1, 3], [2, 3]]), { pinch: true }));
  assert.ok(cleanPolygon(P([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0], [3, 2], [3, 1]]), { pinch: true }));
  // A triangle touching the square's corner from inside, walked so the
  // square's corner pairs its walls with the triangle's the right way, is a
  // pinch; walked the other way the two wedges at (0, 0) overlap.
  const good = P([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0], [1, 2], [2, 1]]);
  const bad = P([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0], [2, 1], [1, 2]]);
  assert.ok(cleanPolygon(good, { pinch: true }));
  assert.equal(cleanPolygon(bad, { pinch: true }), null);
});

// ---------- the skeleton and the eave ----------

test('the L round its court: 10 faces, rise 10, 1100 ft², every face on its plane', () => {
  assert.equal(straightSkeleton(L_RING), null, 'without pinch, refused');
  const sk = straightSkeleton(L_RING, { pinch: true });
  assert.ok(sk);
  assert.equal(sk.faces.length, 10);
  assert.equal(Math.max(...sk.nodes.map((n) => n.t)), 10);
  let sum = 0;
  for (const f of sk.faces) {
    const pts = f.nodes.map((i) => sk.nodes[i]);
    const [a, b] = pts;
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    for (const p of pts) {
      const d = ((b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x)) / L;
      assert.ok(Math.abs(d - p.t) < 1e-9, `face ${f.edge} off its plane by ${d - p.t}`);
    }
    sum += area(pts);
  }
  assert.ok(Math.abs(sum - 1100) < 1e-9, `${sum}`);
  // The two visits to (20, 20) are corners 3 and 7, and each is on two faces.
  assert.deepEqual(sk.nodes[3], { x: 20, z: 20, t: 0 });
  assert.deepEqual(sk.nodes[7], { x: 20, z: 20, t: 0 });
});

test('the eave at the pinch is two loops that do not touch: the outside one and the court one', () => {
  assert.equal(offsetRing(L_RING, -1.5), null, 'without pinch, refused');
  const loops = offsetRing(L_RING, -1.5, { pinch: true });
  assert.equal(loops.length, 2);
  const [outer, court] = loops;
  // Round the outside: the L's own mitred eave, as if the court were not there.
  sameRing(outer, eavePolygon(P([[0, 0], [40, 0], [40, 20], [20, 20], [20, 40], [0, 40]]), 1.5));
  assert.ok(area(outer) > 0);
  // Into the court: the court's own eave, 1.5ft in, wound as a hole.
  sameRing(court, offsetRing(R4(10, 10, 20, 20), 1.5)[0]);
  sameRing(court, R4(11.5, 11.5, 18.5, 18.5));
  assert.ok(area(court) < 0);
  // Not touching: the outer eave's inner corner and the court eave's are 4.24ft apart.
  assert.ok(outer.some((p) => key(p) === key({ x: 21.5, z: 21.5 })));
  assert.ok(court.some((p) => key(p) === key({ x: 18.5, z: 18.5 })));
  let gap = Infinity;
  for (const p of outer) for (const q of court) gap = Math.min(gap, Math.hypot(p.x - q.x, p.z - q.z));
  assert.ok(Math.abs(gap - 3 * Math.SQRT2) < 1e-9, `${gap}`);
  // Inward the pinch is let by as well: the wavefront at 1ft is one loop of 1100 less the band.
  const inward = offsetRing(L_RING, 1, { pinch: true });
  assert.equal(inward.length, 1);
});

// ---------- the rooms ----------

// Four rooms round a 20ft court at x 18 to 38, z 18 to 38, the building's
// north-east quarter (x 38 to 48, z 38 to 48) left out, so the court meets
// the outside at (38, 38): the L of the design, made of rooms. `curve` bows
// the east room's east wall out 8ft.
function pinchedCourt({ style = 'hip', curve = true, courtX1 = 38 } = {}) {
  const s = createState(30, 20);
  addShape(s, 0, R4(8, 8, 48, 18));
  const east = addShape(s, 0, R4(courtX1, 18, 48, 38));
  addShape(s, 0, R4(8, 18, 18, 48));
  addShape(s, 0, R4(18, 38, courtX1, 48));
  if (curve) assert.ok(curveSegment(east, 0, 1, -0.4) > 3, 'the curve tool laid a curve');
  s.roof = { style, pitch: 6, facade: 'brick' };
  return s;
}

test('rooms round a court open at one corner are one loop through it twice, marked pinch', () => {
  for (const curve of [false, true]) {
    const o = roofOutline(pinchedCourt({ curve }).floors[0]);
    assert.equal(o.refused, undefined);
    assert.equal(o.loops.length, 1);
    assert.deepEqual(o.holes, [[]]);
    assert.deepEqual(o.pinch, [true]);
    const [loop] = o.loops;
    assert.equal(loop.filter((p) => p.x === 38 && p.z === 38).length, 2);
    if (!curve) assert.equal(area(loop), 1600 - 400 - 100);
  }
  // With no curve it is not a curved loop: the rectangles, as for any rectilinear courtyard.
  assert.deepEqual(curvedLoopsOf(pinchedCourt({ curve: false }).floors[0]), []);
  assert.deepEqual(skeletonRoofsOf(pinchedCourt({ curve: false })), []);
  assert.equal(curvedLoopsOf(pinchedCourt().floors[0])[0].pinch, true);
});

test('beside a refused building, the pinched one keeps its flag and its skeleton', () => {
  const s = pinchedCourt();
  // Two rooms laying one wall the same way, well clear of it: they overlap.
  addShape(s, 0, R4(70, 8, 90, 20));
  addShape(s, 0, R4(70, 8, 90, 16));
  const o = roofOutline(s.floors[0]);
  assert.match(o.refused, /overlap/);
  assert.equal(o.loops.length, 1);
  assert.deepEqual(o.pinch, [true]);
  assert.equal(skeletonRoofsOf(s).length, 1);
});

test('hipped, the curved building stands on its skeleton round the court', () => {
  const s = pinchedCourt();
  const plan = roofPlan(s);
  const [loop] = roofOutline(s.floors[0]).loops;
  const blocks = skeletonRoofsOf(s);
  assert.equal(blocks.length, 1);
  const [b] = blocks;
  assert.equal(plan.blocks.filter((x) => !x.skeleton).length, 0, 'no rectangle left over the building');
  assert.deepEqual(b.holes, []);
  assert.equal(b.eaveHoles.length, 1);
  sameRing(b.eaveHoles[0], R4(19.5, 19.5, 36.5, 36.5));
  // Every face on its plane at 6 in 12, rising from its own eave line.
  for (const f of b.faces) {
    const [a, c] = f.pts;
    const L = Math.hypot(c.x - a.x, c.z - a.z);
    for (const p of f.pts) {
      const d = ((c.x - a.x) * (p.z - a.z) - (c.z - a.z) * (p.x - a.x)) / L;
      assert.ok(Math.abs(p.y - (plan.eaveY + 0.5 * d)) < 1e-9, `face ${f.ring}:${f.edge}`);
    }
  }
  assert.equal(b.faces.filter((f) => f.ring === 1).length, 4, 'a slope off each court eave');
  let sum = 0;
  for (const f of b.faces) sum += area(f.pts);
  assert.ok(Math.abs(sum - (area(b.eave) - 17 * 17)) < 1e-6, `faces ${sum}`);
  // The court is not the footprint and reads as sky; the rooms read as roof.
  assert.equal(inFootprint(b, 28, 28), false);
  assert.equal(inFootprint(b, 13, 28), true);
  const mask = roofMask(s.floors[0], s.w, s.h);
  assert.equal(roofHeightAt(plan, mask, 28, 28), null);
  assert.ok(roofHeightAt(plan, mask, 13, 28) > plan.eaveY);
  // The takeoff counts the building off its chords, the court left out.
  const c = roofCover(s);
  assert.equal(c.skeleton, 1);
  assert.ok(Math.abs(c.footprint - area(loop)) < 1e-6, `${c.footprint} against ${area(loop)}`);
  assert.ok(area(loop) > 1100);
});

test('a pinched court too narrow for its eave keeps the hip on rectangles', () => {
  // The court 2.5ft wide (x 18 to 20.5), open at (20.5, 38).
  const s = pinchedCourt({ courtX1: 20.5 });
  assert.deepEqual(roofOutline(s.floors[0]).pinch, [true]);
  assert.equal(curvedLoopsOf(s.floors[0]).length, 1);
  assert.deepEqual(skeletonRoofsOf(s), []);
  assert.ok(roofPlan(s).blocks.length > 0 && roofPlan(s).blocks.every((x) => !x.skeleton));
});

test('under a parapet, the run goes round the court and the deck is the outline less the court', () => {
  const s = pinchedCourt({ style: 'parapet' });
  const plan = roofPlan(s);
  const [loop] = roofOutline(s.floors[0]).loops;
  assert.equal(plan.deckPolys.length, 1);
  const [deck] = plan.deckPolys;
  assert.deepEqual(deck.pts, loop);
  let sum = 0;
  for (const [i, j, k] of deck.tris) {
    const t = [deck.pts[i], deck.pts[j], deck.pts[k]];
    const a = area(t);
    assert.ok(a > 0, 'wound as the deck');
    const m = { x: (t[0].x + t[1].x + t[2].x) / 3, z: (t[0].z + t[1].z + t[2].z) / 3 };
    assert.ok(!(m.x > 18 && m.x < 38 && m.z > 18 && m.z < 38), 'no triangle in the court');
    sum += a;
  }
  assert.ok(Math.abs(sum - area(loop)) < 1e-9, `${sum} against ${area(loop)}`);
  const runs = parapetRuns(plan).map(([a, b]) => [key(a), key(b)].sort().join('|'));
  for (const [a, b] of [[[18, 18], [38, 18]], [[38, 18], [38, 38]], [[38, 38], [18, 38]], [[18, 38], [18, 18]]]) {
    const run = [key({ x: a[0], z: a[1] }), key({ x: b[0], z: b[1] })].sort().join('|');
    assert.equal(runs.filter((r) => r === run).length, 1, `court wall ${run}`);
  }
  const c = roofCover(s);
  assert.ok(Math.abs(c.footprint - area(loop)) < 1e-6, `${c.footprint}`);
});
