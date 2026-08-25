// The walkable surface, cut into tiles: what greedy meshing produces, what it
// refuses to produce (a rectangle with a wall through it), and where the gates
// between two tiles of one room end up. Built on lattices small enough to draw
// on paper, plus one polygon room and the sample school.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createState, setTile, edgeHIdx, edgeVIdx, CELL, EDGE_WALL, EDGE_DOOR,
} from '../js/grid.js';
import { addShape } from '../js/shapes.js';
import { buildSampleSchool } from '../js/sample.js';
import { floorRooms } from '../js/navgraph.js';
import {
  meshFloor, greedyRects, tileGate, tileFor, walkableArea, MESH_STEP,
} from '../js/navmesh.js';

const allOpen = { right: () => true, down: () => true };

// A rectangle of tiles for one room, in reading order.
const tilesOf = (mesh, roomId) => mesh.byRoom.get(roomId) || [];
const roomNamed = (fr, name) => fr.rooms.find((r) => r.name === name);

test('a solid rectangle of cells is exactly one tile', () => {
  const rects = greedyRects(4, 3, () => true, allOpen);
  assert.equal(rects.length, 1);
  assert.deepEqual(rects[0], { x0: 0, y0: 0, x1: 3, y1: 2 });
});

test('an L of cells is two tiles, and they meet along an edge', () => {
  // 3x3 with the north-east corner missing.
  const walkable = (x, y) => !(y === 0 && x === 2);
  const rects = greedyRects(3, 3, walkable, allOpen);
  assert.equal(rects.length, 2);
  const gate = tileGate(rects[0], rects[1], allOpen);
  assert.ok(gate, 'the two halves of an L share an open edge');
  assert.equal(gate.axis, 'x');
  assert.equal(gate.span, 2, 'the whole of the edge they share is open');
});

test('a tile never spans a wall, even inside one room', () => {
  // Every cell walkable, but nothing may cross the seam at x = 1|2. A tile
  // that ignored the edges would swallow the lot; the mesh cuts it in two.
  const open = { right: (x) => x !== 1, down: () => true };
  const rects = greedyRects(4, 2, () => true, open);
  assert.equal(rects.length, 2);
  for (const r of rects) assert.ok(r.x0 > 1 || r.x1 <= 1, 'no tile crosses the seam');
  assert.equal(tileGate(rects[0], rects[1], open), null,
    'and there is no gate through a wall');
});

test('a gate sits in the open run of a shared edge, not in its middle', () => {
  // Two rows, joined only at x = 3.
  const open = { right: () => true, down: (x) => x === 3 };
  const rects = greedyRects(6, 2, () => true, open);
  assert.equal(rects.length, 2);
  const gate = tileGate(rects[0], rects[1], open);
  assert.equal(gate.axis, 'y');
  assert.equal(gate.span, 1);
  assert.equal(gate.mid, 3.5, 'the middle of the one cell you can walk through');
});

// A room shaped like an L: an 8x2 arm running east, and a 2x4 arm running
// south off its west end.
function lRoom() {
  const s = createState(14, 10);
  const f = s.floors[0];
  for (let y = 1; y <= 2; y++) for (let x = 1; x <= 8; x++) setTile(f, x, y, true);
  for (let y = 3; y <= 6; y++) for (let x = 1; x <= 2; x++) setTile(f, x, y, true);
  for (const c of f.cells) if (c) c.room = 'Hall';
  return s;
}

test('an L-shaped lattice room meshes into tiles joined by a gate', () => {
  const s = lRoom();
  const fr = floorRooms(s, 0);
  const mesh = meshFloor(s, 0, fr);
  const hall = roomNamed(fr, 'Hall');
  const tiles = tilesOf(mesh, hall.id);
  assert.ok(tiles.length >= 2, 'an L is not one rectangle');
  assert.equal(mesh.gates.length, tiles.length - 1,
    'a room of n tiles in a chain has n-1 gates');
  for (const g of mesh.gates) assert.equal(g.room, hall.id);
  // The tiles cover the room and nothing else: 16 cells of arm plus 8 of leg.
  assert.equal(walkableArea(mesh), 24 * CELL * CELL);
});

test('two rooms either side of a wall never share a tile', () => {
  const s = createState(12, 8);
  const f = s.floors[0];
  for (let y = 1; y <= 4; y++) for (let x = 1; x <= 9; x++) setTile(f, x, y, true);
  for (let y = 1; y <= 4; y++) f.edgesV[edgeVIdx(f, 5, y)] = EDGE_WALL;
  f.edgesV[edgeVIdx(f, 5, 2)] = EDGE_DOOR;
  const fr = floorRooms(s, 0);
  const mesh = meshFloor(s, 0, fr);
  assert.equal(fr.rooms.length, 2);
  for (const t of mesh.tiles) {
    assert.ok(t.x0 >= 5 * CELL || t.x1 <= 5 * CELL, 'no tile crosses the partition');
  }
  // A doorway is not a seam in the mesh: each room is still one rectangle.
  assert.equal(mesh.tiles.length, 2);
  assert.equal(mesh.gates.length, 0);
});

test('a C-shaped region does not get a tile through the wall it wraps', () => {
  // A corridor that runs east, turns south, and comes back west under itself,
  // with a wall between the two arms. `floodRegion` calls it one room; a
  // rectangle spanning the wall would be a hole punched through the building.
  const s = createState(14, 10);
  const f = s.floors[0];
  for (let x = 1; x <= 8; x++) { setTile(f, x, 1, true); setTile(f, x, 3, true); }
  for (let y = 1; y <= 3; y++) setTile(f, 8, y, true);
  for (let x = 1; x <= 7; x++) f.edgesH[edgeHIdx(f, x, 2)] = EDGE_WALL;
  for (const c of f.cells) if (c) c.room = 'Hall';
  const fr = floorRooms(s, 0);
  assert.equal(fr.rooms.length, 1, 'it is one region');
  const mesh = meshFloor(s, 0, fr);
  for (const t of mesh.tiles) {
    const spansWall = t.z0 < 2 * CELL && t.z1 > 2 * CELL && t.x0 < 7 * CELL;
    assert.ok(!spansWall, 'no tile crosses the wall the C wraps around');
  }
});

test('a polygon room is sampled onto its own lattice', () => {
  const s = createState(20, 20);
  addShape(s, 0, [
    { x: 10, z: 10 }, { x: 40, z: 10 }, { x: 40, z: 30 }, { x: 10, z: 30 },
  ], { name: 'Studio' });
  const fr = floorRooms(s, 0);
  const mesh = meshFloor(s, 0, fr);
  const studio = roomNamed(fr, 'Studio');
  const tiles = tilesOf(mesh, studio.id);
  assert.equal(tiles.length, 1, 'a rectangle is one tile however it is drawn');
  // Inscribed on a 2ft lattice, so the tile is inside the room and within one
  // sample of its edges.
  assert.ok(tiles[0].x0 >= 10 - MESH_STEP && tiles[0].x1 <= 40 + MESH_STEP);
  assert.ok(studio.area - walkableArea(mesh) < 4 * MESH_STEP * 40);
});

test('tileFor finds the tile under a point, and the nearest one off it', () => {
  const s = lRoom();
  const fr = floorRooms(s, 0);
  const mesh = meshFloor(s, 0, fr);
  const hall = roomNamed(fr, 'Hall');
  const inside = tileFor(mesh, hall.id, 6 * CELL, 1.5 * CELL);
  assert.ok(inside.inside);
  const outside = tileFor(mesh, hall.id, 40 * CELL, 40 * CELL);
  assert.ok(outside && !outside.inside, 'a point off the mesh still gets an answer');
  assert.equal(tileFor(mesh, 'r0:g999', 0, 0), null, 'and an unknown room gets none');
});

test('the sample school meshes every room it has', () => {
  const s = buildSampleSchool();
  for (let i = 0; i < s.floors.length; i++) {
    const fr = floorRooms(s, i);
    const mesh = meshFloor(s, i, fr);
    for (const room of fr.rooms) {
      assert.ok(tilesOf(mesh, room.id).length >= 1,
        `${room.id} has somewhere to stand`);
    }
    for (const g of mesh.gates) {
      assert.ok(mesh.tiles.some((t) => t.id === g.a));
      assert.ok(mesh.tiles.some((t) => t.id === g.b));
      assert.notEqual(g.a, g.b);
    }
  }
});
