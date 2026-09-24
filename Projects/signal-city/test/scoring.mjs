// node test/scoring.mjs
//
// Stars and meters against scripted runs, the levels against their
// calibration (tools/calibrate.mjs is the table; the numbers a level ships
// with are in HISTORY.md), and the save's repair. Exits non-zero on any FAIL
// (#13). Imports through pathToFileURL (Windows rule).

import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const load = f => import(pathToFileURL(path.join(HERE, '..', 'js', f)).href);
const { World } = await load('sim.js');
const { meters, score, failedEarly, starString, lessonMet, lessonName } = await load('scoring.js');
const { LEVELS, levelById } = await load('levels/pack-01.js');
const { repair, fresh, recordResult, totalStars, SAVE_KEY } = await load('save.js');
const { standardPhases } = await load('signals.js');
const { holdPlatoon } = await import(pathToFileURL(path.join(HERE, '..', 'tools', 'calibrate.mjs')).href);

let passed = 0, failed = 0;
const ok = (cond, what, detail = '') => {
  if (cond) { passed++; console.log(`  ok    ${what}${detail ? '  ' + detail : ''}`); }
  else { failed++; console.log(`  FAIL  ${what}${detail ? '  ' + detail : ''}`); }
};
const group = name => console.log(`\n${name}`);

// A tidy controller for scripted runs: alternate phases every 22 s, on the
// level's own timing (level 1 runs a 2 s all-red, see pack-01.js).
const auto = { rules: [{ when: 'elapsed', seconds: 22, then: 'next' }] };
const withAuto = (l, seconds = 22) => ({ ...l, controller: { ...l.controller, rules: [{ when: 'elapsed', seconds, then: 'next' }] } });

group('the level pack');

{
  ok(LEVELS.length === 9 && LEVELS.map(l => l.id).join() === 'first-light,stem,four-ways,crossing,two-blocks,rush-hour,school-run,main-street,free-play', 'nine levels: First Light, Stem, Four Ways, Crossing, Two Blocks, Rush Hour, School Run, Main Street, Free Play', LEVELS.map(l => l.id).join(', '));
  const l1 = levelById('first-light');
  ok(l1.duration === 180 && l1.target > 0 && l1.waitTarget > 0 && l1.mode === 'soft', 'level 1 is 3 minutes, soft, with a target and a wait target', `${l1.target} cars, ${l1.waitTarget} s`);
  ok(Object.keys(l1.mix).every(k => ['standard', 'granny'].includes(k)), 'and only standard and granny drive it', Object.keys(l1.mix).join(', '));
  ok(l1.controller.timing.allRed === 2 && l1.unlocks.join() === 'phases,auto', 'it runs a 2 s all-red with no slider to change it, and unlocks the phases and the rule panel', `${l1.controller.timing.allRed} s, ${l1.unlocks.join()}`);
  const l2 = levelById('stem');
  ok(l2.network.legs.join('') === 'NES' && l2.duration === 180 && l2.controller.timing.allRed === 1, 'the Stem is a T of N, E and S, 3 minutes, starting at 1 s of all-red', `${l2.network.legs.join('')} ${l2.controller.timing.allRed} s`);
  ok(Object.keys(l2.mix).sort().join() === 'aggressive,granny,standard' && l2.unlocks.includes('allred') && !l2.unlocks.includes('flash'), 'standard, granny and aggressive drive it, and it unlocks the all-red slider', l2.unlocks.join());
  const l3 = levelById('four-ways');
  ok(l3.network.lanesPerDir === 2 && l3.controller.lefts === true && Math.abs(l3.turns.L - 0.25) < 1e-9, 'Four Ways has two lanes each way, protected lefts, and a quarter of the traffic turning left', `${l3.network.lanesPerDir} lanes, L ${l3.turns.L}`);
  ok(Object.keys(l3.mix).sort().join() === 'granny,standard,tourist,trucker' && l3.unlocks.includes('lefts') && l3.unlocks.includes('flash'), 'standard, granny, tourist and trucker drive it, and it unlocks lefts and flash', l3.unlocks.join());
  const w3 = new World(l3, 1);
  ok(w3.controller.phases.length === 4 && w3.controller.phases.map(p => p.name).join() === 'N-S,N-S lefts,E-W,E-W lefts', 'its world has the four phases', w3.controller.phases.map(p => p.name).join(', '));
  ok(w3.controller.head('N-L') === 'red' && w3.controller.head('N-T') === 'green', 'and on the first phase the left arrow is red while the through is green');
  const l4 = levelById('crossing');
  ok(l4.network.lanesPerDir === 2 && l4.controller.lefts === true && l4.controller.peds === true && l4.sensors === true, 'Crossing is Four Ways\' network with walks and live sensors');
  ok(l4.loops.join() === 'N-L,S-L,E-L,W-L' && l4.pedDemand && Object.keys(l4.pedDemand).join('') === 'NSEW', 'its loops are in the four left bays and every leg takes calls', l4.loops.join());
  ok(Object.keys(l4.mix).sort().join() === 'granny,standard,student,tourist' && l4.unlocks.includes('peds') && l4.unlocks.includes('sensors'), 'standard, granny, tourist and student drive it, and it unlocks peds and sensors', l4.unlocks.join());
  const w4 = new World(l4, 1);
  ok(w4.controller.phases.map(p => p.walks.join('+')).join('|') === 'P-E+P-W||P-N+P-S|' && w4.controller.rules.filter(r => r.when === 'queue').every(r => r.after === 16), 'its through phases carry the walks and its queue rules hold a through 16 s', w4.controller.phases.map(p => p.walks.join('+')).join('|'));
  const l5 = levelById('two-blocks');
  ok(l5.network.nodes === 2 && l5.network.spacing === 220 && l5.controller.mode === 'timed' && l5.controller.main === 'EW', 'Two Blocks is two boxes 220 m apart on a timed plan with E-W as phase 1', `${l5.network.nodes} nodes, ${l5.network.spacing} m`);
  const w5 = new World(l5, 1);
  ok(w5.controllers.length === 2 && w5.controllers[0].offset === 0 && w5.controllers[1].offset === 0 && l5.unlocks.includes('offset'), 'both boxes run the plan on one clock, and the level unlocks the offset note (R2: the offset is the lesson)', w5.controllers.map(c => c.offset).join(','));
  ok(Object.keys(l5.mix).sort().join() === 'aggressive,rideshare,standard,trucker' && Array.isArray(l5.demand) && l5.demand.length === 2, 'standard, aggressive, rideshare and trucker drive it, with demand per box', Object.keys(l5.mix).join(', '));
  const l6 = levelById('rush-hour');
  ok(l6.events.map(e => e.kind).join() === 'surge,outage,ambulance' && l6.events[0].at === 60 && l6.events[0].for === 100 && l6.events[1].at === 110 && l6.events[1].for === 30 && l6.events[2].at === 185 && l6.events[2].within === 40,
    'Rush Hour scripts the surge at 60 s for 100, the outage at 110 s for 30, and the ambulance at 185 s with 40 s to get through', l6.events.map(e => `${e.kind}@${e.at}`).join(' '));
  ok(l6.unlocks.includes('priority') && l6.unlocks.includes('flash') && l6.network.lanesPerDir === 1 && Object.keys(l6.mix).sort().join() === 'aggressive,granny,rideshare,standard', 'one lane each way, the corridor button unlocked, and standard, granny, aggressive and rideshare driving it', l6.unlocks.join());
  const l7 = levelById('school-run');
  ok(l7.network.lanesPerDir === 2 && l7.controller.peds === true && !l7.controller.lefts && l7.events.map(e => e.kind).join() === 'school,closure', 'School Run is two lanes each way with walks, two permissive phases, a school zone then a closure', l7.events.map(e => `${e.kind}@${e.at}`).join(' '));
  ok(l7.events[0].at === 40 && l7.events[0].for === 90 && l7.events[0].scale === 0.5 && l7.events[0].peds === 4 && l7.events[1].at === 150 && l7.events[1].for === 90 && l7.events[1].leg === 'W' && l7.events[1].lane === 0, 'the zone at 40 s for 90 at half speed and four times the calls, the W curb lane closed at 150 s for 90', l7.events.map(e => JSON.stringify(e)).join(' '));
  const l8 = levelById('main-street');
  ok(l8.network.lanesPerDir === 1 && l8.events.map(e => e.kind).join() === 'motorcade,procession' && l8.events[0].at === 50 && l8.events[0].leg === 'W' && l8.events[0].size === 5 && l8.events[1].at === 160 && l8.events[1].leg === 'N' && l8.events[1].size === 8, 'Main Street is one lane each way with a motorcade of 5 from W at 50 s and a procession of 8 from N at 160 s', l8.events.map(e => `${e.kind}@${e.at}`).join(' '));
  ok(l8.unlocks.includes('priority') && l8.controller.rules.length === 1 && l8.controller.rules[0].seconds === 22, 'it unlocks the corridor and cycles on a 22 s rule the player will have to hold', l8.unlocks.join());
  let bad = null;
  for (const l of LEVELS) { try { new World(l, 1); } catch (e) { bad = `${l.id}: ${e.message}`; } }
  ok(!bad, 'every level builds a world', bad || '');
}

group('stars on level 1');

{
  // a clean run with the automatic controller earns three stars
  const l1 = levelById('first-light');
  const w = new World({ ...l1, controller: { ...l1.controller, ...auto } }, 3).run(l1.duration);
  const r = score(w);
  ok(w.over, 'the clock ran out');
  ok(r.cleared >= l1.target, `it cleared the target of ${l1.target}`, `${r.cleared}`);
  ok(r.collisions === 0, 'with no collisions', `${r.collisions}`);
  ok(r.avgWait <= l1.waitTarget, `average wait under ${l1.waitTarget} s`, `${r.avgWait.toFixed(1)} s`);
  ok(r.survived && r.stars === 3, 'three stars', `${starString(r.stars)} ${r.reasons.join('; ')}`);
  ok(r.points > 0 && r.bonus >= 0 && r.bonus <= 100, 'points and a satisfaction bonus in 0 to 100', `${r.points} pts, bonus ${r.bonus}`);

  // the same run with one collision injected is two stars, not a fail
  const w2 = new World({ ...l1, controller: { ...l1.controller, ...auto } }, 3).run(l1.duration);
  w2.stats.collisions = 1;
  const r2 = score(w2);
  ok(r2.survived && r2.stars === 2 && /1 collision/.test(r2.reasons.join(' ')), 'one collision in soft mode: two stars, and the card says why', `${starString(r2.stars)} ${r2.reasons.join('; ')}`);

  // in hard mode that collision ends the level
  const w3 = new World({ ...l1, mode: 'hard', controller: { ...l1.controller, ...auto } }, 3).run(60);
  w3.stats.collisions = 1;
  ok(failedEarly(w3) && failedEarly(w3).reason === 'collision', 'hard mode: a collision fails the level early');
  const r3 = score(w3);
  ok(!r3.survived && r3.stars === 0, 'zero stars', r3.reasons.join('; '));

  // a controller that never changes gridlocks: zero stars
  const w4 = new World({ ...l1, controller: { ...l1.controller, rules: [] } }, 3);
  for (let i = 0; i < l1.duration * 60 && !failedEarly(w4); i++) w4.step();
  const r4 = score(w4);
  ok(w4.stats.gridlock && !r4.survived && r4.stars === 0 && /locked/.test(r4.reasons.join(' ')), 'never changing the light gridlocks, for zero stars', `at ${w4.stats.gridlockAt.toFixed(0)} s: ${r4.reasons.join('; ')}`);

  // a slow but safe run: one star for surviving, no second for the wait
  // (the 55 s cycle: 14 to 25 s average wait over the six calibration seeds)
  const w5 = new World(withAuto(l1, 55), 4).run(l1.duration);
  const r5 = score(w5);
  ok(r5.avgWait > l1.waitTarget, 'a 55 s cycle leaves the average wait above target', `${r5.avgWait.toFixed(1)} s`);
  ok(r5.stars <= 1 || r5.avgWait <= l1.waitTarget, 'and it earns at most one star', `${starString(r5.stars)} ${r5.reasons.join('; ')}`);
}

group('the Stem, and what the all-red buys');

{
  // the calibration table (six seeds, 18/22/30 s cycles) at 2 s of all-red
  // clears 31 to 46 at 22 s with 5 to 21 s average wait; target 30, wait 15
  const l2 = levelById('stem');
  const w = new World({ ...withAuto(l2), controller: { ...withAuto(l2).controller, timing: { ...l2.controller.timing, allRed: 2 } } }, 3).run(l2.duration);
  const r = score(w);
  ok(r.survived && r.stars === 3, 'a 22 s cycle at 2 s of all-red on seed 3 is three stars', `${starString(r.stars)} ${r.cleared} cleared, ${r.avgWait.toFixed(0)} s, ${r.collisions} collisions`);
  // the slider's worth: the same six seeds (7 to 12, the ones where a 22 s
  // cycle met a puncher) at 1 s and at 2 s. Seeds 1 to 6 are the table above
  // and showed nothing at 22 s; 7 to 12 are named so the check is honest
  // about being the half of the twelve-seed measurement that carries it.
  const total = allRed => {
    let n = 0;
    for (let seed = 7; seed <= 12; seed++) {
      const w = new World({ ...withAuto(l2), controller: { ...withAuto(l2).controller, timing: { ...l2.controller.timing, allRed } } }, seed).run(l2.duration);
      n += w.stats.collisions;
    }
    return n;
  };
  const one = total(1), two = total(2);
  ok(one >= 2, 'at 1 s of all-red, six runs at 22 s cost at least two collisions', `${one}`);
  ok(two === 0, 'at 2 s they cost none', `${two}`);
}

group('Four Ways: the lefts phases are the level');

{
  // the calibration (six seeds, a timed plan of 26 s throughs and 8 s
  // arrows, allRed 1.5): 59 to 75 cleared with 26 to 33 s average wait, no
  // collisions, no gridlock; on phases 1 and 3 alone every seed gridlocks at
  // 191 to 207 s. Target 52, waitTarget 32. A two-lane four-minute run costs
  // about 15 s here, so the suite checks three seeds of each and the six
  // are tools/calibrate.mjs's.
  const l3 = levelById('four-ways');
  const plan = { ...l3, controller: { ...l3.controller, mode: 'timed', rules: [], plan: [{ phase: 0, green: 26 }, { phase: 1, green: 8 }, { phase: 2, green: 26 }, { phase: 3, green: 8 }] } };
  const stars = [];
  let clean = 0;
  for (let seed = 1; seed <= 3; seed++) {
    const w = new World(plan, seed);
    for (let i = 0; i < l3.duration * 60 && !w.stats.gridlock; i++) w.step();
    const r = score(w);
    stars.push(`${starString(r.stars)} ${r.cleared}/${r.avgWait.toFixed(0)}s/${r.collisions}x${w.stats.gridlock ? ' LOCK' : ''}`);
    if (!w.stats.gridlock && !r.collisions && r.cleared >= l3.target) clean++;
  }
  ok(clean === 3, 'the 26 s plan clears the target with no collision and no gridlock on seeds 1 to 3', stars.join(' | '));
  ok(/★★★/.test(stars[0]), 'and seed 1 is three stars', stars[0]);
  // the same board driven on phases 1 and 3 alone: the bay never gets an
  // arrow, and the lefts in it wait until the 180 s gridlock limit
  const skip = { ...l3, controller: { ...l3.controller, mode: 'timed', rules: [], plan: [{ phase: 0, green: 22 }, { phase: 2, green: 22 }] } };
  let locks = 0, at = [];
  for (let seed = 1; seed <= 3; seed++) {
    const w = new World(skip, seed);
    for (let i = 0; i < l3.duration * 60 && !w.stats.gridlock; i++) w.step();
    if (w.stats.gridlock) { locks++; at.push(w.stats.gridlockAt.toFixed(0)); }
  }
  ok(locks === 3, 'on the through phases alone every one of them gridlocks before the clock runs out', `at ${at.join(', ')} s`);
}

group('Crossing: walks and loops on Four Ways\' board');

{
  // the calibration (six seeds, the 26 s / 8 s plan with the level's calls
  // and loops): 55 to 76 cleared, 28 to 37 s average wait, 2 to 7 calls
  // late; the level's own rules at 24 s: 55 to 63 cleared, 47 to 52 s. Target
  // 48, waitTarget 36. A two-lane four-minute run with walkers costs about
  // 18 s here, so this is one seed of the plan and one of the level as
  // shipped, and the six are the tool's.
  const l4 = levelById('crossing');
  const plan = { ...l4, controller: { ...l4.controller, mode: 'timed', rules: [], plan: [{ phase: 0, green: 26 }, { phase: 1, green: 8 }, { phase: 2, green: 26 }, { phase: 3, green: 8 }] } };
  const out = [];
  for (const seed of [3]) {
    const w = new World(plan, seed);
    for (let i = 0; i < l4.duration * 60 && !w.stats.gridlock; i++) w.step();
    const r = score(w);
    out.push({ seed, r, lock: w.stats.gridlock, walkers: w.stats.walkers, struck: w.stats.struck });
  }
  ok(out.every(o => !o.lock && o.r.cleared >= l4.target), 'the 26 s plan clears the target with no gridlock on seed 3', out.map(o => `${starString(o.r.stars)} ${o.r.cleared}/${o.r.avgWait.toFixed(0)}s/${o.r.collisions}x`).join(' | '));
  ok(out.every(o => o.walkers > 5 && o.struck === 0 && o.r.pedServed > 3), 'walkers crossed and none was struck', out.map(o => `${o.walkers} walkers, ${o.r.pedServed} walks, ${o.r.pedLate} late`).join(' | '));
  ok(out[0].r.stars === 3, 'and it is three stars', `${starString(out[0].r.stars)} ${out[0].r.reasons.join('; ')}`);
  // as shipped: the queue rules on the bays and the 24 s elapsed rule
  const w = new World(l4, 1);
  for (let i = 0; i < l4.duration * 60 && !w.stats.gridlock; i++) w.step();
  const r = score(w);
  ok(r.survived && r.pedLate > 0 && r.bonus < 100, 'the level as shipped survives seed 1, and the calls it kept waiting cost the bonus', `${starString(r.stars)} ${r.cleared} cleared, ${r.avgWait.toFixed(0)} s, ${r.pedLate} late, bonus ${r.bonus}`);
  ok(w.controller.log.some(l => l.kind === 'green' && /lefts/.test(l.detail)) && w.controller.log.some(l => l.kind === 'walk'), 'its bays pulled their arrows and its calls were walked', '');
}

group('Two Blocks: the corridor on its offset');

{
  // the calibration (six seeds, 22 s main and 12 s side greens): offset 16
  // clears 87 to 103 with 9 to 15 s average wait; offset 0, which it ships
  // at since R2, clears 85 to 102 with 12 to 19 s. The wait does not tell
  // them apart, so the second star is the progression lesson (#639,
  // test/stars.mjs); these seeds check the board clears. Three seeds, at
  // about 5 s each.
  const l5 = levelById('two-blocks');
  const out = [];
  for (const seed of [1, 2, 3]) {
    const w = new World(l5, seed);
    for (let i = 0; i < l5.duration * 60 && !w.stats.gridlock; i++) w.step();
    const r = score(w);
    out.push({ seed, r, lock: w.stats.gridlock, handoffs: w.stats.handoffs });
  }
  ok(out.every(o => !o.lock && o.r.cleared >= l5.target && o.r.avgWait <= l5.waitTarget), 'the shipped plan clears the target under the wait target on seeds 1 to 3', out.map(o => `${starString(o.r.stars)} ${o.r.cleared}/${o.r.avgWait.toFixed(0)}s/${o.r.collisions}x`).join(' | '));
  ok(out.every(o => o.handoffs > 30), 'with cars crossing between the boxes all run', out.map(o => o.handoffs).join(', '));
}

group('Rush Hour: the events and what the corridor costs');

{
  // the calibration (six seeds, a 22 s cycle, the corridor called 2 s
  // after the ambulance arrives): 59 to 77 cleared, 13 to 21 s average
  // wait, the ambulance on time on all six; with the corridor never called
  // it is late on 3 of 6 and the board clears 65 to 83 at 10 to 17 s.
  // Target 56, waitTarget 20: the corridor is the level, and the second
  // star is what a good hand on the phases buys back. One seed of each
  // (a 4-minute run is about 8 s).
  const l6 = levelById('rush-hour');
  const run = seed => {
    const w = new World(withAuto(l6), seed);
    let called = false;
    for (let i = 0; i < l6.duration * 60 && !w.stats.gridlock; i++) {
      w.step();
      const e = w.activeEvent('ambulance');
      if (e && !called && w.t - e.at > 2) { called = w.requestPriority(e.car); }
    }
    return { w, r: score(w) };
  };
  const { w, r } = run(2);
  ok(r.survived && r.cleared >= l6.target && w.stats.outages === 1 && w.stats.ambulances === 1, 'seed 2 with the corridor called survives, clears the target, and saw the outage and the ambulance', `${starString(r.stars)} ${r.cleared}/${r.avgWait.toFixed(0)}s/${r.collisions}x`);
  ok(r.ambulanceLate === 0 && r.ambulances === 1, 'the ambulance was on time', `${r.ambulances} on the map, ${r.ambulanceLate} late`);
  const late = new World(withAuto(l6), 2);
  for (let i = 0; i < l6.duration * 60 && !late.stats.gridlock; i++) late.step();
  const rl = score(late);
  ok(rl.ambulanceLate === 1, 'the same seed with the corridor never called leaves it late', `${rl.ambulanceLate} late, cleared ${rl.cleared}`);
  // the lesson (R2, #639): the corridor, not the wait target, is the second star
  ok(r.lesson && r.lesson.met && w.stats.ambulanceEscorted === 1 && r.stars >= 2, 'with the corridor called the lesson is met and the second star is earned', `${starString(r.stars)}, ${w.stats.ambulanceEscorted} escorted`);
  ok(rl.lesson && !rl.lesson.met && rl.stars === 1 && /^the ambulance was \d+ s late$/.test(rl.reasons.at(-1)), 'never called, it is not, and the reason line says how late', rl.reasons.join('. '));
  // the penalty itself, on a board quiet enough that honks have not
  // saturated it: one late ambulance is five honks' worth
  const quiet = new World(withAuto(levelById('first-light')), 3).run(60);
  const s0 = meters(quiet).satisfaction;
  quiet.stats.honks += 5;
  const s5 = meters(quiet).satisfaction;
  quiet.stats.honks -= 5; quiet.stats.ambulanceLate = 1;
  const sLate = meters(quiet).satisfaction;
  ok(sLate < s0 - 0.05 && Math.abs(sLate - s5) < 1e-9, 'a late ambulance costs satisfaction, five honks\' worth exactly', `${s0.toFixed(3)} plain, ${s5.toFixed(3)} with five honks, ${sLate.toFixed(3)} with one late ambulance`);
  const pts = r.points, ptsLate = rl.points;
  ok(rl.points === Math.max(0, Math.round(rl.cleared * 10 + (rl.survived ? 200 : 0) + rl.stars * 150 + rl.bonus * 2 - rl.collisions * 100 - rl.honks * 5 - rl.pedLate * 5 - 50)), 'a late ambulance is 50 points', `${ptsLate} vs ${pts} with it on time`);
}

group('Main Street: the platoons and what a hand on the green buys');

{
  // the calibration is in HISTORY.md with the level, from
  // tools/calibrate.mjs with and without --hold: the hold is the hand a
  // player has, the platoon's phase asked for as its lead comes within
  // 60 m of the line and the green pressed again every 10 s until the last
  // member is through the box (the same routine the tool runs)
  const l8 = levelById('main-street');
  const run = (seed, hold) => {
    const w = new World(l8, seed);
    for (let i = 0; i < l8.duration * 60 && !w.stats.gridlock; i++) { w.step(); if (hold) holdPlatoon(w); }
    return { w, r: score(w) };
  };
  const alone = run(2, false), held = run(2, true);
  ok(alone.w.stats.platoons === 2 && alone.r.splits >= 1, 'seed 2 on the rule alone splits a platoon', `${alone.r.splits} split, ${alone.r.cleared} cleared`);
  ok(held.w.stats.platoons === 2 && held.r.splits === 0 && held.r.survived && held.r.cleared >= l8.target, 'the same seed with the green held under each platoon splits neither and clears the target', `${starString(held.r.stars)} ${held.r.cleared}/${held.r.avgWait.toFixed(0)}s/${held.r.collisions}x`);
  // the penalty: a split is five honks' worth and 50 points, the late
  // ambulance's price (#570)
  const quiet = new World(withAuto(levelById('first-light')), 3).run(60);
  const s0 = meters(quiet).satisfaction;
  quiet.stats.honks += 5;
  const s5 = meters(quiet).satisfaction;
  quiet.stats.honks -= 5; quiet.stats.platoonSplits = 1;
  const sSplit = meters(quiet).satisfaction;
  ok(sSplit < s0 - 0.05 && Math.abs(sSplit - s5) < 1e-9, 'a split costs satisfaction, five honks\' worth exactly', `${s0.toFixed(3)} plain, ${s5.toFixed(3)} with five honks, ${sSplit.toFixed(3)} with one split`);
  const ra = alone.r;
  ok(ra.splits >= 1 && ra.points === Math.max(0, Math.round(ra.cleared * 10 + (ra.survived ? 200 : 0) + ra.stars * 150 + ra.bonus * 2 - ra.collisions * 100 - ra.honks * 5 - ra.pedLate * 5 - ra.ambulanceLate * 50 - ra.splits * 50)), 'a split is 50 points', `${ra.splits} split: ${ra.points} vs ${held.r.points} held`);
  ok(ra.platoons === 2 && held.r.platoons === 2, 'and the card can say how many platoons there were');
  // the lesson (R2, #639): no split is the second star, whatever the hold cost the wait
  ok(held.r.lesson.met && held.r.stars >= 2 && !alone.r.lesson.met && alone.r.stars === 1, 'the held run meets the lesson and earns the second star; the rule alone does not', `${starString(held.r.stars)} held, ${starString(alone.r.stars)} alone`);
  ok(/^the light split (a platoon|\d+ platoons)$/.test(alone.r.reasons.at(-1)), 'and the reason line names the split', alone.r.reasons.join('. '));
}

group('the lesson decides a star (R2)');

{
  const lessons = Object.fromEntries(LEVELS.filter(l => l.lesson).map(l => [l.id, l.lesson]));
  ok(JSON.stringify(lessons) === JSON.stringify({ 'two-blocks': { kind: 'progression', stops: 0.5 }, 'rush-hour': { kind: 'ambulance' }, 'school-run': { kind: 'walks', within: 40 }, 'main-street': { kind: 'platoons' } }), 'the four levels with a default carry a lesson, and levels 1 to 4 and Free Play keep the wait star', JSON.stringify(lessons));
  ok(Object.values(lessons).every(l => lessonName(l).length > 10) && lessonName(null) === '', 'every lesson has a name for the cards', Object.values(lessons).map(lessonName).join(' / '));
  let threw = false;
  try { lessonName({ kind: 'nonsense' }); } catch { threw = true; }
  ok(threw, 'an unknown lesson kind throws rather than reading as met');
  // progression: the shipped offset (0) against the 16 s one, seed 2, asked
  // of the World's handoffs and not of the lesson helper
  const l5 = levelById('two-blocks');
  const run5 = lvl => { const w = new World(lvl, 2); for (let i = 0; i < lvl.duration * 60 && !w.stats.gridlock; i++) w.step(); return { w, r: score(w) }; };
  const shipped = run5(l5), sixteen = run5({ ...l5, controllers: [{ offset: 0 }, { offset: 16 }] });
  const share = w => w.stats.carriedStops / w.stats.carried;
  ok(shipped.w.stats.carried > 20 && share(shipped.w) > 0.5 && !shipped.r.lesson.met && shipped.r.stars === 1, 'Two Blocks on one clock: over half the handed-on cars stop again, and the star is not earned', `${shipped.w.stats.carriedStops} of ${shipped.w.stats.carried}, ${starString(shipped.r.stars)}`);
  ok(share(sixteen.w) <= 0.5 && sixteen.r.lesson.met && sixteen.r.stars === 3, 'at 16 s the platoon runs through and it is', `${sixteen.w.stats.carriedStops} of ${sixteen.w.stats.carried}, ${starString(sixteen.r.stars)}`);
  ok(/^\d+% of the cars one box sent on stopped again at the next, against 50%$/.test(shipped.r.reasons.at(-1)), 'the reason line gives the share', shipped.r.reasons.at(-1));
  // walks: the World's longest served call, against its own walk events
  const l4 = levelById('crossing');
  const w4 = new World(withAuto(l4), 3).run(120);
  const longest = w4.events.filter(e => e.kind === 'walk').reduce((a, e) => Math.max(a, e.waited), 0);
  ok(w4.stats.pedServed > 3 && Math.abs(w4.stats.pedMaxWait - longest) < 1e-9, 'the World keeps the longest a served call waited', `${w4.stats.pedMaxWait.toFixed(1)} s over ${w4.stats.pedServed} walks`);
  const as = (within, pedCalls = w4.pedCalls) => { const f = Object.create(w4); f.level = { ...l4, lesson: { kind: 'walks', within } }; f.pedCalls = pedCalls; return lessonMet(f); };
  const none = w4.pedCalls.map(() => ({}));
  ok(as(Math.ceil(longest), none).met && !as(Math.floor(longest) - 1, none).met && /^a walk call waited \d+ s, against \d+ s$/.test(as(Math.floor(longest) - 1, none).why), 'a walks lesson is met at the longest served wait and missed a second under it', `${longest.toFixed(1)} s`);
  const waiting = [{ N: { since: w4.t - longest - 10, walkers: 1, late: 0 } }];
  ok(!as(Math.ceil(longest), waiting).met, 'and a call still waiting at the end counts, served or not', `${(longest + 10).toFixed(1)} s at the curb`);
  // a record made under the old second star stands (#640)
  const st = fresh();
  recordResult(st, 'rush-hour', { stars: 3, points: 900 });
  recordResult(st, 'rush-hour', { stars: 1, points: 700 });
  ok(st.levels['rush-hour'].stars === 3 && totalStars(st) === 3, 'three stars earned before the lesson stand after a one-star run under it');
}

group('satisfaction never fails a level');

{
  const l1 = levelById('first-light');
  const w = new World({ ...l1, controller: { ...l1.controller, ...auto } }, 3).run(l1.duration);
  w.stats.honks = 500;
  for (const c of w.cars) c.patience = 0;
  const r = score(w);
  ok(r.survived && r.stars >= 1, 'five hundred honks and nobody patient still survives', `${starString(r.stars)} bonus ${r.bonus}`);
  ok(r.bonus < 30, 'but the bonus is poor', String(r.bonus));
  const m = meters(w);
  ok(m.satisfaction >= 0 && m.satisfaction <= 1, 'satisfaction stays in 0 to 1', m.satisfaction.toFixed(2));
}

group('meters mid-run');

{
  const l1 = levelById('first-light');
  const w = new World({ ...l1, controller: { ...l1.controller, ...auto } }, 5).run(40);
  const m = meters(w);
  ok(m.timeLeft > 139 && m.timeLeft < 141, 'time left counts down', m.timeLeft.toFixed(1));
  ok(m.onMap > 0 && m.cleared >= 0 && m.throughput === Math.min(1.5, m.cleared / l1.target), 'throughput is cleared over target', `${m.cleared}/${l1.target}`);
  const r = score(w);
  ok(!r.survived && /clock/.test(r.reasons.join(' ')), 'a score before the clock runs out is not a survival');
}

group('the save');

{
  ok(SAVE_KEY === 'signal_city_v1', 'the storage key is signal_city_v1 (#36)');
  const f = fresh();
  ok(f.levels && f.unlocks.includes('phases') && f.settings.sound === true, 'a fresh save has empty levels, the phases unlock and sound on');
  const r = repair({ levels: { 'first-light': { stars: '7', best: -3, plays: 'x' }, junk: null }, unlocks: ['phases', 'sensors', 5], settings: { sound: false }, lastLevel: 'first-light' });
  ok(r.levels['first-light'].stars === 3 && r.levels['first-light'].best === 0 && r.levels['first-light'].plays === 0, 'repair clamps stars to 3 and floors bad numbers at 0', JSON.stringify(r.levels['first-light']));
  ok(!('junk' in r.levels), 'and drops a null record');
  ok(r.unlocks.join() === 'phases,sensors' && r.settings.sound === false && r.lastLevel === 'first-light', 'keeps string unlocks, settings and the last level', r.unlocks.join());
  const seven = fresh();
  for (const l of LEVELS) recordResult(seven, l.id, { stars: 2, points: 100 });
  ok(Object.keys(repair(seven).levels).length === 9 && repair(seven).levels['main-street'].stars === 2, 'a record for every level through M7 comes through repair, no new field needed', Object.keys(repair(seven).levels).join());
  ok(JSON.stringify(repair(null)) === JSON.stringify(fresh()), 'repair of nothing is a fresh save');
  ok(JSON.stringify(repair(repair(r))) === JSON.stringify(repair(r)), 'repair is idempotent');
  const st = fresh();
  recordResult(st, 'first-light', { stars: 2, points: 900 });
  recordResult(st, 'first-light', { stars: 1, points: 1200 });
  ok(st.levels['first-light'].stars === 2 && st.levels['first-light'].best === 1200 && st.levels['first-light'].plays === 2, 'a result keeps the best stars and the best points separately', JSON.stringify(st.levels['first-light']));
  ok(totalStars(st) === 2, 'total stars sums the levels');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
