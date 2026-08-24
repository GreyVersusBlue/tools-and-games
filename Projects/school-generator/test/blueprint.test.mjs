// Tests for blueprint.js — the pure half of the printable floor plan
// (`computeFloorPlan`). No canvas/DOM here, so this runs under `node --test`
// the same as every other model module; the drawing half only runs in a
// browser and is exercised by hand (see WISHLIST.md Phase 7).

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, addFloor, edgeHIdx, edgeVIdx, EDGE_WALL, EDGE_DOOR, EDGE_GLASS, EDGE_RAIL, setTile } from '../js/grid.js';
import { addShape, setSegWall, addOpening, SEG_GLASS } from '../js/shapes.js';
import { addStair } from '../js/stairs.js';
import { addProp } from '../js/props.js';
import { computeFloorPlan } from '../js/blueprint.js';

function boxRoom(s, floorIndex, x0, y0, x1, y1) {
  const f = s.floors[floorIndex];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) setTile(f, x, y, true);
  for (let x = x0; x < x1; x++) {
    f.edgesH[edgeHIdx(f, x, y0)] = EDGE_WALL;
    f.edgesH[edgeHIdx(f, x, y1)] = EDGE_WALL;
  }
  for (let y = y0; y < y1; y++) {
    f.edgesV[edgeVIdx(f, x0, y)] = EDGE_WALL;
    f.edgesV[edgeVIdx(f, x1, y)] = EDGE_WALL;
  }
}

test('a floor with nothing on it still returns an empty, well-formed plan', () => {
  const s = createState(10, 10);
  const plan = computeFloorPlan(s, 0);
  assert.equal(plan.walls.length, 0);
  assert.equal(plan.doors.length, 0);
  assert.equal(plan.rooms.length, 0);
  assert.equal(plan.gridLabels.length, 0);
  assert.ok(plan.bounds.maxX > plan.bounds.minX);
});

test('an unknown floor index returns null rather than throwing', () => {
  const s = createState(10, 10);
  assert.equal(computeFloorPlan(s, 5), null);
});

test('a grid door is a gap in the wall plus a door symbol, not a solid run', () => {
  const s = createState(10, 10);
  boxRoom(s, 0, 1, 1, 5, 5);
  s.floors[0].edgesH[edgeHIdx(s.floors[0], 2, 1)] = EDGE_DOOR;
  const plan = computeFloorPlan(s, 0);
  assert.equal(plan.doors.length, 1);
  // The door's own wall run is split into two stubs either side of the gap —
  // never one solid segment spanning the whole cell.
  const spanning = plan.walls.filter((w) =>
    Math.abs(w.az - w.bz) < 1e-6 && Math.abs(w.az - 4) < 1e-6 && w.ax <= 8 && w.bx >= 12);
  assert.equal(spanning.length, 0);
});

test('glass and railing edges keep their kind rather than reading as a wall', () => {
  const s = createState(10, 10);
  const f = s.floors[0];
  setTile(f, 2, 2, true); setTile(f, 3, 2, true);
  f.edgesH[edgeHIdx(f, 2, 2)] = EDGE_GLASS;
  f.edgesV[edgeVIdx(f, 4, 2)] = EDGE_RAIL;
  const plan = computeFloorPlan(s, 0);
  const kinds = plan.walls.map((w) => w.kind).sort();
  assert.ok(kinds.includes('glass'));
  assert.ok(kinds.includes('rail'));
});

test('a polygon wall opening cuts the same gap the walkthrough collider would', () => {
  const s = createState(20, 20);
  const shape = addShape(s, 0, [
    { x: 0, z: 0 }, { x: 20, z: 0 }, { x: 20, z: 20 }, { x: 0, z: 20 },
  ], { name: 'Commons', color: '#a9d3e8' });
  addOpening(shape, 0, 0, 0.5, 3);
  const plan = computeFloorPlan(s, 0);
  assert.equal(plan.doors.length, 1);
  assert.ok(plan.doors[0].w > 0);
  // The top edge (segment 0, from (0,0) to (20,0)) should be split around the
  // opening rather than drawn as one 20ft run.
  const topRuns = plan.walls.filter((w) => Math.abs(w.az) < 1e-6 && Math.abs(w.bz) < 1e-6);
  assert.ok(topRuns.length >= 2);
  for (const r of topRuns) assert.ok(Math.hypot(r.bx - r.ax, r.bz - r.az) < 20);
});

test('a polygon room reports its own area and a label point inside it', () => {
  const s = createState(20, 20);
  addShape(s, 0, [
    { x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 6 }, { x: 0, z: 6 },
  ], { name: 'Library', color: '#e8b4c8' });
  const plan = computeFloorPlan(s, 0);
  assert.equal(plan.rooms.length, 1);
  assert.equal(plan.rooms[0].name, 'Library');
  assert.ok(Math.abs(plan.rooms[0].sqft - 60) < 1e-6);
  assert.ok(plan.rooms[0].labelX >= 0 && plan.rooms[0].labelX <= 10);
});

test('a glass segment can still hold a door and still reports its kind', () => {
  const s = createState(20, 20);
  const shape = addShape(s, 0, [
    { x: 0, z: 0 }, { x: 20, z: 0 }, { x: 20, z: 20 }, { x: 0, z: 20 },
  ]);
  setSegWall(shape, 0, 0, SEG_GLASS);
  addOpening(shape, 0, 0, 0.5, 3);
  const plan = computeFloorPlan(s, 0);
  assert.ok(plan.walls.some((w) => w.kind === 'glass'));
  assert.equal(plan.doors.length, 1);
});

test('a placed stair symbol carries its run and step count; the floor above only sees the hole', () => {
  const s = createState(20, 20);
  addFloor(s);
  const { link } = addStair(s, 0, { type: 'stair', x: 10, z: 10, rotationY: 0 });
  assert.ok(link);
  const lower = computeFloorPlan(s, 0);
  const upper = computeFloorPlan(s, 1);
  const stairSym = lower.stairs.find((sym) => sym.kind === 'stair');
  assert.ok(stairSym);
  assert.ok(stairSym.steps > 0);
  assert.equal(upper.stairs.filter((sym) => sym.kind === 'hole').length, 1);
  assert.equal(upper.stairs.filter((sym) => sym.kind === 'stair').length, 0);
});

test('a floor opening is its own symbol kind, distinct from a staircase', () => {
  const s = createState(20, 20);
  addFloor(s);
  addStair(s, 0, { type: 'opening', x: 10, z: 10, w: 8, d: 8 });
  const plan = computeFloorPlan(s, 0);
  assert.equal(plan.stairs.filter((sym) => sym.kind === 'opening').length, 1);
});

test('furniture is read from the catalog; an unknown prop type is skipped rather than crashing', () => {
  const s = createState(20, 20);
  addProp(s, 'student-desk', { floor: 0, x: 5, z: 5, rotationY: 0 });
  addProp(s, 'not-a-real-type', { floor: 0, x: 6, z: 6 });
  const plan = computeFloorPlan(s, 0);
  assert.equal(plan.props.length, 1);
  assert.equal(plan.props[0].name, 'Student Desk');
});

test('a ceiling-mounted prop is skipped — nothing to show on a floor plan', () => {
  const s = createState(20, 20);
  // tv is a catalog wall-mount; force a ceiling mount to exercise the branch
  const p = addProp(s, 'tv', { floor: 0, x: 5, z: 5 });
  p.mount = 'ceiling';
  const plan = computeFloorPlan(s, 0);
  assert.equal(plan.props.length, 0);
});

test('bounds grow to fit a polygon room or prop that sits outside the grid footprint', () => {
  const s = createState(5, 5); // 20x20ft grid
  addShape(s, 0, [
    { x: 30, z: 0 }, { x: 40, z: 0 }, { x: 40, z: 10 }, { x: 30, z: 10 },
  ], { name: 'Wing' });
  const plan = computeFloorPlan(s, 0);
  assert.ok(plan.bounds.maxX >= 40);
});
