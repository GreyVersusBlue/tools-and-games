// lattice.test.mjs — the 4ft drawing surface and the bake that turns it into
// rooms. Phase 12's foundation: everything that used to read `floor.cells`
// now reads shapes, and this file is where "the same building came out the
// other side" is checked. Run `node --test` from Projects/school-generator.

import test from 'node:test';
import assert from 'node:assert/strict';

import { CELL, DOOR_W, createState } from '../js/grid.js';
import {
  createLattice, setTile, getCell, floodRegion, allRegions, latticeCellCount,
  edgeHIdx, edgeVIdx, traceRegion, bake, gridOpeningWidth,
  GRID_DOOR2_W, GRID_WINDOW_W,
  EDGE_WALL, EDGE_DOOR, EDGE_DOOR2, EDGE_GLASS, EDGE_RAIL, EDGE_WINDOW,
  EDGE_OPENING,
} from '../js/lattice.js';
import {
  SEG_NONE, SEG_WALL, SEG_GLASS, SEG_RAIL, isBuilt,
  shapeArea, ringIsCCW, segEnds, openingSpec, pointInShape,
  LEAF_SINGLE, LEAF_DOUBLE, LEAF_NONE, OP_WINDOW, MAX_SHAPES,
} from '../js/shapes.js';
import { segLeaves, leafEnd } from '../js/openings.js';

// A lattice with one solid block of cells drawn on it, walls all round.
function boxLattice(w = 8, h = 8, x0 = 0, y0 = 0, x1 = 3, y1 = 2) {
  const lat = createLattice(w, h);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setTile(lat, x, y, true);
  for (let x = x0; x <= x1; x++) {
    lat.edgesH[edgeHIdx(lat, x, y0)] = EDGE_WALL;
    lat.edgesH[edgeHIdx(lat, x, y1 + 1)] = EDGE_WALL;
  }
  for (let y = y0; y <= y1; y++) {
    lat.edgesV[edgeVIdx(lat, x0, y)] = EDGE_WALL;
    lat.edgesV[edgeVIdx(lat, x1 + 1, y)] = EDGE_WALL;
  }
  return lat;
}

// Where an opening sits in world feet, so a test can say "the door is in the
// middle of the third cell" without knowing which way the ring was wound.
function openingPoint(shape, ringIdx, o) {
  const ring = shape.rings[ringIdx];
  const [a, b] = segEnds(ring, o.seg);
  return { x: a.x + (b.x - a.x) * o.t, z: a.z + (b.z - a.z) * o.t };
}

function allOpenings(shape) {
  const out = [];
  shape.rings.forEach((r, ri) => r.openings.forEach((o) => out.push({ ...o, ring: ri })));
  return out;
}

// ---------- the raster itself ----------

test('a fresh lattice is empty and has room for a wall on every edge', () => {
  const lat = createLattice(6, 4);
  assert.equal(latticeCellCount(lat), 0);
  assert.equal(lat.cells.length, 24);
  assert.equal(lat.edgesH.length, 6 * 5);
  assert.equal(lat.edgesV.length, 7 * 4);
  assert.equal(getCell(lat, 0, 0), null);
});

test('setTile draws and undraws, and says whether it changed anything', () => {
  const lat = createLattice(4, 4);
  assert.equal(setTile(lat, 1, 1, true), true);
  assert.equal(setTile(lat, 1, 1, true), false);
  assert.ok(getCell(lat, 1, 1));
  assert.equal(setTile(lat, 1, 1, false), true);
  assert.equal(setTile(lat, 9, 9, true), false);
});

test('a flood region stops at anything on an edge, glass and railing included', () => {
  const lat = createLattice(4, 2);
  for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) setTile(lat, x, y, true);
  assert.equal(floodRegion(lat, 0, 0).length, 8);
  lat.edgesV[edgeVIdx(lat, 2, 0)] = EDGE_GLASS;
  lat.edgesV[edgeVIdx(lat, 2, 1)] = EDGE_RAIL;
  assert.equal(floodRegion(lat, 0, 0).length, 4);
  assert.equal(floodRegion(lat, 3, 0).length, 4);
});

test('allRegions walks in reading order, which is what makes a bake repeatable', () => {
  const lat = createLattice(6, 2);
  for (let y = 0; y < 2; y++) for (let x = 0; x < 6; x++) setTile(lat, x, y, true);
  for (let y = 0; y < 2; y++) lat.edgesV[edgeVIdx(lat, 3, y)] = EDGE_WALL;
  const regions = allRegions(lat);
  assert.equal(regions.length, 2);
  // The first region is the one containing the topmost-leftmost cell.
  assert.ok(regions[0].some((c) => c.x === 0 && c.y === 0));
  assert.ok(regions[1].some((c) => c.x === 3 && c.y === 0));
});

// ---------- tracing ----------

test('a rectangular region traces to one loop of four merged runs', () => {
  const lat = boxLattice();
  const loops = traceRegion(lat, floodRegion(lat, 0, 0));
  assert.equal(loops.length, 1);
  assert.equal(loops[0].pts.length, 4);
  assert.ok(loops[0].segs.every((s) => s.kind === SEG_WALL && s.mine));
});

test('an already-claimed edge traces as an open side, not a second wall', () => {
  const lat = boxLattice();
  const claimed = new Set();
  // Claim the whole north wall by hand, as an earlier region would have.
  for (let x = 0; x <= 3; x++) claimed.add('H' + edgeHIdx(lat, x, 0));
  const loops = traceRegion(lat, floodRegion(lat, 0, 0), claimed);
  const kinds = loops[0].segs.map((s) => s.kind);
  assert.equal(kinds.filter((k) => k === SEG_NONE).length, 1);
  assert.equal(kinds.filter((k) => k === SEG_WALL).length, 3);
});

// ---------- the bake ----------

test('one walled block bakes to one room of the right area, wound outward', () => {
  const s = createState(8, 8);
  const lat = boxLattice();
  const out = bake(s, 0, lat);
  assert.equal(out.shapes.length, 1);
  assert.equal(out.orphans, 0);
  const shape = s.floors[0].shapes[0];
  assert.equal(shapeArea(shape), 12 * CELL * CELL);
  assert.equal(shape.rings.length, 1);
  assert.ok(ringIsCCW(shape.rings[0].pts));
  assert.equal(shape.rings[0].pts.length, 4);
  assert.ok(shape.rings[0].walls.every((w) => w === SEG_WALL));
  assert.ok(shape.id > 0);
});

test('a baked room keeps the name, tint and finishes its cells carried', () => {
  const s = createState(8, 8);
  const lat = boxLattice();
  for (const c of floodRegion(lat, 0, 0)) {
    const cell = lat.cells[c.y * lat.w + c.x];
    cell.room = 'Room 101';
    cell.color = '#ff8800';
    cell.fin = 'carpet';
    cell.paint = '#123456';
  }
  bake(s, 0, lat);
  const shape = s.floors[0].shapes[0];
  assert.equal(shape.name, 'Room 101');
  assert.equal(shape.color, '#ff8800');
  assert.equal(shape.fin, 'carpet');
  assert.equal(shape.paint, '#123456');
});

test('a partition between two rooms is built by exactly one of them', () => {
  const s = createState(10, 4);
  const lat = createLattice(10, 4);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 8; x++) setTile(lat, x, y, true);
  for (let x = 0; x < 8; x++) {
    lat.edgesH[edgeHIdx(lat, x, 0)] = EDGE_WALL;
    lat.edgesH[edgeHIdx(lat, x, 3)] = EDGE_WALL;
  }
  for (let y = 0; y < 3; y++) {
    lat.edgesV[edgeVIdx(lat, 0, y)] = EDGE_WALL;
    lat.edgesV[edgeVIdx(lat, 8, y)] = EDGE_WALL;
    lat.edgesV[edgeVIdx(lat, 4, y)] = EDGE_WALL;   // the partition
  }
  const out = bake(s, 0, lat);
  assert.equal(out.shapes.length, 2);
  assert.equal(out.orphans, 0);
  const [west, east] = out.shapes;
  // The partition runs down x = 16ft. Exactly one room builds a wall there.
  const wallAt16 = (shape) => shape.rings[0].walls.some((w, i) => {
    const [a, b] = segEnds(shape.rings[0], i);
    return isBuilt(w) && a.x === 16 && b.x === 16;
  });
  assert.equal(wallAt16(west), true);
  assert.equal(wallAt16(east), false);
  // ...and the east room still has a boundary there, it is simply open.
  assert.ok(east.rings[0].pts.some((p) => p.x === 16));
});

test('a door on the lattice becomes an opening at the cell it sat in', () => {
  const s = createState(8, 8);
  const lat = boxLattice();
  lat.edgesH[edgeHIdx(lat, 1, 0)] = EDGE_DOOR;
  bake(s, 0, lat);
  const shape = s.floors[0].shapes[0];
  const openings = allOpenings(shape);
  assert.equal(openings.length, 1);
  const spec = openingSpec(openings[0]);
  assert.equal(spec.leaf, LEAF_SINGLE);
  assert.equal(spec.w, DOOR_W);
  const p = openingPoint(shape, openings[0].ring, openings[0]);
  assert.equal(p.z, 0);
  assert.ok(Math.abs(p.x - 6) < 1e-9, `door at x=${p.x}, wanted 6`);
});

test('every lattice opening kind bakes to the polygon opening it always meant', () => {
  const cases = [
    [EDGE_DOOR, LEAF_SINGLE, false, DOOR_W],
    [EDGE_DOOR2, LEAF_DOUBLE, false, GRID_DOOR2_W],
    [EDGE_OPENING, LEAF_NONE, false, DOOR_W],
    [EDGE_WINDOW, LEAF_NONE, true, GRID_WINDOW_W],
  ];
  for (const [edge, leaf, isWindow, w] of cases) {
    const s = createState(8, 8);
    const lat = boxLattice();
    lat.edgesH[edgeHIdx(lat, 1, 0)] = edge;
    bake(s, 0, lat);
    const shape = s.floors[0].shapes[0];
    const o = allOpenings(shape)[0];
    assert.ok(o, `edge kind ${edge} produced no opening`);
    const spec = openingSpec(o);
    assert.equal(spec.window, isWindow, `edge kind ${edge}`);
    assert.equal(spec.leaf, leaf, `edge kind ${edge}`);
    assert.equal(spec.kind === OP_WINDOW, isWindow);
    assert.equal(o.w, w, `edge kind ${edge}`);
    assert.equal(o.w, Math.min(gridOpeningWidth(edge), 16 - 0.5));
    // The wall it is cut into is still a wall.
    assert.ok(isBuilt(shape.rings[o.ring].walls[o.seg]));
  }
});

test('glass and railing keep their kind through a bake', () => {
  const s = createState(8, 8);
  const lat = boxLattice();
  for (let x = 0; x <= 3; x++) lat.edgesH[edgeHIdx(lat, x, 0)] = EDGE_GLASS;
  for (let y = 0; y <= 2; y++) lat.edgesV[edgeVIdx(lat, 0, y)] = EDGE_RAIL;
  bake(s, 0, lat);
  const walls = s.floors[0].shapes[0].rings[0].walls;
  assert.equal(walls.filter((w) => w === SEG_GLASS).length, 1);
  assert.equal(walls.filter((w) => w === SEG_RAIL).length, 1);
  assert.equal(walls.filter((w) => w === SEG_WALL).length, 2);
});

test('a long wall with two doors in it is one segment carrying two openings', () => {
  const s = createState(12, 6);
  const lat = boxLattice(12, 6, 0, 0, 7, 2);
  lat.edgesH[edgeHIdx(lat, 1, 0)] = EDGE_DOOR;
  lat.edgesH[edgeHIdx(lat, 5, 0)] = EDGE_DOOR;
  bake(s, 0, lat);
  const ring = s.floors[0].shapes[0].rings[0];
  assert.equal(ring.pts.length, 4);
  assert.equal(ring.openings.length, 2);
  assert.equal(new Set(ring.openings.map((o) => o.seg)).size, 1);
});

test('a doughnut region bakes to an outer ring and a hole', () => {
  const s = createState(10, 10);
  const lat = createLattice(10, 10);
  for (let y = 1; y <= 5; y++) {
    for (let x = 1; x <= 5; x++) {
      if (x >= 2 && x <= 4 && y >= 2 && y <= 4) continue;
      setTile(lat, x, y, true);
    }
  }
  bake(s, 0, lat);
  const shape = s.floors[0].shapes[0];
  assert.equal(shape.rings.length, 2);
  assert.ok(ringIsCCW(shape.rings[0].pts));
  assert.equal(ringIsCCW(shape.rings[1].pts), false);
  // 25 cells minus the 9 the courtyard takes out.
  assert.equal(shapeArea(shape), 16 * CELL * CELL);
  assert.equal(pointInShape(shape, 12, 12), false);   // the middle is the hole
  assert.equal(pointInShape(shape, 6, 6), true);
});

test('a wall with no room on either side is counted, not lost in silence', () => {
  const s = createState(8, 8);
  const lat = boxLattice();
  // Three cells of wall out in the empty part of the lattice.
  for (let x = 5; x <= 7; x++) lat.edgesH[edgeHIdx(lat, x, 6)] = EDGE_WALL;
  const out = bake(s, 0, lat);
  assert.equal(out.shapes.length, 1);
  assert.equal(out.orphans, 3);
});

test('a stub that pokes into a room without dividing it is counted the same way', () => {
  // Half a partition: the flood runs round the end of it, so it is a boundary
  // of nothing and the polygon model has nowhere to put it.
  const s = createState(10, 8);
  const lat = boxLattice(10, 8, 0, 0, 5, 3);
  lat.edgesV[edgeVIdx(lat, 3, 0)] = EDGE_WALL;
  lat.edgesV[edgeVIdx(lat, 3, 1)] = EDGE_WALL;
  const out = bake(s, 0, lat);
  assert.equal(out.shapes.length, 1, 'still one room — the stub divides nothing');
  assert.equal(out.orphans, 2);
  // ...and the same wall carried all the way across is a partition, kept.
  const s2 = createState(10, 8);
  const lat2 = boxLattice(10, 8, 0, 0, 5, 3);
  for (let y = 0; y <= 3; y++) lat2.edgesV[edgeVIdx(lat2, 3, y)] = EDGE_WALL;
  const out2 = bake(s2, 0, lat2);
  assert.equal(out2.shapes.length, 2);
  assert.equal(out2.orphans, 0);
});

test('baked ids come off the state counter and never repeat', () => {
  const s = createState(12, 6);
  const lat = createLattice(12, 6);
  for (let y = 0; y < 2; y++) for (let x = 0; x < 9; x++) setTile(lat, x, y, true);
  for (let y = 0; y < 2; y++) {
    lat.edgesV[edgeVIdx(lat, 3, y)] = EDGE_WALL;
    lat.edgesV[edgeVIdx(lat, 6, y)] = EDGE_WALL;
  }
  const before = s.nextId;
  const out = bake(s, 0, lat);
  assert.equal(out.shapes.length, 3);
  const ids = out.shapes.map((sh) => sh.id);
  assert.equal(new Set(ids).size, 3);
  assert.ok(ids.every((id) => id >= before));
  assert.ok(s.nextId > Math.max(...ids));
});

// The one thing about a baked door that is not obvious from its record: which
// jamb its leaf hangs on. The lattice had no winding — a horizontal edge ran
// +X and a vertical one ran +Z — so `hand`/`sw` meant one fixed thing per
// edge; half of a ring's segments run the other way. Both fields flip on those,
// and the leaf comes out on the jamb it was on and swinging the way it swung.
// (It cost a third of a fire drill to notice, which is why it is two tests.)
function bakedLeaf(edgeKind, place) {
  const s = createState(10, 10);
  const lat = boxLattice(10, 10, 0, 0, 3, 2);
  place(lat);
  bake(s, 0, lat);
  const shape = s.floors[0].shapes[0];
  const o = allOpenings(shape)[0];
  const [a, b] = segEnds(shape.rings[o.ring], o.seg);
  return segLeaves(openingSpec(o), a, b)[0];
}

// What the lattice itself hung on that edge: its runs were always +X for a
// horizontal edge and +Z for a vertical one, with `hand` and `sw` both +1 and
// the opening fixed at the middle of the cell.
function latticeLeaf(edgeKind, a, b) {
  const spec = openingSpec({ seg: 0, t: 0.5, w: DOOR_W, leaf: LEAF_SINGLE });
  return segLeaves(spec, a, b)[0];
}

test('a baked door hangs on the jamb the lattice hung it on, north and south', () => {
  // North wall: the ring runs +X there, the same way the lattice edge did.
  const north = bakedLeaf(EDGE_DOOR, (lat) => { lat.edgesH[edgeHIdx(lat, 1, 0)] = EDGE_DOOR; });
  const wantN = latticeLeaf(EDGE_DOOR, { x: 4, z: 0 }, { x: 8, z: 0 });
  assert.ok(Math.abs(north.hx - wantN.hx) < 1e-9, `hinge x ${north.hx} vs ${wantN.hx}`);
  assert.equal(north.hz, wantN.hz);
  // South wall: the ring runs −X, so both fields flip and the hinge lands back
  // on the same jamb.
  const south = bakedLeaf(EDGE_DOOR, (lat) => { lat.edgesH[edgeHIdx(lat, 1, 3)] = EDGE_DOOR; });
  const wantS = latticeLeaf(EDGE_DOOR, { x: 4, z: 12 }, { x: 8, z: 12 });
  assert.ok(Math.abs(south.hx - wantS.hx) < 1e-9, `hinge x ${south.hx} vs ${wantS.hx}`);
  assert.equal(south.hz, wantS.hz);
});

test('a baked door swings the way the lattice swung it, east and west', () => {
  for (const [name, place, a, b] of [
    ['west', (lat) => { lat.edgesV[edgeVIdx(lat, 0, 1)] = EDGE_DOOR; }, { x: 0, z: 4 }, { x: 0, z: 8 }],
    ['east', (lat) => { lat.edgesV[edgeVIdx(lat, 4, 1)] = EDGE_DOOR; }, { x: 16, z: 4 }, { x: 16, z: 8 }],
  ]) {
    const baked = bakedLeaf(EDGE_DOOR, place);
    const want = latticeLeaf(EDGE_DOOR, a, b);
    const got = leafEnd(baked, 1), wanted = leafEnd(want, 1);
    assert.ok(Math.hypot(got.x - wanted.x, got.z - wanted.z) < 1e-6,
      `${name}: open leaf ends at (${got.x}, ${got.z}), wanted (${wanted.x}, ${wanted.z})`);
  }
});

test('the per-floor cap refuses rather than overflows, and says how many', () => {
  const s = createState(200, 4);
  const lat = createLattice(200, 4);
  // One cell every other column: each is its own region.
  const want = MAX_SHAPES + 5;
  let made = 0;
  for (let x = 0; x < 200 && made < want; x += 2) {
    for (let y = 0; y < 4 && made < want; y += 2) { setTile(lat, x, y, true); made++; }
  }
  const out = bake(s, 0, lat);
  assert.equal(out.shapes.length + out.dropped, made);
  assert.ok(out.shapes.length <= MAX_SHAPES);
  assert.equal(s.floors[0].shapes.length, out.shapes.length);
});
