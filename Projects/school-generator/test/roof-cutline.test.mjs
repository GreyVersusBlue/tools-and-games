// Along #990's cut the parapet is drawn once (#992). Run
// `node --test 'test/*.test.mjs'` from Projects/school-generator.
//
// #990 cut a neighbour's loop back to a curved building's chords, so along the
// cut the neighbour's parapet and the curved building's stood on one line and
// were drawn twice. The run is the curved building's: its loop is drawn whole,
// and the neighbour's edges that lie along its chords are left out.

import test from 'node:test';
import assert from 'node:assert/strict';

import * as roof from '../js/roof.js';
import { addShape, curveSegment } from '../js/shapes.js';
import { createState } from '../js/grid.js';
import { takeoff } from '../js/takeoff.js';
import { quantities } from '../js/cost.js';

const { roofPlan, roofOutline } = roof;
// Before #992 there was no `parapetRuns`, and the renderer drew every edge of
// every outline; that is the fallback, so the old code fails an assertion
// below rather than the import.
const runsOf = roof.parapetRuns || ((plan) => plan.outlines.flatMap((l) => l.map((a, i) => [a, l[(i + 1) % l.length]])));

const R4 = (x0, z0, x1, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
const len = ([a, b]) => Math.hypot(b.x - a.x, b.z - a.z);
const same = (r, e) => Math.hypot(r[0].x - e[0].x, r[0].z - e[0].z) < 1e-9 && Math.hypot(r[1].x - e[1].x, r[1].z - e[1].z) < 1e-9;

// How far two segments lie on top of each other: zero unless they are on one
// line, then the length of the part of that line both cover.
function overlap([a, b], [c, d]) {
  const ux = b.x - a.x, uz = b.z - a.z, L = Math.hypot(ux, uz);
  const off = (p) => Math.abs((p.x - a.x) * uz - (p.z - a.z) * ux) / L;
  if (off(c) > 1e-6 || off(d) > 1e-6) return 0;
  const t = (p) => ((p.x - a.x) * ux + (p.z - a.z) * uz) / L;
  return Math.max(0, Math.min(L, Math.max(t(c), t(d))) - Math.max(0, Math.min(t(c), t(d))));
}

// The pair of test/roof-trim.test.mjs: a 40 by 24 hall with its east wall
// bowed out to x 73.56, and a box from x 73.8 whose first mask cell runs from
// 72 to 76, 1.56ft inside the chords.
function school({ bow = -0.4, box = 73.8, style = 'parapet', curve = true } = {}) {
  const s = createState(50, 30);
  const hall = addShape(s, 0, R4(24, 8, 64, 32));
  addShape(s, 0, R4(8, 8, 24, 32));
  if (curve) assert.ok(curveSegment(hall, 0, 1, bow) > 3, 'the curve tool laid a curve');
  if (box != null) addShape(s, 0, R4(box, 16, 95, 24));
  s.roof = { style, pitch: 6, facade: 'brick' };
  return s;
}
const hallOf = (s) => roofOutline(s.floors[0]).loops.find((l) => l.length > 4);

test('the cut pair: no stretch of parapet is drawn twice', () => {
  const runs = runsOf(roofPlan(school()));
  let twice = 0;
  for (let i = 0; i < runs.length; i++) for (let j = i + 1; j < runs.length; j++) twice += overlap(runs[i], runs[j]);
  assert.ok(twice < 1e-6, `${twice.toFixed(3)}ft of parapet drawn twice`);
});

test('the shared run is the hall\'s: its chords are drawn whole, and the box keeps the rest of its loop', () => {
  const s = school();
  const plan = roofPlan(s);
  const runs = runsOf(plan);
  const hall = hallOf(s);
  for (let i = 0; i < hall.length; i++) {
    const chord = [hall[i], hall[(i + 1) % hall.length]];
    assert.ok(runs.some((r) => same(r, chord)), `the hall's edge ${i} is drawn as it stands`);
  }
  // The box's loop less every stretch of it on the hall's chords is what is
  // left of its parapet, and that is drawn too.
  const box = plan.outlines[0];
  const boxEdges = box.map((a, i) => [a, box[(i + 1) % box.length]]);
  const onHall = (e) => hall.some((a, i) => overlap([a, hall[(i + 1) % hall.length]], e) > len(e) - 1e-6);
  const own = boxEdges.filter((e) => !onHall(e));
  const shared = boxEdges.filter(onHall);
  assert.ok(shared.length >= 1, 'the box\'s loop runs along the chords where it was cut');
  for (const e of own) assert.ok(runs.some((r) => same(r, e)), `the box's edge from ${e[0].x},${e[0].z}`);
  const total = runs.reduce((a, r) => a + len(r), 0);
  const want = hall.reduce((a, p, i) => a + len([p, hall[(i + 1) % hall.length]]), 0) + own.reduce((a, e) => a + len(e), 0);
  assert.ok(Math.abs(total - want) < 1e-6, `${total} drawn against ${want}`);
});

test('every other roof draws every edge of its outlines, as before', () => {
  const cases = [
    school({ bow: -0.3125, box: 72.5 }),  // #988: cells only touch, nothing cut
    school({ box: null }),                // the hall alone
    school({ curve: false, box: 64.5 }),  // a rectilinear pair
  ];
  for (const s of cases) {
    const plan = roofPlan(s);
    assert.ok(!('parapetSkip' in plan), 'no skip list where nothing was cut');
    const all = plan.outlines.flatMap((l) => l.map((a, i) => [a, l[(i + 1) % l.length]]));
    assert.deepEqual(runsOf(plan), all);
  }
  for (const style of ['flat', 'gable', 'hip']) assert.ok(!('parapetSkip' in roofPlan(school({ style }))), style);
});

test('the takeoff and the estimate are what #990 counted: the roof is area, and the parapet is not in them', () => {
  const s = school();
  const cover = roof.roofCover(s);
  assert.ok(Math.abs(takeoff(s).roof.footprint - cover.footprint) < 1e-9);
  const membrane = [...quantities(s).all.entries()].find(([k]) => /^roof:membrane/.test(k));
  assert.ok(Math.abs(membrane[1] - cover.footprint) < 1e-9);
  assert.ok(![...quantities(s).all.keys()].some((k) => /parapet/.test(k)), 'no parapet line in the estimate');
});

// The renderer needs a browser, so this one is pinned at the source: its
// parapet is `parapetRuns`, not its own walk over `plan.outlines`.
test('render.js draws the parapet off parapetRuns', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../js/render.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('function buildRoofGroup('), src.indexOf('for (const rect of plan.deckRects)'));
  assert.match(body, /for \(const \[a, b\] of parapetRuns\(plan\)\) parapetRun\(a, b,/);
  assert.doesNotMatch(body, /plan\.outlines/);
});
