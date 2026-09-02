// How long a room rings, and why. Run `node --test` from
// Projects/school-generator.
//
// Sabine's equation is checked against arithmetic that doesn't depend on the
// implementation — a cube of known volume with known surfaces has a
// hand-computable RT60 — and then against the properties that a wrong sign or
// a swapped argument breaks first: carpet is deader than tile, a bigger room
// rings longer, furniture only ever shortens the tail, and a room open through
// two storeys is both taller and harder than the same room with a lid on it.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SABINE, ALPHA, CATEGORY_ALPHA, MIN_RT60, MAX_RT60, SPEED_OF_SOUND,
  finishAlpha, sabineRT60, ansiLimit, verdict, ceilingAt, roomAt, outsideRoom,
  isOutside, propFace, propAlpha, furnitureSabins, roomAcoustics, reverbSpec,
  wetFraction, roomsOnFloor, ALPHA_BAND, FINISH_SPREAD, PROP_SPREAD,
} from '../js/acoustics.js';
import { createState, CELL, WALL_H, FLOOR_H } from '../js/grid.js';
import { sheet } from './build.mjs';
import { addShape } from '../js/shapes.js';
import { addProp, addLink } from '../js/props.js';

const near = (a, b, eps, msg) =>
  assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b} (±${eps})`);

// A building with a rectangle of floor laid from (0,0) on every storey, drawn
// on a scratch lattice and baked into rooms — see build.mjs. `draw` gets the
// sheet before the bake, for the fixtures that want a partition or a finish.
function slab(wCells, hCells, floors = 1, draw = null) {
  const s = createState(Math.max(wCells + 2, 8), Math.max(hCells + 2, 8));
  for (let i = 1; i < floors; i++) s.floors.push({ w: s.w, h: s.h, shapes: [] });
  for (let f = 0; f < floors; f++) {
    const sh = sheet(s, f);
    sh.fill(0, 0, wCells - 1, hCells - 1);
    if (draw) draw(sh);
    sh.bake();
  }
  return s;
}

// The same, with one finish written across every cell before the bake.
const finished = (w, h, fin) => slab(w, h, 1, (sh) => sh.label(0, 0, w - 1, h - 1, { fin }));

const table = {
  desk: { type: 'desk', name: 'Desk', category: 'Tables & Desks', w: 2, d: 2, h: 2.5, mount: 'floor' },
  sofa: { type: 'sofa', name: 'Sofa', category: 'Seating', w: 6, d: 3, h: 2.7, mount: 'floor' },
  panel: { type: 'panel', name: 'Panel', category: 'Fixtures', w: 4, d: 0.25, h: 4, mount: 'wall', absorb: 0.85 },
};
const entry = (t) => table[t] || null;

// ---------- the equation ----------

test('Sabine is the published equation, not an approximation of it', () => {
  // A 20x20x10 room lined entirely in a material that absorbs 0.1: surface is
  // 2*400 + 4*200 = 1600 ft^2, so A = 160 sabins, V = 4000 ft^3, and
  // RT60 = 0.049 * 4000 / 160 exactly.
  near(sabineRT60(4000, 160), (SABINE * 4000) / 160, 1e-12, 'by hand');
  // Halving the absorption doubles the tail; doubling the volume doubles it.
  near(sabineRT60(4000, 80), 2 * sabineRT60(4000, 160), 1e-12, 'absorption');
  near(sabineRT60(8000, 160), 2 * sabineRT60(4000, 160), 1e-12, 'volume');
});

test('the equation is clamped where it stops describing anything', () => {
  assert.equal(sabineRT60(0, 100), 0);
  assert.equal(sabineRT60(1000, 0), 0);
  // A room with almost no absorption would ring for a minute; it doesn't.
  assert.equal(sabineRT60(1e7, 1), MAX_RT60);
  assert.equal(sabineRT60(1, 1e6), MIN_RT60);
});

test('the ANSI limit is the standard, including where the standard stops', () => {
  assert.equal(ansiLimit(9000), 0.6);
  assert.equal(ansiLimit(10000), 0.6);
  assert.equal(ansiLimit(15000), 0.7);
  assert.equal(ansiLimit(20000), 0.7);
  assert.equal(ansiLimit(20001), null, 'no limit is quoted for a volume this big');
  assert.equal(ansiLimit(0), null);
});

test('a verdict is a word for a number, and the words are ordered', () => {
  const words = [0.2, 0.5, 0.8, 1.4, 3].map(verdict);
  assert.deepEqual(words, ['Dead', 'Crisp', 'Lively', 'Reverberant', 'Echoey']);
  assert.equal(verdict(0), 'Open air');
});

// ---------- materials ----------

test('the floor finish table carries its own absorption', () => {
  // Carpet is an order of magnitude deader than ceramic, which is the whole
  // reason a library and a restroom don't sound alike.
  assert.ok(finishAlpha('carpet') > finishAlpha('vct'));
  assert.ok(finishAlpha('vct') > finishAlpha('tile'));
  // An unknown key falls back the way `finishEntry` does rather than throwing.
  assert.equal(finishAlpha('linoleum-from-2040'), finishAlpha('vct'));
});

test('a prop absorbs over the face it presents', () => {
  // A floor-standing piece presents its footprint...
  assert.equal(propFace(table.desk, { scale: 1 }), 4);
  // ...a wall-mounted one its elevation.
  assert.equal(propFace(table.panel, { scale: 1 }), 16);
  // Scale is an area, so it squares.
  assert.equal(propFace(table.desk, { scale: 2 }), 16);
  // Category is the default; a row that says otherwise wins.
  assert.equal(propAlpha(table.sofa), CATEGORY_ALPHA.Seating);
  assert.equal(propAlpha(table.panel), 0.85);
});

// ---------- rooms ----------

test('a room is the room its outline says it is', () => {
  const s = slab(10, 10);
  const room = roomAt(s, 0, 6, 6);
  assert.equal(room.kind, 'shape');
  assert.equal(room.area, 100 * CELL * CELL);
  // A 10x10 block of cells bakes to a 40-cell perimeter.
  assert.equal(room.perimeter, 40 * CELL);
  assert.ok(room.contains(6, 6));
  assert.ok(!room.contains(-20, -20));

  addShape(s, 0, [{ x: 0, z: 0 }, { x: 20, z: 0 }, { x: 20, z: 20 }, { x: 0, z: 20 }],
    { name: 'Commons', fin: 'carpet' });
  const over = roomAt(s, 0, 6, 6);
  assert.equal(over.name, 'Commons', 'a room drawn on top of another is the room');
  assert.equal(over.fin, 'carpet');
  assert.equal(over.area, 400);
  assert.equal(over.perimeter, 80);
});

test('a wall cuts one region into two', () => {
  // A full-height wall down the middle: every vertical edge at x = 5.
  const s = slab(10, 10, 1, (sh) => sh.vrun(5, 0, 9));
  const west = roomAt(s, 0, 2 * CELL, 2 * CELL);
  const east = roomAt(s, 0, 8 * CELL, 2 * CELL);
  assert.notEqual(west.id, east.id);
  assert.equal(west.area, 50 * CELL * CELL);
  assert.equal(east.area, 50 * CELL * CELL);
  assert.ok(!west.contains(8 * CELL, 2 * CELL));
});

test('outside is not a very reverberant room, it is no room', () => {
  const s = slab(4, 4);
  const out = roomAt(s, 0, 400, 400);
  assert.ok(isOutside(out));
  assert.ok(isOutside(outsideRoom()));
  const ac = roomAcoustics(s, 0, 400, 400, entry);
  assert.equal(ac.rt60, 0);
  assert.equal(ac.volume, 0);
  assert.equal(ac.verdict, 'Open air');
  assert.equal(reverbSpec(ac).rt60, 0);
  assert.equal(wetFraction(ac, 40), 0, 'nothing outdoors is wet');
});

// ---------- ceilings ----------

test('the ceiling is the slab above, until there is no slab above', () => {
  const one = slab(6, 6, 1);
  assert.deepEqual(ceilingAt(one, 0, 8, 8), { height: WALL_H, open: false, storeys: 1 });

  const two = slab(6, 6, 2);
  // Standing on level 1 with level 2's slab overhead: the walls run the full
  // floor-to-floor height, and the ceiling is a lid.
  const under = ceilingAt(two, 0, 8, 8);
  assert.equal(under.height, FLOOR_H);
  assert.equal(under.open, false);
  // The top storey's own ceiling is the roof.
  assert.equal(ceilingAt(two, 1, 8, 8).height, WALL_H);
});

test('a floor opening makes one room two storeys tall, and hardens its ceiling', () => {
  const s = slab(8, 8, 2);
  const lid = roomAcoustics(s, 0, 10, 10, entry);
  // Cut the slab above away over the whole room.
  // A void through the slab above, wide enough to cover the whole room.
  addLink(s, 'opening', { from: 0, to: 1, x: 16, z: 16, data: { w: 80, d: 80 } });
  const open = roomAcoustics(s, 0, 10, 10, entry);

  assert.equal(lid.openCeiling, false);
  assert.equal(open.openCeiling, true);
  assert.equal(open.storeys, 2);
  assert.ok(open.height > lid.height, 'the volume runs through the hole');
  assert.ok(open.volume > lid.volume);
  // ...and what is over it is structure, not acoustic tile. Both effects push
  // the same way, which is why gyms ring.
  assert.ok(open.rt60 > lid.rt60);
});

// ---------- the whole calculation ----------

test('carpet and furniture both shorten the tail; nothing lengthens it', () => {
  const bare = slab(8, 8);
  const hard = roomAcoustics(bare, 0, 10, 10, entry);

  const soft = finished(8, 8, 'carpet');
  const carpeted = roomAcoustics(soft, 0, 10, 10, entry);
  assert.ok(carpeted.rt60 < hard.rt60, 'carpet is absorption');

  const furnished = slab(8, 8);
  for (let i = 0; i < 12; i++) {
    addProp(furnished, 'sofa', { floor: 0, x: 4 + i, z: 6 });
  }
  const sat = roomAcoustics(furnished, 0, 10, 10, entry);
  assert.ok(sat.rt60 < hard.rt60, 'twelve sofas is a lot of sabins');
  assert.equal(sat.props, 12);

  // Furniture outside the room doesn't count toward it.
  const elsewhere = slab(8, 8);
  addProp(elsewhere, 'sofa', { floor: 0, x: 400, z: 400 });
  assert.equal(furnitureSabins(elsewhere, roomAt(elsewhere, 0, 10, 10), entry).count, 0);
});

test('an acoustic panel is worth many times its size in ordinary furniture', () => {
  const a = slab(8, 8);
  addProp(a, 'panel', { floor: 0, x: 10, z: 10 });
  const b = slab(8, 8);
  addProp(b, 'desk', { floor: 0, x: 10, z: 10 });
  // Compared as furniture, not as a fraction of the room: a 4x4 panel at
  // alpha 0.85 is 13.6 sabins where a 2x2 desk at 0.10 is 0.4.
  const panel = furnitureSabins(a, roomAt(a, 0, 10, 10), entry);
  const desk = furnitureSabins(b, roomAt(b, 0, 10, 10), entry);
  assert.equal(panel.count, 1);
  assert.ok(panel.sabins > desk.sabins * 20, `${panel.sabins} vs ${desk.sabins}`);
  // And it shows up where it matters: the room with the panel rings less.
  assert.ok(roomAcoustics(a, 0, 10, 10, entry).rt60 < roomAcoustics(b, 0, 10, 10, entry).rt60);
});

test('a big hard room is over the ANSI limit and says so', () => {
  // 40x40ft of sealed concrete with a tile ceiling: about 16,000 ft^3.
  const s = finished(10, 10, 'concrete');
  const ac = roomAcoustics(s, 0, 20, 20, entry);
  assert.equal(ac.volume, 100 * CELL * CELL * WALL_H);
  assert.equal(ac.limit, 0.7);
  assert.ok(ac.rt60 > 0, 'a real number');
  // Everything is derived and consistent: the mean coefficient is total
  // absorption over total boundary, and the tail follows Sabine from those.
  near(ac.meanAlpha, ac.sabins / ac.surface, 1e-9, 'mean alpha');
  near(ac.rt60, sabineRT60(ac.volume, ac.sabins), 1e-9, 'the equation, again');
  assert.equal(ac.overLimit, ac.rt60 > ac.limit);
});

// ---------- what the convolver is told ----------

test('the pre-delay is the mean free path at the speed of sound', () => {
  const s = slab(12, 12);
  const ac = roomAcoustics(s, 0, 20, 20, entry);
  near(ac.mfp, (4 * ac.volume) / ac.surface, 1e-9, 'mean free path is 4V/S');
  const spec = reverbSpec(ac);
  near(spec.predelay, Math.min(0.09, ac.mfp / SPEED_OF_SOUND), 1e-9, 'and the delay is it, over c');
  assert.ok(spec.rt60 === ac.rt60);
  // A dead room's tail loses its highs; a hard one keeps them.
  const soft = finished(12, 12, 'carpet');
  assert.ok(reverbSpec(roomAcoustics(soft, 0, 20, 20, entry)).hf < spec.hf);
});

test('the wet share grows with distance and never reaches all of it', () => {
  const s = slab(12, 12);
  const ac = roomAcoustics(s, 0, 20, 20, entry);
  const near1 = wetFraction(ac, 1);
  const far = wetFraction(ac, 200);
  assert.ok(near1 < far, 'further away is more room and less source');
  assert.ok(far < 1, 'you never stop hearing the source at all');
  // At the critical distance the two fields are equal by definition, so the
  // reverberant share is exactly half.
  near(wetFraction(ac, ac.criticalDist), 0.5, 1e-9, 'critical distance');
});

// ---------- the storey roll-up ----------

test('a storey rolls up to one entry per room, however it is drawn', () => {
  const s = slab(10, 10, 1, (sh) => sh.vrun(5, 0, 9));
  addShape(s, 0, [{ x: 60, z: 0 }, { x: 90, z: 0 }, { x: 90, z: 30 }, { x: 60, z: 30 }],
    { name: 'Gym' });
  const rooms = roomsOnFloor(s, 0, entry);
  // Two baked rooms and one drawn by hand, each counted once.
  assert.equal(rooms.length, 3);
  assert.equal(new Set(rooms.map((r) => r.id)).size, 3);
  assert.ok(rooms.some((r) => r.name === 'Gym'));
  for (const r of rooms) assert.ok(r.rt60 > 0 && r.volume > 0);
  assert.deepEqual(roomsOnFloor(s, 9, entry), [], 'a storey that is not there has no rooms');
});

// ---------- Phase 41: the coefficients are a guess, and the answer says so ----------

test('every band brackets the coefficient it is a band round', () => {
  for (const [k, [lo, hi]] of Object.entries(ALPHA_BAND)) {
    assert.ok(lo < hi, `${k} band is empty`);
    assert.ok(lo <= ALPHA[k] && ALPHA[k] <= hi, `${k}: ${ALPHA[k]} is outside ${lo}–${hi}`);
  }
  assert.ok(FINISH_SPREAD[0] < 1 && 1 < FINISH_SPREAD[1]);
  assert.ok(PROP_SPREAD[0] < 1 && 1 < PROP_SPREAD[1]);
});

test('the reverberation is a range round the point, and more absorption is the short end', () => {
  const s = finished(10, 10, 'concrete');
  const ac = roomAcoustics(s, 0, 20, 20, entry);
  assert.ok(ac.rt60Low <= ac.rt60 && ac.rt60 <= ac.rt60High);
  assert.ok(ac.rt60Low < ac.rt60High, 'a real spread');
  assert.ok(ac.sabinsLow < ac.sabins && ac.sabins < ac.sabinsHigh);
  near(ac.rt60Low, sabineRT60(ac.volume, ac.sabinsHigh), 1e-9, 'quietest surfaces, shortest tail');
  near(ac.rt60High, sabineRT60(ac.volume, ac.sabinsLow), 1e-9, 'hardest surfaces, longest tail');
  // Exactly one of the three verdicts, and they agree with the ends.
  assert.equal(ac.overLimit, ac.rt60 > ac.limit);
  assert.equal(ac.surelyOver, ac.rt60Low > ac.limit);
  assert.equal(ac.maybeOver, !ac.overLimit && ac.rt60High > ac.limit);
  // Every surface says its band, and the widest in sabins is the one named.
  for (const sf of ac.surfaces) assert.ok(sf.low <= sf.alpha && sf.alpha <= sf.high || sf.area === 0);
  const widest = ac.surfaces.reduce((a, b) => (b.spread > a.spread ? b : a));
  assert.equal(ac.narrows.what, widest.what);
  assert.ok(/Ceiling/.test(ac.narrows.what), 'in a bare room the tile decides');
});

test('outdoors has no range to report', () => {
  const s = createState(8, 8);
  const ac = roomAcoustics(s, 0, 100, 100, entry);
  assert.equal(ac.rt60Low, 0);
  assert.equal(ac.rt60High, 0);
  assert.equal(ac.narrows, null);
  assert.ok(!ac.maybeOver && !ac.surelyOver);
});
