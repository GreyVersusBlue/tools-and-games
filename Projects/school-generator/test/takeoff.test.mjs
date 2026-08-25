// The bill of materials: walls by the foot, doors by the leaf, glass by the
// bay, furniture by the row, and the CSV that carries them. Counted by hand on
// a shoebox, then checked for self-consistency on the sample school.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createState, setTile, edgeHIdx, edgeVIdx, addFloor, CELL, WALL_H, FLOOR_H,
  EDGE_WALL, EDGE_DOOR, EDGE_DOOR2, EDGE_GLASS, EDGE_WINDOW,
} from '../js/grid.js';
import { WALL_T_INT, WALL_T_EXT } from '../js/walls.js';
import { addShape } from '../js/shapes.js';
import { addProp } from '../js/props.js';
import { addStair } from '../js/stairs.js';
import { buildSampleSchool } from '../js/sample.js';
import { catalogEntry } from '../js/catalog.js';
import { floorTakeoff, takeoff, takeoffCSV, csvRows } from '../js/takeoff.js';

// A 4×4-cell room inside a 12×10 lot: 16 ft of wall on each side, all of it
// exterior because there is nothing on the far side of any of it.
function shoebox() {
  const s = createState(12, 10);
  const f = s.floors[0];
  for (let y = 1; y <= 4; y++) for (let x = 1; x <= 4; x++) setTile(f, x, y, true);
  for (let x = 1; x <= 4; x++) {
    f.edgesH[edgeHIdx(f, x, 1)] = EDGE_WALL;
    f.edgesH[edgeHIdx(f, x, 5)] = EDGE_WALL;
  }
  for (let y = 1; y <= 4; y++) {
    f.edgesV[edgeVIdx(f, 1, y)] = EDGE_WALL;
    f.edgesV[edgeVIdx(f, 5, y)] = EDGE_WALL;
  }
  for (let y = 1; y <= 4; y++) for (let x = 1; x <= 4; x++) f.cells[y * f.w + x].room = 'Room 101';
  return s;
}

const row = (rows, key) => rows.find((r) => r.key === key) || null;

test('a shoebox is four walls of sixteen feet, all exterior', () => {
  const t = floorTakeoff(shoebox(), 0);
  assert.equal(t.walls.length, 1);
  const w = t.walls[0];
  assert.equal(w.kind, 'wall');
  assert.ok(w.exterior);
  assert.equal(w.thickness, WALL_T_EXT);
  assert.equal(w.lf, 4 * 4 * CELL);
  // One storey, so the wall is the 10ft wall height rather than floor-to-floor.
  assert.equal(t.height, WALL_H);
  assert.equal(w.area, w.lf * WALL_H);
  assert.equal(t.slab, 16 * CELL * CELL);
});

test('a partition between two rooms is interior, and thinner for it', () => {
  const s = createState(14, 10);
  const f = s.floors[0];
  for (let y = 1; y <= 4; y++) for (let x = 1; x <= 9; x++) setTile(f, x, y, true);
  for (let x = 1; x <= 9; x++) {
    f.edgesH[edgeHIdx(f, x, 1)] = EDGE_WALL;
    f.edgesH[edgeHIdx(f, x, 5)] = EDGE_WALL;
  }
  for (let y = 1; y <= 4; y++) {
    f.edgesV[edgeVIdx(f, 1, y)] = EDGE_WALL;
    f.edgesV[edgeVIdx(f, 10, y)] = EDGE_WALL;
    f.edgesV[edgeVIdx(f, 5, y)] = EDGE_WALL;
  }
  const t = floorTakeoff(s, 0);
  const int = row(t.walls, 'wall:int');
  const ext = row(t.walls, 'wall:ext');
  assert.equal(int.thickness, WALL_T_INT);
  assert.equal(int.lf, 4 * CELL);
  assert.equal(ext.thickness, WALL_T_EXT);
  assert.equal(ext.lf, (9 + 9 + 4 + 4) * CELL);
});

test('a doorway comes out of the wall run it is cut in', () => {
  const plain = floorTakeoff(shoebox(), 0);
  const s = shoebox();
  s.floors[0].edgesV[edgeVIdx(s.floors[0], 1, 2)] = EDGE_DOOR2;
  const holed = floorTakeoff(s, 0);
  // A double door fills its whole cell, so exactly one cell of wall goes.
  assert.equal(plain.walls[0].lf - holed.walls[0].lf, CELL);
  assert.equal(holed.doors, 1);
  assert.equal(holed.openings[0].leaves, 2);
});

test('doors and windows are grouped by kind, width and leaf count', () => {
  const s = shoebox();
  const f = s.floors[0];
  f.edgesV[edgeVIdx(f, 1, 2)] = EDGE_DOOR;
  f.edgesV[edgeVIdx(f, 1, 3)] = EDGE_DOOR;
  f.edgesV[edgeVIdx(f, 5, 2)] = EDGE_DOOR2;
  f.edgesH[edgeHIdx(f, 2, 1)] = EDGE_WINDOW;
  const t = floorTakeoff(s, 0);
  assert.equal(t.doors, 3);
  assert.equal(t.windows, 1);
  const singles = t.openings.find((o) => o.kind === 'door' && o.leaves === 1);
  assert.equal(singles.count, 2, 'two identical doors are one row of two');
  const window = t.openings.find((o) => o.kind === 'window');
  assert.equal(window.count, 1);
  assert.ok(window.area > 0 && window.area === window.w * window.h);
});

test('glass is measured as area and bought in bays', () => {
  const s = shoebox();
  const f = s.floors[0];
  for (let x = 1; x <= 4; x++) f.edgesH[edgeHIdx(f, x, 1)] = EDGE_GLASS;
  const t = floorTakeoff(s, 0);
  assert.equal(row(t.walls, 'glass:ext').lf, 4 * CELL);
  assert.equal(t.glazing, 4 * CELL * WALL_H);
  assert.equal(t.bays, 4, '16ft of curtain wall at a 4ft mullion bay');
});

test('paint covers both faces of a partition and one face of an exterior wall', () => {
  const t = floorTakeoff(shoebox(), 0);
  const ext = t.walls[0];
  assert.equal(t.paintArea, ext.area);
  assert.equal(t.facadeArea, ext.area);
});

test('furniture is counted by type, with its catalog row alongside', () => {
  const s = shoebox();
  for (let i = 0; i < 5; i++) addProp(s, 'student-desk', { x: 8 + i, z: 8, floor: 0 });
  addProp(s, 'teacher-desk', { x: 6, z: 12, floor: 0 });
  const t = floorTakeoff(s, 0);
  assert.equal(t.propCount, 6);
  const desks = t.props.find((p) => p.type === 'student-desk');
  assert.equal(desks.count, 5);
  assert.equal(desks.label, catalogEntry('student-desk').name);
  assert.equal(desks.category, catalogEntry('student-desk').category);
});

test('the floor finish schedule rides along, per storey and rolled up', () => {
  const t = takeoff(buildSampleSchool());
  assert.ok(t.floors[0].finishes.length > 1);
  const total = t.finishes.reduce((n, r) => n + r.sqft, 0);
  const perFloor = t.floors.reduce((n, f) =>
    n + f.finishes.reduce((m, r) => m + r.sqft, 0), 0);
  assert.ok(Math.abs(total - perFloor) < 1e-6);
});

test('every stair, ramp, lift and hole is one line item', () => {
  const s = shoebox();
  addFloor(s, 1);
  addStair(s, 0, { x: 10, z: 10, width: 4 });
  addStair(s, 0, { type: 'elevator', x: 30, z: 10 });
  addStair(s, 0, { type: 'opening', x: 30, z: 30 });
  const t = takeoff(s);
  assert.equal(t.links.length, 3);
  assert.equal(t.totals.stairs, 1);
  assert.equal(t.totals.elevators, 1);
  const stair = t.links.find((l) => l.type === 'stair');
  assert.ok(stair.steps > 0);
  assert.ok(stair.label.includes('risers'));
  assert.equal(stair.from, 0);
  assert.equal(stair.to, 1);
});

test('a pitched roof covers more than its own footprint', () => {
  const s = shoebox();
  const flat = takeoff(s).roof;
  assert.equal(flat.area, flat.footprint);
  s.roof = { style: 'gable', pitch: 12, facade: 'brick' };
  const pitched = takeoff(s).roof;
  assert.ok(pitched.pitched);
  assert.equal(pitched.footprint, flat.footprint);
  // 12:12 is 45°, so the sloped area is the footprint times √2.
  assert.ok(Math.abs(pitched.area - flat.footprint * Math.SQRT2) < 1e-6);
});

test('the site rolls up by surface, with its markings counted', () => {
  const t = takeoff(buildSampleSchool());
  assert.ok(t.site.regions > 10);
  assert.ok(t.site.sqft > 100000, 'twenty acres of school site');
  assert.equal(t.site.sqft, t.site.surfaces.reduce((n, r) => n + r.sqft, 0));
  assert.ok(t.site.markings.some((m) => m.count >= 1));
});

test('the totals are the storeys added up', () => {
  const t = takeoff(buildSampleSchool());
  assert.equal(t.totals.storeys, 2);
  assert.equal(t.totals.doors, t.floors.reduce((n, f) => n + f.doors, 0));
  assert.equal(t.totals.windows, t.floors.reduce((n, f) => n + f.windows, 0));
  assert.equal(t.totals.props, t.floors.reduce((n, f) => n + f.propCount, 0));
  assert.equal(t.totals.wallLf, t.totals.interiorLf + t.totals.exteriorLf);
  assert.ok(t.totals.slab > 0 && t.totals.glazing > 0);
  // A middle storey is walled floor-to-floor; the top one only to the ceiling.
  assert.equal(t.floors[0].height, FLOOR_H);
  assert.equal(t.floors[1].height, WALL_H);
});

test('furniture rolls up across storeys without losing a row', () => {
  const t = takeoff(buildSampleSchool());
  const perFloor = t.floors.reduce((n, f) => n + f.props.reduce((m, p) => m + p.count, 0), 0);
  assert.equal(t.props.reduce((n, p) => n + p.count, 0), perFloor);
});

test('the CSV escapes what it must and carries every section', () => {
  const csv = takeoffCSV(takeoff(buildSampleSchool()));
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'Section,Where,Item,Detail,Quantity,Unit');
  for (const section of ['Building', 'Walls', 'Finishes', 'Openings', 'Furniture', 'Vertical', 'Roof', 'Site']) {
    assert.ok(lines.some((l) => l.startsWith(`${section},`)), `no ${section} rows`);
  }
  // Anything with a comma in it is quoted, and a quote inside is doubled.
  assert.ok(lines.some((l) => l.includes('"')));
  assert.equal(csvRows([['a,b', 'c"d', 'e']]), '"a,b","c""d",e');
});

test('an empty design produces an empty takeoff rather than throwing', () => {
  const t = takeoff(createState(6, 6));
  assert.equal(t.totals.slab, 0);
  assert.equal(t.totals.wallLf, 0);
  assert.equal(t.links.length, 0);
  assert.equal(t.roof.footprint, 0);
  assert.ok(takeoffCSV(t).length > 0);
});

test('a polygon room contributes its own slab area', () => {
  const s = createState(20, 20);
  addShape(s, 0, [{ x: 0, z: 0 }, { x: 40, z: 0 }, { x: 40, z: 20 }, { x: 0, z: 20 }],
    { name: 'Room 101' });
  assert.equal(floorTakeoff(s, 0).slab, 800);
});
