// The takeoff and the estimate over a hipped or a parapet roof on a curve. Run
// `node --test 'test/*.test.mjs'` from Projects/school-generator.
//
// A footprint that takes the skeleton path (the one test `roofPlan` asks) is
// counted off its own chords, not off the 4ft mask's staircase; every other
// footprint is the mask's count, as before. A parapet that runs on the chords
// (#973, `roofPlan`'s `deckPolys`) is counted off that same outline, flat
// (#986). The curved figure is checked
// against one worked by hand from the circle the curve tool laid.

import test from 'node:test';
import assert from 'node:assert/strict';

import { roofCover, roofPlan, roofMask, maskCount, skeletonRoofsOf, curvedLoopsOf } from '../js/roof.js';
import { addShape, curveSegment } from '../js/shapes.js';
import { createState, CELL } from '../js/grid.js';
import { takeoff, takeoffCSV, roundQty } from '../js/takeoff.js';
import { sharedQuantities } from '../js/cost.js';

const R4 = (x0, z0, x1, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
// The school `roof-curve.test.mjs` wires against: a 40 by 24 hall with its
// east wall bowed out, a 16ft room on its west side, and a separate L-shaped
// block to the south with no curve at all.
function school({ curve = true, style = 'hip', pitch = 6, courtyard = false } = {}) {
  const s = createState(30, 30);
  const hall = addShape(s, 0, R4(24, 8, 64, 32));
  addShape(s, 0, R4(8, 8, 24, 32));
  if (courtyard) {
    addShape(s, 0, R4(8, -24, 64, -12));
    addShape(s, 0, R4(8, -12, 20, 8));
    addShape(s, 0, R4(52, -12, 64, 8));
  }
  addShape(s, 0, R4(8, 60, 48, 76));
  addShape(s, 0, R4(8, 76, 24, 100));
  if (curve) assert.ok(curveSegment(hall, 0, 1, -0.4) > 3, 'the curve tool laid a curve');
  s.roof = { style, pitch, facade: 'brick' };
  return s;
}
const slopeOf = (pitch) => Math.hypot(12, pitch) / 12;
const area = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) a += pts[i].x * pts[(i + 1) % pts.length].z - pts[(i + 1) % pts.length].x * pts[i].z;
  return a / 2;
};
const maskFootprint = (s) => {
  const f = s.floors[s.floors.length - 1];
  return maskCount(roofMask(f, f.w, f.h)) * CELL * CELL;
};
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} against ${b}`);

// By hand. The L to the south is 40 by 16 plus 16 by 24. The hall and its
// neighbour are 56 by 24 to the chord at x 64, and the curve bows out to
// x 73.6, a sagitta of 9.6 on a 24ft chord: a circle of radius
// (12² + 9.6²) / (2 × 9.6) = 12.3, the arc subtending 2·asin(12 / 12.3). Cut
// into n equal chords, the piece past x 64 is the fan of n triangles from the
// centre less the one on the chord: r²/2 · (n·sin(θ/n) − sin θ).
function byHand(n) {
  const r = (12 ** 2 + 9.6 ** 2) / (2 * 9.6);
  const theta = 2 * Math.asin(12 / r);
  const segment = (r * r / 2) * (n * Math.sin(theta / n) - Math.sin(theta));
  return 40 * 16 + 16 * 24 + 56 * 24 + segment;
}

test('a hipped roof over a curve is counted off its chords, against a figure worked by hand', () => {
  const s = school();
  const [sk] = skeletonRoofsOf(s);
  assert.ok(sk, 'the hall takes the skeleton path');
  const n = sk.outline.filter((p) => p.x > 64 + 1e-9).length + 1;
  assert.ok(n >= 4, `${n} chords`);
  const cover = roofCover(s);
  near(cover.footprint, byHand(n), 1e-6, 'footprint');
  near(cover.area, byHand(n) * slopeOf(6), 1e-6, 'sloped area');
  assert.equal(cover.skeleton, 1);
  // The mask's staircase is not that figure: this is what changed.
  assert.notEqual(maskFootprint(s), cover.footprint);
});

test('every skeleton face stands at the pitch, so its sloped area is its plan area over the cosine', () => {
  // Independent of `roofCover`: the faces' own triangles, measured in 3D,
  // against the eave polygon's plan area times the slope.
  for (const pitch of [2, 4, 6, 12]) {
    const [sk] = skeletonRoofsOf(school({ pitch }));
    let true3d = 0, plan = 0;
    for (const f of sk.faces) {
      for (const [a, b, c] of f.tris) {
        const p = f.pts[a], q = f.pts[b], r = f.pts[c];
        const u = { x: q.x - p.x, y: q.y - p.y, z: q.z - p.z };
        const v = { x: r.x - p.x, y: r.y - p.y, z: r.z - p.z };
        true3d += Math.hypot(u.y * v.z - u.z * v.y, u.z * v.x - u.x * v.z, u.x * v.y - u.y * v.x) / 2;
        plan += Math.abs(u.x * v.z - u.z * v.x) / 2;
      }
    }
    let eave = 0;
    for (let i = 0; i < sk.eave.length; i++) {
      const p = sk.eave[i], q = sk.eave[(i + 1) % sk.eave.length];
      eave += (p.x * q.z - q.x * p.z) / 2;
    }
    near(plan, Math.abs(eave), 1e-6, `pitch ${pitch}: the triangles tile the eave`);
    near(true3d, plan * slopeOf(pitch), 1e-6, `pitch ${pitch}: sloped over plan`);
  }
});

test('the takeoff and the estimate both read the curved figure', () => {
  const s = school();
  const cover = roofCover(s);
  const t = takeoff(s);
  assert.equal(t.roof.footprint, cover.footprint);
  assert.equal(t.roof.area, cover.area);
  assert.equal(sharedQuantities(s).get('roof:shingle'), cover.area);
  const row = takeoffCSV(t).split('\n').find((l) => l.startsWith('Roof,'));
  assert.ok(row && row.includes(`,${roundQty(cover.area)},`), `the CSV row carries it: ${row}`);
});

test('every roof that does not take the skeleton path is the mask, figure for figure', () => {
  const cases = [
    ...['gable', 'flat'].map((style) => school({ style })),
    school({ curve: false }),
    school({ style: 'parapet', curve: false }),
  ];
  for (const s of cases) {
    assert.equal(skeletonRoofsOf(s).length, 0, `${s.roof.style}`);
    assert.ok(!roofPlan(s).deckPolys, `${s.roof.style}: no parapet on chords`);
    const pitched = s.roof.style === 'hip' || s.roof.style === 'gable';
    const want = maskFootprint(s);
    const cover = roofCover(s);
    assert.equal(cover.footprint, want, `${s.roof.style} footprint`);
    assert.equal(cover.area, want * (pitched ? slopeOf(6) : 1), `${s.roof.style} area`);
  }
});

test('a parapet over a curve with a court is counted off the outline less the court (#998)', () => {
  // Was the mask's count until #998, as the roofs above still are.
  const s = school({ style: 'parapet', courtyard: true });
  const f = curvedLoopsOf(s.floors[0]);
  assert.equal(f.length, 1);
  assert.equal(f[0].holes.length, 1);
  const lessCourt = area(f[0].outer) - Math.abs(area(f[0].holes[0]));
  const rest = 40 * 16 + 16 * 24;     // the L to the south, on whole cells
  near(roofCover(s).footprint, lessCourt + rest, 1e-9, 'outline less the court, plus the L');
  near(Math.abs(area(f[0].holes[0])), 32 * 20, 1e-9, 'the court is 32 by 20');
  // Hipped, the same outline less the court since #999, sloped.
  const hip = school({ courtyard: true });
  assert.equal(skeletonRoofsOf(hip).length, 1, 'the hip stands round the court');
  near(roofCover(hip).footprint, lessCourt + rest, 1e-9, 'hipped: outline less the court, plus the L');
  near(roofCover(hip).area, (lessCourt + rest) * slopeOf(6), 1e-9, 'sloped at 6 in 12');
});

test('roofPlan and the takeoff agree on which loops are skeleton', () => {
  const s = school();
  assert.equal(roofPlan(s).blocks.filter((b) => b.skeleton).length, roofCover(s).skeleton);
});

test('a parapet roof over a curve is counted off the chords its parapet runs on, flat', () => {
  const s = school({ style: 'parapet' });
  const plan = roofPlan(s);
  assert.equal(plan.deckPolys && plan.deckPolys.length, 1, 'the hall takes the chord parapet');
  const n = plan.deckPolys[0].pts.filter((p) => p.x > 64 + 1e-9).length + 1;
  assert.ok(n >= 4, `${n} chords`);
  const cover = roofCover(s);
  near(cover.footprint, byHand(n), 1e-6, 'footprint');
  assert.equal(cover.area, cover.footprint, 'flat: the area is the footprint');
  assert.equal(cover.chords, 1);
  assert.equal(cover.skeleton, 0);
  assert.notEqual(maskFootprint(s), cover.footprint);
  const t = takeoff(s);
  assert.equal(t.roof.area, cover.area);
  assert.equal(sharedQuantities(s).get('roof:membrane'), cover.area);
  const row = takeoffCSV(t).split('\n').find((l) => l.startsWith('Roof,'));
  assert.ok(row && row.includes(`,${roundQty(cover.area)},`), `the CSV row carries it: ${row}`);
});

test('a flat roof over the same curve has no parapet and stays on the mask', () => {
  const s = school({ style: 'flat' });
  assert.equal(roofCover(s).footprint, maskFootprint(s));
  assert.equal(roofCover(s).chords, 0);
});
