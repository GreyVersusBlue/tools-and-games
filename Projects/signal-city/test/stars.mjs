// node test/stars.mjs
//
// R2's rule, half of it: as a level ships, no input earns three stars on
// no seed of six. Every starred level runs six seeds exactly as it ships,
// nothing pressed, and its line fails if any seed reaches three stars. The
// other half (R1's hand earns three on at least four of a lesson level's
// six) is tools/calibrate.mjs --hand, in HISTORY.md with #639: the hand is
// a tool, and a suite that re-ran it would be checking the tool.
//
// A lesson level has a second line, read off the World and not off
// scoring.js's lessonMet (the helper under test): on every seed, the move
// the level teaches was not made by nobody. The ambulance had no corridor,
// a platoon was split, over half the cars one box handed on stopped again,
// a walk call waited past the lesson's bar, no entry meter fired.
//
// R10's rule (#778) rides here too: a converted board's `ring.meter`, the
// entry meter it sells, beats the bare ring's average wait on at least
// four seeds of six, the meter and the bare ring each played with no
// other input; and every board the roundabout converts says which meter
// it sells, or null.
//
// R13's corridor rides here as well (WAVES below): Boulevard's calibration,
// pinned so that an engine change that moves it fails by name. With no
// input no seed locks and every seed clears the target for the one star;
// with the offset set at load to the level's wave, through World.setOffset
// as the slider sets it, every seed meets the lesson with each direction's
// share under the bar, and at least five three-star; a quarter of a cycle
// off the wave no seed meets it. Each direction is counted here, off the
// World's `cleared` events, and has to add up to the World's own count.
//
// R13's row of boxes rides here too (CROSSINGS below): Cross Town's
// calibration (#929). With nothing pressed no seed locks, every seed clears
// the target for the one star and nobody makes the corridor. Played by the
// calibration's hand (tools/calibrate.mjs handStep: the corridor as the
// ambulance arrives, the green given at each box ahead of it), every seed
// gets the ambulance across all three boxes inside its time; with the
// corridor and without the road ahead, some seeds do and some do not, which
// is what makes the road ahead the level. What the ambulance did is read
// off the World's events, not off scoring.js.
//
// Each level runs in a child process of this file, as many at once as
// there are cores: the six seeds are 5 to 17 s each. Exits non-zero on any
// FAIL (#13). Imports through pathToFileURL (Windows rule).

import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const load = f => import(pathToFileURL(path.join(HERE, '..', 'js', f)).href);
const { World } = await load('sim.js');
const { score, starString } = await load('scoring.js');
const { LEVELS, levelById } = await load('levels/pack-01.js');
const { loadout, convertible } = await load('campaign.js');
const { handStep } = await import(pathToFileURL(path.join(HERE, '..', 'tools', 'calibrate.mjs')).href);

const SEEDS = [1, 2, 3, 4, 5, 6];

// One level, six seeds, no input: what the parent asserts on, as JSON.
function runLevel(level) {
  return SEEDS.map(seed => {
    const w = new World(level, seed);
    for (let i = 0; i < level.duration * 60 && !w.stats.gridlock; i++) w.step();
    const r = score(w);
    const s = w.stats;
    // the World's own record of the lesson's move, for the second line
    let longestCall = 0;
    for (const e of w.events) if (e.kind === 'walk') longestCall = Math.max(longestCall, e.waited);
    for (const calls of w.pedCalls) for (const c of Object.values(calls)) if (c) longestCall = Math.max(longestCall, w.t - c.since);
    const escorted = w.events.filter(e => e.kind === 'priority').length;
    const meterFired = w.meters.reduce((n, m) => n + (m ? m.fired : 0), 0);
    return { seed, stars: r.stars, cleared: r.cleared, wait: r.avgWait, collisions: r.collisions, lock: s.gridlock, splits: s.platoonSplits, ambulances: s.ambulances, escorted, carried: s.carried, carriedStops: s.carriedStops, longestCall, meterFired };
  });
}

// A corridor's wave (R13): the offset each of a level's six seeds is played
// at, set at load, and what the level's calibration says of it.
//   at    the wave: every seed meets the lesson, each way
//   off   a quarter of a cycle from it: no seed does
const WAVES = { boulevard: { at: 16, off: 8 } };

// One corridor level, six seeds, the offset set at load and nothing else
// pressed. East and west are the shares of the cars handed on each way that
// waited again.
function runWave(level, offset) {
  return SEEDS.map(seed => {
    const w = new World(level, seed);
    w.setOffset(offset);
    // a car is dropped from `cars` on the step it leaves, so each handed-on
    // car is remembered while it is on the map and counted at its `cleared` event
    const dir = { east: [0, 0], west: [0, 0] }, on = new Map();
    let read = 0;
    for (let i = 0; i < level.duration * 60 && !w.stats.gridlock; i++) {
      for (const c of w.cars) if (!c.done && c.waitAtHandoff !== undefined && !on.has(c.id)) on.set(c.id, { way: c.path.entry === 'W' ? 'east' : 'west', at: c.waitAtHandoff });
      w.step();
      for (; read < w.events.length; read++) { const e = w.events[read], h = e.kind === 'cleared' && on.get(e.car); if (h) { dir[h.way][0]++; if (e.wait > h.at) dir[h.way][1]++; } }
    }
    const r = score(w);
    return { seed, stars: r.stars, cleared: r.cleared, wait: r.avgWait, collisions: r.collisions, lock: w.stats.gridlock, carried: w.stats.carried, carriedStops: w.stats.carriedStops, east: dir.east[1] / Math.max(1, dir.east[0]), west: dir.west[1] / Math.max(1, dir.west[0]), counted: dir.east[0] + dir.west[0] };
  });
}

// A row of boxes an ambulance crosses (R13, #929): the levels whose six
// seeds are played by the hand, in full and without the road ahead.
const CROSSINGS = ['cross-town'];

// One such level, six seeds, by the hand: `road` is the hand in full, `call`
// the hand with the boxes ahead of the ambulance left to their rules. The
// ambulance's trip is its `spawn` event to its `cleared` event; `handed` is
// the boxes it was handed to and `corridors` the boxes that made its
// corridor, the first by the call and the rest by the follow.
function runCross(level, mode) {
  return SEEDS.map(seed => {
    const w = new World(level, seed);
    let amb = null, came = null, left = null, read = 0;
    const handed = [], corridors = [];
    for (let i = 0; i < level.duration * 60 && !w.stats.gridlock; i++) {
      w.step();
      handStep(w, mode === 'road' ? {} : { ahead: false });
      for (; read < w.events.length; read++) {
        const e = w.events[read];
        if (e.kind === 'spawn' && e.archetype === 'emergency') { amb = e.car; came = e.t; }
        if (amb !== null && e.car === amb) {
          if (e.kind === 'handoff') handed.push(e.node);
          if (e.kind === 'priority') corridors.push(e.follow ? e.node : 0);
          if (e.kind === 'cleared') left = e.t;
        }
      }
    }
    const r = score(w);
    return { seed, stars: r.stars, cleared: r.cleared, wait: r.avgWait, collisions: r.collisions, lock: w.stats.gridlock, trip: left === null ? null : left - came, handed: handed.join(), corridors: corridors.join() };
  });
}

// One converted board as a ring, six seeds bare and six with its meter.
function runMeter(level) {
  const ring = loadout(level, ['roundabout']);
  const wait = lvl => SEEDS.map(seed => {
    const w = new World(lvl, seed);
    for (let i = 0; i < lvl.duration * 60 && !w.stats.gridlock; i++) w.step();
    return score(w).avgWait;
  });
  return { bare: wait(ring), meter: wait({ ...ring, meter: level.ring.meter }) };
}

const child = process.argv.indexOf('--level');
if (child > 0) {
  process.stdout.write(JSON.stringify(runLevel(levelById(process.argv[child + 1]))));
  process.exit(0);
}
const meterChild = process.argv.indexOf('--meter');
if (meterChild > 0) {
  process.stdout.write(JSON.stringify(runMeter(levelById(process.argv[meterChild + 1]))));
  process.exit(0);
}

const waveChild = process.argv.indexOf('--wave');
if (waveChild > 0) {
  const [id, offset] = process.argv[waveChild + 1].split('@');
  process.stdout.write(JSON.stringify(runWave(levelById(id), Number(offset))));
  process.exit(0);
}

const crossChild = process.argv.indexOf('--cross');
if (crossChild > 0) {
  const [id, mode] = process.argv[crossChild + 1].split('@');
  process.stdout.write(JSON.stringify(runCross(levelById(id), mode)));
  process.exit(0);
}

let passed = 0, failed = 0;
const ok = (cond, what, detail = '') => {
  if (cond) { passed++; console.log(`  ok    ${what}${detail ? '  ' + detail : ''}`); }
  else { failed++; console.log(`  FAIL  ${what}${detail ? '  ' + detail : ''}`); }
};

const starred = LEVELS.filter(l => !l.sandbox);
const self = fileURLToPath(import.meta.url);
const runChild = (id, flag = '--level') => new Promise((resolve, reject) => execFile(process.execPath, [self, flag, id], { maxBuffer: 1 << 20 }, (err, out, errOut) => (err ? reject(new Error(`${id}: ${errOut || err.message}`)) : resolve(JSON.parse(out)))));
const results = new Map(), meters = new Map(), waves = new Map(), crosses = new Map();
const metered = LEVELS.filter(l => convertible(l) && l.ring && l.ring.meter);
const waved = Object.entries(WAVES).flatMap(([id, w]) => [`${id}@${w.at}`, `${id}@${w.off}`]);
const crossed = CROSSINGS.flatMap(id => [`${id}@road`, `${id}@call`]);
const queue = metered.map(l => ['--meter', l.id]).concat(starred.map(l => ['--level', l.id]), waved.map(k => ['--wave', k]), crossed.map(k => ['--cross', k]));
await Promise.all(Array.from({ length: Math.max(1, Math.min(os.cpus().length, queue.length)) }, async () => {
  while (queue.length) { const [flag, id] = queue.shift(); (flag === '--meter' ? meters : flag === '--wave' ? waves : flag === '--cross' ? crosses : results).set(id, await runChild(id, flag)); }
}));

const cellText = r => `${r.lock ? 'LOCK' : r.cleared} ${r.wait.toFixed(0)}s ${starString(r.stars)}`;
console.log('\nno input earns three stars on no seed of six (R2)');
for (const level of starred) {
  const rows = results.get(level.id);
  const three = rows.filter(r => r.stars === 3).map(r => r.seed);
  ok(rows.length === 6 && three.length === 0, `${level.name}: no seed three-stars with no input`, `${rows.map(cellText).join(' | ')}${three.length ? `, three on seed ${three.join(', ')}` : ''}`);
}

// What the World says the lesson's move was, seed by seed. A lesson kind
// with no line here fails, so a new kind cannot ship unread.
const played = {
  ambulance: (r) => r.ambulances > 0 && r.escorted > 0,
  platoons: (r) => r.splits === 0,
  progression: (r, l) => r.carried > 0 && r.carriedStops / r.carried <= l.lesson.stops,
  walks: (r, l) => r.longestCall <= l.lesson.within,
  meter: (r) => r.meterFired > 0,
};
const said = {
  ambulance: r => `${r.escorted} corridor${r.escorted === 1 ? '' : 's'}`,
  platoons: r => `${r.splits} split`,
  progression: r => `${Math.round((100 * r.carriedStops) / Math.max(1, r.carried))}% stopped again`,
  walks: r => `longest call ${r.longestCall.toFixed(0)} s`,
  meter: r => `meter fired ${r.meterFired}`,
};
console.log('\nand on a lesson level the World says nobody played the lesson');
for (const level of starred.filter(l => l.lesson)) {
  const rows = results.get(level.id);
  const test = played[level.lesson.kind];
  if (!test) { ok(false, `${level.name}: a lesson kind this suite can read`, level.lesson.kind); continue; }
  const made = rows.filter(r => test(r, level)).map(r => r.seed);
  ok(made.length === 0, `${level.name}: the lesson (${level.lesson.kind}) was not played on any seed`, `${rows.map(r => said[level.lesson.kind](r)).join(' | ')}${made.length ? `, played on seed ${made.join(', ')}` : ''}`);
}

console.log('\na ring sells an entry meter only where it beats the bare ring on four seeds of six (R10)');
const converted = LEVELS.filter(convertible);
ok(converted.length > 0 && converted.every(l => l.ring && 'meter' in l.ring), 'every board the roundabout converts says which meter it sells, or null', converted.map(l => `${l.id}: ${JSON.stringify(l.ring && l.ring.meter)}`).join(', '));
for (const level of metered) {
  const { bare, meter } = meters.get(level.id);
  const wins = meter.filter((x, i) => x < bare[i] - 1e-9).length;
  ok(wins >= 4, `${level.name}: a meter on ${level.ring.meter.leg} at ${level.ring.meter.red} s beats the bare ring's wait on ${wins} seeds of six`, bare.map((b, i) => `${b.toFixed(1)} to ${meter[i].toFixed(1)} s`).join(' | '));
}

console.log('\na corridor with two lanes carries its wave both ways, and only on its offset (R13)');
const twoLane = starred.filter(l => (l.network.nodes || 1) > 1 && (l.network.lanesPerDir || 1) > 1 && l.lesson && l.lesson.kind === 'progression');
ok(twoLane.length > 0 && twoLane.every(l => WAVES[l.id]), 'every two-lane corridor with a progression lesson has its wave pinned here', twoLane.map(l => l.id).join(', '));
const pc = x => `${Math.round(x * 100)}%`;
for (const [id, wave] of Object.entries(WAVES)) {
  const level = levelById(id), bar = level.lesson.stops;
  const idle = results.get(id), on = waves.get(`${id}@${wave.at}`), off = waves.get(`${id}@${wave.off}`);
  const share = r => r.carriedStops / Math.max(1, r.carried);
  ok(idle.every(r => !r.lock), `${level.name}: no seed locks from the opening state with nothing pressed`, idle.map(r => (r.lock ? `seed ${r.seed} LOCK` : r.cleared)).join(' | '));
  ok(idle.every(r => r.cleared >= level.target && r.stars === 1), `${level.name}: with nothing pressed every seed clears the target of ${level.target} and keeps exactly one star`, idle.map(cellText).join(' | '));
  ok(idle.every(r => share(r) > 2 * bar), `${level.name}: and stops more than twice the bar's share of its handed-on cars`, idle.map(r => pc(share(r))).join(' | '));
  ok(on.every(r => !r.lock && r.cleared >= level.target && r.carried > 40 && r.counted === r.carried && share(r) <= bar), `${level.name} at ${wave.at} s: every seed clears the target and meets the lesson (at most ${pc(bar)} stopping again)`, on.map(r => `${r.lock ? 'LOCK' : r.cleared} ${pc(share(r))}`).join(' | '));
  ok(on.every(r => r.east <= bar && r.west <= bar), `${level.name} at ${wave.at} s: the eastbound share and the westbound share are each under the bar on every seed`, on.map(r => `${pc(r.east)}/${pc(r.west)}`).join(' | '));
  const three = on.filter(r => r.stars === 3).length;
  ok(three >= 5, `${level.name} at ${wave.at} s: three stars on at least five seeds of six`, `${three} of 6: ${on.map(cellText).join(' | ')}`);
  ok(off.every(r => share(r) > bar && r.stars < 2), `${level.name} at ${wave.off} s, a quarter of a cycle off: no seed meets the lesson`, off.map(r => `${pc(share(r))} ${starString(r.stars)}`).join(' | '));
}

console.log('\na row of boxes the ambulance crosses: the corridor follows it, and the road ahead decides it (R13)');
const rows3 = starred.filter(l => (l.network.nodes || 1) > 2 && l.lesson && l.lesson.kind === 'ambulance');
ok(rows3.length > 0 && rows3.every(l => CROSSINGS.includes(l.id)), 'every row of three or more boxes with an ambulance lesson has its crossing pinned here', rows3.map(l => l.id).join(', '));
for (const id of CROSSINGS) {
  const level = levelById(id), amb = level.events.find(e => e.kind === 'ambulance'), last = (level.network.nodes || 1) - 1;
  const idle = results.get(id), road = crosses.get(`${id}@road`), call = crosses.get(`${id}@call`);
  const every = Array.from({ length: last }, (_, k) => k + 1).join(), all = Array.from({ length: last + 1 }, (_, k) => k).join();
  const tripText = r => (r.trip === null ? 'never' : `${r.trip.toFixed(0)} s`);
  const onTime = r => r.trip !== null && r.trip <= amb.within;
  ok(idle.every(r => !r.lock), `${level.name}: no seed locks from the opening state with nothing pressed`, idle.map(r => (r.lock ? `seed ${r.seed} LOCK` : r.cleared)).join(' | '));
  ok(idle.every(r => r.cleared >= level.target && r.stars === 1), `${level.name}: with nothing pressed every seed clears the target of ${level.target} and keeps exactly one star`, idle.map(cellText).join(' | '));
  ok(road.every(r => !r.lock && r.cleared >= level.target), `${level.name}, the hand: no seed locks and every seed clears the target`, road.map(r => (r.lock ? 'LOCK' : r.cleared)).join(' | '));
  ok(road.every(r => r.handed === every && r.corridors === all), `${level.name}, the hand: on every seed the ambulance is handed to every box after the first, and every box makes its corridor`, road.map(r => `${r.handed || '-'} / ${r.corridors || '-'}`).join(' | '));
  ok(road.every(onTime), `${level.name}, the hand: the ambulance is off the map inside its ${amb.within} s on every seed`, road.map(tripText).join(' | '));
  const three = road.filter(r => r.stars === 3).length;
  ok(three >= 5, `${level.name}, the hand: three stars on at least five seeds of six`, `${three} of 6: ${road.map(cellText).join(' | ')}`);
  const made = call.filter(onTime).length;
  ok(call.every(r => r.corridors === all) && made >= 3 && made <= 5, `${level.name}, the corridor called and the road ahead left alone: the corridor follows it on every seed, and it is on time on three to five of six, not all`, `${made} of 6: ${call.map(tripText).join(' | ')}`);
  const faster = road.filter((r, i) => r.trip !== null && (call[i].trip === null || r.trip < call[i].trip)).length;
  ok(faster >= 5, `${level.name}: the road ahead cleared gets the ambulance across sooner on at least five seeds of six`, road.map((r, i) => `${tripText(call[i])} to ${tripText(r)}`).join(' | '));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
