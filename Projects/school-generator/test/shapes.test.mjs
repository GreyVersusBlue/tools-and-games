// Polygon room tests: the geometry, the editing bookkeeping that keeps walls
// and doorways attached to the right segments, and the grid -> polygon
// migration path. Run `node --test` from Projects/school-generator.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CELL, DOOR_W, createState, setTile, floodRegion, cellIdx, edgeHIdx, edgeVIdx,
  duplicateFloor, addFloor,
} from '../js/grid.js';
import {
  SEG_NONE, SEG_WALL, SEG_GLASS, SEG_RAIL, isBuilt, canOpen, MAX_SHAPES,
  addShape, addHole, removeShape, makeShape, cleanRing,
  ringSignedArea, ringIsCCW, pointInShape, shapeArea, shapeBBox, interiorPoint,
  shapeAt, shapeById, nearestSegment, nearestVertex, segEnds,
  insertVertex, deleteVertex, moveVertex, setSegWall, addOpening, toggleOpening, orientRing,
  snapPoint, constrainAngle, enclosingShape, regionToPolygon, convertRegion,
  normalizeShape,
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

test('wall kinds survive a save round-trip on both representations', () => {
  const s = createState(10, 10);
  const shape = addShape(s, 0, RECT, {});
  setSegWall(shape, 0, 0, SEG_GLASS);
  setSegWall(shape, 0, 2, SEG_RAIL);
  s.floors[0].edgesH[edgeHIdx(s.floors[0], 2, 2)] = 3;  // glass
  s.floors[0].edgesV[edgeVIdx(s.floors[0], 3, 3)] = 4;  // railing
  const back = deserialize(serialize(s));
  assert.deepEqual(back.floors[0].shapes[0].rings[0].walls, shape.rings[0].walls);
  assert.equal(back.floors[0].edgesH[edgeHIdx(back.floors[0], 2, 2)], 3);
  assert.equal(back.floors[0].edgesV[edgeVIdx(back.floors[0], 3, 3)], 4);
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

// ---------- grid -> polygon migration ----------

const layout = () => {
  // Two rooms side by side sharing one partition, inside an outer shell.
  const s = createState(20, 20);
  const f = s.floors[0];
  for (let y = 2; y <= 5; y++) for (let x = 2; x <= 9; x++) setTile(f, x, y, true);
  for (let x = 2; x <= 9; x++) {
    f.edgesH[edgeHIdx(f, x, 2)] = 1;
    f.edgesH[edgeHIdx(f, x, 6)] = 1;
  }
  for (let y = 2; y <= 5; y++) {
    f.edgesV[edgeVIdx(f, 2, y)] = 1;
    f.edgesV[edgeVIdx(f, 10, y)] = 1;
    f.edgesV[edgeVIdx(f, 6, y)] = 1;      // the shared partition
  }
  f.edgesV[edgeVIdx(f, 6, 3)] = 2;        // with a door through it
  f.edgesH[edgeHIdx(f, 3, 2)] = 2;        // and one to the outside
  for (const c of floodRegion(f, 3, 3)) {
    f.cells[cellIdx(f, c.x, c.y)].room = 'Room 101';
    f.cells[cellIdx(f, c.x, c.y)].color = '#f5d491';
  }
  return s;
};

test('a grid region traces to a polygon outline in feet', () => {
  const s = layout();
  const f = s.floors[0];
  const loops = regionToPolygon(f, floodRegion(f, 3, 3));
  assert.equal(loops.length, 1);
  const xs = loops[0].pts.map((p) => p.x);
  const zs = loops[0].pts.map((p) => p.z);
  assert.deepEqual([Math.min(...xs), Math.max(...xs)], [2 * CELL, 6 * CELL]);
  assert.deepEqual([Math.min(...zs), Math.max(...zs)], [2 * CELL, 6 * CELL]);
  // Straight runs collapse; the door keeps its own 4ft segment, and so does
  // the shared partition, which is why this isn't a plain rectangle.
  assert.ok(loops[0].pts.length > 4, 'walls that differ do not merge into one run');
  assert.ok(loops[0].segs.some((sg) => sg.shared), 'the partition is flagged as shared');
  assert.ok(loops[0].segs.some((sg) => sg.val === 2), 'the doorway survives the trace');
});

test('a region with a hole in it traces an inner loop too', () => {
  const s = createState(20, 20);
  const f = s.floors[0];
  for (let y = 0; y <= 6; y++) for (let x = 0; x <= 6; x++) setTile(f, x, y, true);
  setTile(f, 3, 3, false);                        // a courtyard in the middle
  const loops = regionToPolygon(f, floodRegion(f, 0, 0));
  assert.equal(loops.length, 2, 'outer boundary plus the courtyard');
  assert.ok(Math.abs(ringSignedArea(loops[0].pts)) > Math.abs(ringSignedArea(loops[1].pts)),
    'the outer loop comes first');
  assert.equal(loops[1].pts.length, 4, 'the courtyard is a square');
});

test('converting a grid room hands over its cells, walls and doors', () => {
  const s = layout();
  const f = s.floors[0];
  const before = floodRegion(f, 3, 3).length;
  assert.ok(before > 0);

  const shape = convertRegion(s, 0, 3, 3);
  assert.ok(shape, 'the region became a polygon');
  assert.equal(shape.name, 'Room 101', 'name and colour come along');
  assert.equal(shape.color, '#f5d491');
  assert.equal(shapeArea(shape), before * CELL * CELL, 'same floor area, now as a polygon');
  assert.equal(floodRegion(f, 3, 3).length, 0, 'the cells were handed back');

  // The exterior walls moved onto the polygon...
  assert.equal(f.edgesV[edgeVIdx(f, 2, 3)], 0, 'exterior grid wall cleared');
  assert.equal(f.edgesH[edgeHIdx(f, 3, 2)], 0, 'exterior door cleared');
  assert.ok(shape.rings[0].openings.length >= 1, 'and the door came with it');
  // ...but the partition it shares with Room 102 stays on the grid, drawn once.
  assert.equal(f.edgesV[edgeVIdx(f, 6, 4)], 1, 'shared partition left alone');
  const sharedSeg = shape.rings[0].walls.filter((w) => w === SEG_NONE).length;
  assert.ok(sharedSeg >= 1, 'the polygon leaves that side open rather than doubling it');
  assert.equal(shapeAt(f, 3.5 * CELL, 3.5 * CELL).id, shape.id);
});

test('converting nothing is a no-op', () => {
  const s = createState(10, 10);
  assert.equal(convertRegion(s, 0, 1, 1), null, 'no floor there');
  assert.equal(convertRegion(s, 5, 1, 1), null, 'no such storey');
  assert.deepEqual(s.floors[0].shapes, []);
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
