import { CFG } from '../config.js';
import { createState, applyEffects } from '../state.js';
import { createLesson } from './lesson.js';
import { createRoomTemp } from './roomtemp.js';
import { createChart } from './chart.js';
import { createObservation } from './observation.js';
import { tickMeters } from './meters.js';

// Phase 2 — THE PERIOD, HEADLESS.
//
// This used to be `run()` inside tests/balance.mjs: a 47-minute period played
// by a crude style — scan on this rhythm, check on that one, catch a tell so
// many seconds after it appears — with no renderer and no DOM, in about ten
// milliseconds. It moved here because the class generator needs the same
// thing at run time: a generated schedule is accepted only after two of these
// styles have played it and the meters landed inside data/generation.json's
// bands. One runner, two callers, so the balance table and the acceptance
// check cannot drift apart.
//
// Three-free and DOM-free. Deterministic: the lesson's start spread is pinned
// at the midpoint and nothing in here rolls a die, so the same period under
// the same style lands on the same numbers every time. That is what lets a
// band be a promise rather than a mood.

const DT = 1 / 60;

// The fake DOM createObservation needs to touch without throwing: there is
// no HUD in here to draw the Admin Proximity Alert on.
const fakeClassList = () => ({ add() {}, remove() {}, contains: () => false });
const mkObsDom = () => ({ pa: { classList: fakeClassList() }, paTitle: {}, paTxt: {} });

// The play styles. Each is a handful of policies the loop asks every tick.
//   teaching(state)   — standing in the front strip this tick
//   scan(state)       — holding SHIFT this tick
//   advanceAt         — advance a beat at this multiple of its natural length
//   checkEvery        — checks per beat (0 never checks)
//   reteach           — reteach after a check while mastery < 60
//   catchAfter        — seconds after a tell appears before it gets handled (null: never)
//   temp              — reads Room Temp every 30 game seconds
//   performRubric     — plays to the rubric the moment the AP walks in
export const STYLES = {
  ideal: {
    label: 'ideal (never scans)',
    teaching: () => true, scan: () => false, advanceAt: 1.0, checkEvery: 2, catchAfter: null
  },
  good: {
    label: 'the good teacher',
    teaching: s => !s.withitness, scan: s => Math.floor(s.t / 45) % 4 === 0 && s.bandwidth > 5,
    advanceAt: 1.0, checkEvery: 2, reteach: true, catchAfter: 30, temp: true
  },
  goodRubric: {
    label: 'the good teacher, plays the rubric',
    teaching: s => !s.withitness, scan: s => Math.floor(s.t / 45) % 4 === 0 && s.bandwidth > 5,
    advanceAt: 1.0, checkEvery: 2, reteach: true, catchAfter: 30, temp: true, performRubric: true
  },
  hypervigilant: {
    label: 'the hypervigilant',
    teaching: s => !s.withitness, scan: s => s.bandwidth > 3 && Math.floor(s.t / 20) % 2 === 0,
    advanceAt: 0.5, checkEvery: 0, catchAfter: 12
  },
  wanderer: {
    label: 'the wanderer',
    teaching: s => Math.floor(s.t / 60) % 2 === 0, scan: () => false,
    advanceAt: 1.3, checkEvery: 1, catchAfter: 40
  },
  neverChecks: {
    label: 'never checks, never looks',
    teaching: () => true, scan: () => false, advanceAt: 1.0, checkEvery: 0, catchAfter: null
  }
};

// One period, start to bell.
//
//   period   { roster, schedule, lessonData, seatGrid } — what periodFor() hands back
//   data     { room, tells, seating, events, observation }
//   style    one of STYLES, or anything with the same shape
//   opts.chartSeats   a saved seatOf array; null is the August chart
//   opts.bandwidth    the day's carried pool; null is a full tank (Phase 1)
//   opts.startComp    twelve comprehension values to walk in with; null starts
//                     from CFG.lesson.startComprehension (Phase 3)
//   opts.rapport / opts.fidelity   what the class walks in with (Phase 3)
//   opts.obsWindowScale            the Observation's window, scaled (Phase 3)
//   opts.effects                   an effect bag applied at the bell, the way
//                                  main.js applies admin's rung (Phase 3)
//
// Returns { state, missed, students, plan } — the students carry their final
// comprehension, which is what the semester record (Phase 3) reads.
export function runPeriod({ period, data, style, opts = {} }) {
  const chart = createChart({
    seatGrid: period.seatGrid, room: data.room, roster: period.roster,
    tellTypes: data.tells.types, rules: data.seating.rules,
    plan: data.seating.plan.furniture, saved: opts.chartSeats ?? null
  });
  const students = chart.apply(period.roster.map((r, i) => ({ ...r, seat: i })));
  const plan = chart.resolveSchedule(period.schedule);
  chart.apply(students, plan);

  const tells = plan.rows.map((row, i) => ({
    id: i, type: row.type, seat: row.seat, seat2: row.seat2,
    at: CFG.periodSeconds - row.atMinute * 60, life: row.life,
    born: null, dead: false, resolved: false
  }));
  const tellSystem = { defs: data.tells.types, tells, kill(t) { t.dead = true; }, describe: () => '' };

  const state = createState();
  if (opts.bandwidth != null) state.bandwidth = Math.max(0, Math.min(100, opts.bandwidth));
  if (opts.rapport != null) state.rapport = Math.max(0, Math.min(100, opts.rapport));
  if (opts.fidelity != null) state.fidelity = Math.max(0, Math.min(100, opts.fidelity));
  if (opts.effects) applyEffects(state, opts.effects);

  const lesson = createLesson({
    data: period.lessonData, students, tellSystem, toast: () => {}, rand: () => 0.5,
    startComp: opts.startComp ?? null
  });
  const temp = createRoomTemp({ data: data.events, students, tellSystem, toast: () => {} });
  const observation = createObservation({
    data: data.observation, dom: mkObsDom(), toast: () => {},
    windowScale: opts.obsWindowScale ?? 1
  });
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

    if (style.performRubric && observation.active(state) && !rubricPerformed) {
      rubricPerformed = true;
      for (const key of ['objective', 'question', 'wait', 'discourse']) observation.satisfy(state, key);
    }

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
  state.missed = missed;
  return { state, missed, students, plan, beats: period.lessonData.beats.length };
}
