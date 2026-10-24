// A curve bowed into the building tighter than the 1.5ft eave stands on its
// skeleton (#993). Run `node --test 'test/*.test.mjs'` from
// Projects/school-generator.
//
// The mitred eave of #967 turns a chord end for end once the overhang is more
// than the curve's radius, and the loop kept its rectangles. Now the eave is
// carried out the way the skeleton's own wavefront runs: a chord that closes
// up on the way out is gone from there on, so a dent the overhang covers is
// covered, and the roof stands on what the eave line is. A V notch closes the
// same way. A notch whose two sides meet head on closes as the outline's
// own wavefront runs out (#1000), and the eave runs straight past it.

import test from 'node:test';
import assert from 'node:assert/strict';

import { roofOutline, hasCurve, roofPlan, roofCover, curvedRoofs, EAVE } from '../js/roof.js';
import { arcPoints, addShape } from '../js/shapes.js';
import { createState } from '../js/grid.js';
import { eavePolygon, cleanPolygon, offsetRing } from '../js/skeleton.js';

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

// Every face of a skeleton roof on the plane through its own eave edge: each
// point's height the eave's plus the pitch times its distance in.
function everyFaceOnItsPlane(roof, eaveY, slope, label) {
  for (const f of roof.faces) {
    const [a, c] = f.pts;
    const L = Math.hypot(c.x - a.x, c.z - a.z);
    for (const p of f.pts) {
      const d = ((c.x - a.x) * (p.z - a.z) - (c.z - a.z) * (p.x - a.x)) / L;
      assert.ok(Math.abs(p.y - (eaveY + slope * d)) < 1e-9, `${label}: face ${f.edge} off its plane by ${p.y - (eaveY + slope * d)}`);
    }
  }
}

// Two sides meeting head on closed neither the mitred line nor #993's
// step-out, and the hall kept its rectangles. The eave is the outline's own
// wavefront run out 1.5ft now (#1000): the sides meet at half the notch's
// width and the west eave runs straight past where the notch was.
test('a notch whose sides meet head on closes, and the eave runs straight past it', () => {
  for (const [name, pts] of Object.entries({
    square: [[24, 21], [27, 21], [27, 19], [24, 19]],
    slot: [[24, 20.25], [30, 20.25], [30, 19.75], [24, 19.75]],
    dovetail: [[24, 20.5], [27, 21.5], [27, 18.5], [24, 19.5]],
  })) {
    const s = notched(pts);
    const roofs = curvedRoofs(s.floors[0], 12, 6);
    assert.equal(roofs.length, 1, `${name}: a skeleton roof`);
    const [roof] = roofs;
    // The west eave is two corners on the wall's line carried out 1.5ft, at
    // the hall's own ends: nothing of the notch is left in it.
    const west = roof.eave.filter((p) => p.x < 30);
    assert.deepEqual(west.map((p) => [p.x, p.z].map((v) => Math.round(v * 1e9) / 1e9)).sort((a, b) => a[1] - b[1]),
      [[22.5, 6.5], [22.5, 33.5]], `${name}: ${JSON.stringify(west)}`);
    for (const p of loopOf(s)) assert.ok(inside(roof.eave, p.x, p.z), `${name}: ${p.x},${p.z} outside the eave`);
    everyFaceOnItsPlane(roof, 12, 0.5, name);
    let sum = 0;
    for (const f of roof.faces) sum += area(f.pts);
    assert.ok(Math.abs(sum - area(roof.eave)) < 1e-6, `${name}: faces ${sum} against the eave's ${area(roof.eave)}`);
    const plan = roofPlan(s);
    assert.ok(plan.blocks.length === 1 && plan.blocks[0].skeleton, `${name}: the rectangles go`);
    assert.equal(roofCover(s).skeleton, 1, `${name}: the takeoff counts it off its chords`);
  }
});

// A bottle: a 1ft mouth into a 5 by 6ft pocket. The mouth's sides meet at
// 0.5ft, before the pocket's do, so the outline's wavefront run out 1.5ft
// is two loops, the eave and the pocket still open inside it. #1000 refused
// two pieces, since a roof on the first would cover the pocket's sky; the
// pocket is the second loop of that same wavefront, which is what a court's
// eave is (#999), so the roof stands round it as round a court (#1014).
test('a bottle notch whose mouth closes first stands on its skeleton, round the pocket as round a court', () => {
  const s = notched([[24, 20.5], [25, 20.5], [25, 23], [30, 23], [30, 17], [25, 17], [25, 19.5], [24, 19.5]]);
  const loop = loopOf(s);
  assert.equal(offsetRing(loop, -EAVE).length, 2, 'the eave and the pocket');
  const [roof, more] = curvedRoofs(s.floors[0], 12, 6);
  assert.ok(roof && !more, 'one skeleton roof');
  assert.deepEqual(roof.holes, [], 'no court in the walls: the pocket is outside them');
  assert.equal(roof.eaveHoles.length, 1, 'the pocket, as an eave hole');
  const [pocket] = roof.eaveHoles;
  // The notch 1.5ft in from its three walls: x 26.5 to 28.5, z 18.5 to 21.5.
  const xs = pocket.map((p) => p.x), zs = pocket.map((p) => p.z);
  assert.ok(Math.abs(Math.min(...xs) - 26.5) < 1e-9 && Math.abs(Math.max(...xs) - 28.5) < 1e-9, JSON.stringify(pocket));
  assert.ok(Math.abs(Math.min(...zs) - 18.5) < 1e-9 && Math.abs(Math.max(...zs) - 21.5) < 1e-9, JSON.stringify(pocket));
  // The west eave runs straight past the mouth, which it closes over.
  const west = roof.eave.filter((p) => p.x < 30);
  assert.ok(west.length >= 2 && west.every((p) => Math.abs(p.x - 22.5) < 1e-9), JSON.stringify(west));
  for (const p of loop) assert.ok(inside(roof.eave, p.x, p.z), `${p.x},${p.z} outside the eave`);
  everyFaceOnItsPlane(roof, 12, 0.5, 'bottle');
  // The faces cover the eave less the pocket, once, and the pocket's sky.
  let sum = 0;
  for (const f of roof.faces) sum += Math.abs(area(f.pts));
  assert.ok(Math.abs(sum - (area(roof.eave) - Math.abs(area(pocket)))) < 1e-6, `faces ${sum}`);
  assert.ok(Math.abs(Math.abs(area(pocket)) - 6) < 1e-9);
  assert.ok(!roof.faces.some((f) => inside(f.pts, 27.5, 20)), 'nothing over the pocket');
  const plan = roofPlan(s);
  assert.ok(plan.blocks.length === 1 && plan.blocks[0].skeleton, 'the rectangles go');
  assert.equal(roofCover(s).skeleton, 1, 'the takeoff counts it off its chords');
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
