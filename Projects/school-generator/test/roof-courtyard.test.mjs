// A courtyard refuses its own building's outline, not the whole storey's
// (#971). Run `node --test 'test/*.test.mjs'` from Projects/school-generator.
//
// The top storey's outline is judged building by building: rooms whose
// walls meet, transitively, are one building (by bounds until #991), and a
// refusal (a courtyard, a room with a hole, an overlap, a pinch) keeps the
// rectangles for that building only. A curved building elsewhere on the
// same storey still stands on the straight skeleton, and the takeoff and the
// estimate follow it.

import test from 'node:test';
import assert from 'node:assert/strict';

import { roofOutline, roofPlan, roofCover, roofMask, maskCount, skeletonRoofsOf, curvedLoopsOf } from '../js/roof.js';
import { addShape, curveSegment } from '../js/shapes.js';
import { createState, CELL } from '../js/grid.js';
import { takeoff } from '../js/takeoff.js';
import { sharedQuantities } from '../js/cost.js';

const R4 = (x0, z0, x1, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
const strip = (b) => JSON.parse(JSON.stringify(b));
const slopeOf = (pitch) => Math.hypot(12, pitch) / 12;

// One storey, up to two buildings 36ft apart. West: a 40 by 24 hall whose
// east wall the curve tool bows out to x 73.6, with a 16ft room on its west
// side. East: four rooms closed round an open 24 by 24 courtyard, or (`hole`)
// one room with a hole of its own in it.
function school({ curved = true, east = 'courtyard', style = 'hip', pitch = 6 } = {}) {
  const s = createState(50, 30);
  if (curved) {
    const hall = addShape(s, 0, R4(24, 8, 64, 32));
    addShape(s, 0, R4(8, 8, 24, 32));
    assert.ok(curveSegment(hall, 0, 1, -0.4) > 3, 'the curve tool laid a curve');
  }
  if (east === 'courtyard') {
    addShape(s, 0, R4(110, 8, 150, 16));
    addShape(s, 0, R4(110, 40, 150, 48));
    addShape(s, 0, R4(110, 16, 118, 40));
    addShape(s, 0, R4(142, 16, 150, 40));
  } else if (east === 'hole') {
    const sh = addShape(s, 0, R4(110, 8, 150, 48));
    sh.rings.push({ pts: R4(120, 18, 140, 38), walls: [], openings: [] });
  }
  s.roof = { style, pitch, facade: 'brick' };
  return s;
}
const maskFootprint = (s) => {
  const f = s.floors[s.floors.length - 1];
  return maskCount(roofMask(f, f.w, f.h)) * CELL * CELL;
};

test('alone, the courtyard building is accepted with its court, has no curve, and keeps its rectangles', () => {
  // Refused until #998, which takes a court as a hole of its loop.
  for (const east of ['courtyard', 'hole']) {
    const s = school({ curved: false, east });
    const o = roofOutline(s.floors[0]);
    assert.equal(o.refused, undefined, east);
    assert.equal(o.loops.length, 1, east);
    assert.equal(o.holes[0].length, 1, `${east}: one court`);
    assert.equal(curvedLoopsOf(s.floors[0]).length, 0, `${east}: no curve`);
    for (const style of ['hip', 'gable', 'parapet', 'flat']) {
      const plan = roofPlan(school({ curved: false, east, style }));
      assert.ok(!plan.blocks.some((b) => b.skeleton), `${east} ${style}: no skeleton`);
      assert.equal(plan.deckPolys, undefined, `${east} ${style}: no chord deck`);
      assert.equal(roofCover(school({ curved: false, east, style })).footprint, maskFootprint(s), `${east} ${style}: the mask's count`);
    }
  }
  // Two courtyard buildings: both pass, a court each.
  const s = school({ curved: false });
  const sh = addShape(s, 0, R4(160, 8, 196, 48));
  sh.rings.push({ pts: R4(170, 18, 186, 38), walls: [], openings: [] });
  const two = roofOutline(s.floors[0]);
  assert.equal(two.loops.length, 2);
  assert.deepEqual(two.holes.map((h) => h.length), [1, 1]);
});

test('beside a courtyard building, the curved building keeps its own loop, and the other has its court', () => {
  for (const east of ['courtyard', 'hole']) {
    const both = roofOutline(school({ east }).floors[0]);
    const alone = roofOutline(school({ east: 'none' }).floors[0]);
    assert.ok(alone.loops && alone.loops.length === 1);
    assert.equal(both.loops.length, 2, east);
    const k = both.loops.findIndex((l) => JSON.stringify(l) === JSON.stringify(alone.loops[0]));
    assert.ok(k >= 0, `${east}: the curved loop, point for point`);
    assert.deepEqual(both.holes[k], [], `${east}: no court in the curved building`);
    assert.equal(both.holes[1 - k].length, 1, `${east}: the courtyard building's court (#998)`);
  }
});

test('the curved building stands on the skeleton and the courtyard building keeps its rectangles', () => {
  for (const pitch of [2, 6, 12]) {
    const plan = roofPlan(school({ pitch }));
    const sk = plan.blocks.filter((b) => b.skeleton);
    const curvedAlone = roofPlan(school({ east: 'none', pitch }));
    const courtAlone = roofPlan(school({ curved: false, pitch }));
    assert.equal(sk.length, 1, `pitch ${pitch}: one skeleton roof`);
    assert.deepEqual(strip(sk), strip(curvedAlone.blocks.filter((b) => b.skeleton)), `pitch ${pitch}: the curved roof as it stands alone`);
    const rects = plan.blocks.filter((b) => !b.skeleton);
    assert.ok(rects.length >= 4, `pitch ${pitch}: rectangles round the courtyard`);
    assert.ok(rects.every((b) => b.rect.x0 >= 108), `pitch ${pitch}: no rectangle left over the curved hall`);
    assert.deepEqual(strip(rects), strip(courtAlone.blocks), `pitch ${pitch}: the courtyard building as it stands alone`);
    assert.deepEqual(strip(plan.deckRects), strip(courtAlone.deckRects), `pitch ${pitch}: its deck too`);
    assert.equal(plan.rise, Math.max(curvedAlone.rise, courtAlone.rise));
  }
});

test('the takeoff and the estimate follow roofPlan building by building', () => {
  for (const pitch of [2, 6, 12]) {
    const s = school({ pitch });
    const cover = roofCover(s);
    const curvedAlone = roofCover(school({ east: 'none', pitch }));
    const courtAlone = roofCover(school({ curved: false, pitch }));
    assert.equal(cover.skeleton, 1);
    assert.equal(cover.skeleton, roofPlan(s).blocks.filter((b) => b.skeleton).length);
    // The courtyard building is its mask's cells, the curved one its chords.
    assert.equal(courtAlone.footprint, maskFootprint(school({ curved: false, pitch })));
    assert.ok(Math.abs(cover.footprint - (curvedAlone.footprint + courtAlone.footprint)) < 1e-9,
      `pitch ${pitch}: ${cover.footprint} against ${curvedAlone.footprint} + ${courtAlone.footprint}`);
    assert.ok(Math.abs(cover.area - cover.footprint * slopeOf(pitch)) < 1e-9);
    assert.equal(takeoff(s).roof.area, cover.area);
    assert.equal(sharedQuantities(s).get('roof:shingle'), cover.area);
  }
});

test('a courtyard on the curved building itself keeps its hip on rectangles', () => {
  // The hall closed into a ring round an open middle: one building, with a
  // court since #998; the hip over a court is DESIGN-roof-holes.md's
  // increment 4, so until then it keeps its rectangles.
  const s = school({ east: 'none' });
  addShape(s, 0, R4(8, -24, 64, -12));
  addShape(s, 0, R4(8, -12, 20, 8));
  addShape(s, 0, R4(52, -12, 64, 8));
  assert.deepEqual(curvedLoopsOf(s.floors[0]).map((f) => f.holes.length), [1]);
  assert.equal(skeletonRoofsOf(s).length, 0);
  assert.equal(roofCover(s).footprint, maskFootprint(s));
});

test('only the hipped style takes the skeleton beside a courtyard', () => {
  for (const style of ['gable', 'parapet', 'flat']) {
    const s = school({ style });
    assert.equal(skeletonRoofsOf(s).length, 0, style);
    if (style !== 'parapet') {
      assert.equal(roofCover(s).footprint, maskFootprint(s), style);
      continue;
    }
    // The parapet runs on the curved building's chords (#973), and the
    // takeoff counts it off them too (#986): off the mask, on the plan's loops.
    const cover = roofCover(s);
    assert.equal(cover.chords, roofPlan(s).deckPolys.length);
    assert.equal(cover.chords, 1);
    assert.notEqual(cover.footprint, maskFootprint(s));
  }
});
