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
  paintTiles, frozenAtPoint, rasterOf, rasterPitch, refineRaster, cellCentre,
} from '../js/paint.js';
import { MIN_PITCH, tileBounds } from '../js/snapgrid.js';
import { setGridRef } from '../js/gridref.js';

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

// ---------- the raster the brush draws on (Phase 35) ----------

test('a design with nothing said about it draws on the 4ft module at the corner', () => {
  const s = createState(12, 10);
  assert.equal(rasterPitch(s), CELL);
  const R = rasterOf(s, 0);
  assert.deepEqual(R, { pitch: CELL, x0: 0, z0: 0, w: 12, h: 10 });
  assert.deepEqual(cellCentre(R, 0, 0), { x: 2, z: 2 });
});

test('a raster only ever gets finer, and only onto the ladder', () => {
  const s = createState(12, 10);
  assert.equal(refineRaster(s, MIN_PITCH), true);
  assert.equal(rasterPitch(s), MIN_PITCH);
  assert.equal(refineRaster(s, CELL), false, 'a coarser tile does not coarsen the raster');
  assert.equal(rasterPitch(s), MIN_PITCH);
  assert.equal(refineRaster(s, 3), false, 'and 3ft is not a pitch');
  // ...and a file that says something impossible reads as the 4ft module.
  const bad = createState(12, 10);
  bad.cellFt = 3;
  assert.equal(rasterPitch(bad), CELL);
  bad.cellFt = 16;
  assert.equal(rasterPitch(bad), CELL, 'a coarser cell would strand rooms drawn on a finer one');
});

test('refining the raster leaves every room already drawn exactly on it', () => {
  const s = room();
  const before = shapeArea(only(s));
  assert.equal(latticeAligned(only(s), rasterOf(s, 0)), true);
  refineRaster(s, MIN_PITCH);
  assert.equal(latticeAligned(only(s), rasterOf(s, 0)), true, '4ft points are 2ft points');
  // ...and a repaint at the finer raster takes exactly the 2ft square it was
  // asked for out of a room drawn in 4ft ones. The `room()` fixture's block is
  // 4..20 x 4..16 ft, so this is its top-left corner.
  paintTiles(s, 0, [tileBounds(2, 2, MIN_PITCH)], false);
  assert.equal(shapeArea(only(s)), before - MIN_PITCH * MIN_PITCH);
});

test('the finest tile is a 2ft square of floor, and it lands where the grid is', () => {
  const s = createState(12, 10);
  const t = tileBounds(3, 2, MIN_PITCH);          // 6..8 x 4..6 ft
  const out = paintTiles(s, 0, [t], true, { name: 'Cupboard' });
  assert.equal(out.added, 1);
  assert.equal(rasterPitch(s), MIN_PITCH, 'the design refined itself to hold it');
  const shape = only(s);
  assert.equal(Math.round(shapeArea(shape)), MIN_PITCH * MIN_PITCH);
  assert.ok(pointInShape(shape, 7, 5));
  assert.ok(!pointInShape(shape, 9, 5));
});

test('a coarse tile is one call, not sixteen', () => {
  const s = createState(24, 24);
  // A 16ft tile at the coarse end of the ladder: sixteen 4ft cells of floor.
  const out = paintTiles(s, 0, [tileBounds(1, 1, 16)], true, { name: 'Hall' });
  assert.equal(out.added, 1);
  assert.equal(rasterPitch(s), CELL, 'a coarse tile needs no refinement');
  assert.equal(Math.round(shapeArea(only(s))), 16 * 16);
});

test('a reference point moves the raster the brush draws on', () => {
  const s = createState(12, 10);
  setGridRef(s, { x: 1.5, z: 0.5 });
  const R = rasterOf(s, 0);
  assert.equal(R.x0, -2.5, 'the raster starts one whole tile outside the sheet');
  assert.equal(R.z0, -3.5);
  assert.ok(R.x0 + R.w * R.pitch >= 12 * CELL, 'and covers all of it');
  assert.ok(R.z0 + R.h * R.pitch >= 10 * CELL);
  // A tile laid on that grid is on that grid, not on the corner's.
  paintTiles(s, 0, [tileBounds(1, 1, CELL, { x: 1.5, z: 0.5 })], true, { name: 'Off-grid' });
  const shape = only(s);
  assert.ok(pointInShape(shape, 7.5, 6.5));
  assert.ok(!pointInShape(shape, 5, 4), 'the corner grid would have put it here');
});

test('a room drawn on a moved grid is still the brush\'s to repaint', () => {
  const s = createState(12, 10);
  setGridRef(s, { x: 1.5, z: 0.5 });
  const o = { x: 1.5, z: 0.5 };
  paintTiles(s, 0, [tileBounds(1, 1, CELL, o), tileBounds(2, 1, CELL, o)], true, { name: 'Pair' });
  assert.equal(latticeAligned(only(s), rasterOf(s, 0)), true);
  const out = paintTiles(s, 0, [tileBounds(3, 1, CELL, o)], true, { name: 'Pair' });
  assert.equal(out.changed, 1);
  assert.equal(shapesOf(s.floors[0]).length, 1, 'it grew the room rather than starting one');
});

test('overlapping tiles in one call cost one cell each, not two', () => {
  const s = createState(12, 10);
  const t = tileBounds(2, 2, CELL);
  const out = paintTiles(s, 0, [t, t, t], true);
  assert.equal(out.changed, 1);
});

test('the two refusals are counted apart, because they are two sentences', () => {
  const s = createState(6, 6);                      // a 24 x 24 ft sheet
  addShape(s, 0, [{ x: 4, z: 4 }, { x: 18, z: 8 }, { x: 10, z: 18 }]);
  const inside = tileBounds(2, 2, CELL);            // inside the free-drawn room
  const off = tileBounds(9, 9, CELL);               // well past the edge of the sheet
  const out = paintTiles(s, 0, [inside, off], true);
  assert.equal(out.frozenTiles, 1, 'one tile the vertex tool owns');
  assert.equal(out.offSheetTiles, 1, 'and one off the plan altogether');
  assert.equal(out.refused, out.frozen + out.offSheet, 'refused is still their sum');
});

test('a tile clipped by the edge of the sheet is not reported as off it', () => {
  const s = createState(6, 6);                      // 24 x 24 ft
  // A 16ft tile whose centre is on the sheet but whose far half is not.
  const out = paintTiles(s, 0, [tileBounds(1, 1, 16)], true, { name: 'Corner' });
  assert.ok(out.changed > 0, 'the part on the sheet was laid');
  assert.ok(out.offSheet > 0, 'and the part past it was not');
  assert.equal(out.offSheetTiles, 0, 'but half a tile is not a tile off the plan');
});

test('a stroke with no tiles in it does nothing and says so', () => {
  const s = room();
  const before = shapesOf(s.floors[0]).length;
  const out = paintTiles(s, 0, [], true);
  assert.equal(out.changed, 0);
  assert.equal(shapesOf(s.floors[0]).length, before);
});

test('the frozen test answers in feet as well as in cells', () => {
  const s = createState(12, 10);
  addShape(s, 0, [{ x: 20, z: 8 }, { x: 34, z: 12 }, { x: 26, z: 22 }]);
  const inside = frozenAtPoint(s, 0, 27, 13);
  assert.ok(inside, 'a free-drawn room is the vertex tool\'s, not the brush\'s');
  assert.equal(frozenAtPoint(s, 0, 2, 2), null);
  // ...and the cell form asks the same question about the cell's centre.
  const R = rasterOf(s, 0);
  const c = { x: Math.floor((27 - R.x0) / R.pitch), y: Math.floor((13 - R.z0) / R.pitch) };
  assert.ok(frozenAt(s, 0, c.x, c.y));
});
