// Switchback ramps. Run `node --test 'test/*.test.mjs'` from
// Projects/school-generator.
//
// The fold is arithmetic, so it is checked as arithmetic a person can do on
// paper: a 12ft storey at 1:12 is five runs of 28.8ft in a box 20ft by
// 38.8ft, the middle of the second lane is 3.6ft up, the floor above opens
// 4.8ft along the third lane. The rails are checked the other way round, by
// a walker that knows nothing about lanes: it steps across the whole box a
// quarter foot at a time and every step that would take it off the ramp, or
// up or down a drop, has to cross a rail unless it is the entry or the exit.

import test from 'node:test';
import assert from 'node:assert/strict';

import { HEADROOM } from '../js/stairs.js';
import {
  MAX_RUN_RISE, LANDING_D, MAX_RUNS,
  minRuns, switchbackLayout, switchbackSurfaceAt, switchbackCut, switchbackRails,
} from '../js/switchback.js';

const near = (a, b, msg, eps = 1e-9) =>
  assert.ok(a !== null && Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

// The case the backlog row names: one storey, the ADA slope, the default lane.
const storey = (over = {}) => switchbackLayout({ rise: 12, slope: 12, width: 4, ...over });

// ---------- how many runs ----------

test('a run rises 30in and no more, so 12ft is five runs', () => {
  assert.equal(MAX_RUN_RISE, 2.5);
  assert.equal(minRuns(12), 5, '12 / 2.5 is 4.8');
  assert.equal(minRuns(2.5), 1, 'exactly 30in is one run');
  assert.equal(minRuns(10), 4, 'an exact multiple does not round up');
  // 0.1 * 3 * 25 is 7.500000000000001 in a double. That is three runs.
  assert.equal(minRuns(0.1 * 3 * 25), 3, 'and neither does one that is off by float noise');
  assert.equal(minRuns(10.01), 5);
  assert.equal(minRuns(0), 1);
  assert.equal(storey().n, 5, 'and the layout takes that count when none is asked for');
});

test('a run count that breaks the 30in rule is built and marked', () => {
  assert.equal(storey({ runs: 4 }).legal, false, '3ft a run');
  assert.equal(storey({ runs: 5 }).legal, true, '2.4ft a run');
  assert.equal(switchbackLayout({ rise: 10, runs: 4 }).legal, true, 'exactly 30in a run');
  assert.equal(switchbackLayout({ rise: 0.1 * 3 * 25, runs: 3 }).legal, true, '30in and float noise');
  assert.equal(storey({ runs: 99 }).n, MAX_RUNS);
  assert.equal(storey({ runs: 0 }).n, 1);
});

// ---------- the footprint ----------

test('five lanes of 4ft and 28.8ft runs stand in 20ft by 38.8ft', () => {
  const l = storey();
  near(l.runLen, 28.8, 'each run');
  near(l.runRise, 2.4, 'each rise');
  assert.equal(l.landingD, LANDING_D);
  assert.deepEqual(
    [l.box.x0, l.box.x1, l.box.z0].map((v) => +v.toFixed(9)), [-2, 18, -5]);
  near(l.box.z1, 33.8, 'far end');
  near(l.box.x1 - l.box.x0, 20, 'width');
  near(l.box.z1 - l.box.z0, 38.8, 'length, against 144ft straight');
  // Five runs, plus four turns of one lane over and one landing deep.
  near(l.travel, 5 * 28.8 + 4 * (4 + 5), 'the walk');
});

test('one run is the straight ramp, with nothing at its near end', () => {
  const l = switchbackLayout({ rise: 2, slope: 12, width: 4 });
  assert.equal(l.n, 1);
  assert.deepEqual(l.box, { x0: -2, x1: 2, z0: 0, z1: 24 + LANDING_D });
  assert.equal(l.landings.length, 1);
  assert.equal(l.landings[0].kind, 'top');
  near(l.travel, 24, 'the walk is the run');
});

test('a turn landing spans two lanes and is 5ft deep', () => {
  const l = storey();
  assert.equal(l.landings.filter((x) => x.kind === 'turn').length, 4);
  for (const t of l.landings.filter((x) => x.kind === 'turn')) {
    near(t.box.x1 - t.box.x0, 8, 'two lanes wide');
    near(t.box.z1 - t.box.z0, 5, '60in deep');
  }
  // Even lanes end at the far end, odd ones at the near end.
  near(l.landings[0].box.z0, 28.8, 'turn 0 is at the far end');
  assert.equal(l.landings[1].box.z1, 0, 'turn 1 is at the near end');
  assert.deepEqual(l.landings[1].lanes, [1, 2]);
});

// ---------- the surface ----------

test('the surface is the height a hand calculation gives', () => {
  const l = storey();
  const h = (x, z) => switchbackSurfaceAt(l, x, z);
  near(h(0, 0), 0, 'the foot');
  near(h(0, 14.4), 1.2, 'half way up lane 0');
  near(h(2, 30), 2.4, 'turn 0');
  // Lane 1 comes back: it is at 2.4 at the far end and 4.8 at the near one.
  near(h(4, 14.4), 3.6, 'half way down lane 1');
  near(h(4, 7.2), 4.2, 'three quarters of the way back');
  near(h(6, -2), 4.8, 'turn 1');
  near(h(16, 14.4), 10.8, 'half way up lane 4');
  near(h(16, 31), 12, 'the top landing is the floor above');
  assert.equal(h(0, -2), null, 'in front of the entry is the lower floor, not ramp');
  assert.equal(h(-2.1, 10), null);
  assert.equal(h(16, 34), null);
});

test('no run is steeper than the slope asked for, and the joints are level', () => {
  for (const runs of [1, 2, 3, 5, 6]) {
    const l = storey({ runs });
    for (const r of l.runs) {
      const x = (r.box.x0 + r.box.x1) / 2;
      for (let z = 0; z + 0.5 <= l.runLen; z += 0.5) {
        const g = Math.abs(switchbackSurfaceAt(l, x, z + 0.5) - switchbackSurfaceAt(l, x, z)) / 0.5;
        near(g, 1 / 12, `runs ${runs} lane ${r.i} grade at z ${z}`, 1e-9);
      }
      // A run meets the landing at its top at the landing's own height.
      const land = l.landings[r.i];
      const zTop = r.dir === 1 ? l.runLen : 0;
      near(switchbackSurfaceAt(l, x, zTop), land.y, `runs ${runs} lane ${r.i} top`);
      // ...and the next run leaves that landing at the same height.
      if (r.i > 0) near(r.y0, l.landings[r.i - 1].y, `runs ${runs} lane ${r.i} foot`);
    }
    near(l.landings[l.landings.length - 1].y, 12, `runs ${runs} arrives`);
  }
});

// ---------- the hole in the floor above ----------

test('the floor above opens where the ramp comes within headroom of it', () => {
  const l = storey();
  // 12 - 6.8 = 5.2ft. Lane 2 climbs 4.8 to 7.2, so it crosses a sixth of the
  // way along: 4.8ft. Turn 1, at 4.8, keeps its ceiling.
  const cut = switchbackCut(l, HEADROOM);
  const key = (b) => [b.x0, b.x1, b.z0, b.z1].map((v) => v.toFixed(6)).join(' ');
  assert.deepEqual(cut.map(key), [
    key({ x0: 6, x1: 10, z0: 4.8, z1: 28.8 }),      // lane 2 from the crossing
    key({ x0: 10, x1: 14, z0: 0, z1: 28.8 }),       // lane 3
    key({ x0: 14, x1: 18, z0: 0, z1: 28.8 }),       // lane 4
    key({ x0: 6, x1: 14, z0: 28.8, z1: 33.8 }),     // turn 2, at 7.2
    key({ x0: 10, x1: 18, z0: -5, z1: 0 }),         // turn 3, at 9.6
    key({ x0: 14, x1: 18, z0: 28.8, z1: 33.8 }),    // the top landing
  ]);
});

test('every point with less than headroom is in the cut, and no other', () => {
  // Four runs is 3ft a run, so the line (5.2ft) falls in lane 1, which comes
  // back toward the near end: the cut has to keep the other end of it.
  for (const [runs, side] of [[5, 1], [6, 1], [5, -1], [2, 1], [4, 1], [4, -1]]) {
    const l = storey({ runs, side });
    const cut = switchbackCut(l);
    const inCut = (x, z) => cut.some((b) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1);
    let open = 0, shut = 0;
    for (let x = l.box.x0 + 0.13; x < l.box.x1; x += 0.5) {
      for (let z = l.box.z0 + 0.13; z < l.box.z1; z += 0.5) {
        const h = switchbackSurfaceAt(l, x, z);
        if (h === null) { assert.equal(inCut(x, z), false, `off the ramp at ${x},${z}`); continue; }
        const needs = 12 - h < HEADROOM;
        assert.equal(inCut(x, z), needs, `runs ${runs} side ${side} at ${x},${z} (h ${h})`);
        if (needs) open++; else shut++;
      }
    }
    assert.ok(open > 0 && shut > 0, 'the sweep saw both');
  }
});

test('a rise under headroom opens the whole ramp', () => {
  const l = switchbackLayout({ rise: 5, slope: 12, width: 4 });
  assert.equal(l.n, 2);
  assert.equal(switchbackCut(l).length, l.runs.length + l.landings.length);
});

// ---------- the rails ----------

const crosses = (p, q, s) => {
  const o = (a, b, c) => Math.sign((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
  return o(p, q, s.a) !== o(p, q, s.b) && o(s.a, s.b, p) !== o(s.a, s.b, q);
};

// Step across the box on a lattice that never lands on a lane line. A step is
// a drop when one end is off the ramp or the two ends differ by more than the
// ramp itself could account for.
function unguarded(l) {
  const rails = switchbackRails(l);
  const open = [l.entry, l.exit];
  const STEP = 0.25, DROP = 0.1;
  const holes = [];
  const check = (p, q) => {
    const hp = switchbackSurfaceAt(l, p.x, p.z), hq = switchbackSurfaceAt(l, q.x, q.z);
    if (hp === null && hq === null) return;
    const drop = hp === null || hq === null || Math.abs(hp - hq) > DROP;
    if (!drop) return;
    if (rails.some((s) => crosses(p, q, s))) return;
    if (open.some((s) => crosses(p, q, s))) return;
    holes.push({ p, q, hp, hq });
  };
  for (let x = l.box.x0 - 0.63; x < l.box.x1 + 1; x += STEP) {
    for (let z = l.box.z0 - 0.63; z < l.box.z1 + 1; z += STEP) {
      check({ x, z }, { x: x + STEP, z });
      check({ x, z }, { x, z: z + STEP });
    }
  }
  return holes;
}

test('there is no way off the ramp, or down a drop, but the entry and the exit', () => {
  for (const runs of [1, 2, 3, 4, 5, 6, 7]) {
    for (const side of [1, -1]) {
      const holes = unguarded(storey({ runs, side }));
      assert.equal(holes.length, 0,
        `runs ${runs} side ${side}: ${holes.length} unguarded, first ${JSON.stringify(holes[0])}`);
    }
  }
});

test('no rail stands across the way up', () => {
  // Walk the middle of it: up each lane, across each turn. Nothing crosses.
  for (const runs of [1, 2, 5, 6]) {
    for (const side of [1, -1]) {
      const l = storey({ runs, side });
      const rails = switchbackRails(l);
      const path = [{ x: 0, z: -1 }];
      for (const r of l.runs) {
        const x = (r.box.x0 + r.box.x1) / 2;
        const turnZ = r.dir === 1 ? l.runLen + l.landingD / 2 : -l.landingD / 2;
        path.push({ x, z: r.dir === 1 ? 0.01 : l.runLen - 0.01 });
        path.push({ x, z: turnZ });
        if (r.i === l.n - 1) path.push({ x, z: r.dir === 1 ? l.runLen + l.landingD + 1 : -l.landingD - 1 });
      }
      for (let i = 1; i < path.length; i++) {
        const hit = rails.find((s) => crosses(path[i - 1], path[i], s));
        assert.equal(hit, undefined,
          `runs ${runs} side ${side}: leg ${i} crosses ${JSON.stringify(hit)}`);
      }
    }
  }
});

test('five runs take eleven rails: five edges, four dividers, three between landings', () => {
  const rails = switchbackRails(storey());
  const count = (k) => rails.filter((s) => s.kind === k).length;
  assert.equal(count('edge'), 5);
  assert.equal(count('divider'), 4);
  assert.equal(count('landing'), 3);
  // Dividers stop where the landings start.
  for (const s of rails.filter((x) => x.kind === 'divider')) {
    assert.equal(s.a.z, 0);
    near(s.b.z, 28.8, 'a divider is one run long');
  }
});

// ---------- the other hand ----------

test('side -1 is the same ramp mirrored', () => {
  const a = storey(), b = storey({ side: -1 });
  assert.deepEqual([b.box.x0, b.box.x1], [-18, 2]);
  for (const [x, z] of [[0, 10], [4, 10], [6, -2], [16, 31], [9, 30], [0, -2]]) {
    assert.equal(switchbackSurfaceAt(b, -x, z), switchbackSurfaceAt(a, x, z), `at ${x},${z}`);
  }
  assert.equal(switchbackRails(b).length, switchbackRails(a).length);
  assert.deepEqual(b.entry.a.z, 0);
  near(Math.abs(b.exit.a.x - b.exit.b.x), 4, 'the exit is one lane wide');
});
