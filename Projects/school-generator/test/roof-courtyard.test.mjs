// A courtyard refuses its own building's outline, not the whole storey's
// (#971). Run `node --test 'test/*.test.mjs'` from Projects/school-generator.
//
// The top storey's outline is judged building by building: rooms whose
// bounds touch, transitively, are one building, and a refusal (a courtyard, a
// room with a hole, an overlap, a pinch) keeps the rectangles for that
// building only. A curved building elsewhere on the same storey still stands
// on the straight skeleton, and the takeoff and the estimate follow it.

import test from 'node:test';
import assert from 'node:assert/strict';

import { roofOutline, roofPlan, roofCover, roofMask, maskCount, skeletonRoofsOf } from '../js/roof.js';
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

test('alone, the courtyard building is refused exactly as before', () => {
  const o = roofOutline(school({ curved: false }).floors[0]);
  assert.equal(o.loops, null);
  assert.match(o.refused, /courtyard/);
  const h = roofOutline(school({ curved: false, east: 'hole' }).floors[0]);
  assert.equal(h.loops, null);
  assert.match(h.refused, /hole/);
  // Two buildings, both refused: still no loops at all, and the first reason.
  const s = school({ curved: false });
  const sh = addShape(s, 0, R4(160, 8, 196, 48));
  sh.rings.push({ pts: R4(170, 18, 186, 38), walls: [], openings: [] });
  const two = roofOutline(s.floors[0]);
  assert.equal(two.loops, null);
  assert.match(two.refused, /courtyard|hole/);
});

test('beside a courtyard building, the curved building keeps its own loop and the outline says why the other went', () => {
  for (const east of ['courtyard', 'hole']) {
    const both = roofOutline(school({ east }).floors[0]);
    const alone = roofOutline(school({ east: 'none' }).floors[0]);
    assert.ok(alone.loops && alone.loops.length === 1);
    assert.deepEqual(both.loops, alone.loops, `${east}: the curved loop, point for point`);
    assert.match(both.refused, east === 'hole' ? /hole/ : /courtyard/);
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

test('a courtyard on the curved building itself still refuses that building', () => {
  // The hall closed into a ring round an open middle: one building, refused whole.
  const s = school({ east: 'none' });
  addShape(s, 0, R4(8, -24, 64, -12));
  addShape(s, 0, R4(8, -12, 20, 8));
  addShape(s, 0, R4(52, -12, 64, 8));
  assert.match(roofOutline(s.floors[0]).refused, /courtyard/);
  assert.equal(skeletonRoofsOf(s).length, 0);
  assert.equal(roofCover(s).footprint, maskFootprint(s));
});

test('only the hipped style takes the skeleton beside a courtyard', () => {
  for (const style of ['gable', 'parapet', 'flat']) {
    const s = school({ style });
    assert.equal(skeletonRoofsOf(s).length, 0, style);
    assert.equal(roofCover(s).footprint, maskFootprint(s), style);
  }
});
