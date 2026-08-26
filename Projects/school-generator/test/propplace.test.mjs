// Prop placement logic: picking, footprints and the grid/wall/row snap
// tiers. Run `node --test` from Projects/school-generator.

import test from 'node:test';
import assert from 'node:assert/strict';

import { CELL, createState } from '../js/grid.js';
import { sheet } from './build.mjs';
import { addShape, setSegWall } from '../js/shapes.js';
import {
  footprintOf, pointInProp, pickPropAt, propsInBox, faceDirection,
  wallSnap, rowSnap, gridSnap, snapProp, FURN_GRID,
} from '../js/propplace.js';

const DESK = { type: 'desk', w: 2, d: 1.5, mount: 'floor' };
const TV = { type: 'tv', w: 4, d: 0.3, mount: 'wall' };
const catalog = { desk: DESK, tv: TV };
const catalogGet = (t) => catalog[t] || null;

const prop = (over) => ({ id: 1, type: 'desk', floor: 0, x: 0, z: 0, y: 0, rotationY: 0, scale: 1, mount: 'floor', data: {}, ...over });

// ---------- footprint / picking ----------

test('footprintOf scales with the prop, not just the catalog entry', () => {
  assert.deepEqual(footprintOf(DESK, prop({ scale: 1 })), { hw: 1, hd: 0.75 });
  assert.deepEqual(footprintOf(DESK, prop({ scale: 2 })), { hw: 2, hd: 1.5 });
});

test('pointInProp accounts for rotation', () => {
  const p = prop({ x: 10, z: 10, rotationY: 0 });
  assert.ok(pointInProp(DESK, p, 10.9, 10), 'within the unrotated footprint');
  assert.ok(!pointInProp(DESK, p, 10, 10.9), 'outside the shorter (d) axis');
  const rotated = prop({ x: 10, z: 10, rotationY: Math.PI / 2 });
  // A quarter turn swaps which world axis is the long one.
  assert.ok(pointInProp(DESK, rotated, 10, 10.9));
  assert.ok(!pointInProp(DESK, rotated, 10.9, 10));
});

test('pickPropAt returns the topmost prop under a point, or null', () => {
  const props = [prop({ id: 1, x: 0, z: 0 }), prop({ id: 2, x: 0.2, z: 0 })];
  const hit = pickPropAt(props, 0, catalogGet, 0.2, 0);
  assert.equal(hit.id, 2, 'later prop wins an overlap');
  assert.equal(pickPropAt(props, 0, catalogGet, 50, 50), null);
  assert.equal(pickPropAt(props, 1, catalogGet, 0, 0), null, 'wrong floor misses');
});

test('propsInBox picks up props whose AABB overlaps the box', () => {
  const props = [prop({ id: 1, x: 0, z: 0 }), prop({ id: 2, x: 20, z: 20 })];
  const hit = propsInBox(props, 0, catalogGet, -5, -5, 5, 5);
  assert.deepEqual(hit.map((p) => p.id), [1]);
});

// ---------- rotation convention ----------

test('faceDirection points local +Z at the given world direction', () => {
  assert.equal(faceDirection(0, 1), 0, 'already facing +Z');
  assert.ok(Math.abs(faceDirection(1, 0) - Math.PI / 2) < 1e-9, 'facing +X is a quarter turn');
  assert.equal(faceDirection(0, 0), 0, 'degenerate direction falls back to 0');
});

// ---------- wall snapping ----------

// A room whose north wall runs along z = 20, x in [16, 24].
function wallAt20() {
  const s = createState(10, 10);
  const f = sheet(s, 0);
  f.box(4, 5, 4, 6);
  f.bake();
  return s.floors[0];
}

test('wallSnap lands flush on a wall, facing the side the cursor was on', () => {
  const f = wallAt20();
  // Cursor a bit south of the wall (larger z) -> should face +Z.
  const hit = wallSnap(f, 18, 21, 0.3, 2);
  assert.ok(hit, 'found the wall');
  assert.ok(Math.abs(hit.z - 20.4) < 1e-9, 'offset off the wall face by WALL_T/2 + depth/2');
  assert.equal(hit.rotationY, faceDirection(0, 1));
  // Cursor north of the wall instead -> faces -Z.
  const hit2 = wallSnap(f, 18, 19, 0.3, 2);
  assert.equal(hit2.rotationY, faceDirection(0, -1));
});

test('wallSnap ignores a segment carrying no wall', () => {
  const s = createState(20, 20);
  const shape = addShape(s, 0, [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }], {});
  const hit = wallSnap(s.floors[0], 5, -1, 0.3, 2);
  assert.ok(hit, 'snapped to the polygon wall at z=0');
  assert.ok(Math.abs(hit.x - 5) < 1e-9, 'centered on the cursor along the wall');
  assert.ok(hit.z < 0, 'offset toward the side the cursor was on (outside the room)');
  setSegWall(shape, 0, 0, 0); // erase that wall
  assert.equal(wallSnap(s.floors[0], 5, -1, 0.3, 2), null, 'no wall left to snap to');
});

test('wallSnap returns null with nothing in range', () => {
  const s = createState(10, 10);
  assert.equal(wallSnap(s.floors[0], 5, 5, 0.3, 1), null);
});

// ---------- prop-to-prop row snapping ----------

test('rowSnap lines a new desk up flush against a neighbour, matching its rotation', () => {
  const neighbor = prop({ id: 1, x: 0, z: 0, rotationY: 0 });
  const props = [neighbor];
  // Cursor dropped a bit to the +X side of the neighbour.
  const hit = rowSnap(props, 0, catalogGet, 2, DESK, prop({ id: 2 }), 2.2, 0.1, 1);
  assert.ok(hit, 'found a snap candidate');
  assert.ok(Math.abs(hit.x - 2) < 1e-9, 'flush against the neighbour\'s +X edge (hw 1 + hw 1)');
  assert.equal(hit.rotationY, 0);
});

test('rowSnap only matches props with the same mount kind', () => {
  const wallProp = { id: 9, type: 'tv', floor: 0, x: 0, z: 0, rotationY: 0, scale: 1, mount: 'wall' };
  const hit = rowSnap([wallProp], 0, catalogGet, 2, DESK, prop({ id: 2 }), 1, 0, 1);
  assert.equal(hit, null);
});

// ---------- grid snapping ----------

test('gridSnap snaps onto the furniture lattice within tolerance', () => {
  assert.deepEqual(gridSnap(FURN_GRID + 0.1, 6.1, 0.5), { x: FURN_GRID, z: 6 });
  assert.equal(gridSnap(51, 51, 0.1), null, 'nowhere near a grid point on either axis');
});

// ---------- composed snapProp ----------

test('snapProp prefers wall snapping for wall-mounted types', () => {
  const f = wallAt20();
  const hit = snapProp(f, [], 0, TV, prop({ type: 'tv', mount: 'wall' }), 18, 21, 0, { tol: 2, catalogGet });
  assert.equal(hit.kind, 'wall');
  assert.equal(hit.mount, 'wall');
});

test('snapProp falls back through row -> grid -> free', () => {
  const s = createState(10, 10);
  const f = s.floors[0];
  const neighbor = prop({ id: 5, x: 0, z: 0 });
  const near = snapProp(f, [neighbor], 0, DESK, prop({ id: 6 }), 2.1, 0.1, 0, { tol: 1, excludeId: 6, catalogGet });
  assert.equal(near.kind, 'row');

  const onGrid = snapProp(f, [], 0, DESK, prop({ id: 7 }), FURN_GRID + 0.1, 6.05, 0, { tol: 0.5, catalogGet });
  assert.equal(onGrid.kind, 'grid');

  const free = snapProp(f, [], 0, DESK, prop({ id: 8 }), 51.3, 77.7, 1.2, { tol: 0.2, catalogGet });
  assert.equal(free.kind, 'free');
  assert.equal(free.x, 51.3);
  assert.equal(free.rotationY, 1.2, 'free placement keeps the tool\'s current heading');
});

test('snapProp with opts.free skips every tier (Alt = ignore snapping)', () => {
  const f = wallAt20();
  const hit = snapProp(f, [], 0, TV, prop({ type: 'tv', mount: 'wall' }), 18, 20.02, Math.PI, { free: true, catalogGet });
  assert.deepEqual(hit, { x: 18, z: 20.02, rotationY: Math.PI, mount: 'wall', kind: 'free' });
});
