// paint.test.mjs — the 4ft brush over polygon rooms. The question this file
// asks over and over is the only one that matters about a repaint: is the
// building that comes out the building that went in, plus or minus the cell
// somebody just drew? Run `node --test` from Projects/school-generator.

import test from 'node:test';
import assert from 'node:assert/strict';

import { CELL, createState, DOOR_W } from '../js/grid.js';
import {
  createLattice, setTile, edgeHIdx, edgeVIdx, bake,
  EDGE_WALL, EDGE_DOOR, EDGE_GLASS, EDGE_WINDOW,
} from '../js/lattice.js';
import {
  shapesOf, shapeArea, shapeAt, segEnds, openingSpec, pointInShape,
  addShape, curveSegment, isBuilt, isWindowOpening,
  SEG_WALL, SEG_GLASS, LEAF_SINGLE,
} from '../js/shapes.js';
import {
  latticeAligned, rasterize, ownedRegions, paintCell, paintCells, frozenAt,
} from '../js/paint.js';

// A storey with one walled block of cells on it, already baked into a room.
function room(w = 12, h = 10, box = [1, 1, 4, 3], extra = null, openEast = false) {
  const s = createState(w, h);
  const lat = createLattice(w, h);
  const [x0, y0, x1, y1] = box;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setTile(lat, x, y, true);
  for (let x = x0; x <= x1; x++) {
    lat.edgesH[edgeHIdx(lat, x, y0)] = EDGE_WALL;
    lat.edgesH[edgeHIdx(lat, x, y1 + 1)] = EDGE_WALL;
  }
  for (let y = y0; y <= y1; y++) {
    lat.edgesV[edgeVIdx(lat, x0, y)] = EDGE_WALL;
    if (!openEast) lat.edgesV[edgeVIdx(lat, x1 + 1, y)] = EDGE_WALL;
  }
  if (extra) extra(lat);
  bake(s, 0, lat);
  return s;
}

const only = (s) => s.floors[0].shapes[0];
const cells = (shape) => Math.round(shapeArea(shape) / (CELL * CELL));

const openingsOf = (shape) => {
  const out = [];
  shape.rings.forEach((r, ri) => r.openings.forEach((o) => out.push({ ...o, ring: ri })));
  return out;
};

const worldOf = (shape, o) => {
  const [a, b] = segEnds(shape.rings[o.ring], o.seg);
  return { x: a.x + (b.x - a.x) * o.t, z: a.z + (b.z - a.z) * o.t };
};

// ---------- what the brush will touch ----------

test('a baked room is on the lattice; a curved one is not', () => {
  const s = room();
  assert.equal(latticeAligned(only(s)), true);
  const angled = addShape(s, 0, [
    { x: 200, z: 200 }, { x: 240, z: 190 }, { x: 250, z: 230 },
  ]);
  assert.equal(latticeAligned(angled), false);
  const boxy = addShape(s, 0, [
    { x: 300, z: 200 }, { x: 340, z: 200 }, { x: 340, z: 240 }, { x: 300, z: 240 },
  ]);
  assert.equal(latticeAligned(boxy), true);
  curveSegment(boxy, 0, 0, 0.3);
  assert.equal(latticeAligned(boxy), false);
});

test('a room off the 4ft lattice is not on it, however square it is', () => {
  const s = createState(12, 10);
  const off = addShape(s, 0, [
    { x: 2, z: 2 }, { x: 42, z: 2 }, { x: 42, z: 42 }, { x: 2, z: 42 },
  ]);
  assert.equal(latticeAligned(off), false);
});

// ---------- rasterizing ----------

test('a room rasterizes back to the cells and walls it was baked from', () => {
  const s = room();
  const R = rasterize(s, 0);
  assert.equal(R.rooms.length, 1);
  assert.equal(R.frozen.length, 0);
  let on = 0;
  for (const c of R.lat.cells) if (c) on++;
  assert.equal(on, 12);
  // Its own four walls, one lattice edge at a time.
  let walls = 0;
  for (const v of R.lat.edgesH) if (v) walls++;
  for (const v of R.lat.edgesV) if (v) walls++;
  assert.equal(walls, 4 + 4 + 3 + 3);
  assert.equal(ownedRegions(R.lat, R.owner).length, 1);
});

test('two rooms that touch with no wall between them stay two regions', () => {
  const s = createState(14, 6);
  addShape(s, 0, [{ x: 0, z: 0 }, { x: 16, z: 0 }, { x: 16, z: 16 }, { x: 0, z: 16 }]);
  addShape(s, 0, [{ x: 16, z: 0 }, { x: 32, z: 0 }, { x: 32, z: 16 }, { x: 16, z: 16 }]);
  const R = rasterize(s, 0);
  const regions = ownedRegions(R.lat, R.owner);
  assert.equal(regions.length, 2);
  assert.equal(regions[0].cells.length, 16);
  assert.equal(regions[1].cells.length, 16);
});

// ---------- drawing ----------

test('painting a cell against a room grows that room, and keeps its id', () => {
  const s = room(12, 10, [1, 1, 4, 3], null, true);
  const before = only(s);
  const id = before.id, name = before.name;
  const out = paintCell(s, 0, 5, 1, true);
  assert.equal(out.changed, 1);
  assert.equal(out.added, 0);
  assert.equal(s.floors[0].shapes.length, 1);
  const after = only(s);
  assert.equal(after.id, id);
  assert.equal(after.name, name);
  assert.equal(cells(after), 13);
  assert.ok(pointInShape(after, 22, 6), 'the new cell is inside the room');
});

test('a cell painted the far side of a wall is a new room, not a bigger one', () => {
  // The lattice said the same thing: a wall bounds a flood region, so what you
  // draw on the other side of one is somewhere else.
  const s = room();
  const out = paintCell(s, 0, 5, 1, true, { name: 'Store' });
  assert.equal(out.added, 1);
  assert.equal(s.floors[0].shapes.length, 2);
  assert.equal(cells(only(s)), 12, 'the walled room did not grow');
});

test('painting away from everything starts a room of its own', () => {
  const s = room();
  const out = paintCell(s, 0, 9, 8, true, { name: 'Store', color: '#abcdef' });
  assert.equal(out.added, 1);
  assert.equal(s.floors[0].shapes.length, 2);
  const made = s.floors[0].shapes[1];
  assert.equal(made.name, 'Store');
  assert.equal(made.color, '#abcdef');
  assert.equal(cells(made), 1);
  assert.notEqual(made.id, only(s).id);
});

test('a stroke of cells is one new room, not one room per cell', () => {
  const s = createState(12, 10);
  const out = paintCells(s, 0, [
    { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 3 },
  ], true, { name: 'Corridor' });
  assert.equal(out.changed, 4);
  assert.equal(s.floors[0].shapes.length, 1);
  assert.equal(cells(only(s)), 4);
});

test('a painted cell joins the room it can walk to, never the one behind a wall', () => {
  // Two rooms side by side, sharing a partition, with a bare cell east of both.
  const s = createState(16, 8);
  const lat = createLattice(16, 8);
  for (let y = 1; y <= 3; y++) for (let x = 1; x <= 6; x++) setTile(lat, x, y, true);
  for (let x = 1; x <= 6; x++) {
    lat.edgesH[edgeHIdx(lat, x, 1)] = EDGE_WALL;
    lat.edgesH[edgeHIdx(lat, x, 4)] = EDGE_WALL;
  }
  for (let y = 1; y <= 3; y++) {
    lat.edgesV[edgeVIdx(lat, 1, y)] = EDGE_WALL;
    lat.edgesV[edgeVIdx(lat, 7, y)] = EDGE_WALL;
    lat.edgesV[edgeVIdx(lat, 4, y)] = EDGE_WALL;
  }
  bake(s, 0, lat);
  const [west, east] = s.floors[0].shapes;
  assert.equal(s.floors[0].shapes.length, 2);
  // Erase the east room's east wall by hand, then paint a cell out there.
  const ring = east.rings[0];
  ring.walls.forEach((w, i) => {
    const [a, b] = segEnds(ring, i);
    if (isBuilt(w) && a.x === 28 && b.x === 28) ring.walls[i] = 0;
  });
  paintCell(s, 0, 7, 2, true);
  assert.equal(s.floors[0].shapes.length, 2, 'still two rooms');
  const grown = s.floors[0].shapes.find((sh) => sh.id === east.id);
  assert.equal(cells(grown), 10);
  const untouched = s.floors[0].shapes.find((sh) => sh.id === west.id);
  assert.equal(cells(untouched), 9);
});

// ---------- erasing ----------

test('erasing a cell shrinks the room and takes the wall it stranded', () => {
  const s = room();
  const id = only(s).id;
  const out = paintCell(s, 0, 1, 1, false);
  assert.equal(out.changed, 1);
  assert.equal(s.floors[0].shapes.length, 1);
  const after = only(s);
  assert.equal(after.id, id);
  assert.equal(cells(after), 11);
  assert.equal(pointInShape(after, 6, 6), false, 'the erased cell is gone');
  // The corner is an L now, so the outline has six points rather than four.
  assert.equal(after.rings[0].pts.length, 6);
});

test('erasing the last cell of a room removes the room', () => {
  const s = room(12, 10, [1, 1, 1, 1]);
  assert.equal(s.floors[0].shapes.length, 1);
  const out = paintCell(s, 0, 1, 1, false);
  assert.equal(out.removed, 1);
  assert.equal(s.floors[0].shapes.length, 0);
});

test('cutting a room in two leaves two rooms, one of them keeping the id', () => {
  const s = room(12, 10, [1, 1, 5, 1]);   // a 5x1 strip
  const id = only(s).id;
  const out = paintCell(s, 0, 3, 1, false);
  assert.equal(s.floors[0].shapes.length, 2);
  assert.equal(out.added, 0);
  const ids = s.floors[0].shapes.map((sh) => sh.id);
  assert.ok(ids.includes(id), 'the western half keeps the id');
  assert.equal(new Set(ids).size, 2);
  assert.deepEqual(s.floors[0].shapes.map(cells), [2, 2]);
});

// ---------- what a repaint has to preserve ----------

test('a doorway survives a repaint, in the same place and the same way round', () => {
  const s = room(12, 10, [1, 1, 4, 3], (lat) => {
    lat.edgesH[edgeHIdx(lat, 2, 1)] = EDGE_DOOR;
  });
  const before = openingsOf(only(s))[0];
  const beforeAt = worldOf(only(s), before);
  const beforeSpec = openingSpec(before);

  paintCell(s, 0, 5, 3, true);   // grow the far corner, well away from the door

  const after = openingsOf(only(s));
  assert.equal(after.length, 1);
  const afterAt = worldOf(only(s), after[0]);
  assert.ok(Math.hypot(afterAt.x - beforeAt.x, afterAt.z - beforeAt.z) < 0.01,
    `door moved from (${beforeAt.x}, ${beforeAt.z}) to (${afterAt.x}, ${afterAt.z})`);
  const afterSpec = openingSpec(after[0]);
  assert.equal(afterSpec.w, beforeSpec.w);
  assert.equal(afterSpec.leaf, beforeSpec.leaf);
  assert.equal(afterSpec.kind, beforeSpec.kind);
});

test('a window and a glazed wall both survive a repaint', () => {
  const s = room(12, 10, [1, 1, 4, 3], (lat) => {
    lat.edgesH[edgeHIdx(lat, 2, 1)] = EDGE_WINDOW;
    for (let y = 1; y <= 3; y++) lat.edgesV[edgeVIdx(lat, 1, y)] = EDGE_GLASS;
  });
  const at = worldOf(only(s), openingsOf(only(s))[0]);
  paintCell(s, 0, 5, 3, true);
  const shape = only(s);
  const win = openingsOf(shape).filter(isWindowOpening);
  assert.equal(win.length, 1);
  const now = worldOf(shape, win[0]);
  assert.ok(Math.hypot(now.x - at.x, now.z - at.z) < 0.01);
  assert.ok(shape.rings[0].walls.includes(SEG_GLASS), 'the glazed wall is still glass');
});

test('a doorway whose wall was erased is dropped rather than moved somewhere else', () => {
  const s = room(12, 10, [1, 1, 4, 3], (lat) => {
    lat.edgesH[edgeHIdx(lat, 1, 1)] = EDGE_DOOR;
  });
  assert.equal(openingsOf(only(s)).length, 1);
  // Take out the cell the door stood over: its stretch of north wall goes too.
  paintCell(s, 0, 1, 1, false);
  const shape = only(s);
  const left = openingsOf(shape);
  assert.equal(left.length, 0);
});

test('painting nothing new changes nothing at all', () => {
  const s = room();
  const before = JSON.stringify(s.floors[0].shapes);
  const out = paintCell(s, 0, 2, 2, true);   // already drawn
  assert.equal(out.changed, 0);
  assert.equal(JSON.stringify(s.floors[0].shapes), before);
});

// ---------- the rooms the brush will not touch ----------

test('the brush refuses a cell inside a free-drawn room, and says which', () => {
  const s = createState(20, 20);
  const angled = addShape(s, 0, [
    { x: 8, z: 8 }, { x: 44, z: 2 }, { x: 50, z: 40 }, { x: 10, z: 44 },
  ], { name: 'Commons' });
  assert.equal(latticeAligned(angled), false);
  const out = paintCell(s, 0, 5, 5, true);
  assert.equal(out.refused, 1);
  assert.equal(out.changed, 0);
  assert.equal(s.floors[0].shapes.length, 1);
  assert.equal(frozenAt(s, 0, 5, 5), angled);
  assert.equal(frozenAt(s, 0, 18, 18), null);
});

test('a free-drawn room keeps its place in the list while the lattice is repainted', () => {
  const s = room(12, 10, [1, 1, 4, 3], null, true);
  const angled = addShape(s, 0, [
    { x: 200, z: 200 }, { x: 244, z: 194 }, { x: 250, z: 240 },
  ], { name: 'Commons' });
  paintCell(s, 0, 5, 1, true);
  const list = s.floors[0].shapes;
  assert.equal(list.length, 2);
  assert.equal(list[1], angled, 'the free-drawn room is still the topmost');
  assert.equal(shapeAt(s.floors[0], 220, 215), angled);
});

// ---------- a whole storey, repainted ----------

test('a repaint of a storey nobody edited is the same storey', () => {
  const s = room(16, 12, [1, 1, 6, 5], (lat) => {
    lat.edgesH[edgeHIdx(lat, 2, 1)] = EDGE_DOOR;
    lat.edgesH[edgeHIdx(lat, 4, 6)] = EDGE_DOOR;
    for (let y = 1; y <= 5; y++) lat.edgesV[edgeVIdx(lat, 7, y)] = EDGE_GLASS;
  });
  const before = JSON.stringify(s.floors[0].shapes);
  // Draw a cell and rub it straight back out.
  paintCell(s, 0, 10, 10, true);
  const extra = s.floors[0].shapes.length;
  paintCell(s, 0, 10, 10, false);
  assert.equal(extra, 2);
  assert.equal(s.floors[0].shapes.length, 1);
  assert.equal(JSON.stringify(s.floors[0].shapes), before);
});

test('the sample school paints without losing a room or a door', () => {
  const s = room(20, 16, [2, 2, 9, 7], (lat) => {
    for (let y = 2; y <= 7; y++) lat.edgesV[edgeVIdx(lat, 6, y)] = EDGE_WALL;
    lat.edgesV[edgeVIdx(lat, 6, 4)] = EDGE_DOOR;
    lat.edgesH[edgeHIdx(lat, 3, 2)] = EDGE_DOOR;
  }, true);
  assert.equal(s.floors[0].shapes.length, 2);
  const doorsBefore = shapesOf(s.floors[0])
    .flatMap((sh) => openingsOf(sh).map((o) => worldOf(sh, o)));
  assert.equal(doorsBefore.length, 2);
  paintCell(s, 0, 10, 4, true);
  assert.equal(s.floors[0].shapes.length, 2);
  const doorsAfter = shapesOf(s.floors[0])
    .flatMap((sh) => openingsOf(sh).map((o) => worldOf(sh, o)));
  assert.equal(doorsAfter.length, 2);
  for (const d of doorsBefore) {
    assert.ok(doorsAfter.some((e) => Math.hypot(e.x - d.x, e.z - d.z) < 0.01),
      `no door left at (${d.x}, ${d.z})`);
  }
});
