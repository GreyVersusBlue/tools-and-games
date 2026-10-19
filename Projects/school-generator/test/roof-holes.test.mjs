// The roof over a building with a court in it (DESIGN-roof-holes.md,
// increments 3 and 4; #998, #999). Run `node --test 'test/*.test.mjs'` from
// Projects/school-generator.
//
// `roofOutline` gives each building's courts as holes of its loop, whether
// the court is a room's own hole or the space rooms close round. Under the
// parapet a building with a curve on any of its rings runs its parapet on
// the chords and round the court, and its deck is the outline less the court.
// Hipped (increment 4, #999), it stands on the skeleton of the outline with
// each court's eave, 1.5ft into the court, as a hole. Gabled it keeps its
// rectangles, and a rectilinear courtyard building is the plan it always was
// under every style.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import * as roof from '../js/roof.js';
import { addShape, pointInRing } from '../js/shapes.js';
import { createState, CELL } from '../js/grid.js';
import { takeoff } from '../js/takeoff.js';
import { roofHeightAt } from '../js/elevation.js';
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

  test(`${what}: the gable over the court keeps its rectangles`, () => {
    // Gable over a curve is the weighted skeleton (question 5), not built.
    const s = hall({ rooms, style: 'gable' });
    assert.equal(skeletonRoofsOf(s).length, 0);
    assert.ok(!roofPlan(s).blocks.some((b) => b.skeleton));
    assert.equal(roofCover(s).footprint, maskFootprint(s));
  });

  for (const pitch of [2, 6, 12]) {
    test(`${what}: hipped at ${pitch} in 12, the roof stands round the court on its skeleton (#999)`, () => {
      const s = hall({ rooms, style: 'hip', pitch });
      const slope = pitch / 12;
      const [outer] = roofOutline(s.floors[0]).loops;
      const blocks = roofPlan(s).blocks.filter((b) => b.skeleton);
      assert.equal(blocks.length, 1, 'one skeleton block');
      assert.equal(skeletonRoofsOf(s).length, 1);
      const [b] = blocks;
      assert.equal(b.holes.length, 1, 'the court is the block\'s hole');
      // The court's eave: its ring 1.5ft into the court.
      assert.equal(b.eaveHoles.length, 1);
      assert.deepEqual(new Set(b.eaveHoles[0].map(key)), new Set(COURT_EAVE.map(key)));
      const plan = roofPlan(s);
      everyFaceOnItsPlane(b, plan.eaveY, slope);
      // A face for each of the court's four walls, rising from the court eave.
      const court = b.faces.filter((f) => f.ring === 1);
      assert.equal(court.length, 4, 'four court faces');
      for (const f of court) {
        for (const p of f.pts.slice(0, 2)) {
          assert.ok(Math.abs(p.y - plan.eaveY) < 1e-9, 'the court face starts at the eave height');
          assert.ok(COURT_EAVE.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 1e-9), `(${p.x}, ${p.z}) is a court eave corner`);
        }
      }
      assert.equal(b.faces.filter((f) => f.ring === 0).length, b.faces.length - 4);
      // The faces tile the outer eave less the court's eave, once.
      let sum = 0;
      for (const f of b.faces) sum += area(f.pts);
      assert.ok(Math.abs(sum - (area(b.eave) - 9 * 5)) < 1e-6, `faces ${sum} against ${area(b.eave) - 45}`);
      // The section: sky over the court and under its overhang, as outside the
      // outer wall; 1.4ft back from the court wall, the court face's plane.
      const mask = roofMask(s.floors[0], s.w, s.h);
      assert.equal(roofHeightAt(plan, mask, 26, 24), null, 'the middle of the court');
      assert.equal(roofHeightAt(plan, mask, 26, 21.4), null, '1.4ft into the court, under the eave');
      assert.equal(roofHeightAt(plan, mask, 30.6, 24), null, '1.4ft into the court from its east wall');
      const y = roofHeightAt(plan, mask, 26, 18.6);
      assert.ok(Math.abs(y - (plan.eaveY + (1.5 + 1.4) * slope)) < 1e-9, `1.4ft into the building from the court: ${y}`);
      // The takeoff: the outline less the court, sloped at the pitch.
      const cover = roofCover(s);
      assert.equal(cover.skeleton, 1);
      assert.ok(Math.abs(cover.footprint - (area(outer) - 96)) < 1e-9, `${cover.footprint} against ${area(outer) - 96}`);
      assert.ok(Math.abs(cover.area - cover.footprint * Math.hypot(12, pitch) / 12) < 1e-9);
    });
  }
}

// The court pushed 1.5ft in, counter-clockwise as `offsetRing` gives it.
const COURT_EAVE = R4(21.5, 21.5, 30.5, 26.5);

// Every face of a skeleton block on the plane through its own eave edge:
// each point's height the eave's plus the pitch times its distance in.
function everyFaceOnItsPlane(b, eaveY, slope) {
  for (const f of b.faces) {
    const [a, c] = f.pts;
    const L = Math.hypot(c.x - a.x, c.z - a.z);
    assert.ok(L > 0);
    for (const p of f.pts) {
      const d = ((c.x - a.x) * (p.z - a.z) - (c.z - a.z) * (p.x - a.x)) / L;
      assert.ok(Math.abs(p.y - (eaveY + slope * d)) < 1e-9, `face ${f.ring}:${f.edge} off its plane by ${p.y - (eaveY + slope * d)}`);
    }
  }
}

// One room, the hall's outline, with `courts` as its holes.
function hallWith(courts, pitch = 6) {
  const s = createState(30, 20);
  const sh = addShape(s, 0, [{ x: 8, z: 8 }, ...ARC.map((p) => ({ ...p })), { x: 8, z: 40 }]);
  for (const c of courts) sh.rings.push({ pts: c.map((p) => ({ ...p })), walls: [], openings: [] });
  s.roof = { style: 'hip', pitch, facade: 'brick' };
  return s;
}

test('a court 2.5ft wide keeps the hipped hall on its rectangles (question 3\'s default)', () => {
  // Its eave, 1.5ft in from both sides, has nothing left at 1.25ft.
  const s = hallWith([R4(20, 20, 22.5, 28)]);
  assert.equal(curvedLoopsOf(s.floors[0]).length, 1, 'the outline takes it');
  assert.equal(skeletonRoofsOf(s).length, 0);
  assert.ok(!roofPlan(s).blocks.some((b) => b.skeleton));
  assert.equal(roofCover(s).footprint, maskFootprint(s));
  // 3.5ft wide, it has an eave half a foot wide, and the roof stands round it.
  assert.equal(skeletonRoofsOf(hallWith([R4(20, 20, 23.5, 28)])).length, 1);
});

test('two courts: a hole and an eave each, every face on its plane', () => {
  const courts = [R4(16, 16, 24, 24), R4(30, 20, 40, 32)];
  const s = hallWith(courts);
  const [b] = skeletonRoofsOf(s);
  assert.ok(b, 'on the skeleton');
  assert.equal(b.holes.length, 2);
  assert.equal(b.eaveHoles.length, 2);
  everyFaceOnItsPlane(b, roofPlan(s).eaveY, 0.5);
  assert.equal(b.faces.filter((f) => f.ring === 1).length, 4);
  assert.equal(b.faces.filter((f) => f.ring === 2).length, 4);
  let sum = 0;
  for (const f of b.faces) sum += area(f.pts);
  assert.ok(Math.abs(sum - (area(b.eave) - 5 * 5 - 7 * 9)) < 1e-6, `faces ${sum}`);
  const [outer] = roofOutline(s.floors[0]).loops;
  assert.ok(Math.abs(roofCover(s).footprint - (area(outer) - 64 - 120)) < 1e-9);
});

test('a round court: its eave is the 12-gon 1.5ft in, and the hall stands round it', () => {
  const round = Array.from({ length: 12 }, (_, k) => ({ x: 28 + 6 * Math.cos((Math.PI * k) / 6), z: 24 + 6 * Math.sin((Math.PI * k) / 6) }));
  const s = hallWith([round]);
  const [b] = skeletonRoofsOf(s);
  assert.ok(b, 'on the skeleton');
  assert.equal(b.eaveHoles.length, 1);
  assert.equal(b.eaveHoles[0].length, 12);
  // Each eave corner 1.5ft in from each of its two chords: the apothem less 1.5.
  const apothem = 6 * Math.cos(Math.PI / 12);
  for (const p of b.eaveHoles[0]) {
    const r = Math.hypot(p.x - 28, p.z - 24);
    assert.ok(Math.abs(r - (apothem - 1.5) / Math.cos(Math.PI / 12)) < 1e-9, `corner at ${r}`);
  }
  everyFaceOnItsPlane(b, roofPlan(s).eaveY, 0.5);
  assert.equal(b.faces.filter((f) => f.ring === 1).length, 12);
  const mask = roofMask(s.floors[0], s.w, s.h);
  assert.equal(roofHeightAt(roofPlan(s), mask, 28, 24), null, 'sky in the middle of the court');
});

// A court with a head-on notch of its own, 2ft wide and 3ft deep into the
// hall off its north side: the court's eave is its ring's own wavefront run
// 1.5ft in (#999), which closes the notch at 1ft as the outer eave's closes
// one in a wall (#1000), so the court eave is the plain court's.
test('a court whose own notch meets head on: its eave closes past it, and the hall stands round it', () => {
  const notched = [{ x: 20, z: 20 }, { x: 32, z: 20 }, { x: 32, z: 28 }, { x: 27, z: 28 }, { x: 27, z: 31 }, { x: 25, z: 31 }, { x: 25, z: 28 }, { x: 20, z: 28 }];
  const s = hallWith([notched]);
  const [b] = skeletonRoofsOf(s);
  assert.ok(b, 'on the skeleton');
  assert.equal(b.eaveHoles.length, 1);
  const eave = b.eaveHoles[0].map((p) => key(p)).filter((k, i, a) => a.indexOf(k) === i);
  // Straight-through corners from the closed notch may stand on the eave's
  // north side; every corner lies on the plain court eave's outline.
  for (const p of b.eaveHoles[0]) {
    const onX = Math.abs(p.x - 21.5) < 1e-9 || Math.abs(p.x - 30.5) < 1e-9, onZ = Math.abs(p.z - 21.5) < 1e-9 || Math.abs(p.z - 26.5) < 1e-9;
    assert.ok((onX && p.z > 21.5 - 1e-9 && p.z < 26.5 + 1e-9) || (onZ && p.x > 21.5 - 1e-9 && p.x < 30.5 + 1e-9), `court eave corner ${key(p)}`);
  }
  for (const c of COURT_EAVE) assert.ok(eave.includes(key(c)), `the court eave has ${key(c)}`);
  assert.ok(Math.abs(Math.abs(area(b.eaveHoles[0])) - 45) < 1e-9, `the court eave is 9 by 5: ${area(b.eaveHoles[0])}`);
  everyFaceOnItsPlane(b, roofPlan(s).eaveY, 0.5);
  let sum = 0;
  for (const f of b.faces) sum += area(f.pts);
  assert.ok(Math.abs(sum - (area(b.eave) - 45)) < 1e-6, `faces ${sum}`);
  const [outer] = roofOutline(s.floors[0]).loops;
  assert.ok(Math.abs(roofCover(s).footprint - (area(outer) - 96 - 6)) < 1e-9, 'the cover is the outline less the court and its notch');
});

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
