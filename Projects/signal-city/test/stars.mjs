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
// a walk call waited past the lesson's bar.
//
// R10's rule (#778) rides here too: a converted board's `ring.meter`, the
// entry meter it sells, beats the bare ring's average wait on at least
// four seeds of six, the meter and the bare ring each played with no
// other input; and every board the roundabout converts says which meter
// it sells, or null.
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
    return { seed, stars: r.stars, cleared: r.cleared, wait: r.avgWait, collisions: r.collisions, lock: s.gridlock, splits: s.platoonSplits, ambulances: s.ambulances, escorted, carried: s.carried, carriedStops: s.carriedStops, longestCall };
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

let passed = 0, failed = 0;
const ok = (cond, what, detail = '') => {
  if (cond) { passed++; console.log(`  ok    ${what}${detail ? '  ' + detail : ''}`); }
  else { failed++; console.log(`  FAIL  ${what}${detail ? '  ' + detail : ''}`); }
};

const starred = LEVELS.filter(l => !l.sandbox);
const self = fileURLToPath(import.meta.url);
const runChild = (id, flag = '--level') => new Promise((resolve, reject) => execFile(process.execPath, [self, flag, id], { maxBuffer: 1 << 20 }, (err, out, errOut) => (err ? reject(new Error(`${id}: ${errOut || err.message}`)) : resolve(JSON.parse(out)))));
const results = new Map(), meters = new Map();
const metered = LEVELS.filter(l => convertible(l) && l.ring && l.ring.meter);
const queue = metered.map(l => ['--meter', l.id]).concat(starred.map(l => ['--level', l.id]));
await Promise.all(Array.from({ length: Math.max(1, Math.min(os.cpus().length, queue.length)) }, async () => {
  while (queue.length) { const [flag, id] = queue.shift(); (flag === '--meter' ? meters : results).set(id, await runChild(id, flag)); }
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
};
const said = {
  ambulance: r => `${r.escorted} corridor${r.escorted === 1 ? '' : 's'}`,
  platoons: r => `${r.splits} split`,
  progression: r => `${Math.round((100 * r.carriedStops) / Math.max(1, r.carried))}% stopped again`,
  walks: r => `longest call ${r.longestCall.toFixed(0)} s`,
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
