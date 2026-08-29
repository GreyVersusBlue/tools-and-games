// signage.test.mjs — the signs nobody places.
//
// Two rules carry this module and both of them are the kind that fail
// invisibly: a placard on the wrong side of the wall still renders (facing a
// classroom full of people who know where they are), and an exit sign on the
// wrong side of a door still glows (at the car park). So the assertions below
// are mostly about *which side*, plus the ADA rule that decides which jamb.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, addFloor, CELL, DOOR_H, WALL_H } from '../js/grid.js';
import { addShape, addOpening, pointInShape, LEAF_SINGLE, OP_WINDOW } from '../js/shapes.js';
import { sheet } from './build.mjs';
import { setTile, edgeHIdx, edgeVIdx, EDGE_WALL, EDGE_DOOR } from '../js/lattice.js';
import { buildSampleSchool } from '../js/sample.js';
import { buildNav } from '../js/navgraph.js';
import { bindRoom } from '../js/timetable.js';
import {
  placardsFor, exitSignsFor, signsFor, placardText, signable, useOf, exitSignY,
  PLACARD_W, PLACARD_H, PLACARD_Y, PLACARD_GAP, SIGN_CLEAR,
  EXIT_W, EXIT_H, SIGNS_PER_ROOM,
} from '../js/signage.js';

// A room off a corridor, drawn as polygons so the segment a door sits on is
// one this test wrote rather than one a bake happened to produce. The room is
// 40ft square with its first segment running east along z = 0; the corridor is
// the 12ft strip on the other side of that wall.
//
// Both halves matter. A door with the weather on one side of it is signed on
// neither, so a room floating in a void is a fixture that tests nothing — see
// the note on `doorsOn`, and the convention about testing from the state the
// caller actually produces.
function roomState(opts = {}) {
  const s = createState(20, 20);
  addShape(s, 0, [
    { x: -4, z: -12 }, { x: 44, z: -12 }, { x: 44, z: 0 }, { x: -4, z: 0 },
  ], { name: 'Main Hall' });
  const shape = addShape(s, 0, [
    { x: 0, z: 0 }, { x: 40, z: 0 }, { x: 40, z: 40 }, { x: 0, z: 40 },
  ], { name: opts.name ?? 'Room 104', ...opts });
  return { s, shape };
}

// ---------- what a plate says ----------

test('a placard splits a name into its number and what is left', () => {
  assert.deepEqual(placardText({ name: 'Room 104' }), { name: 'Room 104', number: '104', label: 'Room' });
  assert.deepEqual(placardText({ name: '104' }), { name: '104', number: '104', label: '' });
  assert.deepEqual(placardText({ name: 'Kitchen' }), { name: 'Kitchen', number: null, label: 'Kitchen' });
  assert.deepEqual(placardText({ name: 'Science Lab 212b' }),
    { name: 'Science Lab 212b', number: '212B', label: 'Science Lab' });
});

test('a placard\'s number is the number a timetable binds by', () => {
  // The reason `roomNumber` is exported from timetable.js rather than copied
  // here: the sign on the door and the schedule for the room have to agree
  // about which room 104 is.
  const pool = [
    { id: 'r1', name: 'Room 104', floor: 0 },
    { id: 'r2', name: 'Art Studio 7', floor: 0 },
  ];
  for (const room of pool) {
    const bound = bindRoom(pool, placardText(room).number);
    assert.equal(bound && bound.id, room.id, room.name);
  }
});

test('a placard survives a hostile name', () => {
  for (const name of [undefined, null, '', '   ', 42, {}]) {
    const t = placardText({ name });
    assert.equal(typeof t.name, 'string');
    assert.ok(t.number === null || typeof t.number === 'string');
  }
});

// ---------- what gets one ----------

test('a named room is signable; a corridor and a nameless room are not', () => {
  assert.equal(signable({ name: 'Room 104' }), true);
  assert.equal(signable({ name: 'Kitchen' }), true);
  assert.equal(signable({ name: 'Corridor' }), false);
  assert.equal(signable({ name: 'North Stair' }), false);
  assert.equal(signable({ name: '' }), false);
  assert.equal(signable({}), false);
  assert.equal(signable(null), false);
});

test('a room somebody re-grouped is read by the group, not the label', () => {
  // Same precedence occupancy.js uses: what a person picked beats the label.
  assert.equal(useOf({ name: 'Room 104' }), 'classroom');
  assert.equal(useOf({ name: 'Room 104', group: 'circulation' }), 'circulation');
  assert.equal(signable({ name: 'Room 104', group: 'circulation' }), false);
  assert.equal(signable({ name: 'Lobby', group: 'office' }), true);
});

// ---------- where a placard goes ----------

test('a placard stands outside the room it names', () => {
  const { s, shape } = roomState();
  addOpening(shape, 0, 0, 0.5, 3.5, { leaf: LEAF_SINGLE });
  const [sign] = placardsFor(s, 0);
  assert.ok(sign, 'a room with a door gets a plate');
  assert.equal(sign.roomId, shape.id);
  assert.equal(sign.floor, 0);
  assert.equal(pointInShape(shape, sign.x, sign.z), false,
    'the plate is not inside the classroom');
  // ...and it is only just outside: a plate a foot into the corridor is a
  // plate floating in the air.
  assert.ok(Math.abs(sign.z) < 1, `plate at z=${sign.z} is not against the wall`);
});

test('a placard faces out of the wall it is on', () => {
  const { s, shape } = roomState();
  addOpening(shape, 0, 0, 0.5, 3.5, { leaf: LEAF_SINGLE });
  const [sign] = placardsFor(s, 0);
  // Its own +Z, turned by yaw — the direction a reader stands in.
  const fx = Math.sin(sign.yaw), fz = Math.cos(sign.yaw);
  assert.equal(pointInShape(shape, sign.x + fx * 3, sign.z + fz * 3), false,
    'a reader standing in front of the plate is outside the room');
  assert.equal(pointInShape(shape, sign.x - fx * 3, sign.z - fz * 3), true,
    '...and the room is behind it');
});

test('a placard sits on the latch side, which the leaf\'s hand decides', () => {
  // ADA 703.4.2. `hand` +1 hinges at the start of the run, so the latch — and
  // the sign — is toward the far end of it.
  const mk = (hand) => {
    const { s, shape } = roomState();
    addOpening(shape, 0, 0, 0.5, 3.5, { leaf: LEAF_SINGLE, hand });
    return placardsFor(s, 0)[0];
  };
  const start = mk(1), end = mk(-1);
  // Segment 0 runs east from x=0, and the door is at its middle (x=20).
  assert.ok(start.x > 20, `hand +1 puts the plate past the door, got x=${start.x}`);
  assert.ok(end.x < 20, `hand -1 puts the plate before the door, got x=${end.x}`);
  // Mirror images about the door, to the foot.
  assert.ok(Math.abs((start.x - 20) + (end.x - 20)) < 1e-9);
});

test('a placard clears the leaf rather than sharing a jamb with it', () => {
  const { s, shape } = roomState();
  addOpening(shape, 0, 0, 0.5, 6, { leaf: LEAF_SINGLE, hand: 1 });
  const [sign] = placardsFor(s, 0);
  // Door centred at x=20 and 6ft wide, so its far jamb is at 23.
  assert.ok(sign.x - PLACARD_W / 2 >= 23 + PLACARD_GAP - 1e-9,
    `plate edge at ${sign.x - PLACARD_W / 2} overlaps the jamb at 23`);
});

test('a placard hangs where a tape measure finds one', () => {
  const { s, shape } = roomState();
  addOpening(shape, 0, 0, 0.5, 3.5, { leaf: LEAF_SINGLE });
  const [sign] = placardsFor(s, 0);
  assert.equal(sign.y, PLACARD_Y);
  // ADA 703.4.1: 48in to 60in off the floor.
  assert.ok(sign.y >= 4 && sign.y <= 5);
  assert.equal(sign.w, PLACARD_W);
  assert.equal(sign.h, PLACARD_H);
});

test('a door at the end of a short wall takes the other side rather than none', () => {
  // A 6ft stub of wall with a 3ft door in it has nowhere past the latch jamb.
  const s = createState(20, 20);
  addShape(s, 0, [
    { x: -4, z: -12 }, { x: 16, z: -12 }, { x: 16, z: 0 }, { x: -4, z: 0 },
  ], { name: 'Main Hall' });
  const shape = addShape(s, 0, [
    { x: 0, z: 0 }, { x: 12, z: 0 }, { x: 12, z: 12 }, { x: 0, z: 12 },
  ], { name: 'Room 9' });
  addOpening(shape, 0, 0, 0.86, 3, { leaf: LEAF_SINGLE, hand: 1 });
  const [sign] = placardsFor(s, 0);
  assert.ok(sign, 'the wall is long enough for a plate somewhere');
  assert.ok(sign.x < 12 - PLACARD_W / 2, 'and the plate is on the wall, not past its corner');
});

test('a window is not a door, and gets no plate', () => {
  const { s, shape } = roomState();
  addOpening(shape, 0, 0, 0.5, 6, { k: OP_WINDOW });
  assert.deepEqual(placardsFor(s, 0), []);
});

test('a room with no door has nothing to sign', () => {
  const { s } = roomState();
  assert.deepEqual(placardsFor(s, 0), []);
});

test('a room with several doors is signed, but not on every one of them', () => {
  const { s, shape } = roomState();
  addOpening(shape, 0, 0, 0.25, 3.5, { leaf: LEAF_SINGLE });
  addOpening(shape, 0, 0, 0.75, 3.5, { leaf: LEAF_SINGLE });
  addOpening(shape, 0, 1, 0.5, 3.5, { leaf: LEAF_SINGLE });
  const signs = placardsFor(s, 0);
  assert.equal(signs.length, SIGNS_PER_ROOM);
  for (const sign of signs) assert.equal(sign.roomId, shape.id);
});

test('the placard cap is a cap', () => {
  const { s, shape } = roomState();
  addOpening(shape, 0, 0, 0.25, 3.5, { leaf: LEAF_SINGLE });
  addOpening(shape, 0, 0, 0.75, 3.5, { leaf: LEAF_SINGLE });
  assert.equal(placardsFor(s, 0, { max: 1 }).length, 1);
  assert.equal(placardsFor(s, 0, { max: 0 }).length, 0);
});

test('placards are stable: the same design signs the same doors', () => {
  const { s, shape } = roomState();
  addOpening(shape, 0, 0, 0.3, 3.5, { leaf: LEAF_SINGLE });
  addOpening(shape, 0, 2, 0.6, 3.5, { leaf: LEAF_SINGLE });
  assert.deepEqual(placardsFor(s, 0), placardsFor(s, 0));
});

test('a missing storey signs nothing rather than throwing', () => {
  const s = createState(10, 10);
  assert.deepEqual(placardsFor(s, 7), []);
  assert.deepEqual(placardsFor(null, 0), []);
  assert.deepEqual(exitSignsFor(null), []);
  assert.deepEqual(exitSignsFor(createState(4, 4)), []);
});

// ---------- exit signs ----------

// A room with a door straight onto the site: one exit, one sign.
function exitState() {
  const s = createState(16, 12);
  const f = sheet(s, 0);
  f.box(2, 2, 8, 6, { name: 'Gym' });
  // A door in the south wall, onto the outdoors.
  f.edgesH[edgeHIdx(f, 5, 7)] = EDGE_DOOR;
  f.bake();
  return s;
}

test('an exit sign stands over each of the egress graph\'s own exits', () => {
  const s = exitState();
  const nav = buildNav(s);
  assert.ok(nav.exits.length >= 1, 'the fixture has an exit');
  const signs = exitSignsFor(s, { nav });
  assert.equal(signs.length, nav.exits.length);
  assert.deepEqual(signs.map((x) => x.id).sort(), nav.exits.map((p) => p.id).sort());
  for (const sign of signs) {
    assert.equal(sign.kind, 'exit');
    assert.equal(sign.floor, 0);
    assert.equal(sign.w, EXIT_W);
    assert.equal(sign.h, EXIT_H);
  }
});

test('an exit sign faces the people who are looking for the way out', () => {
  const s = exitState();
  const nav = buildNav(s);
  const [sign] = exitSignsFor(s, { nav });
  const portal = nav.exits.find((p) => p.id === sign.id);
  // The portal's normal points out of the building; the sign's heading is the
  // reverse of it, and the sign stands on the inside face of the wall.
  const fx = Math.sin(sign.yaw), fz = Math.cos(sign.yaw);
  assert.ok(fx * portal.nx + fz * portal.nz < -0.99,
    'the sign faces back into the building');
  // Standing a couple of feet in front of it puts you further inside than
  // standing at the doorway itself.
  const outX = portal.x + portal.nx, outZ = portal.z + portal.nz;
  assert.ok(Math.hypot(sign.x - outX, sign.z - outZ) > Math.hypot(portal.x - outX, portal.z - outZ),
    'the sign is on the inside of the door, not the outside');
});

test('an exit sign hangs over the door and under the ceiling', () => {
  assert.ok(exitSignY(DOOR_H, WALL_H) > DOOR_H);
  assert.ok(exitSignY(DOOR_H, WALL_H) + EXIT_H / 2 <= WALL_H);
  // The two limits argue on a low ceiling, and the ceiling wins.
  const tight = exitSignY(9, 10);
  assert.ok(tight + EXIT_H / 2 <= 10, `a sign at ${tight} pokes through a 10ft slab`);
  // ...but never so far that it is behind the door head.
  assert.ok(tight > 9);
});

test('an exit sign carries the clear width the graph priced it at', () => {
  const s = exitState();
  const nav = buildNav(s);
  const [sign] = exitSignsFor(s, { nav });
  const portal = nav.exits.find((p) => p.id === sign.id);
  assert.equal(sign.clear, portal.w);
});

test('exit signs build their own graph when the caller has none', () => {
  const s = exitState();
  assert.deepEqual(exitSignsFor(s), exitSignsFor(s, { nav: buildNav(s) }));
});

// ---------- both, per storey ----------

test('signsFor hands back only this storey\'s signs', () => {
  const s = exitState();
  addFloor(s);
  const up = sheet(s, 1);
  up.box(2, 2, 8, 6, { name: 'Room 201' });
  up.edgesH[edgeHIdx(up, 5, 7)] = EDGE_DOOR;
  up.bake();

  const ground = signsFor(s, 0);
  const upper = signsFor(s, 1);
  assert.ok(ground.exits.length >= 1);
  // An exterior door on the first floor is not an exit: there is nothing on
  // the far side of it. navgraph refuses it, so no sign stands over it.
  assert.equal(upper.exits.length, 0);
  for (const sign of upper.placards) assert.equal(sign.floor, 1);
  for (const sign of ground.placards) assert.equal(sign.floor, 0);
});

test('the sample school signs its rooms and its ways out', () => {
  // The one fixture that is a real building rather than a hand-made box.
  const s = buildSampleSchool();
  const nav = buildNav(s);
  const exits = exitSignsFor(s, { nav });
  assert.ok(exits.length > 0, 'a school has a way out and a sign over it');

  const named = [];
  for (let i = 0; i < s.floors.length; i++) {
    const { placards: p } = signsFor(s, i, { exits });
    for (const sign of p) {
      named.push(sign.name);
      assert.equal(sign.floor, i);
      assert.ok(sign.name.trim().length > 0);
      assert.ok(Number.isFinite(sign.x) && Number.isFinite(sign.z) && Number.isFinite(sign.yaw));
      assert.ok(sign.y > 0 && sign.y < WALL_H);
    }
  }
  // The regression that made this module read every door on the storey rather
  // than every door a room owns: 105 and 106 have no opening on their own
  // rings at all — theirs belong to the corridor they share a wall with — and
  // an earlier cut of this signed neither of them.
  for (const room of ['Room 101', 'Room 105', 'Room 106', 'Room 205', 'Learning Commons']) {
    assert.ok(named.includes(room), `${room} got no plate; signed ${named.join(', ')}`);
  }
  // No room is signed twice over on the same door.
  assert.equal(new Set(named).size, named.length);
});

test('a placard stands proud of its wall by the clearance it declares', () => {
  const { s, shape } = roomState();
  addOpening(shape, 0, 0, 0.5, 3.5, { leaf: LEAF_SINGLE });
  const [sign] = placardsFor(s, 0);
  // Segment 0 lies on z = 0, so the standoff is the whole of |z|: half an
  // exterior wall (this room has open air on the far side) plus the clearance.
  assert.ok(Math.abs(Math.abs(sign.z) - SIGN_CLEAR) > 0, 'the plate is off the centreline');
  assert.ok(Math.abs(sign.z) >= SIGN_CLEAR);
});
