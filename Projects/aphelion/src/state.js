// Central game state + persistence. Everything serializable lives here.
//
// Persistence goes through the shared assets/js/gvb-save.js slot rather than
// touching localStorage directly (the Fourth Quarter is the worked example —
// see gvb-site-handoff-v7.md §1). `mode` is the one field on `state` that
// never reaches the slot: it's transient, and every load resets it to
// 'interior' regardless of what a save says.
//
// Relative import, not "/assets/js/gvb-save.js": test/smoke-state.mjs imports
// this module under plain Node, which cannot resolve a leading slash.
import { createSaveSlot } from '../../../assets/js/gvb-save.js';

export const SAVE_KEY = 'aphelion-save-v1';
export const SAVE_VERSION = 1;

function freshState() {
  return {
    day: 1,
    hour: 8,                 // in-game hour, fractional
    systems: {},              // id -> level 0..100
    plant: { water: 80, stage: 0, harvests: 0 },
    parts: 0,
    curios: [],
    unlockedLogs: [],         // log ids
    unlockedDiscoveries: [],  // discovery ids
    scannedPois: [],          // poi ids scanned today (reset on sleep)
    repairStreak: 0,
  };
}

/** The gate on garbage: the fields nothing downstream can work without.
 *  `tick()` dereferences `state.plant.water` and iterates `state.systems`
 *  on every frame with no guard of its own — either being absent crashes the
 *  render loop, not just a feature. Everything else (arrays, counters) is a
 *  gap `repairState` fills instead. */
export function validateState(s) {
  return !!s && typeof s.day === 'number'
    && !!s.plant && typeof s.plant === 'object'
    && !!s.systems && typeof s.systems === 'object';
}

/** Fill in what a save can be missing. Runs on every accepted load —
 *  localStorage, an imported file, a save this build just wrote — not only
 *  when the version number moves (locked decision #37). */
export function repairState(s) {
  if (typeof s.hour !== 'number') s.hour = 8;
  if (typeof s.plant.water !== 'number') s.plant.water = 80;
  if (typeof s.plant.stage !== 'number') s.plant.stage = 0;
  if (typeof s.plant.harvests !== 'number') s.plant.harvests = 0;
  if (typeof s.parts !== 'number') s.parts = 0;
  if (!Array.isArray(s.curios)) s.curios = [];
  if (!Array.isArray(s.unlockedLogs)) s.unlockedLogs = [];
  if (!Array.isArray(s.unlockedDiscoveries)) s.unlockedDiscoveries = [];
  if (!Array.isArray(s.scannedPois)) s.scannedPois = [];
  if (typeof s.repairStreak !== 'number') s.repairStreak = 0;
  return s;
}

// One slot per storage, cached — mirrors campaignSlot() in
// Projects/fourth-quarter/js/campaign.js. Tests pass a stub; the game passes
// nothing and gets the browser slot, letting gvb-save's defaultStorage() do
// the localStorage probing (reading that property throws outright when a
// browser blocks storage, which the module's memory fallback exists to
// survive — the old bare try/catch here survived it by accident).
const slots = new WeakMap();
let browserSlot = null;

function buildSlot(storage) {
  return createSaveSlot({
    game: 'aphelion',
    key: SAVE_KEY,
    version: SAVE_VERSION,
    storage,
    validate: validateState,
    repair: repairState,
    defaults: freshState,
  });
}

export function aphelionSlot(storage) {
  if (!storage) return (browserSlot ||= buildSlot(undefined));
  if (!slots.has(storage)) slots.set(storage, buildSlot(storage));
  return slots.get(storage);
}

export const state = { ...freshState(), mode: 'interior' };

export function initSystems(defs) {
  for (const s of defs) {
    if (state.systems[s.id] === undefined) state.systems[s.id] = 100;
  }
}

export function save(storage) {
  const { mode, ...rest } = state;
  return aphelionSlot(storage).save(rest);
}

export function load(storage) {
  const data = aphelionSlot(storage).load();
  if (!data) return false;
  Object.assign(state, data, { mode: 'interior' });
  return true;
}

export function resetSave(storage) {
  const fresh = aphelionSlot(storage).reset();
  Object.assign(state, fresh, { mode: 'interior' });
  return fresh;
}
