// Hands for the walkthrough. Pure module, so the whole of a pick-up and a
// set-down runs headless: a room, a prop, an eye point and a view direction,
// and the question of whether the thing in your hands fits where you are
// looking.
//
// The claim under test that matters most is the phase's own rule: **placement
// refuses only overlap, not consequence.** A set-down that blocks a corridor
// is legal; a set-down inside a desk is not; and the overlap test is the real
// rotated footprint, not a circle — which is also, via collide.js's new
// helpers, what the shove now uses.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, CELL } from '../js/grid.js';
import { EDGE_DOOR } from '../js/lattice.js';
import { sheet } from './build.mjs';
import { addProp, removeProp } from '../js/props.js';
import { catalogEntry } from '../js/catalog.js';
import {
  buildCollider, refreshProps, candidates, boxesOverlap, boxOverlapsSeg,
  WALL_PAD,
} from '../js/collide.js';
import {
  pickAhead, carryPoint, placementClear, setDown, searchCatalog,
  WALK_PALETTE, REACH_FT, CARRY_FT,
} from '../js/carry.js';
import { PROP_CATALOG } from '../js/catalog.js';

// The same fixture the shove suite walks: a walled 44ft room, cells 2..12,
// interior world feet 8..52 — drawn on a scratch lattice and baked, the way
// the editor, the generator and the loader all produce a floor.
function room(draw = null) {
  const s = createState(20, 20);
  const sh = sheet(s, 0);
  sh.box(2, 2, 12, 12);
  if (draw) draw(sh);
  sh.bake();
  return s;
}

const collide = (s, opts = {}) => buildCollider(s, 0, catalogEntry, opts);
const east = { x: 1, z: 0 };

// ---------- the palette ----------

test('every walk-palette favourite is a real, floor-standing catalog row', () => {
  assert.ok(WALK_PALETTE.length >= 6 && WALK_PALETTE.length <= 9, 'a short ring');
  for (const type of WALK_PALETTE) {
    const entry = catalogEntry(type);
    assert.ok(entry, `${type} exists`);
    assert.equal(entry.mount, 'floor', `${type} can land anywhere the ghost fits`);
  }
});

// ---------- picking ----------

test('the view picks the prop it is pointing at, within reach', () => {
  const s = room();
  const chair = addProp(s, 'student-chair', { floor: 0, x: 24, z: 20 });
  const hit = pickAhead(s.props, 0, catalogEntry, { x: 20, z: 20 }, east);
  assert.equal(hit && hit.id, chair.id);
});

test('a prop behind you, out of reach, or on another storey is not in hand', () => {
  const s = room();
  addProp(s, 'student-chair', { floor: 0, x: 16, z: 20 });
  assert.equal(pickAhead(s.props, 0, catalogEntry, { x: 20, z: 20 }, east), null,
    'behind the eye');
  const s2 = room();
  addProp(s2, 'student-chair', { floor: 0, x: 20 + REACH_FT + 3, z: 20 });
  assert.equal(pickAhead(s2.props, 0, catalogEntry, { x: 20, z: 20 }, east), null,
    'beyond reach');
  const s3 = room();
  addProp(s3, 'student-chair', { floor: 0, x: 24, z: 20 });
  assert.equal(pickAhead(s3.props, 1, catalogEntry, { x: 20, z: 20 }, east), null,
    'a storey away');
});

test('the nearest prop along the ray wins, not the topmost in the list', () => {
  const s = room();
  const near = addProp(s, 'student-chair', { floor: 0, x: 23, z: 20 });
  addProp(s, 'student-chair', { floor: 0, x: 26, z: 20 });
  const hit = pickAhead(s.props, 0, catalogEntry, { x: 20, z: 20 }, east);
  assert.equal(hit.id, near.id, 'the first one your hand reaches');
});

test('carryPoint stands the carry ahead of the eye, whatever the vector length', () => {
  const p = carryPoint({ x: 10, z: 10 }, { x: 0.001, z: 0 });
  assert.ok(Math.abs(p.x - (10 + CARRY_FT)) < 1e-9 && Math.abs(p.z - 10) < 1e-9,
    'direction is normalised');
  const q = carryPoint({ x: 10, z: 10 }, { x: 0, z: 0 });
  assert.ok(Number.isFinite(q.x) && Number.isFinite(q.z), 'a zero vector still answers');
});

// ---------- overlap, and only overlap ----------

test('open floor is clear; the middle of a desk is not', () => {
  const s = room();
  addProp(s, 'teacher-desk', { floor: 0, x: 30, z: 30 });
  const c = collide(s);
  const chair = catalogEntry('student-chair');
  assert.equal(placementClear(c, chair, null, 20, 20, 0), true);
  assert.equal(placementClear(c, chair, null, 30, 30, 0), false);
});

test('a wall refuses a footprint across it', () => {
  const s = room();
  const c = collide(s);
  const chair = catalogEntry('student-chair');
  assert.equal(placementClear(c, chair, null, 20, 2 * CELL, 0), false,
    'centred on the north wall line');
});

test('the footprint is the real rectangle, not a circle of its half-width', () => {
  // A 6ft bench two feet from the wall: parallel it fits, turned end-on the
  // far half of it is inside the wall. A circle of min(hw, hd) says yes to
  // both — which is exactly the lie Phase 22 retires.
  const s = room();
  const c = collide(s);
  const bench = catalogEntry('bench-hall');
  const z = 2 * CELL + 2;
  assert.equal(placementClear(c, bench, null, 20, z, 0), true, 'parallel to the wall');
  assert.equal(placementClear(c, bench, null, 20, z, Math.PI / 2), false,
    'end-on, its far end is in the wall');
});

test('a shut door leaf is an overlap; excludeId lets a prop keep its own spot', () => {
  const s = room((sh) => sh.door(7, 2, true, EDGE_DOOR));
  const desk = addProp(s, 'teacher-desk', { floor: 0, x: 30, z: 30 });
  const c = collide(s);
  assert.ok(c.doors.length >= 1, 'the doorway hung a leaf');
  const leaf = c.doors[0];
  const chair = catalogEntry('student-chair');
  assert.equal(placementClear(c, chair, null, leaf.hx, leaf.hz + 0.4, 0), false,
    'the shut leaf occupies the doorway');
  const deskEntry = catalogEntry('teacher-desk');
  assert.equal(placementClear(c, deskEntry, desk, 30, 30, 0, { excludeId: desk.id }), true,
    'a carried prop does not overlap itself');
});

test('flush against a neighbour is not overlap', () => {
  const s = room();
  addProp(s, 'student-chair', { floor: 0, x: 20, z: 20 });
  const c = collide(s);
  const chair = catalogEntry('student-chair');
  // Exactly flush along local x: centres a full width apart.
  assert.equal(placementClear(c, chair, null, 20 + 1.4, 20, 0), true);
});

// ---------- the set-down ----------

test('a set-down snaps through the same tiers the editor gets', () => {
  const s = room();
  const c = collide(s);
  const chair = catalogEntry('student-chair');
  const out = setDown(s.floors[0], c, s.props, 0, chair, null, 20.3, 20.4, 0,
    { catalogGet: catalogEntry, tol: 0.9 });
  assert.equal(out.kind, 'grid');
  assert.equal(out.x, 20);
  assert.equal(out.z, 20);
  assert.equal(out.clear, true);
});

test('a set-down that snaps into a desk is refused, with the spot still reported', () => {
  const s = room();
  addProp(s, 'teacher-desk', { floor: 0, x: 20, z: 20 });
  const c = collide(s);
  const chair = catalogEntry('student-chair');
  const out = setDown(s.floors[0], c, s.props, 0, chair, null, 20.3, 20.3, 0,
    { catalogGet: catalogEntry, tol: 0.9 });
  assert.equal(out.clear, false, 'overlap refused');
  assert.ok(Number.isFinite(out.x) && Number.isFinite(out.z), 'the ghost still has somewhere to draw');
});

test('a row-snapped set-down beside a desk lines up and fits', () => {
  const s = room();
  const first = addProp(s, 'student-desk', { floor: 0, x: 24, z: 24 });
  const c = collide(s);
  const entry = catalogEntry('student-desk');
  const out = setDown(s.floors[0], c, s.props, 0, entry, null, 24 + 2.3, 24.2, 0,
    { catalogGet: catalogEntry, tol: 0.9 });
  assert.equal(out.kind, 'row', 'snapped alongside the neighbour');
  assert.equal(out.x, first.x + entry.w, 'flush, centres one width apart');
  assert.equal(out.clear, true, 'flush is not overlap');
});

test('a wall mount needs a wall; a ceiling mount is always clear', () => {
  const s = room();
  const c = collide(s);
  const tv = catalogEntry('tv');
  const open = setDown(s.floors[0], c, s.props, 0, tv, null, 30, 30, 0,
    { catalogGet: catalogEntry, tol: 1.5 });
  assert.equal(open.clear, false, 'nowhere to hang it mid-room');
  const nearWall = setDown(s.floors[0], c, s.props, 0, tv, null, 20, 2 * CELL + 1, 0,
    { catalogGet: catalogEntry, tol: 1.5 });
  assert.equal(nearWall.kind, 'wall');
  assert.equal(nearWall.clear, true, 'flush against the face it snapped to');
  const proj = catalogEntry('projector-ceiling');
  const up = setDown(s.floors[0], c, s.props, 0, proj, null, 30, 30, 0,
    { catalogGet: catalogEntry, tol: 1.5 });
  assert.equal(up.clear, true);
});

// ---------- the collider learns invalidation ----------

test('refreshProps teaches a built collider about a new prop, walls untouched', () => {
  const s = room();
  const c = collide(s);
  const segsBefore = c.segs;
  const doorsBefore = c.doors;
  assert.equal(c.props.length, 0);
  const desk = addProp(s, 'teacher-desk', { floor: 0, x: 30, z: 30 });
  refreshProps(s, c, catalogEntry);
  assert.equal(c.props.length, 1, 'the desk is an obstacle now');
  assert.equal(c.props[0].id, desk.id);
  assert.equal(c.segs, segsBefore, 'the walls stayed built-once');
  assert.equal(c.doors, doorsBefore, 'the leaves are the same objects');
});

test('the broad-phase index is rebuilt with the props, so the new desk is found', () => {
  const s = room();
  const c = collide(s);
  assert.ok(c.index, 'this collider has an index');
  addProp(s, 'teacher-desk', { floor: 0, x: 30, z: 30 });
  refreshProps(s, c, catalogEntry);
  const near = candidates(c, 29, 29, 31, 31);
  assert.equal(near.props.length, 1, 'the index knows where it stands');
});

test('a removed prop stops blocking, and skipId carries the one in your hands', () => {
  const s = room();
  const desk = addProp(s, 'teacher-desk', { floor: 0, x: 30, z: 30 });
  const chair = addProp(s, 'student-chair', { floor: 0, x: 40, z: 40 });
  const c = collide(s);
  assert.equal(c.props.length, 2);
  removeProp(s, desk.id);
  refreshProps(s, c, catalogEntry);
  assert.equal(c.props.length, 1, 'the desk is gone from the collider too');
  refreshProps(s, c, catalogEntry, { skipId: chair.id });
  assert.equal(c.props.length, 0, 'a carried prop stops blocking its old spot');
  refreshProps(s, c, catalogEntry);
  assert.equal(c.props.length, 1, 'and blocks again once it is out of your hands');
  assert.equal(c.props[0].idx, 0, 'obstacle indices stay their own positions');
});

// ---------- the overlap helpers themselves ----------

test('boxesOverlap sees rotation', () => {
  // Under the shared rotation convention, local +x swings toward -z.
  const wide = { x: 0, z: 0, hw: 3, hd: 0.5, rotationY: 0 };
  const other = { x: 2.5, z: -1.5, hw: 0.5, hd: 0.5, rotationY: 0 };
  assert.equal(boxesOverlap(wide, other), false, 'clear while parallel');
  assert.equal(boxesOverlap({ ...wide, rotationY: Math.PI / 4 }, other), true,
    'the turned end reaches it');
  assert.equal(boxesOverlap(wide, { ...other, x: 3.5 + 0.5 }, 1e-6), false,
    'exactly flush is separated');
});

test('boxOverlapsSeg inflates by the wall half-thickness and no more', () => {
  const seg = { ax: -10, az: 0, bx: 10, bz: 0, pad: WALL_PAD };
  const box = (z, rotationY = 0) => ({ x: 0, z, hw: 3, hd: 0.5, rotationY });
  assert.equal(boxOverlapsSeg(box(0.5 + WALL_PAD - 0.05), seg), true, 'inside the pad');
  assert.equal(boxOverlapsSeg(box(0.5 + WALL_PAD + 0.05), seg), false, 'outside it');
  assert.equal(boxOverlapsSeg(box(2, Math.PI / 2), seg), true,
    'turned end-on, the long axis crosses the line');
});

// ---------- the walk-mode picker's search (Phase 34) ----------

test('a name prefix outranks a substring, which outranks a category hit', () => {
  const rows = [
    { type: 'a', name: 'Wall Clock', category: 'Fixtures' },
    { type: 'b', name: 'Clock Tower', category: 'Outdoor' },
    { type: 'c', name: 'Bell', category: 'Clockwork' },
  ];
  assert.deepEqual(searchCatalog(rows, 'clock').map((r) => r.type), ['b', 'a', 'c']);
});

test('ties keep catalog order, and the limit is respected', () => {
  const rows = Array.from({ length: 9 }, (_, i) => ({ type: `t${i}`, name: `Chair ${i}` }));
  const out = searchCatalog(rows, 'chair', 4);
  assert.deepEqual(out.map((r) => r.type), ['t0', 't1', 't2', 't3']);
});

test('an empty query opens populated; a junk query answers nothing', () => {
  assert.equal(searchCatalog(PROP_CATALOG, '').length, 50, 'the head of the list');
  assert.equal(searchCatalog(PROP_CATALOG, '   ').length, 50, 'whitespace is empty');
  assert.deepEqual(searchCatalog(PROP_CATALOG, 'zqxvblorp'), []);
});

test('every quick-slot type is findable by its own name', () => {
  for (const type of WALK_PALETTE) {
    const entry = catalogEntry(type);
    const hits = searchCatalog(PROP_CATALOG, entry.name.toLowerCase());
    assert.ok(hits.some((r) => r.type === type), `${type} answers to "${entry.name}"`);
  }
});

test('a category query finds its rows', () => {
  const hits = searchCatalog(PROP_CATALOG, 'restroom');
  assert.ok(hits.length > 0);
  assert.ok(hits.every((r) =>
    r.category.toLowerCase().includes('restroom') ||
    r.name.toLowerCase().includes('restroom') ||
    r.type.includes('restroom')));
});
