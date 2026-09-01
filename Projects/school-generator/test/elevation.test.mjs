// Elevations and sections. Run `node --test 'test/*.test.mjs'` from
// Projects/school-generator.
//
// A projection is arithmetic, so it's checked as arithmetic: a 40ft box seen
// from the south is one 40ft face at the depth of its south wall, a window
// sits between its sill and its head, the north view mirrors the south one, a
// near wing sorts nearer than a far one, a gable's apex stands exactly
// pitch/12 times the half-span above the eave. The section is checked from
// the state the tools actually produce — drawn on a scratch lattice and
// baked, like every fixture since Phase 12 — because poché that misses a
// door's head by a riser is the kind of bug only real openings find.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createState, addFloor, CELL, WALL_H, FLOOR_H,
} from '../js/grid.js';
import { slabOn, boxRoom } from './build.mjs';
import { addOpening, OP_WINDOW, shapesOf, segEnds } from '../js/shapes.js';
import { EAVE, PARAPET_H, COPING_T, roofPlan, roofMask } from '../js/roof.js';
import { ensureTerrain, raiseTerrain } from '../js/terrain.js';
import { addStair, stairMetrics } from '../js/stairs.js';
import {
  FACADES, facadeEntry, storeyFaces, computeElevation, computeSection,
  sectionsOf, addSection, removeSection, sectionAt, nextSectionName,
  normalizeSections, sectionLabel, roofHeightAt, MAX_SECTIONS, SLAB_T,
} from '../js/elevation.js';

const near = (a, b, eps, msg) =>
  assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b} (±${eps})`);

// A rectangular walled room `wc` x `hc` cells at the grid origin.
function box(wc = 10, hc = 5) {
  const s = createState(30, 30);
  boxRoom(s, 0, 0, 0, wc - 1, hc - 1, { name: 'Hall' });
  return s;
}

// The ring segment of the room's outer ring that lies along `pick`'s answer —
// for cutting an opening into a known wall.
function segWhere(shape, pick) {
  const ring = shape.rings[0];
  for (let i = 0; i < ring.pts.length; i++) {
    const [a, b] = segEnds(ring, i);
    if (pick(a, b)) return i;
  }
  return -1;
}

const walls = (elev) => elev.paints.filter((p) => p.kind === 'wall');
const windows = (elev) => elev.paints.filter((p) => p.kind === 'window');
const polyU = (poly) => [Math.min(...poly.map((p) => p.u)), Math.max(...poly.map((p) => p.u))];
const polyY = (poly) => [Math.min(...poly.map((p) => p.y)), Math.max(...poly.map((p) => p.y))];

// ---------- facades ----------

test('a box seen from the south is one face at its south wall', () => {
  const s = box(10, 5);   // 40 x 20 ft
  const elev = computeElevation(s, 'south');
  const w = walls(elev);
  assert.equal(w.length, 1);
  const [u0, u1] = polyU(w[0].poly);
  near(u0, 0, 1e-6, 'left edge');
  near(u1, 40, 1e-6, 'right edge');
  const [y0, y1] = polyY(w[0].poly);
  near(y0, 0, 1e-6, 'sits on the ground');
  near(y1, WALL_H, 1e-6, 'one storey of wall');
  near(w[0].depth, -20, 1e-6, 'at the south wall');
});

test('the north elevation mirrors the south one', () => {
  const s = box(10, 5);
  const north = walls(computeElevation(s, 'north'))[0];
  const [u0, u1] = polyU(north.poly);
  near(u0, -40, 1e-6, 'mirrored left edge');
  near(u1, 0, 1e-6, 'mirrored right edge');
  near(north.depth, 0, 1e-6, 'at the north wall');
});

test('east and west read the building depth as their width', () => {
  const s = box(10, 5);
  for (const dir of ['east', 'west']) {
    const w = walls(computeElevation(s, dir))[0];
    const [u0, u1] = polyU(w.poly);
    near(u1 - u0, 20, 1e-6, `${dir}: 20ft of building across the sheet`);
  }
});

test('every facade entry is a facade, and an unknown one is the south', () => {
  for (const dir of FACADES) assert.ok(facadeEntry(dir).label.includes('Elevation'));
  assert.equal(facadeEntry('up'), facadeEntry('south'));
});

test('a window shows on the facade it faces and no other', () => {
  const s = box(10, 5);
  const shape = shapesOf(s.floors[0])[0];
  const seg = segWhere(shape, (a, b) => a.z === 20 && b.z === 20);
  assert.ok(seg >= 0, 'found the south wall');
  addOpening(shape, 0, seg, 0.5, 6, { k: OP_WINDOW });
  const south = computeElevation(s, 'south');
  const win = windows(south);
  assert.equal(win.length, 1);
  const [y0, y1] = polyY(win[0].poly);
  near(y0, 3, 1e-6, 'the default sill');
  near(y1, 7, 1e-6, 'the default head');
  const [u0, u1] = polyU(win[0].poly);
  near(u1 - u0, 6, 1e-6, 'as wide as it was cut');
  // Painter order: the wall first, the window cut into it after.
  assert.ok(south.paints.indexOf(win[0]) > south.paints.indexOf(walls(south)[0]),
    'the opening paints over its wall');
  assert.equal(windows(computeElevation(s, 'north')).length, 0,
    'nothing shows on the back of the building');
});

test('a near wing paints after a far one', () => {
  const s = createState(30, 30);
  slabOn(s, 0, [0, 0, 9, 1]);    // far strip, z 0..8
  slabOn(s, 0, [0, 3, 4, 6]);    // near wing, z 12..28
  const south = computeElevation(s, 'south');
  const w = walls(south);
  assert.ok(w.length >= 2, 'two masses at least');
  const first = w[0], last = w[w.length - 1];
  assert.ok(first.depth > last.depth, 'far to near');
  near(last.depth, -28, 1e-6, 'the near wing fronts the sheet');
});

test('two storeys stack, and the levels say so', () => {
  const s = box(10, 5);
  addFloor(s);
  slabOn(s, 1, [0, 0, 9, 4]);
  const south = computeElevation(s, 'south');
  const w = walls(south);
  assert.equal(w.length, 2);
  const lower = w.find((p) => p.storey === 0), upper = w.find((p) => p.storey === 1);
  near(polyY(lower.poly)[1], FLOOR_H, 1e-6,
    'a storey with one above it runs wall to the next slab');
  near(polyY(upper.poly)[0], FLOOR_H, 1e-6, 'the upper starts where the lower stops');
  assert.equal(south.levels.length, 2);
  assert.equal(south.levels[1].y, FLOOR_H);
});

test('the default parapet stands above the eaves', () => {
  const s = box(10, 5);
  const south = computeElevation(s, 'south');
  const cap = south.paints.filter((p) => p.kind === 'parapet');
  assert.equal(cap.length, 1);
  const [y0, y1] = polyY(cap[0].poly);
  near(y0, WALL_H, 1e-6, 'off the eave');
  near(y1, WALL_H + PARAPET_H + COPING_T, 1e-6, 'up to the coping');
  assert.ok(south.bounds.maxY > y1, 'the sheet leaves air above the roof');
});

test('a gable shows its triangle to the ends and its slope to the sides', () => {
  const s = box(10, 5);   // 40 x 20: ridge runs along x
  s.roof = { style: 'gable', pitch: 6, facade: 'brick' };
  const east = computeElevation(s, 'east');
  const gables = east.paints.filter((p) => p.kind === 'gable');
  assert.ok(gables.length >= 1, 'an end view sees a gable');
  const apex = Math.max(...gables.flatMap((g) => g.poly.map((p) => p.y)));
  // Half the eaved short span, at 6:12.
  near(apex, WALL_H + ((20 + 2 * EAVE) / 2) * (6 / 12), 0.01, 'the apex height');
  const south = computeElevation(s, 'south');
  assert.ok(south.paints.some((p) => p.kind === 'roof'), 'a side view sees the slope');
});

test('the ground line reads the same padded ground the walker stands on', () => {
  const s = box(10, 5);
  const flat = computeElevation(s, 'south');
  assert.ok(flat.grade.length > 10, 'the line runs the width of the sheet');
  assert.ok(flat.grade.every((g) => Math.abs(g.y) < 1e-6), 'and it is level');
  // Grade a hill right against the facade: the building pad holds the ground
  // at its threshold, so the elevation's line stays level too — the same
  // answer `groundAt` gives the walkthrough, not the raw heightfield.
  ensureTerrain(s);
  raiseTerrain(s.terrain, 20, 30, 40, 6);
  const padded = computeElevation(s, 'south');
  assert.ok(padded.grade.every((g) => Math.abs(g.y) < 0.5),
    'the pad keeps the threshold level');
  // ...and where there is no building to pad, the hill is the line.
  const open = createState(30, 30);
  ensureTerrain(open);
  raiseTerrain(open.terrain, 60, 0, 50, 6);
  const hill = computeElevation(open, 'south');
  assert.ok(hill.grade.some((g) => g.y > 1), 'open ground shows its grading');
});

test('storeyFaces answers nothing for an empty storey', () => {
  const s = createState(10, 10);
  assert.deepEqual(storeyFaces(s.floors[0], 'south'), []);
  const empty = computeElevation(s, 'south');
  assert.equal(walls(empty).length, 0);
  assert.ok(Number.isFinite(empty.bounds.minU), 'the sheet still has bounds');
});

// ---------- section lines, the stored record ----------

test('section lines letter themselves and reuse a freed letter', () => {
  const s = createState(20, 20);
  assert.equal(sectionsOf(s).length, 0);
  const a = addSection(s, { x: 0, z: 10 }, { x: 40, z: 10 });
  const b = addSection(s, { x: 10, z: 0 }, { x: 10, z: 40 });
  assert.equal(a.name, 'A');
  assert.equal(b.name, 'B');
  assert.equal(sectionLabel(a), 'A-A');
  assert.ok(a.id > 0 && b.id > a.id, 'ids come off the state counter');
  assert.ok(removeSection(s, a.id));
  assert.equal(nextSectionName(s), 'A', 'the freed letter comes back');
  assert.ok(removeSection(s, b.id));
  assert.ok(!('sections' in s), 'the last removal removes the key');
});

test('a section too short to cut anything is refused', () => {
  const s = createState(20, 20);
  assert.equal(addSection(s, { x: 0, z: 0 }, { x: 2, z: 0 }), null);
  assert.ok(!('sections' in s));
});

test('sectionAt finds the drawn line and nothing else', () => {
  const s = createState(20, 20);
  const a = addSection(s, { x: 0, z: 10 }, { x: 40, z: 10 });
  assert.equal(sectionAt(s, 20, 11), a);
  assert.equal(sectionAt(s, 20, 20), null);
});

test('normalizeSections survives anything a file can hand it', () => {
  assert.deepEqual(normalizeSections(null), []);
  assert.deepEqual(normalizeSections('nonsense'), []);
  const kept = normalizeSections([
    { id: 3, name: 'A', ax: 0, az: 0, bx: 40, bz: 0 },
    { id: 4, name: 'A', ax: 0, az: 8, bx: 40, bz: 8 },      // colliding name
    { name: 'zz', ax: 0, az: 16, bx: 40, bz: 16 },          // unusable name
    { ax: 0, az: 0, bx: 1, bz: 0 },                          // too short
    { ax: 'x', az: 0, bx: 40, bz: 0 },                       // not numbers
    { ax: 0, az: 0, bx: 1e9, bz: 0 },                        // off the earth
  ]);
  assert.equal(kept.length, 3);
  assert.deepEqual(kept.map((k) => k.name), ['A', 'B', 'C'],
    'collisions re-letter, garbage is dropped');
  const many = normalizeSections(Array.from({ length: 40 }, (_, i) => (
    { ax: 0, az: i * 10, bx: 40, bz: i * 10 })));
  assert.equal(many.length, MAX_SECTIONS, 'the cap holds');
});

// ---------- the cut ----------

// A cut straight across the 40x20 room, looking north (the line drawn
// west-to-east looks at the half above it on the plan).
function cutAcross(s) {
  return computeSection(s, { id: 1, name: 'A', ax: -5, az: 10, bx: 45, bz: 10 });
}

test('a cut through a box finds two walls and one slab', () => {
  const s = box(10, 5);
  const sec = cutAcross(s);
  assert.equal(sec.label, 'Section A-A');
  assert.equal(sec.cuts.length, 2, 'poché where the plane crosses each side wall');
  for (const c of sec.cuts) {
    const [y0, y1] = polyY(c.poly);
    near(y0, 0, 1e-6, 'poché from the floor');
    near(y1, WALL_H, 1e-6, 'to the wall head');
  }
  assert.equal(sec.slabs.length, 1, 'one slab under the cut');
  const [sy0, sy1] = polyY(sec.slabs[0].poly);
  near(sy1, 0, 1e-6, 'slab top at the storey');
  near(sy0, -SLAB_T, 1e-6, 'a foot of structure');
  const [su0, su1] = polyU(sec.slabs[0].poly);
  assert.ok(su0 >= 4 && su1 <= 46, 'the slab stays inside the room');
  assert.ok(sec.roofline.length >= 1, 'the roof passes overhead');
  const roofY = sec.roofline[0][0].y;
  near(roofY, WALL_H + PARAPET_H + COPING_T, 1e-6, 'at the parapet');
});

test('a door the plane slices leaves only the wall above its head', () => {
  const s = box(10, 5);
  const shape = shapesOf(s.floors[0])[0];
  const west = segWhere(shape, (a, b) => a.x === 0 && b.x === 0);
  assert.ok(west >= 0);
  addOpening(shape, 0, west, 0.5, 4);   // a door, mid-wall — right where the cut runs
  const sec = cutAcross(s);
  const westCuts = sec.cuts.filter((c) => polyU(c.poly)[0] < 10);
  assert.equal(westCuts.length, 1, 'one band where two would mean no door');
  const [y0, y1] = polyY(westCuts[0].poly);
  near(y0, 7, 1e-6, 'poché starts at the door head');
  near(y1, WALL_H, 1e-6, 'and runs to the wall head');
});

test('a window beyond the cut shows in elevation', () => {
  const s = box(10, 5);
  const shape = shapesOf(s.floors[0])[0];
  const seg = segWhere(shape, (a, b) => a.z === 0 && b.z === 0);   // the north wall
  addOpening(shape, 0, seg, 0.5, 6, { k: OP_WINDOW });
  const sec = cutAcross(s);
  const win = sec.paints.filter((p) => p.kind === 'window');
  assert.equal(win.length, 1, 'the far wall shows its window');
  near(win[0].depth, 10, 1e-6, 'ten feet beyond the plane');
  const [y0, y1] = polyY(win[0].poly);
  near(y0, 3, 1e-6, 'sill');
  near(y1, 7, 1e-6, 'head');
});

test('a stair the plane crosses climbs in risers', () => {
  const s = box(10, 5);
  addFloor(s);
  slabOn(s, 1, [0, 0, 9, 4]);
  s.currentFloor = 0;
  const { link } = addStair(s, 0, { x: 20, z: 10, rotationY: Math.PI / 2 });
  assert.ok(link, 'the stair placed');
  const sec = cutAcross(s);
  assert.equal(sec.stairs.length, 1);
  const m = stairMetrics(s);
  assert.equal(sec.stairs[0].steps, m.steps);
  const ys = sec.stairs[0].pts.map((p) => p.y);
  near(Math.min(...ys), 0, 1e-6, 'starts on this storey');
  near(Math.max(...ys), FLOOR_H, 1e-6, 'lands on the next');
});

test('the cut is honest about where the building is not', () => {
  const s = box(10, 5);
  // A cut that misses the building entirely: no poché, no slab, no roof.
  const sec = computeSection(s, { id: 1, name: 'A', ax: 0, az: 40, bx: 40, bz: 40 });
  assert.equal(sec.cuts.length, 0);
  assert.equal(sec.slabs.length, 0);
  assert.equal(sec.roofline.length, 0);
  assert.ok(sec.grade.length > 0, 'the ground is still there');
});

test('roofHeightAt answers null off the building', () => {
  const s = box(10, 5);
  const plan = roofPlan(s);
  const mask = roofMask(s.floors[0], s.w, s.h);
  assert.equal(roofHeightAt(plan, mask, 200, 200), null);
  near(roofHeightAt(plan, mask, 20, 10), WALL_H + PARAPET_H + COPING_T, 1e-6,
    'a parapet roof is flat at its coping');
});

// ---------- the file ----------

test('a drawn section survives the file and an undrawn one is not in it', async () => {
  const { serialize, deserialize } = await import('../js/save-load.js');
  const s = box(10, 5);
  assert.ok(!JSON.parse(serialize(s)).sections, 'no drawn section, no key');
  const sec = addSection(s, { x: 0, z: 10 }, { x: 40, z: 10 });
  const json = JSON.parse(serialize(s));
  assert.equal(json.sections.length, 1);
  assert.equal(json.sections[0].name, 'A');
  const back = deserialize(JSON.stringify(json));
  assert.equal(sectionsOf(back).length, 1);
  assert.equal(sectionsOf(back)[0].name, 'A');
  near(sectionsOf(back)[0].bz, 10, 1e-9, 'the points came back');
  assert.ok(sectionsOf(back)[0].id < back.nextId, 'the id counter cleared it');
  // A hostile record reads as a design with no sections, never a failure.
  json.sections = [{ ax: 'x' }];
  assert.ok(!('sections' in deserialize(JSON.stringify(json))));
  assert.ok(sec, 'the drawn one still exists in memory');
});
