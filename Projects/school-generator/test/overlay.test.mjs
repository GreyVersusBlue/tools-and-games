// The tracing overlay: the record, the coordinate transform, and the one
// division that scales it. Most of this suite is about the transform being an
// exact inverse of itself, because that is what the tool leans on every time a
// click on the canvas has to become a point on the picture.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TYPES, MAX_BYTES, MIN_SCALE, MAX_SCALE, ALL_FLOORS, DEFAULT_OPACITY,
  makeOverlay, normalizeOverlay, isSupportedImage, imageTypeOf, hasOverlay,
  overlaySize, imageToWorld, worldToImage, overlayCorners,
  calibrate, calibrationOf, moveOverlay, rotateOverlay, setOverlay,
  centreOn, showsOn, describeOverlay,
} from '../js/overlay.js';
import { serialize, deserialize, SAVE_VERSION } from '../js/save-load.js';
import { createState } from '../js/grid.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const WEBP = 'data:image/webp;base64,UklGRhoAAABXRUJQ';
const base = (opts) => makeOverlay(PNG, 1200, 800, opts);

// ---------- what counts as an image ----------

test('the image formats a browser can decode are accepted, and pdf is not', () => {
  for (const t of TYPES) assert.ok(isSupportedImage(`data:image/${t};base64,AAAA`), t);
  for (const bad of [
    'data:application/pdf;base64,AAAA',
    'data:text/html;base64,AAAA',
    'https://example.com/plan.png',
    'plan.png',
    '',
    null,
  ]) {
    assert.equal(isSupportedImage(bad), false, `${bad} should not be accepted`);
  }
});

test('imageTypeOf reads the mime type back', () => {
  assert.equal(imageTypeOf(PNG), 'png');
  assert.equal(imageTypeOf(WEBP), 'webp');
  assert.equal(imageTypeOf('nonsense'), null);
});

// ---------- the record ----------

test('a fresh overlay is uncalibrated and says so', () => {
  const o = base();
  assert.equal(o.cal, undefined);
  assert.equal(o.floor, ALL_FLOORS);
  assert.equal(o.opacity, DEFAULT_OPACITY);
  assert.equal(o.locked, false);
  assert.match(describeOverlay(o), /not measured yet/);
});

test('normalizeOverlay refuses what it cannot use, and never throws', () => {
  for (const bad of [
    null, undefined, 42, 'x', {},
    { src: PNG },                                  // no pixel size
    { src: PNG, w: 0, h: 100 },
    { src: 'data:application/pdf;base64,AA', w: 10, h: 10 },
    { src: `data:image/png;base64,${'A'.repeat(MAX_BYTES)}`, w: 10, h: 10 },
  ]) {
    assert.equal(normalizeOverlay(bad), null, `${JSON.stringify(bad)?.slice(0, 40)} should be refused`);
  }
});

test('normalizeOverlay clamps everything that can be out of range', () => {
  const o = normalizeOverlay({
    src: PNG, w: 1200.6, h: 800.2,
    x: 1e9, z: -1e9, scale: 1e6, rot: Math.PI * 5, opacity: 40, floor: -7,
  });
  assert.equal(o.w, 1201);
  assert.ok(Math.abs(o.x) <= 100000 && Math.abs(o.z) <= 100000);
  assert.equal(o.scale, MAX_SCALE);
  assert.ok(o.rot >= 0 && o.rot < Math.PI * 2);
  assert.equal(o.opacity, 1);
  assert.equal(o.floor, ALL_FLOORS, 'a nonsense floor means every floor');
  assert.equal(normalizeOverlay({ src: PNG, w: 10, h: 10, scale: 0 }).scale, MIN_SCALE);
});

test('a calibration that says nothing is dropped rather than kept half-read', () => {
  const keep = normalizeOverlay({
    src: PNG, w: 100, h: 100, cal: { a: { u: 0, v: 0 }, b: { u: 40, v: 0 }, ft: 10 },
  });
  assert.ok(keep.cal);
  for (const cal of [
    { a: { u: 0, v: 0 }, b: { u: 1, v: 0 }, ft: 10 },      // two points on top of each other
    { a: { u: 0, v: 0 }, b: { u: 40, v: 0 }, ft: 0 },      // no distance
    { a: { u: 0, v: 0 }, ft: 10 },                          // one point
    'nonsense',
  ]) {
    assert.equal(normalizeOverlay({ src: PNG, w: 100, h: 100, cal }).cal, undefined);
  }
});

test('hasOverlay reads a state rather than a record', () => {
  const s = createState(10, 10);
  assert.equal(hasOverlay(s), false);
  s.overlay = base();
  assert.equal(hasOverlay(s), true);
});

// ---------- geometry ----------

test('image and world are exact inverses, at any rotation', () => {
  for (const rot of [0, 0.3, Math.PI / 2, 2.2, Math.PI, 5.9]) {
    const o = setOverlay(base({ x: 137, z: -42 }), { rot, scale: 0.17 });
    for (const [u, v] of [[0, 0], [1200, 800], [600, 400], [37, 913], [-20, 5]]) {
      const w = imageToWorld(o, u, v);
      const back = worldToImage(o, w.x, w.z);
      assert.ok(Math.abs(back.u - u) < 1e-6 && Math.abs(back.v - v) < 1e-6,
        `rot ${rot}: (${u},${v}) came back as (${back.u},${back.v})`);
    }
  }
});

test('the image centre is where the overlay says it is', () => {
  const o = base({ x: 50, z: 90 });
  const c = imageToWorld(o, o.w / 2, o.h / 2);
  assert.ok(Math.abs(c.x - 50) < 1e-9 && Math.abs(c.z - 90) < 1e-9);
});

test('unrotated, image v runs the way world +z does', () => {
  // The edit view looks straight down with +z toward the bottom of the screen,
  // so a picture dropped in reads the same way up as it does anywhere else.
  const o = setOverlay(base({ x: 0, z: 0 }), { scale: 1 });
  const top = imageToWorld(o, o.w / 2, 0);
  const bottom = imageToWorld(o, o.w / 2, o.h);
  assert.ok(bottom.z > top.z, 'the picture is upside down');
  const left = imageToWorld(o, 0, o.h / 2);
  const right = imageToWorld(o, o.w, o.h / 2);
  assert.ok(right.x > left.x, 'the picture is mirrored');
});

test('size and corners agree with each other', () => {
  const o = setOverlay(base({ x: 0, z: 0 }), { scale: 0.25 });
  const size = overlaySize(o);
  assert.equal(size.w, 300);
  assert.equal(size.d, 200);
  const c = overlayCorners(o);
  assert.equal(c.length, 4);
  assert.ok(Math.abs(Math.hypot(c[1].x - c[0].x, c[1].z - c[0].z) - size.w) < 1e-9);
  assert.ok(Math.abs(Math.hypot(c[3].x - c[0].x, c[3].z - c[0].z) - size.d) < 1e-9);
});

// ---------- calibration ----------

test('measuring 400 pixels and calling it 40 feet gives a tenth of a foot a pixel', () => {
  const r = calibrate(base(), { u: 100, v: 100 }, { u: 500, v: 100 }, 40);
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.scale - 0.1) < 1e-12);
  assert.equal(r.overlay.cal.ft, 40);
  assert.deepEqual(r.size, { w: 120, d: 80 });
});

test('a diagonal measurement is measured diagonally', () => {
  const r = calibrate(base(), { u: 0, v: 0 }, { u: 300, v: 400 }, 50);   // 500px
  assert.ok(Math.abs(r.scale - 0.1) < 1e-12);
});

test('scaling turns about the image centre, so the picture stays put', () => {
  const o = base({ x: 200, z: 300 });
  const after = calibrate(o, { u: 10, v: 10 }, { u: 110, v: 10 }, 25).overlay;
  assert.equal(after.x, 200);
  assert.equal(after.z, 300);
});

test('a measurement that says nothing is refused, with a reason', () => {
  for (const [a, b, ft] of [
    [{ u: 0, v: 0 }, { u: 1, v: 1 }, 10],
    [{ u: 0, v: 0 }, { u: 100, v: 0 }, 0],
    [{ u: 0, v: 0 }, { u: 100, v: 0 }, NaN],
    [{ u: 0, v: 0 }, { u: 100, v: 0 }, -4],
  ]) {
    const r = calibrate(base(), a, b, ft);
    assert.equal(r.ok, false);
    assert.ok(r.reason, 'a refusal with no reason');
  }
});

test('the measurement survives moving and rotating the picture', () => {
  let o = calibrate(base({ x: 0, z: 0 }), { u: 0, v: 0 }, { u: 200, v: 0 }, 20).overlay;
  const before = calibrationOf(o);
  o = rotateOverlay(moveOverlay(o, 300, -120), 1.1);
  const after = calibrationOf(o);
  assert.equal(after.ft, before.ft);
  assert.ok(Math.abs(after.px - before.px) < 1e-9);
  // ...and the two ends still land on the same two spots on the picture.
  const back = worldToImage(o, after.a.x, after.a.z);
  assert.ok(Math.abs(back.u - o.cal.a.u) < 1e-6);
});

test('the measured length reads back in world feet', () => {
  const o = calibrate(base(), { u: 0, v: 0 }, { u: 400, v: 0 }, 40).overlay;
  const c = calibrationOf(o);
  assert.ok(Math.abs(Math.hypot(c.b.x - c.a.x, c.b.z - c.a.z) - 40) < 1e-9);
  assert.ok(Math.abs(c.pxPerFt - 10) < 1e-9);
  assert.match(describeOverlay(o), /40 ft measured over 400 px/);
});

// ---------- placement ----------

test('a locked overlay does not move or turn', () => {
  const o = setOverlay(base({ x: 10, z: 10 }), { locked: true });
  assert.equal(moveOverlay(o, 50, 50).x, 10);
  assert.equal(rotateOverlay(o, 1).rot, o.rot);
  // ...but it can still be unlocked, which is the only way back.
  const free = setOverlay(o, { locked: false });
  assert.equal(moveOverlay(free, 50, 0).x, 60);
});

test('centreOn drops the picture over a rectangle of world', () => {
  const o = centreOn(base(), { x0: 20, z0: 40, x1: 220, z1: 140 });
  assert.equal(o.x, 120);
  assert.equal(o.z, 90);
});

test('an overlay shows on every storey unless it is pinned to one', () => {
  const all = base();
  assert.equal(showsOn(all, 0), true);
  assert.equal(showsOn(all, 3), true);
  const pinned = setOverlay(all, { floor: 1 });
  assert.equal(showsOn(pinned, 0), false);
  assert.equal(showsOn(pinned, 1), true);
});

// ---------- the file ----------

test('an overlay round-trips through the save format', () => {
  const s = createState(20, 20);
  s.overlay = calibrate(base({ x: 40, z: 60 }), { u: 0, v: 0 }, { u: 100, v: 0 }, 25).overlay;
  const back = deserialize(serialize(s));
  assert.equal(back.version, SAVE_VERSION);
  assert.deepEqual(back.overlay, s.overlay);
});

test('a design with no overlay records none, and one can be left out on request', () => {
  const s = createState(20, 20);
  assert.equal('overlay' in JSON.parse(serialize(s)), false);
  s.overlay = base();
  assert.ok(JSON.parse(serialize(s)).overlay);
  assert.equal(JSON.parse(serialize(s, { omitOverlay: true })).overlay, undefined);
});

test('an overlay this build cannot use never stops a design from loading', () => {
  const s = createState(20, 20);
  const raw = JSON.parse(serialize(s));
  for (const overlay of [
    { src: 'data:application/pdf;base64,AAAA', w: 10, h: 10 },
    { src: PNG },
    'nonsense',
    null,
  ]) {
    const back = deserialize(JSON.stringify({ ...raw, overlay }));
    assert.equal(back.overlay, undefined);
    assert.equal(back.floors.length, 1, 'the design should still load');
  }
});
