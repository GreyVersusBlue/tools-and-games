// Egress and the accessible route: how far to the door, how wide the door is,
// how deep the dead end goes, and what a wheelchair can reach. Built on tiny
// hand-made buildings where the right answer can be paced out, plus the sample
// school as the one real design.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createState, setTile, edgeHIdx, edgeVIdx, addFloor,
  EDGE_WALL, EDGE_DOOR, EDGE_DOOR2, CELL,
} from '../js/grid.js';
import { addShape, addOpening, LEAF_SINGLE } from '../js/shapes.js';
import { addStair } from '../js/stairs.js';
import { buildSampleSchool } from '../js/sample.js';
import { buildNav, egressField, MIN_ACCESSIBLE_W, clearWidth } from '../js/navgraph.js';
import { buildingOccupancy } from '../js/occupancy.js';
import {
  egressAnalysis, accessibleAnalysis, requiredExits, requiredWidth,
  roomSamples, farthestFrom,
  TRAVEL_LIMIT, DEAD_END_LIMIT, LEVEL_IN_PER_OCC, STAIR_IN_PER_OCC, SINGLE_EXIT_OCC,
} from '../js/egress.js';

const has = (findings, code) => findings.some((f) => f.code === code);
const find = (findings, code) => findings.find((f) => f.code === code) || null;

// A corridor running east with rooms off it, and a door at the west end.
// `len` cells of corridor; the room hangs off the far end.
function corridorSchool({ len = 6, exit = true, doorKind = EDGE_DOOR2 } = {}) {
  const s = createState(Math.max(12, len + 6), 10);
  const f = s.floors[0];
  // corridor along row 4, x = 1..len
  for (let x = 1; x <= len; x++) setTile(f, x, 4, true);
  // a classroom above the east end
  for (let y = 1; y <= 3; y++) for (let x = len - 3; x <= len; x++) setTile(f, x, y, true);
  for (let x = 1; x <= len; x++) {
    f.edgesH[edgeHIdx(f, x, 4)] = EDGE_WALL;
    f.edgesH[edgeHIdx(f, x, 5)] = EDGE_WALL;
  }
  for (let x = len - 3; x <= len; x++) f.edgesH[edgeHIdx(f, x, 1)] = EDGE_WALL;
  for (let y = 1; y <= 3; y++) {
    f.edgesV[edgeVIdx(f, len - 3, y)] = EDGE_WALL;
    f.edgesV[edgeVIdx(f, len + 1, y)] = EDGE_WALL;
  }
  f.edgesV[edgeVIdx(f, 1, 4)] = EDGE_WALL;
  f.edgesV[edgeVIdx(f, len + 1, 4)] = EDGE_WALL;
  f.edgesH[edgeHIdx(f, len - 1, 4)] = EDGE_DOOR;      // classroom into the corridor
  if (exit) f.edgesV[edgeVIdx(f, 1, 4)] = doorKind;   // out at the west end
  for (let x = 1; x <= len; x++) f.cells[4 * f.w + x].room = 'Corridor';
  for (let y = 1; y <= 3; y++) {
    for (let x = len - 3; x <= len; x++) f.cells[y * f.w + x].room = 'Room 101';
  }
  return s;
}

test('the code tables are the numbers the comments claim', () => {
  assert.equal(requiredExits(1), 1);
  assert.equal(requiredExits(SINGLE_EXIT_OCC), 1);
  assert.equal(requiredExits(SINGLE_EXIT_OCC + 1), 2);
  assert.equal(requiredExits(501), 3);
  assert.equal(requiredExits(1001), 4);
  // 0.2in each on the level, 0.3in on a stair, in feet.
  assert.equal(requiredWidth(60), (60 * LEVEL_IN_PER_OCC) / 12);
  assert.equal(requiredWidth(60, { stair: true }), (60 * STAIR_IN_PER_OCC) / 12);
  assert.ok(TRAVEL_LIMIT.sprinklered > TRAVEL_LIMIT.plain);
  assert.ok(DEAD_END_LIMIT.sprinklered > DEAD_END_LIMIT.plain);
});

test('a sealed building fails on the first finding and stops', () => {
  const r = egressAnalysis(corridorSchool({ exit: false }));
  assert.equal(r.exits.length, 0);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].level, 'fail');
  assert.equal(r.findings[0].code, 'no-exits');
});

test('travel distance is the walk from the far corner, not from the hub', () => {
  const s = corridorSchool({ len: 8 });
  const r = egressAnalysis(s);
  const cls = r.rooms.find((x) => x.name === 'Room 101');
  assert.ok(cls.reached);
  assert.ok(cls.reach > 0, 'the far corner is somewhere else from the hub');
  assert.ok(Math.abs(cls.travel - (cls.hub + cls.reach)) < 1e-9);
  assert.ok(cls.travel > cls.hub);
});

test('a long enough corridor puts the classroom past the travel limit', () => {
  const short = egressAnalysis(corridorSchool({ len: 6 }));
  assert.ok(!short.rooms.some((r) => r.over), 'a short school is fine');
  assert.ok(has(short.findings, 'travel-distance'));
  assert.equal(find(short.findings, 'travel-distance').level, 'ok');

  const long = egressAnalysis(corridorSchool({ len: 70 }));
  assert.ok(long.rooms.some((r) => r.over));
  assert.equal(find(long.findings, 'travel-distance').level, 'fail');
});

test('an unsprinklered building is held to the tighter limits', () => {
  const s = corridorSchool({ len: 55 });
  const wet = egressAnalysis(s, { sprinklered: true });
  const dry = egressAnalysis(s, { sprinklered: false });
  assert.equal(wet.limits.travel, TRAVEL_LIMIT.sprinklered);
  assert.equal(dry.limits.travel, TRAVEL_LIMIT.plain);
  assert.ok(dry.rooms.filter((r) => r.over).length >= wet.rooms.filter((r) => r.over).length);
});

test('a room with no way out at all is reported as stranded', () => {
  const s = corridorSchool({ len: 6 });
  const f = s.floors[0];
  // A sealed room in the corner: floor, walls, no door.
  for (let x = 1; x <= 2; x++) setTile(f, x, 7, true);
  for (let x = 1; x <= 2; x++) {
    f.edgesH[edgeHIdx(f, x, 7)] = EDGE_WALL;
    f.edgesH[edgeHIdx(f, x, 8)] = EDGE_WALL;
    f.cells[7 * f.w + x].room = 'Room 102';
  }
  f.edgesV[edgeVIdx(f, 1, 7)] = EDGE_WALL;
  f.edgesV[edgeVIdx(f, 3, 7)] = EDGE_WALL;
  const r = egressAnalysis(s);
  const sealed = r.rooms.find((x) => x.name === 'Room 102');
  assert.ok(!sealed.reached);
  assert.equal(sealed.travel, Infinity);
  assert.ok(has(r.findings, 'unreachable'));
  assert.equal(find(r.findings, 'unreachable').level, 'fail');
});

test('exit capacity is measured in clear width, not in doors', () => {
  const r = egressAnalysis(buildSampleSchool());
  for (const e of r.exits) {
    assert.ok(e.clear < e.w, 'a leaf standing in the opening costs clear width');
    assert.equal(e.capacity, Math.floor((e.clear * 12) / LEVEL_IN_PER_OCC));
  }
  assert.equal(r.summary.capacity, r.exits.reduce((n, e) => n + e.capacity, 0));
});

// One big room with one door onto the outside. 40ft square, so a classroom
// holds 80 and an auditorium holds 229 — enough to walk both sides of every
// occupant-load threshold with the same building.
function oneBigRoom(name) {
  const s = createState(30, 20);
  const f = s.floors[0];
  for (let y = 1; y <= 10; y++) for (let x = 1; x <= 10; x++) setTile(f, x, y, true);
  for (let x = 1; x <= 10; x++) { f.edgesH[edgeHIdx(f, x, 1)] = EDGE_WALL; f.edgesH[edgeHIdx(f, x, 11)] = EDGE_WALL; }
  for (let y = 1; y <= 10; y++) { f.edgesV[edgeVIdx(f, 1, y)] = EDGE_WALL; f.edgesV[edgeVIdx(f, 11, y)] = EDGE_WALL; }
  f.edgesV[edgeVIdx(f, 1, 5)] = EDGE_DOOR;
  for (let y = 1; y <= 10; y++) for (let x = 1; x <= 10; x++) f.cells[y * f.w + x].room = name;
  return s;
}

test('one door for a hall full of people is too few and too narrow', () => {
  const r = egressAnalysis(oneBigRoom('Auditorium'));
  assert.equal(r.exits.length, 1);
  assert.ok(r.summary.occupants > SINGLE_EXIT_OCC);
  assert.equal(r.summary.exitsRequired, 2);
  assert.ok(has(r.findings, 'exit-count'));
  // 32in of clear door carries 160 people at 0.2in each; this room holds more.
  assert.ok(r.summary.capacity < r.summary.occupants);
  assert.ok(has(r.findings, 'exit-capacity'));
});

test('a room over fifty occupants with one door wants a second one', () => {
  const r = egressAnalysis(oneBigRoom('Room 101'));
  const cls = r.rooms.find((x) => x.name === 'Room 101');
  assert.equal(cls.occ, 80);
  assert.ok(cls.needsTwo);
  // ...but one 3ft leaf is still wide enough for eighty people: door capacity
  // and door count are two different rules and only one of them is broken.
  assert.ok(!cls.narrow);
  assert.ok(has(r.findings, 'second-door'));
  assert.ok(!has(r.findings, 'door-width'));
});

test('a door too narrow for the crowd behind it is its own finding', () => {
  const r = egressAnalysis(oneBigRoom('Auditorium'));
  const hall = r.rooms.find((x) => x.name === 'Auditorium');
  assert.ok(hall.occ > 200, 'assembly seating is 7 ft² a head');
  assert.ok(hall.narrow, 'one 3ft door does not carry two hundred people');
  assert.ok(has(r.findings, 'door-width'));
});

test('a corridor with a way out at both ends is not a dead end', () => {
  const s = corridorSchool({ len: 10 });
  const f = s.floors[0];
  f.edgesV[edgeVIdx(f, 11, 4)] = EDGE_DOOR2;   // a second door at the east end
  const r = egressAnalysis(s);
  assert.equal(r.deadEnds.length, 0);
});

test('a corridor stub past the last door is a dead end, measured from it', () => {
  const s = corridorSchool({ len: 30 });
  const r = egressAnalysis(s);
  const dead = r.deadEnds.find((d) => d.name === 'Corridor');
  assert.ok(dead, 'the corridor runs on past the classroom door');
  assert.ok(dead.depth > DEAD_END_LIMIT.sprinklered);
  // ...and it is measured from the doorway that leads onward, so it can never
  // be longer than the corridor itself.
  assert.ok(dead.depth <= 30 * CELL);
});

test('room samples cover both representations, and the farthest point is inside', () => {
  const s = buildSampleSchool();
  const nav = buildNav(s);
  const samples = roomSamples(nav);
  for (const room of nav.rooms) {
    const pts = samples.get(room.id);
    assert.ok(pts && pts.length, `no samples for ${room.id}`);
    const far = farthestFrom(samples, room.id, room);
    assert.ok(far >= 0);
    // Nothing in a room is farther from its hub than the room's own diagonal.
    assert.ok(far <= Math.sqrt(room.area) * 8 + CELL);
  }
  assert.equal(farthestFrom(samples, 'nonsense', { x: 0, z: 0 }), 0);
});

test('stairs are priced at 0.3in a head and a lift carries nobody out', () => {
  const s = buildSampleSchool();
  const r = egressAnalysis(s);
  const stair = r.stairs.find((x) => x.type === 'stair');
  const lift = r.stairs.find((x) => x.type === 'elevator');
  assert.ok(stair.egress);
  assert.equal(stair.capacity, Math.floor((stair.w * 12) / STAIR_IN_PER_OCC));
  assert.ok(lift && !lift.egress && lift.capacity === 0);
  assert.equal(r.summary.stairCapacity, stair.capacity);
});

test('upper storeys with no stair at all is a failure, not a warning', () => {
  const s = corridorSchool({ len: 6 });
  addFloor(s, 1);
  const up = s.floors[1];
  for (let y = 1; y <= 3; y++) {
    for (let x = 1; x <= 4; x++) { setTile(up, x, y, true); up.cells[y * up.w + x].room = 'Room 201'; }
  }
  const r = egressAnalysis(s);
  assert.ok(r.summary.upper > 0);
  assert.ok(has(r.findings, 'no-stairs'));
});

// ---------- the accessible route ----------

test('the accessible graph drops stairs and keeps lifts', () => {
  const s = buildSampleSchool();
  const plain = buildNav(s);
  const access = buildNav(s, { accessible: true });
  assert.ok(access.accessible);
  assert.equal(access.minWidth, MIN_ACCESSIBLE_W);
  assert.ok(plain.links.length > access.links.length, 'the stair is gone');
  assert.ok(access.links.some((l) => l.type === 'elevator'), 'the lift is not');
  // Same rooms, same doorways — it is the same building.
  assert.equal(plain.rooms.length, access.rooms.length);
});

test('the sample school is reachable on wheels, because it has a lift', () => {
  const a = accessibleAnalysis(buildSampleSchool());
  assert.equal(a.stairsOnly.length, 0);
  assert.equal(a.summary.lifts, 1);
  assert.equal(a.summary.storeysReached, 2);
  assert.ok(has(a.findings, 'accessible-route'));
  assert.equal(find(a.findings, 'accessible-route').level, 'ok');
});

test('take the lift out and the upper floor is stairs-only', () => {
  const s = buildSampleSchool();
  s.links = s.links.filter((l) => l.type !== 'elevator');
  const a = accessibleAnalysis(s);
  assert.ok(a.stairsOnly.length > 0);
  assert.ok(a.stairsOnly.every((r) => r.floor > 0), 'the ground floor is still fine');
  assert.ok(has(a.findings, 'no-lift'));
  assert.equal(find(a.findings, 'stairs-only').level, 'fail');
});

test('a doorway under 3ft is not on the accessible route', () => {
  const s = createState(20, 12);
  const f = s.floors[0];
  for (let y = 1; y <= 4; y++) for (let x = 1; x <= 8; x++) setTile(f, x, y, true);
  for (let x = 1; x <= 8; x++) { f.edgesH[edgeHIdx(f, x, 1)] = EDGE_WALL; f.edgesH[edgeHIdx(f, x, 5)] = EDGE_WALL; }
  for (let y = 1; y <= 4; y++) { f.edgesV[edgeVIdx(f, 1, y)] = EDGE_WALL; f.edgesV[edgeVIdx(f, 9, y)] = EDGE_WALL; }
  f.edgesV[edgeVIdx(f, 1, 2)] = EDGE_DOOR2;
  for (let y = 1; y <= 4; y++) for (let x = 1; x <= 8; x++) f.cells[y * f.w + x].room = 'Room 101';
  // A polygon room hanging off the east wall, reached through a 2ft opening.
  const narrow = addShape(s, 0, [
    { x: 36, z: 4 }, { x: 56, z: 4 }, { x: 56, z: 20 }, { x: 36, z: 20 },
  ], { name: 'Room 102' });
  addOpening(narrow, 0, 3, 0.5, 2, { leaf: LEAF_SINGLE });
  const a = accessibleAnalysis(s);
  const room = a.rooms.find((r) => r.name === 'Room 102');
  assert.ok(room.walkable, 'you can walk through a 2ft gap');
  assert.ok(!room.rollable, 'you cannot roll through one');
  assert.ok(has(a.findings, 'narrow-doors'));
});

test('no exterior door wide enough is no accessible entrance', () => {
  const s = corridorSchool({ len: 6, doorKind: EDGE_DOOR });
  const wide = accessibleAnalysis(s);
  assert.equal(wide.summary.entrances, 1, 'a 3ft door is exactly wide enough');
  assert.equal(clearWidth(3) >= 32 / 12, true);
  const shut = accessibleAnalysis(corridorSchool({ len: 6, exit: false }));
  assert.equal(shut.summary.entrances, 0);
  assert.ok(has(shut.findings, 'no-accessible-entrance'));
});

test('a shared graph, occupancy and field give the same answers', () => {
  const s = buildSampleSchool();
  const nav = buildNav(s);
  const occupancy = buildingOccupancy(s, { nav });
  const field = egressField(nav, { metric: true });
  const a = egressAnalysis(s, { nav, occupancy, field });
  const b = egressAnalysis(s);
  assert.equal(a.summary.occupants, b.summary.occupants);
  assert.equal(Math.round(a.summary.worst.travel), Math.round(b.summary.worst.travel));
  assert.equal(a.deadEnds.length, b.deadEnds.length);
});

test('the sample school reports itself honestly', () => {
  const r = egressAnalysis(buildSampleSchool());
  assert.equal(r.summary.exits, 2);
  assert.ok(r.summary.occupants > 300);
  assert.equal(r.summary.unreachable, 0, 'nothing in it is sealed in');
  // Travel distances are sorted worst-first so a panel can print the top row.
  const reached = r.rooms.filter((x) => x.reached);
  for (let i = 1; i < reached.length; i++) {
    assert.ok(reached[i - 1].travel >= reached[i].travel);
  }
});

test('an empty design says nothing rather than throwing', () => {
  const r = egressAnalysis(createState(8, 8));
  assert.equal(r.rooms.length, 0);
  assert.equal(r.findings[0].code, 'no-exits');
  const a = accessibleAnalysis(createState(8, 8));
  assert.equal(a.rooms.length, 0);
  assert.ok(has(a.findings, 'no-accessible-entrance'));
});
