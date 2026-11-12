// The refusals of `ringMinus` (#990): the cut of a neighbour back to a curved
// building's chords says `null` where it cannot vouch for the answer, and the
// pair then stays on its steps. test/roof-trim.test.mjs drives the cut that
// works; no school in the gallery reaches a refusal, so until this file nothing
// did. Run `node --test 'test/*.test.mjs'` from Projects/school-generator.
//
// Part one hand-builds rings and asks `ringMinus` directly, one refusal to a
// test, each beside the nearest input it does answer. Part two is the whole
// path: a curved hall with a box beside it whose cell reaches inside the
// chords, where a cut is refused and `roofPlan` keeps the one stepped parapet.

import test from 'node:test';
import assert from 'node:assert/strict';

import { ringMinus, roofPlan, roofCover, roofMask, maskOutlines, maskCount } from '../js/roof.js';
import { addShape, curveSegment } from '../js/shapes.js';
import { createState, CELL } from '../js/grid.js';

const R4 = (x0, z0, x1, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
const area = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) a += pts[i].x * pts[(i + 1) % pts.length].z - pts[(i + 1) % pts.length].x * pts[i].z;
  return a / 2;
};
const SQ = R4(0, 0, 8, 8);

// ---------- the answers it does give, so a refusal below means something ----------

test('a crossing box is cut out of the square: an L, 48 sq ft', () => {
  const out = ringMinus(SQ, R4(4, 4, 12, 12));
  assert.equal(out.length, 1);
  assert.equal(area(out[0]), 48);
});

test('a box clear of the square leaves it whole, and one round it leaves nothing', () => {
  assert.deepEqual(ringMinus(SQ, R4(20, 0, 28, 8)), [SQ]);
  assert.deepEqual(ringMinus(SQ, R4(-2, -2, 10, 10)), []);
});

test('a strip across the middle leaves two loops', () => {
  const out = ringMinus(SQ, R4(-2, 3, 10, 5));
  assert.deepEqual(out.map(area).sort(), [24, 24]);
});

// ---------- the refusals, one to a test ----------

// Checked by breaking `ringMinus` on purpose (#34, #147), the lines it keeps
// are not all alone in guarding what they claim. The parallel-edge refusal is
// covered by the touch refusal: two collinear edges that overlap always end at
// a corner of one lying on the other, and the next edge there meets the other
// ring at an end, so deleting the parallel line leaves the test below green and
// only the touch line is pinned by its own cases. The early refusal of a hole
// loop and the key collision of a sliver are likewise followed by a chain that
// does not close, so deleting either leaves its test green too. They are kept
// because a refusal that is explicit is one a later edit to the chain cannot
// quietly turn into a wrong loop, and the tests state the refusal, not which
// line makes it.
test('refused: an edge of one lies along the other', () => {
  // The box shares part of the square's east edge, x 8, z 2 to 6.
  assert.equal(ringMinus(SQ, R4(8, 2, 12, 6)), null);
  // Overlapping the edge and running past its end.
  assert.equal(ringMinus(SQ, R4(4, -4, 8, 4)), null);
  // Within the 1e-9 the lines are taken as one, so a sliver off the edge is along it.
  assert.equal(ringMinus(SQ, R4(4, -4, 12, 1e-10)), null);
  // The same edge a thousandth up is two lines, and is answered.
  assert.ok(Array.isArray(ringMinus(SQ, R4(4, -4, 12, 1e-3))));
});

test('refused: the two meet at a single point', () => {
  // Corner to corner at (8, 8).
  assert.equal(ringMinus(SQ, R4(8, 8, 12, 12)), null);
  // A corner of the box on the middle of the square's top edge.
  assert.equal(ringMinus(SQ, [{ x: 4, z: 8 }, { x: 8, z: 12 }, { x: 0, z: 12 }]), null);
  // A corner on the edge with the box's own edges leaving to one side.
  assert.equal(ringMinus(SQ, [{ x: 4, z: 8 }, { x: 6, z: 14 }, { x: 2, z: 14 }]), null);
  // One foot off, the same box is clear and the square comes back whole.
  assert.deepEqual(ringMinus(SQ, [{ x: 4, z: 9 }, { x: 8, z: 12 }, { x: 0, z: 12 }]), [SQ]);
});

test('refused: the box lies wholly inside the square, which would make a hole', () => {
  assert.equal(ringMinus(SQ, R4(2, 2, 4, 4)), null);
  // The other way round is not a refusal: nothing is left.
  assert.deepEqual(ringMinus(R4(2, 2, 4, 4), SQ), []);
});

test('refused: the square is a hole loop of the mask and the box crosses it', () => {
  const hole = [...SQ].reverse();
  assert.ok(area(hole) < 0, 'wound the other way');
  assert.equal(ringMinus(hole, R4(4, 4, 12, 12)), null);
  // A hole the box does not reach is handed back as it was.
  assert.deepEqual(ringMinus(hole, R4(20, 0, 28, 8)), [hole]);
});

test('refused: what is left is a sliver too thin to tell the corners apart', () => {
  // A box stopping 1e-7 ft short of the top edge leaves a strip whose two
  // long sides land on one key at the 1e-4 ft the pieces are keyed to.
  assert.equal(ringMinus(SQ, R4(-4, -4, 12, 8 - 1e-7)), null);
  // The same strip 1e-3 thick is told apart and kept.
  const out = ringMinus(SQ, R4(-4, -4, 12, 8 - 1e-3));
  assert.equal(out.length, 1);
  assert.ok(Math.abs(area(out[0]) - 8e-3) < 1e-9);
});

test('refused: the same ring twice', () => {
  assert.equal(ringMinus(SQ, SQ), null);
});

// ---------- the pair that stays stepped ----------

// A 20 by 16 hall whose south wall is bowed a foot out, and a box 2ft past
// its east wall that starts a foot above the hall's south edge: its first mask
// cell reaches inside the chords, the cut is asked for, and ringMinus refuses.
function school(box = true) {
  const s = createState(60, 40);
  const hall = addShape(s, 0, R4(24, 8, 44, 24));
  assert.ok(curveSegment(hall, 0, 2, -1) > 3, 'the curve tool laid a curve');
  if (box) addShape(s, 0, R4(46, 23, 58, 27));
  s.roof = { style: 'parapet', pitch: 6, facade: 'brick' };
  return s;
}
const floorOf = (s) => s.floors[0];

test('the hall alone takes its chord parapet and deck (the control)', () => {
  const plan = roofPlan(school(false));
  assert.equal(plan.deckPolys.length, 1);
  assert.ok(!plan.deckPolys[0].trim);
});

// Broken on purpose: `ringMinus` made to answer `[a]` where it says null fails
// this test. The two `includes(null)` lines in `chordPlan` guard the same
// absence (each alone leaves this test green), so it is the refusal, not
// either line, that is pinned.
test('a refused cut leaves the pair on one stepped parapet, as it was before #973', () => {
  const s = school();
  const mask = roofMask(floorOf(s), s.w, s.h);
  const plan = roofPlan(s);
  assert.equal(plan.deckPolys, undefined, 'no chord deck, and no trimmed piece either');
  assert.equal(plan.outlines.length, maskOutlines(mask).length);
  assert.deepEqual(plan.outlines, maskOutlines(mask), 'the mask\'s own loops, key for key');
  // And it is counted as the steps: the mask's cells, no chords.
  const cover = roofCover(s);
  assert.equal(cover.chords, 0);
  assert.equal(cover.footprint, maskCount(mask) * CELL * CELL);
});
