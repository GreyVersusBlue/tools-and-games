// touch.js — pure math for touch input: pinch-zoom/pan for the edit view, a
// virtual joystick's axes, and touch-look's camera delta. No DOM, no
// three.js — the same split propplace.js/collide.js use for their own
// arithmetic, so this is unit-tested (test/touch.test.mjs) without a browser.

export const MIN_VIEW_HEIGHT = 30;
export const MAX_VIEW_HEIGHT = 1000;

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// True on a device that can receive touch input at all. Used to decide
// whether the editor arms its pinch/pan gesture recognizer and whether the
// walkthrough offers pointer-lock mouse look or a touch joystick plus
// drag-to-look instead — a touchscreen laptop with a mouse still gets the
// touch flow, since Pointer Lock is unreliable-to-absent on the touch side
// of a hybrid device and the touch flow works fine with a mouse too.
export function isTouchCapable(nav = (typeof navigator !== 'undefined' ? navigator : null), win = (typeof window !== 'undefined' ? window : null)) {
  if (win && 'ontouchstart' in win) return true;
  return !!(nav && nav.maxTouchPoints > 0);
}

// Pinch-to-zoom: given the edit view's height at gesture start and the pinch
// distance at gesture start vs. now, the new (clamped) view height. Fingers
// coming together (distance shrinks) zooms out — a bigger height shows more
// of the building — matching the standard pinch convention.
export function pinchZoomHeight(height0, dist0, dist) {
  const d0 = Math.max(1, dist0), d = Math.max(1, dist);
  return clamp(height0 * (d0 / d), MIN_VIEW_HEIGHT, MAX_VIEW_HEIGHT);
}

// A virtual joystick: the knob's raw pixel offset from the base's center,
// clamped to the base's radius, returned as forward/right axes in [-1, 1].
// "Up" on screen is forward (+y) — the sign flip on dy is what makes that
// true, since screen Y grows downward but the W key's `fwd` axis is
// positive going forward.
export function joystickAxes(dx, dy, maxR) {
  if (!(maxR > 0)) return { x: 0, y: 0 };
  const r = Math.hypot(dx, dy);
  const k = r > maxR ? maxR / r : 1;
  // `|| 0` folds a -0 result (dx or dy exactly 0) back to a plain 0 — cosmetic,
  // but it's what callers and tests reasonably expect "centered" to mean.
  return { x: clamp((dx * k) / maxR, -1, 1) || 0, y: clamp((-dy * k) / maxR, -1, 1) || 0 };
}

// Touch-look: the same yaw/pitch update PointerLockControls applies from a
// locked pointer's movementX/Y, generalized to any drag delta so it also
// drives from a touchmove pair. `euler` is the camera's current {x, y}
// (pitch, yaw) in radians; returns the next {x, y}, pitch clamped to the
// controls' polar-angle limits the same way the mouse path is.
export function lookEulerDelta(euler, dx, dy, pointerSpeed, minPolar, maxPolar) {
  const PI_2 = Math.PI / 2;
  const y = euler.y - dx * 0.002 * pointerSpeed;
  const x = clamp(euler.x - dy * 0.002 * pointerSpeed, PI_2 - maxPolar, PI_2 - minPolar);
  return { x, y };
}
