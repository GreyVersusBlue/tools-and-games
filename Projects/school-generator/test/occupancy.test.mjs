// Occupant load: which use a name reads as, how many people that puts in a
// room, and how the storeys roll up. Pure arithmetic over a table, so this
// suite is close to exhaustive on the table and representative on the rest.
// Run `node --test test/*.mjs` from Projects/school-generator.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, setTile, edgeHIdx, edgeVIdx, EDGE_WALL, EDGE_DOOR, CELL } from '../js/grid.js';
import { addShape } from '../js/shapes.js';
import { buildSampleSchool } from '../js/sample.js';
import { buildNav } from '../js/navgraph.js';
import {
  USES, UNASSIGNED, MIN_OCCUPIABLE, classify, useEntry,
  roomOccupancy, floorOccupancy, buildingOccupancy, occupancyIndex,
} from '../js/occupancy.js';

// One named room of a given size, as the reader sees it.
const room = (name, area) => ({ id: 'r0:g0', floor: 0, name, area, rep: 'grid', x: 0, z: 0 });

test('every use row has a key, a label and a sane factor', () => {
  const keys = new Set();
  for (const u of USES) {
    assert.ok(u.key && !keys.has(u.key), `duplicate or missing key: ${u.key}`);
    keys.add(u.key);
    assert.ok(u.label.length > 0);
    assert.ok(u.factor >= 0 && u.factor <= 400);
    assert.ok(u.match instanceof RegExp);
    assert.ok(u.basis === 'net' || u.basis === 'gross');
    // A factor of zero is only for the spaces that carry other rooms' people.
    assert.equal(u.factor === 0, u.circulation === true);
  }
});

test('the names a school actually types land where they should', () => {
  const cases = [
    ['Room 101', 'classroom'], ['room 12', 'classroom'], ['Rm. 4', 'classroom'],
    ['203', 'classroom'], ['Homeroom', 'classroom'], ['Grade 3', 'classroom'],
    ['Main Hall', 'circulation'], ['Corridor B', 'circulation'],
    ['Stair Hall', 'circulation'], ['Lobby', 'circulation'],
    ['Girls Restroom', 'restroom'], ['Boys Toilet', 'restroom'],
    ['Office', 'office'], ['Main Office', 'office'], ['Nurse', 'office'],
    ['Conference', 'office'], ['Staff Workroom', 'office'],
    ['Science Lab', 'lab'], ['Wood Shop', 'lab'], ['Art Studio', 'lab'],
    ['Cafeteria', 'assembly-tables'], ['Dining Commons', 'assembly-tables'],
    ['Auditorium', 'assembly-seats'], ['Lecture Hall', 'assembly-seats'],
    ['Gymnasium', 'gym'], ['Band Room', 'stage'],
    ['Library', 'library'], ['Media Center', 'library'], ['Learning Commons', 'library'],
    ['Kitchen', 'kitchen'], ['Storeroom', 'storage'], ['Custodian', 'storage'],
    ['Mechanical', 'storage'], ['Boys Locker Room', 'locker'],
  ];
  for (const [name, use] of cases) assert.equal(classify(name), use, name);
});

test('a name nothing matches, and no name at all, are both unassigned', () => {
  for (const name of ['Zorb', '', null, undefined, '   ']) {
    assert.equal(classify(name), null);
    assert.equal(roomOccupancy(room(name, 400)).use, UNASSIGNED.key);
  }
  assert.ok(roomOccupancy(room(null, 400)).guess);
  assert.ok(!roomOccupancy(room('Room 9', 400)).guess);
});

test('classification is case- and whitespace-insensitive', () => {
  assert.equal(classify('  CAFETERIA  '), 'assembly-tables');
  assert.equal(classify('sCiEnCe LaB'), 'lab');
});

test('occupant load is area over factor, rounded up', () => {
  const r = roomOccupancy(room('Room 101', 672));
  assert.equal(r.factor, 20);
  assert.equal(r.occ, 34);           // 33.6 people is 34 people
  assert.equal(r.use, 'classroom');
  assert.equal(r.basis, 'net');
});

test('circulation carries other rooms\' people rather than its own', () => {
  const hall = roomOccupancy(room('Main Hall', 2000));
  assert.equal(hall.occ, 0);
  assert.ok(hall.circulation);
  const loo = roomOccupancy(room('Restroom', 200));
  assert.equal(loo.occ, 0);
});

test('a tiny unnamed pocket gets no occupants at all', () => {
  const r = roomOccupancy(room(null, MIN_OCCUPIABLE - 1));
  assert.ok(r.tiny);
  assert.equal(r.occ, 0);
  // ...but a tiny *named* room is somebody's decision, and is counted.
  assert.ok(roomOccupancy(room('Room 1', MIN_OCCUPIABLE - 1)).occ > 0);
});

test('an explicit use overrides the name', () => {
  const r = roomOccupancy(room('Room 101', 600), { use: 'gym' });
  assert.equal(r.use, 'gym');
  assert.equal(r.occ, 12);
});

test('useEntry falls back rather than throwing', () => {
  assert.equal(useEntry('classroom').factor, 20);
  assert.equal(useEntry('nonsense').key, UNASSIGNED.key);
  assert.equal(useEntry(undefined).key, UNASSIGNED.key);
});

// A tiny two-room building: one classroom, one corridor.
function twoRooms() {
  const s = createState(12, 8);
  const f = s.floors[0];
  for (let y = 1; y <= 4; y++) for (let x = 1; x <= 9; x++) setTile(f, x, y, true);
  for (let x = 1; x <= 9; x++) { f.edgesH[edgeHIdx(f, x, 1)] = EDGE_WALL; f.edgesH[edgeHIdx(f, x, 5)] = EDGE_WALL; }
  for (let y = 1; y <= 4; y++) { f.edgesV[edgeVIdx(f, 1, y)] = EDGE_WALL; f.edgesV[edgeVIdx(f, 10, y)] = EDGE_WALL; }
  for (let y = 1; y <= 4; y++) f.edgesV[edgeVIdx(f, 5, y)] = EDGE_WALL;
  f.edgesV[edgeVIdx(f, 5, 2)] = EDGE_DOOR;
  for (let y = 1; y <= 4; y++) for (let x = 1; x <= 4; x++) f.cells[y * f.w + x].room = 'Room 101';
  for (let y = 1; y <= 4; y++) for (let x = 6; x <= 9; x++) f.cells[y * f.w + x].room = 'Corridor';
  return s;
}

test('a floor rolls its rooms up, and the corridor adds nothing', () => {
  const fo = floorOccupancy(twoRooms(), 0);
  assert.equal(fo.rooms.length, 2);
  const cls = fo.rooms.find((r) => r.name === 'Room 101');
  const hall = fo.rooms.find((r) => r.name === 'Corridor');
  assert.equal(cls.area, 16 * CELL * CELL);
  assert.equal(cls.occ, Math.ceil(cls.area / 20));
  assert.equal(hall.occ, 0);
  assert.equal(fo.occ, cls.occ);
});

test('a polygon room is priced exactly like a lattice one', () => {
  const s = createState(20, 20);
  addShape(s, 0, [{ x: 0, z: 0 }, { x: 40, z: 0 }, { x: 40, z: 20 }, { x: 0, z: 20 }],
    { name: 'Science Lab' });
  const fo = floorOccupancy(s, 0);
  assert.equal(fo.rooms.length, 1);
  assert.equal(fo.rooms[0].rep, 'shape');
  assert.equal(fo.rooms[0].use, 'lab');
  assert.equal(fo.rooms[0].occ, Math.ceil(800 / 50));
});

test('the building total is the sum of its storeys, and `upper` skips the ground', () => {
  const b = buildingOccupancy(buildSampleSchool());
  assert.equal(b.floors.length, 2);
  assert.equal(b.total, b.floors.reduce((n, f) => n + f.occ, 0));
  assert.equal(b.upper, b.floors[1].occ);
  assert.ok(b.total > 100, 'a two-storey school holds a few hundred people');
  assert.equal(b.rooms.length, b.floors.flatMap((f) => f.rooms).length);
});

test('by-use tallies cover every room and nothing twice', () => {
  const b = buildingOccupancy(buildSampleSchool());
  assert.equal(b.byUse.reduce((n, u) => n + u.rooms, 0), b.rooms.length);
  assert.equal(b.byUse.reduce((n, u) => n + u.occ, 0), b.total);
  // Sorted worst-first so a panel can print the top of it.
  for (let i = 1; i < b.byUse.length; i++) assert.ok(b.byUse[i - 1].occ >= b.byUse[i].occ);
});

test('the sample school names every room it draws', () => {
  const b = buildingOccupancy(buildSampleSchool());
  assert.equal(b.unnamed, 0);
  assert.equal(b.named, b.rooms.length);
});

test('a shared nav graph gives the same answer as building one per call', () => {
  const s = buildSampleSchool();
  const nav = buildNav(s);
  assert.deepEqual(buildingOccupancy(s, { nav }).total, buildingOccupancy(s).total);
});

test('the index finds a room by the id the graph calls it', () => {
  const s = buildSampleSchool();
  const nav = buildNav(s);
  const b = buildingOccupancy(s, { nav });
  const idx = occupancyIndex(b);
  for (const r of nav.rooms) assert.ok(idx.has(r.id), `no load for ${r.id}`);
});

test('an empty design has no occupants and does not throw', () => {
  const b = buildingOccupancy(createState(8, 8));
  assert.equal(b.total, 0);
  assert.equal(b.rooms.length, 0);
  assert.equal(b.byUse.length, 0);
});
