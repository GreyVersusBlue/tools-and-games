// The building's own lights: which props emit, how they cluster, and what
// survives the budget. Run `node --test` from Projects/school-generator.
//
// The whole point of this module is that the budget is checkable without a
// GPU — a cap you only find out about on someone else's machine isn't a cap.
// So these tests are about the properties that make the strategy honest:
// nothing is silently dropped (spill is accounted for), clustering never moves
// light out of a room, the ranking prefers what you can actually see, and the
// same design always produces the same clusters.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState } from '../js/grid.js';
import { addProp } from '../js/props.js';
import { catalogEntry, PROP_CATALOG } from '../js/catalog.js';
import {
  MAX_DYNAMIC_LIGHTS, CLUSTER_FT, LUMENS_TO_CANDELA, SPILL_MAX,
  emitOf, isEmitter, lightSources, clusterSources, budgetLights, budgetFor,
  spillAmbient,
} from '../js/lights.js';

// A tiny stand-in catalog, so the clustering tests don't depend on the real
// table's dimensions staying put.
const TEST_ROWS = {
  troffer: { type: 'troffer', emit: { lm: 4000, color: '#fff4e2', range: 26, dy: -0.2 } },
  bay: { type: 'bay', emit: { lm: 20000, color: '#ffffff', range: 70, dy: 0 } },
  pole: { type: 'pole', site: true, emit: { lm: 12000, color: '#f6f2e4', range: 90, dy: 21 } },
  desk: { type: 'desk' },
  broken: { type: 'broken', emit: { lm: 0 } },
};
const testCatalog = (t) => TEST_ROWS[t] || null;

function design(props, floors = 2) {
  const s = createState(20, 20);
  while (s.floors.length < floors) s.floors.push(s.floors[0]);
  for (const p of props) addProp(s, p.type, p);
  return s;
}

// ---------- reading a row ----------

test('a row with an emit block is a light; anything else is furniture', () => {
  assert.ok(isEmitter(TEST_ROWS.troffer));
  assert.ok(!isEmitter(TEST_ROWS.desk));
  assert.ok(!isEmitter(null));
  assert.ok(!isEmitter({ emit: 'bright' }));
  // Zero lumens is not a light. A fixture that emits nothing should not take a
  // slot in a twelve-light budget.
  assert.ok(!isEmitter(TEST_ROWS.broken));
});

test('an emit block is normalized, and a hostile one still yields a usable light', () => {
  const e = emitOf({ emit: { lm: 900, color: 'RED', range: -4, dy: 'up', kind: 'laser' } });
  assert.equal(e.lm, 900);
  assert.equal(e.color, '#fff2d8', 'an unparseable colour falls back to warm white');
  assert.ok(e.range > 0, 'a negative range would be a light with no reach');
  assert.equal(e.dy, 0);
  assert.equal(e.kind, 'point');
  assert.equal(emitOf({ emit: { lm: 100, kind: 'spot' } }).kind, 'spot');
});

// ---------- the real catalog ----------

test('every emitting catalog row states a plausible real-world output', () => {
  const emitters = PROP_CATALOG.filter((e) => isEmitter(e));
  assert.ok(emitters.length >= 10, 'Phase 3 ships a lighting category');
  for (const e of emitters) {
    const em = emitOf(e);
    assert.ok(em.lm >= 50 && em.lm <= 60000, `${e.type} emits ${em.lm}lm, which is not a luminaire`);
    assert.ok(/^#[0-9a-f]{6}$/.test(em.color), `${e.type} has no lamp colour`);
    assert.ok(em.range >= 5 && em.range <= 200, `${e.type} reaches ${em.range}ft`);
    // The emitter has to be inside the fixture, not floating above or below it.
    assert.ok(Math.abs(em.dy) <= e.h + 0.5, `${e.type}'s emitter is outside its own housing`);
  }
});

test('brighter fixtures reach further than dimmer ones', () => {
  const by = (t) => emitOf(catalogEntry(t));
  assert.ok(by('light-highbay').lm > by('troffer-2x4').lm);
  assert.ok(by('light-highbay').range > by('troffer-2x4').range);
  assert.ok(by('troffer-2x4').lm > by('lamp-desk').lm);
  assert.ok(by('troffer-2x4').range > by('lamp-desk').range);
});

// ---------- sources ----------

test('only emitting props become sources, in world feet', () => {
  const s = design([
    { type: 'troffer', floor: 1, x: 10, z: 20, y: 9.5 },
    { type: 'desk', floor: 1, x: 12, z: 20 },
  ]);
  const src = lightSources(s, testCatalog, 12);
  assert.equal(src.length, 1);
  assert.equal(src[0].x, 10);
  assert.equal(src[0].z, 20);
  // floor 1 base (12ft) + mount height (9.5) + the emitter's own offset (-0.2)
  assert.equal(src[0].y, 12 + 9.5 - 0.2);
  assert.equal(src[0].lm, 4000);
});

test('a scaled fixture is a scaled luminaire', () => {
  const s = design([{ type: 'troffer', floor: 0, x: 4, z: 4, y: 9.5, scale: 2 }]);
  const [src] = lightSources(s, testCatalog, 12);
  assert.equal(src.lm, 16000, 'output goes with area, not with length');
  assert.equal(src.range, 52);
});

test('a design with no props, or an unknown type, is simply unlit', () => {
  assert.deepEqual(lightSources(createState(8, 8), testCatalog), []);
  assert.deepEqual(lightSources({ props: [{ type: 'nope', floor: 0, x: 0, z: 0 }] }, testCatalog), []);
  assert.deepEqual(lightSources(null, testCatalog), []);
});

test('site fixtures are marked as such and never merge with interior ones', () => {
  const s = design([
    { type: 'pole', floor: 0, x: 30, z: 30 },
    { type: 'troffer', floor: 0, x: 30, z: 30, y: 9.5 },
  ]);
  const src = lightSources(s, testCatalog, 12);
  assert.equal(src.filter((x) => x.outdoor).length, 1);
  assert.equal(clusterSources(src, 100).length, 2, 'inside and outside stay apart');
});

// ---------- clustering ----------

test('a room of troffers becomes one light in the middle of the room', () => {
  const props = [];
  for (let i = 0; i < 8; i++) props.push({ type: 'troffer', floor: 0, x: 4 + i * 0.5, z: 10, y: 9.5 });
  const clusters = clusterSources(lightSources(design(props), testCatalog, 12), CLUSTER_FT);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].count, 8);
  assert.equal(clusters[0].lm, 32000, 'no lumens go missing in the merge');
  assert.ok(clusters[0].x > 4 && clusters[0].x < 8, 'and it sits among them');
  assert.ok(clusters[0].range > 26, 'eight fixtures light more than one does');
});

test('clustering never moves a light out of the room it is in', () => {
  // Two fixtures 40ft apart must not merge into one in the corridor between.
  const s = design([
    { type: 'troffer', floor: 0, x: 5, z: 5, y: 9.5 },
    { type: 'troffer', floor: 0, x: 45, z: 5, y: 9.5 },
  ]);
  const clusters = clusterSources(lightSources(s, testCatalog, 12), CLUSTER_FT);
  assert.equal(clusters.length, 2);
});

test('storeys never merge, however close the fixtures are in plan', () => {
  const s = design([
    { type: 'troffer', floor: 0, x: 8, z: 8, y: 9.5 },
    { type: 'troffer', floor: 1, x: 8, z: 8, y: 9.5 },
  ]);
  assert.equal(clusterSources(lightSources(s, testCatalog, 12), CLUSTER_FT).length, 2);
});

test('a merged cluster takes the brightest member colour, not an average', () => {
  const s = design([
    { type: 'troffer', floor: 0, x: 2, z: 2, y: 9 },
    { type: 'bay', floor: 0, x: 3, z: 2, y: 9 },
  ]);
  const [c] = clusterSources(lightSources(s, testCatalog, 12), CLUSTER_FT);
  assert.equal(c.color, '#ffffff', 'the high bay is what the eye reads');
  assert.ok(c.x > 2.7, 'and the centroid sits under it');
});

test('clustering is stable: the same design always gives the same clusters', () => {
  const props = [];
  for (let i = 0; i < 30; i++) {
    props.push({ type: 'troffer', floor: i % 2, x: (i * 7) % 60, z: (i * 13) % 60, y: 9.5 });
  }
  const s = design(props);
  const a = clusterSources(lightSources(s, testCatalog, 12), CLUSTER_FT);
  const b = clusterSources(lightSources(s, testCatalog, 12), CLUSTER_FT);
  assert.equal(a.length, b.length);
  assert.deepEqual(a.map((c) => [c.x, c.y, c.z, c.lm]), b.map((c) => [c.x, c.y, c.z, c.lm]));
});

test('clustering conserves lumens no matter how coarse it is', () => {
  const props = [];
  for (let i = 0; i < 40; i++) props.push({ type: 'troffer', floor: 0, x: i * 3, z: (i % 5) * 3, y: 9.5 });
  const src = lightSources(design(props), testCatalog, 12);
  const total = src.reduce((n, s) => n + s.lm, 0);
  for (const cell of [2, CLUSTER_FT, 50, 500]) {
    const cl = clusterSources(src, cell);
    const sum = cl.reduce((n, c) => n + c.lm, 0);
    assert.ok(Math.abs(sum - total) < 1e-6, `lumens lost at ${cell}ft buckets`);
    assert.equal(cl.reduce((n, c) => n + c.count, 0), src.length);
  }
});

// ---------- the budget ----------

test('the nearest lights win, and the rest are accounted for rather than dropped', () => {
  const clusters = [];
  for (let i = 0; i < 20; i++) clusters.push({ x: i * 4, y: 6, z: 0, lm: 4000, range: 26, color: '#fff' });
  const { lit, spillLm } = budgetLights(clusters, { x: 0, y: 6, z: 0 }, 5);
  assert.equal(lit.length, 5);
  assert.deepEqual(lit.map((c) => c.x), [0, 4, 8, 12, 16], 'in distance order');
  assert.equal(spillLm, 15 * 4000, 'every unlit lumen is still counted');
});

test('a light you are standing outside the reach of loses to one you are inside', () => {
  const near = { x: 2, y: 0, z: 0, lm: 450, range: 1, color: '#fff' };    // a desk lamp, out of reach
  const far = { x: 60, y: 0, z: 0, lm: 20000, range: 90, color: '#fff' }; // a high bay, in reach
  const { lit } = budgetLights([near, far], { x: 0, y: 0, z: 0 }, 1);
  assert.equal(lit[0], far);
});

test('an empty design, or a cap of zero, is handled rather than special-cased', () => {
  assert.deepEqual(budgetLights([], { x: 0, y: 0, z: 0 }, 5).lit, []);
  assert.equal(budgetLights([], { x: 0, y: 0, z: 0 }, 5).spillLm, 0);
  const one = [{ x: 0, y: 0, z: 0, lm: 100, range: 10, color: '#fff' }];
  assert.equal(budgetLights(one, { x: 0, y: 0, z: 0 }, 0).lit.length, 0);
  assert.equal(budgetLights(one, { x: 0, y: 0, z: 0 }, 0).spillLm, 100);
  // A missing eye is the origin, not a crash.
  assert.equal(budgetLights(one, null, 1).lit.length, 1);
});

test('the budget never hands the renderer more lights than the pool has', () => {
  const props = [];
  for (let i = 0; i < 400; i++) {
    props.push({ type: 'troffer', floor: 0, x: (i % 20) * 13, z: Math.floor(i / 20) * 13, y: 9.5 });
  }
  const r = budgetFor(design(props), testCatalog, { x: 100, y: 6, z: 100 }, { floorHt: 12 });
  assert.equal(r.sources, 400);
  assert.ok(r.lit.length <= MAX_DYNAMIC_LIGHTS);
  assert.ok(r.spillLm > 0, 'and says so when it had to leave some out');
});

test('walking toward a fixture eventually lights it', () => {
  const props = [
    { type: 'troffer', floor: 0, x: 0, z: 0, y: 9.5 },
    { type: 'troffer', floor: 0, x: 200, z: 0, y: 9.5 },
  ];
  const s = design(props);
  const here = budgetFor(s, testCatalog, { x: 0, y: 6, z: 0 }, { floorHt: 12, cap: 1 });
  assert.ok(Math.abs(here.lit[0].x) < 1);
  const there = budgetFor(s, testCatalog, { x: 200, y: 6, z: 0 }, { floorHt: 12, cap: 1 });
  assert.ok(Math.abs(there.lit[0].x - 200) < 1);
});

// ---------- the spill ----------

test('the spill fill rises with what was left out and is bounded', () => {
  assert.equal(spillAmbient(0), 0);
  assert.equal(spillAmbient(-5), 0);
  assert.ok(spillAmbient(4000) > 0);
  assert.ok(spillAmbient(40000) > spillAmbient(4000));
  assert.ok(spillAmbient(1e9) <= SPILL_MAX);
  // Monotonic, so scrubbing lights on doesn't make the room darker anywhere.
  let prev = -1;
  for (let lm = 0; lm < 500000; lm += 5000) {
    const v = spillAmbient(lm);
    assert.ok(v >= prev, `spill fill dipped at ${lm}lm`);
    prev = v;
  }
});

test('lumens convert to candela the way the physics says', () => {
  assert.ok(Math.abs(4000 * LUMENS_TO_CANDELA - 318.31) < 0.01);
});
