// Accent walls (#827): one wall of a room painted a different colour from the
// rest of it. shapes.js stores it (`ring.accents`, beside `walls`) and keeps
// it on its segment through every edit; finish.js's `facePainter` reads it
// into the face of whatever run lies along that segment. Run `node --test`
// from Projects/school-generator.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, duplicateFloor } from '../js/grid.js';
import { sheet } from './build.mjs';
import {
  addShape, cloneShape, orientRing, insertVertex, deleteVertex, setSegWall,
  curveSegment, straightenRun, segAccent, setSegAccent, SEG_NONE, SEG_WALL,
} from '../js/shapes.js';
import { serialize, deserialize } from '../js/save-load.js';
import { DEFAULT_PAINT, wallFaceRuns, wallPaint } from '../js/finish.js';

const GREEN = '#00aa00', GOLD = '#ccaa00';

// test/finish.test.mjs's fixture: a red room and a blue room side by side
// with a plain hall under both. In feet, A is x 4..16 and B is x 16..28, both
// z 4..12; the hall is x 4..28, z 12..20. The bake keeps a shared wall on one
// ring: the partition at x 16 is A's, and B's segment there is SEG_NONE.
function twoRoomsAndAHall() {
  const s = createState(20, 20);
  sheet(s, 0)
    .box(1, 1, 3, 2, { name: 'A', paint: '#aa0000' })
    .box(4, 1, 6, 2, { name: 'B', paint: '#0000aa' })
    .box(1, 3, 6, 4, { name: 'Hall' })
    .bake();
  return s;
}
const named = (s, name) => s.floors[0].shapes.find((sh) => sh.name === name);

// The segment of a room's outer ring that joins two points, either way round.
function segBetween(shape, x0, z0, x1, z1) {
  const pts = shape.rings[0].pts;
  const is = (p, x, z) => Math.abs(p.x - x) < 1e-6 && Math.abs(p.z - z) < 1e-6;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    if ((is(a, x0, z0) && is(b, x1, z1)) || (is(a, x1, z1) && is(b, x0, z0))) return i;
  }
  throw new Error(`no segment from ${x0},${z0} to ${x1},${z1}`);
}

// Where a ring's accents are, as "x,z>x,z:hex", so a test can say an accent
// is still on the same piece of wall after the ring was renumbered.
const accentPlaces = (ring) => ring.pts.map((p, i) => {
  const q = ring.pts[(i + 1) % ring.pts.length];
  const ends = [`${p.x},${p.z}`, `${q.x},${q.z}`].sort().join('>');
  return segAccent(ring, i) ? `${ends}:${segAccent(ring, i)}` : null;
}).filter(Boolean).sort();

// One 24ft by 8ft room, x 4..28 and z 4..12, with a corner in the middle of
// its north wall at x 16. Painted grey.
function roomWithASplitWall() {
  const s = createState(20, 20);
  const shape = addShape(s, 0, [
    { x: 4, z: 4 }, { x: 16, z: 4 }, { x: 28, z: 4 }, { x: 28, z: 12 }, { x: 4, z: 12 },
  ], { paint: '#808080' });
  return { s, shape, f: s.floors[0] };
}

test('an accent paints the room\'s own face of that wall and nothing else', () => {
  const s = twoRoomsAndAHall(), f = s.floors[0], A = named(s, 'A');
  assert.equal(setSegAccent(A, 0, segBetween(A, 16, 4, 16, 12), GREEN), true);
  // The partition read toward +z: the left-hand normal points at -x, at A.
  assert.deepEqual(wallFaceRuns(f, 16, 4, 16, 12), [
    { t0: 0, t1: 1, left: GREEN, right: '#0000aa', body: '#0000aa' },
  ]);
  // Read the other way the faces swap names and keep their rooms.
  assert.deepEqual(wallFaceRuns(f, 16, 12, 16, 4), [
    { t0: 0, t1: 1, left: '#0000aa', right: GREEN, body: '#0000aa' },
  ]);
  // A's west wall is parallel to the partition and 12ft from it: still red,
  // whichever way it is read.
  assert.equal(wallFaceRuns(f, 4, 4, 4, 12)[0].right, '#aa0000');
  assert.equal(wallFaceRuns(f, 4, 12, 4, 4)[0].left, '#aa0000');
  // A run that is half the partition is one stretch, all of it the accent.
  assert.deepEqual(wallFaceRuns(f, 16, 4, 16, 8), [
    { t0: 0, t1: 1, left: GREEN, right: '#0000aa', body: '#0000aa' },
  ]);
  // ...and so are its north and south walls.
  assert.equal(wallFaceRuns(f, 4, 4, 16, 4)[0].left, '#aa0000');
  assert.equal(wallFaceRuns(f, 4, 12, 16, 12)[0].right, '#aa0000');
  // The top and the ends keep the one-colour rule: an accent is a face.
  assert.equal(wallFaceRuns(f, 16, 4, 16, 12)[0].body, wallPaint(f, 16, 4, 16, 12));
});

test('the room whose ring does not hold the shared wall can accent its face of it', () => {
  const s = twoRoomsAndAHall(), f = s.floors[0], B = named(s, 'B');
  const seg = segBetween(B, 16, 4, 16, 12);
  assert.equal(B.rings[0].walls[seg], SEG_NONE, 'the bake left the partition on A\'s ring');
  assert.equal(setSegAccent(B, 0, seg, GOLD), true);
  assert.deepEqual(wallFaceRuns(f, 16, 4, 16, 12), [
    { t0: 0, t1: 1, left: '#aa0000', right: GOLD, body: '#0000aa' },
  ]);
});

test('an accent ends at the corner its segment ends at', () => {
  const { shape, f } = roomWithASplitWall();
  setSegAccent(shape, 0, segBetween(shape, 16, 4, 28, 4), GREEN);
  // The whole north wall as one run toward +x: the room is at +z, its left.
  // Nothing crosses the probe line at x 16, and the paint changes there.
  assert.deepEqual(wallFaceRuns(f, 4, 4, 28, 4), [
    { t0: 0, t1: 0.5, left: '#808080', right: null, body: '#808080' },
    { t0: 0.5, t1: 1, left: GREEN, right: null, body: '#808080' },
  ]);
  // A run that overshoots both ends, x 0..40: the accent is x 16..28 of it.
  const long = wallFaceRuns(f, 40, 4, 0, 4);
  assert.deepEqual(long.map((r) => r.right), [null, GREEN, '#808080', null]);
  assert.ok(Math.abs(long[1].t0 - 12 / 40) < 1e-9 && Math.abs(long[1].t1 - 24 / 40) < 1e-9,
    `the accent is ${long[1].t0}..${long[1].t1} of the run, not 0.3..0.6`);
});

test('a wall that only meets the accent wall at a corner is not accented', () => {
  const s = createState(20, 20);
  // A right triangle: north wall z 4, east wall x 24, and a hypotenuse from
  // (24, 24) to (4, 4) that touches each of the other two's lines at one end.
  const tri = addShape(s, 0, [{ x: 4, z: 4 }, { x: 24, z: 4 }, { x: 24, z: 24 }], { paint: '#808080' });
  setSegAccent(tri, 0, segBetween(tri, 24, 24, 4, 4), GREEN);
  const f = s.floors[0];
  assert.deepEqual(wallFaceRuns(f, 4, 4, 24, 4).map((r) => [r.t0, r.t1, r.left, r.right]),
    [[0, 1, '#808080', null]]);
  assert.deepEqual(wallFaceRuns(f, 24, 4, 24, 24).map((r) => [r.t0, r.t1, r.left, r.right]),
    [[0, 1, '#808080', null]]);
  // ...and the hypotenuse itself is, to the corner, either way round.
  assert.deepEqual(wallFaceRuns(f, 4, 4, 24, 24).map((r) => [r.t0, r.t1, r.left, r.right]),
    [[0, 1, null, GREEN]]);
  assert.deepEqual(wallFaceRuns(f, 24, 24, 4, 4).map((r) => [r.t0, r.t1, r.left, r.right]),
    [[0, 1, GREEN, null]]);
});

test('an accent belongs to the room in front of the face, not to one drawn under it', () => {
  const s = createState(20, 20);
  // R is x 4..28, z 4..20 with an accent on its whole north wall. S is drawn
  // over R's north-west corner, x 4..16, z 4..12, and is the room you are
  // standing in there.
  const R = addShape(s, 0, [{ x: 4, z: 4 }, { x: 28, z: 4 }, { x: 28, z: 20 }, { x: 4, z: 20 }], {});
  addShape(s, 0, [{ x: 4, z: 4 }, { x: 16, z: 4 }, { x: 16, z: 12 }, { x: 4, z: 12 }], { paint: '#0000aa' });
  setSegAccent(R, 0, segBetween(R, 4, 4, 28, 4), GREEN);
  assert.deepEqual(wallFaceRuns(s.floors[0], 4, 4, 28, 4).map((r) => [r.t0, r.t1, r.left]), [
    [0, 0.5, '#0000aa'],
    [0.5, 1, GREEN],
  ]);
});

test('a ring nobody has accented carries no key, and is saved as the bytes it was', () => {
  const s = twoRoomsAndAHall();
  const before = serialize(s);
  assert.ok(!before.includes('accents'), 'a design with no accent wall writes no accents key');
  assert.equal(serialize(deserialize(before)), before);
  // Painting one and unpainting it leaves nothing behind either.
  const A = named(s, 'A');
  const seg = segBetween(A, 16, 4, 16, 12);
  setSegAccent(A, 0, seg, GREEN);
  assert.ok(serialize(s).includes('"accents"'));
  assert.equal(setSegAccent(A, 0, seg, null), true);
  assert.equal('accents' in A.rings[0], false);
  assert.equal(serialize(s), before);
});

test('an accent survives a save and a load on the same wall', () => {
  const s = twoRoomsAndAHall(), A = named(s, 'A');
  setSegAccent(A, 0, segBetween(A, 16, 4, 16, 12), '#00AA00');
  const back = deserialize(serialize(s));
  assert.deepEqual(accentPlaces(named(back, 'A').rings[0]), ['16,12>16,4:#00aa00']);
  assert.deepEqual(wallFaceRuns(back.floors[0], 16, 4, 16, 12), wallFaceRuns(s.floors[0], 16, 4, 16, 12));
  assert.equal(wallFaceRuns(back.floors[0], 16, 4, 16, 12)[0].left, GREEN);
});

test('a file\'s accents are read as colours or as nothing', () => {
  const s = twoRoomsAndAHall();
  const raw = JSON.parse(serialize(s));
  const ring = raw.floors[0].shapes.find((sh) => sh.name === 'A').rings[0];
  // Not an array, and an array with no colour in it: no key.
  for (const junk of ['#00aa00', { 1: '#00aa00' }, [null, 'green', 7, '#abc'], []]) {
    ring.accents = junk;
    const back = deserialize(JSON.stringify(raw));
    assert.equal('accents' in named(back, 'A').rings[0], false, JSON.stringify(junk));
  }
  // One good colour among junk, and more entries than the ring has corners.
  ring.accents = ['javascript:alert(1)', '#ABCDEF', null, 5, '#00aa00', '#00aa00'];
  const back = deserialize(JSON.stringify(raw));
  assert.deepEqual(named(back, 'A').rings[0].accents, [null, '#abcdef', null, null]);
  // A ring that loses a point on the way in has renumbered its segments, and
  // its accents are dropped rather than moved to another wall.
  ring.pts.splice(1, 0, { x: ring.pts[0].x + 0.01, z: ring.pts[0].z });
  ring.accents = [null, null, '#00aa00', null, null];
  const cleaned = deserialize(JSON.stringify(raw));
  assert.equal(named(cleaned, 'A').rings[0].pts.length, 4);
  assert.equal('accents' in named(cleaned, 'A').rings[0], false);
});

test('setSegAccent refuses what it cannot store and reports what it changed', () => {
  const s = twoRoomsAndAHall(), A = named(s, 'A');
  assert.equal(setSegAccent(A, 0, 1, 'green'), false, 'not a hex');
  assert.equal(setSegAccent(A, 0, 4, GREEN), false, 'a four-sided ring has no segment 4');
  assert.equal(setSegAccent(A, 0, -1, GREEN), false);
  assert.equal(setSegAccent(A, 1, 0, GREEN), false, 'no such ring');
  assert.equal('accents' in A.rings[0], false, 'a refusal leaves no array behind');
  assert.equal(setSegAccent(A, 0, 1, null), false, 'unpainting a plain wall changes nothing');
  assert.equal(setSegAccent(A, 0, 1, GREEN), true);
  assert.equal(setSegAccent(A, 0, 1, '#00AA00'), false, 'the same colour again changes nothing');
  assert.deepEqual(A.rings[0].accents, [null, GREEN, null, null]);
  assert.equal(segAccent(A.rings[0], 1), GREEN);
  assert.equal(segAccent(A.rings[0], 0), null);
  assert.equal(setSegAccent(A, 0, 1, 'green'), false, 'and a bad colour is not a way to unpaint');
  assert.equal(segAccent(A.rings[0], 1), GREEN);
});

test('turning a ring round leaves an accent on the wall it was on', () => {
  const { shape } = roomWithASplitWall();
  const ring = shape.rings[0];
  setSegAccent(shape, 0, segBetween(shape, 16, 4, 28, 4), GREEN);
  setSegAccent(shape, 0, segBetween(shape, 4, 12, 4, 4), GOLD);
  const was = accentPlaces(ring);
  assert.deepEqual(was, ['16,4>28,4:#00aa00', '4,12>4,4:#ccaa00']);
  const first = ring.pts[0];
  orientRing(ring, false);
  assert.notEqual(ring.pts[0], first, 'the ring was reversed');
  assert.deepEqual(accentPlaces(ring), was);
  orientRing(ring, true);
  assert.deepEqual(accentPlaces(ring), was);
});

test('splitting an accent wall gives both halves the accent, and merging keeps it', () => {
  const s = twoRoomsAndAHall(), f = s.floors[0], A = named(s, 'A');
  const ring = A.rings[0];
  const seg = segBetween(A, 16, 4, 16, 12);
  setSegAccent(A, 0, seg, GREEN);
  const at = insertVertex(A, 0, seg, 16, 8);
  assert.equal(ring.pts.length, 5);
  assert.equal(ring.accents.length, 5);
  assert.deepEqual(accentPlaces(ring), ['16,12>16,8:#00aa00', '16,4>16,8:#00aa00']);
  assert.deepEqual(wallFaceRuns(f, 16, 4, 16, 12).map((r) => [r.t0, r.t1, r.left]), [[0, 1, GREEN]]);
  // A later segment's accent moves along with its segment.
  setSegAccent(A, 0, segBetween(A, 4, 12, 4, 4), GOLD);
  const split = insertVertex(A, 0, segBetween(A, 4, 4, 16, 4), 10, 4);
  assert.ok(split > 0);
  assert.deepEqual(accentPlaces(ring),
    ['16,12>16,8:#00aa00', '16,4>16,8:#00aa00', '4,12>4,4:#ccaa00']);
  // Taking the corner at (16, 8) back out merges the halves into one wall.
  assert.equal(deleteVertex(A, 0, ring.pts.findIndex((p) => p.x === 16 && p.z === 8)), true);
  assert.equal(ring.accents.length, ring.pts.length);
  assert.deepEqual(accentPlaces(ring), ['16,12>16,4:#00aa00', '4,12>4,4:#ccaa00']);
  assert.equal(at, seg + 1);
});

test('deleting the corner an accent wall starts at hands the wall before it the say', () => {
  const { shape } = roomWithASplitWall();
  const ring = shape.rings[0];
  // Only the second half of the north wall is accented. The merged wall keeps
  // the incoming half's state, as `walls` does: plain.
  setSegAccent(shape, 0, segBetween(shape, 16, 4, 28, 4), GREEN);
  assert.equal(deleteVertex(shape, 0, ring.pts.findIndex((p) => p.x === 16 && p.z === 4)), true);
  assert.equal('accents' in ring, false, 'and an array with nothing in it is dropped');
});

test('deleting a ring\'s first corner keeps the accent of the wall that came into it', () => {
  const { shape } = roomWithASplitWall();
  const ring = shape.rings[0];
  // The wall into pts[0] is the ring's last segment, and deleting pts[0]
  // moves it down one place in the arrays.
  const n = ring.pts.length;
  const p0 = ring.pts[0], pLast = ring.pts[n - 1], p1 = ring.pts[1];
  setSegAccent(shape, 0, n - 1, GREEN);
  setSegAccent(shape, 0, n - 2, GOLD);
  assert.equal(deleteVertex(shape, 0, 0), true);
  assert.equal(ring.pts.includes(p0), false);
  assert.equal(ring.accents.length, n - 1);
  assert.equal(segAccent(ring, ring.pts.indexOf(pLast)), GREEN, 'the merged wall, pLast to p1');
  assert.equal(ring.pts[(ring.pts.indexOf(pLast) + 1) % (n - 1)], p1);
  assert.equal(ring.accents.filter((c) => c === GOLD).length, 1);
  assert.equal(ring.accents.filter((c) => c === GREEN).length, 1);
});

test('a wall that starts on an accent wall\'s corner and runs into the room is not accented', () => {
  const s = createState(20, 20);
  // A room with a point on its west side at (4, 8): two diagonals meet there,
  // and both are accented. A wall from the point straight into the room along
  // z 8 has the room in front of both faces, and each diagonal has one end on
  // its line and overlaps the first 8ft of it.
  const room = addShape(s, 0, [
    { x: 12, z: 4 }, { x: 28, z: 4 }, { x: 28, z: 12 }, { x: 12, z: 12 }, { x: 4, z: 8 },
  ], { paint: '#808080' });
  setSegAccent(room, 0, segBetween(room, 12, 12, 4, 8), GREEN);
  setSegAccent(room, 0, segBetween(room, 4, 8, 12, 4), GREEN);
  for (const run of [wallFaceRuns(s.floors[0], 4, 8, 20, 8), wallFaceRuns(s.floors[0], 20, 8, 4, 8)]) {
    assert.deepEqual(run, [{ t0: 0, t1: 1, left: '#808080', right: '#808080', body: '#808080' }]);
  }
});

test('curving an accent wall accents every chord, and straightening gives one wall back', () => {
  const s = twoRoomsAndAHall(), A = named(s, 'A');
  const ring = A.rings[0];
  const seg = segBetween(A, 16, 4, 16, 12);
  setSegAccent(A, 0, seg, GREEN);
  setSegAccent(A, 0, segBetween(A, 4, 12, 4, 4), GOLD);
  const count = curveSegment(A, 0, seg, 0.2);
  assert.ok(count >= 3, `an 8ft wall curved into ${count} chords`);
  assert.equal(ring.accents.length, ring.pts.length);
  assert.equal(ring.accents.filter((c) => c === GREEN).length, count);
  for (let i = 0; i < count; i++) assert.equal(segAccent(ring, seg + i), GREEN);
  assert.equal(accentPlaces(ring).filter((p) => p.endsWith(GOLD)).join(), '4,12>4,4:#ccaa00');
  assert.equal(straightenRun(A, 0, seg, count), true);
  assert.equal(ring.accents.length, 4);
  assert.deepEqual(accentPlaces(ring), ['16,12>16,4:#00aa00', '4,12>4,4:#ccaa00']);
  // Straightening takes the first chord's say. A curve whose only accent is
  // on a later chord straightens to a plain wall, and to no array.
  const B = named(s, 'B');
  const east = segBetween(B, 28, 4, 28, 12);
  const chords = curveSegment(B, 0, east, 0.2);
  setSegAccent(B, 0, east + 1, GOLD);
  assert.equal(straightenRun(B, 0, east, chords), true);
  assert.equal('accents' in B.rings[0], false);
});

test('taking the wall off a segment keeps the accent, because the wall may be the neighbour\'s', () => {
  const s = twoRoomsAndAHall(), f = s.floors[0], A = named(s, 'A');
  const seg = segBetween(A, 16, 4, 16, 12);
  setSegAccent(A, 0, seg, GREEN);
  assert.equal(setSegWall(A, 0, seg, SEG_NONE), true);
  assert.equal(segAccent(A.rings[0], seg), GREEN);
  assert.equal(setSegWall(A, 0, seg, SEG_WALL), true);
  assert.equal(wallFaceRuns(f, 16, 4, 16, 12)[0].left, GREEN);
});

test('a copied room and a copied storey carry their accent walls, as copies', () => {
  const s = twoRoomsAndAHall(), A = named(s, 'A');
  setSegAccent(A, 0, segBetween(A, 16, 4, 16, 12), GREEN);
  const copy = cloneShape(A);
  assert.deepEqual(copy.rings[0].accents, A.rings[0].accents);
  assert.notEqual(copy.rings[0].accents, A.rings[0].accents);
  assert.equal('accents' in cloneShape(named(s, 'B')).rings[0], false);
  const up = duplicateFloor(s, 0);
  const A2 = s.floors[up].shapes.find((sh) => sh.name === 'A');
  assert.deepEqual(A2.rings[0].accents, A.rings[0].accents);
  assert.notEqual(A2.rings[0].accents, A.rings[0].accents);
  assert.equal('accents' in s.floors[up].shapes.find((sh) => sh.name === 'B').rings[0], false);
  assert.equal(wallFaceRuns(s.floors[up], 16, 4, 16, 12)[0].left, GREEN);
});

test('a plain room is off-white beside an accent, not the accent', () => {
  const s = twoRoomsAndAHall(), f = s.floors[0], hall = named(s, 'Hall');
  // The hall's north wall, x 4..28 at z 12, is one segment of its ring and
  // two rooms' south walls. Accenting it paints the hall's face end to end
  // and leaves A's and B's faces their own.
  setSegAccent(hall, 0, segBetween(hall, 4, 12, 28, 12), GOLD);
  const runs = wallFaceRuns(f, 4, 12, 28, 12);
  assert.deepEqual(runs.map((r) => r.left), [GOLD, GOLD]);
  assert.deepEqual(runs.map((r) => r.right), ['#aa0000', '#0000aa']);
  setSegAccent(hall, 0, segBetween(hall, 4, 12, 28, 12), null);
  assert.deepEqual(wallFaceRuns(f, 4, 12, 28, 12).map((r) => r.left), [DEFAULT_PAINT, DEFAULT_PAINT]);
});
