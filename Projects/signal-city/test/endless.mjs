// node test/endless.mjs
//
// Endless (M9, second increment): the days a run is made of (js/endless.js),
// what carries overnight, what ends a run, the card's lock, and the record
// in the save (`endless`, added through repair; signal_city_v1 unchanged).
// R4 (#648) adds the ramp's rule: the reference hand (tools/calibrate.mjs
// handStep, imported, not copied) lasts at least as long as no input on
// four seeds of six. Each seed's run is a child process of this file, as
// many at once as there are cores (`--jobs=N` for fewer). Site CI plays
// the first six days, the eight boxes a run grows to by then: the
// uncapped run is about 1,500 s of simulation, most of it days 7 to 10.
// `node test/endless.mjs --full` plays every seed to its first miss.
// Exits non-zero on any FAIL (#13). Imports through pathToFileURL (Windows
// rule). Every World is built and run to the end before the next is built:
// car ids come from a module counter the constructor resets.

import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const load = f => import(pathToFileURL(path.join(HERE, '..', 'js', f)).href);
const { World } = await load('sim.js');
const { score } = await load('scoring.js');
const { growCells } = await load('grid.js');
const { dayLevel, dayTarget, daySeed, demandScale, boxesOn, carryOver, expectedArrivals, DAY_SECONDS, FULL, M9_RAMP } = await load('endless.js');
const { fresh, repair, recordEndless, recordResult, totalStars, SAVE_KEY, SAVE_VERSION } = await load('save.js');
const { endlessOpen, convertible, loadout, wallet } = await load('campaign.js');
const { handStep } = await import(pathToFileURL(path.join(HERE, '..', 'tools', 'calibrate.mjs')).href);

// One city's run, day after day through the World until a day is missed
// or `upTo` is played: no input, or the reference hand at every step. A
// child process of this file runs one and prints it as JSON.
function playRun(seed, hand, upTo) {
  const days = [];
  for (let day = 1; day <= upTo; day++) {
    const lvl = dayLevel(seed, day);
    const w = new World(lvl, daySeed(seed, day));
    for (let i = 0; i < lvl.duration * 60; i++) { w.step(); if (hand) handStep(w); if (w.stats.gridlock) break; }
    const r = score(w);
    days.push(w.stats.gridlock ? 'LOCK' : `${r.cleared}/${r.target}`);
    if (!r.survived) return { seed, hand, missed: day, days };
  }
  return { seed, hand, missed: null, days };
}
const childAt = process.argv.indexOf('--run');
if (childAt > 0) {
  const [seed, hand, upTo] = process.argv.slice(childAt + 1, childAt + 4).map(Number);
  process.stdout.write(JSON.stringify(playRun(seed, hand === 1, upTo)));
  process.exit(0);
}

let passed = 0, failed = 0;
const ok = (cond, what, detail = '') => {
  if (cond) { passed++; console.log(`  ok    ${what}${detail ? '  ' + detail : ''}`); }
  else { failed++; console.log(`  FAIL  ${what}${detail ? '  ' + detail : ''}`); }
};
const group = name => console.log(`\n${name}`);
const layout = cells => cells.map(c => c.at.join(',') + ':' + c.legs.join('') + (c.roundabout ? 'o' : ''));
const run = (lvl, seed) => { const w = new World(lvl, seed); for (let i = 0; i < lvl.duration * 60; i++) { w.step(); if (w.stats.gridlock) break; } return w; };

/* ----------------------------------------------------------------- the days -- */

group('the days: one city, three boxes on day one, a box more each day, then more traffic');

{
  // the city a day is built on is the generator's, box for box
  let same = true, bad = '';
  for (let seed = 1; seed <= 6 && same; seed++) for (let day = 1; day <= 15; day++) {
    const lvl = dayLevel(seed, day);
    const want = layout(growCells(seed, boxesOn(day)));
    const got = layout(lvl.network.cells);
    if (got.join(' ') !== want.join(' ')) { same = false; bad = `seed ${seed} day ${day}: ${got.join(' ')} against ${want.join(' ')}`; break; }
  }
  ok(same, 'on six seeds, day n is growCells(seed, n + 2) box for box, and past twelve the full district', bad);
  // the ramp starts on the district's third day (R4, #648)
  ok(dayLevel(4, 1).network.cells.length === 3 && layout(dayLevel(4, 1, M9_RAMP).network.cells).join() === layout(growCells(4, 1)).join(), 'day one is three boxes; M9\'s ramp, which the calibration still plays, was one', `${dayLevel(4, 1).network.cells.length} and ${dayLevel(4, 1, M9_RAMP).network.cells.length}`);

  // yesterday's boxes stand where they stood, with their legs and rings
  let kept = true;
  for (let seed = 1; seed <= 6; seed++) for (let day = 2; day <= 10; day++) {
    const a = layout(dayLevel(seed, day - 1).network.cells);
    const b = layout(dayLevel(seed, day).network.cells);
    if (b.length !== a.length + 1 || b.slice(0, a.length).join() !== a.join()) kept = false;
  }
  ok(kept, 'on six seeds, each day to the tenth, which builds the twelfth box, is yesterday\'s boxes and one more');
  ok(dayLevel(4, 10).network.cells.length === FULL && dayLevel(4, 11).network.cells.length === FULL && dayLevel(4, 30).network.cells.length === FULL, 'past twelve no box is added', `day 11: ${dayLevel(4, 11).network.cells.length}, day 30: ${dayLevel(4, 30).network.cells.length}`);

  // the traffic: every leg's demand grows with the day, the layout does not
  const d1 = dayLevel(3, 1).demand[0], d5 = dayLevel(3, 5).demand[0], d20 = dayLevel(3, 20).demand[0];
  const ratio = (a, b) => Object.keys(a).map(l => b[l] / a[l]);
  const r5 = ratio(d1, d5), r20 = ratio(d1, d20);
  ok(demandScale(1) === 1.2 && r5.every(x => Math.abs(x - 1.6 / 1.2) < 0.02) && r20.every(x => Math.abs(x - 3.1 / 1.2) < 0.02),
    'day one carries the district\'s third day\'s traffic, 1.2, so the first box\'s demand on day 5 and day 20 is day one\'s times 1.6 / 1.2 and 3.1 / 1.2', `${r5.map(x => x.toFixed(2)).join(' ')} / ${r20.map(x => x.toFixed(2)).join(' ')}`);
  const e12 = expectedArrivals(dayLevel(3, 12)), e20 = expectedArrivals(dayLevel(3, 20));
  ok(Math.abs(e20 / e12 - demandScale(20) / demandScale(12)) < 0.02,
    'so the full district sends 3.1 / 2.3 as many cars on day 20 as on day 12', `${expectedArrivals(dayLevel(3, 12)).toFixed(0)} to ${expectedArrivals(dayLevel(3, 20)).toFixed(0)}`);

  // the target: the district's third day's 36, and 8 more every day, past
  // the full district too (#609's slope, kept by R4)
  const targets = Array.from({ length: 16 }, (_, i) => dayTarget(i + 1));
  ok(targets.every((t, i) => t === 36 + 8 * i), 'the target is 36 on day one and 8 more every day, past twelve boxes too', targets.join(' '));
  const lvl = dayLevel(9, 3);
  ok(lvl.id === 'endless' && lvl.endless && lvl.day === 3 && lvl.citySeed === 9 && !lvl.sandbox && lvl.duration === DAY_SECONDS && lvl.target === 52,
    'a day is a level: id endless, not a sandbox, three minutes, its target on it', `${lvl.name}, ${lvl.duration} s, target ${lvl.target}`);
  ok(daySeed(9, 3) !== daySeed(9, 4) && daySeed(9, 3) !== daySeed(10, 3), 'and each day of each city has its own traffic seed');
  let threw = null;
  try { dayLevel(1, 0); } catch (e) { threw = e.message; }
  ok(threw && /whole number/.test(threw), 'a day 0 is refused', threw);
}

/* ------------------------------------------------------------ the calibration -- */

group('the calibration: a hands-off city clears the early days and not the full district');

{
  // a 20 s rule at every box, the grid's own; #648's log has the full
  // table on the ramp as it ships. This samples it.
  const rows = [];
  let all = true;
  for (const [seed, day] of [[1, 1], [2, 1], [3, 2], [4, 3], [5, 1], [6, 5]]) {
    const r = score(run(dayLevel(seed, day), daySeed(seed, day)));
    rows.push(`day ${day} seed ${seed}: ${r.cleared}/${r.target}${r.gridlock ? ' LOCK' : ''}`);
    if (!r.survived) all = false;
  }
  ok(all, 'six sampled days, three to seven boxes, all survived with the rule left alone', rows.join('; '));
  const late = score(run(dayLevel(2, 12), daySeed(2, 12)));
  ok(!late.survived && !late.gridlock && late.cleared < late.target, 'and on day 12 the full district, left alone, falls short: the target ends the run, not a lock', `${late.cleared}/${late.target}`);
}

/* ------------------------------------------------ the hand against no input -- */

group('the hand against no input (R4, #648): playing does not cost a run its days');

{
  // #648: N = 0. The hand's phase choice does not raise a district's
  // capacity, which the target climbs to, so it ties no input on most
  // seeds; what the rule holds is that the ramp does not punish playing.
  // Five seeds, not the row's four: with an event a day from day 4
  // (EVENTS_RAMP, the lever #648 turned down) the hand falls short on
  // seeds 2 and 4 and holds on exactly four, so at four this line passed
  // the ramp the calibration rejects. As it ships: six of six here, five
  // of six to the end (seed 1, 9 against 10).
  const N = 0, SEEDS = [1, 2, 3, 4, 5, 6], ENOUGH = 5;
  const CAP = process.argv.includes('--full') ? 30 : 6;
  const self = fileURLToPath(import.meta.url);
  const jobsArg = process.argv.find(x => x.startsWith('--jobs='));
  const JOBS = jobsArg ? Number(jobsArg.slice(7)) : os.cpus().length;
  const child = (seed, hand, upTo) => new Promise((resolve, reject) => execFile(process.execPath, [self, '--run', String(seed), hand ? '1' : '0', String(upTo)], { maxBuffer: 1 << 20 }, (err, out, errOut) => (err ? reject(new Error(`seed ${seed}: ${errOut || err.message}`)) : resolve(JSON.parse(out)))));
  const pool = async jobs => {
    const out = [];
    const queue = jobs.slice();
    await Promise.all(Array.from({ length: Math.max(1, Math.min(JOBS, queue.length)) }, async () => {
      while (queue.length) { const j = queue.shift(); out.push(await child(...j)); }
    }));
    return new Map(out.map(r => [r.seed, r]));
  };
  // no input first, to its first miss; then the hand to that same day, the
  // one it has to get through to outlast no input
  const off = await pool(SEEDS.map(s => [s, false, CAP]));
  const hand = await pool(SEEDS.map(s => [s, true, Math.min(CAP, (off.get(s).missed ?? CAP) + N)]));
  const text = r => (r.missed ? `missed day ${r.missed}` : `past day ${r.days.length}`);
  const rows = SEEDS.map(s => {
    const a = off.get(s), b = hand.get(s);
    // the hand holds when it gets through every day no input got through, and N more
    const need = Math.min(CAP, (a.missed ?? CAP + 1) - 1 + N);
    const holds = b.missed === null ? b.days.length >= need : b.missed > need;
    const outlasts = a.missed !== null && b.missed === null && b.days.length >= a.missed;
    return { s, holds, outlasts, line: `seed ${s}: no input ${text(a)}, hand ${text(b)}` };
  });
  const held = rows.filter(r => r.holds);
  ok(held.length >= ENOUGH, `the hand lasts at least as long as no input (N = ${N}) on at least ${ENOUGH} seeds of six, over the first ${CAP} days`, `${held.length} of 6: ${rows.map(r => r.line + (r.holds ? '' : ' SHORT')).join('; ')}`);
  // and its commands reach the World: where the 20 s rule misses early the
  // hand gets past that day (seed 5 misses day 2 hands-off). Holding a
  // green is enough for it: with World.requestPhase refusing everything
  // this line stays green, and with holdGreen refusing too it fails, the
  // line above tying six of six
  const past = rows.filter(r => r.outlasts).map(r => r.s);
  ok(past.length >= 1, 'and on a seed where no input misses early, the hand gets through that day', `seed ${past.join(', ') || 'none'}`);
}

/* ---------------------------------------------------------- what ends a run -- */

group('what ends a run: the day\'s own verdict');

{
  // no rules at all: the opening phase never ends, and the other street's
  // queue passes the 120 s the grid locks at
  const held = { ...dayLevel(2, 1), controller: { ...dayLevel(2, 1).controller, rules: [] } };
  const h = score(run(held, daySeed(2, 1)));
  ok(!h.survived && h.gridlock && h.cleared < h.target, 'a day that holds one phase all day locks the grid and is not survived', `${h.cleared}/${h.target}: ${h.reasons.join('; ')}`);
  // a quiet day, a third of the traffic, runs its clock out short of the target
  const d = dayLevel(2, 1);
  const quiet = { ...d, demand: d.demand.map(m => Object.fromEntries(Object.entries(m).map(([l, v]) => [l, v / 3]))) };
  const q = score(run(quiet, daySeed(2, 1)));
  ok(!q.survived && !q.gridlock && q.reasons.some(x => /cleared of the 36/.test(x)), 'a day that runs its clock out short of the target is not survived', `${q.cleared}/${q.target}: ${q.reasons.join('; ')}`);
  // a locked grid ends it however many it cleared
  const w = new World(dayLevel(2, 1), daySeed(2, 1));
  for (let i = 0; i < 60 * 60; i++) w.step();
  w.stats.gridlock = true;
  w.t = w.duration;
  const g = score(w);
  ok(!g.survived && g.reasons.includes('the grid locked'), 'a locked grid ends the day', g.reasons.join('; '));
  // collisions cost points, not the day: endless plays soft
  ok(dayLevel(2, 5).mode === 'soft', 'and endless plays soft: a collision costs points, not the run');
}

/* --------------------------------------------------------------- overnight -- */

group('overnight: rules and timing stay on every box that stood yesterday');

{
  // seed 2 grows 1,1 1,2 0,1 2,2oT: the fourth box is a ring. Day 2 is
  // four boxes and day 3 five (R4)
  const y = new World(dayLevel(2, 2), daySeed(2, 2));
  y.controllers[0].setRules([{ when: 'elapsed', seconds: 9, then: 'next' }, { when: 'queue', movement: y.controllers[0].movements[1], threshold: 4, after: 6, then: 1 }]);
  y.controllers[0].setTiming({ allRed: 2.5, yellow: 4 });
  y.controllers[2].setRules([]);
  for (let i = 0; i < 600; i++) y.step();
  const t = new World(dayLevel(2, 3), daySeed(2, 3));
  const kept = carryOver(y, t);
  const r0 = JSON.stringify(t.controllers[0].rules), want0 = JSON.stringify(y.controllers[0].rules);
  ok(r0 === want0 && t.controllers[0].timing.allRed === 2.5 && t.controllers[0].timing.yellow === 4, 'box 1 keeps both its rules and its 2.5 s all-red and 4 s yellow', r0);
  ok(t.controllers[2].rules.length === 0, 'box 3, whose rules were all removed, still has none');
  ok(t.controllers[1].rules.length === 1 && t.controllers[1].rules[0].seconds === 20, 'box 2, left alone, keeps the grid\'s 20 s rule');
  ok(kept === 3 && t.nodes[3].roundabout, 'the ring is skipped: three signals carried, not four', `${kept} carried`);
  ok(t.controllers[4].rules[0].seconds === 20 && t.controllers[4].timing.allRed === 1, 'today\'s new box starts on the grid\'s defaults', JSON.stringify(t.controllers[4].rules));
  ok(t.t === 0 && t.cars.length === 0 && t.controllers[0].stage === 'green' && t.controllers[0].phase === t.controllers[0].initial.phase, 'and nothing else carries: no cars, the clock at 0, box 1 on its opening phase', `${t.controllers[0].stage} ${t.controllers[0].phase}`);
}

/* ----------------------------------------------------------- the card's lock -- */

group('the card: open on a star from Two Blocks, and nothing converts a grid');

{
  const s = fresh();
  ok(!endlessOpen(s), 'a fresh save does not open endless');
  s.levels['two-blocks'] = { stars: 1, best: 100, plays: 1 };
  ok(endlessOpen(s), 'a star on Two Blocks opens it');
  const played = repair({ endless: { runs: 1 } });
  ok(endlessOpen(played), 'and a run already started keeps it open without the star');
  const lvl = dayLevel(2, 6);
  ok(!convertible(lvl) && loadout(lvl, ['roundabout']) === lvl, 'an owned roundabout converts no grid: the day comes back as it was built');
  const sensed = loadout(lvl, ['sensors']);
  ok(sensed.sensors === true && sensed.id === 'endless', 'sensors, bought, go in: a grid has rules for them to fire');
}

/* ----------------------------------------------------------------- the save -- */

group('the save: `endless` through repair, the key and the version as they were');

{
  ok(SAVE_KEY === 'signal_city_v1' && SAVE_VERSION === 1, 'the key is signal_city_v1 and the version 1');
  const f = fresh();
  ok(JSON.stringify(f.endless) === '{"days":0,"points":0,"seed":null,"runs":0}', 'a fresh save has an empty endless record', JSON.stringify(f.endless));
  // a save from before endless: M8's shape, no field
  const old = { levels: { 'first-light': { stars: 3, best: 700, plays: 2 }, 'two-blocks': { stars: 2, best: 500, plays: 1 } }, unlocks: ['phases', 'lefts'], settings: { sound: false }, lastLevel: 'two-blocks' };
  const r = repair(JSON.parse(JSON.stringify(old)));
  ok(JSON.stringify(r.endless) === JSON.stringify(f.endless) && r.levels['two-blocks'].stars === 2 && r.unlocks.join() === 'phases,lefts' && wallet(r) === 2,
    'a save from before endless comes through repair with the empty record and everything else as it was', JSON.stringify(r.endless));
  const junk = repair({ endless: { days: -4, points: '1e3', seed: 'x', runs: 2.7 } });
  ok(junk.endless.days === 0 && junk.endless.points === 1000 && junk.endless.seed === null && junk.endless.runs === 2, 'repair floors bad numbers, reads numeric strings, and drops a seed that is not a number', JSON.stringify(junk.endless));
  ok(JSON.stringify(repair({ endless: 'lots' }).endless) === JSON.stringify(f.endless), 'and replaces a record that is not an object');
  ok(JSON.stringify(repair(repair(junk))) === JSON.stringify(repair(junk)), 'repair is idempotent with the record in it');

  const s = fresh();
  ok(recordEndless(s, { days: 0, points: 0, seed: 5 }, { first: true }) === false && s.endless.runs === 1 && s.endless.days === 0, 'a run that fails its first day counts a run and no best', JSON.stringify(s.endless));
  ok(recordEndless(s, { days: 1, points: 600, seed: 8 }, { first: true }) === true && s.endless.days === 1 && s.endless.seed === 8 && s.endless.runs === 2, 'a run\'s first survived day is a best, on its city\'s seed', JSON.stringify(s.endless));
  recordEndless(s, { days: 3, points: 1500, seed: 8 });
  ok(s.endless.days === 3 && s.endless.points === 1500 && s.endless.runs === 2, 'a later day of the same run raises the best without counting another run', JSON.stringify(s.endless));
  ok(recordEndless(s, { days: 3, points: 1400, seed: 9 }) === false && s.endless.seed === 8, 'the same days on fewer points is not a best');
  ok(recordEndless(s, { days: 3, points: 1600, seed: 9 }) === true && s.endless.seed === 9, 'the same days on more points is');
  ok(recordEndless(s, { days: 2, points: 9000, seed: 10 }) === false && s.endless.days === 3, 'and fewer days is not, whatever the points');
  // nothing about endless reaches the levels, the stars or the wallet
  const before = totalStars(s);
  recordResult(s, 'first-light', { stars: 2, points: 300 });
  ok(!('endless' in s.levels) && totalStars(s) === before + 2, 'endless keeps its record out of `levels`: no stars, nothing for the wallet');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
