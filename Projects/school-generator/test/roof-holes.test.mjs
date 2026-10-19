// A flat roof over a building with a court in it (DESIGN-roof-holes.md,
// increment 3; #998). Run `node --test 'test/*.test.mjs'` from
// Projects/school-generator.
//
// `roofOutline` gives each building's courts as holes of its loop, whether
// the court is a room's own hole or the space rooms close round. Under the
// parapet a building with a curve on any of its rings runs its parapet on
// the chords and round the court, and its deck is the outline less the court.
// The hipped roof over a court stays on rectangles until increment 4, and a
// rectilinear courtyard building is the plan it always was under every style.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import * as roof from '../js/roof.js';
import { addShape, pointInRing } from '../js/shapes.js';
import { createState, CELL } from '../js/grid.js';
import { takeoff } from '../js/takeoff.js';
import { sharedQuantities } from '../js/cost.js';

const { roofOutline, roofPlan, roofCover, roofMask, maskCount, parapetRuns, skeletonRoofsOf, curvedLoopsOf, inFootprint } = roof;

const R4 = (x0, z0, x1, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
const area = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) a += pts[i].x * pts[(i + 1) % pts.length].z - pts[(i + 1) % pts.length].x * pts[i].z;
  return a / 2;
};
const hash = (o) => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 16);

// A 40 by 32 hall (x 8 to 48, z 8 to 40) whose east end is a semicircle of
// 16 chords about (48, 24), and a 12 by 8 court at x 20 to 32, z 20 to 28.
const ARC = Array.from({ length: 17 }, (_, k) => {
  const t = -Math.PI / 2 + (Math.PI * k) / 16;
  return { x: 48 + 16 * Math.cos(t), z: 24 + 16 * Math.sin(t) };
});
const COURT = R4(20, 20, 32, 28);
const key = (p) => `${Math.round(p.x * 1e6)},${Math.round(p.z * 1e6)}`;

// `rooms`: the hall as four rooms round the court plus the apse as a room of
// its own; otherwise one room with the court as its own hole.
function hall({ rooms = false, style = 'parapet', pitch = 6 } = {}) {
  const s = createState(30, 20);
  if (rooms) {
    addShape(s, 0, R4(8, 8, 48, 20));
    addShape(s, 0, R4(8, 28, 48, 40));
    addShape(s, 0, R4(8, 20, 20, 28));
    addShape(s, 0, R4(32, 20, 48, 28));
    assert.ok(addShape(s, 0, ARC.map((p) => ({ ...p }))), 'the apse');
  } else {
    const sh = addShape(s, 0, [{ x: 8, z: 8 }, ...ARC.map((p) => ({ ...p })), { x: 8, z: 40 }]);
    sh.rings.push({ pts: COURT.map((p) => ({ ...p })), walls: [], openings: [] });
  }
  s.roof = { style, pitch, facade: 'brick' };
  return s;
}

// Four rooms round an open 24 by 24 court, no curve anywhere.
function courtyard(style, pitch = 6) {
  const s = createState(30, 20);
  addShape(s, 0, R4(8, 8, 48, 16));
  addShape(s, 0, R4(8, 40, 48, 48));
  addShape(s, 0, R4(8, 16, 16, 40));
  addShape(s, 0, R4(40, 16, 48, 40));
  s.roof = { style, pitch, facade: 'brick' };
  return s;
}

const maskFootprint = (s) => {
  const f = s.floors[s.floors.length - 1];
  return maskCount(roofMask(f, f.w, f.h)) * CELL * CELL;
};

for (const rooms of [false, true]) {
  const what = rooms ? 'rooms round the court' : 'a room with its own hole';

  test(`${what}: the outline is the hall with the court as its hole`, () => {
    const o = roofOutline(hall({ rooms }).floors[0]);
    assert.equal(o.refused, undefined);
    assert.equal(o.loops.length, 1);
    assert.equal(o.holes.length, 1);
    assert.equal(o.holes[0].length, 1, 'one court');
    const [court] = o.holes[0];
    assert.deepEqual(new Set(court.map(key)), new Set(COURT.map(key)));
    assert.ok(Math.abs(area(court) + 96) < 1e-9, 'wound against the loop, 96 ft²');
    assert.ok(area(o.loops[0]) > 1280);
    const [c] = curvedLoopsOf(hall({ rooms }).floors[0]);
    assert.deepEqual(c.outer, o.loops[0]);
    assert.deepEqual(c.holes, o.holes[0]);
  });

  test(`${what}: the parapet runs on the chords and round the court`, () => {
    const s = hall({ rooms });
    const plan = roofPlan(s);
    const [outer] = roofOutline(s.floors[0]).loops;
    const runs = parapetRuns(plan).map(([a, b]) => [key(a), key(b)].sort().join('|'));
    // Every chord of the apse, and every wall of the court, once.
    for (let k = 0; k < 16; k++) {
      const run = [key(ARC[k]), key(ARC[k + 1])].sort().join('|');
      assert.equal(runs.filter((r) => r === run).length, 1, `chord ${k}`);
    }
    for (let k = 0; k < 4; k++) {
      const run = [key(COURT[k]), key(COURT[(k + 1) % 4])].sort().join('|');
      assert.equal(runs.filter((r) => r === run).length, 1, `court wall ${k}`);
    }
    // Nothing else: the outline's own edges and the court's, no 4ft step.
    assert.equal(runs.length, outer.length + 4);
    // The court's loop is wound as the mask winds a hole, covered side right.
    assert.ok(plan.outlines.some((l) => area(l) < 0));
  });

  test(`${what}: the deck is the outline less the court, in triangles that cover it once`, () => {
    const s = hall({ rooms });
    const plan = roofPlan(s);
    const [outer] = roofOutline(s.floors[0]).loops;
    assert.equal(plan.deckPolys.length, 1);
    assert.equal(plan.deckRects.length, 0, 'no deck rectangle left under the curved building');
    const { pts, holes, tris } = plan.deckPolys[0];
    assert.equal(holes.length, 1);
    const all = [...pts, ...holes.flat()];
    let sum = 0;
    for (const t of tris) {
      const [a, b, c] = t.map((k) => all[k]);
      sum += Math.abs(area([a, b, c]));
      const mx = (a.x + b.x + c.x) / 3, mz = (a.z + b.z + c.z) / 3;
      assert.ok(!pointInRing(COURT, mx, mz), 'no triangle in the court');
      assert.ok(pointInRing(outer, mx, mz), 'every triangle over the building');
    }
    assert.ok(Math.abs(sum - (area(outer) - 96)) < 1e-6, `triangles ${sum} against ${area(outer) - 96}`);
  });

  test(`${what}: the takeoff and the estimate count the outline less the court`, () => {
    const s = hall({ rooms });
    const [outer] = roofOutline(s.floors[0]).loops;
    const cover = roofCover(s);
    assert.ok(Math.abs(cover.footprint - (area(outer) - 96)) < 1e-9, `${cover.footprint} against ${area(outer) - 96}`);
    assert.equal(cover.area, cover.footprint);
    assert.equal(cover.chords, 1);
    assert.equal(takeoff(s).roof.area, cover.area);
    assert.equal(sharedQuantities(s).get('roof:membrane'), cover.area);
  });

  test(`${what}: the hip over the court keeps its rectangles for now`, () => {
    for (const style of ['hip', 'gable']) {
      const s = hall({ rooms, style });
      assert.equal(skeletonRoofsOf(s).length, 0, style);
      assert.ok(!roofPlan(s).blocks.some((b) => b.skeleton), style);
      assert.equal(roofCover(s).footprint, maskFootprint(s), style);
    }
  });
}

test('rooms round the court and a room with a hole give the same figures', () => {
  const one = hall(), four = hall({ rooms: true });
  assert.ok(Math.abs(roofCover(one).footprint - roofCover(four).footprint) < 1e-9);
  const oa = roofOutline(one.floors[0]).loops[0], fa = roofOutline(four.floors[0]).loops[0];
  assert.deepEqual(new Set(oa.map(key)), new Set(fa.map(key)));
});

test('inFootprint is in the outline and in none of its holes', () => {
  const b = { outline: R4(0, 0, 40, 40), holes: [R4(10, 10, 20, 20).reverse()] };
  assert.equal(inFootprint(b, 5, 5), true);
  assert.equal(inFootprint(b, 15, 15), false);
  assert.equal(inFootprint(b, 45, 5), false);
  assert.equal(inFootprint({ outline: R4(0, 0, 40, 40) }, 15, 15), true, 'no holes key');
});

test('a curve only in the court takes the chords: a round court in a square room', () => {
  // DESIGN-roof-holes.md question 2's default: a curve on any ring.
  const s = createState(30, 20);
  const sh = addShape(s, 0, R4(8, 8, 48, 48));
  const round = Array.from({ length: 12 }, (_, k) => ({ x: 28 + 8 * Math.cos((Math.PI * k) / 6), z: 28 + 8 * Math.sin((Math.PI * k) / 6) }));
  sh.rings.push({ pts: round, walls: [], openings: [] });
  s.roof = { style: 'parapet', pitch: 6, facade: 'brick' };
  const [f] = curvedLoopsOf(s.floors[0]);
  assert.ok(f, 'the square with a round court has a curve');
  const plan = roofPlan(s);
  assert.equal(plan.deckPolys.length, 1);
  assert.equal(plan.deckPolys[0].holes.length, 1);
  assert.ok(Math.abs(roofCover(s).footprint - (1600 - Math.abs(area(round)))) < 1e-9);
  assert.ok(plan.outlines.some((l) => l.length === 12 && area(l) < 0), 'the parapet round the court, on its chords');
});

test('a room standing in the court, touching no wall, is its own building and keeps its mask', () => {
  const s = hall();
  addShape(s, 0, R4(24, 20.5, 28, 27.5));
  const o = roofOutline(s.floors[0]);
  assert.equal(o.loops.length, 2, 'the hall and the room in its court');
  const plan = roofPlan(s);
  const [outer] = o.loops.filter((l) => l.length > 4);
  // The room's two cells keep their own mask loop and deck rectangle.
  assert.ok(plan.outlines.some((l) => l.length === 4 && l.every((p) => p.x >= 24 && p.x <= 28 && p.z >= 20 && p.z <= 28)), 'its parapet');
  assert.equal(plan.deckRects.length, 1, 'its deck');
  assert.ok(Math.abs(roofCover(s).footprint - (area(outer) - 96 + 2 * CELL * CELL)) < 1e-9, 'counted once, on its cells');
});

test('a courtyard building standing in another\'s court: each court goes to the loop right round it', () => {
  const s = courtyard('parapet');
  const sh = addShape(s, 0, R4(20, 20, 36, 36));
  sh.rings.push({ pts: R4(24, 24, 32, 32), walls: [], openings: [] });
  const o = roofOutline(s.floors[0]);
  assert.equal(o.loops.length, 2);
  const big = o.loops.findIndex((l) => area(l) === 40 * 40);
  assert.ok(big >= 0);
  assert.deepEqual(o.holes[big].map(area), [-24 * 24], 'the outer building\'s court');
  assert.deepEqual(o.holes[1 - big].map(area), [-8 * 8], 'the inner building\'s own');
});

test('where the storey is judged building by building, a building keeps its court', () => {
  const s = hall();
  // Two rooms overlapping, well clear of the hall: the storey is refused as a whole.
  addShape(s, 0, R4(80, 8, 100, 24));
  addShape(s, 0, R4(90, 16, 110, 32));
  const o = roofOutline(s.floors[0]);
  assert.match(o.refused, /overlap/);
  assert.equal(o.loops.length, 1);
  assert.equal(o.holes[0].length, 1, 'the hall\'s court');
  assert.equal(roofPlan(s).deckPolys[0].holes.length, 1);
});

// Pinned from the plan before this change: a rectilinear courtyard building
// has no curve, so it never reaches the chords, under any style or pitch.
const PINNED = {
  parapet: '49985ec77bbc1697', flat: '37a07b556da15f82', gable: '1355470724492425', hip: 'b3b2ea9aef8cab2a',
};
test('a rectilinear courtyard building is the plan it was, under every style', () => {
  for (const style of Object.keys(PINNED)) {
    const plans = [2, 6, 12].map((p) => [roofPlan(courtyard(style, p)), roofCover(courtyard(style, p))]);
    assert.equal(hash(plans), PINNED[style], style);
    assert.equal(curvedLoopsOf(courtyard(style).floors[0]).length, 0);
    assert.equal(roofOutline(courtyard(style).floors[0]).holes[0].length, 1, 'the court is a hole now');
  }
});
