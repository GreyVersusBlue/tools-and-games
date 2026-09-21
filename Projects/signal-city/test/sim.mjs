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
  const bay = new Network({ lanesPerDir: 2, leftLane: true });
  ok(bay.paths.size === 12 && bay.pathFor('N', 1, 'L') && !bay.pathFor('N', 1, 'T') && bay.pathFor('N', 0, 'T') && bay.lanesForTurn('T').join() === '0',
    'with a left bay the inner lane is lefts only and throughs keep to the curb lane', `${bay.paths.size} paths, T from ${bay.lanesForTurn('T').join()}`);
  ok(new Network({ lanesPerDir: 1, leftLane: true }).lanesForTurn('T').join() === '0', 'a one-lane road ignores the bay flag');
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

{
  // the box stall is per car: two cars stuck in the box for 20 s each, one
  // after the other, are two short stalls; one car for 31 s is a gridlock
  const park = (w, t) => {
    const c = w.spawnCar({ leg: 'N', archetype: 'standard', turn: 'T' });
    while (!(c.front > c.path.boxEnter + 3)) w.step();
    c.crashed = true; c.crashedAt = w.t; c.v = 0;
    return c;
  };
  const w = new World({ demand: {}, duration: 600, crashClear: 1e9, boxStall: 30, controller: { startPhase: 0 } }, 6);
  const a = park(w);
  w.run(20);
  a.done = true;
  const b = park(w);
  w.run(20);
  ok(!w.stats.gridlock && w.boxStallT < 25, 'two cars stalled in the box for 20 s each, in turn, are not a gridlock', `longest stall ${f1(w.boxStallT)} s`);
  w.run(11);
  ok(w.stats.gridlock, 'one car stalled for 31 s is', `at ${f1(w.stats.gridlockAt)} s`);
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
    const ctl = { current: { permissive: [] }, timeToGreen: () => Infinity };
    const world = { redRunScale: 1, controller: ctl, controllerFor: () => ctl };
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
    const ctl = { current: { permissive: [] }, timeToGreen: () => Infinity };
    stopLineVerdict(c, 'yellow', 0, { redRunScale: 1, controller: ctl, controllerFor: () => ctl });
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

/* ------------------------------------------------------- the all-red (M5) -- */

group('the all-red clearance, on the T-junction');

// The case the slider exists for. Main street green; an aggressive S-T
// 70 m out at 17 m/s when the yellow comes decides 'go' (yellowBias 0.35)
// and reaches the line 1.1 s into the red; an aggressive E-L on the stem
// 65 m out at 17 m/s anticipates the green (greenTrust, made certain here
// so the check is about the clearance and not the dice) and does not slow
// for a line it reaches as it turns green. With 1 s of all-red the puncher
// is still crossing the stem's left path when the stem car gets there; with
// 2 s it has cleared.
const punchCase = (allRed, greenTrustScale = 10) => {
  const w = new World({ network: { legs: ['N', 'E', 'S'] }, demand: {}, duration: 300, greenTrustScale, controller: { startPhase: 0, timing: { yellow: 3, allRed, minGreen: 1 } } }, 1);
  w.run(2);
  const p = w.spawnCar({ leg: 'S', archetype: 'aggressive', turn: 'T' });
  p.v = 17; for (const h of p.hist) h.v = 17;
  while (p.path.stopLine - p.front > 70) w.step();
  const n = w.spawnCar({ leg: 'E', archetype: 'aggressive', turn: 'L' });
  n.s = n.path.stopLine - 65 - n.stats.length / 2; n.v = 17; for (const h of n.hist) { h.s = n.s; h.v = 17; }
  w.requestPhase(1);
  const t0 = w.t;
  let lineAt = -1;
  for (let i = 0; i < 60 * 12; i++) { w.step(); if (lineAt < 0 && n.front > n.path.stopLine) lineAt = w.t - t0; }
  return { collisions: w.stats.collisions, puncher: p, stem: n, lineAt, green: allRed + 3 };
};
{
  const one = punchCase(1), two = punchCase(2);
  ok(one.puncher.yellowDecision === 'go' && one.puncher.committed, 'the aggressive through 70 m out punches the yellow', one.puncher.yellowDecision);
  ok(one.stem.trusting && one.lineAt > one.green - 0.2 && one.lineAt < one.green + 1.2, 'the anticipating stem car crosses its line within a second of its green, not stopped', `line at ${f1(one.lineAt)} s, green at ${one.green}`);
  ok(one.collisions === 1, 'with 1 s of all-red they meet in the box', `${one.collisions} collisions`);
  ok(two.collisions === 0, 'with 2 s of all-red, same seed, they do not', `${two.collisions} collisions`);
  const sober = punchCase(1, 0);
  ok(!sober.stem.trusting && sober.collisions === 0, 'and with nobody anticipating, 1 s is enough: the fault is the driver\'s, the fix is the clearance', `${sober.collisions} collisions, line at ${f1(sober.lineAt)} s`);
}

group('first come, first served at a four-way stop');

{
  // Three cars reach a flashing red 1.5 s apart: S-T first, E-T second, N-T
  // third. S and E conflict (E waits for S), N and S do not. Without an
  // arrival order N, which stopped last, goes as soon as it has stopped and
  // enters the box before E, who has been waiting longer; with it, N waits
  // for E because E stopped first and has not gone yet.
  const w = new World({ demand: {}, duration: 120, controller: { flash: 'red' } }, 2);
  const s = w.spawnCar({ leg: 'S', archetype: 'standard', turn: 'T' });
  w.run(1.5);
  const e = w.spawnCar({ leg: 'E', archetype: 'standard', turn: 'T' });
  w.run(1.5);
  const n = w.spawnCar({ leg: 'N', archetype: 'standard', turn: 'T' });
  const entered = [];
  for (let i = 0; i < 60 * 40; i++) {
    w.step();
    for (const c of [s, e, n]) if (!entered.some(x => x.car === c) && c.front > c.path.boxEnter + 0.5) entered.push({ car: c, t: w.t });
  }
  const order = entered.map(x => x.car.path.entry).join('');
  ok(s.stoppedAt > 0 && e.stoppedAt > s.stoppedAt && n.stoppedAt > e.stoppedAt, 'all three stopped at their lines, S then E then N', `${f1(s.stoppedAt)}, ${f1(e.stoppedAt)}, ${f1(n.stoppedAt)} s`);
  ok(order === 'SEN', 'and they enter the box in the order they stopped: S, E, N', order);
  ok(entered.length === 3 && entered[2].t - entered[1].t > 0.5, 'N holds until E is inside, not a tick behind it', entered.length === 3 ? `${f1(entered[2].t - entered[1].t)} s apart` : order);
  ok(s.done && e.done && n.done && w.stats.collisions === 0, 'all three clear without touching', `${w.stats.collisions} collisions`);
  // an opposing through is not a conflict: it goes as soon as it has stopped
  const w2 = new World({ demand: {}, duration: 120, controller: { flash: 'red' } }, 2);
  const a = w2.spawnCar({ leg: 'E', archetype: 'standard', turn: 'T' });
  w2.run(2);
  const b = w2.spawnCar({ leg: 'W', archetype: 'standard', turn: 'T' });
  let aIn = -1, bIn = -1;
  for (let i = 0; i < 60 * 40; i++) { w2.step(); if (aIn < 0 && a.front > a.path.boxEnter + 0.5) aIn = w2.t; if (bIn < 0 && b.front > b.path.boxEnter + 0.5) bIn = w2.t; }
  ok(aIn > 0 && bIn > 0 && bIn - aIn < 2.5, 'an opposing through does not wait for the first car: it goes 2 s behind, when it has stopped', `${f1(bIn - aIn)} s apart`);
}


/* ------------------------------------------------------- pedestrians (M6) -- */

group('pedestrians: calls, the walk, and the box held for walkers');

{
  // E-W green with walks on P-N and P-S. A right turn from E exits by N and
  // crosses the N zebra; a call on N sends two walkers over it, and the car
  // holds at the box edge until they have passed its lane.
  const PEDS = { demand: {}, duration: 600, controller: { peds: true, timing: { yellow: 3, allRed: 1, minGreen: 1 } } };
  const w = new World(PEDS, 3);
  ok(w.controller.phases.map(p => p.walks.join('+')).join(' | ') === 'P-E+P-W | P-N+P-S', 'the through phases carry the crossings parallel to them', w.controller.phases.map(p => p.walks.join('+')).join(' | '));
  ok(w.controller.pedTiming.clear === 6, 'a one-lane road clears in 6 s at 1.2 m/s', String(w.controller.pedTiming.clear));
  const r = w.spawnCar({ leg: 'E', archetype: 'standard', turn: 'R' });
  w.run(2);
  w.requestPhase(1);
  w.run(5);
  ok(w.controller.head('E-R') === 'green' && w.controller.pedHead('N') === 'dont-walk', 'E-W is green and the N crossing says don\'t walk');
  ok(w.callPed('N', { walkers: 2 }) === true, 'a call on N is taken');
  w.step();
  ok(w.controller.pedHead('N') === 'walk' && w.walkers.length === 2, 'and the green has just begun, so the walk starts at once with two people on the curb', `${w.controller.pedHead('N')}, ${w.walkers.length} walkers`);
  let held = 0, crossed = false;
  for (let i = 0; i < 60 * 30; i++) {
    w.step();
    if (!r.done && r.boxVerdict > 0 && r.blockedBy === -1) held++;
    if (w.walkers.some(k => k.done && !k.struck)) crossed = true;
  }
  ok(held > 60 * 3, 'the right turn holds at the box edge for the walkers', `${f1(held / 60)} s`);
  ok(crossed && w.stats.struck === 0 && w.stats.collisions === 0, 'they cross, nobody is struck', `${w.stats.walkers} walkers, ${w.stats.struck} struck`);
  ok(r.done, 'and the car goes on once they have passed its lane');
  const kinds = w.controller.log.map(l => l.kind).join(' ');
  ok(/walk clear dont-walk/.test(kinds), 'the walk ran WALK, then the clearance, then don\'t walk', kinds);
}
{
  // the walk holds the green: a phase request during a walk waits for the clearance
  const PEDS = { demand: {}, duration: 600, controller: { peds: true, timing: { yellow: 3, allRed: 1, minGreen: 1 } } };
  const w = new World(PEDS, 3);
  w.run(1);
  w.callPed('E');
  w.step();
  ok(w.controller.walk && w.controller.walk.stage === 'walk', 'a call on E during the N-S green starts its walk');
  w.requestPhase(1);
  w.run(4);
  ok(w.controller.stage === 'green' && w.controller.next === 1, 'a request 1 s in is held: the walk is running', `${w.controller.stage} next ${w.controller.next}`);
  ok(Math.abs(w.controller.timeToYellow('N-T') - w.controller.walkRemaining()) < 1e-6 && w.controller.walkRemaining() > 7, 'and timeToYellow reads the walk\'s remaining time, so granny can see it', f1(w.controller.timeToYellow('N-T')));
  w.run(9.1);   // 7 s walk + 6 s clear from t = 1
  ok(w.controller.stage === 'yellow', 'the yellow comes when the clearance ends', `${w.controller.stage} at ${f1(w.t)} s`);
  // a call that does not fit the green left waits for the phase's next green, and is late
  const w2 = new World({ ...PEDS, pedWait: 20, controller: { ...PEDS.controller, rules: [{ when: 'elapsed', seconds: 20, then: 'next' }] } }, 3);
  w2.run(12);
  w2.callPed('E');
  w2.run(2);
  ok(!w2.controller.walk && w2.controller.pedCalls.has('E'), 'a call with 8 s of green left does not fit a 13 s walk and waits', `${w2.controller.pedCalls.size} waiting`);
  w2.run(24);
  ok(w2.stats.pedLate === 1 && w2.stats.pedServed === 0, 'past pedWait it counts as late, once so far', `${w2.stats.pedLate} late`);
  w2.run(20);
  ok(w2.stats.pedServed === 1 && w2.controller.log.some(l => l.kind === 'walk'), 'and is served on the next N-S green', w2.controller.log.map(l => l.kind + '@' + l.t.toFixed(0)).join(' '));
  // a call that could not fit is served as the phase's next green begins,
  // and holds that green past a 10 s rule until the 13 s walk has cleared
  const w3 = new World({ ...PEDS, controller: { ...PEDS.controller, rules: [{ when: 'elapsed', seconds: 10, then: 'next' }] } }, 3);
  w3.run(2);
  w3.callPed('E');
  w3.run(37);   // 8 s of N-S left, then E-W's 10 s, and N-S is green again at 28 s
  ok(w3.controller.phase === 0 && w3.controller.stage === 'green' && w3.controller.walk && w3.controller.stageT > 10.5, 'a walk that starts as the green begins holds it past the 10 s rule', `${w3.controller.stage} ${w3.controller.phase} at ${f1(w3.controller.stageT)} s, walk ${w3.controller.walk && w3.controller.walk.stage}`);
  const t = new World({ ...PEDS, network: { legs: ['N', 'E', 'S'] } }, 1);
  ok(t.callPed('W') === false && t.callPed('E') === true, 'a call on a leg the junction does not have is refused; one on the stem is taken');
}
{
  // a level without walks takes no calls
  const w = new World(GREEN_NS, 1);
  ok(w.callPed('N') === false && w.stats.pedCalls === 0, 'a controller without walks refuses a call');
}

/* ------------------------------------------------------ induction loops -- */

group('induction loops fire the queue rules');

{
  // N-S green, a queue rule on E-T with threshold 3 to phase 1, sensors on.
  const LOOP = { demand: {}, duration: 600, sensors: true, controller: { startPhase: 0, timing: { yellow: 3, allRed: 1, minGreen: 4 }, rules: [{ when: 'queue', movement: 'E-T', threshold: 3, then: 1 }] } };
  const w = new World(LOOP, 5);
  w.spawnCar({ leg: 'E', archetype: 'standard', turn: 'T' }); w.run(3);
  w.spawnCar({ leg: 'E', archetype: 'standard', turn: 'T' }); w.run(25);
  ok(w.queued('E-T') === 2 && w.controller.phase === 0 && w.controller.stage === 'green', 'two cars on the loop do not fire a rule that asks for three', `${w.queued('E-T')} queued, ${w.controller.stage} ${w.controller.phase}`);
  ok(w.onLoop(0, 'E', 0) && !w.onLoop(0, 'W', 0), 'the E loop reads a body on it and the W loop does not');
  w.spawnCar({ leg: 'E', archetype: 'standard', turn: 'T' });
  let firedAt = -1;
  for (let i = 0; i < 60 * 30 && firedAt < 0; i++) { w.step(); if (w.controller.next === 1) firedAt = w.t; }
  ok(firedAt > 0 && w.queued('E-T') >= 3, 'the third car fires it', `at ${f1(firedAt)} s with ${w.queued('E-T')} queued`);
  w.run(6);
  ok(w.controller.phase === 1 && w.controller.stage === 'green', 'and E-W is green', `${w.controller.stage} ${w.controller.phase}`);
  // the same three cars with the sensors off: nothing
  const d = new World({ ...LOOP, sensors: false }, 5);
  for (let i = 0; i < 3; i++) { d.spawnCar({ leg: 'E', archetype: 'standard', turn: 'T' }); d.run(3); }
  d.run(30);
  ok(d.queued('E-T') === 3 && d.controller.phase === 0, 'without sensors the same queue fires nothing', `${d.queued('E-T')} queued, phase ${d.controller.phase}`);
  // a rule on a movement that is green never fires while it is served: three
  // N-T cars queued behind a stalled one on the N-S green, rule N-T -> phase 1
  const g = new World({ ...LOOP, crashClear: 1e9, controller: { ...LOOP.controller, rules: [{ when: 'queue', movement: 'N-T', threshold: 3, then: 1 }] } }, 5);
  const stall = g.spawnCar({ leg: 'N', archetype: 'standard', turn: 'T' });
  while (stall.path.stopLine - stall.front > 4) g.step();
  stall.crashed = true; stall.crashedAt = g.t; stall.v = 0;
  for (let i = 0; i < 3; i++) { g.spawnCar({ leg: 'N', archetype: 'standard', turn: 'T' }); g.run(3); }
  g.run(30);
  ok(g.queued('N-T') >= 3 && g.controller.phase === 0 && g.controller.stage === 'green' && g.controller.next === null, 'three cars queued on a green movement fire nothing: it is being served', `${g.queued('N-T')} queued, ${g.controller.stage} ${g.controller.phase}`);
  // a level that lists its loops reads only those lanes
  const l = new World({ ...LOOP, loops: ['N-L', 'S-L'] }, 5);
  for (let i = 0; i < 3; i++) { l.spawnCar({ leg: 'E', archetype: 'standard', turn: 'T' }); l.run(3); }
  l.run(30);
  ok(l.queued('E-T') === 0 && l.controller.phase === 0 && !l.hasLoop(0, 'E', 0) && l.hasLoop(0, 'N', 0), 'with loops on the lefts only, the E-T queue reads 0 and fires nothing', `${l.queued('E-T')} queued`);
}

/* ------------------------------------------------------------ the corridor -- */

group('the corridor: two boxes, one handoff, fresh decisions');

{
  // node 0 E-W green, node 1 N-S green: a W-T car clears box 1 on its green
  // and stops for the red at box 2
  const CORRIDOR = { network: { nodes: 2, spacing: 220 }, demand: {}, duration: 600, turns: { T: 1 }, controller: { timing: { yellow: 3, allRed: 1, minGreen: 1 } }, controllers: [{ startPhase: 1 }, { startPhase: 0 }] };
  const w = new World(CORRIDOR, 1);
  ok(w.nodes.length === 2 && w.controllers.length === 2 && w.nodes[0].origin[0] === -110 && w.nodes[1].origin[0] === 110, 'two nodes 220 m apart, a controller each', w.nodes.map(n => n.origin.join(',')).join(' | '));
  ok(w.nodes[0].spawnLegs.join('') === 'NSW' && w.nodes[1].spawnLegs.join('') === 'NES', 'the legs between them spawn nothing', `${w.nodes[0].spawnLegs.join('')} ${w.nodes[1].spawnLegs.join('')}`);
  const p0 = w.nodes[0].pathFor('W', 0, 'T');
  ok(p0.link && p0.link.node === 1 && p0.link.entry === 'W' && p0.link.atS === 0, 'W-T at box 1 links onto W at box 2', JSON.stringify(p0.link));
  ok(!w.nodes[0].pathFor('N', 0, 'T').link, 'and a path leaving by an outer leg does not');
  const c = w.spawnCar({ leg: 'W', archetype: 'standard', turn: 'T', node: 0 });
  let jump = 0, handedAt = -1, vAtHandoff = 0, memory = 0;
  for (let i = 0; i < 60 * 60 && !c.done; i++) {
    const before = c.path.at(c.s), node = c.path.node;
    w.step();
    const after = c.path.at(c.s);
    const d = Math.hypot(after.x - before.x, after.y - before.y);
    if (d > c.v / 60 + 0.05) jump = Math.max(jump, d);
    if (node === 0 && c.path.node === 1) { handedAt = w.t; vAtHandoff = c.v; memory = Math.abs(c.s - c.perceived().s); }
  }
  ok(handedAt > 0 && vAtHandoff > 12, 'it is handed to box 2 at speed', `at ${f1(handedAt)} s, ${f1(vAtHandoff)} m/s`);
  ok(jump < 0.01, 'with no jump in position at the handoff', `${jump.toFixed(3)} m`);
  ok(memory < 15, 'and its perception ring moved with it: the s it remembers is in the new frame, not 220 m back', `${f1(memory)} m behind`);
  ok(c.path.node === 1 && c.v === 0 && c.path.stopLine - c.front > 0 && c.path.stopLine - c.front < 3.5, 'and stops for the red at box 2', `node ${c.path.node}, ${f1(c.path.stopLine - c.front)} m short`);
  ok(w.stats.handoffs === 1 && w.stats.cleared === 0, 'one handoff, nothing cleared yet');
  w.requestPhase(1, 1);
  w.run(25);
  ok(c.done && w.stats.cleared === 1, 'the second box\'s green clears it', `done ${c.done}`);
}
{
  // the yellow decision is made again at box 2: a car that went on the
  // yellow at box 1 (committed) stops for a yellow far out at box 2
  const CORRIDOR = { network: { nodes: 2, spacing: 220 }, demand: {}, duration: 600, turns: { T: 1 }, controller: { timing: { yellow: 3, allRed: 1, minGreen: 1 } }, controllers: [{ startPhase: 1 }, { startPhase: 1 }] };
  const w = new World(CORRIDOR, 1);
  const c = w.spawnCar({ leg: 'W', archetype: 'standard', turn: 'T', node: 0 });
  while (c.path.stopLine - c.front > 10) w.step();
  w.requestPhase(0, 0);     // yellow at box 1 with the car 10 m out: go
  w.step();
  ok(c.yellowDecision === 'go' && c.committed, 'ten metres out at box 1 the yellow decision is go', `${c.yellowDecision}, committed ${c.committed}`);
  while (c.path.node === 0 && !c.done) w.step();
  ok(c.path.node === 1 && c.yellowDecision === null && !c.committed && !c.trustRolled, 'the handoff resets the yellow decision, the commitment and the trust roll', `${c.yellowDecision}, committed ${c.committed}`);
  while (c.path.stopLine - c.front > 70) w.step();
  w.requestPhase(0, 1);     // yellow at box 2 with the car 70 m out: stop
  w.run(11);
  ok(c.yellowDecision === 'stop' && c.v === 0 && c.front < c.path.stopLine, 'seventy metres out at box 2 the fresh decision is stop, and it stops', `${c.yellowDecision}, front ${f1(c.front)} vs line ${f1(c.path.stopLine)}`);
}
{
  // a queue on box 2's approach is followed across the handoff, and the
  // second box's turn is the level's roll
  const CORRIDOR = { network: { nodes: 2, spacing: 220 }, demand: {}, duration: 600, turns: { T: 0.5, L: 0.25, R: 0.25 }, mix: { standard: 1 }, controller: { timing: { yellow: 3, allRed: 1, minGreen: 1 } }, controllers: [{ startPhase: 1 }, { startPhase: 0 }] };
  const w = new World(CORRIDOR, 2);
  const cars = [];
  for (let i = 0; i < 6; i++) { cars.push(w.spawnCar({ leg: 'W', archetype: 'standard', turn: 'T', node: 0 })); w.run(2.5); }
  w.run(30);
  ok(cars.every(c => c.path.node === 1 && c.v === 0), 'six cars sent through box 1 queue at box 2\'s red', cars.map(c => `${c.path.node}:${f1(c.front)}`).join(' '));
  const gaps = cars.slice(1).map((c, i) => cars[i].rear - c.front);
  ok(gaps.every(g => g > 0.5 && g < 6), 'each 0.5 to 6 m behind the one ahead', gaps.map(f1).join(' '));
  const turns = new Set(cars.map(c => c.path.turn));
  ok(turns.size >= 2, 'and their turns at box 2 were rolled fresh', [...cars.map(c => c.path.turn)].join(''));
  ok(w.stats.collisions === 0, 'without touching');
  // determinism holds across the handoff
  const a = new World({ ...CORRIDOR, demand: [{ W: 500, N: 200, S: 200 }, { E: 500, N: 200, S: 200 }], controller: { rules: [{ when: 'elapsed', seconds: 20, then: 'next' }] }, controllers: [] }, 4).run(90);
  const b = new World({ ...CORRIDOR, demand: [{ W: 500, N: 200, S: 200 }, { E: 500, N: 200, S: 200 }], controller: { rules: [{ when: 'elapsed', seconds: 20, then: 'next' }] }, controllers: [] }, 4).run(90);
  ok(a.hash() === b.hash() && a.stats.handoffs > 5, 'a corridor run is deterministic and cars do cross between the boxes', `${a.stats.handoffs} handoffs, ${a.stats.cleared} cleared, ${a.stats.collisions} collisions`);
  let threw = null;
  try { new World({ network: { nodes: 2, spacing: 240 } }); } catch (e) { threw = e.message; }
  ok(threw && /gap/.test(threw), 'a spacing that leaves a gap between the legs is refused', threw);
}

{
  // the offset slider's door (M7): the second box moves, the first does not,
  // and the traffic feels it
  const lvl = { network: { nodes: 2, spacing: 220 }, demand: [{ W: 500, N: 200, S: 200 }, { E: 500, N: 200, S: 200 }], duration: 600, mix: { standard: 1 }, controller: { main: 'EW', mode: 'timed', plan: [{ phase: 0, green: 22 }, { phase: 1, green: 12 }], timing: { yellow: 3, allRed: 1.5, minGreen: 4 } }, controllers: [{ offset: 0 }, { offset: 16 }] };
  const w = new World(lvl, 3);
  ok(w.offsetOf() === 16, 'offsetOf reads the level\'s 16', String(w.offsetOf()));
  w.run(20);
  const q = w.setOffset(30);
  ok(q === 14 && w.controllers[1].offset === 30 && w.controllers[1].shift === 14 && w.controllers[0].offset === 0 && w.controllers[0].shift === 0, 'setOffset(30) moves the east box 14 s on and leaves the west one alone', `queued ${q}, offsets ${w.controllers.map(c => c.offset).join(',')}`);
  ok(w.offsetOf() === 30, 'and offsetOf reads 30');
  const other = new World(lvl, 3).run(20);
  w.run(90); other.run(90);
  ok(w.hash() !== other.hash(), 'ninety seconds on, the run differs from the one that kept 16', `${w.stats.cleared} vs ${other.stats.cleared} cleared`);
  let threw = null;
  try { w.setOffset(5, 0); } catch (e) { threw = e.message; }
  ok(threw && /no second box/.test(threw), 'the first box has no offset to set', threw);
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
