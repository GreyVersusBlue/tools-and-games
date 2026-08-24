// Tests for collide.js — the walkthrough's physics. Pure module, so the whole
// of it runs under `node --test` from Projects/school-generator: no browser, no
// three.js, no build step.
//
// The three things worth being sure of, because they're the ones you'd only
// notice by walking around: a wall stops you, a doorway doesn't, and the edge
// of a floor stops you without dropping you down a storey.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createState, setTile, addFloor, CELL, DOOR_W, WALL_T, FLOOR_H,
  edgeHIdx, edgeVIdx, EDGE_WALL, EDGE_DOOR, EDGE_GLASS, EDGE_RAIL,
} from '../js/grid.js';
import { addShape, setSegWall, addOpening, SEG_WALL, SEG_NONE, SEG_GLASS } from '../js/shapes.js';
import { addProp } from '../js/props.js';
import { addStair, stairMetrics } from '../js/stairs.js';
import { catalogEntry } from '../js/catalog.js';
import { buildSampleSchool } from '../js/sample.js';
import {
  WALKER_R, WALL_PAD, STEP_UP, STEP_DOWN, MIN_OBSTACLE_H, GROUND_Y,
  solidSpans, segsCross, wallSegments, propObstacles, buildCollider,
  resolvePoint, crossesWall, storeyAt, supportAt, tryStep, moveWalker,
  openingRailSegments,
} from '../js/collide.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// A room of floor cells with a wall all the way round it, on the ground floor.
function walledRoom(x0 = 2, y0 = 2, x1 = 6, y1 = 5) {
  const s = createState(20, 20);
  const f = s.floors[0];
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) setTile(f, x, y, true);
  for (let x = x0; x <= x1; x++) {
    f.edgesH[edgeHIdx(f, x, y0)] = EDGE_WALL;
    f.edgesH[edgeHIdx(f, x, y1 + 1)] = EDGE_WALL;
  }
  for (let y = y0; y <= y1; y++) {
    f.edgesV[edgeVIdx(f, x0, y)] = EDGE_WALL;
    f.edgesV[edgeVIdx(f, x1 + 1, y)] = EDGE_WALL;
  }
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

test('every built boundary kind blocks, and an empty edge does not', () => {
  const s = createState(6, 6);
  const f = s.floors[0];
  f.edgesH[edgeHIdx(f, 1, 1)] = EDGE_WALL;
  f.edgesH[edgeHIdx(f, 2, 1)] = EDGE_GLASS;
  f.edgesV[edgeVIdx(f, 1, 2)] = EDGE_RAIL;
  const segs = wallSegments(f);
  assert.equal(segs.length, 3, 'glass and railing stop a body just as drywall does');
  f.edgesH[edgeHIdx(f, 1, 1)] = 0;
  assert.equal(wallSegments(f).length, 2);
});

test('a grid door leaves a gap a walker actually fits through', () => {
  const s = createState(6, 6);
  const f = s.floors[0];
  f.edgesH[edgeHIdx(f, 0, 1)] = EDGE_DOOR;
  const segs = wallSegments(f);
  assert.equal(segs.length, 2, 'two jambs, one opening');
  const inner = [Math.max(segs[0].ax, segs[0].bx), Math.min(segs[1].ax, segs[1].bx)].sort((a, b) => a - b);
  const gap = inner[1] - inner[0];
  assert.ok(near(gap, DOOR_W + 2 * WALL_PAD),
    'the gap opens up by the trim so inflating the jambs gives back a true door width');
  const clear = gap - 2 * (WALKER_R + WALL_PAD);
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
  for (let y = 2; y <= 5; y++) for (let x = 2; x <= 6; x++) setTile(s.floors[1], x, y, true);
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
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) setTile(s.floors[1], x, y, true);
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
  const s = walledRoom(2, 2, 6, 5);
  const f = s.floors[0];
  f.edgesH[edgeHIdx(f, 4, 2)] = EDGE_DOOR;   // door in the north wall, cell x=4
  const c = collide(s);
  const doorX = (4 + 0.5) * CELL;
  let pos = feetAt(doorX, 10);
  for (let i = 0; i < 30; i++) {
    const r = moveWalker(s, c, pos, 0, -0.4);
    pos = { x: r.x, y: 0, z: r.z };
  }
  assert.ok(pos.z < 7, `walked out through the door (ended at z=${pos.z.toFixed(2)})`);

  let beside = feetAt(doorX + CELL, 10);
  for (let i = 0; i < 30; i++) {
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
  for (let y = 2; y <= 5; y++) for (let x = 2; x <= 6; x++) setTile(s.floors[1], x, y, true);
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
  for (let y = 2; y <= 5; y++) for (let x = 2; x <= 6; x++) setTile(s.floors[1], x, y, true);
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
  const s = walledRoom(2, 2, 6, 5);
  const f = s.floors[0];
  f.edgesH[edgeHIdx(f, 4, 2)] = EDGE_DOOR;
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
  for (const f of s.floors)
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) setTile(f, x, y, true);
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
  for (const f of s.floors)
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) setTile(f, x, y, true);
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
