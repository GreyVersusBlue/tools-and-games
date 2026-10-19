// A building is grouped for its roof by its walls, not its bounds (#991). Run
// `node --test 'test/*.test.mjs'` from Projects/school-generator.
//
// Where the top storey's outline is refused as a whole, #971 judges it
// building by building. A building used to be the rooms whose bounding boxes
// touched, so a curved hall standing in the notch of an L-shaped room of a
// courtyard building, four feet clear of every wall of it, was judged with the
// courtyard and kept its rectangles. Rooms are one building now where their walls touch or cross
// or one stands inside another; anything else stands alone.

import test from 'node:test';
import assert from 'node:assert/strict';

import { roofOutline, roofPlan } from '../js/roof.js';
import { addShape, curveSegment } from '../js/shapes.js';
import { createState } from '../js/grid.js';

const R4 = (x0, z0, x1, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];

// Four rooms closed round a 24 by 24 courtyard (x 110 to 150, z 8 to 48),
// and along their south side one L-shaped room: a wing out to x 198 that
// turns north up to z 4 at x 190 to 198. That one room's bounds run x 110 to
// 198, z 4 to 64, so they hold its notch, x 150 to 190, z 4 to 48.
function courtyardL(s) {
  addShape(s, 0, R4(110, 8, 150, 16));
  addShape(s, 0, R4(110, 40, 150, 48));
  addShape(s, 0, R4(110, 16, 118, 40));
  addShape(s, 0, R4(142, 16, 150, 40));
  addShape(s, 0, [{ x: 110, z: 48 }, { x: 190, z: 48 }, { x: 190, z: 4 }, { x: 198, z: 4 }, { x: 198, z: 64 }, { x: 110, z: 64 }]);
}

// A 20 by 24 hall, its east wall bowed out 9.6ft by the curve tool.
function hall(s, x0, z0) {
  const sh = addShape(s, 0, R4(x0, z0, x0 + 20, z0 + 24));
  assert.ok(curveSegment(sh, 0, 1, -0.4) > 3, 'the curve tool laid a curve');
  return sh;
}

function school({ at = 'notch', l = true, style = 'hip', pitch = 6 } = {}) {
  const s = createState(60, 30);
  if (l) courtyardL(s);
  // In the notch: x 156 to 185.6, z 14 to 38, 6ft off the courtyard block's
  // east wall, 4.4ft off the L's arm, 10ft off its wing. Touching: its south
  // wall on the wing's.
  if (at === 'notch') hall(s, 156, 14);
  else if (at === 'touching') hall(s, 156, 24);
  s.roof = { style, pitch, facade: 'brick' };
  return s;
}

test('a curved hall in the notch of a courtyard L, touching none of it, has its own loop', () => {
  const o = roofOutline(school().floors[0]);
  const alone = roofOutline(school({ l: false }).floors[0]);
  assert.ok(alone.loops && alone.loops.length === 1, 'the hall alone passes');
  assert.ok(o.loops, `the hall is judged with the courtyard: ${o.refused}`);
  assert.deepEqual(o.loops, alone.loops, 'the hall\'s loop, point for point');
  assert.match(o.refused, /courtyard/, 'and the L is still refused');
});

test('so it stands on the skeleton under hip and its chords under parapet, and the L keeps rectangles', () => {
  for (const pitch of [2, 6, 12]) {
    const plan = roofPlan(school({ pitch }));
    const alone = roofPlan(school({ l: false, pitch }));
    const sk = plan.blocks.filter((b) => b.skeleton);
    assert.equal(sk.length, 1, `${pitch} in 12: one skeleton block`);
    assert.deepEqual(JSON.parse(JSON.stringify(sk[0])), JSON.parse(JSON.stringify(alone.blocks.find((b) => b.skeleton))),
      `${pitch} in 12: the hall's roof is the one it has alone`);
    const rect = plan.blocks.filter((b) => !b.skeleton);
    assert.ok(rect.length > 0 && rect.every((b) => b.rect && b.rect.x0 < 198 && b.rect.x0 >= 108),
      `${pitch} in 12: the L stands on rectangles`);
    assert.ok(!rect.some((b) => b.rect.x0 >= 152 && b.rect.x1 <= 190 && b.rect.z0 < 44), `${pitch} in 12: no rectangle left in the notch`);
  }
  const flat = roofPlan(school({ style: 'parapet' }));
  assert.equal((flat.deckPolys || []).length, 1, 'parapet: the hall\'s deck off its chords');
  assert.ok(flat.deckPolys[0].pts.some((p) => p.x > 185), 'the deck runs out to the bow');
});

test('the same hall touching the L is judged with it and keeps rectangles, as before', () => {
  const o = roofOutline(school({ at: 'touching' }).floors[0]);
  assert.equal(o.loops, null);
  assert.match(o.refused, /courtyard/);
  assert.equal(roofPlan(school({ at: 'touching' })).blocks.filter((b) => b.skeleton).length, 0);
  assert.equal(roofPlan(school({ at: 'touching', style: 'parapet' })).deckPolys, undefined);
});

test('a box in the notch, all straight walls, splits off and changes no roof', () => {
  const s = school({ at: 'none' });
  addShape(s, 0, R4(160, 16, 180, 40));
  const o = roofOutline(s.floors[0]);
  assert.deepEqual(o.loops, [R4(160, 16, 180, 40)], 'its own loop');
  for (const style of ['hip', 'parapet', 'gable', 'flat']) {
    const t = school({ at: 'none', style });
    addShape(t, 0, R4(160, 16, 180, 40));
    assert.equal(roofPlan(t).blocks.filter((b) => b.skeleton).length, 0, `${style}: no skeleton`);
    assert.equal(roofPlan(t).deckPolys, undefined, `${style}: no chord deck`);
  }
});

test('a room standing inside another, touching no wall of it, is still one building, and refused', () => {
  // With no courtyard anywhere, so the storey is refused for the overlap alone.
  const s = createState(60, 30);
  hall(s, 20, 8);
  addShape(s, 0, R4(24, 12, 32, 20));
  const o = roofOutline(s.floors[0]);
  assert.equal(o.loops, null);
  assert.match(o.refused, /overlap/);
  // The same with the inner room drawn first.
  const r = createState(60, 30);
  addShape(r, 0, R4(24, 12, 32, 20));
  hall(r, 20, 8);
  assert.equal(roofOutline(r.floors[0]).loops, null, 'inner room drawn first');
  // And beside a courtyard L, the overlap keeps its rectangles too.
  const t = school({ at: 'none' });
  hall(t, 156, 14);
  addShape(t, 0, R4(160, 18, 168, 26));
  assert.equal(roofOutline(t.floors[0]).loops, null);
});

test('two rooms whose walls cross are one building, and refused', () => {
  const s = school({ at: 'none' });
  hall(s, 156, 14);
  addShape(s, 0, R4(170, 10, 180, 20));     // across the hall's north wall
  assert.equal(roofOutline(s.floors[0]).loops, null);
});
