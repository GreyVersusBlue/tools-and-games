// Polygon room tests: the geometry, the editing bookkeeping that keeps walls
// and doorways attached to the right segments, and the grid -> polygon
// migration path. Run `node --test` from Projects/school-generator.

import test from 'node:test';
import assert from 'node:assert/strict';

import { CELL, DOOR_W, createState, duplicateFloor, addFloor } from '../js/grid.js';
import { EDGE_GLASS, EDGE_RAIL, EDGE_DOOR } from '../js/lattice.js';
import { sheet } from './build.mjs';
import {
  SEG_NONE, SEG_WALL, SEG_GLASS, SEG_RAIL, isBuilt, canOpen, MAX_SHAPES,
  addShape, addHole, removeShape, makeShape, cleanRing,
  ringSignedArea, ringIsCCW, pointInShape, shapeArea, shapeBBox, interiorPoint,
  shapeAt, shapeById, nearestSegment, nearestVertex, segEnds, segLength,
  insertVertex, deleteVertex, moveVertex, setSegWall, addOpening, toggleOpening, orientRing,
  snapPoint, constrainAngle, enclosingShape,
  arcGeometry, arcPoints, curveSegment, straightenRun, MAX_BULGE, MIN_ARC_CHORD,
  ringLen, LEAF_SINGLE, segDir, unitDir, parallelDirs, PARALLEL_TOL,
  normalizeShape, cloneShape,
  nextRoomName, storeyBase,
  translateShape, rotateShape90, mirrorShapeX, rotatePoint90, mirrorPointX,
  addShapeCopy, totalShapeArea,
} from '../js/shapes.js';
import { serialize, deserialize } from '../js/save-load.js';

const RECT = [{ x: 0, z: 0 }, { x: 20, z: 0 }, { x: 20, z: 12 }, { x: 0, z: 12 }];
const rect = (x0, z0, x1, z1) =>
  [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];

// ---------- rings and areas ----------

test('a ring is cleaned, closed implicitly and wound outward', () => {
  // Trailing duplicate of the first point, plus a near-duplicate mid-ring.
  const pts = [...RECT, { x: 0.05, z: 12 }, { x: 0, z: 0 }];
  const shape = makeShape(pts);
  assert.equal(shape.rings[0].pts.length, 4, 'duplicate and closing points dropped');
  assert.ok(ringIsCCW(shape.rings[0].pts), 'outer ring is wound CCW');
  assert.equal(shapeArea(shape), 240);
  assert.deepEqual(shape.rings[0].walls, [1, 1, 1, 1], 'a new room is walled all round');
});

test('degenerate outlines are refused rather than stored', () => {
  assert.equal(cleanRing([{ x: 0, z: 0 }, { x: 1, z: 0 }]), null, 'two points is not a room');
  assert.equal(cleanRing([{ x: 0, z: 0 }, { x: 0.1, z: 0 }, { x: 0.1, z: 0.1 }]), null,
    'a room smaller than a floor tile is a mis-click');
  assert.equal(makeShape([{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 10, z: 0 }]), null,
    'collinear points enclose nothing');
});

test('reversing a ring carries wall states and doorways with it', () => {
  // Walls and doorways are indexed by segment, so re-winding a ring has to
  // renumber them or a room's south wall ends up on its north side.
  const shape = makeShape(RECT);
  const ring = shape.rings[0];
  // Segment 1 runs (20,0) -> (20,12): the east wall.
  const [a0, b0] = segEnds(ring, 1);
  ring.walls = [SEG_WALL, SEG_NONE, SEG_WALL, SEG_WALL];
  addOpening(shape, 0, 0, 0.25);

  orientRing(ring, false);   // flip it the wrong way round
  assert.equal(ringIsCCW(ring.pts), false);
  const east = ring.pts.findIndex((p, i) => {
    const q = ring.pts[(i + 1) % ring.pts.length];
    return p.x === b0.x && p.z === b0.z && q.x === a0.x && q.z === a0.z;
  });
  assert.ok(east >= 0, 'the east wall is still a segment, walked the other way');
  assert.equal(ring.walls[east], SEG_NONE, 'and it is still the open one');
  const o = ring.openings[0];
  assert.ok(Math.abs(o.t - 0.75) < 1e-9, 'the doorway is mirrored along its wall');

  orientRing(ring, true);    // ...and back
  assert.deepEqual(ring.walls, [SEG_WALL, SEG_NONE, SEG_WALL, SEG_WALL]);
  assert.ok(Math.abs(ring.openings[0].t - 0.25) < 1e-9);
});

test('holes subtract from the area and from what counts as inside', () => {
  const s = createState();
  const shape = addShape(s, 0, rect(0, 0, 40, 40), { name: 'Commons' });
  addHole(shape, rect(10, 10, 20, 20));
  assert.equal(shapeArea(shape), 1600 - 100);
  assert.ok(pointInShape(shape, 5, 5));
  assert.equal(pointInShape(shape, 15, 15), false, 'the hole is not floor');
  assert.equal(ringIsCCW(shape.rings[1].pts), false, 'holes wind opposite the outer ring');
});

test('the label point stays inside an L-shaped room', () => {
  // An L whose centroid falls in the notch, outside the room.
  const L = [
    { x: 0, z: 0 }, { x: 40, z: 0 }, { x: 40, z: 10 },
    { x: 10, z: 10 }, { x: 10, z: 40 }, { x: 0, z: 40 },
  ];
  const shape = makeShape(L);
  const p = interiorPoint(shape);
  assert.ok(pointInShape(shape, p.x, p.z), 'label anchor is inside the room');
  const bb = shapeBBox(shape);
  assert.deepEqual([bb.x0, bb.z0, bb.x1, bb.z1], [0, 0, 40, 40]);
});

// ---------- picking ----------

test('nearest segment and vertex find what the cursor is over', () => {
  const s = createState();
  const shape = addShape(s, 0, RECT, {});
  const floor = s.floors[0];

  const seg = nearestSegment(floor, 10, 0.4);
  assert.equal(seg.shape.id, shape.id);
  assert.equal(seg.ring, 0);
  assert.ok(Math.abs(seg.t - 0.5) < 1e-9, 'halfway along the north wall');
  assert.ok(Math.abs(seg.dist - 0.4) < 1e-9);

  assert.equal(nearestSegment(floor, 10, 40, 2), null, 'nothing within reach');
  const v = nearestVertex(floor, 19.5, 0.5);
  assert.deepEqual([v.x, v.z], [20, 0]);
  assert.equal(shapeAt(floor, 10, 6).id, shape.id);
  assert.equal(shapeAt(floor, 100, 100), null);
  assert.equal(shapeById(floor, shape.id).id, shape.id);
});

// ---------- staying on one line ----------
//
// Phase 13: the wall tool drags along a run, and used to grab whichever
// segment was nearest — so drifting a foot sideways near a corner built the
// wall at right angles to the one you were drawing.

test('a direction is a line, not an arrow: opposite runs are parallel', () => {
  const ring = makeShape(RECT).rings[0];
  const north = segDir(ring, 0);
  const south = segDir(ring, 2);
  assert.ok(parallelDirs(north, south), 'a ring is wound; its two long walls run opposite ways');
  assert.equal(parallelDirs(north, segDir(ring, 1)), false, 'the corner is not');
  // Free-hand slop is inside the tolerance; a real turn is not.
  const off = (deg) => ({ x: Math.cos((deg * Math.PI) / 180), z: Math.sin((deg * Math.PI) / 180) });
  assert.ok(parallelDirs(off(0), off(30)), 'a chord of a curve is the same wall');
  assert.equal(parallelDirs(off(0), off(45)), false, 'a chamfer is a corner');
  assert.equal(parallelDirs(off(0), off(90)), false);
  assert.ok(parallelDirs(off(0), off(180 - 30)), 'and the same, measured the other way round');
  assert.equal(unitDir({ x: 3, z: 3 }, { x: 3, z: 3 }), null, 'a degenerate run has no direction');
  assert.ok(parallelDirs(off(0), null), 'no direction to compare is not a refusal');
});

test('nearestSegment kept to one line finds the parallel wall, not the corner', () => {
  const s = createState();
  addShape(s, 0, RECT, {});
  const floor = s.floors[0];
  const along = segDir(makeShape(RECT).rings[0], 0);   // the north wall, +x

  // A foot past the corner and a foot outside: the east wall is nearer, and
  // it is the one the tool used to build.
  const free = nearestSegment(floor, 20.4, 1, 1.6);
  assert.equal(free.seg, 1, 'unfiltered, the corner wins');

  const kept = nearestSegment(floor, 20.4, 1, 1.6, { parallelTo: along });
  assert.equal(kept.seg, 0, 'the north wall is still well within reach');
  assert.ok(parallelDirs(kept.dir, along));

  // Drift far enough that no parallel run is in reach and the answer is
  // nothing at all, rather than something at right angles.
  assert.equal(nearestSegment(floor, 21, 6, 1.6, { parallelTo: along }), null);
  assert.ok(nearestSegment(floor, 21, 6, 1.6), 'which is not the same as nothing being there');
});

test('a curved wall tessellates finely enough for a drag to follow it round', () => {
  // The editor's wall drag moves from run to run along the same line, rolling
  // its direction as it goes (see editor.js). A curve is a row of chords, so
  // the two facts have to agree: every step of the most strongly curved wall
  // this tool can draw has to fall inside `PARALLEL_TOL`, or dragging along an
  // arc would stop partway round it.
  const shape = makeShape(rect(0, 0, 40, 24));
  curveSegment(shape, 0, 0, MAX_BULGE);
  const ring = shape.rings[0];
  let worst = 0;
  for (let i = 0; i + 1 < ring.pts.length; i++) {
    const a = segDir(ring, i), b = segDir(ring, i + 1);
    if (!a || !b) continue;
    const turn = Math.atan2(Math.abs(a.x * b.z - a.z * b.x), Math.abs(a.x * b.x + a.z * b.z));
    // The one step that *should* fail is the corner where the arc rejoins the
    // straight walls; every step within the arc has to pass.
    if (turn < Math.PI / 4) worst = Math.max(worst, turn);
  }
  assert.ok(worst > 0, 'the arc really did become several chords');
  assert.ok(worst <= PARALLEL_TOL, `worst step ${(worst * 180 / Math.PI).toFixed(1)}°`);
  // ...and the tolerance that allows it still refuses the corner it is there
  // to refuse, which is the other half of what pins the number.
  assert.ok(PARALLEL_TOL < Math.PI / 4, 'a 45° chamfer must never read as the same wall');
});

test('the topmost room answers a click when two overlap', () => {
  const s = createState();
  addShape(s, 0, rect(0, 0, 40, 40), { name: 'Hall' });
  const inner = addShape(s, 0, rect(10, 10, 20, 20), { name: 'Breakout' });
  assert.equal(shapeAt(s.floors[0], 15, 15).name, 'Breakout');
  assert.equal(shapeAt(s.floors[0], 5, 5).name, 'Hall');
  assert.equal(enclosingShape(s.floors[0], rect(12, 12, 18, 18)).id, inner.id,
    'a hole is cut from the smallest room that contains it');
});

// ---------- vertex editing ----------

test('inserting a vertex splits a wall and keeps its doorway in place', () => {
  const shape = makeShape(RECT);
  // North wall runs 0,0 -> 20,0. Put a door three-quarters along it.
  addOpening(shape, 0, 0, 0.75);
  const at = insertVertex(shape, 0, 0, 10, 0);
  assert.equal(at, 1);
  assert.equal(shape.rings[0].pts.length, 5);
  assert.deepEqual(shape.rings[0].walls, [1, 1, 1, 1, 1]);
  const o = shape.rings[0].openings[0];
  assert.equal(o.seg, 1, 'the door moved to the half it fell in');
  assert.ok(Math.abs(o.t - 0.5) < 1e-9, 'and to the same place on the ground');
  assert.equal(insertVertex(shape, 0, 0, 0, 0), -1, 'refuses to split at an endpoint');
});

test('deleting a vertex merges the two walls that met there', () => {
  const shape = makeShape([...RECT, { x: -6, z: 6 }]);
  const n = shape.rings[0].pts.length;
  assert.equal(deleteVertex(shape, 0, 4), true);
  assert.equal(shape.rings[0].pts.length, n - 1);
  assert.equal(shape.rings[0].walls.length, n - 1, 'wall array stays aligned with the ring');
  while (shape.rings[0].pts.length > 3) deleteVertex(shape, 0, 0);
  assert.equal(deleteVertex(shape, 0, 0), false, 'a ring will not go below a triangle');
});

test('deleting the first vertex keeps the remaining walls aligned', () => {
  const shape = makeShape(RECT);
  const ring = shape.rings[0];
  ring.walls = [SEG_NONE, SEG_WALL, SEG_WALL, SEG_WALL];
  addOpening(shape, 0, 2, 0.5);
  assert.equal(deleteVertex(shape, 0, 0), true);
  assert.equal(ring.pts.length, 3);
  assert.equal(ring.walls.length, 3);
  assert.equal(ring.openings.length, 1);
  assert.equal(ring.openings[0].seg, 1, 'the doorway followed its wall down one index');
});

test('moving a vertex moves only that corner', () => {
  const shape = makeShape(RECT);
  moveVertex(shape, 0, 2, 26, 18);
  assert.deepEqual(shape.rings[0].pts[2], { x: 26, z: 18 });
  assert.deepEqual(shape.rings[0].pts[1], { x: 20, z: 0 });
});

// ---------- walls and doorways ----------

test('a doorway is a position along a wall, and cannot hang off the end', () => {
  const shape = makeShape(RECT);
  const o = addOpening(shape, 0, 0, 0.0);
  assert.ok(o.t > 0, 'clamped inside the wall');
  assert.ok(o.t * 20 >= DOOR_W / 2, 'with room for the door itself');
  assert.equal(o.w, DOOR_W);
  assert.equal(addOpening(shape, 0, 0, o.t + 0.01), null, 'no two doors in the same place');

  // 12ft wall (segment 1) takes a second door fine.
  assert.ok(addOpening(shape, 0, 1, 0.5));
  const tiny = makeShape([{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 30 }, { x: 0, z: 30 }]);
  assert.equal(addOpening(tiny, 0, 0, 0.5), null, 'a 2ft wall cannot hold a 3ft door');
});

test('erasing a wall takes its doorways with it', () => {
  const shape = makeShape(RECT);
  addOpening(shape, 0, 0, 0.5);
  assert.equal(shape.rings[0].openings.length, 1);
  assert.equal(setSegWall(shape, 0, 0, SEG_NONE), true);
  assert.deepEqual(shape.rings[0].openings, [], 'nothing left to be an opening in');
  assert.equal(setSegWall(shape, 0, 0, SEG_NONE), false, 'already open');
  assert.equal(addOpening(shape, 0, 0, 0.5), null, 'and no door without a wall');
});

test('the door tool toggles the doorway you clicked', () => {
  const shape = makeShape(RECT);
  const made = toggleOpening(shape, 0, 0, 0.5);
  assert.ok(made);
  assert.equal(toggleOpening(shape, 0, 0, 0.52), null, 'clicking it again removes it');
  assert.deepEqual(shape.rings[0].openings, []);
  // On a wall that was erased, the first click puts the wall back with a door.
  setSegWall(shape, 0, 1, SEG_NONE);
  assert.ok(toggleOpening(shape, 0, 1, 0.5));
  assert.equal(shape.rings[0].walls[1], SEG_WALL);
});

// ---------- wall kinds ----------

test('a segment can be solid, glazed or a railing — or nothing at all', () => {
  const shape = makeShape(RECT);
  for (const kind of [SEG_GLASS, SEG_RAIL, SEG_WALL]) {
    assert.equal(setSegWall(shape, 0, 0, kind), true);
    assert.equal(shape.rings[0].walls[0], kind);
  }
  assert.equal(setSegWall(shape, 0, 0, 99), true, 'an unknown kind clears the segment');
  assert.equal(shape.rings[0].walls[0], SEG_NONE);
  assert.deepEqual(
    [SEG_NONE, SEG_WALL, SEG_GLASS, SEG_RAIL].map(isBuilt),
    [false, true, true, true]
  );
});

test('changing a wall to glass keeps its doorways; erasing it does not', () => {
  const shape = makeShape(RECT);
  addOpening(shape, 0, 0, 0.5);
  setSegWall(shape, 0, 0, SEG_GLASS);
  assert.equal(shape.rings[0].openings.length, 1, 'a door in a glazed partition is still a door');
  setSegWall(shape, 0, 0, SEG_NONE);
  assert.deepEqual(shape.rings[0].openings, []);
});

test('a gap can be cut in a railing — that is where a stair arrives', () => {
  const shape = makeShape(RECT);
  setSegWall(shape, 0, 0, SEG_RAIL);
  assert.ok(canOpen(SEG_RAIL));
  assert.ok(addOpening(shape, 0, 0, 0.5), 'a railing takes an opening');
  setSegWall(shape, 0, 1, SEG_NONE);
  assert.equal(addOpening(shape, 0, 1, 0.5), null, 'an empty segment does not');
});

test('a loaded file keeps the kind of each wall, and guesses safely at the rest', () => {
  const shape = normalizeShape({
    rings: [{ pts: RECT, walls: [SEG_GLASS, SEG_RAIL, 42, SEG_NONE] }],
  });
  assert.deepEqual(
    shape.rings[0].walls,
    [SEG_GLASS, SEG_RAIL, SEG_WALL, SEG_NONE],
    'a kind from a newer build falls back to a plain wall rather than to a gap'
  );
});

test('wall kinds survive a save round-trip, drawn or painted', () => {
  const s = createState(10, 10);
  const drawn = addShape(s, 0, RECT, {});
  setSegWall(drawn, 0, 0, SEG_GLASS);
  setSegWall(drawn, 0, 2, SEG_RAIL);
  const f = sheet(s, 0);
  f.box(6, 6, 8, 8).hrun(6, 8, 6, EDGE_GLASS).vrun(6, 6, 8, EDGE_RAIL);
  f.bake();
  const painted = s.floors[0].shapes[1];
  assert.ok(painted.rings[0].walls.includes(SEG_GLASS));
  assert.ok(painted.rings[0].walls.includes(SEG_RAIL));
  const back = deserialize(serialize(s));
  assert.deepEqual(back.floors[0].shapes[0].rings[0].walls, drawn.rings[0].walls);
  assert.deepEqual(back.floors[0].shapes[1].rings[0].walls, painted.rings[0].walls);
});

// ---------- snapping ----------

test('snapping prefers a vertex, then the lattice, then a wall', () => {
  const s = createState();
  const shape = addShape(s, 0, rect(0, 0, 20, 12), {});
  const floor = s.floors[0];

  const v = snapPoint(floor, 19.4, 0.4, 1.5);
  assert.deepEqual([v.x, v.z, v.kind], [20, 0, 'vertex']);

  const corner = snapPoint(floor, CELL * 3 + 0.3, CELL * 5 - 0.3, 1.5);
  assert.deepEqual([corner.x, corner.z, corner.kind], [12, 20, 'corner']);

  // Beside a wall but away from both a vertex and a lattice corner.
  const onWall = snapPoint(floor, 10.4, 12.4, 1.5, { grid: false });
  assert.equal(onWall.kind, 'edge');
  assert.ok(Math.abs(onWall.z - 12) < 1e-9);

  const free = snapPoint(floor, 33.7, 26.9, 0.05);
  assert.equal(free.kind, 'free');
  assert.deepEqual([free.x, free.z], [33.7, 26.9]);

  // The corner being dragged must not snap to itself.
  const skipped = snapPoint(floor, 20.1, 0.1, 1.5, { skip: { shape: shape.id, ring: 0, idx: 1 } });
  assert.notEqual(skipped.kind, 'vertex');
});

test('the angle constraint holds the run to 15 degree steps', () => {
  const a = { x: 0, z: 0 };
  const p = constrainAngle(a, { x: 10, z: 0.4 }, 15);
  assert.ok(Math.abs(p.z) < 1e-9, 'nearly-horizontal becomes horizontal');
  assert.ok(Math.abs(p.x - Math.hypot(10, 0.4)) < 1e-9, 'and keeps its length');
  const d = constrainAngle(a, { x: 10, z: 9.2 }, 15);
  assert.ok(Math.abs(d.x - d.z) < 1e-9, 'nearly-diagonal becomes 45°');
});

// ---------- what the 4ft brush bakes ----------
//
// The tracer itself has its own suite (test/lattice.test.mjs). What is checked
// here is the seam: that a room painted with the brush comes out of it as an
// ordinary room, indistinguishable to everything in this file from one drawn
// by hand.

test('a painted room is an ordinary room with an id, a name and an outline', () => {
  // Two rooms side by side sharing one partition, inside an outer shell.
  const s = createState(20, 20);
  const f = sheet(s, 0);
  f.box(2, 2, 9, 5);
  f.vrun(6, 2, 5).edgeV(6, 3, EDGE_DOOR);      // the partition, with a door
  f.edgeH(3, 2, EDGE_DOOR);                    // and one to the outside
  f.label(2, 2, 5, 5, { name: 'Room 101', color: '#f5d491' });
  f.label(6, 2, 9, 5, { name: 'Room 102' });
  f.bake();

  const [west, east] = s.floors[0].shapes;
  assert.equal(west.name, 'Room 101');
  assert.equal(west.color, '#f5d491');
  assert.ok(west.id > 0 && east.id > 0 && west.id !== east.id);
  assert.equal(shapeArea(west), 16 * CELL * CELL);
  assert.equal(shapeAt(s.floors[0], 3.5 * CELL, 3.5 * CELL).id, west.id);

  // The partition is built by exactly one of them; the other leaves that side
  // open rather than drawing a second wall in the same place.
  assert.ok(west.rings[0].walls.some((w) => w !== SEG_NONE));
  assert.ok(east.rings[0].walls.includes(SEG_NONE),
    'the room that did not build the partition leaves it open');
  // Both doorways survive the trace, wherever they ended up living.
  const doors = s.floors[0].shapes
    .flatMap((sh) => sh.rings.flatMap((r) => r.openings)).length;
  assert.equal(doors, 2);
});

test('a painted room with a courtyard in it bakes to a ring and a hole', () => {
  const s = createState(20, 20);
  const f = sheet(s, 0);
  f.fill(0, 0, 6, 6).tile(3, 3, false);          // a courtyard in the middle
  f.bake();
  const shape = s.floors[0].shapes[0];
  assert.equal(shape.rings.length, 2, 'outer boundary plus the courtyard');
  assert.ok(Math.abs(ringSignedArea(shape.rings[0].pts)) >
    Math.abs(ringSignedArea(shape.rings[1].pts)), 'the outer ring comes first');
  assert.equal(shape.rings[1].pts.length, 4, 'the courtyard is a square');
  assert.equal(shapeArea(shape), 48 * CELL * CELL);
});

// ---------- state, floors and persistence ----------

test('shapes live on their storey and are capped per floor', () => {
  const s = createState();
  addFloor(s);                                  // current = 1
  const upper = addShape(s, 1, RECT, { name: 'Mezz' });
  assert.equal(s.floors[0].shapes.length, 0);
  assert.equal(s.floors[1].shapes[0].id, upper.id);
  assert.equal(removeShape(s.floors[1], upper.id), true);
  assert.equal(removeShape(s.floors[1], upper.id), false, 'removing twice is a no-op');

  for (let i = 0; i < MAX_SHAPES; i++) assert.ok(addShape(s, 0, rect(0, 0, 8, 8), {}));
  assert.equal(addShape(s, 0, rect(0, 0, 8, 8), {}), null, 'refuses past the cap');
});

test('duplicating a floor copies its polygon rooms without sharing them', () => {
  const s = createState();
  const ground = addShape(s, 0, RECT, { name: 'Commons' });
  addHole(ground, rect(4, 4, 8, 8));
  assert.equal(duplicateFloor(s, 0), 1);

  const copy = s.floors[1].shapes[0];
  assert.notEqual(copy.id, ground.id, 'a copied room is its own room');
  assert.equal(copy.name, 'Commons');
  assert.equal(copy.rings.length, 2, 'holes come along');
  moveVertex(copy, 0, 0, 99, 99);
  assert.deepEqual(ground.rings[0].pts[0], { x: 0, z: 0 }, 'edits do not leak between storeys');
});

// ---------- whole-room transforms (Phase 6 section tool) ----------

test('translating a room moves every ring by the same offset', () => {
  const shape = makeShape(RECT);
  addHole(shape, rect(4, 4, 8, 8));
  const before = cloneShape(shape);
  translateShape(shape, 5, -3);
  shape.rings.forEach((ring, ri) => {
    ring.pts.forEach((p, i) => {
      assert.equal(p.x, before.rings[ri].pts[i].x + 5);
      assert.equal(p.z, before.rings[ri].pts[i].z - 3);
    });
  });
  assert.deepEqual(shape.rings[0].walls, before.rings[0].walls, 'walls travel with the room');
});

test('rotating a room 90 degrees keeps its winding and its area', () => {
  const shape = makeShape(RECT); // 20x12, area 240
  addOpening(shape, 0, 1, 0.5);  // a door on the east wall
  const eastLen = 12;
  rotateShape90(shape, 10, 6, true); // around its own centre
  assert.equal(shapeArea(shape), 240, 'a quarter turn does not change area');
  assert.ok(ringIsCCW(shape.rings[0].pts), 'still wound outward');
  // The door followed its wall: still one opening, same width, same segment
  // fraction along whichever wall it landed on.
  assert.equal(shape.rings[0].openings.length, 1);
  const o = shape.rings[0].openings[0];
  const [a, b] = segEnds(shape.rings[0], o.seg);
  assert.equal(Math.round(segLength(a, b)), eastLen);
  assert.ok(Math.abs(o.t - 0.5) < 1e-9);
});

test('rotatePoint90 turns a quarter circle either way around a pivot', () => {
  assert.deepEqual(rotatePoint90({ x: 10, z: 0 }, 0, 0, true), { x: 0, z: 10 });
  assert.deepEqual(rotatePoint90({ x: 10, z: 0 }, 0, 0, false), { x: 0, z: -10 });
  // four quarter turns come home
  let p = { x: 3, z: -7 };
  for (let i = 0; i < 4; i++) p = rotatePoint90(p, 1, 1, true);
  assert.ok(Math.abs(p.x - 3) < 1e-9 && Math.abs(p.z + 7) < 1e-9);
});

test('mirroring a room flips its winding and keeps it a valid outline', () => {
  const shape = makeShape(RECT);
  addOpening(shape, 0, 0, 0.25); // north wall, nearer the west end
  mirrorShapeX(shape, 10); // reflect across the room's own vertical centreline
  assert.equal(shapeArea(shape), 240, 'reflection does not change area');
  assert.ok(ringIsCCW(shape.rings[0].pts), 're-oriented outward after the flip');
  assert.equal(shape.rings[0].openings.length, 1, 'the doorway survives the flip');
  assert.deepEqual(mirrorPointX({ x: 4, z: 9 }, 10), { x: 16, z: 9 });
});

test('addShapeCopy makes an independent, offset room with a fresh id', () => {
  const s = createState();
  const shape = addShape(s, 0, RECT, { name: 'Room A', color: '#fff' });
  const copy = addShapeCopy(s, 0, shape, 3, 3);
  assert.notEqual(copy.id, shape.id);
  assert.equal(copy.name, 'Room A');
  assert.equal(copy.rings[0].pts[0].x, shape.rings[0].pts[0].x + 3);
  moveVertex(copy, 0, 0, 999, 999);
  assert.notEqual(shape.rings[0].pts[0].x, 999, 'copy does not alias the original');

  for (let i = 0; i < MAX_SHAPES - 1; i++) addShape(s, 0, rect(0, 0, 1, 1), {});
  assert.equal(addShapeCopy(s, 0, shape, 1, 1), null, 'refuses past the per-floor cap');
});

test('totalShapeArea sums every room on a storey', () => {
  const s = createState();
  assert.equal(totalShapeArea(s.floors[0]), 0);
  addShape(s, 0, rect(0, 0, 10, 10), {});   // 100 ft²
  addShape(s, 0, rect(20, 20, 30, 24), {}); // 40 ft²
  assert.equal(totalShapeArea(s.floors[0]), 140);
});

test('polygon rooms survive a save round trip, ids and all', () => {
  const s = createState();
  const shape = addShape(s, 0, RECT, { name: 'Commons', color: '#b8dfa2' });
  addHole(shape, rect(4, 4, 8, 8));
  addOpening(shape, 0, 0, 0.5);
  setSegWall(shape, 0, 2, SEG_NONE);

  const back = deserialize(serialize(s));
  assert.deepEqual(back.floors[0].shapes, s.floors[0].shapes);
  assert.equal(back.nextId, s.nextId, 'the id counter comes back too');
  const next = addShape(back, 0, rect(40, 40, 60, 60), {});
  assert.notEqual(next.id, shape.id, 'new rooms cannot collide with loaded ones');
});

test('a corrupt or hostile shape is repaired or dropped, never trusted', () => {
  assert.equal(normalizeShape(null), null);
  assert.equal(normalizeShape({ rings: [] }), null, 'no outer ring');
  assert.equal(normalizeShape({ rings: [{ pts: [{ x: 0, z: 0 }] }] }), null, 'not a polygon');

  const shape = normalizeShape({
    id: 5,
    name: 'x'.repeat(200),
    color: 'javascript:alert(1)',
    rings: [
      { pts: RECT, walls: [1, 'yes', 9, 1], openings: [
        { seg: 0, t: 5, w: 900 },        // clamped
        { seg: 99, t: 0.5 },             // off the end of the ring
        'nope',
      ] },
      { pts: rect(4, 4, 8, 8) },         // a real hole
      { pts: rect(500, 500, 600, 600) }, // "hole" outside the room
    ],
  });
  assert.equal(shape.name.length, 60, 'names truncated');
  assert.equal(shape.color, null, 'only hex colours survive');
  assert.deepEqual(shape.rings[0].walls, [1, 1, 1, 1], 'wall values coerced to the enum');
  assert.equal(shape.rings[0].openings.length, 1, 'openings that point nowhere are dropped');
  assert.ok(shape.rings[0].openings[0].t <= 1 && shape.rings[0].openings[0].w <= 16);
  assert.equal(shape.rings.length, 2, 'a hole outside the room is not a hole');
});

test('a save file cannot smuggle in more rooms than a floor holds', () => {
  const many = new Array(MAX_SHAPES + 40).fill(null).map(() => ({ rings: [{ pts: RECT }] }));
  const s = deserialize(JSON.stringify({
    version: 3, w: 20, h: 20,
    floors: [{ cells: [], edgesH: [], edgesV: [], shapes: many }],
  }));
  assert.equal(s.floors[0].shapes.length, MAX_SHAPES);
  assert.ok(s.floors[0].shapes.every((sh) => sh.id > 0), 'everything that loads gets an id');
});


// ---------- curved walls ----------
//
// The wishlist's "arcs tessellate at the model boundary" made concrete: a
// curved wall *is* a run of straight segments, so most of what matters here is
// that the ring is still a well-formed ring afterward — walls and openings
// aligned with points, winding intact, and reversible.

const near2 = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const square = () => makeShape([
  { x: 0, z: 0 }, { x: 20, z: 0 }, { x: 20, z: 20 }, { x: 0, z: 20 },
]);

test('an arc bulges toward the left of its chord, by the fraction asked for', () => {
  const a = { x: 0, z: 0 }, b = { x: 10, z: 0 };
  const g = arcGeometry(a, b, 0.25);
  assert.ok(near2(g.apex.x, 5));
  assert.ok(near2(g.apex.z, 2.5), 'a quarter of the chord, to the left of +x, which is +z');
  assert.ok(near2(arcGeometry(a, b, -0.25).apex.z, -2.5), 'and the other way for a negative one');
  assert.equal(arcGeometry(a, b, 0), null, 'a straight line is not an arc');
});

test('a tessellated arc starts and ends exactly on its own endpoints', () => {
  const a = { x: 3, z: 7 }, b = { x: 19, z: -4 };
  for (const bulge of [0.1, 0.5, 0.9, -0.35]) {
    const pts = arcPoints(a, b, bulge, 6);
    assert.equal(pts.length, 7);
    assert.deepEqual(pts[0], { x: 3, z: 7 }, 'the corner has to still meet its neighbour');
    assert.deepEqual(pts[6], { x: 19, z: -4 });
    // Every point is the same distance from the arc's centre — which is the
    // whole claim that this is a circle and not a wobble.
    const g = arcGeometry(a, b, bulge);
    for (const p of pts) {
      assert.ok(near2(Math.hypot(p.x - g.cx, p.z - g.cz), g.R, 1e-6), `r at ${p.x},${p.z}`);
    }
  }
});

test('a half-circle is bulge 0.5, and more than half still works', () => {
  const a = { x: 0, z: 0 }, b = { x: 10, z: 0 };
  const half = arcPoints(a, b, 0.5, 8);
  assert.ok(near2(arcGeometry(a, b, 0.5).R, 5), 'a semicircle on a 10ft chord has a 5ft radius');
  assert.ok(half.every((p) => p.z >= -1e-9), 'and never crosses back over the chord');
  const major = arcPoints(a, b, 0.9, 8);
  assert.ok(Math.min(...major.map((p) => p.x)) < 0, 'past half, the arc reaches back past its ends');
});

test('curving a segment replaces it with chords and keeps the ring aligned', () => {
  const shape = square();
  const before = ringLen(shape.rings[0]);
  const n = curveSegment(shape, 0, 0, 0.3);
  const ring = shape.rings[0];
  assert.ok(n > 1, 'it became several segments');
  assert.equal(ringLen(ring), before + n - 1);
  assert.equal(ring.walls.length, ring.pts.length, 'one wall state per segment, still');
  assert.ok(ring.walls.slice(0, n).every((w) => w === SEG_WALL), 'all of them the wall it was');
  assert.ok(ringIsCCW(ring.pts), 'and the outer ring is still wound outward');
});

test('curving the segment that wraps the ring works like any other', () => {
  const shape = square();
  const last = ringLen(shape.rings[0]) - 1;
  const n = curveSegment(shape, 0, last, 0.3);
  assert.ok(n > 1);
  assert.ok(straightenRun(shape, 0, last, n));
  assert.deepEqual(shape.rings[0].pts, square().rings[0].pts, 'and straightens back to the chord');
});

test('straightening puts the chord back, exactly', () => {
  const shape = square();
  const original = shape.rings[0].pts.map((p) => ({ ...p }));
  const n = curveSegment(shape, 0, 1, 0.4);
  assert.notDeepEqual(shape.rings[0].pts, original);
  straightenRun(shape, 0, 1, n);
  assert.deepEqual(shape.rings[0].pts, original);
  assert.equal(shape.rings[0].walls.length, 4);
});

test('re-curving means straighten-then-curve, not arcs on arcs', () => {
  // The tool's memo (see editor.js) exists so that adjusting a curve puts the
  // chord back first. What it has to be worth is this: the result is
  // indistinguishable from having curved the original wall once, at the final
  // radius — no accumulated vertices, no arc laid over an arc.
  const once = square();
  const nOnce = curveSegment(once, 0, 0, 0.5);

  const twice = square();
  const n1 = curveSegment(twice, 0, 0, 0.2);
  straightenRun(twice, 0, 0, n1);
  const nTwice = curveSegment(twice, 0, 0, 0.5);

  assert.equal(nTwice, nOnce);
  assert.deepEqual(twice.rings[0].pts, once.rings[0].pts);
  assert.deepEqual(twice.rings[0].walls, once.rings[0].walls);
});

test('a doorway on a curved segment is dropped, and the others renumber', () => {
  const shape = square();
  addOpening(shape, 0, 0, 0.5, DOOR_W, { leaf: LEAF_SINGLE });
  addOpening(shape, 0, 2, 0.5, DOOR_W);
  const ring = shape.rings[0];
  assert.equal(ring.openings.length, 2);
  const n = curveSegment(shape, 0, 0, 0.3);
  assert.equal(ring.openings.length, 1, 'a 2ft chord has nowhere to put a 3ft door');
  const kept = ring.openings[0];
  assert.equal(kept.seg, 2 + n - 1, 'the survivor followed its wall along');
  const [a, b] = segEnds(ring, kept.seg);
  assert.ok(segLength(a, b) > DOOR_W, 'and is still on a wall long enough to hold it');
});

test('a wall too short to bend is left alone, and so is a silly bulge', () => {
  const shape = makeShape([{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 8 }, { x: 0, z: 8 }]);
  assert.equal(curveSegment(shape, 0, 0, 0.4), 1, `under ${MIN_ARC_CHORD}ft there is no room`);
  assert.equal(ringLen(shape.rings[0]), 4);
  const big = square();
  assert.equal(curveSegment(big, 0, 0, 0.0001), 1, 'and a bulge that small is a straight wall');
  assert.equal(curveSegment(big, 0, 9, 0.4), 1, 'a segment the ring does not have does nothing');
  // A bulge past the cap is clamped rather than refused.
  const clamped = square();
  assert.ok(curveSegment(clamped, 0, 0, 5) > 1);
  const g = arcGeometry({ x: 0, z: 0 }, { x: 20, z: 0 }, MAX_BULGE);
  assert.ok(g.R > 0 && Number.isFinite(g.R));
});

test('straightening refuses to eat a ring down below a triangle', () => {
  const shape = makeShape([{ x: 0, z: 0 }, { x: 20, z: 0 }, { x: 10, z: 20 }]);
  assert.equal(straightenRun(shape, 0, 0, 8), false, 'nothing to remove without collapsing it');
  assert.equal(straightenRun(shape, 0, 0, 1), false, 'and a run of one is already straight');
  assert.equal(ringLen(shape.rings[0]), 3);
});

test('a curved room saves and loads as the polygon it now is', () => {
  const s = createState(30, 30);
  const shape = addShape(s, 0, [
    { x: 0, z: 0 }, { x: 20, z: 0 }, { x: 20, z: 20 }, { x: 0, z: 20 },
  ], { name: 'Rotunda' });
  const n = curveSegment(shape, 0, 0, 0.45);
  const back = deserialize(serialize(s));
  assert.deepEqual(back.floors[0].shapes, s.floors[0].shapes);
  assert.equal(ringLen(back.floors[0].shapes[0].rings[0]), 3 + n,
    'no schema for curvature means nothing extra to migrate');
});

// ---------- room names ----------
//
// The field that offers these used to be seeded with the literal 'Room 101'
// and never advanced, so every room drawn by hand came out with that name.
// Three rectangles, three rooms, one name — and `bindRoom` resolving an
// imported timetable by exact name then had a coin toss to make.

test('a storey numbers from its own hundred block', () => {
  assert.equal(storeyBase(0), 100);
  assert.equal(storeyBase(1), 200);
  assert.equal(storeyBase(7), 800);
  // Past the eighth storey it keeps counting rather than wrapping.
  assert.equal(storeyBase(11), 1200);
  assert.equal(storeyBase(-3), 100, 'and a nonsense index reads as the ground');
});

test('an empty storey offers the first number in its block', () => {
  const s = createState(30, 30);
  assert.equal(nextRoomName(s), 'Room 101');
  addFloor(s);
  assert.equal(nextRoomName(s, 1), 'Room 201');
});

test('each room drawn pushes the suggestion past it', () => {
  const s = createState(40, 40);
  const box = (x) => [
    { x, z: 0 }, { x: x + 10, z: 0 }, { x: x + 10, z: 10 }, { x, z: 10 },
  ];
  assert.equal(nextRoomName(s), 'Room 101');
  addShape(s, 0, box(0), { name: nextRoomName(s) });
  assert.equal(nextRoomName(s), 'Room 102');
  addShape(s, 0, box(12), { name: nextRoomName(s) });
  addShape(s, 0, box(24), { name: nextRoomName(s) });
  assert.equal(nextRoomName(s), 'Room 104');
  const names = s.floors[0].shapes.map((sh) => sh.name);
  assert.deepEqual(names, ['Room 101', 'Room 102', 'Room 103'],
    'three rectangles, three different names');
});

test('a gap in the numbering is filled before the run is continued', () => {
  const s = createState(40, 40);
  const box = (x) => [
    { x, z: 0 }, { x: x + 8, z: 0 }, { x: x + 8, z: 8 }, { x, z: 8 },
  ];
  addShape(s, 0, box(0), { name: 'Room 101' });
  addShape(s, 0, box(10), { name: 'Room 103' });
  assert.equal(nextRoomName(s), 'Room 102');
});

test('a number used on another storey is still used', () => {
  // Names have to tell a room apart from every other room in the building,
  // not just from its neighbours — bindRoom searches the whole pool.
  const s = createState(30, 30);
  addFloor(s);
  const box = [{ x: 0, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 8 }, { x: 0, z: 8 }];
  addShape(s, 0, box, { name: 'Room 201' });
  assert.equal(nextRoomName(s, 1), 'Room 202',
    'a stray 201 on the ground pushes the first floor past it');
});

test('names that are not numbers are simply not numbers', () => {
  const s = createState(30, 30);
  const box = (x) => [
    { x, z: 0 }, { x: x + 8, z: 0 }, { x: x + 8, z: 8 }, { x, z: 8 },
  ];
  addShape(s, 0, box(0), { name: 'Learning Commons' });
  addShape(s, 0, box(10), { name: null });
  assert.equal(nextRoomName(s), 'Room 101');
});

test('a room number reads off the end of the name, suffix and all', () => {
  const s = createState(30, 30);
  const box = (x) => [
    { x, z: 0 }, { x: x + 8, z: 0 }, { x: x + 8, z: 8 }, { x, z: 8 },
  ];
  addShape(s, 0, box(0), { name: 'Science Lab 101' });
  addShape(s, 0, box(10), { name: 'Room 102b' });
  assert.equal(nextRoomName(s), 'Room 103');
});

test('nextRoomName follows the storey it is asked about', () => {
  const s = createState(30, 30);
  addFloor(s);
  s.currentFloor = 1;
  assert.equal(nextRoomName(s), 'Room 201', 'no argument means the current storey');
  assert.equal(nextRoomName(s, 0), 'Room 101');
});

test('nextRoomName survives a state it has no business being handed', () => {
  assert.equal(nextRoomName(null), 'Room 101');
  assert.equal(nextRoomName({}), 'Room 101');
  assert.equal(nextRoomName({ floors: [] }), 'Room 101');
});
