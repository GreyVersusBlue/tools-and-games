// node test/sim.mjs
//
// The world, stepped by hand: pathing, following, the stop line, the box,
// collisions, determinism, and the eight archetypes against Standard on the
// same seed. Exits non-zero on any FAIL (#13). No DOM, no timers: the same
// modules index.html runs, imported through pathToFileURL (Windows rule).
//
// Every scenario builds its own World so nothing leaks between groups, and
// the demand knobs are per scenario so a check reads as "given this traffic,
// this happens" rather than depending on a shared soak.

import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const load = f => import(pathToFileURL(path.join(HERE, '..', 'js', f)).href);
const { World, DT } = await load('sim.js');
const { Network, rectsOverlap, LANE_WIDTH } = await load('network.js');
const { ARCHETYPES, Car, stopLineVerdict } = await load('cars.js');
const { makeRng } = await load('rng.js');

let passed = 0, failed = 0;
const ok = (cond, what, detail = '') => {
  if (cond) { passed++; console.log(`  ok    ${what}${detail ? '  ' + detail : ''}`); }
  else { failed++; console.log(`  FAIL  ${what}${detail ? '  ' + detail : ''}`); }
};
const group = name => console.log(`\n${name}`);
const f1 = x => (+x).toFixed(1);

// Level shapes used below
const GREEN_NS = { demand: {}, duration: 600, controller: { startPhase: 0 } };      // N-S green, never changes
const GREEN_EW = { demand: {}, duration: 600, controller: { startPhase: 1 } };      // E-W green: N and S see red
const CYCLING = { demand: { N: 400, S: 400, E: 300, W: 300 }, duration: 180, controller: { rules: [{ when: 'elapsed', seconds: 20, then: 'next' }] } };

/* ---------------------------------------------------------------- network -- */

group('the network');

{
  const n = new Network();
  const p = n.pathFor('N', 0, 'T');
  ok(p && p.length > 200 && p.stopLine < p.boxEnter && p.boxEnter < p.boxExit && p.boxExit < p.length,
    'a through path runs approach, stop line, box, departure in that order', `${f1(p.stopLine)} < ${f1(p.boxEnter)} < ${f1(p.boxExit)} < ${f1(p.length)}`);
  const a = p.at(0), b = p.at(p.length);
  ok(Math.abs(a.x - (-LANE_WIDTH / 2)) < 1e-6 && a.y < -100 && b.y > 100, 'N-T starts at the top on the west half of the road and ends at the bottom', `(${f1(a.x)}, ${f1(a.y)}) to (${f1(b.x)}, ${f1(b.y)})`);
  const r = n.pathFor('N', 0, 'R'), l = n.pathFor('N', 0, 'L');
  ok(r.at(r.length).x < -100 && l.at(l.length).x > 100, 'N-R ends west, N-L ends east');
  ok(r.boxExit - r.boxEnter < l.boxExit - l.boxEnter, 'a right turn is shorter through the box than a left', `${f1(r.boxExit - r.boxEnter)} vs ${f1(l.boxExit - l.boxEnter)}`);
  const x = n.crossing(n.pathFor('E', 0, 'L'), n.pathFor('W', 0, 'L'));
  ok(x.dist > 3.5, 'opposing lefts pass at least 3.5 m apart', `${x.dist.toFixed(2)} m`);
  const y = n.crossing(n.pathFor('N', 0, 'T'), n.pathFor('E', 0, 'T'));
  ok(y.dist < 0.6, 'crossing throughs actually cross', `${y.dist.toFixed(2)} m`);
  ok(n.paths.size === 12, 'a 4-way with one lane per direction has 12 paths', String(n.paths.size));
  const two = new Network({ lanesPerDir: 2 });
  ok(two.paths.size === 16 && two.pathFor('N', 1, 'L') && !two.pathFor('N', 0, 'L') && two.pathFor('N', 0, 'R') && !two.pathFor('N', 1, 'R'),
    'with two lanes, lefts leave from the inner lane and rights from the curb', String(two.paths.size));
}
{
  const a = { x: 0, y: 0, heading: 0, length: 4, width: 2 };
  ok(rectsOverlap(a, { x: 3.9, y: 0, heading: 0, length: 4, width: 2 }), 'nose to tail with 0.1 m overlap collides');
  ok(!rectsOverlap(a, { x: 4.1, y: 0, heading: 0, length: 4, width: 2 }), '0.1 m of daylight does not');
  ok(!rectsOverlap(a, { x: 0, y: 2.1, heading: 0, length: 4, width: 2 }), 'side by side in adjacent lanes does not');
  ok(rectsOverlap(a, { x: 2.5, y: 1.5, heading: Math.PI / 2, length: 4, width: 2 }), 'a T-bone does');
}

/* --------------------------------------------------------------- one car -- */

group('one car, one light');

{
  const w = new World(GREEN_NS, 1);
  const c = w.spawnCar({ leg: 'N', archetype: 'standard', turn: 'T' });
  let t = 0;
  while (!c.done && w.t < 60) { w.step(); if (!c.done) t = w.t; }
  ok(c.done && t > 14 && t < 20, 'a standard car on a green clears 220 m in 14 to 20 s', `${f1(t)} s`);
  ok(c.wait < 0.2, 'without waiting', `${f1(c.wait)} s`);
  ok(w.stats.cleared === 1 && w.stats.collisions === 0, 'and the counters say one cleared, none crashed');
}
{
  const w = new World(GREEN_EW, 1);
  const c = w.spawnCar({ leg: 'N', archetype: 'standard', turn: 'T' });
  w.run(25);
  ok(c.v === 0, 'on a red it stops', `v = ${c.v}`);
  const d = c.path.stopLine - c.front;
  ok(d > 0 && d < 3.5, 'with its nose within 3.5 m short of the line', `${f1(d)} m short`);
  ok(c.wait > 5, 'and its wait is counted', `${f1(c.wait)} s`);
  w.requestPhase(0);
  w.run(10);
  ok(c.v > 5, 'a green releases it', `v = ${f1(c.v)}`);
}
{
  // yellow from far away: stop. From close: go.
  const w = new World({ ...GREEN_NS, controller: { startPhase: 0, timing: { yellow: 3, allRed: 1, minGreen: 1 } } }, 1);
  const far = w.spawnCar({ leg: 'N', archetype: 'standard', turn: 'T' });
  w.run(2);
  w.requestPhase(1);     // yellow now; far is about 30 m in, 70 m from the line
  w.run(11);
  ok(far.v === 0 && far.front < far.path.stopLine, 'a car 70 m out when the yellow comes stops for it', `front ${f1(far.front)} vs line ${f1(far.path.stopLine)}`);
  const w2 = new World({ ...GREEN_NS, controller: { startPhase: 0, timing: { yellow: 3, allRed: 1, minGreen: 1 } } }, 1);
  const near = w2.spawnCar({ leg: 'N', archetype: 'standard', turn: 'T' });
  w2.run(6.8);           // about 10 m from the line at 14 m/s
  w2.requestPhase(1);
  w2.run(6);
  ok(near.front > near.path.boxExit, 'a car 10 m out when the yellow comes goes through', `front ${f1(near.front)} vs box exit ${f1(near.path.boxExit)}`);
  ok(w2.stats.collisions === 0, 'and nothing was there to hit');
}

/* --------------------------------------------------------------- following -- */

group('following');

{
  // a single leg, heavy, all green, one archetype: nobody hits anybody
  const w = new World({ demand: { N: 900 }, duration: 120, mix: { standard: 1 }, controller: { startPhase: 0 } }, 3);
  let minGap = Infinity;
  for (let i = 0; i < 120 * 60; i++) {
    w.step();
    for (const c of w.cars) { if (c.done) continue; const l = w.leaderOf(c); if (l && l.gap < minGap) minGap = l.gap; }
  }
  ok(w.stats.collisions === 0, 'a free-flowing lane of 900 veh/h never rear-ends', `${w.stats.spawned} spawned, ${w.stats.cleared} cleared, ${w.stats.collisions} collisions`);
  ok(minGap > 0.3, 'and the closest any car got to the one ahead is daylight', `${minGap.toFixed(2)} m`);
  ok(w.stats.cleared > 20, 'and cars did get through', String(w.stats.cleared));
}
{
  // a platoon queued on red is released on green without touching
  const w = new World({ ...GREEN_EW, controller: { startPhase: 1, timing: { yellow: 2, allRed: 1, minGreen: 1 } } }, 2);
  const cars = [];
  for (let i = 0; i < 6; i++) { cars.push(w.spawnCar({ leg: 'N', archetype: 'standard', turn: 'T' })); w.run(2.5); }
  w.run(15);
  ok(cars.every(c => c.v === 0), 'six cars queue on the red', cars.map(c => f1(c.front)).join(' '));
  const gaps = cars.slice(1).map((c, i) => cars[i].rear - c.front);
  ok(gaps.every(g => g > 0.5 && g < 5), 'each 0.5 to 5 m behind the one ahead', gaps.map(f1).join(' '));
  w.requestPhase(0);
  w.run(40);
  ok(cars.every(c => c.done), 'a green clears all six in 40 s', cars.map(c => c.done ? 'out' : f1(c.front)).join(' '));
  ok(w.stats.collisions === 0, 'and none of them touched');
}

/* ------------------------------------------------------------- determinism -- */

group('determinism');

{
  const a = new World(CYCLING, 11).run(60), b = new World(CYCLING, 11).run(60);
  ok(a.hash() === b.hash(), 'the same seed stepped the same way hashes the same', a.hash().toString(16));
  ok(a.stats.cleared === b.stats.cleared && a.stats.spawned === b.stats.spawned, 'and counts the same');
  const c = new World(CYCLING, 12).run(60);
  ok(c.hash() !== a.hash(), 'a different seed is a different run');
  const d = new World(CYCLING, 11).run(5); d.requestPhase(1); d.run(55);
  ok(d.hash() !== a.hash(), 'and so is a different input');
}

/* ------------------------------------------------------------ the box -- */

group('the box: conflicts, permissive lefts, gridlock');

{
  // permissive left yields to the opposing through, then goes
  const w = new World({ ...GREEN_NS }, 4);
  const left = w.spawnCar({ leg: 'N', archetype: 'standard', turn: 'L' });
  w.run(2);
  const through = [];
  for (let i = 0; i < 4; i++) { through.push(w.spawnCar({ leg: 'S', archetype: 'standard', turn: 'T' })); w.run(2); }
  let leftWaited = false, crossedWhileBlocked = false;
  for (let i = 0; i < 60 * 40; i++) {
    w.step();
    if (!left.done && left.v < 0.5 && left.front > left.path.stopLine) leftWaited = true;
    if (!left.done && left.boxVerdict > 0 && left.front > left.boxVerdict + 1) crossedWhileBlocked = true;
  }
  ok(leftWaited, 'a permissive left waits in the box for the opposing throughs');
  ok(!crossedWhileBlocked, 'and does not push through while blocked');
  ok(left.done && w.stats.collisions === 0, 'then completes without touching anyone', `done ${left.done}, collisions ${w.stats.collisions}`);
}
{
  // N-S green and cross traffic queued: nobody on E or W enters the box
  const w = new World({ demand: { E: 500, W: 500 }, duration: 60, mix: { standard: 1 }, controller: { startPhase: 0 } }, 5);
  let entered = 0;
  for (let i = 0; i < 60 * 60; i++) { w.step(); for (const c of w.cars) if (!c.done && c.front > c.path.boxEnter) entered++; }
  ok(entered === 0, 'with E-W red, no car from E or W enters the box in a minute (red running off)', `${entered} ticks inside`);
}
{
  // a stuck controller gridlocks the cross street
  const w = new World({ demand: { E: 400 }, duration: 200, mix: { standard: 1 }, controller: { startPhase: 0 }, gridlockWait: 45 }, 6);
  w.run(70);
  ok(w.stats.gridlock && w.stats.gridlockAt > 45 && w.stats.gridlockAt < 70, 'a car waiting past the gridlock limit flags gridlock, once', `at ${f1(w.stats.gridlockAt)} s`);
  ok(w.stats.honks > 0, 'and patience ran out somewhere', `${w.stats.honks} honks`);
}

/* -------------------------------------------------------------- archetypes -- */

group('archetypes: each against standard on the same run');

const clearTime = (archetype, leg = 'N', turn = 'T', level = GREEN_NS) => {
  const w = new World(level, 1);
  const c = w.spawnCar({ leg, archetype, turn });
  let t = 0;
  while (!c.done && w.t < 90) { w.step(); if (!c.done) t = w.t; }
  return { t, car: c, world: w };
};
{
  const s = clearTime('standard'), g = clearTime('granny'), a = clearTime('aggressive'), tr = clearTime('trucker'), st = clearTime('student');
  ok(g.t > s.t + 4, 'granny takes at least 4 s longer than standard to clear', `${f1(g.t)} vs ${f1(s.t)}`);
  ok(a.t < s.t - 1, 'aggressive clears faster', `${f1(a.t)} vs ${f1(s.t)}`);
  ok(tr.t > s.t + 2, 'the truck is slower still', `${f1(tr.t)}`);
  ok(st.t > s.t, 'and the student is slower than standard', `${f1(st.t)}`);
}
{
  // aggressive follows closer: tail a slow leader and measure the settled gap
  const settled = archetype => {
    const w = new World(GREEN_NS, 1);
    const lead = w.spawnCar({ leg: 'N', archetype: 'granny', turn: 'T' });
    w.run(2);
    const f = w.spawnCar({ leg: 'N', archetype, turn: 'T' });
    let gap = Infinity;
    for (let i = 0; i < 60 * 12; i++) { w.step(); const l = w.leaderOf(f); if (l && !lead.done) gap = l.gap; }
    return { gap, v: f.v };
  };
  const s = settled('standard'), a = settled('aggressive'), g = settled('granny');
  ok(a.gap < s.gap - 3, 'aggressive tailgates: a smaller gap than standard behind the same granny', `${f1(a.gap)} vs ${f1(s.gap)} m`);
  ok(g.gap > s.gap + 2, 'and granny hangs back further', `${f1(g.gap)} m`);
}
{
  // red-light running is a per-approach roll: student never, aggressive sometimes
  const roll = archetype => {
    const rng = makeRng(99);
    const n = new Network();
    const p = n.pathFor('N', 0, 'T');
    const world = { redRunScale: 1, controller: { current: { permissive: [] } } };
    let ran = 0;
    for (let i = 0; i < 1000; i++) {
      const c = new Car({ archetype, path: p, rng });
      c.s = p.stopLine - 20; c.v = 12;
      stopLineVerdict(c, 'red', Infinity, world);
      if (c.committed) ran++;
    }
    return ran;
  };
  const st = roll('student'), ag = roll('aggressive'), sd = roll('standard'), gr = roll('granny');
  ok(st === 0, 'a student never runs a red in 1,000 approaches', String(st));
  ok(gr === 0, 'nor does granny', String(gr));
  ok(ag > 40 && ag < 140, 'aggressive runs about 8 in 100', `${ag} of 1,000`);
  ok(sd > 5 && sd < 45 && sd < ag, 'standard runs about 2 in 100, fewer than aggressive', `${sd} of 1,000`);
}
{
  // aggressive punches a yellow that standard stops for
  const decide = archetype => {
    const rng = makeRng(1);
    const n = new Network();
    const p = n.pathFor('N', 0, 'T');
    const c = new Car({ archetype, path: p, rng });
    c.s = p.stopLine - 45 - c.stats.length / 2; c.v = 14;
    stopLineVerdict(c, 'yellow', 0, { redRunScale: 1, controller: { current: { permissive: [] } } });
    return c.yellowDecision;
  };
  ok(decide('standard') === 'stop' && decide('aggressive') === 'go', '45 m out at 14 m/s: standard stops for the yellow, aggressive goes', `${decide('standard')} / ${decide('aggressive')}`);
  ok(decide('granny') === 'stop', 'granny stops');
}
{
  // emergency ignores the red
  const e = clearTime('emergency', 'N', 'T', GREEN_EW);
  ok(e.car.done && e.car.wait < 0.5, 'an emergency vehicle crosses a red without stopping', `cleared at ${f1(e.t)} s, waited ${f1(e.car.wait)} s`);
  const s = clearTime('standard', 'N', 'T', GREEN_EW);
  ok(!s.car.done, 'where a standard car is still sitting at it', `front ${f1(s.car.front)}`);
}
{
  // tourist hesitates and picks wrong turns; rideshare stops for pickups
  const many = (archetype, count, leg = 'N', spacing = 4) => {
    const w = new World(GREEN_NS, 21);
    for (let i = 0; i < count; i++) { w.spawnCar({ leg, archetype, turn: 'T' }); w.run(spacing); }
    w.run(30);
    const kinds = {};
    for (const e of w.events) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
    return { kinds, w };
  };
  const t = many('tourist', 40);
  ok((t.kinds.hesitate || 0) >= 5, 'forty tourists: at least five stop mid-box to check the map', `${t.kinds.hesitate || 0} hesitations`);
  ok((t.kinds['wrong-turn'] || 0) >= 1, 'and at least one takes the wrong turn', `${t.kinds['wrong-turn'] || 0}`);
  ok(t.w.stats.collisions === 0, 'and nobody behind them crashes into the hesitation', `${t.w.stats.collisions} collisions`);
  const r = many('rideshare', 40);
  ok((r.kinds.pickup || 0) >= 1, 'forty rideshares: at least one pickup stop', `${r.kinds.pickup || 0}`);
  ok(r.w.stats.collisions === 0, 'and nobody rear-ends it', `${r.w.stats.collisions} collisions`);
  const s = many('standard', 40);
  ok(!s.kinds.hesitate && !s.kinds.pickup && !s.kinds['wrong-turn'], 'standard cars do none of those');
}
{
  // granny sometimes stops on a green that is about to end
  const w = new World({ demand: {}, duration: 600, controller: { mode: 'timed', plan: [{ phase: 0, green: 12 }, { phase: 1, green: 6 }] } }, 8);
  for (let i = 0; i < 30; i++) { w.spawnCar({ leg: 'N', archetype: 'granny', turn: 'T' }); w.run(4); }
  w.run(30);
  const n = w.events.filter(e => e.kind === 'cautious').length;
  ok(n >= 2, 'thirty grannies through a 12 s green: at least two stop early for a green about to turn', `${n}`);
  ok(w.stats.collisions === 0, 'and the ones behind cope', `${w.stats.collisions} collisions`);
}
{
  // trucker's wide left blocks the adjacent lane
  const sweep = archetype => {
    const w = new World({ demand: {}, duration: 120, network: { lanesPerDir: 2 }, controller: { startPhase: 0 } }, 1);
    const turner = w.spawnCar({ leg: 'N', archetype, turn: 'L', lane: 1 });
    while (turner.front < turner.path.stopLine - 12) w.step();   // the straight car arrives mid-turn
    const straight = w.spawnCar({ leg: 'N', archetype: 'standard', turn: 'T', lane: 0 });
    let blocked = 0;
    for (let i = 0; i < 60 * 40; i++) { w.step(); if (!straight.done && straight.boxVerdict > 0 && turner.touchesBox()) blocked++; }
    return { blocked: blocked / 60, straight, w };
  };
  const t = sweep('trucker'), s = sweep('standard');
  ok(t.blocked > 1, 'a truck turning left holds the curb-lane car at the box', `${f1(t.blocked)} s held`);
  ok(s.blocked === 0, 'a standard car turning left does not', `${f1(s.blocked)} s`);
  ok(t.w.stats.collisions === 0 && s.w.stats.collisions === 0, 'and neither run crashes');
}
{
  // the priority corridor
  const w = new World({ demand: { E: 300, W: 300 }, duration: 120, mix: { standard: 1 }, controller: { startPhase: 1, timing: { yellow: 2, allRed: 1, minGreen: 1 } } }, 9);
  w.run(20);
  const amb = w.spawnCar({ leg: 'N', archetype: 'emergency', turn: 'T' });
  ok(w.requestPriority(amb) === true, 'a priority request is accepted');
  ok(w.controller.preemption !== null, 'and the controller holds a corridor');
  let green = false;
  for (let i = 0; i < 60 * 25 && !amb.done; i++) { w.step(); if (w.controller.head('N-T') === 'green' && w.controller.head('E-T') === 'red') green = true; }
  ok(green, 'N-T went green while E-W was red');
  ok(amb.done && amb.wait < 1, 'the ambulance cleared without waiting', `waited ${f1(amb.wait)} s`);
  w.run(15);
  ok(w.controller.preemption === null && w.controller.phase === 1, 'and the old phase resumed', `phase ${w.controller.phase}`);
}

/* ---------------------------------------------------------------- the soak -- */

group('a three-minute mixed run on the cycling level');

{
  const w = new World(CYCLING, 7).run(180);
  ok(w.stats.spawned > 50 && w.stats.cleared > 32, 'traffic flows', `${w.stats.spawned} spawned, ${w.stats.cleared} cleared`);
  ok(!w.stats.gridlock, 'no gridlock', `max wait ${f1(w.stats.maxWait)} s`);
  ok(w.stats.collisions <= 2, 'at most two collisions', String(w.stats.collisions));
  let nan = false;
  for (const c of w.cars) if (!Number.isFinite(c.s) || !Number.isFinite(c.v)) nan = true;
  ok(!nan, 'and every car is still a finite number');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
