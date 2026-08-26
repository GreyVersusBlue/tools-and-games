// The ground the school stands on. Run `node --test test/*.mjs` from
// Projects/school-generator.
//
// The heightfield is checked against properties rather than against itself: a
// bilinear sample of a plane is the plane, a brush is symmetric about its
// centre, grading conserves nothing but does soften, the pad is zero under the
// building whatever was graded there, and a contour at level L only ever
// touches points whose interpolated elevation is L. Those are the things a
// transposed index or a swapped axis breaks first.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, CELL } from '../js/grid.js';
import { slabOn } from './build.mjs';
import { addShape } from '../js/shapes.js';
import {
  POST_FT, SITE_MARGIN, MAX_ELEV, PAD_APRON, PAD_BLEND, MIN_BRUSH, MAX_BRUSH, CONTOUR_FT,
  makeTerrain, terrainFor, ensureTerrain, isFlatTerrain, normalizeTerrain,
  packTerrain, postAt, postIdx, rawHeightAt, terrainField, emptyField,
  groundAt, gradeAt, normalAt, raiseTerrain, flattenTerrain, smoothTerrain,
  contours, terrainRange,
} from '../js/terrain.js';

const near = (a, b, eps, msg) =>
  assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b} (±${eps})`);

// A small square building at the grid origin, so the pad has something to
// press into.
function withBuilding(cells = 4, grid = 20) {
  const s = createState(grid, grid);
  slabOn(s, 0, [0, 0, cells - 1, cells - 1]);
  return s;
}

// ---------- the record ----------

test('a design without terrain is a design on flat ground', () => {
  const s = createState(10, 10);
  assert.equal(s.terrain, undefined);
  assert.equal(groundAt(emptyField(), 0, 0), 0);
  assert.equal(groundAt(null, 123, -456), 0);
  const f = terrainField(s);
  assert.equal(f.flat, true);
  assert.equal(groundAt(f, 40, 40), 0);
});

test('a site is sized to the building it surrounds, plus a margin', () => {
  const s = createState(40, 30);
  const t = terrainFor(s);
  assert.ok(t.x0 <= -SITE_MARGIN, 'starts a margin west of the grid');
  assert.ok(t.z0 <= -SITE_MARGIN, 'starts a margin north of the grid');
  const eastEdge = t.x0 + (t.cols - 1) * t.step;
  const southEdge = t.z0 + (t.rows - 1) * t.step;
  assert.ok(eastEdge >= 40 * CELL + SITE_MARGIN - t.step, 'reaches a margin east of the grid');
  assert.ok(southEdge >= 30 * CELL + SITE_MARGIN - t.step, 'reaches a margin south of the grid');
  assert.equal(t.step, POST_FT);
  assert.equal(t.h.length, t.cols * t.rows);
});

test('a polygon wing outside the lattice still gets a site under it', () => {
  const s = createState(10, 10);
  const near0 = terrainFor(s);
  addShape(s, 0, [
    { x: 600, z: 600 }, { x: 660, z: 600 }, { x: 660, z: 660 }, { x: 600, z: 660 },
  ]);
  const t = terrainFor(s);
  assert.ok(t.x0 + (t.cols - 1) * t.step >= 660, 'the site reaches the outlying wing');
  assert.ok(t.cols > near0.cols, 'and is bigger than it was without it');
});

test('a flat field is not written to the save file', () => {
  const t = makeTerrain(0, 0, 5, 5);
  assert.equal(isFlatTerrain(t), true);
  assert.equal(packTerrain(t), null);
  raiseTerrain(t, 40, 40, 40, 3);
  assert.equal(isFlatTerrain(t), false);
  assert.ok(packTerrain(t), 'a graded field is');
});

test('elevations are packed to a tenth of a foot', () => {
  const t = makeTerrain(0, 0, 3, 3);
  t.h[4] = 1.23456;
  assert.equal(packTerrain(t).h[4], 1.2);
});

test('a terrain survives anything a file can hand it', () => {
  assert.equal(normalizeTerrain(null), null);
  assert.equal(normalizeTerrain('nonsense'), null);
  assert.equal(normalizeTerrain({ cols: 3, rows: 3, h: [0, 0, 0, 0, 0, 0, 0, 0, 0] }), null,
    'a flat one is no terrain at all');
  const t = normalizeTerrain({
    x0: -20, z0: -20, step: 20, cols: 3, rows: 3,
    h: [1e9, -1e9, 'x', null, 5, undefined, 0, 0, 0],
  });
  assert.equal(t.h[0], MAX_ELEV, 'a mountain is clamped');
  assert.equal(t.h[1], -MAX_ELEV, 'so is a pit');
  assert.equal(t.h[2], 0, 'and nonsense reads as datum');
  assert.equal(t.h[4], 5);
  assert.equal(normalizeTerrain({ cols: 1e6, rows: 1e6, h: [] }), null, 'and a hostile size is refused');
});

// ---------- sampling ----------

test('a bilinear sample of a plane is the plane', () => {
  // Elevation = 0.1 * x, laid onto the posts exactly.
  const t = makeTerrain(0, 0, 6, 6);
  for (let r = 0; r < t.rows; r++) {
    for (let c = 0; c < t.cols; c++) t.h[postIdx(t, c, r)] = 0.1 * (c * t.step);
  }
  for (const x of [0, 7, 33.3, 60, 95]) {
    near(rawHeightAt(t, x, 0), 0.1 * x, 1e-9, `plane at x=${x}`);
    near(rawHeightAt(t, x, 41), 0.1 * x, 1e-9, `plane is z-independent at x=${x}`);
  }
});

test('past the site edge the ground keeps doing what it was doing', () => {
  const t = makeTerrain(0, 0, 4, 4);
  t.h[postIdx(t, 3, 3)] = 9;
  const edge = rawHeightAt(t, 60, 60);
  near(rawHeightAt(t, 5000, 5000), edge, 1e-9, 'held at the corner value');
  assert.equal(postAt(t, -50, -50), t.h[0], 'and a post index is clamped, never wrapped');
});

test('grade is a percent a civil drawing would recognise', () => {
  const t = makeTerrain(0, 0, 8, 8);
  // A 5% slope: one foot of rise per twenty of run, which is a post per foot.
  for (let r = 0; r < t.rows; r++) for (let c = 0; c < t.cols; c++) t.h[postIdx(t, c, r)] = c * 1;
  const s = createState(1, 1);
  s.terrain = t;
  // Sampled far from the building so the pad isn't in the way.
  const f = { flat: false, t, x0: t.x0, z0: t.z0, step: t.step, cols: t.cols, rows: t.rows, h: Float64Array.from(t.h) };
  near(gradeAt(f, 70, 70).pct, 5, 1e-6, 'one foot in twenty is 5%');
  const n = normalAt(f, 70, 70);
  assert.ok(n.x < 0, 'the normal leans away from the uphill side');
  near(Math.hypot(n.x, n.y, n.z), 1, 1e-9, 'and is a unit vector');
});

// ---------- the building pad ----------

test('the ground under the building is the slab, whatever was graded there', () => {
  const s = withBuilding(4);
  const t = ensureTerrain(s);
  // Raise a hill straight through the middle of the school.
  raiseTerrain(t, 8, 8, 120, 30);
  assert.ok(rawHeightAt(t, 8, 8) > 10, 'the raw field really was raised');
  const f = terrainField(s);
  near(groundAt(f, 8, 8), 0, 1e-9, 'but the pad holds the ground at datum');
  near(groundAt(f, 8 + PAD_APRON * 0.5, 8), 0, 1e-9, 'and across the apron too');
});

test('the pad eases back out to the graded ground rather than stepping', () => {
  const s = withBuilding(4);
  const t = ensureTerrain(s);
  raiseTerrain(t, 200, 8, MAX_BRUSH, 10);
  const f = terrainField(s);
  const inside = groundAt(f, 8, 8);
  const mid = groundAt(f, PAD_APRON + PAD_BLEND * 0.5, 8);
  const out = groundAt(f, PAD_APRON + PAD_BLEND * 2.5, 8);
  near(inside, 0, 1e-9, 'flat under the building');
  assert.ok(mid > inside + 1e-6, 'rising through the blend');
  assert.ok(out > mid, 'and higher still past it');
});

test('moving the building moves its pad — nothing is baked', () => {
  const s = withBuilding(4, 60);
  const t = ensureTerrain(s);
  raiseTerrain(t, 150, 150, MAX_BRUSH, 12);
  const before = groundAt(terrainField(s), 150, 150);
  assert.ok(before > 1, 'the far corner is graded');
  // Extend the building out over it and the pad follows.
  slabOn(s, 0, [0, 0, 49, 49]);
  near(groundAt(terrainField(s), 150, 150), 0, 1e-9, 'now it is slab');
});

test('a polygon room presses a pad as surely as a grid cell does', () => {
  const s = createState(20, 20);
  addShape(s, 0, [
    { x: 400, z: 400 }, { x: 460, z: 400 }, { x: 460, z: 460 }, { x: 400, z: 460 },
  ]);
  const t = ensureTerrain(s);
  raiseTerrain(t, 430, 430, 200, 15);
  near(groundAt(terrainField(s), 430, 430), 0, 1e-9);
});

// ---------- grading ----------

test('a brush is strongest at its centre and dies at its rim', () => {
  const t = makeTerrain(0, 0, 21, 21);
  raiseTerrain(t, 200, 200, 100, 10);
  const centre = rawHeightAt(t, 200, 200);
  const half = rawHeightAt(t, 250, 200);
  near(centre, 10, 1e-9, 'the centre gets the whole delta');
  assert.ok(half > 0 && half < centre, 'halfway out gets some of it');
  near(rawHeightAt(t, 320, 200), 0, 1e-9, 'and past the rim, none');
});

test('a brush is symmetric about its centre', () => {
  const t = makeTerrain(0, 0, 21, 21);
  raiseTerrain(t, 200, 200, 120, -6);
  for (const d of [20, 55, 100]) {
    near(rawHeightAt(t, 200 + d, 200), rawHeightAt(t, 200 - d, 200), 1e-9, `x ±${d}`);
    near(rawHeightAt(t, 200, 200 + d), rawHeightAt(t, 200, 200 - d), 1e-9, `z ±${d}`);
  }
});

test('grading reports whether it did anything', () => {
  const t = makeTerrain(0, 0, 5, 5);
  assert.equal(raiseTerrain(t, 40, 40, 40, 0), false, 'a zero delta is not an edit');
  assert.equal(raiseTerrain(t, 40, 40, 40, 2), true);
  assert.equal(raiseTerrain(t, 5000, 5000, MIN_BRUSH, 2), false, 'nor is one off the site');
});

test('a brush cannot dig past the elevation rails', () => {
  const t = makeTerrain(0, 0, 5, 5);
  for (let i = 0; i < 40; i++) raiseTerrain(t, 40, 40, 100, 20);
  assert.equal(Math.max(...t.h), MAX_ELEV);
});

test('flatten pulls toward the mean under the brush', () => {
  const t = makeTerrain(0, 0, 11, 11);
  t.h[postIdx(t, 5, 5)] = 20;
  const before = rawHeightAt(t, 100, 100);
  flattenTerrain(t, 100, 100, 80, null, 1);
  const after = rawHeightAt(t, 100, 100);
  assert.ok(after < before, 'the spike comes down');
  assert.ok(after > 0, 'and the ground around it comes up to meet it');
});

test('flatten to a stated elevation lands on it', () => {
  const t = makeTerrain(0, 0, 11, 11);
  flattenTerrain(t, 100, 100, 60, 7, 1);
  near(rawHeightAt(t, 100, 100), 7, 1e-9);
});

test('smoothing takes the stairsteps out of a slope', () => {
  const t = makeTerrain(0, 0, 11, 11);
  // A single-post spike is the roughest thing this lattice can hold.
  t.h[postIdx(t, 5, 5)] = 10;
  const roughness = () => {
    let s = 0;
    for (let r = 1; r < t.rows - 1; r++) {
      for (let c = 1; c < t.cols - 1; c++) {
        const h = t.h[postIdx(t, c, r)];
        s += Math.abs(h - t.h[postIdx(t, c - 1, r)]) + Math.abs(h - t.h[postIdx(t, c, r - 1)]);
      }
    }
    return s;
  };
  const before = roughness();
  smoothTerrain(t, 100, 100, 100, 1);
  assert.ok(roughness() < before, 'less total step between neighbours');
  assert.ok(t.h[postIdx(t, 5, 5)] < 10, 'the spike itself came down');
});

// ---------- contours ----------

test('flat ground has no contours', () => {
  assert.deepEqual(contours(emptyField()), []);
  const s = createState(10, 10);
  assert.deepEqual(contours(terrainField(s)), []);
});

test('a contour only touches points at its own elevation', () => {
  const s = createState(20, 20);
  const t = ensureTerrain(s);
  raiseTerrain(t, 200, 200, 150, 9);
  const f = terrainField(s);
  const lines = contours(f, CONTOUR_FT);
  assert.ok(lines.length >= 3, 'a nine-foot mound crosses several two-foot lines');
  for (const line of lines) {
    for (const [a, b] of line.segs) {
      near(groundAt(f, a.x, a.z), line.level, 0.05, `segment start at ${line.level}ft`);
      near(groundAt(f, b.x, b.z), line.level, 0.05, `segment end at ${line.level}ft`);
    }
  }
});

test('contour levels come out on the interval, in order', () => {
  const s = createState(20, 20);
  const t = ensureTerrain(s);
  raiseTerrain(t, 200, 200, 180, 11);
  const lines = contours(terrainField(s), 2);
  for (let i = 0; i < lines.length; i++) {
    near(lines[i].level % 2, 0, 1e-6, 'on the interval');
    if (i) assert.ok(lines[i].level > lines[i - 1].level, 'ascending');
  }
});

test('the range readout is the field the walker actually stands on', () => {
  const s = withBuilding(4);
  const t = ensureTerrain(s);
  raiseTerrain(t, 220, 220, MAX_BRUSH, 14);
  raiseTerrain(t, -150, -150, MAX_BRUSH, -6);
  const r = terrainRange(terrainField(s));
  assert.ok(r.hi > 5 && r.hi <= 14, 'high point is the graded mound, pad-blended');
  assert.ok(r.lo < -1 && r.lo >= -6, 'low point is the hollow');
  near(r.relief, r.hi - r.lo, 1e-9);
  assert.deepEqual(terrainRange(emptyField()), { lo: 0, hi: 0, relief: 0 });
});
