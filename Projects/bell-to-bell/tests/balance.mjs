// Balance harness. Runs whole 47-minute periods headlessly with crude play
// styles and prints where the meters land. Mostly not an assertion suite — a
// sanity check you run after touching src/config.js or the lesson data — with
// one exception since Phase 2: the generator soak at the bottom fails loudly
// if any seed leaves data/generation.json's bands, because a check that only
// prints is a check that gets ignored.
//
//   cd tests && node balance.mjs
//   SPREAD=1 node balance.mjs     # per-student comprehension under each row
//   SOAK=200 node balance.mjs     # more seeds through the generator
import fs from 'fs';
import { CFG } from '../src/config.js';
import { periodFor, periodIds, rowFor } from '../src/periods.js';
import { contentFiles } from '../src/loader.js';
import { runPeriod, STYLES } from '../src/systems/simulate.js';
import { visitFor } from '../src/systems/observation.js';
import { subjectKey, hazardBand, stackBand } from '../src/systems/subject.js';

const D = f => JSON.parse(fs.readFileSync(`../data/${f}.json`, 'utf8'));
const lData = D('lesson'), sData = D('students'), tData = D('tells'), eData = D('events');
const roomData = D('room'), seatData = D('seating'), obsData = D('observation');

// Phase 1: the day comes out of data/periods.json, so a period added there
// shows up in this table without an edit in here. Phase 2: a generated row
// needs a seed to become a class; this one is fixed so the table is stable.
const pData = D('periods');
const bundle = { room: roomData, students: sData, tells: tData, lesson: lData,
  seating: seatData, periods: pData, events: eData, observation: obsData,
  generation: D('generation') };
for (const name of contentFiles(pData)) if (!(name in bundle)) bundle[name] = D(name);
// Phase 5: the subjects, loaded the way src/loader.js loads them so a period
// row naming one resolves in here too.
const subjData = D('subjects');
for (const id of subjData.subjects) {
  bundle[subjectKey(id)] = JSON.parse(fs.readFileSync(`../data/subjects/${id}.json`, 'utf8'));
}
bundle.subjects = subjData;
const TABLE_SEED = 4821;
const PERIODS = periodIds(bundle).map(id => periodFor(id, bundle, { seed: TABLE_SEED, day: 0 }));
const SIM = { room: roomData, tells: tData, seating: seatData, events: eData, observation: obsData };

// Phase 2: `run()` moved into src/systems/simulate.js so the generator can
// hold a class to the same numbers this table prints. This is the printing.
function run(name, style, chartSeats = null, period = PERIODS[0], opts = {}) {
  const r = runPeriod({ period, data: SIM, style, opts: { ...opts, chartSeats } });
  const { state, missed, plan, students } = r;
  const p = v => String(Math.round(v)).padStart(3);
  const obs = state.obsResult ? `  obs ${state.obsResult.satisfied.length}/${state.obsResult.total}` : '';
  console.log(
    `${name.padEnd(22)} mastery ${p(state.mastery)}  fidelity ${p(state.fidelity)}  ` +
    `rapport ${p(state.rapport)}  bandwidth ${p(state.bandwidth)}  restless ${p(state.restless)}  ` +
    `beats ${state.beatsDelivered}/${r.beats}  checks ${String(state.checks).padStart(2)}  ` +
    `missed ${missed}  scan ${Math.round(state.withitnessSeconds)}s${obs}`
  );
  if (plan.suppressed.length || plan.separated.length) {
    console.log(`   chart: ${plan.suppressed.length} never happened, ` +
      `${plan.separated.length} found another way`);
  }
  if (process.env.SPREAD) {
    console.log('   ' + [...students].sort((a, b) => b.comp - a.comp)
      .map(s => `${s.name} ${Math.round(s.comp * 100)}`).join('  '));
  }
  return r;
}

console.log(`\nperiod: ${CFG.periodSeconds}s game / ${Math.round(CFG.periodSeconds / CFG.timeScale)}s real`);
console.log(`lesson: ${lData.beats.reduce((a, b) => a + b.seconds, 0)}s of authored beats\n`);

run(STYLES.ideal.label, STYLES.ideal);
run(STYLES.good.label, STYLES.good);
// T7: same teacher, same everything, except she also plays to the rubric the
// moment AP Reyes walks in. If mastery/fidelity land identically to the row
// above, the Observation is decoration and something is wrong.
run(STYLES.goodRubric.label, STYLES.goodRubric);
run(STYLES.hypervigilant.label, STYLES.hypervigilant);
run(STYLES.wanderer.label, STYLES.wanderer);
// The chart matters most to a teacher who is not catching everything, so the
// comparison below uses one who never looks up: whatever the seating produces,
// runs its course.
const HEADS_DOWN = STYLES.ideal;
const NEVER_CHECKS = STYLES.neverChecks;
run(NEVER_CHECKS.label, NEVER_CHECKS);

// T4: the same teacher, three charts. If these three lines are identical, the
// seating chart is decoration and something is wrong.
console.log('the same teacher who never looks up, three charts:');
const swaps = (...pairs) => {
  const a = sData.roster.map((_, i) => i);
  for (const [x, y] of pairs) {
    const i = a.indexOf(x), j = a.indexOf(y);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
run('  the August chart', HEADS_DOWN);
run('  the pairs split up', HEADS_DOWN, swaps([5, 11], [2, 7]));
run('  the barometer up front', HEADS_DOWN, swaps([6, 0]));
console.log('');

// T6: a different roster, a different tell schedule, a different lesson — same
// room, same rulebook, same three representative styles. Phase 1: this loops
// over whatever data/periods.json holds rather than naming 5th period, so an
// authored 7th period lands in this table on its own. Phase 2: so does a
// generated one, under the fixed seed above.
const IDEAL = STYLES.ideal, GOOD = STYLES.good;

for (const period of PERIODS.slice(1)) {
  const beatSeconds = period.lessonData.beats.reduce((a, b) => a + b.seconds, 0);
  const gen = period.generated ? ` — generated, seed ${period.generated.seed}, ${period.generated.rerolls} reroll${period.generated.rerolls === 1 ? '' : 's'}` : '';
  console.log(`${period.short} period lesson: ${beatSeconds}s of authored beats, ` +
    `${period.schedule.length} scheduled tells (vs 4th's ${PERIODS[0].schedule.length})${gen}\n`);
  run(`${period.short}: ideal (never scans)`, IDEAL, null, period);
  run(`${period.short}: the good teacher`, GOOD, null, period);
  run(`${period.short}: never checks, never looks`, NEVER_CHECKS, null, period);
  console.log('');
}

// Phase 1: the whole day, back to back, on one Bandwidth pool. Bandwidth is
// the one meter the treatment says does not regenerate during the school day,
// so this is the only row in the file where a period starts from anything
// other than CFG.start — each one opens on whatever the last bell left plus
// CFG.day.passingPeriodRecovery. If the last row here looks like the first,
// the pool is not costing anything and the constant is wrong.
console.log(`the good teacher, the whole day on one Bandwidth pool ` +
  `(+${CFG.day.passingPeriodRecovery} per passing period):`);
let pool = null;
const day = { mastery: 0, fidelity: 0, rapport: 0, beats: 0, delivered: 0, checks: 0, missed: 0 };
for (const period of PERIODS) {
  const opened = pool == null ? CFG.start.bandwidth : pool;
  const r = run(`  ${period.ordinal} (from ${Math.round(opened)})`, GOOD, null, period, { bandwidth: pool });
  pool = Math.min(100, r.state.bandwidth + CFG.day.passingPeriodRecovery);
  day.mastery += r.state.mastery; day.fidelity += r.state.fidelity; day.rapport += r.state.rapport;
  day.beats += r.beats; day.delivered += r.state.beatsDelivered;
  day.checks += r.state.checks; day.missed += r.missed;
}
const n = PERIODS.length;
const avg = v => String(Math.round(v / n)).padStart(3);
console.log(
  `  ${String(n + ' periods').padEnd(20)} mastery ${avg(day.mastery)}  fidelity ${avg(day.fidelity)}  ` +
  `rapport ${avg(day.rapport)}  (means)          ` +
  `beats ${day.delivered}/${day.beats}  checks ${String(day.checks).padStart(2)}  missed ${day.missed}`);
console.log('');

// Phase 2: the generator soak. Fifty seeds (SOAK=n for more), each a fresh
// class through the two banded play styles; min/mean/max per meter, and the
// only assertion in this file: every seed lands inside data/generation.json's
// bands and every roster and schedule keeps its structural promises. The
// generator already rerolls a schedule that misses the band, so a failure
// here means a roster the schedule could not be made to fit — a distribution
// problem in generation.json, which is a bug and exits non-zero as one.
import { generateRoster, rosterProblems } from '../src/systems/roster.js';
import { scheduleProblems } from '../src/systems/scheduler.js';
import { bandProblems } from '../src/systems/generate.js';

const SOAK = Math.max(1, parseInt(process.env.SOAK || '50', 10));
const genData = bundle.generation;
const genRow = periodIds(bundle).map(id => rowFor(id, bundle)).find(r => r.generate);
if (!genRow) {
  console.log('no generated period in data/periods.json; nothing to soak');
} else {
  console.log(`the generator, ${SOAK} seeds through ${genRow.short} period, ` +
    `${Object.keys(genData.bands).filter(k => STYLES[k]).join(' and ')}:`);
  const agg = {};
  const failures = [];
  let rerolls = 0, maxRerolls = 0, tells = 0, swallowed = 0;
  const t0 = Date.now();
  for (let seed = 1; seed <= SOAK; seed++) {
    let period;
    try {
      period = periodFor(genRow.id, bundle, { seed, day: 0 });
    } catch (e) { failures.push(`seed ${seed}: ${e.message}`); continue; }
    const deps = { tellTypes: tData.types, seatGrid: period.seatGrid, rules: seatData.rules, gen: genData };
    for (const p of rosterProblems(period.roster, genData)) failures.push(`seed ${seed} roster: ${p}`);
    for (const p of scheduleProblems(period.schedule, period.roster, deps)) failures.push(`seed ${seed} schedule: ${p}`);
    for (const p of bandProblems(period.generated.results, genData.bands)) failures.push(`seed ${seed} band: ${p}`);
    rerolls += period.generated.rerolls; maxRerolls = Math.max(maxRerolls, period.generated.rerolls);
    tells += period.schedule.length;
    swallowed += runPeriod({ period, data: SIM, style: STYLES.ideal }).plan.suppressed.length;
    for (const [style, r] of Object.entries(period.generated.results)) {
      for (const [meter, v] of Object.entries(r)) {
        const key = `${style}.${meter}`;
        (agg[key] = agg[key] || []).push(v);
      }
    }
  }
  const stat = arr => ({
    min: Math.min(...arr), max: Math.max(...arr), mean: arr.reduce((a, b) => a + b, 0) / arr.length
  });
  const p = v => String(Math.round(v)).padStart(3);
  for (const [key, arr] of Object.entries(agg)) {
    const s = stat(arr);
    const [style, meter] = key.split('.');
    const [lo, hi] = genData.bands[style][meter];
    console.log(`  ${(STYLES[style].label + ', ' + meter).padEnd(38)} min ${p(s.min)}  mean ${p(s.mean)}  max ${p(s.max)}   band ${lo}..${hi}`);
  }
  const ok = SOAK - failures.filter(f => f.includes(': Class seed')).length;
  console.log(`  ${SOAK} seeds in ${Date.now() - t0}ms; ${(tells / ok).toFixed(1)} tells per period, ` +
    `${(swallowed / ok).toFixed(2)} swallowed by the August chart; ` +
    `${(rerolls / ok).toFixed(2)} rerolls per seed, worst ${maxRerolls} of ${genData.bands.rerollCap}`);
  if (failures.length) {
    console.log(`\n${failures.length} FAILURES`);
    for (const f of failures) console.log('  ' + f);
    process.exit(1);
  }
  console.log('  every seed inside the band\n');
}

// Phase 5: the subjects. Treatment §4 says a subject does not change a system,
// it changes which tells are common, what the events say, and one number on
// the meters — so the honest test is one representative style through 4th
// period under each of them, side by side. Social Studies is the file that
// describes what already exists: its row has to land on the same numbers as
// "the good teacher" at the top of this file, or the shape is wrong. Science's
// Hazard column is what says whether a lab day is playable; a subject whose
// Hazard tops out under every style needs a smaller number in its own file,
// not a change in here.
console.log('the good teacher, 4th period, one subject at a time (Tuesday, a lab day):');
for (const id of subjData.subjects) {
  const subject = { meters: {}, tellWeights: {}, events: [], flavor: {}, hazard: null, stack: null,
    ...bundle[subjectKey(id)] };
  const r = runPeriod({ period: { ...PERIODS[0], subject }, data: SIM, style: GOOD, opts: { day: 1 } });
  const p = v => String(Math.round(v)).padStart(3);
  const haz = subject.hazard
    ? `  hazard ${p(r.state.hazard)} ${(hazardBand(eData, r.state.hazard)?.label || '').padEnd(13)}`
    : '  hazard  --' + ' '.padEnd(14);
  const stack = subject.stack
    ? `  stack ${String(subject.stack.add).padStart(2)}/night -${subject.stack.graded}`
    : '';
  console.log(
    `  ${subject.label.padEnd(16)} mastery ${p(r.state.mastery)}  fidelity ${p(r.state.fidelity)}  ` +
    `rapport ${p(r.state.rapport)}  bandwidth ${p(r.state.bandwidth)}  restless ${p(r.state.restless)}  ` +
    `missed ${r.missed}${haz}${stack}`);
}
console.log('');

// Phase 5: and the same lab day played badly, because a Hazard profile is only
// interesting if the difference between the two rows above and below is real.
console.log('science, 4th period, a lab day under four styles:');
for (const key of ['ideal', 'good', 'wanderer', 'neverChecks']) {
  const subject = { meters: {}, tellWeights: {}, events: [], flavor: {}, hazard: null, stack: null,
    ...bundle[subjectKey('science')] };
  const r = runPeriod({ period: { ...PERIODS[0], subject }, data: SIM, style: STYLES[key], opts: { day: 1 } });
  const p = v => String(Math.round(v)).padStart(3);
  console.log(`  ${STYLES[key].label.padEnd(26)} hazard ${p(r.state.hazard)}  ` +
    `${(hazardBand(eData, r.state.hazard)?.label || '').padEnd(13)}  ` +
    `incident ${r.incident ? 'YES' : 'no '}  fidelity ${p(r.state.fidelity)}  restless ${p(r.state.restless)}`);
}
console.log('');

// Phase 3: a week. Five days, every period, one style, with the semester
// record at each bell: what the class opened on (yesterday's twelve numbers
// minus a night), what it closed on, admin's opinion, and which rung of the
// ladder the day started on. The failure this table catches is drift — a
// per-night cost that looks trivial on Tuesday and has compounded to zero by
// Thursday — so read the `opens` column down, not the `closes` column across.
// The good teacher should plateau; the wanderer should meet AP Reyes.
import * as semester from '../src/systems/semester.js';
const adminData = D('admin');

function week(style) {
  console.log(`${style.label}, a week of ${PERIODS.length} periods a day, the record at each bell:`);
  // Phase 4: the week runs AP Reyes's real calendar rather than a visit every
  // period, so the `obs` column is where a `chance` that makes her a metronome
  // (or a stranger) shows up as a column of dashes or a column of fives.
  let record = semester.createRecord(TABLE_SEED);
  let visits = 0;
  for (let d = 0; d < CFG.semester.daysPerWeek; d++) {
    let pool = null;
    for (const id of periodIds(bundle)) {
      const period = periodFor(id, bundle, { seed: TABLE_SEED, day: semester.dayIndexOf(record) });
      const carry = semester.entering(record, id, {
        roster: period.roster, seed: period.generated ? period.generated.seed : null, admin: adminData
      });
      const opens = carry.startComp
        ? carry.startComp.reduce((a, b) => a + b, 0) / carry.startComp.length * 100 : null;
      const visit = visitFor(obsData, { seed: record.seed, dayIndex: carry.dayIndex, periodId: id });
      if (visit) visits++;
      const r = runPeriod({ period, data: SIM, style, opts: {
        bandwidth: pool, startComp: carry.startComp, rapport: carry.rapport, fidelity: carry.fidelity,
        obsWindowScale: carry.obsWindowScale, effects: carry.effects, visit
      } });
      pool = Math.min(100, r.state.bandwidth + CFG.day.passingPeriodRecovery);
      record = semester.recordPeriod(record, {
        periodId: id, seed: period.generated ? period.generated.seed : null,
        roster: period.roster, students: r.students,
        rapport: r.state.rapport, fidelity: r.state.fidelity, mastery: r.state.mastery,
        bandwidth: r.state.bandwidth, missed: r.missed, caught: 0,
        obsResult: r.state.obsResult, known: { edges: [], steadies: [] }
      });
      const p = v => (v == null ? ' --' : String(Math.round(v)).padStart(3));
      console.log(`  ${adminData.shortDays[record.day]} ${period.short.padEnd(4)} ` +
        `mastery ${p(opens)} -> ${p(r.state.mastery)}   fidelity ${p(carry.fidelity)} -> ${p(r.state.fidelity)}   ` +
        `rapport ${p(carry.rapport)} -> ${p(r.state.rapport)}   bandwidth ${p(r.state.bandwidth)}   ` +
        `missed ${r.missed}   obs ${r.state.obsResult
          ? `${r.state.obsResult.satisfied.length}/${r.state.obsResult.total}${visit.announced ? '*' : ' '}`
          : ' -- '}  admin ${carry.rung ? carry.rung.label : '—'}`);
    }
    record = semester.advanceDay(record, [], { admin: adminData });
  }
  const w = semester.weekSummary(record);
  const p = v => String(Math.round(v)).padStart(3);
  console.log(`  ${'week (means)'.padEnd(8)} mastery ${p(w.means.mastery)}         fidelity ${p(w.means.fidelity)}         ` +
    `rapport ${p(w.means.rapport)}         missed ${w.missed}   ` +
    `visits ${visits}/${CFG.semester.daysPerWeek * PERIODS.length} (* announced)   ` +
    `admin ${record.admin.history.length ? record.admin.history.map(h => `${h.id} from ${adminData.shortDays[(h.day + 1) % CFG.semester.daysPerWeek]}`).join(', ') : 'nothing'}\n`);
  return record;
}
week(STYLES.good);
week(STYLES.wanderer);
