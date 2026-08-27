// Tests for sightline.js — is that door visible from here? Pure module, so
// the whole of it runs under `node --test`: no browser, no three.js.
//
// The fixtures are drawn on a scratch lattice and baked, the state the editor
// actually produces. The four things worth being sure of, because they are the
// ones you would only notice by walking around: a wall hides a label, a
// doorway you are looking through doesn't, glass never hides one, and a shut
// door does until it swings.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, addFloor } from '../js/grid.js';
import { EDGE_DOOR, EDGE_GLASS, EDGE_RAIL, EDGE_OPENING } from '../js/lattice.js';
import { sheet } from './build.mjs';
import { addOpening, OP_WINDOW, shapeArea, interiorPoint } from '../js/shapes.js';
import { buildSampleSchool } from '../js/sample.js';
import { collectDoorLeaves, closeAll } from '../js/openings.js';
import {
  sightSegments, sightBlockers, sightClear, doorPoints, doorSeen,
  makeLabelGate, LABEL_MODES,
} from '../js/sightline.js';

// Two rooms sharing a doored partition, and a third room below with no way
// to see into it from the first two — its only door opens to the outside.
//
//   A (8..24, 8..24) | B (24..40, 8..24)     door A|B at x=24, z 12..16
//   C (8..24, 24..40)                        door C|outside at z=40, x 12..16
function threeRooms() {
  const s = createState(20, 20);
  const sh = sheet(s, 0);
  sh.box(2, 2, 5, 5, { name: 'A' });
  sh.box(6, 2, 9, 5, { name: 'B' });
  sh.box(2, 6, 5, 9, { name: 'C' });
  sh.edgeV(6, 3, EDGE_DOOR);      // between A and B
  sh.edgeH(3, 10, EDGE_DOOR);     // C onto the outdoors
  sh.bake();
  return s;
}

const roomId = (s, name) => s.floors[0].shapes.find((r) => r.name === name).id;
// The live leaves the collider would carry, all shut — exactly what
// buildCollider does at walk-start.
const leavesOf = (s) => closeAll(collectDoorLeaves(s, 0));
const leafNear = (leaves, x, z) => leaves.find(
  (l) => Math.hypot(l.cx - x, l.cz - z) < 2);

// ---------- occluders ----------

test('a walled box occludes on all four sides', () => {
  const s = createState(10, 10);
  sheet(s, 0).box(2, 2, 5, 5).bake();
  const segs = sightSegments(s.floors[0]);
  assert.equal(segs.length, 4);
});

test('glass and railings stop a body but never a look', () => {
  const s = createState(10, 10);
  const sh = sheet(s, 0);
  sh.box(2, 2, 5, 5);
  sh.vrun(6, 2, 5, EDGE_GLASS);   // the right side, glazed
  sh.hrun(2, 5, 2, EDGE_RAIL);    // the top, a railing
  sh.bake();
  const segs = sightSegments(s.floors[0]);
  assert.equal(segs.length, 2, 'only the two solid sides remain');
});

test('a doorway is a hole in the occluder, and its jambs are not', () => {
  const s = createState(10, 10);
  const sh = sheet(s, 0);
  sh.box(2, 2, 5, 5);
  sh.edgeV(2, 3, EDGE_DOOR);
  sh.bake();
  const segs = sightSegments(s.floors[0]);
  assert.equal(segs.length, 5, 'the doored side splits into two jambs');
  // Straight through the middle of the doorway: clear. A foot to the side,
  // into the jamb: blocked.
  assert.ok(sightClear(segs, null, 4, 14, 12, 14));
  assert.ok(!sightClear(segs, null, 4, 10, 12, 10));
});

test('a window passes sight at eye height and a clerestory does not', () => {
  const s = createState(10, 10);
  const sh = sheet(s, 0);
  sh.box(2, 2, 5, 5);
  sh.bake();
  const shape = s.floors[0].shapes[0];
  // Find the ring segment lying on x=8 (the left side) to hang the window on.
  const ring = shape.rings[0];
  let seg = -1;
  for (let i = 0; i < ring.pts.length; i++) {
    const a = ring.pts[i], b = ring.pts[(i + 1) % ring.pts.length];
    if (a.x === 8 && b.x === 8) seg = i;
  }
  assert.ok(seg >= 0);
  assert.ok(addOpening(shape, 0, seg, 0.5, 6, { k: OP_WINDOW }));
  const atEye = sightSegments(s.floors[0]);
  assert.equal(atEye.length, 5, 'a 3ft-sill window is a hole to a 5.5ft eye');
  // The same wall to a very low eye — a child's, below the sill — is solid.
  const below = sightSegments(s.floors[0], { eyeH: 2 });
  assert.equal(below.length, 4);
  // Raise the sill above the eye and the hole closes again.
  ring.openings[ring.openings.length - 1].sill = 6.5;
  const clerestory = sightSegments(s.floors[0]);
  assert.equal(clerestory.length, 4);
});

// ---------- doors ----------

test('doorPoints names both rooms a partition door joins, whoever owns the wall', () => {
  const s = threeRooms();
  const doors = doorPoints(s, 0);
  assert.equal(doors.length, 2);
  const ab = doors.find((d) => Math.abs(d.x - 24) < 0.5);
  const a = roomId(s, 'A'), b = roomId(s, 'B');
  assert.ok(ab, 'the A|B door is found');
  assert.ok(ab.rooms.includes(a) && ab.rooms.includes(b));
  const cOut = doors.find((d) => Math.abs(d.z - 40) < 0.5);
  assert.ok(cOut, 'the exterior door is found');
  assert.ok(cOut.rooms.includes(roomId(s, 'C')));
  assert.ok(cOut.rooms.includes(null), 'its far side is the outdoors');
});

test('a shut leaf occludes its own doorway and an open one does not', () => {
  const s = threeRooms();
  const segs = sightBlockers(s, 0);
  const leaves = leavesOf(s);
  const door = doorPoints(s, 0).find((d) => Math.abs(d.x - 24) < 0.5);
  const eye = { x: 16, z: 14 };   // in A, square in front of the door
  assert.ok(!doorSeen(segs, leaves, eye, door), 'shut, the leaf blocks the cast');
  leafNear(leaves, 24, 14).open = 1;
  assert.ok(doorSeen(segs, leaves, eye, door), 'open, the doorway is a doorway');
  assert.ok(!doorSeen(segs, leaves, { x: 16, z: 32 }, door),
    'from C the same open door is behind a wall');
});

test('a cased opening needs no leaf to be seen through', () => {
  const s = createState(20, 20);
  const sh = sheet(s, 0);
  sh.box(2, 2, 5, 5, { name: 'A' });
  sh.box(6, 2, 9, 5, { name: 'B' });
  sh.edgeV(6, 3, EDGE_OPENING);
  sh.bake();
  const door = doorPoints(s, 0).find((d) => Math.abs(d.x - 24) < 0.5);
  assert.ok(door, 'an archway is still a doorway');
  assert.ok(doorSeen(sightBlockers(s, 0), leavesOf(s), { x: 16, z: 14 }, door));
});

// ---------- the gate ----------

test('standing in a room earns its label; the room across a shut door waits', () => {
  const s = threeRooms();
  const gate = makeLabelGate(s);
  const leaves = leavesOf(s);
  const a = roomId(s, 'A'), b = roomId(s, 'B'), c = roomId(s, 'C');
  const fresh = gate.update({ x: 16, y: 0, z: 14, floor: 0 }, leaves, 'earned');
  assert.ok(fresh.includes(a), 'the room underfoot is earned by standing in it');
  assert.ok(gate.visible(0, a, 'earned'));
  assert.ok(!gate.visible(0, b, 'earned'), 'B is behind a shut door');
  assert.ok(!gate.visible(0, c, 'earned'));
});

test('a door swinging open earns the room behind it, for the rest of the walk', () => {
  const s = threeRooms();
  const gate = makeLabelGate(s);
  const leaves = leavesOf(s);
  const b = roomId(s, 'B'), c = roomId(s, 'C');
  const eye = { x: 16, z: 14, floor: 0 };
  leafNear(leaves, 24, 14).open = 1;   // the walker approached; the door opened
  for (let i = 0; i < 4; i++) gate.update(eye, leaves, 'earned');
  assert.ok(gate.visible(0, b, 'earned'));
  assert.ok(!gate.visible(0, c, 'earned'), 'no cast reaches C from here');
  // Learned is kept: walk away, shut the door — B stays earned.
  leafNear(leaves, 24, 14).open = 0;
  gate.update({ x: 10, z: 22, floor: 0 }, leaves, 'earned');
  assert.ok(gate.visible(0, b, 'earned'));
});

test('strict mode shows a label only while its door is in sight', () => {
  const s = threeRooms();
  const gate = makeLabelGate(s);
  const leaves = leavesOf(s);
  const b = roomId(s, 'B');
  const eye = { x: 16, z: 14, floor: 0 };
  leafNear(leaves, 24, 14).open = 1;
  for (let i = 0; i < 4; i++) gate.update(eye, leaves, 'strict');
  assert.ok(gate.visible(0, b, 'strict'));
  // The door shuts — an agent let go of it — and the label goes with it.
  leafNear(leaves, 24, 14).open = 0;
  for (let i = 0; i < 4; i++) gate.update(eye, leaves, 'strict');
  assert.ok(!gate.visible(0, b, 'strict'));
  assert.ok(gate.visible(0, b, 'earned'), 'what strict revokes, earned remembers');
});

test('all and none override the casts entirely', () => {
  const s = threeRooms();
  const gate = makeLabelGate(s);
  const c = roomId(s, 'C');
  assert.deepEqual(LABEL_MODES, ['earned', 'strict', 'all', 'none']);
  assert.ok(gate.visible(0, c, 'all'));
  assert.ok(!gate.visible(0, c, 'none'));
  assert.equal(gate.update({ x: 16, z: 14, floor: 0 }, [], 'all').length, 0,
    'neither override spends a cast');
});

test('the round-robin converges on a budget of one cast per frame', () => {
  const s = threeRooms();
  const gate = makeLabelGate(s, { budget: 1 });
  const leaves = leavesOf(s);
  const a = roomId(s, 'A'), b = roomId(s, 'B');
  const eye = { x: 16, z: 14, floor: 0 };
  leafNear(leaves, 24, 14).open = 1;
  for (let i = 0; i < 6; i++) gate.update(eye, leaves, 'earned');
  assert.ok(gate.visible(0, a, 'earned'));
  assert.ok(gate.visible(0, b, 'earned'), 'one cast a frame still gets there');
});

test('the gate reads the storey the eye is on, not the whole building', () => {
  const s = threeRooms();
  // A second storey directly over room A, with its own name.
  addFloor(s);
  const sh = sheet(s, 1);
  sh.box(2, 2, 5, 5, { name: 'Upstairs' });
  sh.bake();
  const gate = makeLabelGate(s);
  const up = s.floors[1].shapes[0].id;
  gate.update({ x: 16, z: 14, floor: 1 }, [], 'earned');
  assert.ok(gate.visible(1, up, 'earned'));
  assert.ok(!gate.visible(0, roomId(s, 'A'), 'earned'),
    'the room below the eye was never seen, only stood over');
});

// The simulating test the conventions ask for: the sample school, stood in.
test('in the sample school, one vantage point earns some rooms and never the whole storey', () => {
  const s = buildSampleSchool();
  const gate = makeLabelGate(s);
  const leaves = leavesOf(s);
  for (const leaf of leaves) leaf.open = 1;   // every door held open
  assert.ok(doorPoints(s, 0).length >= 4, 'the sample school has doors to see');
  const biggest = s.floors[0].shapes.reduce(
    (best, r) => (!best || shapeArea(r) > shapeArea(best) ? r : best), null);
  const p = interiorPoint(biggest);   // where a walk would spawn
  const eye = { x: p.x, z: p.z, floor: 0 };
  for (let i = 0; i < 60; i++) gate.update(eye, leaves, 'earned');
  const earned = s.floors[0].shapes.filter((r) => gate.visible(0, r.id, 'earned'));
  assert.ok(gate.visible(0, biggest.id, 'earned'), 'the room underfoot is earned');
  assert.ok(earned.length < s.floors[0].shapes.length,
    'and a single vantage point never earns the whole storey');
});
