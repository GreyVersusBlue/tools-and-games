// The only thing in this project that survives a page reload: your chart, and
// what the room taught you. Deliberately tiny, deliberately optional — if the
// browser refuses (private window, file://, a locked-down district laptop) the
// game keeps working and simply forgets between periods.
export const PREFIX = 'belltobell.';
const memory = new Map();

let store = null;
try {
  const probe = PREFIX + 'probe';
  localStorage.setItem(probe, '1');
  localStorage.removeItem(probe);
  store = localStorage;
} catch { store = null; }

// One interface over "real storage" and "we are pretending", so nothing below
// has to keep asking which one it got.
const io = store || {
  getItem: k => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => { memory.set(k, v); },
  removeItem: k => { memory.delete(k); }
};

export const persistenceAvailable = () => store !== null;

// Phase 1. A period-scoped key: slot('p5', 'chart') -> 'p5.chart'. Before this
// there were exactly two classes and three ternaries picking between six flat
// key names, half of which were the other half with a 5 typed on the end.
// `furniture` is deliberately not in here: where the cabinet sits is a fact
// about the room, not about whoever is sitting in it.
export const slot = (periodId, key) => `${periodId}.${key}`;

// Day-scoped rather than period-scoped: what the whole school day carries
// between bells, as opposed to what one class owns.
export const dayKey = key => `day.${key}`;

// The six flat keys that scheme replaced, and where each one now lives.
export const LEGACY_KEYS = {
  chart: 'p4.chart',
  known: 'p4.known',
  rapportBase: 'p4.rapportBase',
  chart5: 'p5.chart',
  known5: 'p5.known',
  rapportBase5: 'p5.rapportBase'
};

// Read-time, once, and idempotent — the site's rule is never to change a
// storage key, and this changes six of them, which is only allowed because
// nobody mid-use is abandoned by it. Run it against a fresh store and nothing
// happens. Run it twice and the second pass finds nothing left to move. Run it
// against a store somebody half-migrated and the namespaced value wins, because
// a namespaced value can only have been written after the migration ran.
//
// `target` is anything with localStorage's three methods; the game hands it the
// real store, the suite hands it a Map. Returns how many keys it moved.
export function migrateLegacyKeys(target) {
  let moved = 0;
  for (const [from, to] of Object.entries(LEGACY_KEYS)) {
    const raw = target.getItem(PREFIX + from);
    if (raw == null) continue;                       // a stored JSON null is "null", not null
    if (target.getItem(PREFIX + to) == null) {
      target.setItem(PREFIX + to, raw);
      moved++;
    }
    target.removeItem(PREFIX + from);
  }
  return moved;
}

// A store that throws halfway through is not worth dying over: the game's whole
// posture on persistence is that losing it costs you a seating chart, not a run.
try { migrateLegacyKeys(io); } catch { /* fine */ }

export function load(key, fallback = null) {
  try {
    const raw = io.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}

export function save(key, value) {
  try {
    io.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch { return false; }
}

export function clear(key) {
  try { io.removeItem(PREFIX + key); } catch { /* fine */ }
}
