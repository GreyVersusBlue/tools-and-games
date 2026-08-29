// A tool's own gesture, played back. Run `node --test` from
// Projects/school-generator.
//
// This module compiles a lesson into pointer events, so the properties worth
// holding are the ones that decide whether the lesson lands: a demo draws
// where nothing already is, it compiles the same way every time, its presses
// and releases are balanced, every move it makes happens somewhere the sheet
// covers, and every demo claims a change the tools pass can check. The demo
// that says it draws a room and quietly draws nothing is the failure this
// suite exists to make loud — and `test/tools/run.mjs`'s `show-me` check is
// where the claim itself is settled, on the real page.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEMOS, DEMO_IDS, EVENT_KINDS, STEP_FT, SAMPLE_MS, DEMO_MARGIN,
  demoById, demoSpot, demoEvents, sayAt, ghostAt, demoBounds, demoCommands,
} from '../js/demo.js';
import { createState } from '../js/grid.js';
import { CELL } from '../js/grid.js';
import { shapesOf, shapeBBox, pointInShape } from '../js/shapes.js';
import { boxRoom } from './build.mjs';

const plans = () => DEMOS.map((d) => demoEvents(d, { x: 0, z: 0 }));

// ---------- the demos ----------

test('every demo is a whole scene, and claims a change worth checking', () => {
  assert.ok(DEMOS.length >= 3);
  assert.equal(new Set(DEMO_IDS).size, DEMOS.length);
  for (const d of DEMOS) {
    assert.ok(d.title && d.blurb, `${d.id} has no label`);
    assert.equal(demoById(d.id), d);
    // A demo that claims nothing is a demo nothing can catch when it rots.
    const claims = Object.entries(d.changes || {});
    assert.ok(claims.length > 0, `${d.id} claims no change`);
    for (const [key, delta] of claims) {
      assert.ok(Number.isInteger(delta) && delta > 0, `${d.id}.${key} is not a positive delta`);
    }
    // ...and it starts by picking the tool it is about, rather than teaching
    // whatever tool the last person left selected.
    assert.equal(d.steps.find((s) => s[0] === 'tool')[0], 'tool');
  }
  assert.equal(demoById('nope'), null);
  assert.deepEqual(demoCommands().map((c) => c.id), DEMO_IDS);
  assert.match(demoCommands()[0].name, /^Show me: /);
});

test('each demo lays whatever it needs, so any one of them can be the first', () => {
  // The lesson you can only take in one order is not a lesson, it is a
  // sequence — and the palette has no order.
  for (const d of DEMOS) {
    const first = d.steps.findIndex((s) => s[0] === 'tool');
    const tool = d.steps[first][1];
    if (d.changes.props) {
      assert.ok(d.steps.some((s) => s[0] === 'tool' && s[1] === 'floor'),
        `${d.id} places furniture without laying floor to put it on`);
    }
    assert.ok(typeof tool === 'string' && tool.length > 0);
  }
});

// ---------- compiling one ----------

test('a demo compiles the same way every time', () => {
  const a = demoEvents('floor', { x: 40, z: 40 });
  const b = demoEvents(demoById('floor'), { x: 40, z: 40 });
  assert.deepEqual(a, b);
  assert.ok(a.duration > 3000, 'a lesson nobody can read is not a lesson');
  assert.ok(a.duration < 40000, 'a lesson nobody will sit through is not one either');
});

test('every event is on the list, in time order, and inside the plan', () => {
  for (const plan of plans()) {
    let last = -1;
    for (const e of plan.events) {
      assert.ok(EVENT_KINDS.includes(e.kind), `${plan.id}: unknown event ${e.kind}`);
      assert.ok(e.t >= last, `${plan.id}: events went backwards in time`);
      assert.ok(e.t <= plan.duration);
      last = e.t;
    }
  }
});

test('presses and releases are balanced, and nothing is pressed twice', () => {
  // An unbalanced gesture leaves the editor mid-drag with the pointer gone —
  // which is exactly the state a person cannot get out of without a reload.
  for (const plan of plans()) {
    let down = false;
    for (const e of plan.events) {
      if (e.kind === 'down') {
        assert.ok(!down, `${plan.id}: pressed while already pressed`);
        down = true;
      }
      if (e.kind === 'up') {
        assert.ok(down, `${plan.id}: released without pressing`);
        down = false;
      }
    }
    assert.ok(!down, `${plan.id}: the demo ends mid-drag`);
  }
});

test('a drag is a path, not two endpoints', () => {
  // The brush paints what the pointer crossed; handing it a start and an end
  // paints two tiles and no room. Same reason the tools harness walks its
  // waypoints one at a time.
  const plan = demoEvents('floor');
  const moves = plan.events.filter((e) => e.kind === 'move');
  assert.ok(moves.length > 12, `only ${moves.length} samples in a four-leg drag`);
  for (let i = 1; i < moves.length; i++) {
    const step = Math.hypot(moves[i].x - moves[i - 1].x, moves[i].z - moves[i - 1].z);
    assert.ok(step <= STEP_FT + 1e-9, `a leap of ${step} ft between samples`);
  }
  // ...and samples inside one leg are evenly spaced in time. (Across a press
  // or a sentence they are not, which is the point of both.)
  let legs = 0;
  for (let i = 1; i < plan.events.length; i++) {
    const a = plan.events[i - 1], b = plan.events[i];
    if (a.kind !== 'move' || b.kind !== 'move') continue;
    assert.equal(b.t - a.t, SAMPLE_MS);
    legs++;
  }
  assert.ok(legs > 10, 'no leg was long enough to check');
});

test('the spot is an offset, and every coordinate rides on it', () => {
  const here = demoEvents('floor', { x: 0, z: 0 });
  const there = demoEvents('floor', { x: 120, z: 64 });
  assert.equal(here.events.length, there.events.length);
  for (let i = 0; i < here.events.length; i++) {
    const a = here.events[i], b = there.events[i];
    assert.equal(a.kind, b.kind);
    assert.equal(a.t, b.t);
    if (Number.isFinite(a.x)) {
      assert.ok(Math.abs(b.x - a.x - 120) < 1e-9);
      assert.ok(Math.abs(b.z - a.z - 64) < 1e-9);
    }
  }
  // Nonsense in, origin out — never NaN coordinates, which a pointer event
  // would carry all the way into a tool.
  const bad = demoEvents('floor', { x: 'over there' });
  for (const e of bad.events) if (Number.isFinite(e.x) || e.kind === 'move') assert.ok(Number.isFinite(e.x));
  assert.deepEqual(demoEvents('nope'), { id: null, duration: 0, events: [] });
  assert.deepEqual(demoEvents(null).events, []);
  assert.throws(() => demoEvents({ id: 'x', steps: [['jump', 1, 2]] }), /no such step/);
});

// ---------- reading a playback ----------

test('the status line can be answered at any moment, including after the end', () => {
  const plan = demoEvents('wall');
  assert.equal(sayAt(plan, -1), '');
  assert.equal(sayAt(plan, 0), plan.events.find((e) => e.kind === 'say').text);
  const last = [...plan.events].reverse().find((e) => e.kind === 'say');
  assert.equal(sayAt(plan, plan.duration + 5000), last.text);
});

test('the ghost is somewhere real whenever the button is down', () => {
  const plan = demoEvents('floor', { x: 20, z: 20 });
  assert.equal(ghostAt(plan, 0).down, false);
  const press = plan.events.find((e) => e.kind === 'down');
  const release = plan.events.find((e) => e.kind === 'up');
  const mid = ghostAt(plan, (press.t + release.t) / 2);
  assert.equal(mid.down, true);
  assert.ok(Number.isFinite(mid.pos.x) && Number.isFinite(mid.pos.z));
  assert.equal(ghostAt(plan, plan.duration).down, false);
  assert.equal(ghostAt(plan, plan.duration).done, true);
  assert.equal(ghostAt(plan, 0).done, false);
});

test('the bounds are read off the events, so they cannot disagree with them', () => {
  const plan = demoEvents('floor', { x: 20, z: 20 });
  const b = demoBounds(plan);
  for (const e of plan.events) {
    if (!Number.isFinite(e.x)) continue;
    assert.ok(e.x >= b.x0 && e.x <= b.x1 && e.z >= b.z0 && e.z <= b.z1);
  }
  assert.equal(demoBounds({ events: [] }), null);
});

// ---------- where a demo draws ----------

test('an empty sheet gets the near corner, clear of the edge', () => {
  const spot = demoSpot(createState(40, 30), 32, 24);
  assert.equal(spot.grown, false);
  assert.ok(spot.x >= DEMO_MARGIN && spot.z >= DEMO_MARGIN);
});

test('a demo never draws on top of a room somebody already has', () => {
  const state = createState(60, 40);
  // A building across the west half of the sheet.
  boxRoom(state, 0, 1, 1, 24, 20, { name: 'Existing' });
  const spot = demoSpot(state, 40, 32);
  const plan = demoEvents('floor', spot);
  const b = demoBounds(plan);
  for (const sh of shapesOf(state.floors[0])) {
    const room = shapeBBox(sh);
    const overlaps = b.x0 < room.x1 && b.x1 > room.x0 && b.z0 < room.z1 && b.z1 > room.z0;
    assert.ok(!overlaps, 'the lesson would be drawn through an existing room');
    // And not merely edge to edge with it — a demo drawn against a wall reads
    // as part of the building rather than as a lesson beside it.
    for (const e of plan.events) {
      if (!Number.isFinite(e.x)) continue;
      assert.ok(!pointInShape(sh, e.x, e.z), 'a pointer sample landed inside a room');
    }
  }
});

test('a sheet with no room left grows east rather than drawing on the building', () => {
  const state = createState(12, 12);
  boxRoom(state, 0, 0, 0, 11, 11, { name: 'Everything' });
  const spot = demoSpot(state, 40, 32);
  assert.equal(spot.grown, true);
  // Snapped to the drawing grid: the floor brush lands on cell boundaries or
  // a hair off them, and a hair off them is a room one tile wider than drawn.
  assert.equal(spot.x % CELL, 0);
  assert.ok(spot.x >= 12 * CELL);
});

test('a state that is barely a state still answers', () => {
  assert.ok(Number.isFinite(demoSpot(null).x));
  assert.ok(Number.isFinite(demoSpot({}).z));
  assert.ok(Number.isFinite(demoSpot({ floors: [] }, 40, 32).x));
});
