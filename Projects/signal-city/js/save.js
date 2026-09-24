// Signal City: the save. One slot through the site's gvb-save.js, key
// `signal_city_v1`, never to be renamed (locked decision #36). It holds stars
// and best scores per level, the unlock list, and endless's best run (M9);
// nothing mid-run is saved, a level is short enough to replay.
//
// `endless` is the one field added since version 1 shipped. A save from
// before it has none and gets the empty record from `repair`, so the key
// and the version stay as they are.
//
// `migrate` is for version drift; `repair` runs on every load and fills any
// field a hand-edited or truncated save is missing (#37).

import { createSaveSlot } from '../../../assets/js/gvb-save.js';

export const SAVE_KEY = 'signal_city_v1';
export const SAVE_VERSION = 1;

export function fresh() {
  return { levels: {}, unlocks: ['phases'], settings: { sound: true }, lastLevel: null, endless: freshEndless() };
}

// Endless's record: the best run's days survived and its points, the city
// seed it was on, and how many runs have played out a first day (nothing
// is saved mid-day, so a run left before its first day ends is not one).
const freshEndless = () => ({ days: 0, points: 0, seed: null, runs: 0 });
const count = x => Math.max(0, Math.floor(Number(x) || 0));

export function repair(state) {
  const s = state && typeof state === 'object' ? state : {};
  const out = fresh();
  if (s.levels && typeof s.levels === 'object') {
    for (const [id, rec] of Object.entries(s.levels)) {
      if (!rec || typeof rec !== 'object') continue;
      out.levels[id] = {
        stars: Math.max(0, Math.min(3, Number(rec.stars) || 0)),
        best: Math.max(0, Number(rec.best) || 0),
        plays: Math.max(0, Number(rec.plays) || 0),
      };
    }
  }
  if (Array.isArray(s.unlocks)) out.unlocks = Array.from(new Set(['phases', ...s.unlocks.filter(u => typeof u === 'string')]));
  if (s.settings && typeof s.settings === 'object') out.settings = { ...out.settings, ...s.settings };
  if (typeof s.lastLevel === 'string') out.lastLevel = s.lastLevel;
  if (s.endless && typeof s.endless === 'object') {
    const e = s.endless;
    out.endless = { days: count(e.days), points: count(e.points), seed: Number.isFinite(e.seed) ? e.seed : null, runs: count(e.runs) };
  }
  return out;
}

export function migrate(state, from) {
  // version 0 (unversioned) and 1 share a shape; repair covers the gaps
  return state;
}

export function makeSlot(options = {}) {
  return createSaveSlot({
    game: 'signal-city', key: SAVE_KEY, version: SAVE_VERSION,
    defaults: fresh, repair, migrate,
    validate: s => !!s && typeof s === 'object',
    ...options,
  });
}

// Record a finished level: keeps the best of stars and points.
export function recordResult(state, levelId, result) {
  const rec = state.levels[levelId] || { stars: 0, best: 0, plays: 0 };
  rec.plays++;
  rec.stars = Math.max(rec.stars, result.stars);
  rec.best = Math.max(rec.best, result.points);
  state.levels[levelId] = rec;
  state.lastLevel = levelId;
  return rec;
}

// Endless (M9): a run's days survived and points so far, recorded after
// every day it plays, so a run left halfway still counts what it survived.
// The best is the most days, and on a tie the most points. `first` is the
// run's first day: it counts one run. Returns whether this is a new best.
export function recordEndless(state, run, { first = false } = {}) {
  const e = state.endless || (state.endless = freshEndless());
  if (first) e.runs++;
  const better = run.days > e.days || (run.days === e.days && run.points > e.points);
  if (better) { e.days = run.days; e.points = run.points; e.seed = run.seed; }
  return better;
}

export function totalStars(state) {
  let n = 0;
  for (const rec of Object.values(state.levels)) n += rec.stars;
  return n;
}
