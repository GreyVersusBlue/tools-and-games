// Balance harness. Runs whole 47-minute periods headlessly with three crude
// play styles and prints where the meters land. Not an assertion suite — a
// sanity check you run after touching src/config.js or data/lesson.json.
//
//   cd tests && node balance.mjs
import fs from 'fs';
import { CFG } from '../src/config.js';
import { createState, applyEffects } from '../src/state.js';
import { createLesson } from '../src/systems/lesson.js';
import { createRoomTemp } from '../src/systems/roomtemp.js';
import { createChart } from '../src/systems/chart.js';
import { createObservation } from '../src/systems/observation.js';
import { tickMeters } from '../src/systems/meters.js';
import { periodFor, periodIds } from '../src/periods.js';
import { contentFiles } from '../src/loader.js';

const D = f => JSON.parse(fs.readFileSync(`../data/${f}.json`, 'utf8'));
const lData = D('lesson'), sData = D('students'), tData = D('tells'), eData = D('events');
const roomData = D('room'), seatData = D('seating'), obsData = D('observation');

// Phase 1: the day comes out of data/periods.json, so a period added there
// shows up in this table without an edit in here.
const pData = D('periods');
const bundle = { room: roomData, students: sData, tells: tData, lesson: lData,
  seating: seatData, periods: pData };
for (const name of contentFiles(pData)) if (!(name in bundle)) bundle[name] = D(name);
const PERIODS = periodIds(bundle).map(id => periodFor(id, bundle));

// T7: a fake DOM just big enough for createObservation to touch without
// throwing — the balance harness has no HUD to actually draw.
const fakeClassList = () => ({ add() {}, remove() {}, contains: () => false });
const mkObsDom = () => ({ pa: { classList: fakeClassList() }, paTitle: {}, paTxt: {} });

const DT = 1 / 60;

// T6: whichever period it is handed — same shape either way, because since
// Phase 1 every period is a row of the same shape read out of periods.json.
// `opts.bandwidth` is the day's carried pool; null means a full tank.
function run(name, style, chartSeats = null, period = PERIODS[0], opts = {}) {
  const content = { roster: period.roster, schedule: period.schedule, lesson: period.lessonData };
  // T4: everything starts at the chart. The schedule this room produces is not
  // the authored schedule — it is what the authored schedule becomes once you
  // decide who is sitting next to whom.
  const chart = createChart({
    seatGrid: period.seatGrid, room: roomData, roster: content.roster,
    tellTypes: tData.types, rules: seatData.rules,
    plan: seatData.plan.furniture, saved: chartSeats
  });
  const students = chart.apply(content.roster.map((r, i) => ({ ...r, seat: i })));
  const plan = chart.resolveSchedule(content.schedule);
  chart.apply(students, plan);

  // A live tell schedule, resolved (or not) according to the style.
  const tells = plan.rows.map((row, i) => ({
    id: i, type: row.type, seat: row.seat, seat2: row.seat2,
    at: CFG.periodSeconds - row.atMinute * 60, life: row.life,
    born: null, dead: false, resolved: false
  }));
  const tellSystem = { defs: tData.types, tells, kill(t) { t.dead = true; }, describe: () => '' };

  const state = createState();
  // Phase 1: Bandwidth does not regenerate during the school day. Second and
  // third period start with whatever the last bell left, plus the hallway.
  if (opts.bandwidth != null) state.bandwidth = Math.max(0, Math.min(100, opts.bandwidth));
  const lesson = createLesson({ data: content.lesson, students, tellSystem, toast: () => {}, rand: () => 0.5 });
  const temp = createRoomTemp({ data: eData, students, tellSystem, toast: () => {} });
  const observation = createObservation({ data: obsData, dom: mkObsDom(), toast: () => {} });
  let rubricPerformed = false;

  let missed = 0;
  while (state.t > 0) {
    state.t -= DT * CFG.timeScale;

    for (const t of tells) {
      if (t.born === null && state.t <= t.at) t.born = state.t;
      if (t.born !== null && !t.dead && (t.born - state.t) > t.life) {
        if (!t.resolved) { missed++; state.masteryPending += CFG.missedMastery; state.restless += CFG.missedRestless; }
        t.dead = true;
      }
      // the style decides whether it gets caught, and how fast
      if (t.born !== null && !t.dead && !t.resolved && style.catchAfter != null &&
          (t.born - state.t) > style.catchAfter) {
        t.resolved = true; t.dead = true;
        applyEffects(state, { bandwidth: -2, rapport: 1, restless: -5 });
      }
    }

    state.withitness = style.scan(state);
    if (state.withitness) {
      state.bandwidth -= CFG.bandwidthDrainPerSec * DT;
      state.hyper += CFG.hyperGainPerSec * DT;
      state.restless += CFG.scanRestlessPerSec * DT;
      state.withitnessSeconds += DT;
    } else {
      state.hyper -= CFG.hyperDecayPerSec * DT;
    }
    state.hyper = Math.max(0, Math.min(100, state.hyper));

    const teaching = style.teaching(state);
    const live = tells.filter(t => t.born !== null && !t.dead && !t.resolved).length;
    tickMeters(state, DT, teaching, live);
    lesson.tick(state, DT, { teaching });
    observation.tick(state, DT);

    // T7: she always visits. Whether you play to the rubric is the style's
    // call — "cram all five into eleven artificial minutes" is a crude but
    // honest stand-in for actually timing four keypresses and a hold.
    if (style.performRubric && observation.active(state) && !rubricPerformed) {
      rubricPerformed = true;
      for (const key of ['objective', 'question', 'wait', 'discourse']) observation.satisfy(state, key);
    }

    // advance beats when they are done; check and reteach on the style's rhythm
    const beat = lesson.current(state);
    if (!state.onFiller && state.beatProgress > beat.seconds * style.advanceAt) lesson.advance(state);
    if (style.checkEvery && state.beatProgress > 0 &&
        state.checksThisBeat < style.checkEvery &&
        state.beatProgress > beat.seconds * (0.35 + state.checksThisBeat * 0.4)) {
      if (lesson.check(state).ok && observation.active(state)) observation.satisfy(state, 'check');
      if (style.reteach && state.mastery < 60) lesson.reteach(state);
    }
    if (style.temp && Math.floor(state.t) % 30 === 0) temp.read(state);
  }

  const p = v => String(Math.round(v)).padStart(3);
  const obs = state.obsResult ? `  obs ${state.obsResult.satisfied.length}/${state.obsResult.total}` : '';
  console.log(
    `${name.padEnd(22)} mastery ${p(state.mastery)}  fidelity ${p(state.fidelity)}  ` +
    `rapport ${p(state.rapport)}  bandwidth ${p(state.bandwidth)}  restless ${p(state.restless)}  ` +
    `beats ${state.beatsDelivered}/${content.lesson.beats.length}  checks ${String(state.checks).padStart(2)}  ` +
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
  return { state, missed, beats: content.lesson.beats.length };
}

console.log(`\nperiod: ${CFG.periodSeconds}s game / ${Math.round(CFG.periodSeconds / CFG.timeScale)}s real`);
console.log(`lesson: ${lData.beats.reduce((a, b) => a + b.seconds, 0)}s of authored beats\n`);

run('ideal (never scans)', {
  teaching: () => true, scan: () => false, advanceAt: 1.0, checkEvery: 2, catchAfter: null
});
run('the good teacher', {
  teaching: s => !s.withitness, scan: s => Math.floor(s.t / 45) % 4 === 0 && s.bandwidth > 5,
  advanceAt: 1.0, checkEvery: 2, reteach: true, catchAfter: 30, temp: true
});
// T7: same teacher, same everything, except she also plays to the rubric the
// moment AP Reyes walks in. If mastery/fidelity land identically to the row
// above, the Observation is decoration and something is wrong.
run('the good teacher, plays the rubric', {
  teaching: s => !s.withitness, scan: s => Math.floor(s.t / 45) % 4 === 0 && s.bandwidth > 5,
  advanceAt: 1.0, checkEvery: 2, reteach: true, catchAfter: 30, temp: true, performRubric: true
});
run('the hypervigilant', {
  teaching: s => !s.withitness, scan: s => s.bandwidth > 3 && Math.floor(s.t / 20) % 2 === 0,
  advanceAt: 0.5, checkEvery: 0, catchAfter: 12
});
run('the wanderer', {
  teaching: s => Math.floor(s.t / 60) % 2 === 0, scan: () => false,
  advanceAt: 1.3, checkEvery: 1, catchAfter: 40
});
// The chart matters most to a teacher who is not catching everything, so the
// comparison below uses one who never looks up: whatever the seating produces,
// runs its course.
const HEADS_DOWN = {
  teaching: () => true, scan: () => false, advanceAt: 1.0, checkEvery: 2, catchAfter: null
};

const NEVER_CHECKS = {
  teaching: () => true, scan: () => false, advanceAt: 1.0, checkEvery: 0, catchAfter: null
};
run('never checks, never looks', NEVER_CHECKS);

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
// authored 7th period lands in this table on its own.
const IDEAL = { teaching: () => true, scan: () => false, advanceAt: 1.0, checkEvery: 2, catchAfter: null };
const GOOD = {
  teaching: s => !s.withitness, scan: s => Math.floor(s.t / 45) % 4 === 0 && s.bandwidth > 5,
  advanceAt: 1.0, checkEvery: 2, reteach: true, catchAfter: 30, temp: true
};

for (const period of PERIODS.slice(1)) {
  const beatSeconds = period.lessonData.beats.reduce((a, b) => a + b.seconds, 0);
  console.log(`${period.short} period lesson: ${beatSeconds}s of authored beats, ` +
    `${period.schedule.length} scheduled tells (vs 4th's ${PERIODS[0].schedule.length})\n`);
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
