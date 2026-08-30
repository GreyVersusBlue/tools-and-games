// snapgrid.test.mjs — the zoom-dependent drawing grid and the point target.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CELL } from '../js/grid.js';
import {
  PITCHES, MAX_LINES, MIN_PITCH, MAX_PITCH, ORIGIN, asOrigin,
  gridPitch, majorEvery, snapValue, snapToGrid, snapDistance,
  orthoPoint, targetPoint, runLength, runAngle, runLabel, isAxisRun,
  tileAt, tileBounds, tileCentre, tileUnder, tileSpan, spanBounds,
  snapAlongSeg,
} from '../js/snapgrid.js';

test('the ladder doubles and carries the 4ft cell', () => {
  assert.ok(PITCHES.includes(CELL), 'the paint brush\'s cell is a pitch');
  for (let i = 1; i < PITCHES.length; i++) {
    assert.equal(PITCHES[i], PITCHES[i - 1] * 2);
  }
});

test('the default zoom still draws the 4ft cell', () => {
  // render.js frames a fresh 40x30 plan at about 138ft of view height.
  assert.equal(gridPitch(140), CELL);
});

test('two feet is the floor, and it is the smallest square a plan is made of', () => {
  assert.equal(MIN_PITCH, 2);
  assert.equal(PITCHES[0], 2, 'nothing finer is on the ladder');
  // However far in you go, the tile stays something you could stand in.
  for (let h = 1; h <= 40; h += 1) assert.ok(gridPitch(h) >= 2);
});

test('zooming in subdivides, zooming out coarsens', () => {
  assert.ok(gridPitch(30) < CELL, 'the closest zoom is finer than a cell');
  assert.ok(gridPitch(1000) > CELL, 'the widest zoom is coarser');
  assert.equal(gridPitch(1000), MAX_PITCH);
});

test('the pitch never coarsens as the view shrinks', () => {
  let last = Infinity;
  for (let h = 1000; h >= 20; h -= 5) {
    const p = gridPitch(h);
    assert.ok(p <= last, `pitch grew at ${h}ft of view`);
    last = p;
  }
});

test('whatever the zoom, the view stays legible', () => {
  for (let h = 20; h <= 1200; h += 7) {
    const p = gridPitch(h);
    assert.ok(p >= MIN_PITCH && p <= MAX_PITCH);
    if (p !== MAX_PITCH) assert.ok(h / p <= MAX_LINES, `${h}ft of view drew too many lines`);
  }
});

test('a nonsense view height falls back rather than throwing', () => {
  assert.equal(gridPitch(0), CELL);
  assert.equal(gridPitch(NaN), CELL);
  assert.equal(gridPitch(-40), CELL);
});

test('the heavy line falls on the 4ft cell once the grid is finer than one', () => {
  assert.equal(majorEvery(2) * 2, CELL);
  assert.equal(majorEvery(CELL) * CELL, 20, 'at the cell it is the 20ft rule');
});

test('every step of the ladder is a whole number of the finest one', () => {
  for (const p of PITCHES) assert.equal(p % MIN_PITCH, 0, `${p}ft does not subdivide ${MIN_PITCH}ft`);
});

test('snapping lands on intersections of the pitch', () => {
  assert.equal(snapValue(9.4, 4), 8);
  assert.equal(snapValue(10.1, 4), 12);
  assert.equal(snapValue(-2.1, 1), -2);
  assert.deepEqual(snapToGrid(9.4, 10.1, 4), { x: 8, z: 12 });
  assert.equal(snapValue(7, 0), 7, 'a zero pitch is no grid at all');
});

test('the grid can start somewhere other than the corner', () => {
  // A 4ft grid counted from x = 1.5 has lines at 1.5, 5.5, 9.5...
  assert.equal(snapValue(5.4, 4, 1.5), 5.5);
  assert.equal(snapValue(3.4, 4, 1.5), 1.5);
  assert.deepEqual(snapToGrid(5.4, 3.4, 4, { x: 1.5, z: 1.5 }), { x: 5.5, z: 1.5 });
  // ...and no origin is the corner, which is what every caller before it meant.
  assert.deepEqual(snapToGrid(9.4, 10.1, 4), snapToGrid(9.4, 10.1, 4, ORIGIN));
  assert.deepEqual(asOrigin(null), ORIGIN);
  assert.deepEqual(asOrigin({ x: NaN, z: 1 }), ORIGIN);
  assert.deepEqual(asOrigin({ x: 2, z: 3 }), { x: 2, z: 3 });
});

test('an ortho run off a moved grid still lands on it', () => {
  const o = { x: 1.5, z: 1.5 };
  const from = targetPoint(5.4, 3.4, { pitch: 4, origin: o });
  assert.deepEqual(from, { x: 5.5, z: 1.5 });
  const to = targetPoint(25.2, 4.9, { pitch: 4, origin: o, from, ortho: true });
  assert.deepEqual(to, { x: 25.5, z: 1.5 });
  assert.equal(snapValue(to.x, 4, o.x), to.x);
});

test('the snap distance is how far the cursor was moved', () => {
  assert.ok(Math.abs(snapDistance(8, 12, 4)) < 1e-9);
  assert.ok(Math.abs(snapDistance(9, 12, 4) - 1) < 1e-9);
});

test('the parallel toggle keeps the longer run and squares the other off', () => {
  assert.deepEqual(orthoPoint({ x: 0, z: 0 }, { x: 12, z: 3 }), { x: 12, z: 0 });
  assert.deepEqual(orthoPoint({ x: 0, z: 0 }, { x: 3, z: 12 }), { x: 0, z: 12 });
  assert.deepEqual(orthoPoint(null, { x: 3, z: 12 }), { x: 3, z: 12 });
});

test('an ortho run still has both ends on the grid', () => {
  const from = targetPoint(3.9, 7.6, { pitch: 4 });
  assert.deepEqual(from, { x: 4, z: 8 });
  const to = targetPoint(25.2, 10.9, { pitch: 4, from, ortho: true });
  assert.deepEqual(to, { x: 24, z: 8 });
  assert.equal(snapValue(to.x, 4), to.x);
  assert.equal(snapValue(to.z, 4), to.z);
});

test('freeform leaves the angle alone but still finds the intersection', () => {
  const from = { x: 4, z: 8 };
  assert.deepEqual(targetPoint(25.2, 10.9, { pitch: 4, from, ortho: false }), { x: 24, z: 12 });
});

test('snapping can be switched off outright', () => {
  const p = targetPoint(25.2, 10.9, { pitch: 4, snap: false });
  assert.deepEqual(p, { x: 25.2, z: 10.9 });
});

test('a run reads back its length and bearing', () => {
  const a = { x: 0, z: 0 };
  assert.equal(runLength(a, { x: 3, z: 4 }), 5);
  assert.equal(runAngle(a, { x: 10, z: 0 }), 0);
  assert.equal(runAngle(a, { x: 0, z: 10 }), 90);
  assert.equal(runAngle(a, { x: -10, z: 0 }), 180);
  assert.equal(runAngle(a, { x: 0, z: -10 }), 270);
  assert.equal(runLabel(a, { x: 24, z: 0 }), '24 ft · 0°');
  assert.equal(runLabel(a, { x: 0, z: 6 }), '6.0 ft · 90°');
});

test('square runs are recognised however they were drawn', () => {
  assert.ok(isAxisRun({ x: 0, z: 0 }, { x: 20, z: 0 }));
  assert.ok(isAxisRun({ x: 4, z: 0 }, { x: 4, z: 20 }));
  assert.ok(!isAxisRun({ x: 0, z: 0 }, { x: 20, z: 4 }));
});

test('the readout does not round a near-miss into a right angle', () => {
  const a = { x: 0, z: 0 };
  // Genuinely square: the round number is the truth, so print it.
  assert.equal(runLabel(a, { x: 24, z: 0 }), '24 ft · 0°');
  assert.equal(runLabel(a, { x: 0, z: 24 }), '24 ft · 90°');
  // A hair off square rounds to 90 too — and that is the one reading a
  // rounded angle must not give, because it is indistinguishable from the
  // reading above and means something different.
  const off = { x: 0.004, z: 24 };
  assert.ok(!isAxisRun(a, off));
  assert.equal(Math.round(runAngle(a, off)), 90, 'rounding alone would have said 90');
  assert.equal(runLabel(a, off), '24 ft · 90.0°', 'so it spends a decimal saying it is not');
  // An angle that was never going to round to a right angle is untouched.
  assert.equal(runLabel(a, { x: 20, z: 20 }), '28 ft · 45°');
});

test('sliding along an axis wall lands on true grid intersections', () => {
  const a = { x: 4, z: 8 }, b = { x: 28, z: 8 };
  const hit = snapAlongSeg(a, b, 13.3, 9.1, 2);
  assert.equal(hit.x, 14);
  assert.equal(hit.z, 8);
  assert.equal(hit.s, 10);
  assert.ok(Math.abs(hit.t - 10 / 24) < 1e-9);
});

test('an off-grid axis wall still snaps to the world grid, not its own ends', () => {
  // Drawn with Alt: starts at x=4.7. The marks are still the world's, so the
  // snapped x is a grid multiple even though no distance-from-start is.
  const a = { x: 4.7, z: 8 }, b = { x: 28.7, z: 8 };
  const hit = snapAlongSeg(a, b, 13.3, 8, 2);
  assert.equal(hit.x, 14);
  assert.ok(Math.abs(hit.s - 9.3) < 1e-9);
});

test('a diagonal wall snaps to pitch multiples measured from its own start', () => {
  // A 45° wall crosses no intersections; the ruler is distance-from-start.
  const a = { x: 0, z: 0 }, b = { x: 24, z: 24 };
  const hit = snapAlongSeg(a, b, 5, 6, 4);
  assert.equal(snapValue(hit.s, 4), hit.s, 'the along-wall distance is a pitch multiple');
  assert.ok(Math.abs(hit.x - hit.z) < 1e-9, 'and the point stays on the wall');
});

test('the slide clamps at both ends of the wall', () => {
  const a = { x: 4, z: 8 }, b = { x: 16, z: 8 };
  assert.equal(snapAlongSeg(a, b, -50, 8, 2).s, 0);
  assert.equal(snapAlongSeg(a, b, 90, 8, 2).s, 12);
  assert.equal(snapAlongSeg(a, b, 90, 8, 2).t, 1);
});

test('a finer pitch offers finer marks on the same wall', () => {
  const a = { x: 0, z: 0 }, b = { x: 20, z: 0 };
  assert.equal(snapAlongSeg(a, b, 5.3, 0, 4).x, 4);
  assert.equal(snapAlongSeg(a, b, 5.3, 0, 2).x, 6);
  assert.equal(snapAlongSeg(a, b, 4.9, 0, 2).x, 4);
});

test('the slide follows the grid reference point, like every other snap', () => {
  // Phase 35 gave the grid a movable origin; the marks on the wall move with
  // it, so a door lines up with the same lines the floor tiles do.
  const a = { x: 0, z: 0 }, b = { x: 20, z: 0 };
  assert.equal(snapAlongSeg(a, b, 5.3, 0, 4, { origin: { x: 1, z: 0 } }).x, 5);
  assert.equal(snapAlongSeg(a, b, 5.3, 0, 4, { origin: { x: -1, z: 7 } }).x, 7);
});

test('the slide can run free of the grid outright', () => {
  const a = { x: 0, z: 0 }, b = { x: 20, z: 0 };
  const hit = snapAlongSeg(a, b, 5.3, 2.2, 4, { snap: false });
  assert.ok(Math.abs(hit.s - 5.3) < 1e-9, 'free mode is the raw projection');
  assert.equal(hit.z, 0, 'but still on the wall');
});

test('a zero-length wall answers its own single point', () => {
  const a = { x: 6, z: 6 };
  assert.deepEqual(snapAlongSeg(a, a, 30, 30, 4), { t: 0, s: 0, x: 6, z: 6 });
});

test('a run that comes back to 360 reads as 0, not as 360', () => {
  // runAngle normalizes to [0, 360), so a bearing a whisker under 360 rounds
  // up and out of the range the label is supposed to speak in.
  const a = { x: 0, z: 0 };
  const almost = { x: 20, z: -0.01 };
  assert.ok(runAngle(a, almost) > 359.9);
  assert.equal(runLabel(a, almost), '20 ft · 0.0°');
});

// ---------- tiles ----------

test('a point falls in exactly one tile, whichever corner it is near', () => {
  assert.deepEqual(tileAt(0.1, 0.1, 4), { ix: 0, iz: 0 });
  assert.deepEqual(tileAt(3.9, 3.9, 4), { ix: 0, iz: 0 });
  // A point on a line belongs to the tile on its + side, as Math.floor says.
  assert.deepEqual(tileAt(4, 4, 4), { ix: 1, iz: 1 });
  assert.deepEqual(tileAt(-0.1, -0.1, 4), { ix: -1, iz: -1 });
});

test('a tile is a square of the pitch, wherever the grid starts', () => {
  assert.deepEqual(tileBounds(2, 1, 4), { x0: 8, z0: 4, x1: 12, z1: 8 });
  assert.deepEqual(tileCentre(2, 1, 4), { x: 10, z: 6 });
  assert.deepEqual(tileBounds(0, 0, 2, { x: 1.5, z: 1.5 }),
    { x0: 1.5, z0: 1.5, x1: 3.5, z1: 3.5 });
});

test('the tile under the cursor is the one the cursor is in', () => {
  const t = tileUnder(9.4, 10.1, 4);
  assert.deepEqual(t, { x0: 8, z0: 8, x1: 12, z1: 12 });
  const off = tileUnder(9.4, 10.1, 4, { x: 1.5, z: 1.5 });
  assert.ok(off.x0 <= 9.4 && off.x1 > 9.4);
  assert.equal(off.x1 - off.x0, 4);
});

test('a drag covers whole tiles at both ends, and never fewer than one', () => {
  const a = { x: 5, z: 5 }, b = { x: 13, z: 9 };
  const span = tileSpan(a, b, 4);
  assert.deepEqual(span, { ix0: 1, ix1: 3, iz0: 1, iz1: 2, w: 3, h: 2 });
  assert.deepEqual(spanBounds(span, 4), { x0: 4, z0: 4, x1: 16, z1: 12 });
  // A drag that never leaves one square still lays that square.
  const one = tileSpan(a, { x: 5.5, z: 5.5 }, 4);
  assert.equal(one.w, 1);
  assert.equal(one.h, 1);
});

test('a span is the same whichever corner the drag started in', () => {
  const a = { x: 5, z: 5 }, b = { x: 13, z: 9 };
  assert.deepEqual(tileSpan(a, b, 4), tileSpan(b, a, 4));
});

test('at the finest pitch a tile is 2ft square', () => {
  const t = tileUnder(7.1, 3.2, MIN_PITCH);
  assert.equal(t.x1 - t.x0, 2);
  assert.equal(t.z1 - t.z0, 2);
});
