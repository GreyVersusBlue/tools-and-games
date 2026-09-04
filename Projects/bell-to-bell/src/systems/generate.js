import { generateRoster } from './roster.js';
import { generateSchedule } from './scheduler.js';
import { mixSeed } from './rng.js';
import { runPeriod, STYLES } from './simulate.js';

// Phase 2 — A CLASS, HELD TO A BAND.
//
// The roster and the schedule each keep their own structural promises. This is
// the promise neither of them can make alone: that the period they add up to
// is playable. Two crude teachers — the one who never scans and the one who
// never checks — play the whole thing headlessly, and if either lands outside
// data/generation.json's bands on mastery, restlessness or missed tells, the
// schedule is thrown away and drawn again from the next attempt's seed. The
// roster is never re-rolled here: it is the class, and the class has to be
// the same class tomorrow. A roster the schedule cannot be made to fit inside
// the cap is a loud error, not a quiet easy period.

const bandStyles = bands => Object.keys(bands).filter(k => STYLES[k]);

// Which promises a set of results breaks. Empty means none.
export function bandProblems(results, bands) {
  const out = [];
  for (const key of bandStyles(bands)) {
    const r = results[key];
    if (!r) { out.push(`${key}: not simulated`); continue; }
    for (const [meter, [lo, hi]] of Object.entries(bands[key])) {
      const v = r[meter];
      if (!Number.isFinite(v)) { out.push(`${key}: no ${meter}`); continue; }
      if (v < lo || v > hi) out.push(`${key}: ${meter} ${Math.round(v)} outside ${lo}..${hi}`);
    }
  }
  return out;
}

// Play one period under each banded style. `period` is the shape periodFor()
// returns; the results are the three numbers each band reads.
export function simulateBands({ period, data, bands }) {
  const results = {};
  for (const key of bandStyles(bands)) {
    const r = runPeriod({ period, data, style: STYLES[key] });
    results[key] = { mastery: r.state.mastery, restless: r.state.restless, missed: r.missed };
  }
  return results;
}

export function generateClass({ seed, day = 0, data, lessonData, seatGrid }) {
  const gen = data.generation;
  const bands = gen.bands;
  const roster = generateRoster(seed, gen);
  const deps = { tellTypes: data.tells.types, seatGrid, rules: data.seating.rules, gen };
  const sim = { room: data.room, tells: data.tells, seating: data.seating,
    events: data.events, observation: data.observation };

  let last = [];
  for (let attempt = 0; attempt < bands.rerollCap; attempt++) {
    const schedule = generateSchedule(mixSeed(seed, day, attempt), roster, deps);
    const period = { roster, schedule, lessonData, seatGrid };
    const results = simulateBands({ period, data: sim, bands });
    last = bandProblems(results, bands);
    if (!last.length) return { roster, schedule, seed, day, rerolls: attempt, results };
  }
  throw new Error(`Class seed ${seed}, day ${day}: no schedule landed inside the bands in ` +
    `${bands.rerollCap} attempts. Last problems: ${last.join('; ')}`);
}
