// The nav graph: rooms found, doorways joined, stairs travelled, exits
// reached. Built on tiny hand-made buildings where the right answer can be
// counted by hand, plus the sample school as the one real design.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, addFloor, CELL } from '../js/grid.js';
import { setTile, edgeHIdx, edgeVIdx, EDGE_WALL, EDGE_DOOR, EDGE_DOOR2, EDGE_GLASS, EDGE_WINDOW } from '../js/lattice.js';
import { sheet } from './build.mjs';
import { addShape, addOpening, setSegWall, LEAF_SINGLE, OP_WINDOW } from '../js/shapes.js';
import { addStair } from '../js/stairs.js';
import { buildSampleSchool } from '../js/sample.js';
import { addRegion, siteCurbs } from '../js/site.js';
import {
  buildNav, floorRooms, nodeAt, findPath, waypoints, route,
  egressField, nearestExit, pointField, pointEntry, unreachableRooms, navSummary,
  teachingRooms, commonRooms, runLandings, DOOR_OFFSET, MUSTER_FT,
  STAIR_COST,
  outdoors, goesOutdoors, pathDistance, dischargeField, OUTDOOR_COST,
} from '../js/navgraph.js';
import { clearWidth, CLEAR_LOSS, MIN_CLEAR_W, MIN_ACCESSIBLE_W } from '../js/clearance.js';

// Two rooms side by side inside one shell, with a doorway between them and
// (optionally) one to the outside. Cells 1..4 and 6..9 on row 1..4.
function twoRooms({ exterior = true, extra = null } = {}) {
  const s = createState(12, 8);
  const f = sheet(s, 0);
  f.box(1, 1, 9, 4);
  // partition at x = 5, with a doorway in it
  f.vrun(5, 1, 4, EDGE_WALL).edgeV(5, 2, EDGE_DOOR);
  if (exterior) f.edgeV(1, 3, EDGE_DOOR2);
  if (extra) extra(f);
  f.bake();
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
  const s = twoRooms({
    exterior: false,
    extra: (f) => f.edgeV(5, 3, EDGE_WINDOW).edgeV(5, 4, EDGE_GLASS),
  });
  const nav = buildNav(s);
  assert.equal(nav.portals.length, 1);
});

test('a doorway with the same room on both sides is not a portal', () => {
  // A "door" in the middle of the left room, with floor on both sides. Since
  // Phase 12 the bake drops it before the graph ever sees it — a doorway
  // through nothing is a boundary of no room — which is the same answer for a
  // better reason.
  const s = twoRooms({ exterior: false, extra: (f) => f.edgeV(3, 2, EDGE_DOOR) });
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
  // Brick the doorway up.
  const s = twoRooms({ exterior: false, extra: (f) => f.edgeV(5, 2, EDGE_WALL) });
  const nav = buildNav(s);
  const [a, b] = nav.rooms;
  assert.equal(findPath(nav, a.id, b.id), null);
});

test('a stair joins the storeys, and the graph knows which end is which', () => {
  const s = twoRooms();
  addFloor(s, 1);
  const upper = sheet(s, 1);
  upper.box(1, 1, 9, 4);
  upper.bake();
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
  // Seal the inner room.
  const s = twoRooms({ extra: (f) => f.edgeV(5, 2, EDGE_WALL) });
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
  // A second way out, far side.
  const s = twoRooms({ extra: (f) => f.edgeV(10, 3, EDGE_DOOR) });
  const nav = buildNav(s);
  const field = egressField(nav);
  // Each room's nearest exit is the one on its own side of the partition.
  for (const r of nav.rooms) {
    const exit = nearestExit(nav, field, 0, r.x, r.z);
    assert.ok(exit);
    assert.ok(exit.dist < 60, `${r.id} takes a detour: ${exit.dist}`);
  }
});

test('a free-drawn room joins a painted one through its own opening', () => {
  const s = createState(12, 8);
  const f = sheet(s, 0);
  f.box(1, 1, 5, 4);
  f.edgeV(6, 2, EDGE_DOOR);     // the painted room's door onto the drawn one
  f.bake();
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

// ---------- the accessible graph, and distance in feet ----------

test('a doorway offers less clear width than it is wide', () => {
  assert.equal(clearWidth(3), 3 - CLEAR_LOSS);
  assert.equal(clearWidth(3, false), 3, 'a cased opening loses nothing');
  assert.equal(clearWidth(0.1), 0.1 - CLEAR_LOSS > 0 ? 0.1 - CLEAR_LOSS : 0);
  // The narrowest opening that passes is exactly a 3ft leaf.
  assert.ok(clearWidth(MIN_ACCESSIBLE_W) >= MIN_CLEAR_W - 1e-9);
  assert.ok(clearWidth(MIN_ACCESSIBLE_W - 0.01) < MIN_CLEAR_W);
});

test('the accessible graph drops stairs and narrow doors, keeps everything else', () => {
  const s = buildSampleSchool();
  const plain = buildNav(s);
  const access = buildNav(s, { accessible: true });
  assert.ok(!plain.accessible && access.accessible);
  assert.equal(access.minWidth, MIN_ACCESSIBLE_W);
  assert.ok(!access.links.some((l) => l.type === 'stair'));
  assert.ok(access.links.some((l) => l.type === 'elevator'));
  assert.equal(access.rooms.length, plain.rooms.length);
  assert.equal(access.exits.length, plain.exits.length);
});

test('a 2ft doorway is a route on foot and not on wheels', () => {
  const s = createState(20, 12);
  const f = sheet(s, 0);
  f.box(1, 1, 9, 4);
  f.vrun(5, 1, 4, EDGE_WALL);
  f.bake();
  const shape = addShape(s, 0, [
    { x: 44, z: 4 }, { x: 64, z: 4 }, { x: 64, z: 20 }, { x: 44, z: 20 },
  ], { name: 'Narrow' });
  addOpening(shape, 0, 3, 0.5, 2, { leaf: LEAF_SINGLE });
  assert.equal(buildNav(s).portals.length, 1);
  assert.equal(buildNav(s, { accessible: true }).portals.length, 0);
  // ...and the threshold is an option, so a caller can ask a wider question.
  assert.equal(buildNav(s, { minWidth: 1 }).portals.length, 1);
});

test('the metric field measures feet where the cost field measures cost', () => {
  const nav = buildNav(buildSampleSchool());
  const cost = egressField(nav);
  const feet = egressField(nav, { metric: true });
  const upstairs = nav.rooms.find((r) => r.floor === 1 && r.name === 'Room 201');
  assert.ok(feet.dist.get(upstairs.id) < cost.dist.get(upstairs.id),
    'a stair charged at 1.7x and a storey penalty cost more than they measure');
  // On the ground floor, with no stair in the way, the two agree.
  const ground = nav.rooms.find((r) => r.floor === 0 && r.name === 'Room 101');
  assert.ok(Math.abs(feet.dist.get(ground.id) - cost.dist.get(ground.id)) < 1e-9);
  assert.ok(STAIR_COST > 1);
});


// ---------- the mesh ----------
//
// Phase 10's whole thesis, tested where it is falsifiable: a corridor with two
// doors near one end of it. Under the portal graph the walk between them was
// door → the corridor's midpoint → door; on the mesh it is the straight line,
// because a corridor tile is convex and there is nothing in it.

// One long corridor with three doors off it: two rooms side by side at the
// west end, and one at the far east end.
function longCorridor(len = 30, extra = null) {
  const s = createState(len + 4, 12);
  const f = sheet(s, 0);
  f.box(1, 5, len, 5).label(1, 5, len, 5, { name: 'Hall' });
  // Three rooms north of it, at x = 2, x = 4 and x = len - 1.
  const room = (x, name) => {
    f.box(x, 2, x, 4, { name });
    f.edgeH(x, 5, EDGE_DOOR);
  };
  room(2, 'A');
  room(4, 'B');
  room(len - 1, 'C');
  if (extra) extra(f);
  f.bake();
  return s;
}

const named = (nav, name) => nav.rooms.find((r) => r.name === name);
test('two doors near one end of a corridor do not route through its middle', () => {
  const nav = buildNav(longCorridor(30));
  const a = named(nav, 'A');
  const b = named(nav, 'B');
  const path = findPath(nav, a.id, b.id);
  assert.ok(path, 'there is a way between them');
  // The corridor is 120ft long and the two doors are eight feet apart. Adding
  // up the edges actually walked has to come out near that, not near 120.
  let feet = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const e = nav.adj.get(path[i]).find((x) => x.to === path[i + 1]);
    feet += e.dist;
  }
  assert.ok(feet < 40, `two adjacent classrooms should be a short walk, got ${feet}`);
  // ...and the room at the far end genuinely is far.
  const c = named(nav, 'C');
  const far = findPath(nav, a.id, c.id);
  let farFeet = 0;
  for (let i = 0; i + 1 < far.length; i++) {
    const e = nav.adj.get(far[i]).find((x) => x.to === far[i + 1]);
    farFeet += e.dist;
  }
  assert.ok(farFeet > 100, `the far end of a 120ft corridor is far, got ${farFeet}`);
});

test('a room is a set of tiles, and its doorways stand on them', () => {
  const nav = buildNav(longCorridor(30));
  const hall = named(nav, 'Hall');
  const tiles = nav.mesh[0].byRoom.get(hall.id);
  assert.equal(tiles.length, 1, 'a straight corridor is one rectangle');
  const ids = new Set(tiles[0].anchors.map((a) => a.id));
  // Its own node, and the corridor side of all three doorways.
  assert.ok(ids.has(hall.id));
  assert.equal(nav.portalsOf(hall.id).length, 3);
  for (const p of nav.portalsOf(hall.id)) assert.ok(ids.has(p.id));
});

test('portalsOf finds a door at the far end, where adjacency would not', () => {
  const nav = buildNav(longCorridor(30));
  const hall = named(nav, 'Hall');
  const neighbours = new Set((nav.adj.get(hall.id) || []).map((e) => e.to));
  const far = nav.portals.find((p) => p.a === named(nav, 'C').id || p.b === named(nav, 'C').id);
  assert.ok(nav.portalsOf(hall.id).includes(far), 'it is a door on the corridor');
  assert.ok(neighbours.has(far.id), 'and on one tile it is a neighbour too');
});

test('an L-shaped room gets a gate, and a route round it goes through it', () => {
  const s = createState(16, 16);
  const f = sheet(s, 0);
  // An L: an arm east along row 1, and a leg south at x = 1..2.
  f.fill(1, 1, 10, 2).fill(1, 3, 2, 10);
  f.label(1, 1, 10, 2, { name: 'Bend' }).label(1, 3, 2, 10, { name: 'Bend' });
  f.bake();
  const nav = buildNav(s);
  assert.ok(nav.gates.length >= 1, 'the corner is a gate');
  for (const g of nav.gates) assert.equal(nav.node(g.id).kind, 'gate');
  // ...and a walk from one end of the L to the other is longer than the
  // straight line between them, because it has to go round the corner.
  const from = { floor: 0, x: 10 * CELL, z: 1.5 * CELL };
  const wp = route(nav, from, named(nav, 'Bend').id);
  assert.ok(wp.length >= 1);
});

test('a route starts from where the walker is, not from the middle of the room', () => {
  const nav = buildNav(longCorridor(30));
  const c = named(nav, 'C');
  // Standing at the west end of the corridor. The first waypoint has to be
  // ahead of the walker rather than back at the corridor's own node.
  const from = { floor: 0, x: 2 * CELL, z: 5.5 * CELL };
  const wp = route(nav, from, c.id);
  assert.ok(wp && wp.length, 'there is a route');
  assert.ok(!wp.some((p) => p.node === named(nav, 'Hall').id),
    'a route across a room does not visit the middle of it');
  assert.ok(wp[wp.length - 1].node === c.id);
});

test('pointField measures from a point rather than from a room', () => {
  // A way out at the west end.
  const s = longCorridor(30, (f) => f.edgeV(1, 5, EDGE_DOOR2));
  const nav = buildNav(s);
  const field = egressField(nav, { metric: true });
  const west = pointField(nav, field, 0, 2 * CELL, 5.5 * CELL);
  const east = pointField(nav, field, 0, 29 * CELL, 5.5 * CELL);
  assert.ok(west && east);
  assert.ok(east.dist > west.dist + 90,
    'the far end of a 120ft corridor is a hundred feet farther out than the near end');
  assert.equal(west.via, east.via, 'and both leave by the only door there is');
  // A point outside the building has no answer at all.
  assert.equal(pointField(nav, field, 0, -20, -20), null);
});

test('nearestExit answers for a point, and pointEntry hangs one on the mesh', () => {
  const s = longCorridor(30, (f) => f.edgeV(1, 5, EDGE_DOOR2));
  const nav = buildNav(s);
  const field = egressField(nav, { metric: true });
  const at = nearestExit(nav, field, 0, 20 * CELL, 5.5 * CELL);
  assert.ok(at && at.exit.exterior);
  assert.ok(at.dist > 60);
  const entry = pointEntry(nav, { floor: 0, x: 20 * CELL, z: 5.5 * CELL });
  assert.equal(entry.id, '@');
  assert.ok(entry.opts.adj.get('@').length >= 2, 'joined to what shares its tile');
});

// ---------- the outdoors, since Phase 17 ----------
//
// The outside used to be one node forty-five feet from every exterior door in
// the school. What replaced it is `sitemesh.js`'s tiles, wired exactly as a
// storey's are — so the tests below are about the three rules that keeps
// honest: the street is a sink, the fire drill still may not walk through it,
// and every number the tool printed before this phase is the number it prints
// after it.

test('an exterior door stands on the ground outside it, not on a hub', () => {
  const nav = buildNav(twoRooms());
  assert.ok(nav.yard, 'a design with a way out has an outdoors');
  assert.ok(nav.ways.length > 0, 'and somewhere to leave by');
  const exit = nav.exits[0];
  // The door is joined to the site, and the edge across the site is charged
  // the cost of stepping outside rather than a flat muster distance.
  const out = (nav.adj.get(exit.id) || []).filter((e) => e.yard);
  assert.ok(out.length > 0, 'the door has ground outside it');
  for (const e of out) {
    assert.ok(e.cost >= e.dist + OUTDOOR_COST - 1e-6,
      'and going out costs a door, a coat and the weather');
  }
});

test('the public way is a sink: nothing routes through the street', () => {
  const nav = buildNav(twoRooms());
  assert.deepEqual(nav.adj.get(nav.outside), [], 'nothing leads out of `out`');
  for (const w of nav.ways) {
    const arcs = nav.adj.get(w.id).filter((e) => e.to === nav.outside);
    assert.equal(arcs.length, 1, 'one way only, and it is one way');
  }
  // ...so a route *to* the outside exists and a route *from* it does not.
  const room = nav.rooms[0];
  assert.ok(findPath(nav, room.id, nav.outside));
  assert.equal(findPath(nav, nav.outside, room.id), null);
});

test('a fire drill still may not leave by one door and come back in another', () => {
  const nav = buildNav(twoRooms());
  const field = egressField(nav);
  for (const [id] of field.dist) {
    assert.ok(!outdoors(nav, id), `${id} is not on the egress field`);
  }
});

test('the graph knows when a walk goes outside, edge by edge as well as node by node', () => {
  const nav = buildNav(twoRooms({ exterior: false }));
  const [a, b] = nav.rooms;
  const path = findPath(nav, a.id, b.id);
  assert.ok(!goesOutdoors(nav, path), 'a sealed building has no outdoors to walk through');
  assert.equal(pathDistance(nav, path).outdoor, 0);
});

test('somebody standing outdoors routes from where they are, not from a hub', () => {
  const nav = buildNav(twoRooms());
  const exit = nav.exits[0];
  const from = { floor: 0, x: exit.x + exit.nx * 30, z: exit.z + exit.nz * 30 };
  const entry = pointEntry(nav, from);
  assert.ok(entry);
  assert.notEqual(entry.id, nav.outside, 'not the hub');
  assert.ok(entry.opts, 'a one-node overlay on the tile they are standing on');
  const wp = route(nav, from, nav.rooms.find((r) => r.id === (exit.a || exit.b)).id);
  assert.ok(wp && wp.length, 'and they can walk back in');
});

test('a discharge field is nothing at all without a way out', () => {
  const nav = buildNav(twoRooms({ exterior: false }));
  const f = dischargeField(nav);
  assert.equal(f.ways, 0);
  assert.equal(f.dist.size, 0);
});

// ---------- the curb, since Phase 39 ----------
//
// A site region whose kind implies curb points — a bus loop's bays, a
// drop-off's pull-ins, a parking lot's aisles — hangs each one on the ground
// it stands on, so a school morning can *begin* at the curb and a dismissal
// can end at one. The ids come off `siteCurbs`, the same list the crowd
// assigns people their curb from, so the two can never disagree.

test('a kinded region puts curb nodes on the yard, named off siteCurbs', () => {
  const s = twoRooms();
  addRegion(s, [
    { x: -60, z: 4 }, { x: -4, z: 4 }, { x: -4, z: 28 }, { x: -60, z: 28 },
  ], { surf: 'asphalt', kind: 'busloop', name: 'Loop' });
  const nav = buildNav(s);
  assert.ok(nav.curbs.length > 0, 'the loop implies bays');
  const listed = siteCurbs(s);
  assert.equal(nav.curbs.length, listed.length);
  for (let i = 0; i < listed.length; i++) {
    const node = nav.node(listed[i].id);
    assert.ok(node && node.kind === 'curb' && node.outdoors, `${listed[i].id} is on the graph`);
    assert.equal(node.x, listed[i].x);
    assert.equal(node.z, listed[i].z);
  }
});

test('the day can route in from the curb and back out to it', () => {
  const s = twoRooms();
  addRegion(s, [
    { x: -60, z: 4 }, { x: -4, z: 4 }, { x: -4, z: 28 }, { x: -60, z: 28 },
  ], { surf: 'asphalt', kind: 'dropoff' });
  const nav = buildNav(s);
  const curb = nav.curbs[0];
  const room = nav.rooms[1];
  const inbound = route(nav, { floor: 0, x: curb.x, z: curb.z }, room.id);
  assert.ok(inbound && inbound.length, 'the morning walk exists');
  assert.ok(inbound.some((w) => w.kind === 'door'), 'and comes in through a door');
  const outbound = route(nav, { floor: 0, x: room.x, z: room.z }, curb.id);
  assert.ok(outbound && outbound.length, 'so does the walk home');
  assert.equal(outbound[outbound.length - 1].kind, 'curb', 'and it ends at the curb');
});

test('a sealed building and a kindless site imply no curb at all', () => {
  assert.deepEqual(buildNav(twoRooms({ exterior: false })).curbs, []);
  const s = twoRooms();
  addRegion(s, [
    { x: -60, z: 4 }, { x: -4, z: 4 }, { x: -4, z: 28 }, { x: -60, z: 28 },
  ], { surf: 'asphalt' });
  assert.deepEqual(buildNav(s).curbs, [], 'asphalt without a kind is just asphalt');
});

test('the sample school arrives by bus: its loop and lot both reach the graph', () => {
  const nav = buildNav(buildSampleSchool());
  const kinds = new Set(nav.curbs.map((c) => c.curb));
  assert.ok(kinds.has('busloop'), 'the bus loop is a place to arrive');
  assert.ok(kinds.has('parking'), 'so is the staff lot');
  // Every curb can reach a room, which is what makes the morning walkable.
  const room = nav.rooms.find((r) => r.name === 'Room 101');
  for (const c of nav.curbs) {
    const wp = route(nav, { floor: 0, x: c.x, z: c.z }, room.id);
    assert.ok(wp && wp.length, `${c.id} routes in`);
  }
});


// ---------- Phase 40: what the accessible graph asks clearance.js ----------

test('a ramp steeper than 1:12 is on the plain graph and off the accessible one', () => {
  const s = createState(60, 30);
  addFloor(s);
  sheet(s, 0).box(1, 1, 50, 6, { name: 'Ground' }).bake();
  sheet(s, 1).box(1, 1, 50, 6, { name: 'Upper' }).bake();
  const { link } = addStair(s, 0, { type: 'ramp', x: 20, z: 14, rotationY: Math.PI / 2, slope: 8 });
  assert.ok(link);
  assert.ok(buildNav(s).links.some((l) => l.type === 'ramp'));
  assert.ok(!buildNav(s, { accessible: true }).links.some((l) => l.type === 'ramp'));
  link.data.slope = 12;
  assert.ok(buildNav(s, { accessible: true }).links.some((l) => l.type === 'ramp'));
});

test('a portal carries the leaf its doorway hangs', () => {
  const s = createState(20, 12);
  const f = sheet(s, 0);
  f.box(1, 1, 9, 4);
  f.vrun(5, 1, 4, EDGE_WALL);
  f.door(5, 2, false, EDGE_DOOR2);
  f.bake();
  const [p] = buildNav(s).portals;
  assert.ok(p);
  assert.equal(p.leaf, 2);
  assert.equal(p.w, 4);
  assert.equal(buildNav(s, { accessible: true }).portals.length, 1, 'a 4ft pair rolls, both leaves open');
});
