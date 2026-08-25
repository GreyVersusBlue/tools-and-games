// The nav graph: rooms found, doorways joined, stairs travelled, exits
// reached. Built on tiny hand-made buildings where the right answer can be
// counted by hand, plus the sample school as the one real design.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createState, setTile, edgeHIdx, edgeVIdx, addFloor,
  EDGE_WALL, EDGE_DOOR, EDGE_DOOR2, EDGE_GLASS, EDGE_WINDOW, CELL,
} from '../js/grid.js';
import { addShape, addOpening, setSegWall, LEAF_SINGLE, OP_WINDOW } from '../js/shapes.js';
import { addStair } from '../js/stairs.js';
import { buildSampleSchool } from '../js/sample.js';
import {
  buildNav, floorRooms, nodeAt, findPath, waypoints, route,
  egressField, nearestExit, unreachableRooms, navSummary,
  teachingRooms, commonRooms, runLandings, DOOR_OFFSET, MUSTER_FT,
} from '../js/navgraph.js';

// Two rooms side by side inside one shell, with a doorway between them and
// (optionally) one to the outside. Cells 1..4 and 6..9 on row 1..4.
function twoRooms({ exterior = true } = {}) {
  const s = createState(12, 8);
  const f = s.floors[0];
  for (let y = 1; y <= 4; y++) {
    for (let x = 1; x <= 9; x++) setTile(f, x, y, true);
  }
  // shell
  for (let x = 1; x <= 9; x++) { f.edgesH[edgeHIdx(f, x, 1)] = EDGE_WALL; f.edgesH[edgeHIdx(f, x, 5)] = EDGE_WALL; }
  for (let y = 1; y <= 4; y++) { f.edgesV[edgeVIdx(f, 1, y)] = EDGE_WALL; f.edgesV[edgeVIdx(f, 10, y)] = EDGE_WALL; }
  // partition at x = 5, with a doorway in it
  for (let y = 1; y <= 4; y++) f.edgesV[edgeVIdx(f, 5, y)] = EDGE_WALL;
  f.edgesV[edgeVIdx(f, 5, 2)] = EDGE_DOOR;
  if (exterior) f.edgesV[edgeVIdx(f, 1, 3)] = EDGE_DOOR2;
  return s;
}

test('a floor of two rooms finds two rooms, each with an interior hub', () => {
  const s = twoRooms();
  const { rooms } = floorRooms(s, 0);
  assert.equal(rooms.length, 2);
  for (const r of rooms) {
    assert.equal(r.floor, 0);
    assert.ok(r.area > 0);
    assert.ok(r.x > 0 && r.z > 0);
  }
});

test('a doorway joins the two rooms either side of it, and nothing else', () => {
  const nav = buildNav(twoRooms({ exterior: false }));
  assert.equal(nav.rooms.length, 2);
  assert.equal(nav.portals.length, 1);
  const p = nav.portals[0];
  assert.ok(p.a && p.b && p.a !== p.b);
  assert.ok(!p.exterior);
  assert.equal(nav.exits.length, 0);
  assert.equal(nav.outside, null, 'a sealed building has no outside node');
});

test('an exterior door is an exit, and carries somewhere to muster', () => {
  const nav = buildNav(twoRooms());
  assert.equal(nav.exits.length, 1);
  const exit = nav.exits[0];
  assert.ok(exit.exterior);
  assert.ok(exit.muster);
  assert.ok(Math.hypot(exit.muster.x - exit.x, exit.muster.z - exit.z) > MUSTER_FT - 0.01);
  // The muster point is outside the building, so its normal points away from
  // the room the door serves.
  const inner = exit.a || exit.b;
  const room = nav.node(inner);
  const toward = (exit.muster.x - exit.x) * (room.x - exit.x) + (exit.muster.z - exit.z) * (room.z - exit.z);
  assert.ok(toward < 0, 'muster is on the far side from the room');
});

test('a window is not a way through, and neither is glass', () => {
  const s = twoRooms({ exterior: false });
  const f = s.floors[0];
  f.edgesV[edgeVIdx(f, 5, 3)] = EDGE_WINDOW;
  f.edgesV[edgeVIdx(f, 5, 4)] = EDGE_GLASS;
  const nav = buildNav(s);
  assert.equal(nav.portals.length, 1);
});

test('a doorway with the same room on both sides is not a portal', () => {
  const s = twoRooms({ exterior: false });
  const f = s.floors[0];
  // A "door" in the middle of the left room, with floor on both sides.
  f.edgesV[edgeVIdx(f, 3, 2)] = EDGE_DOOR;
  const nav = buildNav(s);
  assert.equal(nav.portals.length, 1, 'still just the partition door');
});

test('every portal is two waypoints, one either side of the wall', () => {
  const nav = buildNav(twoRooms({ exterior: false }));
  const p = nav.portals[0];
  assert.ok(p.pa && p.pb);
  assert.ok(Math.abs(Math.hypot(p.pa.x - p.x, p.pa.z - p.z) - DOOR_OFFSET) < 1e-9);
  assert.ok(Math.abs(Math.hypot(p.pb.x - p.x, p.pb.z - p.z) - DOOR_OFFSET) < 1e-9);
  // ...and they are on opposite sides of it
  assert.ok((p.pa.x - p.x) * (p.pb.x - p.x) + (p.pa.z - p.z) * (p.pb.z - p.z) < 0);
});

test('a route between two rooms goes through the door, in the right order', () => {
  const nav = buildNav(twoRooms({ exterior: false }));
  const [a, b] = nav.rooms;
  const wp = route(nav, { floor: 0, x: a.x, z: a.z }, b.id);
  assert.ok(wp && wp.length >= 3);
  const doors = wp.filter((w) => w.kind === 'door');
  assert.equal(doors.length, 2, 'a doorway is entered and left');
  // The first door point is the one on the room we start in.
  const first = doors[0];
  const startSide = Math.hypot(first.x - a.x, first.z - a.z);
  const endSide = Math.hypot(doors[1].x - a.x, doors[1].z - a.z);
  assert.ok(startSide < endSide, 'near side first');
  assert.equal(wp[wp.length - 1].node, b.id);
});

test('a route from a point already in the target room is a route to it, not through it', () => {
  const nav = buildNav(twoRooms({ exterior: false }));
  const [a] = nav.rooms;
  const wp = route(nav, { floor: 0, x: a.x, z: a.z }, a.id);
  assert.equal(wp.length, 1);
  assert.equal(wp[0].node, a.id, 'the only stop is the room itself');
});

test('there is no route into a room with no door', () => {
  const s = twoRooms({ exterior: false });
  const f = s.floors[0];
  f.edgesV[edgeVIdx(f, 5, 2)] = EDGE_WALL;   // brick the doorway up
  const nav = buildNav(s);
  const [a, b] = nav.rooms;
  assert.equal(findPath(nav, a.id, b.id), null);
});

test('a stair joins the storeys, and the graph knows which end is which', () => {
  const s = twoRooms();
  addFloor(s, 1);
  const upper = s.floors[1];
  for (let y = 1; y <= 4; y++) for (let x = 1; x <= 9; x++) setTile(upper, x, y, true);
  for (let x = 1; x <= 9; x++) { upper.edgesH[edgeHIdx(upper, x, 1)] = EDGE_WALL; upper.edgesH[edgeHIdx(upper, x, 5)] = EDGE_WALL; }
  for (let y = 1; y <= 4; y++) { upper.edgesV[edgeVIdx(upper, 1, y)] = EDGE_WALL; upper.edgesV[edgeVIdx(upper, 10, y)] = EDGE_WALL; }
  // Along +x (rotationY = pi/2), so a nineteen-foot run and its landing both
  // fit inside a building that is only five cells deep.
  const { link } = addStair(s, 0, { x: 2 * CELL, z: 3 * CELL, rotationY: Math.PI / 2, type: 'stair' });
  assert.ok(link, 'the stair was placed');
  const nav = buildNav(s);
  assert.equal(nav.links.length, 1);
  const node = nav.links[0];
  assert.equal(node.a.floor, 0);
  assert.equal(node.b.floor, 1);
  // A route from downstairs to upstairs uses it, and the two landings come out
  // in travel order.
  const down = nav.rooms.find((r) => r.floor === 0);
  const up = nav.rooms.find((r) => r.floor === 1);
  const wp = route(nav, { floor: 0, x: down.x, z: down.z }, up.id);
  assert.ok(wp, 'there is a way up');
  const ride = wp.filter((w) => w.kind === 'link' || w.kind === 'ride');
  assert.equal(ride.length, 2);
  assert.equal(ride[0].floor, 0);
  assert.equal(ride[1].floor, 1);
});

test('a run\'s landings sit clear of the hole it cuts', () => {
  const s = twoRooms();
  addFloor(s, 1);
  const { link } = addStair(s, 0, { x: 2 * CELL, z: 2 * CELL, rotationY: 0, type: 'stair' });
  assert.ok(link);
  const ends = runLandings(link, { rise: 12, run: 19.25, steps: 21, riser: 0.57, tread: 11 / 12 });
  // The foot is before the first tread; the head is past the far edge of the
  // cut, which is where the guardrails stop.
  assert.ok(ends.foot.z < link.z, 'foot is short of the run');
  assert.ok(ends.head.z > link.z + 19.25, 'head is past the run');
});

test('a plain floor opening is a hole, not a way up', () => {
  const s = twoRooms();
  addFloor(s, 1);
  addStair(s, 0, { x: 2 * CELL, z: 2 * CELL, type: 'opening' });
  const nav = buildNav(s);
  assert.equal(nav.links.length, 0);
});

test('egress: every room reaches the exit, and the distances are sane', () => {
  const nav = buildNav(twoRooms());
  const field = egressField(nav);
  assert.equal(unreachableRooms(nav, field).length, 0);
  for (const r of nav.rooms) {
    const d = field.dist.get(r.id);
    assert.ok(Number.isFinite(d) && d >= 0);
  }
  // The room with the door in it is nearer the way out than the one behind it.
  const near = nav.node(nav.exits[0].a || nav.exits[0].b);
  const far = nav.rooms.find((r) => r.id !== near.id);
  assert.ok(field.dist.get(near.id) < field.dist.get(far.id));
});

test('egress: a room nobody can get out of says so rather than guessing', () => {
  const s = twoRooms();
  const f = s.floors[0];
  f.edgesV[edgeVIdx(f, 5, 2)] = EDGE_WALL;    // seal the inner room
  const nav = buildNav(s);
  const field = egressField(nav);
  const stranded = unreachableRooms(nav, field);
  assert.equal(stranded.length, 1);
  assert.equal(nearestExit(nav, field, 0, stranded[0].x, stranded[0].z), null);
});

test('egress: a building with no exterior door has no egress at all', () => {
  const nav = buildNav(twoRooms({ exterior: false }));
  const field = egressField(nav);
  assert.equal(field.reached, 0);
  assert.equal(unreachableRooms(nav, field).length, nav.rooms.length);
});

test('an exit route does not leave by one door and come back in another', () => {
  const s = twoRooms();
  const f = s.floors[0];
  f.edgesV[edgeVIdx(f, 10, 3)] = EDGE_DOOR;   // a second way out, far side
  const nav = buildNav(s);
  const field = egressField(nav);
  // Each room's nearest exit is the one on its own side of the partition.
  for (const r of nav.rooms) {
    const exit = nearestExit(nav, field, 0, r.x, r.z);
    assert.ok(exit);
    assert.ok(exit.dist < 60, `${r.id} takes a detour: ${exit.dist}`);
  }
});

test('a polygon room joins the lattice through its own opening', () => {
  const s = createState(12, 8);
  const f = s.floors[0];
  for (let y = 1; y <= 4; y++) for (let x = 1; x <= 5; x++) setTile(f, x, y, true);
  for (let x = 1; x <= 5; x++) { f.edgesH[edgeHIdx(f, x, 1)] = EDGE_WALL; f.edgesH[edgeHIdx(f, x, 5)] = EDGE_WALL; }
  for (let y = 1; y <= 4; y++) { f.edgesV[edgeVIdx(f, 1, y)] = EDGE_WALL; f.edgesV[edgeVIdx(f, 6, y)] = EDGE_WALL; }
  f.edgesV[edgeVIdx(f, 6, 2)] = EDGE_DOOR;     // lattice door onto the polygon
  const shape = addShape(s, 0, [
    { x: 6 * CELL, z: 1 * CELL }, { x: 10 * CELL, z: 1 * CELL },
    { x: 10 * CELL, z: 5 * CELL }, { x: 6 * CELL, z: 5 * CELL },
  ], { name: 'Commons' });
  assert.ok(shape);
  addOpening(shape, 0, 1, 0.5, null, { leaf: LEAF_SINGLE });   // a door on its east wall
  const nav = buildNav(s);
  const poly = nav.rooms.find((r) => r.rep === 'shape');
  assert.ok(poly, 'the polygon room is a room');
  assert.equal(nav.portals.filter((p) => !p.exterior).length, 1, 'the shared lattice door');
  assert.equal(nav.exits.length, 1, 'the polygon door is the way out');
});

test('a window in a polygon wall is not a portal', () => {
  const s = createState(12, 8);
  const shape = addShape(s, 0, [
    { x: 8 }, { x: 40 }, { x: 40 }, { x: 8 },
  ].map((p, i) => ({ x: [8, 40, 40, 8][i], z: [8, 8, 40, 40][i] })), { name: 'Box' });
  addOpening(shape, 0, 0, 0.5, 6, { k: OP_WINDOW, sill: 3 });
  const nav = buildNav(s);
  assert.equal(nav.portals.length, 0);
});

// ---------- the sample school ----------

test('the sample school reads as a building you can walk around', () => {
  const s = buildSampleSchool();
  const nav = buildNav(s);
  const sum = navSummary(nav);
  assert.ok(sum.rooms >= 10, 'both storeys of rooms');
  assert.ok(sum.doors >= 8);
  assert.ok(sum.exits >= 1);
  assert.ok(sum.links >= 1, 'the stair and the lift');
  assert.ok(sum.outside);
});

test('every room in the sample school can reach a way out', () => {
  const nav = buildNav(buildSampleSchool());
  const field = egressField(nav);
  const stranded = unreachableRooms(nav, field);
  assert.deepEqual(stranded.map((r) => r.name || r.id), []);
});

test('upstairs is further from a door than downstairs, as it should be', () => {
  const nav = buildNav(buildSampleSchool());
  const field = egressField(nav);
  const worstGround = Math.max(...nav.rooms.filter((r) => r.floor === 0).map((r) => field.dist.get(r.id)));
  const bestUpper = Math.min(...nav.rooms.filter((r) => r.floor === 1).map((r) => field.dist.get(r.id)));
  assert.ok(bestUpper > worstGround);
});

test('teaching rooms exclude the corridors, and the corridors are the common ones', () => {
  const nav = buildNav(buildSampleSchool());
  const teach = teachingRooms(nav).map((r) => r.name);
  const common = commonRooms(nav).map((r) => r.name);
  assert.ok(teach.includes('Room 101'));
  assert.ok(!teach.some((n) => /hall/i.test(n || '')), 'no halls are teaching rooms');
  assert.ok(common.some((n) => /hall/i.test(n || '')), 'the halls are common rooms');
  assert.equal(teach.filter((n) => common.includes(n)).length, 0, 'the two lists do not overlap');
});

test('a route across the sample school is walkable end to end', () => {
  const nav = buildNav(buildSampleSchool());
  const from = nav.rooms.find((r) => r.name === 'Room 101');
  const to = nav.rooms.find((r) => r.name === 'Room 106');
  const wp = route(nav, { floor: 0, x: from.x, z: from.z }, to.id);
  assert.ok(wp && wp.length > 0);
  assert.equal(wp[wp.length - 1].node, to.id);
  // Consecutive waypoints are never absurdly far apart — a jump would mean the
  // graph had joined two rooms that don't touch.
  let prev = { x: from.x, z: from.z };
  for (const w of wp) {
    assert.ok(Math.hypot(w.x - prev.x, w.z - prev.z) < 200, 'no teleports in a route');
    prev = w;
  }
});

test('a route to another storey changes floor exactly once', () => {
  const nav = buildNav(buildSampleSchool());
  const from = nav.rooms.find((r) => r.name === 'Room 101');
  const to = nav.rooms.find((r) => r.floor === 1 && r.name === 'Room 201');
  const wp = route(nav, { floor: 0, x: from.x, z: from.z }, to.id);
  assert.ok(wp);
  let changes = 0;
  let floor = 0;
  for (const w of wp) { if (w.floor !== floor) { changes++; floor = w.floor; } }
  assert.equal(changes, 1);
});

test('nodeAt puts a point in its room, and outdoors outside', () => {
  const s = buildSampleSchool();
  const nav = buildNav(s);
  const room = nav.rooms.find((r) => r.name === 'Room 101');
  assert.equal(nodeAt(nav, 0, room.x, room.z), room.id);
  assert.equal(nodeAt(nav, 0, -500, -500), nav.outside);
});

test('waypoints of an empty or unknown path are empty, not a crash', () => {
  const nav = buildNav(twoRooms());
  assert.deepEqual(waypoints(nav, []), []);
  assert.deepEqual(waypoints(nav, ['nope']), []);
  assert.equal(findPath(nav, 'nope', nav.rooms[0].id), null);
  assert.equal(route(nav, { floor: 0, x: -900, z: -900 }, 'nope'), null);
});
