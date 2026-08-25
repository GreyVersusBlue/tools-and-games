// WebXR, minus the headset: the rig arithmetic, the sticks and the turning.
// Everything here runs where no XR device exists, which is the point of
// keeping it out of render.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  XR_MODE, REFERENCE_SPACES, XR_SPEED, DEADZONE, SNAP_ANGLE, TURN_PRESS,
  TURN_RELEASE, TURN_MODES, TELEPORT_RANGE,
  xrAvailability, describeXR, rigPosition, headPosition, rotateRigAbout,
  stickVector, moveVector, snapTurn, smoothTurn, turnStep, teleportTarget, xrHud,
} from '../js/xr.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// ---------- is there a headset ----------

test('a browser with no WebXR at all says so', async () => {
  const status = await xrAvailability(undefined);
  assert.equal(status.supported, false);
  assert.equal(status.reason, 'no-webxr');
  assert.match(status.note, /no WebXR/);
  assert.equal(describeXR(status), status.note);
  assert.equal(describeXR(null), '');
});

test('WebXR with no headset is a different sentence from no WebXR', async () => {
  const status = await xrAvailability({ isSessionSupported: async () => false });
  assert.equal(status.reason, 'no-device');
  assert.match(status.note, /no VR headset/);
});

test('a headset that is there is ready', async () => {
  const seen = [];
  const status = await xrAvailability({
    isSessionSupported: async (mode) => { seen.push(mode); return true; },
  });
  assert.ok(status.supported);
  assert.equal(describeXR(status), 'VR ready');
  assert.deepEqual(seen, [XR_MODE]);
  assert.equal(XR_MODE, 'immersive-vr');
  assert.equal(REFERENCE_SPACES[0], 'local-floor');
});

test('a browser that throws about it is caught, not propagated', async () => {
  const status = await xrAvailability({ isSessionSupported: async () => { throw new Error('denied'); } });
  assert.equal(status.supported, false);
  assert.match(status.note, /denied/);
});

// ---------- the rig ----------

test('the rig stands where the head lands on the target', () => {
  const head = { x: 1.5, y: 5.8, z: -0.5 };
  const rig = rigPosition({ x: 100, z: 40 }, head, 12);
  assert.equal(rig.x, 98.5);
  assert.equal(rig.z, 40.5);
  assert.equal(rig.y, 12, 'the storey decides the floor, not the head');
  const back = headPosition(rig, head);
  assert.ok(near(back.x, 100) && near(back.z, 40));
  assert.ok(near(back.y, 12 + 5.8), 'a real body keeps its real height');
});

test('leaning does not move the building', () => {
  const rig = rigPosition({ x: 50, z: 50 }, { x: 0, z: 0 }, 0);
  const leaned = headPosition(rig, { x: 1.2, y: 5.5, z: 0.3 });
  assert.ok(near(leaned.x, 51.2) && near(leaned.z, 50.3));
});

test('the rig turns about the head, so a snap turns you on the spot', () => {
  const pivot = { x: 10, z: 0 };
  const rig = { x: 0, y: 0, z: 0, yaw: 0 };
  const turned = rotateRigAbout(rig, pivot, Math.PI / 2);
  // The head must be exactly where it was afterwards.
  const before = headPosition(rig, { x: 10, y: 5, z: 0 });
  assert.ok(near(before.x, 10) && near(before.z, 0));
  // Rotating the rig about the pivot keeps the pivot fixed, which is the test:
  const dx = turned.x - pivot.x, dz = turned.z - pivot.z;
  assert.ok(near(Math.hypot(dx, dz), 10), 'the same distance from the pivot');
  assert.ok(near(turned.yaw, Math.PI / 2));
  assert.equal(turned.y, 0);
});

test('turning about the head you are standing at is a no-op in position', () => {
  const at = { x: 30, z: 40 };
  const turned = rotateRigAbout({ x: 30, y: 3, z: 40, yaw: 0 }, at, 1.1);
  assert.ok(near(turned.x, 30) && near(turned.z, 40));
});

// ---------- the sticks ----------

test('a resting thumb is zero, and the first millimetre past the deadzone is slow', () => {
  assert.deepEqual(stickVector(0, 0), { x: 0, y: 0, mag: 0 });
  assert.equal(stickVector(DEADZONE * 0.9, 0).mag, 0);
  const nudge = stickVector(DEADZONE + 0.01, 0);
  assert.ok(nudge.mag > 0 && nudge.mag < 0.05, `jumped straight to ${nudge.mag}`);
  const full = stickVector(1, 0);
  assert.ok(near(full.mag, 1));
  assert.ok(near(full.x, 1));
});

test('a diagonal stick is not faster than a straight one', () => {
  const straight = stickVector(1, 0);
  const diagonal = stickVector(0.8, 0.8);
  assert.ok(diagonal.mag <= straight.mag + 1e-9);
  assert.ok(near(Math.hypot(diagonal.x, diagonal.y), diagonal.mag));
});

test('pushing forward walks the way you are looking', () => {
  const stick = stickVector(0, -1); // gamepads report forward as negative y
  const north = moveVector(stick, 0, 10, 1);
  assert.ok(near(north.dx, 0, 1e-9));
  assert.ok(near(north.dz, -10, 1e-9), 'yaw 0 looks along -z, like every other camera here');

  const east = moveVector(stick, -Math.PI / 2, 10, 1);
  assert.ok(near(east.dx, 10, 1e-6));
  assert.ok(near(east.dz, 0, 1e-6));
});

test('pushing right strafes right of wherever you are looking', () => {
  const right = moveVector(stickVector(1, 0), 0, 10, 1);
  assert.ok(near(right.dx, 10, 1e-9));
  assert.ok(near(right.dz, 0, 1e-9));
  const turned = moveVector(stickVector(1, 0), Math.PI / 2, 10, 1);
  assert.ok(near(turned.dz, -10, 1e-6), 'facing +x, right is -z');
});

test('a step is speed times dt, and a half-pressed stick is half of it', () => {
  const full = moveVector(stickVector(0, -1), 0, XR_SPEED, 0.5);
  assert.ok(near(Math.hypot(full.dx, full.dz), XR_SPEED * 0.5, 1e-9));
  const half = moveVector({ x: 0, y: -0.5 }, 0, XR_SPEED, 0.5);
  assert.ok(near(Math.hypot(half.dx, half.dz), XR_SPEED * 0.25, 1e-9));
  assert.deepEqual(moveVector({ x: 0, y: 0 }, 0), { dx: 0, dz: 0 });
  assert.deepEqual(moveVector(stickVector(0, -1), 0, XR_SPEED, -5), { dx: 0, dz: 0 });
});

// ---------- turning ----------

test('a snap turn fires once and rearms only when the stick comes back', () => {
  let latched = false, turns = 0;
  for (let i = 0; i < 30; i++) {
    const r = snapTurn(latched, 1);
    latched = r.latched;
    if (r.turn) turns++;
  }
  assert.equal(turns, 1, 'held over, it turns once');

  const back = snapTurn(latched, 0);
  assert.equal(back.latched, false);
  assert.equal(snapTurn(false, 1).turn, -SNAP_ANGLE, 'right turns clockwise');
  assert.equal(snapTurn(false, -1).turn, SNAP_ANGLE);
});

test('a snap turn ignores a stick short of the press threshold', () => {
  assert.equal(snapTurn(false, TURN_PRESS - 0.01).turn, 0);
  assert.equal(snapTurn(false, TURN_PRESS + 0.01).turn, -SNAP_ANGLE);
  // Rearming needs it *below* release, not merely below press.
  assert.equal(snapTurn(true, (TURN_PRESS + TURN_RELEASE) / 2).latched, true);
  assert.equal(snapTurn(true, TURN_RELEASE - 0.01).latched, false);
});

test('a smooth turn is continuous, deadzoned and signed like the snap', () => {
  assert.equal(smoothTurn(0, 0.1), 0);
  assert.equal(smoothTurn(DEADZONE * 0.5, 0.1), 0);
  const right = smoothTurn(1, 0.1);
  assert.ok(right < 0, 'right turns clockwise, the same way the snap does');
  assert.ok(smoothTurn(-1, 0.1) > 0);
  assert.ok(Math.abs(smoothTurn(1, 0.2)) > Math.abs(right), 'twice the time, twice the turn');
});

test('one entry point covers both comfort modes', () => {
  for (const mode of TURN_MODES) {
    const r = turnStep(mode, false, 1, 0.1);
    assert.ok(Number.isFinite(r.turn));
    assert.ok(r.turn <= 0);
  }
  assert.equal(turnStep('smooth', true, 1, 0.1).latched, false);
  assert.equal(turnStep('snap', false, 1, 0.1).latched, true);
  assert.deepEqual(TURN_MODES, ['snap', 'smooth']);
});

// ---------- teleport ----------

test('a teleport lands where the ray hit, unless that is out of range', () => {
  const from = { x: 0, z: 0 };
  const near30 = teleportTarget(from, { x: 30, y: 0, z: 0 });
  assert.equal(near30.x, 30);
  assert.equal(near30.distance, 30);
  assert.equal(teleportTarget(from, { x: TELEPORT_RANGE + 1, y: 0, z: 0 }), null);
  assert.equal(teleportTarget(from, null), null);
  assert.ok(teleportTarget(from, { x: 200, y: 0, z: 0 }, 400));
});

// ---------- the readout ----------

test('the headset hud says the storey and the comfort setting', () => {
  assert.match(xrHud({ floorLabel: 'Level 2', turnMode: 'snap' }), /Level 2 · 30° snap/);
  assert.match(xrHud({ turnMode: 'smooth' }), /Level 1 · smooth turn/);
  assert.match(xrHud({ teleport: true }), /teleport ready/);
});
