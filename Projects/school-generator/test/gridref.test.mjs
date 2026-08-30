// gridref.test.mjs — the point the drawing grid indexes off, and the one rule
// that keeps it safe: it moves only while there is nothing drawn on it.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState } from '../js/grid.js';
import { makeOverlay, setOverlay, imageToWorld, worldToImage } from '../js/overlay.js';
import {
  normalizeGridRef, isDefaultGridRef, gridRefOf, gridOrigin,
  drawnCount, gridLocked, makeGridRef, setGridRef, clearGridRef,
  reanchorGridRef, describeGridRef,
} from '../js/gridref.js';

// A 1x1 transparent GIF is the smallest thing overlay.js will accept, and the
// pixel size it records is whatever it is told — so an "image" here can be any
// size at all without carrying any bytes.
const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const image = (opts = {}) => makeOverlay(GIF, 400, 300, { scale: 1, ...opts });

const empty = () => createState(20, 20);

// ---------- the record ----------

test('a reference point is two numbers, and anything else is none', () => {
  assert.deepEqual(normalizeGridRef({ x: 3, z: 4 }), { x: 3, z: 4 });
  assert.equal(normalizeGridRef(null), null);
  assert.equal(normalizeGridRef({ x: 3 }), null);
  assert.equal(normalizeGridRef({ x: NaN, z: 0 }), null);
  assert.equal(normalizeGridRef({ x: '3', z: '4' }), null);
});

test('half an image anchor is no image anchor', () => {
  assert.deepEqual(normalizeGridRef({ x: 1, z: 2, u: 10, v: 20 }), { x: 1, z: 2, u: 10, v: 20 });
  assert.deepEqual(normalizeGridRef({ x: 1, z: 2, u: 10 }), { x: 1, z: 2 });
  assert.deepEqual(normalizeGridRef({ x: 1, z: 2, v: 20 }), { x: 1, z: 2 });
});

test('the corner is the default, and the default is written nowhere', () => {
  assert.ok(isDefaultGridRef(null));
  assert.ok(isDefaultGridRef({ x: 0, z: 0 }));
  assert.ok(!isDefaultGridRef({ x: 0.5, z: 0 }));
  assert.deepEqual(gridOrigin(empty()), { x: 0, z: 0 });
  assert.deepEqual(gridOrigin(null), { x: 0, z: 0 });
});

test('a nonsense reference on a state reads as the corner rather than throwing', () => {
  const s = empty();
  s.gridRef = { x: 'over there' };
  assert.equal(gridRefOf(s), null);
  assert.deepEqual(gridOrigin(s), { x: 0, z: 0 });
});

// ---------- setting it ----------

test('setting the reference moves the grid', () => {
  const s = empty();
  const out = setGridRef(s, { x: 2.5, z: 1.25 });
  assert.equal(out.ok, true);
  assert.deepEqual(gridOrigin(s), { x: 2.5, z: 1.25 });
});

test('a point picked on the picture records where it fell on the picture', () => {
  const s = empty();
  s.overlay = image({ x: 100, z: 60, rot: 0.3 });
  const world = imageToWorld(s.overlay, 120, 200);
  const ref = makeGridRef(world.x, world.z, s.overlay);
  const back = worldToImage(s.overlay, world.x, world.z);
  assert.ok(Math.abs(ref.u - back.u) < 1e-6);
  assert.ok(Math.abs(ref.v - back.v) < 1e-6);
  // ...and with no picture under it, it is simply a point on the plan.
  const bare = makeGridRef(4, 6, null);
  assert.deepEqual(bare, { x: 4, z: 6 });
});

// ---------- the lock ----------

test('rooms and free-standing walls lock the grid; nothing else does', () => {
  const s = empty();
  assert.equal(drawnCount(s), 0);
  assert.equal(gridLocked(s), false);

  s.props.push({ id: 1, floor: 0, type: 'desk', x: 4, z: 4 });
  s.links.push({ id: 2, from: 0, to: 1, kind: 'stair' });
  assert.equal(gridLocked(s), false, 'furniture and stairs are placed in feet, not on the grid');

  s.floors[0].walls = [{ id: 3, a: { x: 0, z: 0 }, b: { x: 8, z: 0 } }];
  assert.equal(gridLocked(s), true);
  delete s.floors[0].walls;
  s.floors[0].shapes.push({ id: 4, rings: [] });
  assert.equal(gridLocked(s), true);
});

test('a locked grid refuses to be moved, and says why', () => {
  const s = empty();
  setGridRef(s, { x: 3, z: 3 });
  s.floors[0].shapes.push({ id: 1, rings: [] });
  const out = setGridRef(s, { x: 9, z: 9 });
  assert.equal(out.ok, false);
  assert.equal(out.locked, true);
  assert.match(out.reason, /empty plan/);
  assert.deepEqual(gridOrigin(s), { x: 3, z: 3 }, 'and the grid did not move');
});

test('...and refuses to be cleared, which would move it just as far', () => {
  const s = empty();
  setGridRef(s, { x: 3, z: 3 });
  s.floors[0].shapes.push({ id: 1, rings: [] });
  const out = clearGridRef(s);
  assert.equal(out.ok, false);
  assert.deepEqual(gridOrigin(s), { x: 3, z: 3 });
});

test('clearing an unlocked grid puts it back on the corner', () => {
  const s = empty();
  setGridRef(s, { x: 3, z: 3 });
  assert.equal(clearGridRef(s).ok, true);
  assert.equal(s.gridRef, undefined, 'and leaves no key behind for the file to carry');
  assert.deepEqual(gridOrigin(s), { x: 0, z: 0 });
});

// ---------- riding the picture ----------

test('the reference rides the picture while the plan is empty', () => {
  const s = empty();
  s.overlay = image({ x: 100, z: 60 });
  const world = imageToWorld(s.overlay, 40, 30);
  setGridRef(s, makeGridRef(world.x, world.z, s.overlay));
  const before = gridOrigin(s);

  s.overlay = setOverlay(s.overlay, { x: 140 });
  assert.equal(reanchorGridRef(s), true);
  assert.ok(Math.abs(gridOrigin(s).x - (before.x + 40)) < 1e-9);
  assert.ok(Math.abs(gridOrigin(s).z - before.z) < 1e-9);
});

test('...and stops riding it the moment something is drawn', () => {
  const s = empty();
  s.overlay = image({ x: 100, z: 60 });
  const world = imageToWorld(s.overlay, 40, 30);
  setGridRef(s, makeGridRef(world.x, world.z, s.overlay));
  const before = gridOrigin(s);

  s.floors[0].shapes.push({ id: 1, rings: [] });
  s.overlay = setOverlay(s.overlay, { x: 400 });
  assert.equal(reanchorGridRef(s), false);
  assert.deepEqual(gridOrigin(s), before);
});

test('a reference with no image anchor never moves with the picture', () => {
  const s = empty();
  s.overlay = image({ x: 100, z: 60 });
  setGridRef(s, { x: 5, z: 5 });
  s.overlay = setOverlay(s.overlay, { x: 400 });
  assert.equal(reanchorGridRef(s), false);
  assert.deepEqual(gridOrigin(s), { x: 5, z: 5 });
});

test('re-anchoring a picture that has not moved changes nothing', () => {
  const s = empty();
  s.overlay = image({ x: 100, z: 60 });
  const world = imageToWorld(s.overlay, 40, 30);
  setGridRef(s, makeGridRef(world.x, world.z, s.overlay));
  assert.equal(reanchorGridRef(s), false);
});

// ---------- what the panel reads ----------

test('the readout says where the grid is and whether it can still move', () => {
  const s = empty();
  assert.match(describeGridRef(s), /corner of the plan/);
  setGridRef(s, { x: 2, z: 3 });
  assert.match(describeGridRef(s), /2, 3 ft/);
  assert.match(describeGridRef(s), /Click again/);
  s.floors[0].shapes.push({ id: 1, rings: [] });
  assert.match(describeGridRef(s), /fixed there now/);
});
