// A room standing in another room's own hole is a building of its own
// (#1002). Run `node --test 'test/*.test.mjs'` from Projects/school-generator.
//
// Where the top storey is refused as a whole, #971 judges it building by
// building, and #991 groups rooms whose walls meet or one of which stands
// inside the other. "Inside" asked every ring, so a room standing in the hole
// of a room with a court of its own was inside it and judged with it, and
// anything refused in that court took the hall's roof down with it. The same
// court closed by four rooms groups nothing, since no one of them holds the
// room. #998 makes a room's own hole and a court of rooms one thing, and the
// design's question 4 roofs them alike, so inside now means on the room's
// floor: in its outer ring and in none of its holes.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { roofOutline, roofPlan, roofCover } from '../js/roof.js';
import { addShape } from '../js/shapes.js';
import { createState } from '../js/grid.js';

const R4 = (x0, z0, x1, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
const hash = (o) => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 16);

// roof-holes.test.mjs's hall: 40 by 32 (x 8 to 48, z 8 to 40), its east end a
// semicircle of 16 chords about (48, 24), and a 12 by 8 court at x 20 to 32,
// z 20 to 28, either the hall's own hole or closed by four rooms.
const ARC = Array.from({ length: 17 }, (_, k) => {
  const t = -Math.PI / 2 + (Math.PI * k) / 16;
  return { x: 48 + 16 * Math.cos(t), z: 24 + 16 * Math.sin(t) };
});

// `inCourt`: what stands in the court, touching no wall of the hall and inside
// the court's 1.5ft eave (x 21.5 to 30.5, z 21.5 to 26.5). 'pair' is two rooms
// overlapping, refused; 'one' a single room, which passes.
function hall({ rooms = false, inCourt = 'pair', style = 'hip', pitch = 6 } = {}) {
  const s = createState(30, 20);
  if (rooms) {
    addShape(s, 0, R4(8, 8, 48, 20));
    addShape(s, 0, R4(8, 28, 48, 40));
    addShape(s, 0, R4(8, 20, 20, 28));
    addShape(s, 0, R4(32, 20, 48, 28));
    assert.ok(addShape(s, 0, ARC.map((p) => ({ ...p }))), 'the apse');
  } else {
    const sh = addShape(s, 0, [{ x: 8, z: 8 }, ...ARC.map((p) => ({ ...p })), { x: 8, z: 40 }]);
    sh.rings.push({ pts: R4(20, 20, 32, 28), walls: [], openings: [] });
  }
  if (inCourt === 'pair' || inCourt === 'one') addShape(s, 0, R4(22, 22, 26, 26));
  if (inCourt === 'pair') addShape(s, 0, R4(24, 22.5, 28, 26));
  s.roof = { style, pitch, facade: 'brick' };
  return s;
}

test('two rooms overlapping in a hall\'s own court refuse themselves, not the hall', () => {
  const o = roofOutline(hall().floors[0]);
  assert.match(o.refused, /overlap/, 'the pair is still refused');
  assert.ok(o.loops, 'the hall is judged without them');
  assert.equal(o.loops.length, 1);
  assert.equal(o.holes[0].length, 1, 'with its court');
  const alone = roofOutline(hall({ inCourt: 'none' }).floors[0]);
  assert.deepEqual(o.loops, alone.loops, 'the loop it has alone');
  assert.deepEqual(o.holes, alone.holes);
});

test('so the hall stands on its skeleton round the court, as the same court of rooms does', () => {
  for (const pitch of [2, 6, 12]) {
    const ring = roofPlan(hall({ pitch }));
    const rooms = roofPlan(hall({ rooms: true, pitch }));
    const sk = ring.blocks.filter((b) => b.skeleton);
    assert.equal(sk.length, 1, `${pitch} in 12: one skeleton block`);
    assert.equal(rooms.blocks.filter((b) => b.skeleton).length, 1, `${pitch} in 12: as rooms, one too`);
    const alone = roofPlan(hall({ inCourt: 'none', pitch })).blocks.find((b) => b.skeleton);
    assert.equal(hash(sk[0]), hash(alone), `${pitch} in 12: the hall's roof is the one it has with nothing in its court`);
    // The court of rooms starts its loop at another corner, so its block is
    // the same roof numbered from elsewhere: compare what does not depend on that.
    const rk = rooms.blocks.find((b) => b.skeleton);
    assert.equal(sk[0].faces.length, rk.faces.length, `${pitch} in 12: as many faces as the court of rooms`);
    assert.ok(Math.abs(sk[0].rise - rk.rise) < 1e-9, `${pitch} in 12: the same rise`);
    // The pair keeps the mask: its rectangles stand in the court.
    const rect = ring.blocks.filter((b) => !b.skeleton);
    assert.ok(rect.length > 0 && rect.every((b) => b.rect.x0 >= 20 && b.rect.x1 <= 32 && b.rect.z0 >= 20 && b.rect.z1 <= 28),
      `${pitch} in 12: the pair on rectangles in the court`);
  }
  const flat = roofPlan(hall({ style: 'parapet' }));
  assert.equal(flat.deckPolys.length, 1, 'parapet: the hall\'s deck off its chords');
  assert.equal(flat.deckPolys[0].holes.length, 1, 'round its court');
  assert.ok(flat.deckRects.length > 0, 'and the pair on its mask');
});

test('the takeoff counts the hall off its chords and the pair on its cells, as the court of rooms', () => {
  for (const style of ['hip', 'parapet']) {
    const ring = roofCover(hall({ style })), rooms = roofCover(hall({ rooms: true, style }));
    assert.ok(Math.abs(ring.footprint - rooms.footprint) < 1e-9, `${style}: ${ring.footprint} against ${rooms.footprint}`);
    assert.ok(Math.abs(ring.area - rooms.area) < 1e-9, `${style}: sloped ${ring.area} against ${rooms.area}`);
    assert.equal(ring.skeleton + ring.chords, 1, `${style}: the hall off its chords`);
  }
});

test('a room touching the court\'s wall is still the hall\'s, and one room alone in it is its own', () => {
  // Touching: the pair with its east room run out to the court's east wall.
  const s = hall({ inCourt: 'none' });
  addShape(s, 0, R4(22, 22, 26, 26));
  addShape(s, 0, R4(24, 22.5, 32, 26));
  const o = roofOutline(s.floors[0]);
  assert.match(o.refused, /overlap/);
  assert.equal(o.loops, null, 'judged with the hall, which is refused with it');
  // One room alone in the court: the storey passes whole, as before.
  const one = roofOutline(hall({ inCourt: 'one' }).floors[0]);
  assert.equal(one.refused, undefined);
  assert.equal(one.loops.length, 2);
});

test('a room standing on another\'s floor is still inside it', () => {
  // Two rooms overlapping on the hall's floor, clear of its walls and its court.
  const s = hall({ inCourt: 'none' });
  addShape(s, 0, R4(10, 10, 14, 14));
  addShape(s, 0, R4(12, 11, 16, 15));
  const o = roofOutline(s.floors[0]);
  assert.match(o.refused, /overlap/);
  assert.equal(o.loops, null, 'the hall goes down with the rooms standing in it');
});
