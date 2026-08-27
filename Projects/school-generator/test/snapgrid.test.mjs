// snapgrid.test.mjs — the zoom-dependent drawing grid and the point target.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CELL } from '../js/grid.js';
import {
  PITCHES, MAX_LINES, MIN_PITCH, MAX_PITCH,
  gridPitch, majorEvery, snapValue, snapToGrid, snapDistance,
  orthoPoint, targetPoint, runLength, runAngle, runLabel, isAxisRun,
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
  assert.equal(majorEvery(1) * 1, CELL);
  assert.equal(majorEvery(2) * 2, CELL);
  assert.equal(majorEvery(0.5) * 0.5, CELL);
  assert.equal(majorEvery(CELL) * CELL, 20, 'at the cell it is the 20ft rule');
});

test('snapping lands on intersections of the pitch', () => {
  assert.equal(snapValue(9.4, 4), 8);
  assert.equal(snapValue(10.1, 4), 12);
  assert.equal(snapValue(-2.1, 1), -2);
  assert.deepEqual(snapToGrid(9.4, 10.1, 4), { x: 8, z: 12 });
  assert.equal(snapValue(7, 0), 7, 'a zero pitch is no grid at all');
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

test('a run that comes back to 360 reads as 0, not as 360', () => {
  // runAngle normalizes to [0, 360), so a bearing a whisker under 360 rounds
  // up and out of the range the label is supposed to speak in.
  const a = { x: 0, z: 0 };
  const almost = { x: 20, z: -0.01 };
  assert.ok(runAngle(a, almost) > 359.9);
  assert.equal(runLabel(a, almost), '20 ft · 0.0°');
});
