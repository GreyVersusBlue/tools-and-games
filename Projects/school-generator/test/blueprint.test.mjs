// Tests for blueprint.js — the pure half of the printable floor plan
// (`computeFloorPlan`). No canvas/DOM here, so this runs under `node --test`
// the same as every other model module; the drawing half only runs in a
// browser and is exercised by hand (see WISHLIST.md Phase 7).

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, addFloor, WALL_T_INT, WALL_T_EXT } from '../js/grid.js';
import {
  EDGE_DOOR, EDGE_DOOR2, EDGE_GLASS, EDGE_RAIL, EDGE_WINDOW, EDGE_OPENING,
} from '../js/lattice.js';
import { sheet } from './build.mjs';
import {
  addShape, setSegWall, addOpening, curveSegment, SEG_GLASS, SEG_WALL,
  LEAF_SINGLE, LEAF_DOUBLE, OP_WINDOW,
} from '../js/shapes.js';
import { addStair } from '../js/stairs.js';
import { applyFinish } from '../js/finish.js';
import { addProp } from '../js/props.js';
import { catalogEntry } from '../js/catalog.js';
import { computeFloorPlan, computeSitePlan } from '../js/blueprint.js';
import { regionsOf } from '../js/site.js';
import { buildSampleSchool } from '../js/sample.js';

// A walled box, painted on a scratch lattice and baked (see build.mjs). `x1`
// and `y1` are exclusive here, which is this file's own convention. `extra`
// gets the sheet before the bake, for a door or a finish.
function boxRoom(s, floorIndex, x0, y0, x1, y1, extra = null) {
  const sh = sheet(s, floorIndex);
  sh.box(x0, y0, x1 - 1, y1 - 1);
  if (extra) extra(sh);
  sh.bake();
}

test('a floor with nothing on it still returns an empty, well-formed plan', () => {
  const s = createState(10, 10);
  const plan = computeFloorPlan(s, 0);
  assert.equal(plan.walls.length, 0);
  assert.equal(plan.doors.length, 0);
  assert.equal(plan.rooms.length, 0);
  assert.ok(plan.bounds.maxX > plan.bounds.minX);
});

test('an unknown floor index returns null rather than throwing', () => {
  const s = createState(10, 10);
  assert.equal(computeFloorPlan(s, 5), null);
});

test('a door is a gap in the wall plus a door symbol, not a solid run', () => {
  const s = createState(10, 10);
  boxRoom(s, 0, 1, 1, 5, 5, (sh) => sh.edgeH(2, 1, EDGE_DOOR));
  const plan = computeFloorPlan(s, 0);
  assert.equal(plan.doors.length, 1);
  // The door's own wall run is split into two stubs either side of the gap —
  // never one solid segment spanning the whole cell.
  const spanning = plan.walls.filter((w) =>
    Math.abs(w.az - w.bz) < 1e-6 && Math.abs(w.az - 4) < 1e-6 && w.ax <= 8 && w.bx >= 12);
  assert.equal(spanning.length, 0);
});

test('glass and railing keep their kind rather than reading as a wall', () => {
  const s = createState(10, 10);
  const sh = sheet(s, 0);
  sh.tile(2, 2).tile(3, 2).edgeH(2, 2, EDGE_GLASS).edgeV(4, 2, EDGE_RAIL);
  sh.bake();
  const plan = computeFloorPlan(s, 0);
  const kinds = plan.walls.map((w) => w.kind).sort();
  assert.ok(kinds.includes('glass'));
  assert.ok(kinds.includes('rail'));
});

test('a wall opening cuts the same gap the walkthrough collider would', () => {
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

test('only a painted prop carries a colour onto the sheet', () => {
  // The plan is deliberately near-monochrome: a desk in its catalog brown
  // draws in the standard grey wash, and only a piece somebody chose a colour
  // for is worth the ink.
  const s = createState(20, 20);
  addProp(s, 'student-desk', { floor: 0, x: 5, z: 5 });
  addProp(s, 'student-desk', { floor: 0, x: 9, z: 5, data: { color: '#C0392B' } });
  addProp(s, 'student-desk', { floor: 0, x: 13, z: 5, data: { color: catalogEntry('student-desk').color } });
  const [plain, painted, restated] = computeFloorPlan(s, 0).props;
  assert.equal(plain.color, '');
  assert.equal(painted.color, '#c0392b', 'normalized, so the fill string is always 7 chars + alpha');
  assert.equal(restated.color, '', 'a prop repainted its own catalog colour is not a variant');
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


// ---------- Phase 2 symbols ----------

test('a door plan symbol carries the leaves the model says it has', () => {
  const s = createState(14, 14);
  boxRoom(s, 0, 2, 2, 8, 8, (sh) => {
    sh.edgeH(3, 2, EDGE_DOOR).edgeH(5, 2, EDGE_DOOR2).edgeH(6, 2, EDGE_OPENING);
  });
  const plan = computeFloorPlan(s, 0);
  const byLeaves = plan.doors.map((d) => d.leaves.length).sort();
  assert.deepEqual(byLeaves, [0, 1, 2], 'a cased opening, a single, and a pair');
  assert.ok(plan.doors.every((d) => d.kind === 'door'));
  for (const d of plan.doors) {
    for (const leaf of d.leaves) {
      assert.ok(leaf.len > 0);
      assert.notDeepEqual({ x: leaf.hx, z: leaf.hz }, leaf.end, 'a leaf goes somewhere');
    }
  }
});

test('a window is drawn over the wall, not as a gap in it', () => {
  const plain = createState(14, 14);
  boxRoom(plain, 0, 2, 2, 8, 8);
  const solidBefore = computeFloorPlan(plain, 0).walls.length;

  const s = createState(14, 14);
  boxRoom(s, 0, 2, 2, 8, 8, (sh) => sh.edgeH(3, 2, EDGE_WINDOW));
  const plan = computeFloorPlan(s, 0);
  const win = plan.doors.find((d) => d.kind === 'window');
  assert.ok(win, 'the window is in the opening list');
  assert.equal(win.leaves.length, 0, 'and hangs nothing');
  // The wall carries straight on through it — the same rule a free-drawn wall
  // follows, which since Phase 12 is the only rule there is. What differs from
  // a door is that nothing walks through it, and that is collide.js's
  // business rather than the plan's.
  assert.equal(plan.walls.length, solidBefore);
});

test('a window in a free-drawn wall never breaks the wall run either', () => {
  const s = createState(30, 30);
  const shape = addShape(s, 0, [
    { x: 0, z: 0 }, { x: 40, z: 0 }, { x: 40, z: 30 }, { x: 0, z: 30 },
  ], { name: 'Gym' });
  const before = computeFloorPlan(s, 0).walls.length;
  addOpening(shape, 0, 0, 0.5, 8, { k: OP_WINDOW });
  const withWindow = computeFloorPlan(s, 0);
  assert.equal(withWindow.walls.length, before, 'the wall carries on through it');
  assert.equal(withWindow.doors.filter((d) => d.kind === 'window').length, 1);

  addOpening(shape, 0, 1, 0.5, 3, { leaf: LEAF_SINGLE });
  const withDoor = computeFloorPlan(s, 0);
  assert.equal(withDoor.walls.length, before + 1, 'but a doorway does break it');
});

test('exterior walls come out heavier than partitions, with nobody saying so', () => {
  const s = createState(20, 20);
  boxRoom(s, 0, 2, 2, 6, 6);
  boxRoom(s, 0, 6, 2, 10, 6);   // butted up against the first
  const plan = computeFloorPlan(s, 0);
  const kinds = new Set(plan.walls.map((w) => w.t));
  assert.ok(kinds.has(WALL_T_EXT), 'the outside of the pair');
  assert.ok(kinds.has(WALL_T_INT), 'and the partition between them');
});

test('a ramp draws its slope; an elevator draws on both its floors', () => {
  const s = createState(30, 30);
  addFloor(s);
  s.currentFloor = 0;
  boxRoom(s, 0, 2, 2, 10, 10);
  boxRoom(s, 1, 2, 2, 10, 10);
  addStair(s, 0, { type: 'ramp', x: 20, z: 20, slope: 10 });
  addStair(s, 0, { type: 'elevator', x: 30, z: 30 });

  const lower = computeFloorPlan(s, 0);
  const ramp = lower.stairs.find((x) => x.kind === 'ramp');
  assert.ok(ramp);
  assert.equal(ramp.slope, 10);
  assert.equal(ramp.steps, 0, 'a ramp has no treads to draw');
  assert.ok(ramp.run > 100, 'and a run worth reporting');
  assert.ok(lower.stairs.some((x) => x.kind === 'elevator'));

  const upper = computeFloorPlan(s, 1);
  assert.ok(upper.stairs.some((x) => x.kind === 'elevator'), 'the car is on this floor too');
  assert.equal(upper.stairs.filter((x) => x.kind === 'hole').length, 1,
    'the ramp cut a hole up here, and the lift did not');
});

test('the plan carries a finish schedule for its legend', () => {
  const s = createState(20, 20);
  boxRoom(s, 0, 2, 2, 6, 6, (sh) => sh.label(2, 2, 5, 5, { fin: 'carpet' }));
  const plan = computeFloorPlan(s, 0);
  assert.equal(plan.finishes.length, 1);
  assert.equal(plan.finishes[0].key, 'carpet');
  assert.ok(plan.finishes[0].sqft > 0);
  assert.ok(plan.finishes[0].label.length > 0);
});

test('a curved wall reaches the plan as the segments it became', () => {
  const s = createState(30, 30);
  const shape = addShape(s, 0, [
    { x: 0, z: 0 }, { x: 40, z: 0 }, { x: 40, z: 30 }, { x: 0, z: 30 },
  ], { name: 'Rotunda' });
  const before = computeFloorPlan(s, 0).walls.length;
  const n = curveSegment(shape, 0, 0, 0.4);
  const after = computeFloorPlan(s, 0).walls;
  assert.equal(after.length, before + n - 1, 'one wall run per chord, and nothing special about it');
  assert.ok(after.every((w) => Number.isFinite(w.ax) && Number.isFinite(w.t)));
});

// ---------- the site plan ----------
//
// Phase 5's second sheet. Same pure-then-draw split as the floor plan, so the
// same kind of check applies: the model it hands the drawing code has to say
// the same things the model itself does.

test('a site plan reads the regions, the building and the ground', () => {
  const s = buildSampleSchool();
  const plan = computeSitePlan(s);
  assert.equal(plan.regions.length, regionsOf(s).length, 'every region is on the sheet');
  assert.ok(plan.building.length, 'and the building is one outline on it');
  assert.ok(plan.contours.length, 'a graded site has contours');
  assert.ok(plan.schedule.length, 'and a surface schedule');
  for (const r of plan.regions) {
    assert.ok(r.label && r.color, `${r.surf} has a legend entry`);
    assert.ok(r.sqft > 0);
  }
});

test('a site plan carries only the outdoor props', () => {
  const s = buildSampleSchool();
  const plan = computeSitePlan(s);
  assert.ok(plan.props.length, 'there are some');
  for (const p of plan.props) assert.equal(p.site, true, `${p.name} is an outdoor piece`);
  const names = plan.props.map((p) => p.name);
  assert.ok(!names.includes('Student Desk'), 'and none of the furniture is');
});

test('the site plan frames everything on the site', () => {
  const s = buildSampleSchool();
  const plan = computeSitePlan(s);
  for (const r of plan.regions) {
    for (const p of r.pts) {
      assert.ok(p.x >= plan.bounds.minX && p.x <= plan.bounds.maxX, 'region inside the sheet in x');
      assert.ok(p.z >= plan.bounds.minZ && p.z <= plan.bounds.maxZ, 'and in z');
    }
  }
});

test('a bare site still yields a drawable plan', () => {
  const plan = computeSitePlan(createState(10, 10));
  assert.deepEqual(plan.regions, []);
  assert.deepEqual(plan.contours, [], 'level ground has no contours');
  assert.ok(plan.bounds.maxX > plan.bounds.minX, 'and the sheet still has an extent');
});

test('contours can be turned off without touching anything else', () => {
  const s = buildSampleSchool();
  const on = computeSitePlan(s);
  const off = computeSitePlan(s, { contours: false });
  assert.ok(on.contours.length);
  assert.deepEqual(off.contours, []);
  assert.equal(off.regions.length, on.regions.length);
});
