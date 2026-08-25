// Pure touch-input math: capability sniffing, pinch-zoom, the virtual
// joystick's axes, and touch-look's euler delta. Run `node --test` from
// Projects/school-generator.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MIN_VIEW_HEIGHT, MAX_VIEW_HEIGHT,
  isTouchCapable, pinchZoomHeight, joystickAxes, lookEulerDelta,
} from '../js/touch.js';

// ---------- isTouchCapable ----------

test('isTouchCapable reads ontouchstart off the window', () => {
  assert.equal(isTouchCapable({ maxTouchPoints: 0 }, { ontouchstart: null }), true);
  assert.equal(isTouchCapable({ maxTouchPoints: 0 }, {}), false);
});

test('isTouchCapable falls back to navigator.maxTouchPoints', () => {
  assert.equal(isTouchCapable({ maxTouchPoints: 5 }, {}), true);
  assert.equal(isTouchCapable({ maxTouchPoints: 0 }, {}), false);
});

test('isTouchCapable tolerates a missing navigator/window', () => {
  assert.equal(isTouchCapable(null, null), false);
  assert.equal(isTouchCapable(undefined, undefined), false);
});

// ---------- pinchZoomHeight ----------

test('pinchZoomHeight zooms in as fingers spread apart', () => {
  const h = pinchZoomHeight(140, 100, 200);
  assert.ok(h < 140, 'distance grew, so the view height should shrink');
  assert.equal(h, 70);
});

test('pinchZoomHeight zooms out as fingers come together', () => {
  const h = pinchZoomHeight(140, 200, 100);
  assert.equal(h, 280);
});

test('pinchZoomHeight is a no-op when the pinch distance is unchanged', () => {
  assert.equal(pinchZoomHeight(140, 150, 150), 140);
});

test('pinchZoomHeight clamps to the min/max view height', () => {
  assert.equal(pinchZoomHeight(140, 10, 100000), MIN_VIEW_HEIGHT);
  assert.equal(pinchZoomHeight(140, 100000, 10), MAX_VIEW_HEIGHT);
});

test('pinchZoomHeight tolerates a zero or negative starting distance', () => {
  assert.equal(pinchZoomHeight(140, 0, 50), MIN_VIEW_HEIGHT);
  assert.ok(Number.isFinite(pinchZoomHeight(140, -5, 50)));
});

// ---------- joystickAxes ----------

test('joystickAxes is centered at rest', () => {
  assert.deepEqual(joystickAxes(0, 0, 40), { x: 0, y: 0 });
});

test('joystickAxes maps screen-up to forward (+y) and screen-right to +x', () => {
  const up = joystickAxes(0, -40, 40);
  assert.equal(up.y, 1);
  assert.equal(up.x, 0);
  const right = joystickAxes(40, 0, 40);
  assert.equal(right.x, 1);
  assert.equal(right.y, 0);
  const down = joystickAxes(0, 40, 40);
  assert.equal(down.y, -1);
});

test('joystickAxes scales linearly inside the base radius', () => {
  const half = joystickAxes(20, 0, 40);
  assert.equal(half.x, 0.5);
});

test('joystickAxes clamps a drag beyond the base radius to the unit circle', () => {
  const far = joystickAxes(400, 0, 40);
  assert.equal(far.x, 1);
  assert.equal(far.y, 0);
  const diag = joystickAxes(400, -400, 40);
  const mag = Math.hypot(diag.x, diag.y);
  assert.ok(mag <= 1 + 1e-9, `diagonal drag should clamp to the unit circle, got magnitude ${mag}`);
  assert.ok(Math.abs(diag.x - diag.y) < 1e-9, 'an equal diagonal drag should clamp symmetrically');
});

test('joystickAxes tolerates a zero-radius base', () => {
  assert.deepEqual(joystickAxes(10, 10, 0), { x: 0, y: 0 });
});

// ---------- lookEulerDelta ----------

test('lookEulerDelta turns yaw left/right opposite the drag sign, mouselook convention', () => {
  const start = { x: 0, y: 0 };
  const right = lookEulerDelta(start, 100, 0, 1, 0, Math.PI);
  assert.ok(right.y < 0, 'dragging right should turn the yaw negative, same as PointerLockControls');
  const left = lookEulerDelta(start, -100, 0, 1, 0, Math.PI);
  assert.ok(left.y > 0);
  assert.equal(right.y, -left.y);
});

test('lookEulerDelta pitches opposite the vertical drag sign', () => {
  const start = { x: 0, y: 0 };
  const up = lookEulerDelta(start, 0, -100, 1, 0, Math.PI);
  assert.ok(up.x > 0, 'dragging up should pitch the view up (positive x euler)');
});

test('lookEulerDelta scales with pointerSpeed', () => {
  const start = { x: 0, y: 0 };
  const slow = lookEulerDelta(start, 100, 0, 0.5, 0, Math.PI);
  const fast = lookEulerDelta(start, 100, 0, 2, 0, Math.PI);
  assert.ok(Math.abs(fast.y) > Math.abs(slow.y));
  assert.equal(fast.y, slow.y * 4);
});

test('lookEulerDelta clamps pitch to the polar angle limits', () => {
  const start = { x: 0, y: 0 };
  // A huge upward drag should clamp at the min polar angle (looking straight up).
  const minPolar = 0.3, maxPolar = Math.PI - 0.3;
  const pegged = lookEulerDelta(start, 0, -1e6, 1, minPolar, maxPolar);
  assert.equal(pegged.x, Math.PI / 2 - minPolar);
  const peggedDown = lookEulerDelta(start, 0, 1e6, 1, minPolar, maxPolar);
  assert.equal(peggedDown.x, Math.PI / 2 - maxPolar);
});

test('lookEulerDelta accumulates from a non-zero starting euler', () => {
  const start = { x: 0.2, y: 1.1 };
  const next = lookEulerDelta(start, 0, 0, 1, 0, Math.PI);
  assert.equal(next.x, 0.2);
  assert.equal(next.y, 1.1);
});
