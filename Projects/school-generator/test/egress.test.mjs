// Egress and the accessible route: how far to the door, how wide the door is,
// how deep the dead end goes, and what a wheelchair can reach. Built on tiny
// hand-made buildings where the right answer can be paced out, plus the sample
// school as the one real design.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, addFloor, CELL } from '../js/grid.js';
import { setTile, edgeHIdx, edgeVIdx, EDGE_WALL, EDGE_DOOR, EDGE_DOOR2 } from '../js/lattice.js';
import { sheet } from './build.mjs';
import { addShape, addOpening, LEAF_SINGLE } from '../js/shapes.js';
import { addStair } from '../js/stairs.js';
import { buildSampleSchool } from '../js/sample.js';
import { buildNav, egressField } from '../js/navgraph.js';
import { MIN_ACCESSIBLE_W, clearWidth } from '../js/clearance.js';
import { buildingOccupancy } from '../js/occupancy.js';
import {
  egressAnalysis, accessibleAnalysis, dischargeAnalysis, requiredExits, requiredWidth,
  roomSamples, farthestFrom,
  TRAVEL_LIMIT, DEAD_END_LIMIT, LEVEL_IN_PER_OCC, STAIR_IN_PER_OCC, SINGLE_EXIT_OCC,
  DISCHARGE_NOTE,
} from '../js/egress.js';
import { addRegion } from '../js/site.js';
import { editionEntry, DEFAULT_EDITION } from '../js/codes.js';
import { ensureTerrain, raiseTerrain } from '../js/terrain.js';
import { ACCESSIBLE_GRADE, MAX_RAMP_GRADE } from '../js/sitemesh.js';

const has = (findings, code) => findings.some((f) => f.code === code);
const find = (findings, code) => findings.find((f) => f.code === code) || null;

// A corridor running east with rooms off it, and a door at the west end.
// `len` cells of corridor; the room hangs off the far end.
function corridorSchool({ len = 6, exit = true, doorKind = EDGE_DOOR2, extra = null } = {}) {
  const s = createState(Math.max(12, len + 6), 10);
  const f = sheet(s, 0);
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
  f.label(1, 4, len, 4, { name: 'Corridor' });
  f.label(len - 3, 1, len, 3, { name: 'Room 101' });
  if (extra) extra(f);
  f.bake();
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

test('travel distance is the walk from the far corner, over the mesh', () => {
  const s = corridorSchool({ len: 8 });
  const r = egressAnalysis(s);
  const cls = r.rooms.find((x) => x.name === 'Room 101');
  assert.ok(cls.reached);
  assert.ok(cls.reach > 0, 'the far corner is somewhere else from the hub');
  // Farther than the walk from the room's own node, because the far corner is
  // farther from the door than the middle of the room is...
  assert.ok(cls.travel > cls.hub);
  // ...and *shorter* than that walk plus the room's whole radius, which is
  // what this was before Phase 10 put a mesh under it. The old sum walked to
  // the middle of the room and then out to the corner and back again.
  assert.ok(cls.travel < cls.hub + cls.reach,
    'the mesh measures the corner, it does not add the room to itself');
});

test('a corridor is no longer one hub, so two doors off it are not a detour', () => {
  // Two classrooms at opposite ends of a long corridor, and the exit beyond
  // one of them. Under the portal graph the near room walked to the middle of
  // the corridor and back, which is the ten-to-twenty feet Phase 8 measured.
  const s = corridorSchool({ len: 30 });
  const r = egressAnalysis(s);
  const corridor = r.rooms.find((x) => x.name === 'Corridor');
  // The corridor is 30 cells — 120ft — with the way out at its west end, so
  // the farthest point in it is a shade over 120ft from the door and nothing
  // in the building is farther than the building is long.
  assert.ok(corridor.travel > 110 && corridor.travel < 130,
    `a 120ft corridor should measure about 120ft, not ${corridor.travel}`);
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
  // A sealed room in the corner: floor, walls, no door.
  const s = corridorSchool({
    len: 6,
    extra: (f) => f.box(1, 7, 2, 7, { name: 'Room 102' }),
  });
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
  const f = sheet(s, 0);
  f.box(1, 1, 10, 10, { name });
  f.edgeV(1, 5, EDGE_DOOR);
  f.bake();
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
  // A second door at the east end.
  const s = corridorSchool({ len: 10, extra: (f) => f.edgeV(11, 4, EDGE_DOOR2) });
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
  // be longer than the corridor's own diagonal. (Since Phase 12 a room is
  // sampled at the corners of its outline rather than at its cell centres, so
  // the far corner really is the far corner — a couple of feet further than
  // the middle of the last cell used to be.)
  assert.ok(dead.depth <= Math.hypot(30 * CELL, 4 * CELL));
});

test('every room is sampled, and the farthest point is inside it', () => {
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
  const up = sheet(s, 1);
  up.fill(1, 1, 4, 3).label(1, 1, 4, 3, { name: 'Room 201' });
  up.bake();
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
  const f = sheet(s, 0);
  f.box(1, 1, 8, 4, { name: 'Room 101' });
  f.edgeV(1, 2, EDGE_DOOR2);
  f.bake();
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

// ---------- exit discharge ----------
//
// Phase 7 could not make this finding and said so: the graph flattened the
// outdoors into one node, so a door discharged the moment you crossed the
// threshold. Everything below is what the site mesh bought.

const rectPts = (x0, z0, x1, z1) => [
  { x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 },
];

test('a discharge is measured from the door to the public way', () => {
  const s = corridorSchool({ len: 6 });
  const r = dischargeAnalysis(s);
  assert.equal(r.rows.length, 1, 'one exterior door, one discharge');
  const row = r.rows[0];
  assert.ok(row.reaches);
  assert.ok(row.dist > 0, 'the walk out is a distance rather than nothing');
  assert.ok(row.way, 'and it comes out somewhere on the boundary');
  assert.equal(r.summary.stranded, 0);
  assert.equal(r.summary.reaching, 1);
});

test('paving that reaches the boundary is the public way; a fence line is only said to be', () => {
  const s = corridorSchool({ len: 6 });
  const grass = dischargeAnalysis(s);
  assert.equal(grass.summary.rule, 'boundary');
  // A drive from the west door out to the edge of the site.
  addRegion(s, rectPts(-300, -300, 300, 300), { surf: 'turf', name: 'Lawn' });
  addRegion(s, rectPts(-300, 8, 4, 24), { surf: 'asphalt', name: 'Drive' });
  const paved = dischargeAnalysis(s);
  assert.equal(paved.summary.rule, 'paved');
  assert.ok(paved.rows[0].way.paved);
});

test('a door that opens into an enclosure is not an exit, and the finding says so', () => {
  // Every way out bricked up except one that opens into a planting bed with a
  // ring of planting bed around it: there is ground outside the door and no
  // route off the property from it.
  const s = corridorSchool({ len: 6 });
  addRegion(s, rectPts(-400, -400, 400, 400), { surf: 'garden', name: 'Bed' });
  const r = dischargeAnalysis(s);
  assert.equal(r.summary.reaching, 0);
  assert.ok(has(r.findings, 'discharge-blocked') || has(r.findings, 'discharge-unknown'),
    'a door onto nowhere is a finding');
});

test('a discharge route steeper than a ramp may be is a failure, not a note', () => {
  const s = corridorSchool({ len: 6 });
  addRegion(s, rectPts(-300, -300, 300, 300), { surf: 'turf', name: 'Lawn' });
  const level = dischargeAnalysis(s);
  assert.ok(level.rows[0].grade < ACCESSIBLE_GRADE);
  assert.ok(!has(level.findings, 'discharge-grade'));

  // ...and now tilt the ground away west of the door, which is the direction
  // it discharges in. Gently enough to still be walkable — a bank steeper than
  // 25% is not in the mesh at all, and a route that goes round a bank is not a
  // steep route, which is the right answer and the wrong test.
  ensureTerrain(s);
  raiseTerrain(s.terrain, -150, 18, 200, -25);
  const steep = dischargeAnalysis(s);
  assert.ok(steep.rows[0].grade > MAX_RAMP_GRADE,
    `the walk out runs down a bank (${steep.rows[0].grade})`);
  const f = find(steep.findings, 'discharge-grade');
  assert.ok(f && f.level === 'fail');
});

test('the egress report carries the walk after the door as well as the one before it', () => {
  const s = buildSampleSchool();
  const r = egressAnalysis(s);
  assert.ok(r.discharge, 'the analysis has a discharge half');
  assert.equal(r.discharge.rows.length, r.exits.length);
  // The two halves are added into one number for the reader who wants to know
  // how far it is out of here — and it is longer than either half alone.
  if (r.summary.worst && r.summary.toPublicWay !== null) {
    assert.ok(r.summary.toPublicWay > r.summary.worst.travel);
  }
  // ...and the discharge findings are in the same list as the rest.
  const codes = r.findings.map((f) => f.code);
  assert.ok(codes.some((c) => c.startsWith('discharge')), codes.join(','));
});

test('a sealed building has no discharge to report, and does not invent one', () => {
  const s = corridorSchool({ exit: false });
  const r = dischargeAnalysis(s);
  assert.equal(r.rows.length, 0);
  assert.deepEqual(r.findings, []);
  // ...and the egress analysis still says the one thing that matters.
  const e = egressAnalysis(s);
  assert.equal(e.findings.length, 1);
  assert.equal(e.findings[0].code, 'no-exits');
});

test('the note about a long discharge is a note, because no code sets a limit', () => {
  assert.ok(DISCHARGE_NOTE > 0);
  const s = buildSampleSchool();
  const r = dischargeAnalysis(s);
  const long = find(r.findings, 'discharge-distance');
  if (long) assert.equal(long.level, 'note');
});

// ---------- Phase 41: the edition, applied; the common path, measured ----------

test('a hypothetical edition changes the egress numbers, so the sheet\'s "applied" is true', () => {
  const s = corridorSchool({ len: 40 });
  const base = egressAnalysis(s);
  const e = editionEntry(DEFAULT_EDITION);
  const strict = {
    ...e, key: 'test', label: 'Test Code',
    travel: { sprinklered: 100, plain: 80 },
    widthPerOcc: { level: 1, stair: 1.5 },
    exits: [{ over: 10, need: 2 }],
    factors: { ...e.factors, classroom: 5 },
    cites: { ...e.cites, travel: 'Table T' },
  };
  const held = egressAnalysis(s, { edition: strict });
  assert.equal(held.edition, 'test');
  assert.equal(held.limits.travel, 100);
  assert.ok(held.rooms.filter((r) => r.over).length > base.rooms.filter((r) => r.over).length);
  assert.ok(held.summary.occupants > base.summary.occupants, 'the occupant load came off the same table');
  assert.equal(held.summary.exitsRequired, 2);
  for (const x of held.exits) assert.equal(x.capacity, Math.floor(x.clear * 12));
  assert.equal(find(held.findings, 'travel-distance').cite, 'Test Code · Table T');
  // ...and the design's own edition is read when nobody hands one over.
  s.code = { edition: 'ibc2018', sprinklered: false };
  const own = egressAnalysis(s);
  assert.equal(own.edition, 'ibc2018');
  assert.equal(own.sprinklered, false);
  assert.equal(own.limits.travel, TRAVEL_LIMIT.plain);
});

test('every egress finding says what it was measured against', () => {
  for (const r of [egressAnalysis(buildSampleSchool()), egressAnalysis(corridorSchool({ exit: false })),
    egressAnalysis(oneBigRoom('Auditorium')), accessibleAnalysis(buildSampleSchool())]) {
    for (const f of r.findings) {
      assert.ok(typeof f.cite === 'string' && f.cite.length, `${f.code} cites nothing`);
      assert.match(f.cite, /^(IBC \d{4} · |ADA 2010 · )/);
    }
  }
});

test('the common path is in the analysis, per room, against the edition\'s limit', () => {
  const r = egressAnalysis(buildSampleSchool());
  assert.ok(r.common && r.common.rows.length === r.rooms.filter((x) => x.reached).length);
  assert.equal(r.common.summary.limit, r.limits.commonPath);
  assert.equal(r.summary.commonPath, r.common.summary.worst);
  // The sample school has one stair, so its upper storey is over the limit
  // and the finding names it.
  const f = find(r.findings, 'common-path');
  assert.ok(f && f.level === 'warn');
  assert.ok(f.rooms.length > 0 && f.rooms.every((x) => x.over));
  assert.match(f.cite, /Table 1006\.2\.1/);
  // A short school with a door at each end of its corridor is under it.
  const ok = egressAnalysis(corridorSchool({ len: 8, extra: (f) => f.edgeV(9, 4, EDGE_DOOR2) }));
  assert.equal(find(ok.findings, 'common-path').level, 'ok');
  assert.equal(ok.summary.commonOver, 0);
  // ...and it can be left out with the rest of the slow half.
  const quick = egressAnalysis(buildSampleSchool(), { commonPath: false });
  assert.equal(quick.common, null);
  assert.equal(quick.summary.commonPath, null);
  assert.ok(!find(quick.findings, 'common-path'));
});

test('an unnamed room widens the occupant load, and the exit count says so only when it matters', () => {
  // A small school with one unnamed room: the point passes with one exit
  // and the high end of the range would want two.
  const s = createState(16, 10);
  const f = sheet(s, 0);
  f.box(1, 4, 12, 4, { name: 'Corridor' });
  f.box(1, 1, 8, 3);                       // unnamed, 24 cells — 384 ft², 55 at 7 ft² a head
  f.edgeH(3, 4, EDGE_DOOR);
  f.edgeV(1, 4, EDGE_DOOR2);
  f.bake();
  const r = egressAnalysis(s);
  assert.ok(r.summary.occupantsLow < r.summary.occupantsHigh);
  assert.equal(r.summary.exitsRequired, 1);
  assert.equal(r.summary.exitsRequiredHigh, 2);
  const note = find(r.findings, 'exit-count-range');
  assert.ok(note && note.level === 'note');
  assert.match(note.detail, /Naming/);
  // Name it, and the note goes.
  for (const sh of s.floors[0].shapes) if (!sh.name) sh.name = 'Office';
  assert.ok(!find(egressAnalysis(s).findings, 'exit-count-range'));
});
