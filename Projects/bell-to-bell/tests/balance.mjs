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
import { tickMeters } from '../src/systems/meters.js';

const D = f => JSON.parse(fs.readFileSync(`../data/${f}.json`, 'utf8'));
const lData = D('lesson'), sData = D('students'), tData = D('tells'), eData = D('events');
const roomData = D('room'), seatData = D('seating'), p5Data = D('period5');

const DT = 1 / 60;

// T6: period4's content, or period5's — same shape either way, so `run` can
// simulate whichever one it's handed.
const P4_CONTENT = { roster: sData.roster, schedule: tData.schedule, lesson: lData };
const P5_CONTENT = {
  roster: p5Data.roster, schedule: p5Data.schedule,
  lesson: { ...p5Data.lesson, copy: lData.copy }
};

function run(name, style, chartSeats = null, content = P4_CONTENT) {
  // T4: everything starts at the chart. The schedule this room produces is not
  // the authored schedule — it is what the authored schedule becomes once you
  // decide who is sitting next to whom.
  const chart = createChart({
    seatGrid: sData.seatGrid, room: roomData, roster: content.roster,
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
  const lesson = createLesson({ data: content.lesson, students, tellSystem, toast: () => {}, rand: () => 0.5 });
  const temp = createRoomTemp({ data: eData, students, tellSystem, toast: () => {} });

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

    // advance beats when they are done; check and reteach on the style's rhythm
    const beat = lesson.current(state);
    if (!state.onFiller && state.beatProgress > beat.seconds * style.advanceAt) lesson.advance(state);
    if (style.checkEvery && state.beatProgress > 0 &&
        state.checksThisBeat < style.checkEvery &&
        state.beatProgress > beat.seconds * (0.35 + state.checksThisBeat * 0.4)) {
      lesson.check(state);
      if (style.reteach && state.mastery < 60) lesson.reteach(state);
    }
    if (style.temp && Math.floor(state.t) % 30 === 0) temp.read(state);
  }

  const p = v => String(Math.round(v)).padStart(3);
  console.log(
    `${name.padEnd(22)} mastery ${p(state.mastery)}  fidelity ${p(state.fidelity)}  ` +
    `rapport ${p(state.rapport)}  bandwidth ${p(state.bandwidth)}  restless ${p(state.restless)}  ` +
    `beats ${state.beatsDelivered}/${content.lesson.beats.length}  checks ${String(state.checks).padStart(2)}  ` +
    `missed ${missed}  scan ${Math.round(state.withitnessSeconds)}s`
  );
  if (plan.suppressed.length || plan.separated.length) {
    console.log(`   chart: ${plan.suppressed.length} never happened, ` +
      `${plan.separated.length} found another way`);
  }
  if (process.env.SPREAD) {
    console.log('   ' + [...students].sort((a, b) => b.comp - a.comp)
      .map(s => `${s.name} ${Math.round(s.comp * 100)}`).join('  '));
  }
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

run('never checks, never looks', {
  teaching: () => true, scan: () => false, advanceAt: 1.0, checkEvery: 0, catchAfter: null
});

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

// T6: a different roster, a different (busier) tell schedule, a different
// lesson — same room, same rulebook, same two representative styles.
console.log(`5th period lesson: ${P5_CONTENT.lesson.beats.reduce((a, b) => a + b.seconds, 0)}s of authored beats, ` +
  `${p5Data.schedule.length} scheduled tells (vs 4th's ${tData.schedule.length})\n`);
run('5th: ideal (never scans)', {
  teaching: () => true, scan: () => false, advanceAt: 1.0, checkEvery: 2, catchAfter: null
}, null, P5_CONTENT);
run('5th: the good teacher', {
  teaching: s => !s.withitness, scan: s => Math.floor(s.t / 45) % 4 === 0 && s.bandwidth > 5,
  advanceAt: 1.0, checkEvery: 2, reteach: true, catchAfter: 30, temp: true
}, null, P5_CONTENT);
run('5th: never checks, never looks', {
  teaching: () => true, scan: () => false, advanceAt: 1.0, checkEvery: 0, catchAfter: null
}, null, P5_CONTENT);
console.log('');
