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
  curveSegment, straightenRun, segAccent, setSegAccent, accentSpans, spanOverlap,
  accentBreaks, addOpening,
  SEG_NONE, SEG_WALL,
} from '../js/shapes.js';
import { serialize, deserialize } from '../js/save-load.js';
import { DEFAULT_PAINT, wallFaceRuns, wallPaint } from '../js/finish.js';
import { paintCells, reapplyAccents, splitAtBreaks } from '../js/paint.js';
import {
  wallAlongSeg, addWallLine, pruneAccents, eraseSegWall, eraseWallLineAt,
} from '../js/wallrun.js';

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

// ---------- the brush's re-bake (#846) ----------
//
// A stroke of the floor brush redraws every room on the storey that sits on
// the lattice: new rings, new segment numbers. The fixture's cells are 4ft, so
// A is cells x 1..3, B is x 4..6 (both y 1..2) and the hall is x 1..6, y 3..4.

const allPlaces = (s) => Object.fromEntries(
  s.floors[0].shapes.map((sh) => [sh.name, sh.rings.flatMap((r) => accentPlaces(r))]));

test('an accent is found again by its line and its direction, not its number', () => {
  const { shape } = roomWithASplitWall();
  setSegAccent(shape, 0, segBetween(shape, 16, 4, 28, 4), GREEN);
  const spans = accentSpans(shape);
  assert.equal(spans.length, 1);
  const [span] = spans;
  assert.equal(span.paint, GREEN);
  // The ring was turned to run CCW, so read the span's own direction.
  const a = { x: span.ax, z: span.az }, b = { x: span.bx, z: span.bz };
  assert.deepEqual([a.x, b.x].sort((p, q) => p - q), [16, 28]);
  const at = (x) => ({ x, z: 4 });
  const dir = Math.sign(b.x - a.x);
  const lo = dir > 0 ? 16 : 28;           // the end the span starts from
  assert.equal(spanOverlap(span, a, b), 12, 'itself');
  assert.equal(spanOverlap(span, b, a), 0, 'the far face runs the other way');
  assert.equal(spanOverlap(span, at(lo - dir * 6), at(lo + dir * 5)), 5, 'a segment half off its end');
  assert.equal(spanOverlap(span, at(lo + dir * 2), at(lo + dir * 5)), 3, 'a segment inside it');
  assert.equal(spanOverlap(span, at(lo - dir * 12), at(lo)), 0, 'the next wall along the same line');
  assert.equal(spanOverlap(span, { x: a.x, z: 8 }, { x: b.x, z: 8 }), 0, 'a parallel wall');
  assert.equal(spanOverlap(span, a, { x: a.x, z: 12 }), 0, 'a wall round the corner');
  assert.deepEqual(accentSpans(null), []);
  assert.deepEqual(accentSpans({ rings: [{ pts: shape.rings[0].pts }] }), []);
});

test('a brush stroke somewhere else leaves every accent on the wall it was on', () => {
  const s = twoRoomsAndAHall(), A = named(s, 'A'), B = named(s, 'B');
  setSegAccent(A, 0, segBetween(A, 4, 4, 16, 4), GREEN);
  // B's face of the partition, which is on A's ring: B's own segment is empty.
  const shared = segBetween(B, 16, 4, 16, 12);
  assert.equal(B.rings[0].walls[shared], SEG_NONE);
  setSegAccent(B, 0, shared, GOLD);
  // A second colour on A, so "the room's accent" is not one answer.
  setSegAccent(A, 0, segBetween(A, 4, 4, 4, 12), '#112233');
  const before = allPlaces(s);
  assert.deepEqual(before, {
    A: [`16,4>4,4:${GREEN}`, '4,12>4,4:#112233'], B: [`16,12>16,4:${GOLD}`], Hall: [],
  });
  const out = paintCells(s, 0, [{ x: 12, y: 12 }], true);
  assert.equal(out.changed, 1);
  assert.notEqual(named(s, 'A'), A, 'the brush did redraw the room');
  const after = allPlaces(s);
  delete after.undefined;
  assert.deepEqual({ A: after.A, B: after.B, Hall: after.Hall }, before);
  // And the face is painted: the north wall of A, read toward +x, has A on
  // its left.
  assert.equal(wallFaceRuns(s.floors[0], 4, 4, 16, 4)[0].left, GREEN);
  assert.equal('accents' in named(s, 'Hall').rings[0], false, 'no key on a ring with no accent');
});

test('a notch erased out of an accent wall keeps the accent on what is left of its line', () => {
  const s = twoRoomsAndAHall();
  setSegAccent(named(s, 'A'), 0, segBetween(named(s, 'A'), 4, 4, 16, 4), GREEN);
  // The north-west cell of A goes: the north wall is x 8..16 now, and the
  // notch's two new walls (x 4..8 at z 8, z 4..8 at x 8) were never accented.
  assert.equal(paintCells(s, 0, [{ x: 1, y: 1 }], false).changed, 1);
  assert.deepEqual(allPlaces(s).A, [`16,4>8,4:${GREEN}`]);
});

test('an accent wall erased whole takes its accent with it', () => {
  const s = twoRoomsAndAHall();
  setSegAccent(named(s, 'A'), 0, segBetween(named(s, 'A'), 4, 4, 16, 4), GREEN);
  paintCells(s, 0, [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }], false);
  // The room's north wall is at z 8 now: parallel to the old one, not on it.
  const A = named(s, 'A');
  segBetween(A, 4, 8, 16, 8);
  assert.equal('accents' in A.rings[0], false);
});

test('a room the brush cuts in two keeps the accent on both halves', () => {
  const s = twoRoomsAndAHall(), hall = named(s, 'Hall');
  setSegAccent(hall, 0, segBetween(hall, 4, 20, 28, 20), GOLD);
  paintCells(s, 0, [{ x: 3, y: 3 }, { x: 3, y: 4 }], false);
  const halves = s.floors[0].shapes.filter((sh) => sh.name === 'Hall');
  assert.equal(halves.length, 2);
  assert.deepEqual(halves.flatMap((sh) => accentPlaces(sh.rings[0])).sort(),
    [`12,20>4,20:${GOLD}`, `16,20>28,20:${GOLD}`]);
});

test('a wall the brush makes longer keeps its accent, and one mostly new does not take it', () => {
  // One room, cells x 1..2, y 1..2 (x 4..12 ft), north wall accented.
  const grow = (cellsX) => {
    const s = createState(20, 20);
    sheet(s, 0).box(1, 1, 2, 2, { name: 'R' }).bake();
    const R = named(s, 'R');
    // Open the east side so painted cells join R instead of starting a room,
    // and the north side because the brush lays floor without walls and the
    // trace ends a segment where the wall does: only an open edge gets longer.
    setSegWall(R, 0, segBetween(R, 12, 4, 12, 12), SEG_NONE);
    setSegWall(R, 0, segBetween(R, 4, 4, 12, 4), SEG_NONE);
    setSegAccent(R, 0, segBetween(R, 4, 4, 12, 4), GREEN);
    const cells = [];
    for (const x of cellsX) cells.push({ x, y: 1 }, { x, y: 2 });
    paintCells(s, 0, cells, true);
    assert.equal(s.floors[0].shapes.length, 1);
    return accentPlaces(named(s, 'R').rings[0]);
  };
  // 8ft of accent on a 12ft wall, then on a 16ft one: at least half, kept.
  assert.deepEqual(grow([3]), [`16,4>4,4:${GREEN}`]);
  assert.deepEqual(grow([3, 4]), [`20,4>4,4:${GREEN}`]);
  // 8ft of a 20ft wall is not that wall's colour.
  assert.deepEqual(grow([3, 4, 5]), []);
});

// #860. Before it, the trace gave a straight wall back as one segment and the
// longer colour took all of it.
test('two colours on one straight wall are both still there after a stroke somewhere else', () => {
  const build = (cut, left = GOLD, right = GREEN) => {
    const s = createState(20, 20);
    sheet(s, 0).box(1, 1, 6, 2, { name: 'R' }).bake();
    const R = named(s, 'R');
    // A corner on the north wall (x 4..28) at `cut`, and a colour either side.
    assert.notEqual(insertVertex(R, 0, segBetween(R, 4, 4, 28, 4), cut, 4), -1);
    if (left) setSegAccent(R, 0, segBetween(R, 4, 4, cut, 4), left);
    if (right) setSegAccent(R, 0, segBetween(R, cut, 4, 28, 4), right);
    const before = JSON.stringify(R.rings);
    paintCells(s, 0, [{ x: 12, y: 12 }], true);
    return { s, R: named(s, 'R'), before };
  };
  for (const cut of [12, 20, 8]) {
    const { R, before } = build(cut);
    const place = (x0, x1, hex) => `${[`${x0},4`, `${x1},4`].sort().join('>')}:${hex}`;
    assert.deepEqual(accentPlaces(R.rings[0]), [place(cut, 28, GREEN), place(4, cut, GOLD)].sort());
    // Not only the colours: the room is the ring it was, corner and all.
    assert.equal(JSON.stringify(R.rings), before);
  }
  // A colour beside bare wall is the same case: the bare part stays bare, and
  // the short colour is not lost for being under half of the wall.
  assert.deepEqual(accentPlaces(build(20, null, GREEN).R.rings[0]), [`20,4>28,4:${GREEN}`]);
  assert.deepEqual(accentPlaces(build(20, GOLD, null).R.rings[0]), [`20,4>4,4:${GOLD}`]);
  // A second stroke finds the corner the first one put back.
  const twice = build(12);
  paintCells(twice.s, 0, [{ x: 13, y: 12 }], true);
  assert.equal(JSON.stringify(named(twice.s, 'R').rings), twice.before);
});

test('a corner with one colour both sides of it is not kept, and reapplyAccents counts', () => {
  const s = createState(20, 20);
  sheet(s, 0).box(1, 1, 6, 2, { name: 'R' }).bake();
  let R = named(s, 'R');
  assert.notEqual(insertVertex(R, 0, segBetween(R, 4, 4, 28, 4), 12, 4), -1);
  setSegAccent(R, 0, segBetween(R, 4, 4, 12, 4), GREEN);
  setSegAccent(R, 0, segBetween(R, 12, 4, 28, 4), GREEN);
  assert.deepEqual(accentBreaks(R), []);
  paintCells(s, 0, [{ x: 12, y: 12 }], true);
  R = named(s, 'R');
  assert.equal(R.rings[0].pts.length, 4);
  assert.deepEqual(accentPlaces(R.rings[0]), [`28,4>4,4:${GREEN}`]);
  // reapplyAccents says how many faces it painted.
  assert.equal(reapplyAccents(R, [{ ax: 28, az: 4, bx: 4, bz: 4, paint: GOLD },
    { ax: 4, az: 4, bx: 28, bz: 4, paint: GOLD }]), 1, 'one of the two runs the ring\'s way');
  assert.equal(reapplyAccents(R, []), 0);
});

test('accentBreaks is where a straight wall changes colour, and nowhere a wall turns', () => {
  const { shape } = roomWithASplitWall();
  // Ring: (4,4) (16,4) (28,4) (28,12) (4,12), or its reverse; find the two
  // halves of the split wall by where they are.
  const west = segBetween(shape, 4, 4, 16, 4), east = segBetween(shape, 16, 4, 28, 4);
  assert.deepEqual(accentBreaks(shape), [], 'no accents, no breaks');
  setSegAccent(shape, 0, west, GOLD);
  const [a, b] = [shape.rings[0].pts[west], shape.rings[0].pts[(west + 1) % 5]];
  const way = Math.sign(b.x - a.x);
  // One break, at the split, though the gold wall also ends at a real corner.
  assert.deepEqual(accentBreaks(shape), [{ x: 16, z: 4, ux: way, uz: 0 }]);
  setSegAccent(shape, 0, east, GREEN);
  assert.deepEqual(accentBreaks(shape), [{ x: 16, z: 4, ux: way, uz: 0 }]);
  setSegAccent(shape, 0, east, GOLD);
  assert.deepEqual(accentBreaks(shape), []);
  // An accent on a wall round a real corner from another is no break.
  setSegAccent(shape, 0, west, null);
  setSegAccent(shape, 0, east, GOLD);
  setSegAccent(shape, 0, segBetween(shape, 28, 4, 28, 12), GREEN);
  assert.deepEqual(accentBreaks(shape), [{ x: 16, z: 4, ux: way, uz: 0 }]);
  assert.deepEqual(accentBreaks(null), []);
});

test('splitAtBreaks cuts the segment that runs through a break the same way, once', () => {
  const fresh = () => {
    const s = createState(20, 20);
    sheet(s, 0).box(1, 1, 6, 2, { name: 'R' }).bake();
    return named(s, 'R');
  };
  // The north wall, x 4..28 at z 4, runs one way round the ring; `way` is it.
  let R = fresh();
  const n = segBetween(R, 4, 4, 28, 4);
  const way = Math.sign(R.rings[0].pts[(n + 1) % 4].x - R.rings[0].pts[n].x);
  assert.equal(splitAtBreaks(R, [{ x: 12, z: 4, ux: way, uz: 0 }]), 1);
  assert.equal(R.rings[0].pts.length, 5);
  segBetween(R, 4, 4, 12, 4); segBetween(R, 12, 4, 28, 4);
  // The same break again finds a corner there already.
  assert.equal(splitAtBreaks(R, [{ x: 12, z: 4, ux: way, uz: 0 }]), 0);
  // The other way along the line is the far face: some other ring's business.
  R = fresh();
  assert.equal(splitAtBreaks(R, [{ x: 12, z: 4, ux: -way, uz: 0 }]), 0);
  // Off the line, past the end of it, and on the wall's own corner: no cut.
  assert.equal(splitAtBreaks(R, [{ x: 12, z: 4.5, ux: way, uz: 0 }]), 0);
  assert.equal(splitAtBreaks(R, [{ x: 32, z: 4, ux: way, uz: 0 }]), 0);
  assert.equal(splitAtBreaks(R, [{ x: 4, z: 4, ux: way, uz: 0 }]), 0);
  assert.equal(splitAtBreaks(R, [{ x: 28, z: 4, ux: way, uz: 0 }]), 0);
  assert.equal(R.rings[0].pts.length, 4);
  // The south wall is parallel and runs the other way: a break aimed along
  // the north wall's way does not cut it either.
  assert.equal(splitAtBreaks(R, [{ x: 12, z: 12, ux: way, uz: 0 }]), 0);
  assert.equal(splitAtBreaks(R, [{ x: 12, z: 12, ux: -way, uz: 0 }]), 1);
});

test('a door on a two-colour wall is on the same piece of it after a stroke', () => {
  const s = createState(20, 20);
  sheet(s, 0).box(1, 1, 6, 2, { name: 'R' }).bake();
  let R = named(s, 'R');
  assert.notEqual(insertVertex(R, 0, segBetween(R, 4, 4, 28, 4), 12, 4), -1);
  const gold = segBetween(R, 4, 4, 12, 4), green = segBetween(R, 12, 4, 28, 4);
  setSegAccent(R, 0, gold, GOLD);
  setSegAccent(R, 0, green, GREEN);
  // One door a foot and three quarters from the break on each side of it.
  assert.ok(addOpening(R, 0, gold, R.rings[0].pts[gold].x === 4 ? 0.6875 : 0.3125, 3));
  assert.ok(addOpening(R, 0, green, R.rings[0].pts[green].x === 12 ? 0.203125 : 0.796875, 3));
  const doorsAt = (shape) => shape.rings[0].openings.map((o) => {
    const a = shape.rings[0].pts[o.seg], b = shape.rings[0].pts[(o.seg + 1) % shape.rings[0].pts.length];
    return `${a.x + (b.x - a.x) * o.t},${a.z + (b.z - a.z) * o.t} on ${[a.x, b.x].sort((p, q) => p - q).join('..')}`;
  }).sort();
  const before = doorsAt(R);
  assert.deepEqual(before, ['15.25,4 on 12..28', '9.5,4 on 4..12']);
  paintCells(s, 0, [{ x: 12, y: 12 }], true);
  R = named(s, 'R');
  assert.deepEqual(doorsAt(R), before);
  assert.deepEqual(accentPlaces(R.rings[0]), [`12,4>28,4:${GREEN}`, `12,4>4,4:${GOLD}`]);
});

test('a two-colour wall the stroke makes longer keeps its break, and the half rule its new end', () => {
  // R is cells x 1..4 (x 4..20 ft), north wall split at x 12, gold then green,
  // open to the east and along the north so painted cells lengthen the wall.
  const grow = (cellsX) => {
    const s = createState(20, 20);
    sheet(s, 0).box(1, 1, 4, 2, { name: 'R' }).bake();
    const R = named(s, 'R');
    setSegWall(R, 0, segBetween(R, 20, 4, 20, 12), SEG_NONE);
    setSegWall(R, 0, segBetween(R, 4, 4, 20, 4), SEG_NONE);
    assert.notEqual(insertVertex(R, 0, segBetween(R, 4, 4, 20, 4), 12, 4), -1);
    setSegAccent(R, 0, segBetween(R, 4, 4, 12, 4), GOLD);
    setSegAccent(R, 0, segBetween(R, 12, 4, 20, 4), GREEN);
    const cells = [];
    for (const x of cellsX) cells.push({ x, y: 1 }, { x, y: 2 });
    paintCells(s, 0, cells, true);
    assert.equal(s.floors[0].shapes.length, 1);
    return accentPlaces(named(s, 'R').rings[0]);
  };
  // Green was 8ft; the piece east of the break is 12ft, then 16ft, then 20ft.
  assert.deepEqual(grow([5]), [`12,4>24,4:${GREEN}`, `12,4>4,4:${GOLD}`]);
  assert.deepEqual(grow([5, 6]), [`12,4>28,4:${GREEN}`, `12,4>4,4:${GOLD}`]);
  assert.deepEqual(grow([5, 6, 7]), [`12,4>4,4:${GOLD}`]);
});

// ---------- is there a wall to paint (#857) ----------

test('a face has a wall when its own ring, a neighbour\'s or a free-standing wall is on its line', () => {
  const s = twoRoomsAndAHall(), f = s.floors[0], A = named(s, 'A'), B = named(s, 'B');
  const north = segBetween(A, 4, 4, 16, 4);
  assert.equal(wallAlongSeg(f, A, 0, north), true, 'its own wall');
  // B's side of the partition: B's segment is empty and A's ring holds the wall.
  const shared = segBetween(B, 16, 4, 16, 12);
  assert.equal(B.rings[0].walls[shared], SEG_NONE);
  assert.equal(wallAlongSeg(f, B, 0, shared), true, 'the neighbour\'s wall');
  // A's north wall taken down. Its west and east walls still meet the line at
  // its corners, and B's north wall carries on along the same line past x 16:
  // none of them is a wall along this face.
  setSegWall(A, 0, north, SEG_NONE);
  assert.equal(wallAlongSeg(f, A, 0, north), false, 'nothing on the line');
  // A free-standing wall six inches inside the room is not on the line: the
  // wall tool would call that the same line (0.9ft), the painter would not.
  assert.ok(addWallLine(s, 0, { x: 6, z: 4.5 }, { x: 14, z: 4.5 }));
  assert.equal(wallAlongSeg(f, A, 0, north), false, 'a parallel wall six inches away');
  // ...and one along part of it is: that part has a face.
  assert.ok(addWallLine(s, 0, { x: 8, z: 4 }, { x: 12, z: 4 }));
  assert.equal(wallAlongSeg(f, A, 0, north), true, 'a free-standing wall on the line');
  // The partition taken down: A's segment and B's are both on the line and
  // both empty, and two rooms open to each other have no wall between them.
  setSegWall(A, 0, segBetween(A, 16, 4, 16, 12), SEG_NONE);
  assert.equal(wallAlongSeg(f, B, 0, shared), false, 'an opening between two rooms');
  assert.equal(wallAlongSeg(f, A, 0, 99), false);
  assert.equal(wallAlongSeg(f, A, 3, 0), false);
  assert.equal(wallAlongSeg(f, null, 0, 0), false);
});

// ---------- an erased wall takes its accents with it (#859) ----------

test('erasing a wall takes the accent off both of its faces and no other wall', () => {
  const s = twoRoomsAndAHall(), f = s.floors[0], A = named(s, 'A'), B = named(s, 'B');
  const mine = segBetween(A, 16, 4, 16, 12), theirs = segBetween(B, 16, 4, 16, 12);
  const north = segBetween(A, 4, 4, 16, 4);
  assert.equal(B.rings[0].walls[theirs], SEG_NONE);
  setSegAccent(A, 0, mine, GREEN);
  setSegAccent(A, 0, north, GOLD);
  setSegAccent(B, 0, theirs, GOLD);
  // The partition is on A's ring. B's face of it goes with it too, though
  // B's own segment never had a wall to clear.
  assert.equal(eraseSegWall(f, A, 0, mine), true);
  assert.equal(A.rings[0].walls[mine], SEG_NONE);
  assert.equal(segAccent(A.rings[0], mine), null);
  assert.equal('accents' in B.rings[0], false, 'B\'s only accent went, and the key with it');
  assert.equal(segAccent(A.rings[0], north), GOLD, 'a wall still standing keeps its accent');
  // Nothing to erase the second time, and nothing more comes off.
  assert.equal(eraseSegWall(f, A, 0, mine), false);
  assert.equal(pruneAccents(f), 0);
});

test('an accent stays while any wall is left on its line, and goes with the last one', () => {
  const s = twoRoomsAndAHall(), f = s.floors[0], A = named(s, 'A');
  const north = segBetween(A, 4, 4, 16, 4);
  setSegAccent(A, 0, north, GREEN);
  assert.ok(addWallLine(s, 0, { x: 8, z: 4 }, { x: 12, z: 4 }));
  assert.equal(eraseSegWall(f, A, 0, north), true);
  assert.equal(segAccent(A.rings[0], north), GREEN, 'the free-standing wall is still a wall there');
  // A miss erases nothing and prunes nothing.
  assert.equal(eraseWallLineAt(f, 10, 9, 0.5), null);
  assert.equal(segAccent(A.rings[0], north), GREEN);
  assert.ok(eraseWallLineAt(f, 10, 4, 0.5));
  assert.equal('accents' in A.rings[0], false);
});

test('pruneAccents counts what it took off and leaves an accent with a wall alone', () => {
  const s = twoRoomsAndAHall(), f = s.floors[0], A = named(s, 'A'), B = named(s, 'B');
  const mine = segBetween(A, 16, 4, 16, 12), theirs = segBetween(B, 16, 4, 16, 12);
  setSegAccent(A, 0, mine, GREEN);
  setSegAccent(B, 0, theirs, GOLD);
  setSegAccent(B, 0, segBetween(B, 28, 4, 28, 12), GOLD);
  assert.equal(pruneAccents(f), 0);
  // The shapes.js call, which knows nothing of the storey, leaves both.
  setSegWall(A, 0, mine, SEG_NONE);
  assert.equal(segAccent(A.rings[0], mine), GREEN);
  assert.equal(pruneAccents(f), 2);
  assert.deepEqual(accentPlaces(B.rings[0]), [`28,12>28,4:${GOLD}`]);
  assert.equal(pruneAccents(null), 0);
});

test('a file that holds an accent with no wall loads without it, and every other accent loads', () => {
  const s = twoRoomsAndAHall(), A = named(s, 'A'), B = named(s, 'B');
  const mine = segBetween(A, 16, 4, 16, 12), theirs = segBetween(B, 16, 4, 16, 12);
  setSegAccent(A, 0, segBetween(A, 4, 4, 16, 4), GOLD);
  setSegAccent(B, 0, theirs, GREEN);
  // Every accent has a wall: the file is read back as the bytes it was.
  const whole = serialize(s);
  assert.equal(serialize(deserialize(whole)), whole);
  // The file an older build wrote after the partition was erased.
  setSegAccent(A, 0, mine, GREEN);
  setSegWall(A, 0, mine, SEG_NONE);
  const old = serialize(s);
  assert.equal((old.match(/"accents"/g) || []).length, 2);
  const back = deserialize(old);
  const a = named(back, 'A'), b = named(back, 'B');
  assert.deepEqual(accentPlaces(a.rings[0]), [`16,4>4,4:${GOLD}`]);
  assert.equal('accents' in b.rings[0], false);
  assert.equal(a.rings[0].walls[segBetween(a, 16, 4, 16, 12)], SEG_NONE);
  // And it is stable: saved and loaded again it is the same file.
  assert.equal(serialize(deserialize(serialize(back))), serialize(back));
});

test('a file whose accent leans on a free-standing wall keeps it on load', () => {
  const s = twoRoomsAndAHall(), f = s.floors[0], A = named(s, 'A');
  const north = segBetween(A, 4, 4, 16, 4);
  setSegAccent(A, 0, north, GREEN);
  assert.ok(addWallLine(s, 0, { x: 8, z: 4 }, { x: 12, z: 4 }));
  setSegWall(A, 0, north, SEG_NONE);
  assert.equal(pruneAccents(f), 0);
  const back = deserialize(serialize(s));
  assert.deepEqual(accentPlaces(named(back, 'A').rings[0]), [`16,4>4,4:${GREEN}`]);
});
