// Tests for collide.js — the walkthrough's physics. Pure module, so the whole
// of it runs under `node --test` from Projects/school-generator: no browser, no
// three.js, no build step.
//
// The three things worth being sure of, because they're the ones you'd only
// notice by walking around: a wall stops you, a doorway doesn't, and the edge
// of a floor stops you without dropping you down a storey.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, addFloor, CELL, DOOR_W, WALL_T, FLOOR_H, WALL_H, WALL_T_INT, WALL_T_EXT } from '../js/grid.js';
import {
  EDGE_WALL, EDGE_DOOR, EDGE_DOOR2, EDGE_GLASS, EDGE_RAIL,
  EDGE_WINDOW, EDGE_OPENING,
} from '../js/lattice.js';
import { sheet, boxRoom } from './build.mjs';
import {
  addShape, setSegWall, addOpening, SEG_WALL, SEG_NONE, SEG_GLASS,
  LEAF_SINGLE, LEAF_DOUBLE, OP_WINDOW,
} from '../js/shapes.js';
import { addProp } from '../js/props.js';
import {
  addStair, stairMetrics, stairsOf, isRun, runLength, localToWorld, stairSurfaceAt, HEADROOM,
} from '../js/stairs.js';
import { catalogEntry } from '../js/catalog.js';
import { buildSampleSchool } from '../js/sample.js';
import {
  WALKER_R, WALL_PAD, STEP_UP, STEP_DOWN, MIN_OBSTACLE_H, GROUND_Y,
  HEAD_H, SOFFIT_T,
  solidSpans, segsCross, wallSegments, propObstacles, buildCollider, updateDoors,
  resolvePoint, crossesWall, storeyAt, supportAt, tryStep, moveWalker,
  openingRailSegments, elevatorSegments, doorSegments, emptyCollider,
  overheadAt, headroomAt,
} from '../js/collide.js';
import { elevatorSize } from '../js/stairs.js';
import {
  ensureTerrain, terrainField, raiseTerrain, groundAt, MIN_BRUSH, MAX_BRUSH,
} from '../js/terrain.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// A room with a wall all the way round it, on the ground floor — painted with
// the 4ft brush and baked, which is the state the editor actually produces.
// `extra` gets the sheet before the bake.
function walledRoom(x0 = 2, y0 = 2, x1 = 6, y1 = 5, extra = null) {
  const s = createState(20, 20);
  const sh = sheet(s, 0);
  sh.box(x0, y0, x1, y1);
  if (extra) extra(sh);
  sh.bake();
  return s;
}

// A slab of bare floor with no walls on it, for the tests about edges.
function slabOn(s, floorIndex, x0, y0, x1, y1) {
  const sh = sheet(s, floorIndex);
  sh.fill(x0, y0, x1, y1);
  sh.bake();
  return s;
}

const collide = (s, i = 0) => buildCollider(s, i, catalogEntry);
const feetAt = (x, z, y = 0) => ({ x, y, z });

// ---------- spans ----------

test('a run with no openings is one solid span', () => {
  assert.deepEqual(solidSpans(10, [], 0.25), [[0, 10]]);
});

test('an opening splits a run and pulls the cut ends back by the trim', () => {
  const spans = solidSpans(10, [{ a: 4, b: 6 }], 0.25);
  assert.equal(spans.length, 2);
  assert.deepEqual(spans[0], [0, 3.75]);
  assert.deepEqual(spans[1], [6.25, 10]);
});

test('an opening at the very start leaves only the far span', () => {
  assert.deepEqual(solidSpans(10, [{ a: -2, b: 3 }], 0), [[3, 10]]);
});

test('overlapping openings merge rather than producing a sliver between them', () => {
  const spans = solidSpans(12, [{ a: 2, b: 6 }, { a: 5, b: 9 }], 0);
  assert.deepEqual(spans, [[0, 2], [9, 12]]);
});

test('an opening the length of the run leaves nothing solid', () => {
  assert.deepEqual(solidSpans(8, [{ a: 0, b: 8 }], 0), []);
});

// ---------- segment enumeration ----------

test('every built boundary kind blocks, and an unbuilt side does not', () => {
  // One cell with three of its four sides built out of three different things.
  const s = createState(6, 6);
  const sh = sheet(s, 0);
  sh.tile(1, 1).edgeH(1, 1, EDGE_WALL).edgeH(1, 2, EDGE_GLASS).edgeV(1, 1, EDGE_RAIL);
  sh.bake();
  const segs = wallSegments(s.floors[0]);
  assert.equal(segs.length, 3, 'glass and railing stop a body just as drywall does');
  const kinds = new Set(segs.map((g) => g.t));
  assert.ok(kinds.size >= 1);
  // The fourth side was never built, so nothing stands on it.
  const ring = s.floors[0].shapes[0].rings[0];
  assert.equal(ring.walls.filter((w) => w === 0).length, 1);
});

test('a door leaves a gap a walker actually fits through', () => {
  const s = createState(6, 6);
  const sh = sheet(s, 0);
  sh.tile(0, 1).edgeH(0, 1, EDGE_DOOR);
  sh.bake();
  const segs = wallSegments(s.floors[0]);
  assert.equal(segs.length, 2, 'two jambs, one opening');
  const inner = [Math.max(segs[0].ax, segs[0].bx), Math.min(segs[1].ax, segs[1].bx)].sort((a, b) => a - b);
  const gap = inner[1] - inner[0];
  // Since Phase 2 the trim is the *segment's own* half-thickness, not one
  // figure for the whole building — this wall has open air on one side, so it
  // is an exterior wall and trims back further than a partition would.
  const pad = segs[0].pad;
  assert.ok(pad > WALL_PAD, 'a wall with nothing behind it is an exterior wall');
  assert.ok(near(gap, DOOR_W + 2 * pad),
    'the gap opens up by the trim so inflating the jambs gives back a true door width');
  const clear = gap - 2 * (WALKER_R + pad);
  assert.ok(clear > 0.5, `a body has ${clear.toFixed(2)}ft of room to aim at`);
});

test('a polygon wall becomes a segment, and its doorway a hole in one', () => {
  const s = createState(20, 20);
  const shape = addShape(s, 0, [
    { x: 10, z: 10 }, { x: 30, z: 10 }, { x: 30, z: 26 }, { x: 10, z: 26 },
  ], { name: 'Commons' });
  assert.ok(shape);
  assert.equal(wallSegments(s.floors[0]).length, 4);

  const seg = shape.rings[0].walls.findIndex((w) => w === SEG_WALL);
  addOpening(shape, 0, seg, 0.5, DOOR_W);
  assert.equal(wallSegments(s.floors[0]).length, 5, 'the walled side is now two pieces');

  setSegWall(shape, 0, seg, SEG_NONE);
  assert.equal(wallSegments(s.floors[0]).length, 3, 'an unbuilt segment is not a boundary');

  setSegWall(shape, 0, seg, SEG_GLASS);
  assert.ok(wallSegments(s.floors[0]).length >= 4, 'glass is');
});

// ---------- props ----------

test('tall floor-standing props are obstacles; rugs and wall panels are not', () => {
  const s = walledRoom();
  addProp(s, 'teacher-desk', { floor: 0, x: 14, z: 14 });
  addProp(s, 'rug', { floor: 0, x: 18, z: 14 });
  addProp(s, 'tv', { floor: 0, x: 20, z: 8, mount: 'wall' });
  const obs = propObstacles(s, 0, catalogEntry);
  assert.equal(obs.length, 1);
  assert.equal(obs[0].type, 'teacher-desk');
  assert.ok(catalogEntry('rug').h < MIN_OBSTACLE_H);
});

test('props on another storey are not in this storey\'s collider', () => {
  const s = walledRoom();
  addFloor(s);
  addProp(s, 'teacher-desk', { floor: 1, x: 14, z: 14 });
  assert.equal(propObstacles(s, 0, catalogEntry).length, 0);
  assert.equal(propObstacles(s, 1, catalogEntry).length, 1);
});

// ---------- resolution ----------

test('a point in the open is left exactly where it is', () => {
  const s = walledRoom();
  const c = collide(s);
  const p = resolvePoint(c, 16, 14);
  assert.ok(near(p.x, 16) && near(p.z, 14));
});

test('a point inside a wall is pushed out to standing distance', () => {
  const s = walledRoom(2, 2, 6, 5);
  const c = collide(s);
  // The room's north wall runs along z = 8.
  const p = resolvePoint(c, 16, 8.1);
  assert.ok(Math.abs(p.z - 8) >= WALKER_R + WALL_PAD - 1e-6, 'clear of the wall');
  assert.ok(p.z > 8, 'and out the side it was already on');
  assert.ok(near(p.x, 16), 'without sliding along it');
});

test('an inside corner resolves against both walls at once', () => {
  const s = walledRoom(2, 2, 6, 5);
  const c = collide(s);
  // North-west corner of the room: walls at x = 8 and z = 8.
  const p = resolvePoint(c, 8.2, 8.2);
  const r = WALKER_R + WALL_PAD - 1e-6;
  assert.ok(p.x - 8 >= r && p.z - 8 >= r, 'pushed clear of both, not just the last one seen');
});

test('a step that jumps clean over a wall is detected as a crossing', () => {
  const s = walledRoom(2, 2, 6, 5);
  const c = collide(s);
  assert.ok(crossesWall(c, 16, 9, 16, 7), 'through the north wall');
  assert.ok(!crossesWall(c, 16, 12, 16, 14), 'and not for a step inside the room');
});

test('segsCross is about crossing, not about touching or being parallel', () => {
  assert.ok(segsCross(0, 0, 4, 4, 0, 4, 4, 0));
  assert.ok(!segsCross(0, 0, 4, 0, 0, 1, 4, 1));
  assert.ok(!segsCross(0, 0, 1, 0, 2, -1, 2, 1));
});

// ---------- support ----------

test('a slab holds you up at its own level, and the ground holds you outside', () => {
  const s = walledRoom();
  const inside = supportAt(s, 16, 14, 0);
  assert.equal(inside.kind, 'floor');
  assert.equal(inside.y, 0);
  const outside = supportAt(s, 70, 70, 0);
  assert.equal(outside.kind, 'ground');
  assert.equal(outside.y, GROUND_Y);
});

test('an upper storey holds you up at its own height', () => {
  const s = walledRoom();
  addFloor(s);
  slabOn(s, 1, 2, 2, 6, 5);
  const up = supportAt(s, 16, 14, FLOOR_H);
  assert.equal(up.kind, 'floor');
  assert.equal(up.y, FLOOR_H);
  assert.equal(up.floor, 1);
  // From the ground floor you can't reach it — it's a ceiling, not a step.
  assert.equal(supportAt(s, 16, 14, 0).y, 0);
});

test('a floor opening is not floor: over the hole, the support is the level below', () => {
  const s = walledRoom();
  addFloor(s);
  slabOn(s, 1, 0, 0, 19, 19);
  const { link } = addStair(s, 0, { type: 'opening', x: 16, z: 14, w: 8, d: 8 });
  assert.ok(link);
  const overHole = supportAt(s, 16, 14, FLOOR_H);
  assert.equal(overHole.y, 0, 'you would be standing on the storey below, twelve feet down');
  const beside = supportAt(s, 16, 30, FLOOR_H);
  assert.equal(beside.y, FLOOR_H);
});

test('a stair is a ramp you can be supported by, at any point up the run', () => {
  const s = walledRoom();
  addFloor(s);
  const m = stairMetrics(s);
  const { link } = addStair(s, 0, { type: 'stair', x: 16, z: 14, rotationY: 0 });
  assert.ok(link);
  const bottom = supportAt(s, 16, 14.1, 0);
  assert.equal(bottom.kind, 'stair');
  const half = supportAt(s, 16, 14 + m.run / 2, m.rise / 2);
  assert.equal(half.kind, 'stair');
  assert.ok(near(half.y, m.rise / 2, 0.05), 'half way along is half way up');
  const top = supportAt(s, 16, 14 + m.run, m.rise);
  assert.ok(near(top.y, m.rise, 1e-6));
});

test('storeyAt hands you to the level above only once you have arrived', () => {
  const s = walledRoom();
  addFloor(s);
  assert.equal(storeyAt(s, 0), 0);
  assert.equal(storeyAt(s, FLOOR_H - 0.1), 0, 'the top step is still the storey you climbed from');
  assert.equal(storeyAt(s, FLOOR_H), 1);
  assert.equal(storeyAt(s, 999), 1, 'and it never runs off the top of the building');
  assert.equal(storeyAt(s, -5), 0);
});

// ---------- moving ----------

test('walking into a wall stops you at it', () => {
  const s = walledRoom(2, 2, 6, 5);
  const c = collide(s);
  // Standing just inside the north wall (z = 8), walking north.
  const from = feetAt(16, 10);
  let pos = from;
  for (let i = 0; i < 40; i++) {
    const r = moveWalker(s, c, pos, 0, -0.5);
    pos = { x: r.x, y: 0, z: r.z };
  }
  assert.ok(pos.z >= 8 + WALKER_R + WALL_PAD - 1e-6, 'never got through');
  assert.ok(pos.z < 8 + 2 * (WALKER_R + WALL_PAD), 'but did get right up to it');
});

test('walking at a wall on the diagonal slides along it', () => {
  const s = walledRoom(2, 2, 6, 5);
  const c = collide(s);
  const start = feetAt(16, 10);
  const r = moveWalker(s, c, start, 0.4, -0.4);
  assert.equal(r.blocked, false);
  assert.ok(r.x > start.x + 0.2, 'the along-wall half of the move still happened');
});

test('a doorway is walkable, and the wall either side of it is not', () => {
  // Door in the north wall, cell x = 4.
  const s = walledRoom(2, 2, 6, 5, (sh) => sh.edgeH(4, 2, EDGE_DOOR));
  const c = collide(s);
  const doorX = (4 + 0.5) * CELL;
  let pos = feetAt(doorX, 10);
  for (let i = 0; i < 30; i++) {
    // Since Phase 2 the doorway hangs a leaf, and a shut leaf is as solid as
    // the wall it hangs in — so walking through one means letting it open,
    // which is what the walkthrough's own loop does every frame.
    updateDoors(c, pos.x, pos.z, 1 / 30);
    const r = moveWalker(s, c, pos, 0, -0.4);
    pos = { x: r.x, y: 0, z: r.z };
  }
  assert.ok(pos.z < 7, `walked out through the door (ended at z=${pos.z.toFixed(2)})`);

  let beside = feetAt(doorX + CELL, 10);
  for (let i = 0; i < 30; i++) {
    updateDoors(c, beside.x, beside.z, 1 / 30);
    const r = moveWalker(s, c, beside, 0, -0.4);
    beside = { x: r.x, y: 0, z: r.z };
  }
  assert.ok(beside.z >= 8, 'the next cell along is still wall');
});

test('a desk is something you walk around, a rug something you walk over', () => {
  const s = walledRoom(2, 2, 6, 5);
  addProp(s, 'teacher-desk', { floor: 0, x: 16, z: 14, rotationY: 0 });
  addProp(s, 'rug', { floor: 0, x: 16, z: 20 });
  const c = collide(s);
  const atDesk = moveWalker(s, c, feetAt(16, 18), 0, -1);
  assert.ok(atDesk.z > 15.5, 'stopped short of the desk');
  const atRug = moveWalker(s, c, feetAt(16, 22), 0, -1);
  assert.ok(near(atRug.z, 21), 'walked straight over the rug');
});

test('a grounded walker stops at the edge of a floor instead of falling off it', () => {
  const s = walledRoom();
  addFloor(s);
  // A partial upper storey: cells x 2..6, y 2..5, no walls, so the only thing
  // that can stop you is the edge itself.
  slabOn(s, 1, 2, 2, 6, 5);
  const c = collide(s, 1);
  let pos = feetAt(16, 10, FLOOR_H);   // upper slab, two cells in from its north edge
  for (let i = 0; i < 30; i++) {
    const r = moveWalker(s, c, pos, 0, -0.4, { grounded: true });
    pos = { x: r.x, y: FLOOR_H, z: r.z };
  }
  assert.ok(pos.z >= 8 - 1e-6, `stopped at the edge (z=${pos.z.toFixed(2)})`);
  const off = tryStep(s, c, feetAt(16, 8.2, FLOOR_H), 0, -1, { grounded: true });
  assert.equal(off, null, 'and the step over the edge is refused outright');
});

test('the same step is allowed in mid-air — a jump off a mezzanine is deliberate', () => {
  const s = walledRoom();
  addFloor(s);
  slabOn(s, 1, 2, 2, 6, 5);
  const c = collide(s, 1);
  const airborne = tryStep(s, c, feetAt(16, 8.2, FLOOR_H + 1), 0, -1, { grounded: false });
  assert.ok(airborne, 'nothing to stop at when your feet are already off the floor');
  assert.equal(airborne.support.y, GROUND_Y, 'and what is under you is the ground');
});

test('a step up onto a kerb is fine; a step up onto a storey is not', () => {
  const s = walledRoom();
  const low = supportAt(s, 16, 14, -STEP_UP + 0.1);
  assert.ok(low, 'a surface within a step is reachable');
  assert.equal(supportAt(s, 16, 14, -STEP_UP - 1, { ground: false }), null,
    'and one further up than that is not');
});

test('walking off the ground floor slab onto the site is not a fall', () => {
  const s = walledRoom(2, 2, 6, 5, (sh) => sh.edgeH(4, 2, EDGE_DOOR));
  const c = collide(s);
  const out = moveWalker(s, c, feetAt((4 + 0.5) * CELL, 7.5), 0, -1, { grounded: true });
  assert.equal(out.blocked, false);
  assert.equal(out.support.kind, 'ground');
  assert.ok(near(out.support.y, 0), 'the slab and the site are the same height, so nothing drops');
});

test('a stalled frame that would step through a wall is refused, not teleported', () => {
  const s = walledRoom(2, 2, 6, 5);
  const c = collide(s);
  const jump = tryStep(s, c, feetAt(16, 9), 0, -4, {});
  assert.equal(jump, null);
});

test('nothing to walk on and no ground leaves you unsupported', () => {
  const s = createState(10, 10);
  assert.equal(supportAt(s, 5, 5, 0, { ground: false }), null);
  assert.equal(supportAt(s, 5, 5, 0).kind, 'ground');
});

// ---------- the sample school ----------

test('the demo school is walkable: enclosed, furnished, and climbable', () => {
  const s = buildSampleSchool();
  const ground = collide(s, 0);
  assert.ok(ground.segs.length > 50, 'a storey of walls to collide with');
  assert.ok(ground.props.length > 0, 'and furniture in the way');

  // The hall runs east-west through the middle of the ground floor; walking
  // north out of it has to end at a wall rather than in a classroom.
  const inHall = feetAt(20 * CELL, 14 * CELL + CELL / 2);
  let pos = inHall;
  for (let i = 0; i < 200; i++) {
    const r = moveWalker(s, ground, pos, 0, -0.4, { grounded: true });
    pos = { x: r.x, y: 0, z: r.z };
  }
  assert.ok(pos.z > 0, 'the north face of the building stopped us');

  // And the staircase in it reaches the storey above.
  const m = stairMetrics(s);
  const stair = s.links.find((l) => l.type === 'stair');
  assert.ok(stair, 'the sample has a run in it');
  const top = supportAt(s, stair.x, stair.z, stair.from * FLOOR_H, {});
  assert.ok(top, 'with something under your feet at the bottom of it');
  assert.ok(m.rise > 0);
});

test('a walker cannot leave the sample school through a solid exterior wall', () => {
  const s = buildSampleSchool();
  const c = collide(s, 0);
  // Straight south out of the gym block — no doors on that face.
  let pos = feetAt(10 * CELL, 20 * CELL);
  const startZ = pos.z;
  for (let i = 0; i < 300; i++) {
    const r = moveWalker(s, c, pos, 0, 0.4, { grounded: true });
    pos = { x: r.x, y: 0, z: r.z };
  }
  assert.ok(pos.z > startZ, 'we did move');
  assert.ok(pos.z < s.h * CELL, 'but never past the footprint');
});

test('STEP_UP and STEP_DOWN are steps, not storeys', () => {
  assert.ok(STEP_UP < FLOOR_H / 4);
  assert.ok(STEP_DOWN < FLOOR_H / 4);
  assert.ok(WALKER_R * 2 < DOOR_W, 'a body fits through a door');
  assert.ok(near(WALL_PAD, WALL_T / 2));
});

// ---------- the rails a floor opening puts up ----------

test('the guardrail around a mezzanine void stops you before the edge does', () => {
  const s = createState(20, 20);
  addFloor(s);
  slabOn(s, 0, 0, 0, 19, 19);
  slabOn(s, 1, 0, 0, 19, 19);
  const { link } = addStair(s, 0, { type: 'opening', x: 40, z: 40, w: 8, d: 8 });
  assert.ok(link);

  const rails = openingRailSegments(s, 1);
  assert.equal(rails.length, 4, 'a hole in the middle of a slab is railed all round');
  assert.equal(openingRailSegments(s, 0).length, 0, 'the storey below only has the ceiling of it');

  const c = collide(s, 1);
  let pos = { x: 40, y: FLOOR_H, z: 50 };
  for (let i = 0; i < 40; i++) {
    const r = moveWalker(s, c, pos, 0, -0.4, { grounded: true });
    pos = { x: r.x, y: FLOOR_H, z: r.z };
  }
  assert.ok(pos.z > 44, `held off the rail at z=${pos.z.toFixed(2)}, not just off the hole at 44`);
});

test('a stair leaves its landing side open — the rail is not a gate', () => {
  const s = createState(20, 20);
  addFloor(s);
  slabOn(s, 0, 0, 0, 19, 19);
  slabOn(s, 1, 0, 0, 19, 19);
  const { link } = addStair(s, 0, { type: 'stair', x: 30, z: 20, rotationY: 0 });
  assert.ok(link);
  const rails = openingRailSegments(s, 1);
  assert.equal(rails.length, 3, 'three sides railed, and the top of the run walked out of');

  // Standing on the landing at the top, we can walk forward onto the storey.
  const m = stairMetrics(s);
  const c = collide(s, 1);
  const landing = { x: 30, y: FLOOR_H, z: 20 + m.run + 2 };
  const out = moveWalker(s, c, landing, 0, 0.5, { grounded: true });
  assert.equal(out.blocked, false);
  assert.ok(out.z > landing.z);
});


// ---------- windows are not doors ----------

test('a window glazes a wall; it never opens a hole you can walk through', () => {
  const solid = wallSegments(walledRoom(2, 2, 6, 5).floors[0]).length;
  const s = walledRoom(2, 2, 6, 5, (sh) => sh.edgeH(4, 2, EDGE_WINDOW));
  // The wall carries straight on through the glazing, so the run isn't even
  // split — which is the same answer a free-drawn wall gives.
  const withWindow = wallSegments(s.floors[0]);
  assert.equal(withWindow.length, solid, 'the wall is still there, in one piece');

  const doorX = (4 + 0.5) * CELL;
  const c = collide(s);
  let pos = feetAt(doorX, 10);
  for (let i = 0; i < 40; i++) {
    updateDoors(c, pos.x, pos.z, 1 / 30);
    const r = moveWalker(s, c, pos, 0, -0.4);
    pos = { x: r.x, y: 0, z: r.z };
  }
  assert.ok(pos.z >= 8, `a window is not a way out (ended at z=${pos.z.toFixed(2)})`);
});

test('a window on a free-drawn wall leaves the run unbroken too', () => {
  const s = createState(20, 20);
  const shape = addShape(s, 0, [
    { x: 10, z: 10 }, { x: 40, z: 10 }, { x: 40, z: 30 }, { x: 10, z: 30 },
  ], { name: 'Gym' });
  const before = wallSegments(s.floors[0]).length;
  addOpening(shape, 0, 0, 0.5, 10, { k: OP_WINDOW });
  assert.equal(wallSegments(s.floors[0]).length, before, 'no gap appeared');
  addOpening(shape, 0, 1, 0.5, DOOR_W, { leaf: LEAF_SINGLE });
  assert.equal(wallSegments(s.floors[0]).length, before + 1, 'but a doorway does open one');
});

// ---------- door leaves ----------

const roomWithLeafDoor = (edge = EDGE_DOOR) =>
  walledRoom(2, 2, 6, 5, (sh) => sh.edgeH(4, 2, edge));

test('a shut door is as solid as the wall it hangs in', () => {
  const s = roomWithLeafDoor();
  const c = collide(s);
  assert.equal(c.doors.length, 1);
  const doorX = (4 + 0.5) * CELL;
  // No updateDoors call at all: the leaf never moves, so it never lets you by.
  let pos = feetAt(doorX, 10);
  for (let i = 0; i < 40; i++) {
    const r = moveWalker(s, c, pos, 0, -0.4);
    pos = { x: r.x, y: 0, z: r.z };
  }
  assert.ok(pos.z >= 8, `shut means shut (ended at z=${pos.z.toFixed(2)})`);
});

test('a cased opening hangs no leaf, so it is a hole and stays one', () => {
  const s = roomWithLeafDoor(EDGE_OPENING);
  const c = collide(s);
  assert.equal(c.doors.length, 0);
  const doorX = (4 + 0.5) * CELL;
  let pos = feetAt(doorX, 10);
  for (let i = 0; i < 30; i++) {
    const r = moveWalker(s, c, pos, 0, -0.4);
    pos = { x: r.x, y: 0, z: r.z };
  }
  assert.ok(pos.z < 7, 'walked straight through, with nothing to open');
});

test('a double door opens as a pair and lets a body through the middle', () => {
  const s = roomWithLeafDoor(EDGE_DOOR2);
  const c = collide(s);
  assert.equal(c.doors.length, 2);
  const doorX = (4 + 0.5) * CELL;
  let pos = feetAt(doorX, 11);
  const peak = c.doors.map(() => 0);
  for (let i = 0; i < 60; i++) {
    updateDoors(c, pos.x, pos.z, 1 / 30);
    c.doors.forEach((d, k) => { peak[k] = Math.max(peak[k], d.open); });
    const r = moveWalker(s, c, pos, 0, -0.35);
    pos = { x: r.x, y: 0, z: r.z };
  }
  assert.ok(peak.every((v) => v > 0.5), `both halves moved (peaked at ${peak})`);
  assert.ok(pos.z < 7, `and a body fits between them (ended at z=${pos.z.toFixed(2)})`);
  // ...and they shut again once you're well down the corridor, which is the
  // other half of the behaviour and the reason `peak` is tracked at all.
  assert.ok(c.doors.every((d) => d.open < 0.5), 'and closed behind them');
});

test('door segments track the leaves, and change when they swing', () => {
  const s = roomWithLeafDoor();
  const c = collide(s);
  const shut = doorSegments(c)[0];
  c.doors[0].open = 1;
  const open = doorSegments(c)[0];
  assert.ok(near(shut.ax, open.ax) && near(shut.az, open.az), 'the hinge does not move');
  assert.ok(Math.hypot(open.bx - shut.bx, open.bz - shut.bz) > 1, 'the free edge does');
  assert.ok(open.pad > 0 && open.pad < WALL_T_INT, 'a leaf is thinner than a wall');
});

test('a step that would cross a shut leaf is refused outright', () => {
  const s = roomWithLeafDoor();
  const c = collide(s);
  const doorX = (4 + 0.5) * CELL;
  assert.equal(crossesWall(c, doorX, 9, doorX, 7), true, 'shut, it is in the way');
  c.doors[0].open = 1;
  assert.equal(crossesWall(c, doorX, 9, doorX, 7), false, 'open, it is not');
});

// ---------- elevators ----------

test('a shaft keeps you in the car and lets you in one way', () => {
  const s = createState(20, 20);
  addFloor(s);
  s.currentFloor = 0;
  slabOn(s, 0, 0, 0, 11, 11);
  const { link } = addStair(s, 0, { type: 'elevator', x: 24, z: 24, rotationY: 0 });
  const segs = elevatorSegments(s, 0);
  assert.equal(segs.length, 5);
  assert.equal(elevatorSegments(s, 1).length, 5, 'on both storeys, because the car is on both');

  const { w, d } = elevatorSize(link);
  const c = { floor: 0, segs, props: [], doors: [] };
  // Pushed out of the back wall, back into the car.
  const inside = resolvePoint(c, 24, 24 + d / 2 - 0.1);
  assert.ok(inside.z < 24 + d / 2 - WALKER_R, 'the back wall stops you');
  // The entry face is open in the middle and solid at the jambs.
  assert.equal(crossesWall(c, 24, 24 - d, 24, 24), false, 'straight in through the doors');
  assert.equal(crossesWall(c, 24 + w / 2 - 0.4, 24 - d, 24 + w / 2 - 0.4, 24), true,
    'but not through the jamb beside them');
});

// ---------- thickness ----------

test('the collider pads each wall by its own half-thickness', () => {
  const s = createState(20, 20);
  const sh = sheet(s, 0);
  // Two rooms side by side: the shell has weather outside it, the partition
  // between them has a room on each side, and nobody said which is which.
  sh.box(1, 1, 8, 4);
  sh.vrun(5, 1, 4, EDGE_WALL);
  sh.bake();
  const segs = wallSegments(s.floors[0]);
  const pads = [...new Set(segs.map((x) => x.pad))].sort();
  assert.deepEqual(pads, [WALL_T_INT / 2, WALL_T_EXT / 2]);
  assert.ok(segs.every((x) => x.t === x.pad * 2));
});

// ---------- the site under your feet ----------
//
// Phase 5 of the second arc: `GROUND_Y` stops being the answer to "what is
// outside the building" and becomes only the answer for a design that never
// graded anything.

test('a design with no terrain still stands on datum', () => {
  const s = walledRoom();
  assert.equal(supportAt(s, 70, 70, 0).y, GROUND_Y);
  assert.equal(supportAt(s, 70, 70, 0).kind, 'ground');
});

test('graded ground is what holds you up outside', () => {
  const s = walledRoom();
  const t = ensureTerrain(s);
  raiseTerrain(t, 300, 300, MAX_BRUSH, 8);
  const site = terrainField(s);
  const under = supportAt(s, 300, 300, 8, { site });
  assert.equal(under.kind, 'ground');
  assert.ok(under.y > 6, `the berm holds you at ${under.y}ft`);
  // ...and the slab still wins inside, because the pad holds it at datum.
  const inside = supportAt(s, 16, 14, 0, { site });
  assert.equal(inside.kind, 'floor');
  assert.equal(inside.y, 0);
});

test('the collider carries the site it was built against', () => {
  const s = walledRoom();
  const t = ensureTerrain(s);
  raiseTerrain(t, 300, 300, MAX_BRUSH, 8);
  const c = collide(s);
  assert.ok(c.site, 'built one for itself');
  // A step taken with that collider is resolved against the graded ground
  // without the caller having to say so.
  const r = moveWalker(s, c, feetAt(300, 300, 8), 0.4, 0, { grounded: true });
  assert.ok(r.support.y > 6, 'the walker is standing on the berm');
});

test('a bank too steep to step up refuses you, and one you can does not', () => {
  const s = walledRoom();
  const t = ensureTerrain(s);
  // A tight, tall mound: a wall of earth on its flank.
  raiseTerrain(t, 300, 300, MIN_BRUSH, 20);
  const c = collide(s);
  const flank = moveWalker(s, c, feetAt(300 - MIN_BRUSH, 300, 0), -0.0, 0, { grounded: true });
  assert.ok(flank.support, 'there is ground under you at the foot of it');
  const climb = tryStep(s, c, feetAt(300 - MIN_BRUSH + 1, 300, 0), -0, 0, { grounded: true });
  assert.ok(climb === null || climb.support.y <= STEP_UP + 1e-6,
    'you never end up more than a step above where you started');
});

test('a berm hands you the ground storey, not the one above it', () => {
  const s = walledRoom();
  addFloor(s, 1);
  const t = ensureTerrain(s);
  raiseTerrain(t, 300, 300, MAX_BRUSH, 15);
  const site = terrainField(s);
  const g = groundAt(site, 300, 300);
  assert.ok(g > FLOOR_H, 'the mound really is taller than a storey');
  assert.equal(storeyAt(s, g), 1, 'measured from datum it reads as level two');
  assert.equal(storeyAt(s, g, g), 0, 'measured from the ground under you it does not');
});

test('a walker crossing the sample school\'s site follows the ground', () => {
  const s = buildSampleSchool();
  const site = terrainField(s);
  const c = buildCollider(s, 0, catalogEntry, { site });
  // Start on the entry plaza just outside the west door and walk west, across
  // the bus loop and out over the graded ground beyond it. A lane a few feet
  // north of the door, because the flagpole stands right outside it — and
  // being stopped by a flagpole is the collider working, not failing.
  let pos = { x: 12, y: 0, z: 50 };
  let steps = 0, offGround = 0;
  for (let i = 0; i < 300; i++) {
    const r = moveWalker(s, c, pos, -0.4, 0, { grounded: true, site });
    if (r.blocked) break;
    pos = { x: r.x, y: r.support ? r.support.y : pos.y, z: r.z };
    steps++;
    // Whatever it is standing on, it is standing on the surface the model
    // says is there — never floating over it or sunk into it.
    const expect = r.support.kind === 'ground' ? groundAt(site, pos.x, pos.z) : r.support.y;
    if (Math.abs(pos.y - expect) > 1e-6) offGround++;
  }
  assert.ok(steps > 60, `it got somewhere (${steps} steps)`);
  assert.equal(offGround, 0, 'and never left the surface under it');
  assert.ok(pos.x < 0, `it made it off the plaza (x = ${pos.x.toFixed(1)})`);
});

test('the sample school\'s berm is walkable, not a cliff', () => {
  const s = buildSampleSchool();
  const site = terrainField(s);
  const c = buildCollider(s, 0, catalogEntry, { site });
  // The lot sits below datum and the field above it; walking between them
  // should never present a step bigger than a walker can take.
  let pos = { x: 150, y: groundAt(site, 150, 150), z: 150 };
  let worst = 0;
  for (let i = 0; i < 400; i++) {
    const r = moveWalker(s, c, pos, 0.5, 0, { grounded: true, site });
    if (r.blocked) break;
    worst = Math.max(worst, Math.abs((r.support ? r.support.y : pos.y) - pos.y));
    pos = { x: r.x, y: r.support ? r.support.y : pos.y, z: r.z };
  }
  assert.ok(worst <= STEP_UP + 1e-6, `the biggest step was ${worst.toFixed(2)}ft`);
  assert.ok(pos.x > 200, `and it crossed onto the field (x = ${pos.x.toFixed(0)})`);
});

// ---------- what is over your head ----------
//
// Phase 17's one addition to the walker, and the smallest thing that could
// have been: `overheadAt` is `supportAt` looking the other way, and one
// comparison in `tryStep` against it. Both arcs skipped it and both were right
// to — a building of flat slabs has twelve feet of air over every point of it
// — but a stair hall has a run in it.

test('a room has a ceiling, the site has sky, and a step is tested against neither', () => {
  const s = createState(20, 20);
  boxRoom(s, 0, 2, 2, 8, 8, { name: 'Room' });
  // Inside, the plane the renderer draws at `WALL_H`...
  const inside = overheadAt(s, 5 * CELL, 5 * CELL, 0);
  assert.equal(inside.kind, 'ceiling');
  assert.equal(inside.y, WALL_H);
  // ...which is not what stops a body: a ceiling is a tile grid, and a run
  // climbs through it, so a *step* is tested against structure only. On one
  // storey there is none.
  assert.equal(overheadAt(s, 5 * CELL, 5 * CELL, 0, { structural: true }), null);
  assert.equal(headroomAt(s, 5 * CELL, 5 * CELL, 0, { structural: true }), Infinity);
  // Out on the site there is nothing overhead at all.
  assert.equal(overheadAt(s, 60 * CELL, 60 * CELL, 0), null);

  addFloor(s, 1);
  boxRoom(s, 1, 2, 2, 8, 8, { name: 'Upstairs' });
  // The slab has no thickness in this model — `cutStart` sizes a stair's hole
  // against the bare storey height, so giving one here would contradict it.
  const structural = overheadAt(s, 5 * CELL, 5 * CELL, 0, { structural: true });
  assert.equal(structural.kind, 'slab');
  assert.equal(structural.y, s.floorHt || FLOOR_H);
});

test('the underside of a stair run is somewhere you cannot stand', () => {
  const s = createState(30, 20);
  boxRoom(s, 0, 1, 1, 20, 10, { name: 'Hall' });
  addFloor(s, 1);
  boxRoom(s, 1, 1, 1, 20, 10, { name: 'Upper Hall' });
  const { link } = addStair(s, 0, { type: 'stair', x: 20, z: 20, rotationY: 0, width: 4 });
  assert.ok(link);
  const metrics = stairMetrics(s);
  const run = runLength(link, metrics);
  // Walk the ground under the run from its foot to its head and find where the
  // soffit comes down to head height. It has to happen somewhere: a run climbs
  // twelve feet, and a body is under six.
  let blocked = 0, standing = 0;
  for (let t = 1; t < run; t += 1) {
    const p = localToWorld(link, 0, t);
    const support = supportAt(s, p.x, p.z, 0);
    if (!support || support.y > STEP_UP) { standing++; continue; }
    const head = headroomAt(s, p.x, p.z, support.y, { structural: true });
    if (head < HEAD_H) blocked++;
  }
  assert.ok(blocked > 0, 'the low end of a run is not a doorway');
  // ...and the same points refuse a step into them.
  const under = localToWorld(link, 0, 3);
  const step = tryStep(s, emptyCollider(), { x: under.x - 3, y: 0, z: under.z },
    3, 0, { grounded: true });
  assert.equal(step, null, 'you do not walk into the underside of a stair');
  const allowed = tryStep(s, emptyCollider(), { x: under.x - 3, y: 0, z: under.z },
    3, 0, { grounded: true, headroom: false });
  assert.ok(allowed, '...unless the caller says heads do not matter');
});

test('a stair the model draws always clears the head of the walker on it', () => {
  // The invariant that keeps the head test from stopping everybody on the
  // fourth tread: `stairs.js` sizes the hole in the slab above so a run has
  // `HEADROOM` (6.8ft) of clearance, and a walker is `HEAD_H` (5.9ft) tall.
  // The first number being the larger one is not a coincidence, it is the
  // reason a compliant stair is walkable.
  assert.ok(HEADROOM > HEAD_H, `${HEADROOM} > ${HEAD_H}`);
  const s = buildSampleSchool();
  const metrics = stairMetrics(s);
  for (const link of stairsOf(s)) {
    if (!isRun(link)) continue;
    const run = runLength(link, metrics);
    for (let t = 0; t <= run; t += 0.5) {
      const p = localToWorld(link, 0, t);
      const surf = stairSurfaceAt(link, metrics, p.x, p.z);
      if (surf === null) continue;
      const y = link.from * (s.floorHt || 12) + surf;
      const head = headroomAt(s, p.x, p.z, y, { structural: true });
      assert.ok(head >= HEAD_H,
        `link ${link.id} at ${t.toFixed(1)}ft along has ${head.toFixed(2)}ft of headroom`);
    }
  }
});

test('a stairwell is a hole in the ceiling, not a lid on it', () => {
  // Getting this the other way round — asking the slab you stand on where its
  // holes are, rather than the slab above — puts a ceiling across the void a
  // run climbs through, and a fire drill stops half way up.
  const s = createState(30, 20);
  boxRoom(s, 0, 1, 1, 20, 10, { name: 'Hall' });
  addFloor(s, 1);
  boxRoom(s, 1, 1, 1, 20, 10, { name: 'Upper Hall' });
  const { link } = addStair(s, 0, { type: 'stair', x: 20, z: 20, rotationY: 0, width: 4 });
  const metrics = stairMetrics(s);
  const run = runLength(link, metrics);
  // Near the top of the run, where the slab above is open.
  const top = localToWorld(link, 0, run - 1);
  const surf = stairSurfaceAt(link, metrics, top.x, top.z);
  const over = overheadAt(s, top.x, top.z, link.from * (s.floorHt || 12) + surf);
  assert.ok(!over || over.y - surf >= HEAD_H, 'there is sky, or at least air, above the top of a run');
  assert.ok(SOFFIT_T > 0, 'and a run is drawn as treads on air, so its underside is an allowance');
});
