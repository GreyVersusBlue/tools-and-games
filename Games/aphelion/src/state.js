// Central game state + persistence. Everything serializable lives here.

const SAVE_KEY = 'aphelion-save-v1';

export const state = {
  day: 1,
  hour: 8,          // in-game hour, fractional
  systems: {},      // id -> level 0..100
  plant: { water: 80, stage: 0, harvests: 0 },
  parts: 0,
  curios: [],
  unlockedLogs: [],       // log ids
  unlockedDiscoveries: [],// discovery ids
  scannedPois: [],        // poi ids scanned today (reset on sleep)
  mode: 'interior',       // 'interior' | 'eva'
  repairStreak: 0,
};

export function initSystems(defs) {
  for (const s of defs) {
    if (state.systems[s.id] === undefined) state.systems[s.id] = 100;
  }
}

export function save() {
  try {
    const { mode, ...rest } = state; // don't persist transient mode
    localStorage.setItem(SAVE_KEY, JSON.stringify(rest));
  } catch (e) { /* storage unavailable — play session-only */ }
}

export function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    Object.assign(state, data, { mode: 'interior' });
    return true;
  } catch (e) { return false; }
}

export function resetSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
}
