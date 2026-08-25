// xr.js — the school at 1:1, in a headset.
//
// `renderer.xr` is core three.js, so the wishlist's "no new deps" price on
// this item is genuinely zero — but the *arithmetic* of standing inside a
// building is not nothing, and it is what lives here: where the rig has to
// stand so that a real body's feet land on the storey it is on, what a
// thumbstick means once a head is free to look somewhere else, and how to
// turn without making anybody ill. All of it pure, so it runs under
// `node --test` where no headset exists; render.js owns the session, the same
// way it owns the renderer and audio.js owns the Web Audio graph.
//
// Three decisions, stated because they are the ones that make VR either
// comfortable or unbearable:
//
//   1. **The floor is the floor.** WebXR's `local-floor` reference space puts
//      its origin at the physical floor of the room you are standing in, so a
//      6ft person is 6ft tall in the model with no calibration — which is the
//      entire reward for Phase 1's insistence that every prop be at real
//      scale. Standing in a 10ft corridor should feel like a corridor.
//   2. **You move a rig, not a camera.** The headset drives the camera and
//      nothing else may write to it; teleporting or walking means moving the
//      *parent* of that camera and letting the head keep its own offset. Half
//      the bugs in amateur VR are somebody assigning to camera.position.
//   3. **Turning is snapped by default.** A smoothly rotating world is the
//      single most reliable way to make a person motion-sick; a 30 degree
//      snap is not. Smooth turning is offered, because a minority strongly
//      prefer it, and it is never the default.

export const XR_MODE = 'immersive-vr';
// `local-floor` first because it is what puts the model's floor under real
// feet; `local` is the fallback, and a seated headset that only offers
// `viewer` gets a stated refusal rather than a school buried in the ground.
export const REFERENCE_SPACES = ['local-floor', 'local'];

// Slower than the desktop walk (12 ft/s): in a headset, desktop walking speed
// reads as a car.
export const XR_SPEED = 7;    // ft/s
export const XR_SPRINT = 13;  // ft/s

export const DEADZONE = 0.18;
export const SNAP_ANGLE = Math.PI / 6; // 30 degrees
export const SMOOTH_TURN_RATE = Math.PI / 1.6; // radians per second at full deflection
// A snap fires once past this and rearms below the second — a single
// threshold would spin the world for as long as the stick was held over.
export const TURN_PRESS = 0.7;
export const TURN_RELEASE = 0.35;

export const TURN_MODES = ['snap', 'smooth'];

const num = (v, f = 0) => (Number.isFinite(v) ? v : f);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------- is there a headset ----------

// Asks the browser, without assuming there is one to ask. Returns a record
// rather than a boolean so the button can say *why* it is disabled — "this
// browser has no WebXR" and "this browser has WebXR but no headset attached"
// are different sentences to somebody who just plugged one in.
export async function xrAvailability(xr) {
  if (!xr || typeof xr.isSessionSupported !== 'function') {
    return { supported: false, reason: 'no-webxr', note: 'This browser has no WebXR — try Chrome, Edge or a headset browser.' };
  }
  try {
    const ok = await xr.isSessionSupported(XR_MODE);
    return ok
      ? { supported: true, reason: 'ok', note: 'Put the headset on and walk the building at full size.' }
      : { supported: false, reason: 'no-device', note: 'WebXR is here, but no VR headset is connected.' };
  } catch (err) {
    return { supported: false, reason: 'error', note: `WebXR could not be reached: ${err.message || err}` };
  }
}

export function describeXR(status) {
  if (!status) return '';
  return status.supported ? 'VR ready' : status.note;
}

// ---------- the rig ----------

// Where the rig must stand so that the *head* ends up at `target`. The
// headset reports its own position within the reference space; subtracting it
// is what lets somebody lean around a corner without the building following
// them.
//
// `y` is the storey's own floor height and is not adjusted by the head at
// all: the person's real height is their height in the model, which is the
// whole point of item 1 above.
export function rigPosition(target, head = {}, floorY = 0) {
  return {
    x: num(target.x) - num(head.x),
    y: num(floorY),
    z: num(target.z) - num(head.z),
  };
}

// Where the head actually is in the world, given a rig — the inverse, for
// everything that asks the walkthrough "where are you standing" (the
// collider, the minimap, the audio listener).
export function headPosition(rig = {}, head = {}) {
  return {
    x: num(rig.x) + num(head.x),
    y: num(rig.y) + num(head.y),
    z: num(rig.z) + num(head.z),
  };
}

// Turning the rig has to turn it *about the head*, or a snap turn swings the
// body around the room instead of turning it on the spot. This is the one
// piece of arithmetic that everybody gets wrong the first time.
export function rotateRigAbout(rig, pivot, angle) {
  const dx = num(rig.x) - num(pivot.x);
  const dz = num(rig.z) - num(pivot.z);
  const c = Math.cos(angle), s = Math.sin(angle);
  return {
    x: num(pivot.x) + dx * c - dz * s,
    z: num(pivot.z) + dx * s + dz * c,
    y: num(rig.y),
    yaw: num(rig.yaw) + angle,
  };
}

// ---------- the sticks ----------

// A thumbstick, with its deadzone taken out and the remainder rescaled so
// that the first millimetre past the deadzone is a *slow* walk rather than a
// jump to 18% speed.
export function stickVector(x, y, dead = DEADZONE) {
  const mag = Math.hypot(num(x), num(y));
  const dz = clamp(num(dead, DEADZONE), 0, 0.9);
  if (mag <= dz) return { x: 0, y: 0, mag: 0 };
  const scaled = Math.min(1, (mag - dz) / (1 - dz));
  return { x: (num(x) / mag) * scaled, y: (num(y) / mag) * scaled, mag: scaled };
}

// Stick to world feet. `heading` is whichever yaw the caller has decided
// movement is relative to — the head's, which is what most people expect, or
// a controller's, which is what people who have used a lot of VR expect. The
// axes match a gamepad's: +x right, +y *back* (WebXR reports a stick pushed
// forward as negative y, the same as every gamepad API since 2005).
export function moveVector(stick, heading, speed = XR_SPEED, dt = 1 / 72) {
  const fwd = -num(stick.y);
  const right = num(stick.x);
  if (!fwd && !right) return { dx: 0, dz: 0 };
  const h = num(heading);
  // Forward is (-sin h, -cos h); right is that turned a quarter clockwise.
  const dx = fwd * -Math.sin(h) + right * Math.cos(h);
  const dz = fwd * -Math.cos(h) + right * -Math.sin(h);
  const mag = Math.hypot(dx, dz) || 1;
  const step = Math.min(1, Math.hypot(fwd, right)) * num(speed) * Math.max(0, num(dt));
  // `|| 0` rather than bare arithmetic: a heading of exactly zero produces a
  // negative zero here, and a caller comparing a delta against 0 (or a test
  // using Object.is) would find them different.
  return { dx: (dx / mag) * step || 0, dz: (dz / mag) * step || 0 };
}

// ---------- turning ----------

// A latched snap turn. `latched` in, `latched` out — the caller keeps one
// boolean per hand and this decides when a turn fires.
export function snapTurn(latched, x, opts = {}) {
  const angle = num(opts.angle, SNAP_ANGLE);
  const press = num(opts.press, TURN_PRESS);
  const release = num(opts.release, TURN_RELEASE);
  const v = num(x);
  if (latched) {
    // Rearm only once the stick has come back near the middle.
    return { turn: 0, latched: Math.abs(v) > release };
  }
  if (v > press) return { turn: -angle, latched: true };
  if (v < -press) return { turn: angle, latched: true };
  return { turn: 0, latched: false };
}

// The alternative, for the minority who want it: a continuous turn, with the
// same deadzone the movement stick uses so a resting thumb doesn't drift.
export function smoothTurn(x, dt, rate = SMOOTH_TURN_RATE, dead = DEADZONE) {
  const s = stickVector(num(x), 0, dead);
  return -s.x * num(rate) * Math.max(0, num(dt)) || 0;
}

// One entry point, so the caller doesn't branch on the comfort setting: it
// hands in the mode and gets back the same shape either way.
export function turnStep(mode, latched, x, dt, opts = {}) {
  if (mode === 'smooth') return { turn: smoothTurn(x, dt, opts.rate, opts.dead), latched: false };
  return snapTurn(latched, x, opts);
}

// ---------- teleport ----------

// The other locomotion everybody expects, and the one that never makes
// anybody ill. Given where the ray hit the floor, this is the whole of it:
// a target, refused if it is further than the beam is meant to reach.
export const TELEPORT_RANGE = 60; // ft

export function teleportTarget(from, hit, range = TELEPORT_RANGE) {
  if (!hit) return null;
  const d = Math.hypot(num(hit.x) - num(from.x), num(hit.z) - num(from.z));
  if (d > num(range, TELEPORT_RANGE)) return null;
  return { x: num(hit.x), z: num(hit.z), y: num(hit.y), distance: d };
}

// ---------- the readout ----------

export function xrHud(state = {}) {
  const parts = [];
  parts.push(state.floorLabel || 'Level 1');
  parts.push(state.turnMode === 'smooth' ? 'smooth turn' : `${Math.round((state.snapAngle || SNAP_ANGLE) * 180 / Math.PI)}° snap`);
  if (state.teleport) parts.push('teleport ready');
  return parts.join(' · ');
}
