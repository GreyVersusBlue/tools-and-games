// A ramp's width and slope, set from the Stairs panel (#907).
//
// `data.width` and `data.slope` are not new: a ramp has carried both since
// Phase 2 and every reader takes them through `stairWidth` and `rampSlope`.
// What is new is a way to set them without editing a file, and the range that
// way is held to. This file is the rule, the save, and each reader's answer
// for one ramp worked by hand: a 12ft storey at 1:16 is 192ft of run, 6ft
// wide is 1152 ft² of deck, the headroom line (6.8ft under the floor above)
// is crossed 83.2ft along, and the 5ft landing ends the hole at 197.
//
// The two steppers themselves are chrome; test/tools/run.mjs presses them.
//
// Run with: node --test test/ramp-size.test.mjs  (from the project folder)

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, addFloor } from '../js/grid.js';
import { sheet } from './build.mjs';
import {
  addStair, stairRun, stairMetrics, stairWidth, rampSlope, runLength, runMetrics,
  footprintBox, cutBox, stairSurfaceAt, rampLandingBox, rampLayout, rampGuards, openingRails,
  RAMP_CTRL, stepRampWidth, stepRampSlope, setRampSize, runPhrase,
  RAMP_W, RAMP_SLOPE, MIN_RAMP_W, MAX_RAMP_W, MIN_RAMP_SLOPE, MAX_RAMP_SLOPE,
} from '../js/stairs.js';
import { rampRolls, rampLandingFit, MAX_SEATED_GRADE } from '../js/clearance.js';
import { accessibleAnalysis } from '../js/egress.js';
import { buildNav, runLandings } from '../js/navgraph.js';
import { takeoff } from '../js/takeoff.js';
import { quantities } from '../js/cost.js';
import { addSection, computeSection } from '../js/elevation.js';
import { computeFloorPlan } from '../js/blueprint.js';
import { openingRailSegments } from '../js/collide.js';
import { buildSampleSchool } from '../js/sample.js';
import { serialize, deserialize, SAVE_VERSION } from '../js/save-load.js';

const M = stairRun(12);
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const find = (list, code) => list.find((f) => f.code === code);
const ramp = (data = {}) => ({ id: 1, type: 'ramp', from: 0, to: 1, x: 0, z: 0, rotationY: 0, data });

// Two long halls, one over the other (x 4..284, z 4..36), and a ramp with its
// foot at (20, 20) climbing toward +X: local z is world x less 20, and local
// x is 20 less world z.
function school(opts = {}) {
  const s = createState(80, 20);
  addFloor(s);
  sheet(s, 0).box(1, 1, 70, 8, { name: 'Ground Hall' }).door(1, 4, false).bake();
  sheet(s, 1).box(1, 1, 70, 8, { name: 'Upper Hall' }).bake();
  const { link } = addStair(s, 0, { type: 'ramp', x: 20, z: 20, rotationY: Math.PI / 2, ...opts });
  return { s, link };
}

// ---------- the range ----------

test('the panel holds a ramp to 4..12ft and 1:12..1:20, inside what a file may hold', () => {
  assert.deepEqual({ ...RAMP_CTRL }, { minW: 4, maxW: 12, stepW: 0.5, steepest: 12, gentlest: 20 });
  // The tool's own numbers, not new ones: the default ramp is the floor of both.
  assert.equal(RAMP_CTRL.minW, RAMP_W);
  assert.equal(RAMP_CTRL.steepest, RAMP_SLOPE);
  // A file is clamped wider than that, and stays so.
  assert.deepEqual([MIN_RAMP_W, MAX_RAMP_W, MIN_RAMP_SLOPE, MAX_RAMP_SLOPE], [3, 12, 4, 20]);
  assert.ok(RAMP_CTRL.minW > MIN_RAMP_W && RAMP_CTRL.steepest > MIN_RAMP_SLOPE);
});

test('1:12 is the line a chair climbs, and every slope the stepper reaches is on the right side of it', () => {
  assert.ok(near(1 / RAMP_CTRL.steepest, MAX_SEATED_GRADE));
  const reached = [];
  for (let s = RAMP_CTRL.gentlest, i = 0; i < 40; i++) { reached.push(s); s = stepRampSlope(s, -1); }
  assert.deepEqual([...new Set(reached)], [20, 19, 18, 17, 16, 15, 14, 13, 12]);
  for (const slope of reached) assert.equal(rampRolls(ramp({ slope })), true, `1:${slope}`);
  // One step past the stepper's end is the steep ramp it never makes.
  assert.equal(rampRolls(ramp({ slope: 11 })), false);
});

test('a press is 6in of width or one of slope, and stops at each end', () => {
  assert.equal(stepRampWidth(4, 1), 4.5);
  assert.equal(stepRampWidth(4.5, -1), 4);
  assert.equal(stepRampWidth(4, -1), 4);
  assert.equal(stepRampWidth(12, 1), 12);
  assert.equal(stepRampWidth(11.5, 1), 12);
  assert.equal(stepRampSlope(12, 1), 13);
  assert.equal(stepRampSlope(13, -1), 12);
  assert.equal(stepRampSlope(12, -1), 12);
  assert.equal(stepRampSlope(20, 1), 20);
  // A ramp a file left outside the range: the one live button lands on the limit.
  assert.equal(stepRampWidth(3, 1), 4);
  assert.equal(stepRampWidth(3, -1), 4);
  assert.equal(stepRampSlope(8, 1), 12);
  assert.equal(stepRampSlope(6, -1), 12);
  // ...and one off the half-foot grid comes back onto it.
  assert.equal(stepRampWidth(4.2, 1), 4.5);
});

// ---------- writing it ----------

test('setRampSize writes the field named and no other', () => {
  const { link } = school();
  assert.deepEqual(link.data, { width: 4, slope: 12 });
  assert.equal(setRampSize(link, { width: 6 }), true);
  assert.deepEqual(link.data, { width: 6, slope: 12 });
  assert.equal(setRampSize(link, { slope: 16 }), true);
  assert.deepEqual(link.data, { width: 6, slope: 16 });
  assert.equal(setRampSize(link, { width: 6, slope: 16 }), false, 'the same again changes nothing');
  assert.equal(setRampSize(link, {}), false);
  // A file's 1:8 ramp keeps its slope while its width is stepped, and the
  // other way about: the finding it raises is not silently cleared.
  const steep = ramp({ width: 3, slope: 8 });
  assert.equal(setRampSize(steep, { width: stepRampWidth(stairWidth(steep), 1) }), true);
  assert.deepEqual(steep.data, { width: 4, slope: 8 });
  const narrow = ramp({ width: 3, slope: 8 });
  setRampSize(narrow, { slope: stepRampSlope(rampSlope(narrow), 1) });
  assert.deepEqual(narrow.data, { width: 3, slope: 12 });
});

test('setRampSize holds what it writes to the range, keeps the fold, and leaves a stair alone', () => {
  const link = ramp({ width: 4, slope: 12, runs: 5, side: -1 });
  setRampSize(link, { width: 99, slope: 99 });
  assert.deepEqual(link.data, { width: 12, slope: 20, runs: 5, side: -1 });
  setRampSize(link, { width: 1, slope: 1 });
  assert.deepEqual(link.data, { width: 4, slope: 12, runs: 5, side: -1 });
  setRampSize(link, { width: 5.3, slope: 14.4 });
  assert.deepEqual(link.data, { width: 5.5, slope: 14, runs: 5, side: -1 });
  assert.equal(setRampSize(link, { width: NaN, slope: 'x' }), false);
  assert.deepEqual(link.data, { width: 5.5, slope: 14, runs: 5, side: -1 });
  // A ramp whose record has no data at all gets one.
  const bare = { type: 'ramp' };
  assert.equal(setRampSize(bare, { width: 5 }), true);
  assert.deepEqual(bare.data, { width: 5 });
  const stair = { type: 'stair', data: { width: 4 } };
  assert.equal(setRampSize(stair, { width: 8, slope: 16 }), false);
  assert.deepEqual(stair.data, { width: 4 });
  assert.equal(setRampSize(null, { width: 8 }), false);
});

// ---------- the save ----------

test('a set width and slope are in the file and come back; the version does not move', () => {
  assert.equal(SAVE_VERSION, 12);
  const { s, link } = school();
  setRampSize(link, { width: 6.5, slope: 16 });
  const text = serialize(s);
  assert.match(text, /"data":\{"width":6\.5,"slope":16\}/);
  const back = deserialize(text);
  const l = back.links.find((x) => x.type === 'ramp');
  assert.deepEqual(l.data, { width: 6.5, slope: 16 });
  assert.equal(stairWidth(l), 6.5);
  assert.equal(rampSlope(l), 16);
  assert.equal(serialize(back), text);
});

test('a ramp saved with neither field is the 4ft 1:12 ramp it was, and is written back as it came', () => {
  const { s, link } = school();
  const withBoth = { m: runMetrics(link, M), box: footprintBox(link, M), cut: cutBox(link, M) };
  // The record an old file holds: no width, no slope.
  link.data = {};
  const old = serialize(s);
  assert.match(old, /"type":"ramp"[^}]*"data":\{\}/);
  const back = deserialize(old);
  const l = back.links.find((x) => x.type === 'ramp');
  assert.deepEqual(l.data, {}, 'loading writes no default into the record');
  assert.equal(stairWidth(l), 4);
  assert.equal(rampSlope(l), 12);
  assert.deepEqual({ m: runMetrics(l, M), box: footprintBox(l, M), cut: cutBox(l, M) }, withBoth);
  assert.equal(serialize(back), old);
  // Its findings are the default ramp's, word for word.
  const a = accessibleAnalysis(back), b = accessibleAnalysis(school().s);
  assert.deepEqual(a.findings.map((f) => [f.code, f.title, f.detail]), b.findings.map((f) => [f.code, f.title, f.detail]));
});

test('the sample school has no ramp, so nothing in it can move', () => {
  const sample = buildSampleSchool();
  assert.equal((sample.links || []).filter((l) => l.type === 'ramp').length, 0);
  const text = serialize(sample);
  assert.equal(serialize(deserialize(text)), text);
});

// ---------- every reader, one ramp: 6ft wide at 1:16 up 12ft ----------

test('geometry: footprint, hole, surface and landing are the 6ft ramp at 1:16', () => {
  const { s, link } = school({ width: 6, slope: 16 });
  const m = stairMetrics(s);
  assert.equal(runLength(link, m), 192);
  assert.deepEqual(footprintBox(link, m), { x0: -3, x1: 3, z0: 0, z1: 192 });
  const cut = cutBox(link, m);
  assert.deepEqual([cut.x0, cut.x1, cut.z1], [-3.25, 3.25, 197]);
  assert.ok(near(cut.z0, 83.2));
  // Halfway along is halfway up; 2.5ft off the middle is on it, 3.5ft is not.
  assert.ok(near(stairSurfaceAt(link, m, 20 + 96, 20), 6));
  assert.ok(near(stairSurfaceAt(link, m, 20 + 96, 20 - 2.5), 6));
  assert.equal(stairSurfaceAt(link, m, 20 + 96, 20 - 3.5), null);
  // The default ramp is off at 2.5ft: the width is what moved it.
  assert.equal(stairSurfaceAt(school().link, m, 20 + 96, 20 - 2.5), null);
  assert.deepEqual(rampLandingBox(link, m), { x0: -3, x1: 3, z0: 192, z1: 197 });
});

test('the rails round the hole, drawn and collided with, stand 6.5ft apart', () => {
  const { s, link } = school({ width: 6, slope: 16 });
  const sides = openingRails(link, stairMetrics(s)).map((r) => r.side).sort();
  assert.deepEqual(sides, ['left', 'near', 'right']);
  const zs = [...new Set(openingRailSegments(s, 1).flatMap((r) => [r.az, r.bz]).map((z) => Math.round(z * 100) / 100))];
  assert.deepEqual(zs.sort((a, b) => a - b), [16.75, 23.25]);
});

test('clearance: the landing asked about is the ramp\'s own width', () => {
  // A 3ft floor opening beside the top of the run, local x 2.3 to 5.3: clear
  // of a 4ft landing (out to 2), inside a 6ft one (out to 3).
  const build = (width) => {
    const { s, link } = school({ width, slope: 16 });
    addStair(s, 0, { type: 'opening', x: 20 + 194.5, z: 20 - 3.8, w: 3, d: 3 });
    return rampLandingFit(s, link);
  };
  assert.equal(build(4), null);
  const fit = build(6);
  assert.ok(fit);
  assert.deepEqual(fit.why, ['link']);
});

test('the accessible route takes it, with no steep ramp and no narrow one', () => {
  const { s, link } = school({ width: 6, slope: 16 });
  const a = accessibleAnalysis(s);
  assert.equal(a.summary.ramps, 1);
  assert.equal(a.summary.steepRamps, 0);
  assert.equal(a.summary.storeysReached, 2);
  assert.equal(find(a.findings, 'steep-ramp'), undefined);
  // The route's two ends: 2ft short of the foot, 2ft past the hole at 217.
  const ends = runLandings(link, stairMetrics(s));
  assert.ok(near(ends.foot.x, 18) && near(ends.head.x, 219));
  const nav = buildNav(s, { accessible: true });
  const edge = nav.links.find((l) => l.type === 'ramp');
  assert.ok(edge, 'the ramp is in the accessible graph');
  assert.ok(near(edge.b.x, 219));
  // What a file can still hold, a 1:8 ramp, is left out of it and reported.
  const steep = school({ slope: 8 });
  assert.equal(buildNav(steep.s, { accessible: true }).links.some((l) => l.type === 'ramp'), false);
  assert.ok(find(accessibleAnalysis(steep.s).findings, 'steep-ramp'));
});

test('takeoff and cost price 6ft by 192ft of deck', () => {
  const { s } = school({ width: 6, slope: 16 });
  const row = takeoff(s).links.find((l) => l.type === 'ramp');
  assert.equal(row.label, 'Ramp 6 ft wide at 1:16');
  assert.deepEqual([row.w, row.run, row.area, row.slope], [6, 192, 1152, 16]);
  assert.equal(quantities(s).all.get('ramp'), 1152);
  // The default ramp is 4ft by 144ft: 576.
  assert.equal(quantities(school().s).all.get('ramp'), 576);
});

test('the plan symbol and the section draw it at its own width and length', () => {
  const { s } = school({ width: 6, slope: 16 });
  const sym = computeFloorPlan(s, 0).stairs.find((x) => x.kind === 'ramp');
  assert.deepEqual([sym.width, sym.slope], [6, 16]);
  const sec = addSection(s, { x: 10, z: 20 }, { x: 300, z: 20 });
  const drawn = computeSection(s, sec).stairs.find((x) => x.kind === 'ramp');
  assert.deepEqual(drawn.pts, [{ u: 10, y: 0 }, { u: 202, y: 12 }]);
});

test('a folded ramp takes both: lanes 6ft wide, runs a fifth of 192ft', () => {
  const { s, link } = school({ width: 6, slope: 16, runs: 5 });
  const m = stairMetrics(s);
  const layout = rampLayout(link, m);
  assert.equal(layout.width, 6);
  assert.ok(near(layout.runLen, 38.4));
  assert.deepEqual([layout.box.x0, layout.box.x1], [-3, 27]);
  // The guards stand on the lane lines, 6ft apart.
  const xs = [...new Set(rampGuards(link, m).flatMap((g) => [g.a.x, g.b.x]))].sort((a, b) => a - b);
  assert.deepEqual(xs, [-3, 3, 9, 15, 21, 27]);
  const row = takeoff(s).links.find((l) => l.type === 'ramp');
  // 6 x 192 of slope, four 12 x 5 turns and a 6 x 5 top landing.
  assert.equal(row.area, 1152 + 4 * 60 + 30);
});

// ---------- what the status line calls it ----------

test('a straight ramp is described by its own run, not the staircase\'s', () => {
  // The building's metrics carry a stair's 19.25ft; a ramp's run is its slope's.
  assert.ok(near(M.run, 19.25));
  assert.equal(runPhrase(ramp(), M), '144.0ft of run at 1:12');
  assert.equal(runPhrase(ramp({ slope: 16 }), M), '192.0ft of run at 1:16');
  assert.equal(runPhrase(ramp({ runs: 5 }), M), '5 runs of 28.8ft at 1:12, 29in of rise each');
  assert.equal(runPhrase(ramp({ runs: 4, slope: 16 }), M),
    '4 runs of 48.0ft at 1:16, 36in of rise each (over the 30in a run may rise)');
  assert.equal(runPhrase({ type: 'stair', data: {} }, M), '21 risers at 6.9in, 19.3ft of run');
});
