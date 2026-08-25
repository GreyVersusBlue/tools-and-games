// Auto-furnishing: choosing a layout from a room's name, aiming it at the
// room, and dropping what doesn't fit. The three jobs in the module header,
// one section each.

import test from 'node:test';
import assert from 'node:assert/strict';

import { CELL, createState, setTile, edgeHIdx, edgeVIdx, EDGE_WALL, EDGE_DOOR } from '../js/grid.js';
import { addShape, addOpening, LEAF_SINGLE } from '../js/shapes.js';
import { buildSampleSchool } from '../js/sample.js';
import { floorRooms } from '../js/navgraph.js';
import { catalogEntry } from '../js/catalog.js';
import { templateByKey } from '../js/templates.js';
import {
  ROOM_LAYOUTS, TILEABLE,
  templateForRoom, roomGeometry, furnishRoom, furnishPlan,
} from '../js/autofurnish.js';

// A single walled grid room with one door on the given side.
function oneRoom(x0, y0, x1, y1, name, door = 'south') {
  const s = createState(30, 30);
  const f = s.floors[0];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setTile(f, x, y, true);
  for (let x = x0; x <= x1; x++) {
    f.edgesH[edgeHIdx(f, x, y0)] = EDGE_WALL;
    f.edgesH[edgeHIdx(f, x, y1 + 1)] = EDGE_WALL;
  }
  for (let y = y0; y <= y1; y++) {
    f.edgesV[edgeVIdx(f, x0, y)] = EDGE_WALL;
    f.edgesV[edgeVIdx(f, x1 + 1, y)] = EDGE_WALL;
  }
  const mx = Math.floor((x0 + x1) / 2), my = Math.floor((y0 + y1) / 2);
  if (door === 'south') f.edgesH[edgeHIdx(f, mx, y1 + 1)] = EDGE_DOOR;
  if (door === 'north') f.edgesH[edgeHIdx(f, mx, y0)] = EDGE_DOOR;
  if (door === 'west') f.edgesV[edgeVIdx(f, x0, my)] = EDGE_DOOR;
  if (door === 'east') f.edgesV[edgeVIdx(f, x1 + 1, my)] = EDGE_DOOR;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) f.cells[y * f.w + x].room = name;
  }
  return s;
}

const roomOf = (s, i = 0) => floorRooms(s, i).rooms[0];

// ---------- choose ----------

test('every layout row names a template that exists', () => {
  for (const row of ROOM_LAYOUTS) {
    assert.ok(templateByKey(row.tpl), `${row.tpl} is not a template`);
  }
  for (const key of TILEABLE) assert.ok(templateByKey(key), `${key} is not a template`);
});

test('the names a school actually uses reach the right layout', () => {
  const cases = {
    'Room 104': 'classroom', 'Rm. 12': 'classroom', 'Homeroom': 'classroom',
    'Science Lab 2': 'science-lab', 'Chemistry': 'science-lab', 'Makerspace': 'science-lab',
    'Computer Lab': 'computer-lab-row', 'Gymnasium': 'gym-court',
    'Cafeteria': 'cafeteria-block', 'Dining Commons': 'cafeteria-block',
    'Library': 'library-aisle', 'Learning Commons': 'library-aisle', 'Media Center': 'library-aisle',
    'Band Room': 'music-room', 'Main Office': 'front-office', 'Health Office': 'front-office',
    "Girls Restroom": 'restroom', 'Kindergarten': 'kindergarten-corner',
    'Main Hall': 'locker-hallway', 'Storeroom': 'lighting-bay', 'Mechanical': 'lighting-bay',
  };
  for (const [name, tpl] of Object.entries(cases)) {
    assert.equal(templateForRoom(name), tpl, `${name} chose the wrong layout`);
  }
});

test('an unnamed or unrecognised room gets no layout rather than a guessed one', () => {
  assert.equal(templateForRoom(null), null);
  assert.equal(templateForRoom(''), null);
  assert.equal(templateForRoom('Zamboni Bay'), null);
});

test('the classroom row sits below the traps that contain its words', () => {
  // "Storeroom" and "Workroom" both contain "room"; a bare room *number* is
  // what a classroom actually matches on.
  assert.notEqual(templateForRoom('Storeroom'), 'classroom');
  assert.notEqual(templateForRoom('Staff Workroom'), 'classroom');
  assert.equal(templateForRoom('Room 7'), 'classroom');
});

// ---------- shape ----------

test('a grid room reports its own cells, box and doors', () => {
  const s = oneRoom(4, 4, 10, 9, 'Room 101', 'south');
  const geo = roomGeometry(s, 0, roomOf(s));
  assert.equal(geo.rep, 'grid');
  assert.deepEqual(geo.box, { x0: 16, z0: 16, x1: 44, z1: 40 });
  assert.equal(geo.inside(20, 20), true);
  assert.equal(geo.inside(60, 20), false, 'outside the room is outside');
  assert.equal(geo.doors.length, 1);
  assert.ok(geo.doors[0].z > 36, 'the door is on the south wall');
});

test('a polygon room reports its ring and its openings', () => {
  const s = createState(30, 30);
  const shape = addShape(s, 0, [
    { x: 20, z: 20 }, { x: 60, z: 20 }, { x: 60, z: 52 }, { x: 20, z: 52 },
  ], { name: 'Learning Commons' });
  addOpening(shape, 0, 2, 0.5, null, { leaf: LEAF_SINGLE });
  const geo = roomGeometry(s, 0, roomOf(s));
  assert.equal(geo.rep, 'shape');
  assert.equal(geo.inside(40, 36), true);
  assert.equal(geo.inside(4, 4), false);
  assert.equal(geo.doors.length, 1);
});

test('a flood that would leak through a wall does not', () => {
  // Two rooms side by side with a solid wall between them: the geometry of
  // one must not include the other.
  const s = oneRoom(2, 2, 6, 6, 'Room 101', 'south');
  const f = s.floors[0];
  for (let y = 2; y <= 6; y++) setTile(f, 8, y, true);
  for (let y = 2; y <= 6; y++) f.edgesV[edgeVIdx(f, 8, y)] = EDGE_WALL;
  const geo = roomGeometry(s, 0, roomOf(s));
  assert.equal(geo.inside(8.5 * CELL, 4.5 * CELL), false);
});

// ---------- aim ----------

test('the layout turns its back to the door', () => {
  // A classroom's front is the whiteboard wall; you should walk in behind the
  // class. So a door on the south wall puts the board on the north one.
  const south = oneRoom(4, 4, 11, 10, 'Room 101', 'south');
  const north = oneRoom(4, 4, 11, 10, 'Room 101', 'north');
  const a = furnishRoom(south, 0, roomOf(south));
  const b = furnishRoom(north, 0, roomOf(north));
  const boardOf = (r) => r.placements.find((p) => p.type === 'whiteboard');
  const midZ = (28 + 44) / 2;
  assert.ok(boardOf(a).z < midZ, 'door south → board on the north wall');
  assert.ok(boardOf(b).z > midZ, 'door north → board on the south wall');
});

test('a long thin room takes the layout the long way round', () => {
  const wide = oneRoom(2, 6, 14, 11, 'Room 101', 'south');   // 52ft x 24ft
  const tall = oneRoom(6, 2, 11, 14, 'Room 101', 'west');    // 24ft x 52ft
  const a = furnishRoom(wide, 0, roomOf(wide));
  const b = furnishRoom(tall, 0, roomOf(tall));
  const horizontal = (r) => Math.abs(Math.cos(r.rotationY)) > 0.5;
  assert.ok(horizontal(a) !== horizontal(b), 'the two rooms should not take the same turn');
});

test('an explicit rotation overrides the choice', () => {
  const s = oneRoom(4, 4, 11, 10, 'Room 101', 'south');
  const r = furnishRoom(s, 0, roomOf(s), { rotationY: Math.PI / 2 });
  assert.equal(r.rotationY, Math.PI / 2);
});

// ---------- cull ----------

test('a template too big for the room loses pieces rather than overflowing', () => {
  const big = oneRoom(2, 2, 11, 10, 'Room 101');    // 40 x 36 ft
  const small = oneRoom(2, 2, 6, 5, 'Room 101');    // 20 x 16 ft
  const a = furnishRoom(big, 0, roomOf(big));
  const b = furnishRoom(small, 0, roomOf(small));
  assert.ok(b.placements.length < a.placements.length);
  assert.ok(b.dropped > 0, 'the small room should have dropped stamps');
  const geo = roomGeometry(small, 0, roomOf(small));
  for (const p of b.placements) {
    assert.ok(geo.inside(p.x, p.z), `${p.type} landed outside the room`);
  }
});

test('a floor-standing prop keeps its whole footprint inside the room', () => {
  const s = oneRoom(2, 2, 8, 7, 'Room 101');
  const r = furnishRoom(s, 0, roomOf(s));
  const geo = roomGeometry(s, 0, roomOf(s));
  for (const p of r.placements) {
    const e = catalogEntry(p.type);
    if (!e || e.mount !== 'floor') continue;
    const c = Math.cos(p.rotationY), sn = Math.sin(p.rotationY);
    const hw = e.w / 2, hd = e.d / 2;
    for (const [ox, oz] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) {
      assert.ok(geo.inside(p.x + ox * c + oz * sn, p.z - ox * sn + oz * c),
        `${p.type} has a corner in the wall`);
    }
  }
});

test('a wall-mounted piece is allowed to sit against the wall', () => {
  const s = oneRoom(4, 4, 11, 10, 'Room 101');
  const r = furnishRoom(s, 0, roomOf(s));
  const board = r.placements.find((p) => p.type === 'whiteboard');
  assert.ok(board, 'the whiteboard should survive the cull');
  assert.equal(board.mount, 'wall');
});

test('a tiling layout fills a big room and a plain one does not', () => {
  const hall = oneRoom(2, 2, 21, 17, 'Cafeteria');       // 80 x 64 ft
  const room = oneRoom(2, 2, 21, 17, 'Room 101');
  const a = furnishRoom(hall, 0, roomOf(hall));
  const b = furnishRoom(room, 0, roomOf(room));
  const tables = a.placements.filter((p) => p.type === 'table-cafeteria').length;
  assert.ok(tables > 3, `a 5,000 ft² cafeteria should tile: got ${tables} tables`);
  assert.equal(b.placements.filter((p) => p.type === 'whiteboard').length, 1,
    'a classroom in a big room is still one classroom');
});

test('a tiled layout does not stack two of the same prop in one spot', () => {
  const hall = oneRoom(2, 2, 21, 17, 'Library');
  const r = furnishRoom(hall, 0, roomOf(hall));
  const seen = new Set();
  for (const p of r.placements) {
    const key = `${p.type}:${p.x.toFixed(2)}:${p.z.toFixed(2)}`;
    assert.ok(!seen.has(key), `two ${p.type} in the same place`);
    seen.add(key);
  }
});

test('a room with no name and a room with no layout both come back empty', () => {
  const s = oneRoom(4, 4, 11, 10, 'Zamboni Bay');
  const r = furnishRoom(s, 0, roomOf(s));
  assert.equal(r.placements.length, 0);
  assert.equal(r.tpl, null);
  assert.match(r.reason, /no layout/);
});

test('an explicit template beats the name', () => {
  const s = oneRoom(2, 2, 13, 11, 'Room 101');
  const r = furnishRoom(s, 0, roomOf(s), { template: 'science-lab' });
  assert.equal(r.key, 'science-lab');
  assert.ok(r.placements.some((p) => p.type === 'bench-lab'));
});

// ---------- the whole building ----------

test('the sample school furnishes every room it has a name for', () => {
  const s = buildSampleSchool();
  const plan = furnishPlan(s);
  const names = plan.rooms.map((r) => r.name);
  for (const want of ['Room 101', 'Main Hall', 'Office', 'Media Center', 'Learning Commons']) {
    assert.ok(names.includes(want), `${want} was not furnished`);
  }
  assert.ok(plan.placements.length > 200);
  for (const p of plan.placements) {
    assert.ok(catalogEntry(p.type), `${p.type} is not in the catalog`);
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z));
    assert.ok(p.floor >= 0 && p.floor < s.floors.length);
  }
});

test('furnishing can be limited to one storey', () => {
  const s = buildSampleSchool();
  const plan = furnishPlan(s, { floors: [1] });
  assert.ok(plan.rooms.length > 0);
  assert.ok(plan.rooms.every((r) => r.floor === 1));
});

test('the same building always furnishes the same way', () => {
  const s = buildSampleSchool();
  assert.deepEqual(furnishPlan(s).placements, furnishPlan(s).placements);
});
