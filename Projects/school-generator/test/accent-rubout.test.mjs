// A room rubbed out from in front of a painted face (#964). A free-standing
// wall's face is painted where a room stands in front of it (#910); with no
// room there it is the weather's, the brush refuses it and a load takes its
// accent off. The floor brush's rub-out asked nothing, so the accent went on
// being written to the file until the next load or the next corner let go.
// This states that the stroke that takes the room takes the accent, and what
// it leaves alone.
// Run `node --test 'test/*.test.mjs'` from Projects/school-generator.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState } from '../js/grid.js';
import { addShape, shapesOf } from '../js/shapes.js';
import { serialize, deserialize } from '../js/save-load.js';
import { paintTiles } from '../js/paint.js';
import {
  addWallLine, wallLinesOf, setLineAccent, lineAccent, pruneAccents, LINE_LEFT, LINE_RIGHT,
} from '../js/wallrun.js';

const GREEN = '#00aa00', GOLD = '#ccaa00';

// One grey room, x 4..28 and z 4..20, with a screen in the middle of it from
// (16, 8) to (16, 16): its left face looks west and is green, its right face
// looks east and is gold.
function hall() {
  const s = createState(20, 20);
  addShape(s, 0, [
    { x: 4, z: 4 }, { x: 28, z: 4 }, { x: 28, z: 20 }, { x: 4, z: 20 },
  ], { paint: '#808080', name: 'Hall' });
  const line = addWallLine(s, 0, { x: 16, z: 8 }, { x: 16, z: 16 });
  assert.ok(setLineAccent(line, LINE_LEFT, GREEN));
  assert.ok(setLineAccent(line, LINE_RIGHT, GOLD));
  return s;
}
const faces = (s) => {
  const line = wallLinesOf(s.floors[0])[0];
  return [lineAccent(line, LINE_LEFT), lineAccent(line, LINE_RIGHT)];
};
const rub = (s, x0, z0, x1, z1) => paintTiles(s, 0, [{ x0, z0, x1, z1 }], false);
const WEST = [4, 4, 16, 20], EAST = [16, 4, 28, 20];

test('the fixture is sound: both faces painted, and nothing for a prune to find', () => {
  const s = hall();
  assert.deepEqual(faces(s), [GREEN, GOLD]);
  assert.equal(pruneAccents(s.floors[0]), 0);
});

test('rubbing out the room in front of one face takes that face\'s accent and leaves the other', () => {
  const west = hall();
  const out = rub(west, ...WEST);
  assert.ok(out.changed > 0);
  assert.equal(out.accentsOff, 1);
  assert.deepEqual(faces(west), [null, GOLD]);
  const east = hall();
  assert.equal(rub(east, ...EAST).accentsOff, 1);
  assert.deepEqual(faces(east), [GREEN, null]);
});

test('the file is what a load would make of it: nothing left for the next load to take off', () => {
  const s = hall();
  rub(s, ...WEST);
  const text = serialize(s);
  assert.equal(serialize(deserialize(text)), text);
  assert.equal(pruneAccents(s.floors[0]), 0);
  assert.ok(!text.includes(GREEN) && text.includes(GOLD));
});

test('the whole room rubbed out takes both, and the wall is written with no accents key', () => {
  const s = hall();
  const out = rub(s, 4, 4, 28, 20);
  assert.equal(out.accentsOff, 2);
  assert.equal(shapesOf(s.floors[0]).length, 0);
  const line = wallLinesOf(s.floors[0])[0];
  assert.ok(line && !('accents' in line));
});

test('a room rubbed out somewhere a face does not look keeps both accents', () => {
  const s = hall();
  // The room's east end, 8 ft clear of the screen: the face still has floor in front.
  const out = rub(s, 24, 4, 28, 20);
  assert.ok(out.changed > 0);
  assert.equal(out.accentsOff, 0);
  assert.deepEqual(faces(s), [GREEN, GOLD]);
});

test('a stroke that rubs out nothing changes nothing, a stale accent included', () => {
  const s = hall();
  rub(s, ...WEST);
  // Put the stale accent back by hand, then rub where there is no floor.
  wallLinesOf(s.floors[0])[0].accents = [GREEN, GOLD];
  const before = serialize(s);
  const out = rub(s, 40, 40, 48, 48);
  assert.equal(out.changed, 0);
  assert.equal(out.accentsOff, 0);
  assert.equal(serialize(s), before);
});

test('a stroke that lays floor asks nothing: it takes a room from in front of no face', () => {
  const s = hall();
  rub(s, ...WEST);
  wallLinesOf(s.floors[0])[0].accents = [GREEN, GOLD];
  const out = paintTiles(s, 0, [{ x0: 40, z0: 40, x1: 48, z1: 48 }], true, { name: 'Far' });
  assert.ok(out.changed > 0);
  assert.equal(out.accentsOff, 0);
  assert.deepEqual(faces(s), [GREEN, GOLD]);
});

test('a design with no accent comes out of a rub-out as the same bytes it did before', () => {
  const plain = () => {
    const s = createState(20, 20);
    addShape(s, 0, [
      { x: 4, z: 4 }, { x: 28, z: 4 }, { x: 28, z: 20 }, { x: 4, z: 20 },
    ], { paint: '#808080', name: 'Hall' });
    addWallLine(s, 0, { x: 16, z: 8 }, { x: 16, z: 16 });
    return s;
  };
  const s = plain();
  const out = rub(s, ...WEST);
  assert.equal(out.accentsOff, 0);
  assert.ok(!serialize(s).includes('accents'));
});
