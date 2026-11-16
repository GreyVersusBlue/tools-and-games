// Hearth's public island, the long run (C6): one island for many island days through server/world.mjs, Node only, not in the gate.
//
//   node longrun.mjs [--days N] [--every N] [--seed N]     (default 6480 days, one default era of 90 real days at 72 a day; about 100 minutes)
//   node longrun.mjs --days 800                            (the short form in the nightly deep job; a few minutes)
//
// Every --every island days (default 500), and at the last day, it prints the step cost per island day over the stretch since the last line,
// the save raw and compressed (the compressed length is what a visitor downloads), resident memory and how long an unpack takes. It fails when
// the cost per day at the end is over three times its value at the first line, when the compressed save passes 1.5 million characters, or when
// resident memory passes 384 MB (the container's limit, DESIGN-arc-three.md 5.4). The numbers it prints are what HEARTH_ERA_DAYS is chosen from.
import { createWorld, epochStep } from '../server/world.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? +process.argv[i + 1] : d; };
const DAYS = arg('days', 6480), EVERY = arg('every', 500), SEED = arg('seed', 7);
const MAX_SAVE = 1.5e6, MAX_RSS_MB = 384, MAX_COST_RATIO = 3;
if (!(DAYS >= 1 && EVERY >= 1)) { console.error('longrun.mjs: --days and --every must be positive'); process.exit(2); }

const w = createWorld();
w.found(SEED);
console.log(`longrun.mjs: seed ${SEED}, ${DAYS} island days, a line every ${EVERY}`);
console.log('   day   ms/day   save raw  save lz   rssMB  unpack ms  people');
const rows = [], t0 = Date.now();
let mark = performance.now(), markDay = 0, fails = 0;
for (let day = 1; day <= DAYS; day++) {
  // one island day is EPOCH_STEPS steps; day d ends at the epoch step of d, so the first day is 2240 steps like the server's
  w.stepTo(epochStep(day));
  if (day % EVERY && day !== DAYS) continue;
  const cost = (performance.now() - mark) / (day - markDay);
  const snap = w.snapshot();
  const u0 = performance.now(); w.load(snap.save, snap.step); const unpack = performance.now() - u0;
  const rss = process.memoryUsage().rss / 1048576, people = w.summary().people;
  const row = { day, cost, lz: snap.save.length, rss, unpack, people };
  rows.push(row);
  console.log(`${String(day).padStart(6)} ${cost.toFixed(1).padStart(8)} ${String(snap.raw).padStart(10)} ${String(snap.save.length).padStart(8)} ${rss.toFixed(0).padStart(7)} ${unpack.toFixed(1).padStart(10)} ${String(people).padStart(7)}`);
  mark = performance.now(); markDay = day;
}

const first = rows[0], last = rows[rows.length - 1];
const check = (name, ok, detail) => { if (!ok) fails++; console.log(`${ok ? '  ok  ' : 'FAIL  '}${name}${detail !== undefined ? '  (' + detail + ')' : ''}`); };
check('step cost per day at the end is at most three times its first line', last.cost <= MAX_COST_RATIO * first.cost, `${last.cost.toFixed(1)} ms against ${first.cost.toFixed(1)} ms, ratio ${(last.cost / first.cost).toFixed(2)}`);
check('compressed save is at most 1.5 million characters', Math.max(...rows.map(r => r.lz)) <= MAX_SAVE, `${last.lz} at day ${last.day}`);
check('resident memory is at most 384 MB', Math.max(...rows.map(r => r.rss)) <= MAX_RSS_MB, `${Math.max(...rows.map(r => r.rss)).toFixed(0)} MB`);
console.log(`longrun.mjs: ${DAYS} days in ${((Date.now() - t0) / 60000).toFixed(1)} minutes, ${fails ? fails + ' FAILED' : 'all passed'}`);
process.exit(fails ? 1 : 0);
