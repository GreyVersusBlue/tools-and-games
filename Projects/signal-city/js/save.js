// Signal City: the save. One slot through the site's gvb-save.js, key
// `signal_city_v1`, never to be renamed (locked decision #36). It holds stars
// and best scores per level and the unlock list; nothing mid-run is saved,
// a level is short enough to replay.
//
// `migrate` is for version drift; `repair` runs on every load and fills any
// field a hand-edited or truncated save is missing (#37).

import { createSaveSlot } from '../../../assets/js/gvb-save.js';

export const SAVE_KEY = 'signal_city_v1';
export const SAVE_VERSION = 1;

export function fresh() {
  return { levels: {}, unlocks: ['phases'], settings: { sound: true }, lastLevel: null };
}

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

export function totalStars(state) {
  let n = 0;
  for (const rec of Object.values(state.levels)) n += rec.stars;
  return n;
}
