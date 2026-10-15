// Duplicating a storey copies its free-standing walls. `duplicateFloor`
// (grid.js) copied a storey's rooms, their openings and their accent walls,
// and left `floor.walls` (wallrun.js) behind, so a garden wall, a corridor
// screen or a painted screen on Level 1 was simply not on the copy. Run
// `node --test 'test/*.test.mjs'` from Projects/school-generator.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, duplicateFloor } from '../js/grid.js';
import { addShape, SEG_GLASS, writeOpening } from '../js/shapes.js';
import { addWallLine, setLineAccent, wallLinesOf, LINE_LEFT, LINE_RIGHT } from '../js/wallrun.js';
import { serialize, deserialize } from '../js/save-load.js';

const GREEN = '#00aa00', GOLD = '#ccaa00';

// One hall, x 4..44 and z 4..20, with three free-standing walls in it: a plain
// one holding a doorway, one painted a different colour on each face, and a
// glass screen.
function hallWithThreeWalls() {
  const s = createState(20, 20);
  addShape(s, 0, [
    { x: 4, z: 4 }, { x: 44, z: 4 }, { x: 44, z: 20 }, { x: 4, z: 20 },
  ], { paint: '#808080', name: 'Hall' });
  const plain = addWallLine(s, 0, { x: 12, z: 6 }, { x: 12, z: 18 });
  plain.openings = [writeOpening(0, 0.5, 3)];
  const painted = addWallLine(s, 0, { x: 24, z: 8 }, { x: 24, z: 16 });
  setLineAccent(painted, LINE_LEFT, GREEN);
  setLineAccent(painted, LINE_RIGHT, GOLD);
  addWallLine(s, 0, { x: 36, z: 8 }, { x: 36, z: 16 }, SEG_GLASS);
  return s;
}

const ends = (l) => [l.ax, l.az, l.bx, l.bz];

test('a duplicated storey carries its free-standing walls, kind, faces and doorways', () => {
  const s = hallWithThreeWalls();
  const src = wallLinesOf(s.floors[0]);
  assert.equal(duplicateFloor(s, 0), 1);
  const copy = wallLinesOf(s.floors[1]);
  assert.equal(copy.length, 3, 'three walls on the copy');
  assert.deepEqual(copy.map(ends), src.map(ends), 'same ends, same order');
  assert.deepEqual(copy.map((l) => l.kind), src.map((l) => l.kind), 'glass stays glass');
  assert.deepEqual(copy[1].accents, [GREEN, GOLD], 'each face keeps its own colour');
  assert.equal('accents' in copy[0], false, 'an unpainted wall gains no key');
  assert.deepEqual(copy[0].openings, src[0].openings, 'the doorway comes with it');
  assert.equal('openings' in copy[2], false, 'a wall with none gains no key');
});

test('the copies are new walls: fresh ids off the one counter, no shared objects', () => {
  const s = hallWithThreeWalls();
  duplicateFloor(s, 0);
  const src = wallLinesOf(s.floors[0]), copy = wallLinesOf(s.floors[1]);
  const ids = [
    ...s.floors.flatMap((f) => f.shapes.map((sh) => sh.id)),
    ...src.map((l) => l.id), ...copy.map((l) => l.id),
  ];
  assert.equal(new Set(ids).size, ids.length, 'no id is used twice in the file');
  assert.ok(copy.every((l) => l.id < s.nextId), 'every id came off the counter');
  // Painting, moving or opening the copy leaves the original as it was.
  setLineAccent(copy[1], LINE_LEFT, GOLD);
  copy[0].openings[0].t = 0.2;
  copy[2].ax = 30;
  assert.deepEqual(src[1].accents, [GREEN, GOLD]);
  assert.equal(src[0].openings[0].t, 0.5);
  assert.equal(src[2].ax, 36);
});

test('the copy survives a save and a load as it was made', () => {
  const s = hallWithThreeWalls();
  duplicateFloor(s, 0);
  const back = deserialize(serialize(s));
  assert.deepEqual(wallLinesOf(back.floors[1]), wallLinesOf(s.floors[1]));
  assert.equal(serialize(back), serialize(s), 'written back byte for byte');
});

test('a storey with no free-standing wall duplicates with no walls key, as before', () => {
  const s = createState(20, 20);
  addShape(s, 0, [{ x: 4, z: 4 }, { x: 20, z: 4 }, { x: 20, z: 20 }, { x: 4, z: 20 }], { name: 'Room' });
  const nextId = s.nextId;
  duplicateFloor(s, 0);
  assert.equal('walls' in s.floors[1], false);
  assert.equal(s.nextId, nextId + 1, 'one id taken, for the room');
});
