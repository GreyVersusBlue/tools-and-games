// An accent on a free-standing wall (#910). A room's accent wall (#827) is kept on
// the room's ring; a wall drawn between two points that is nobody's side
// (wallrun.js's `floor.walls`) has no ring, so it keeps its own:
// `line.accents` is `[left, right]`, one colour a face. finish.js's
// `facePainter` is the one reader, and render.js and the walk take what it
// gives. Run `node --test 'test/*.test.mjs'` from Projects/school-generator.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState } from '../js/grid.js';
import { sheet } from './build.mjs';
import {
  addShape, removeShape, setSegWall, setSegAccent, SEG_NONE, SEG_WALL, SEG_GLASS, SEG_RAIL,
} from '../js/shapes.js';
import { serialize, deserialize, SAVE_VERSION } from '../js/save-load.js';
import { wallFaceRuns } from '../js/finish.js';
import {
  addWallLine, drawWallRun, wallLinesOf, pruneAccents, eraseWallLineAt, normalizeWallLines,
  lineAccent, setLineAccent, lineFaceAt, lineFaceInRoom, LINE_LEFT, LINE_RIGHT,
} from '../js/wallrun.js';
import { designDiff } from '../js/designdiff.js';
import { takeoff, takeoffCSV } from '../js/takeoff.js';
import { costing, costCSV } from '../js/cost.js';
import { buildSampleSchool } from '../js/sample.js';

const GREEN = '#00aa00', GOLD = '#ccaa00', GREY = '#808080';

// One grey room, x 4..28 and z 4..20, with a screen standing in the middle of
// it from (16, 8) to (16, 16). The screen runs toward +z, so its left-hand
// normal points at -x: the left face looks west and the right face east.
function hallWithAScreen() {
  const s = createState(20, 20);
  const room = addShape(s, 0, [
    { x: 4, z: 4 }, { x: 28, z: 4 }, { x: 28, z: 20 }, { x: 4, z: 20 },
  ], { paint: GREY, name: 'Hall' });
  const line = addWallLine(s, 0, { x: 16, z: 8 }, { x: 16, z: 16 });
  return { s, f: s.floors[0], room, line };
}

// ---------- the record ----------

test('a wall keeps one colour a face, and no key when neither is painted', () => {
  const { line } = hallWithAScreen();
  assert.equal('accents' in line, false);
  assert.equal(lineAccent(line, LINE_LEFT), null);
  assert.equal(setLineAccent(line, LINE_LEFT, '#00AA00'), true);
  assert.deepEqual(line.accents, [GREEN, null], 'stored lower case, the other face untouched');
  assert.equal(setLineAccent(line, LINE_LEFT, GREEN), false, 'the same colour again changes nothing');
  assert.equal(setLineAccent(line, LINE_RIGHT, GOLD), true);
  assert.deepEqual(line.accents, [GREEN, GOLD]);
  assert.equal(setLineAccent(line, LINE_LEFT, null), true);
  assert.deepEqual(line.accents, [null, GOLD]);
  assert.equal(setLineAccent(line, LINE_RIGHT, null), true);
  assert.equal('accents' in line, false, 'the last one off takes the key with it');
  assert.equal(setLineAccent(line, LINE_RIGHT, null), false, 'nothing there to take off');
});

test('a colour that is not a hex, or a face that is not a face, is refused', () => {
  const { line } = hallWithAScreen();
  assert.equal(setLineAccent(line, LINE_LEFT, 'green'), false);
  assert.equal(setLineAccent(line, LINE_LEFT, '#0a0'), false);
  assert.equal(setLineAccent(line, 2, GREEN), false);
  assert.equal(setLineAccent(null, LINE_LEFT, GREEN), false);
  assert.equal('accents' in line, false);
  // ...and a bad colour is not a way to take one off.
  setLineAccent(line, LINE_LEFT, GREEN);
  assert.equal(setLineAccent(line, LINE_LEFT, 'green'), false);
  assert.deepEqual(line.accents, [GREEN, null]);
});

// ---------- the rule: what a face is painted ----------

test('an accent paints the one face of the wall it was put on', () => {
  const { f, line } = hallWithAScreen();
  assert.deepEqual(wallFaceRuns(f, 16, 8, 16, 16), [
    { t0: 0, t1: 1, left: GREY, right: GREY, body: GREY },
  ]);
  setLineAccent(line, LINE_LEFT, GREEN);
  assert.deepEqual(wallFaceRuns(f, 16, 8, 16, 16), [
    { t0: 0, t1: 1, left: GREEN, right: GREY, body: GREY },
  ]);
  // Read the other way the faces swap names: the west face is still green.
  assert.deepEqual(wallFaceRuns(f, 16, 16, 16, 8), [
    { t0: 0, t1: 1, left: GREY, right: GREEN, body: GREY },
  ]);
  // The room's own walls are still the room's paint.
  assert.equal(wallFaceRuns(f, 4, 4, 4, 20)[0].right, GREY);
  assert.equal(wallFaceRuns(f, 28, 4, 28, 20)[0].left, GREY);
});

test('the two faces take two colours', () => {
  const { f, line } = hallWithAScreen();
  setLineAccent(line, LINE_LEFT, GREEN);
  setLineAccent(line, LINE_RIGHT, GOLD);
  assert.deepEqual(wallFaceRuns(f, 16, 8, 16, 16), [
    { t0: 0, t1: 1, left: GREEN, right: GOLD, body: GREY },
  ]);
  // The right face alone.
  setLineAccent(line, LINE_LEFT, null);
  assert.deepEqual(wallFaceRuns(f, 16, 8, 16, 16), [
    { t0: 0, t1: 1, left: GREY, right: GOLD, body: GREY },
  ]);
});

test('a wall that leaves the room is painted as far as the room goes', () => {
  // The screen from z 12 to z 28: 8ft of it in the hall, 8ft past its south
  // wall at z 20 with nothing on either side.
  const { s, f } = hallWithAScreen();
  const long = addWallLine(s, 0, { x: 10, z: 12 }, { x: 10, z: 28 });
  setLineAccent(long, LINE_LEFT, GREEN);
  assert.deepEqual(wallFaceRuns(f, 10, 12, 10, 28), [
    { t0: 0, t1: 0.5, left: GREEN, right: GREY, body: GREY },
    // No room in front: nobody's face, the facade's to cover.
    { t0: 0.5, t1: 1, left: null, right: null, body: '#f2f0ec' },
  ]);
});

test('a run only part of the wall lies along is painted on that part', () => {
  const { f, line } = hallWithAScreen();
  setLineAccent(line, LINE_RIGHT, GOLD);
  // A run from z 4 to z 20 on the screen's line: the screen is its middle half.
  assert.deepEqual(wallFaceRuns(f, 16, 4, 16, 20), [
    { t0: 0, t1: 0.25, left: GREY, right: GREY, body: GREY },
    { t0: 0.25, t1: 0.75, left: GREY, right: GOLD, body: GREY },
    { t0: 0.75, t1: 1, left: GREY, right: GREY, body: GREY },
  ]);
  // A parallel run a foot away is not this wall.
  assert.equal(wallFaceRuns(f, 17, 8, 17, 16)[0].right, GREY);
});

// Two rooms side by side, A x 4..16 and B x 16..28, z 4..12. Their partition
// at x 16 is taken off both rings and put back as a free-standing wall, which
// is how a wall on a room's line can be the line's and not the room's.
function twoRoomsAndALine() {
  const s = createState(20, 20);
  sheet(s, 0)
    .box(1, 1, 3, 2, { name: 'A', paint: '#aa0000' })
    .box(4, 1, 6, 2, { name: 'B', paint: '#0000aa' })
    .bake();
  const f = s.floors[0];
  const segOf = (shape) => {
    const pts = shape.rings[0].pts;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (a.x === 16 && b.x === 16) return i;
    }
    throw new Error('no segment at x 16');
  };
  const A = f.shapes.find((sh) => sh.name === 'A'), B = f.shapes.find((sh) => sh.name === 'B');
  setSegWall(A, 0, segOf(A), SEG_NONE);
  setSegWall(B, 0, segOf(B), SEG_NONE);
  const line = addWallLine(s, 0, { x: 16, z: 4 }, { x: 16, z: 12 });
  return { s, f, A, B, line, segOf };
}

test('a room\'s own accent on that face comes before the wall\'s', () => {
  const { f, B, line, segOf } = twoRoomsAndALine();
  // The line runs toward +z: left is A's side, right is B's.
  setLineAccent(line, LINE_LEFT, GREEN);
  setLineAccent(line, LINE_RIGHT, GREEN);
  assert.deepEqual(wallFaceRuns(f, 16, 4, 16, 12), [
    { t0: 0, t1: 1, left: GREEN, right: GREEN, body: '#0000aa' },
  ]);
  // B says gold about its own face: B's face is gold, A's is still the wall's.
  setSegAccent(B, 0, segOf(B), GOLD);
  assert.deepEqual(wallFaceRuns(f, 16, 4, 16, 12), [
    { t0: 0, t1: 1, left: GREEN, right: GOLD, body: '#0000aa' },
  ]);
});

// ---------- which face a click means ----------

test('the side of the wall the point is on is the face', () => {
  const { f, line, room } = hallWithAScreen();
  const west = lineFaceAt(f, 15, 12, 3), east = lineFaceAt(f, 17.5, 10, 3);
  assert.equal(west.line, line);
  assert.equal(west.side, LINE_LEFT);
  assert.equal(west.dist, 1);
  assert.equal(west.shape, room);
  assert.equal(east.side, LINE_RIGHT);
  assert.equal(east.dist, 1.5);
  assert.equal(lineFaceAt(f, 16, 12, 3), null, 'on the wall itself is neither side');
  assert.equal(lineFaceAt(f, 12, 12, 3), null, '4ft off is out of a 3ft reach');
  // A wall out in the open: the face is found, and it is in no room.
  const s2 = hallWithAScreen();
  const garden = addWallLine(s2.s, 0, { x: 40, z: 4 }, { x: 40, z: 12 });
  const out = lineFaceAt(s2.f, 41, 8, 3);
  assert.equal(out.line, garden);
  assert.equal(out.side, LINE_RIGHT);
  assert.equal(out.shape, null);
});

test('a face has a room in front of it or it does not', () => {
  const { s, f, line } = hallWithAScreen();
  assert.equal(lineFaceInRoom(f, line, LINE_LEFT), true);
  assert.equal(lineFaceInRoom(f, line, LINE_RIGHT), true);
  const garden = addWallLine(s, 0, { x: 40, z: 4 }, { x: 40, z: 12 });
  assert.equal(lineFaceInRoom(f, garden, LINE_LEFT), false);
  // On the hall's east wall line, x 28: the hall is to the west only. The
  // wall runs toward +z, so west is its left.
  const edge = addWallLine(s, 0, { x: 28, z: 24 }, { x: 28, z: 40 });
  edge.az = 6; edge.bz = 18;
  assert.equal(lineFaceInRoom(f, edge, LINE_LEFT), true);
  assert.equal(lineFaceInRoom(f, edge, LINE_RIGHT), false);
  // A wall with only its first 2ft in the room still has a room in front.
  const poke = addWallLine(s, 0, { x: 10, z: 18 }, { x: 10, z: 40 });
  assert.equal(lineFaceInRoom(f, poke, LINE_LEFT), true);
});

// ---------- the save ----------

test('an accent goes through the file and comes back on the same face', () => {
  const { s, line } = hallWithAScreen();
  const bare = serialize(s);
  assert.equal(bare.includes('accents'), false, 'an unpainted design writes no key');
  setLineAccent(line, LINE_RIGHT, GOLD);
  const text = serialize(s);
  assert.equal(JSON.parse(text).version, SAVE_VERSION);
  assert.equal(SAVE_VERSION, 12, 'an optional key, not a new version');
  assert.deepEqual(JSON.parse(text).floors[0].walls[0].accents, [null, GOLD]);
  const back = deserialize(text);
  const got = wallLinesOf(back.floors[0])[0];
  assert.deepEqual(got.accents, [null, GOLD]);
  assert.deepEqual(wallFaceRuns(back.floors[0], 16, 8, 16, 16), [
    { t0: 0, t1: 1, left: GREY, right: GOLD, body: GREY },
  ]);
  assert.equal(serialize(back), text, 'written back as the bytes it was read from');
  // Taken off again, the file is the one from before it was painted.
  setLineAccent(line, LINE_RIGHT, null);
  assert.equal(serialize(s), bare);
});

test('a save from before the field loads with no accent on any free-standing wall', () => {
  const { s } = hallWithAScreen();
  addWallLine(s, 0, { x: 40, z: 4 }, { x: 40, z: 12 });
  const old = serialize(s);
  assert.equal(old.includes('accents'), false);
  const back = deserialize(old);
  const lines = wallLinesOf(back.floors[0]);
  assert.equal(lines.length, 2);
  for (const l of lines) {
    assert.equal('accents' in l, false);
    assert.equal(lineAccent(l, LINE_LEFT), null);
    assert.equal(lineAccent(l, LINE_RIGHT), null);
  }
  assert.equal(serialize(back), old);
});

test('whatever a file says in `accents` is read as two hexes or nothing', () => {
  const raw = (accents) => normalizeWallLines([{ id: 7, ax: 0, az: 0, bx: 8, bz: 0, kind: SEG_WALL, accents }])[0];
  assert.deepEqual(raw(['#AABBCC']).accents, ['#aabbcc', null]);
  assert.deepEqual(raw([null, '#112233', '#445566']).accents, [null, '#112233'], 'a wall has two faces');
  assert.equal('accents' in raw(['red', 5]), false);
  assert.equal('accents' in raw('#aabbcc'), false);
  assert.equal('accents' in raw([null, null]), false);
  assert.equal('accents' in raw(undefined), false);
});

test('a file with an accent that could paint nothing loads without it', () => {
  const { s, line } = hallWithAScreen();
  const garden = addWallLine(s, 0, { x: 40, z: 4 }, { x: 40, z: 12 });
  const glass = addWallLine(s, 0, { x: 8, z: 8 }, { x: 8, z: 16 }, SEG_GLASS);
  const rail = addWallLine(s, 0, { x: 22, z: 8 }, { x: 22, z: 16 }, SEG_RAIL);
  setLineAccent(line, LINE_LEFT, GREEN);
  // Written by hand, as a file from elsewhere might be: the setter is not
  // what refuses these, the brush and the load are.
  garden.accents = [GREEN, GOLD];
  glass.accents = [GREEN, null];
  rail.accents = [null, GOLD];
  const back = deserialize(serialize(s));
  const [l0, l1, l2, l3] = wallLinesOf(back.floors[0]);
  assert.deepEqual(l0.accents, [GREEN, null], 'the screen in the hall keeps its own');
  assert.equal('accents' in l1, false, 'no room in front of either face');
  assert.equal('accents' in l2, false, 'glass is not painted');
  assert.equal('accents' in l3, false, 'a railing is not painted');
});

// ---------- edits ----------

test('the room in front of a painted face deleted, the accent comes off', () => {
  const { s, f, line, room } = hallWithAScreen();
  setLineAccent(line, LINE_LEFT, GREEN);
  setLineAccent(line, LINE_RIGHT, GOLD);
  assert.equal(pruneAccents(f), 0, 'with the room there, nothing to take off');
  assert.deepEqual(line.accents, [GREEN, GOLD]);
  removeShape(f, room.id);
  assert.equal(pruneAccents(f), 2);
  assert.equal('accents' in line, false);
  assert.equal(s.floors[0].walls.length, 1, 'the wall itself stays');
});

test('a face is pruned by itself: the other side keeps its room and its paint', () => {
  // On the hall's east wall line the hall is on the left only.
  const { s, f } = hallWithAScreen();
  const edge = addWallLine(s, 0, { x: 28, z: 24 }, { x: 28, z: 40 });
  edge.az = 6; edge.bz = 18;
  edge.accents = [GREEN, GOLD];
  assert.equal(pruneAccents(f), 1);
  assert.deepEqual(edge.accents, [GREEN, null]);
});

test('the eraser takes the wall and its accents together', () => {
  const { f, line } = hallWithAScreen();
  setLineAccent(line, LINE_LEFT, GREEN);
  assert.equal(eraseWallLineAt(f, 16, 12).id, line.id);
  assert.equal('walls' in f, false);
  assert.equal(wallFaceRuns(f, 16, 8, 16, 16)[0].left, GREY);
});

test('a wall drawn longer is still that wall, and keeps its faces', () => {
  const { s, f, line } = hallWithAScreen();
  setLineAccent(line, LINE_LEFT, GREEN);
  // Drawn on from its south end, the same way the wall runs.
  drawWallRun(s, 0, { x: 16, z: 16 }, { x: 16, z: 18 });
  let [one] = wallLinesOf(f);
  assert.equal(wallLinesOf(f).length, 1);
  assert.deepEqual([one.az, one.bz], [8, 18]);
  assert.deepEqual(one.accents, [GREEN, null]);
  // Drawn on from its north end going north: the record now runs toward -z,
  // so the west face is its right. The same side of the wall is still green.
  drawWallRun(s, 0, { x: 16, z: 8 }, { x: 16, z: 6 });
  [one] = wallLinesOf(f);
  assert.equal(wallLinesOf(f).length, 1);
  assert.deepEqual([one.az, one.bz].sort((p, q) => p - q), [6, 18]);
  assert.equal(one.bz < one.az, true, 'the record took the drawn run\'s direction');
  assert.deepEqual(one.accents, [null, GREEN]);
  assert.equal(lineFaceAt(f, 15, 12, 3).side, LINE_RIGHT);
  assert.deepEqual(wallFaceRuns(f, 16, 6, 16, 18), [
    { t0: 0, t1: 1, left: GREEN, right: GREY, body: GREY },
  ]);
});

test('two walls joined into one: the longer one\'s faces stand', () => {
  const { s, f, line } = hallWithAScreen();
  // The 8ft screen, gold on the east; a 2ft stub 2ft south of it, green west.
  setLineAccent(line, LINE_RIGHT, GOLD);
  const stub = addWallLine(s, 0, { x: 16, z: 18 }, { x: 16, z: 19.5 });
  setLineAccent(stub, LINE_LEFT, GREEN);
  drawWallRun(s, 0, { x: 16, z: 16 }, { x: 16, z: 18 });
  const lines = wallLinesOf(f);
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0].accents, [null, GOLD]);
});

test('glass drawn across the middle leaves both ends painted', () => {
  const { s, f, line } = hallWithAScreen();
  setLineAccent(line, LINE_LEFT, GREEN);
  // Drawn against the wall's direction, z 14 back to z 10.
  drawWallRun(s, 0, { x: 16, z: 14 }, { x: 16, z: 10 }, SEG_GLASS);
  const lines = wallLinesOf(f);
  const solid = lines.filter((l) => l.kind === SEG_WALL), glass = lines.filter((l) => l.kind === SEG_GLASS);
  assert.equal(solid.length, 2);
  assert.equal(glass.length, 1);
  assert.equal('accents' in glass[0], false, 'the glass is new and unpainted');
  for (const l of solid) {
    // Whichever way a piece runs, its west face is the green one.
    const west = l.bz > l.az ? LINE_LEFT : LINE_RIGHT;
    assert.equal(lineAccent(l, west), GREEN);
    assert.equal(lineAccent(l, 1 - west), null);
  }
  assert.equal(wallFaceRuns(f, 16, 8, 16, 10)[0].left, GREEN);
  assert.equal(wallFaceRuns(f, 16, 14, 16, 16)[0].left, GREEN);
});

// ---------- the other readers ----------

test('the design diff says a free-standing wall changed when a face is painted', () => {
  const { s, line } = hallWithAScreen();
  const before = deserialize(serialize(s));
  assert.equal(designDiff(before, deserialize(serialize(s))).changes.length, 0);
  setLineAccent(line, LINE_LEFT, GREEN);
  const painted = deserialize(serialize(s));
  const d = designDiff(before, painted);
  assert.equal(d.changes.length, 1);
  assert.equal(d.changes[0].kind, 'wall');
  assert.deepEqual(d.changes[0].counts, { added: 0, removed: 0, changed: 1 });
  // Repainted, and the other face: each is a change. The same paint is not.
  setLineAccent(line, LINE_LEFT, GOLD);
  assert.equal(designDiff(painted, deserialize(serialize(s))).changes.length, 1);
  const gold = deserialize(serialize(s));
  setLineAccent(line, LINE_RIGHT, GREEN);
  assert.equal(designDiff(gold, deserialize(serialize(s))).changes.length, 1, 'the right face alone');
  assert.equal(designDiff(deserialize(serialize(s)), deserialize(serialize(s))).changes.length, 0);
});

test('paint is one area in the takeoff and the estimate: an accent moves neither', () => {
  const { s, line } = hallWithAScreen();
  const t0 = takeoffCSV(takeoff(s)), c0 = costCSV(costing(s));
  setLineAccent(line, LINE_LEFT, GREEN);
  setLineAccent(line, LINE_RIGHT, GOLD);
  assert.equal(takeoffCSV(takeoff(s)), t0);
  assert.equal(costCSV(costing(s)), c0);
});

test('the sample school has no painted free-standing wall, so nothing in it can move', () => {
  const sample = buildSampleSchool();
  const text = serialize(sample);
  for (const f of sample.floors) {
    for (const l of wallLinesOf(f)) assert.equal('accents' in l, false);
    assert.equal(pruneAccents(f), 0);
  }
  assert.equal(serialize(sample), text, 'the prune a load runs takes nothing off it');
  assert.equal(serialize(deserialize(text)), text);
});
