// Doors and windows: the record's optional fields, the leaves an opening
// hangs, and the swing. Run `node --test` from Projects/school-generator.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CELL, DOOR_W, DOOR_H, WALL_H, EDGE_DOOR, EDGE_DOOR2, EDGE_WINDOW,
  createState, setTile, edgeHIdx, edgeVIdx,
} from '../js/grid.js';
import {
  addShape, addOpening, toggleOpening, flipOpening, openingSpec, writeOpening,
  isWindowOpening, isDoorOpening, defaultOpeningWidth, segEnds,
  OP_DOOR, OP_WINDOW, LEAF_NONE, LEAF_SINGLE, LEAF_DOUBLE,
  WINDOW_SILL, WINDOW_H, SEG_WALL,
} from '../js/shapes.js';
import { serialize, deserialize } from '../js/save-load.js';
import {
  segLeaves, leafEnd, leafSegment, leafAngle, leafDistanceTo, sideOfWall,
  collectDoorLeaves, updateLeaves, closeAll, mullionPositions, windowBand,
  gridOpeningWidth, gridDoorSpec, SWING_MAX, OPEN_NEAR, OPEN_FAR,
} from '../js/openings.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const RECT = [{ x: 0, z: 0 }, { x: 20, z: 0 }, { x: 20, z: 16 }, { x: 0, z: 16 }];

// ---------- the record ----------

test('an opening with nothing said about it is the cased hole v1 had', () => {
  const spec = openingSpec({ seg: 0, t: 0.5, w: DOOR_W });
  assert.equal(spec.kind, OP_DOOR);
  assert.equal(spec.window, false);
  assert.equal(spec.leaf, LEAF_NONE);
  assert.equal(spec.sill, 0);
  assert.equal(spec.h, DOOR_H);
  assert.equal(spec.hand, 1);
  assert.equal(spec.sw, 1);
});

test('a plain doorway still writes out as exactly three fields', () => {
  // The property that keeps v3/v4 files byte-identical through a round trip:
  // nothing is recorded unless it differs from the default.
  assert.deepEqual(writeOpening(2, 0.5, DOOR_W), { seg: 2, t: 0.5, w: DOOR_W });
  assert.deepEqual(
    writeOpening(2, 0.5, DOOR_W, { leaf: LEAF_SINGLE, lite: true }),
    { seg: 2, t: 0.5, w: DOOR_W, leaf: LEAF_SINGLE, lite: true });
});

test('a window is an opening variant, not a wall kind', () => {
  const o = writeOpening(0, 0.5, 6, { k: OP_WINDOW });
  assert.equal(isWindowOpening(o), true);
  assert.equal(isDoorOpening(o), false);
  const spec = openingSpec(o);
  assert.equal(spec.sill, WINDOW_SILL);
  assert.equal(spec.h, WINDOW_H);
  assert.equal(spec.head, WINDOW_SILL + WINDOW_H);
  assert.equal(spec.leaf, LEAF_NONE, 'a window hangs no leaf');
});

test('a window band is clamped inside the wall it sits in', () => {
  const tall = openingSpec({ k: OP_WINDOW, sill: 8, h: 40 });
  assert.ok(tall.head <= WALL_H, `head ${tall.head} fits under a ${WALL_H}ft ceiling`);
  const sunk = openingSpec({ k: OP_WINDOW, sill: -20 });
  assert.ok(sunk.sill >= 0);
  assert.deepEqual(windowBand(openingSpec({ k: OP_WINDOW })),
    { sill: WINDOW_SILL, head: WINDOW_SILL + WINDOW_H, h: WINDOW_H });
});

test('a double door defaults wider than a single one', () => {
  assert.ok(defaultOpeningWidth({ leaf: LEAF_DOUBLE }) > defaultOpeningWidth({}));
  assert.ok(defaultOpeningWidth({ k: OP_WINDOW }) >= DOOR_W);
});

test('opening options survive a save round trip', () => {
  const s = createState(20, 20);
  const shape = addShape(s, 0, RECT, { name: 'Lab' });
  addOpening(shape, 0, 0, 0.3, 6, { leaf: LEAF_DOUBLE, bar: true, sw: -1 });
  addOpening(shape, 0, 1, 0.5, 8, { k: OP_WINDOW, sill: 2.5 });
  const back = deserialize(serialize(s));
  assert.deepEqual(back.floors[0].shapes, s.floors[0].shapes);
  const [door, window] = back.floors[0].shapes[0].rings[0].openings;
  assert.equal(openingSpec(door).leaf, LEAF_DOUBLE);
  assert.equal(openingSpec(door).sw, -1);
  assert.equal(openingSpec(window).sill, 2.5);
});

test('a hostile opening is repaired to something buildable', () => {
  const s = createState(20, 20);
  const shape = addShape(s, 0, RECT, {});
  shape.rings[0].openings.push({ seg: 0, t: 0.5, w: DOOR_W, k: 99, leaf: 7, sill: 'x', h: -3 });
  const back = deserialize(serialize(s));
  const spec = openingSpec(back.floors[0].shapes[0].rings[0].openings[0]);
  assert.equal(spec.kind, OP_DOOR, 'an unknown kind is a door');
  assert.equal(spec.leaf, LEAF_NONE, 'an unknown leaf is no leaf');
  assert.ok(spec.h > 0);
});

test('the door tool re-cuts rather than removes when the kind changes', () => {
  const s = createState(20, 20);
  const shape = addShape(s, 0, RECT, {});
  const ring = shape.rings[0];
  toggleOpening(shape, 0, 0, 0.5);
  assert.equal(ring.openings.length, 1);
  // Same spot, now asked for a window: one opening, of the other kind.
  const swapped = toggleOpening(shape, 0, 0, 0.5, null, { k: OP_WINDOW });
  assert.equal(ring.openings.length, 1);
  assert.equal(isWindowOpening(swapped), true);
  // Same spot, same kind: that's a removal.
  toggleOpening(shape, 0, 0, 0.5, null, { k: OP_WINDOW });
  assert.equal(ring.openings.length, 0);
});

test('flipping a hand only means something on a door with leaves', () => {
  const plain = writeOpening(0, 0.5, DOOR_W);
  assert.equal(flipOpening(plain), false, 'a cased opening has no hand');
  const door = writeOpening(0, 0.5, DOOR_W, { leaf: LEAF_SINGLE });
  assert.equal(flipOpening(door), true);
  assert.equal(openingSpec(door).hand, -1);
  flipOpening(door);
  assert.equal(openingSpec(door).hand, 1);
  assert.equal(door.hand, undefined, 'back to the default is back to unsaid');
});

// ---------- leaves ----------

const wallSeg = [{ x: 0, z: 0 }, { x: 12, z: 0 }];

test('a single leaf hangs on the jamb its hand names and shuts across the gap', () => {
  const spec = openingSpec({ t: 0.5, w: 3, leaf: LEAF_SINGLE });
  const [leaf] = segLeaves(spec, ...wallSeg, 'k');
  assert.ok(near(leaf.hx, 4.5), 'hinged at the start jamb');
  assert.ok(near(leaf.hz, 0));
  const shut = leafEnd(leaf, 0);
  assert.ok(near(shut.x, 4.5 + leaf.len), 'shut, it lies along the wall');
  assert.ok(near(shut.z, 0));
  const open = leafEnd(leaf, 1);
  assert.ok(near(open.x, 4.5), 'open, it stands square to it');
  assert.ok(near(Math.abs(open.z), leaf.len));
});

test('the other hand hinges on the other jamb', () => {
  const spec = openingSpec({ t: 0.5, w: 3, leaf: LEAF_SINGLE, hand: -1 });
  const [leaf] = segLeaves(spec, ...wallSeg);
  assert.ok(near(leaf.hx, 7.5));
  assert.ok(near(leafEnd(leaf, 0).x, 7.5 - leaf.len), 'and shuts back the other way');
});

test('a swing side puts the open leaf on the side it names', () => {
  const left = segLeaves(openingSpec({ t: 0.5, w: 3, leaf: LEAF_SINGLE, sw: 1 }), ...wallSeg)[0];
  const right = segLeaves(openingSpec({ t: 0.5, w: 3, leaf: LEAF_SINGLE, sw: -1 }), ...wallSeg)[0];
  assert.ok(leafEnd(left, 1).z > 0, 'left of a run heading +x is +z');
  assert.ok(leafEnd(right, 1).z < 0);
});

test('a double door hangs one leaf on each jamb, both opening the same way', () => {
  const spec = openingSpec({ t: 0.5, w: 6, leaf: LEAF_DOUBLE });
  const leaves = segLeaves(spec, ...wallSeg, 'k');
  assert.equal(leaves.length, 2);
  assert.deepEqual(leaves.map((l) => l.key), ['k#0', 'k#1']);
  assert.ok(near(leaves[0].hx, 3) && near(leaves[1].hx, 9), 'a jamb each');
  assert.ok(leaves.every((l) => near(l.len, 3 - 0.06)), 'half the opening each');
  const [a, b] = leaves.map((l) => leafEnd(l, 1));
  assert.ok(Math.sign(a.z) === Math.sign(b.z), 'a pair swings as a pair');
  // Shut, they meet in the middle of the opening.
  assert.ok(Math.abs(leafEnd(leaves[0], 0).x - leafEnd(leaves[1], 0).x) < 0.2);
});

test('a leaf swings exactly a quarter turn and no further', () => {
  const [leaf] = segLeaves(openingSpec({ t: 0.5, w: 3, leaf: LEAF_SINGLE }), ...wallSeg);
  assert.ok(near(Math.abs(leafAngle(leaf, 1) - leaf.ang0), SWING_MAX));
  assert.ok(near(Math.abs(leafAngle(leaf, 5) - leaf.ang0), SWING_MAX), 'clamped past 1');
  assert.ok(near(leafAngle(leaf, -3), leaf.ang0), 'and under 0');
});

test('a cased opening and a window hang nothing at all', () => {
  assert.deepEqual(segLeaves(openingSpec({ t: 0.5, w: 3 }), ...wallSeg), []);
  assert.deepEqual(segLeaves(openingSpec({ t: 0.5, w: 6, k: OP_WINDOW }), ...wallSeg), []);
});

// ---------- collecting a storey ----------

function roomWithDoor(edge = EDGE_DOOR) {
  const s = createState(8, 8);
  const f = s.floors[0];
  for (let y = 1; y <= 4; y++) for (let x = 1; x <= 4; x++) setTile(f, x, y, true);
  f.edgesH[edgeHIdx(f, 2, 1)] = edge;
  return s;
}

test('every grid door hangs a leaf, and a window hangs none', () => {
  assert.equal(collectDoorLeaves(roomWithDoor(EDGE_DOOR), 0).length, 1);
  assert.equal(collectDoorLeaves(roomWithDoor(EDGE_DOOR2), 0).length, 2);
  assert.equal(collectDoorLeaves(roomWithDoor(EDGE_WINDOW), 0).length, 0);
  assert.equal(gridOpeningWidth(EDGE_DOOR), DOOR_W);
  assert.equal(gridOpeningWidth(EDGE_DOOR2), CELL);
  assert.ok(gridOpeningWidth(EDGE_WINDOW) < CELL);
  assert.equal(gridDoorSpec(EDGE_DOOR2).leaf, LEAF_DOUBLE);
});

test('leaf keys are stable and unique across both halves of the room model', () => {
  const s = roomWithDoor(EDGE_DOOR);
  const shape = addShape(s, 0, [
    { x: 24, z: 4 }, { x: 40, z: 4 }, { x: 40, z: 20 }, { x: 24, z: 20 },
  ], { wall: SEG_WALL });
  addOpening(shape, 0, 0, 0.5, DOOR_W, { leaf: LEAF_SINGLE });
  const keys = collectDoorLeaves(s, 0).map((l) => l.key);
  assert.equal(new Set(keys).size, keys.length, 'no two leaves share a key');
  assert.deepEqual(collectDoorLeaves(s, 0).map((l) => l.key), keys, 'and the order is fixed');
});

test('a leaf on a segment whose wall was erased is not collected', () => {
  const s = createState(20, 20);
  const shape = addShape(s, 0, RECT, {});
  addOpening(shape, 0, 0, 0.5, DOOR_W, { leaf: LEAF_SINGLE });
  assert.equal(collectDoorLeaves(s, 0).length, 1);
  shape.rings[0].walls[0] = 0;
  assert.equal(collectDoorLeaves(s, 0).length, 0);
});

// ---------- the swing ----------

const oneLeaf = () => {
  const s = createState(20, 20);
  const shape = addShape(s, 0, RECT, {});
  addOpening(shape, 0, 0, 0.5, DOOR_W, { leaf: LEAF_SINGLE });
  return closeAll(collectDoorLeaves(s, 0));
};

test('a door opens as you approach and shuts once you have gone', () => {
  const leaves = oneLeaf();
  const [leaf] = leaves;
  const away = { x: leaf.cx, z: leaf.cz + OPEN_FAR + 4 };
  const close = { x: leaf.cx, z: leaf.cz + OPEN_NEAR - 1 };

  updateLeaves(leaves, away.x, away.z, 1);
  assert.equal(leaf.open, 0, 'nothing happens from across the room');

  for (let i = 0; i < 60; i++) updateLeaves(leaves, close.x, close.z, 1 / 30);
  assert.equal(leaf.open, 1, 'stood next to, it comes fully open');

  for (let i = 0; i < 60; i++) updateLeaves(leaves, away.x, away.z, 1 / 30);
  assert.equal(leaf.open, 0, 'and shuts again behind you');
});

test('between near and far a door holds whatever it was doing', () => {
  const leaves = oneLeaf();
  const [leaf] = leaves;
  const between = (OPEN_NEAR + OPEN_FAR) / 2;
  updateLeaves(leaves, leaf.cx, leaf.cz + between, 1);
  assert.equal(leaf.open, 0, 'shut stays shut — the hysteresis band');
  for (let i = 0; i < 60; i++) updateLeaves(leaves, leaf.cx, leaf.cz + 1, 1 / 30);
  updateLeaves(leaves, leaf.cx, leaf.cz + between, 1);
  assert.equal(leaf.open, 1, 'and open stays open, so a door never flutters');
});

test('a door opens away from whoever is approaching it', () => {
  for (const side of [1, -1]) {
    const leaves = oneLeaf();
    const [leaf] = leaves;
    const at = { x: leaf.cx, z: leaf.cz + side * 2 };
    for (let i = 0; i < 60; i++) updateLeaves(leaves, at.x, at.z, 1 / 30);
    assert.equal(leaf.open, 1, 'it does open');
    assert.equal(sideOfWall(leaf, leafEnd(leaf, 1).x, leafEnd(leaf, 1).z), -side,
      'and it went the other way, so it never shoves you');
  }
});

test('a leaf will not swing through a body standing in its sweep', () => {
  const leaves = oneLeaf();
  const [leaf] = leaves;
  // Face it one way by approaching from one side, then plant a body directly
  // in the arc it is mid-way through.
  updateLeaves(leaves, leaf.cx, leaf.cz + 2, 1 / 60);
  leaf.open = 0.2;
  const blocked = leafEnd(leaf, 0.55);
  const before = leaf.open;
  for (let i = 0; i < 30; i++) updateLeaves(leaves, blocked.x, blocked.z, 1 / 30);
  assert.ok(leaf.open > before, 'it gets going');
  assert.ok(leaf.open < 1, 'but stops against them rather than sweeping through');
  assert.ok(leafDistanceTo(leaf, leaf.open, blocked.x, blocked.z) > 0.5);
});

test('closing a set puts every leaf back on its modelled hand', () => {
  const leaves = oneLeaf();
  const [leaf] = leaves;
  const modelled = leaf.turn;
  updateLeaves(leaves, leaf.cx, leaf.cz - 2, 1 / 60);
  updateLeaves(leaves, leaf.cx, leaf.cz + 2, 1 / 60);
  closeAll(leaves);
  assert.equal(leaf.open, 0);
  assert.equal(leaf.turn, modelled);
});

// ---------- glazing ----------

test('mullions never let a bay stretch past its spacing', () => {
  assert.deepEqual(mullionPositions(3, 4), [], 'one short bay, no mullion');
  assert.deepEqual(mullionPositions(8, 4), [4]);
  const wide = mullionPositions(13, 4);
  assert.equal(wide.length, 3, 'four bays, not three wide ones');
  for (let i = 0; i <= wide.length; i++) {
    const s = i === 0 ? 0 : wide[i - 1];
    const e = i === wide.length ? 13 : wide[i];
    assert.ok(e - s <= 4 + 1e-9, `bay ${i} is ${(e - s).toFixed(2)}ft`);
  }
});

test('a leaf segment is the leaf, hinge first', () => {
  const [leaf] = oneLeaf();
  const seg = leafSegment(leaf, 0.5);
  assert.ok(near(seg.ax, leaf.hx) && near(seg.az, leaf.hz));
  const e = leafEnd(leaf, 0.5);
  assert.ok(near(seg.bx, e.x) && near(seg.bz, e.z));
});
