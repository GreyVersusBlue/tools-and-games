// The sheet: how big it is, what has to fit on it, and the two moves that make
// a tracing image drawable. Phase 13's complaint in one sentence — a measured
// image is bigger than the sheet and two thirds of it lands where the brush
// cannot reach — so most of this suite is about `fitToOverlay` and the promise
// it makes: after a fit, either the whole picture is on the sheet or the
// report says which part of it isn't.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MIN_CELLS, MAX_CELLS, MIN_FT, MAX_FT,
  clampCells, cellsForFt, footprintFt, footprintBounds, unionBounds,
  planBounds, overlayBounds, coversBounds, atRisk, resizeFootprint,
  growToCover, offsetOntoSheet, fitToOverlay, describeFootprint,
} from '../js/footprint.js';
import { createState, CELL, DEFAULT_W, DEFAULT_H } from '../js/grid.js';
import { makeOverlay, setOverlay, overlaySize } from '../js/overlay.js';
import { addShape } from '../js/shapes.js';
import { serialize, deserialize } from '../js/save-load.js';
import { boxRoom } from './build.mjs';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

// A 1200x800px image at one foot per pixel-ish, centred where the tool drops a
// freshly loaded one: over the middle of the sheet.
const imageOn = (state, opts = {}) => makeOverlay(PNG, 1200, 800, {
  x: (state.w * CELL) / 2, z: (state.h * CELL) / 2, scale: 0.1, ...opts,
});

// ---------- the numbers ----------

test('the sheet clamps to the same range a save file is read against', () => {
  assert.equal(clampCells(0), MIN_CELLS);
  assert.equal(clampCells(-40), MIN_CELLS);
  assert.equal(clampCells(9999), MAX_CELLS);
  assert.equal(clampCells(60.4), 60);
  assert.equal(MIN_FT, MIN_CELLS * CELL);
  assert.equal(MAX_FT, MAX_CELLS * CELL);
});

test('feet round out to whole cells, never in', () => {
  assert.equal(cellsForFt(160), 40);
  assert.equal(cellsForFt(161), 41);      // a sheet a foot short is the bug
  assert.equal(cellsForFt(0.5), MIN_CELLS);
  assert.equal(cellsForFt(1e9), MAX_CELLS);
});

test('a fresh design reports its own sheet', () => {
  const s = createState();
  assert.deepEqual(footprintFt(s), { w: DEFAULT_W * CELL, d: DEFAULT_H * CELL });
  assert.deepEqual(footprintBounds(s), { x0: 0, z0: 0, x1: 160, z1: 120 });
  assert.match(describeFootprint(s), /160 × 120 ft/);
  assert.match(describeFootprint(s), /40 × 30 cells/);
});

// ---------- resizing ----------

test('resizing writes the design and every storey, because both are read', () => {
  const s = createState();
  s.floors.push({ w: s.w, h: s.h, shapes: [] });
  const out = resizeFootprint(s, 80, 60);
  assert.equal(out.changed, true);
  assert.equal(s.w, 80);
  assert.equal(s.h, 60);
  for (const f of s.floors) assert.deepEqual([f.w, f.h], [80, 60]);
});

test('a resize to the size it already is changes nothing and says so', () => {
  const s = createState();
  const out = resizeFootprint(s, DEFAULT_W, DEFAULT_H);
  assert.equal(out.changed, false);
  assert.equal(out.risk.length, 0);
});

test('a resize past the ceiling is clamped and reports that it was', () => {
  const s = createState();
  const out = resizeFootprint(s, 9999, 9999);
  assert.equal(out.clamped, true);
  assert.deepEqual([s.w, s.h], [MAX_CELLS, MAX_CELLS]);
});

test('a design resized past the ceiling still round-trips through a save', () => {
  const s = createState();
  resizeFootprint(s, MAX_CELLS, MAX_CELLS);
  const back = deserialize(serialize(s));
  assert.deepEqual([back.w, back.h], [MAX_CELLS, MAX_CELLS]);
  assert.deepEqual([back.floors[0].w, back.floors[0].h], [MAX_CELLS, MAX_CELLS]);
});

// ---------- what shrinking would cost ----------

test('shrinking names the rooms the brush would start clipping', () => {
  const s = createState();
  boxRoom(s, 0, 2, 2, 8, 8, { name: 'Near the origin' });
  boxRoom(s, 0, 24, 20, 34, 26, { name: 'Out at the far corner' });
  assert.equal(atRisk(s, DEFAULT_W, DEFAULT_H).length, 0);
  const risk = atRisk(s, 20, 20);
  assert.equal(risk.length, 1);
  assert.equal(risk[0].name, 'Out at the far corner');
  // ...and the same list comes back off the resize that would cause it.
  assert.equal(resizeFootprint(s, 20, 20).risk.length, 1);
});

test('growing is never at risk of clipping anything', () => {
  const s = createState();
  boxRoom(s, 0, 24, 20, 34, 26);
  assert.equal(resizeFootprint(s, 100, 100).risk.length, 0);
});

test('a free-drawn room is not at risk, because no repaint ever touches it', () => {
  const s = createState();
  // Angled: `latticeAligned` refuses it, so paint.js freezes it rather than
  // rasterizing it, and a short sheet cannot clip what is never rasterized.
  addShape(s, 0, [
    { x: 130, z: 100 }, { x: 190, z: 108 }, { x: 186, z: 140 }, { x: 128, z: 132 },
  ], { name: 'Angled wing' });
  assert.equal(atRisk(s, 20, 20).length, 0);
});

// ---------- bounds ----------

test('planBounds is null until something is drawn, then covers every storey', () => {
  const s = createState();
  assert.equal(planBounds(s), null);
  boxRoom(s, 0, 1, 1, 5, 5);
  const b = planBounds(s);
  assert.deepEqual([b.x0, b.z0, b.x1, b.z1], [4, 4, 24, 24]);
});

test('a rotated image is bounded by its corners, not by its width', () => {
  const square = makeOverlay(PNG, 100, 100, { x: 0, z: 0, scale: 1 });
  const flat = overlayBounds(square);
  assert.deepEqual([flat.x0, flat.z0, flat.x1, flat.z1], [-50, -50, 50, 50]);
  const turned = overlayBounds(setOverlay(square, { rot: Math.PI / 4 }));
  assert.ok(turned.x1 > 70 && turned.x1 < 71, `${turned.x1}`);
});

test('coversBounds is what "the whole picture is drawable" means', () => {
  const s = createState();
  assert.equal(coversBounds(s, { x0: 0, z0: 0, x1: 160, z1: 120 }), true);
  assert.equal(coversBounds(s, { x0: -1, z0: 0, x1: 160, z1: 120 }), false);
  assert.equal(coversBounds(s, { x0: 0, z0: 0, x1: 161, z1: 120 }), false);
  assert.equal(coversBounds(s, null), true);
});

test('unionBounds takes whichever side exists', () => {
  const a = { x0: 0, z0: 0, x1: 10, z1: 10 };
  const b = { x0: -5, z0: 2, x1: 4, z1: 40 };
  assert.deepEqual(unionBounds(a, null), a);
  assert.deepEqual(unionBounds(null, b), b);
  assert.deepEqual(unionBounds(a, b), { x0: -5, z0: 0, x1: 10, z1: 40 });
});

// ---------- growing to cover ----------

test('growToCover grows and never shrinks', () => {
  const s = createState();
  growToCover(s, { x0: 0, z0: 0, x1: 300, z1: 40 });
  assert.equal(s.w, 75);
  assert.equal(s.h, DEFAULT_H, 'the axis that already fitted is left alone');
  assert.equal(coversBounds(s, { x0: 0, z0: 0, x1: 300, z1: 40 }), true);
});

test('growToCover reports the part of a bounds it cannot reach', () => {
  const s = createState();
  const out = growToCover(s, { x0: -20, z0: 0, x1: 300, z1: 40 });
  assert.equal(out.covered, false, 'nothing can grow into negative feet');
});

// ---------- the tracing image ----------

test('offsetOntoSheet slides to the origin, in whole cells', () => {
  assert.deepEqual(offsetOntoSheet({ x0: -13, z0: -2, x1: 100, z1: 100 }), { dx: 16, dz: 4 });
  assert.deepEqual(offsetOntoSheet({ x0: 4, z0: 8, x1: 100, z1: 100 }), { dx: 0, dz: 0 });
  assert.deepEqual(offsetOntoSheet(null), { dx: 0, dz: 0 });
});

test('a measured image that overhangs the sheet is slid on and the sheet grown', () => {
  // The complaint, exactly: a 1200x800 scan dropped over the middle of a
  // default sheet and then measured at a quarter of a foot per pixel is
  // 300x200ft, and lands from -70ft to 230ft.
  const s = createState();
  s.overlay = imageOn(s, { scale: 0.25 });
  const before = overlayBounds(s.overlay);
  assert.ok(before.x0 < 0 && before.z0 < 0);

  const out = fitToOverlay(s);
  assert.equal(out.changed, true);
  assert.ok(out.moved, 'nothing is drawn yet, so the picture is free to move');
  assert.equal(out.covered, true);
  assert.equal(coversBounds(s, overlayBounds(s.overlay)), true);
  // ...and the whole picture, not just most of it.
  const size = overlaySize(s.overlay);
  assert.ok(s.w * CELL >= size.w && s.h * CELL >= size.d);
});

test('a fit leaves the picture where it is once something has been traced', () => {
  const s = createState();
  s.overlay = imageOn(s, { scale: 0.25 });
  boxRoom(s, 0, 2, 2, 6, 6, { name: 'Traced already' });
  const was = { x: s.overlay.x, z: s.overlay.z };

  const out = fitToOverlay(s);
  assert.equal(out.moved, null, 'a wall drawn on this picture must not come off its line');
  assert.deepEqual({ x: s.overlay.x, z: s.overlay.z }, was);
  assert.equal(out.covered, false, 'and it says the negative corner is still off the sheet');
  // The part that could be reached, was.
  assert.equal(s.w, cellsForFt(overlayBounds(s.overlay).x1));
});

test('a locked image is not moved either', () => {
  const s = createState();
  s.overlay = imageOn(s, { scale: 0.25, locked: true });
  const out = fitToOverlay(s);
  assert.equal(out.moved, null);
});

test('move: true overrides both, for a caller that has asked', () => {
  const s = createState();
  s.overlay = imageOn(s, { scale: 0.25 });
  boxRoom(s, 0, 2, 2, 6, 6);
  const out = fitToOverlay(s, { move: true });
  assert.ok(out.moved);
  assert.equal(out.covered, true);
});

test('an image that already fits is a fit that changes nothing', () => {
  const s = createState();
  s.overlay = imageOn(s, { scale: 0.05 });   // 60 x 40 ft, well inside
  const out = fitToOverlay(s);
  assert.equal(out.changed, false);
  assert.deepEqual([s.w, s.h], [DEFAULT_W, DEFAULT_H]);
});

test('a design with no image fits nothing and does not mind', () => {
  const s = createState();
  const out = fitToOverlay(s);
  assert.equal(out.changed, false);
  assert.equal(out.covered, true);
});

test('an image bigger than the biggest sheet grows to the ceiling and says it fell short', () => {
  const s = createState();
  s.overlay = imageOn(s, { scale: 2 });   // 2400 x 1600 ft
  const out = fitToOverlay(s);
  assert.deepEqual([s.w, s.h], [MAX_CELLS, MAX_CELLS]);
  assert.equal(out.covered, false);
});

test('a fitted sheet survives a save', () => {
  const s = createState();
  s.overlay = imageOn(s, { scale: 0.25 });
  fitToOverlay(s);
  const back = deserialize(serialize(s));
  assert.deepEqual([back.w, back.h], [s.w, s.h]);
  assert.equal(coversBounds(back, overlayBounds(back.overlay)), true);
});
