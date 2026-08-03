// The only thing in this project that survives a page reload: your chart, and
// what the room taught you. Deliberately tiny, deliberately optional — if the
// browser refuses (private window, file://, a locked-down district laptop) the
// game keeps working and simply forgets between periods.
const PREFIX = 'belltobell.';
const memory = new Map();

let store = null;
try {
  const probe = PREFIX + 'probe';
  localStorage.setItem(probe, '1');
  localStorage.removeItem(probe);
  store = localStorage;
} catch { store = null; }

export const persistenceAvailable = () => store !== null;

export function load(key, fallback = null) {
  const k = PREFIX + key;
  try {
    const raw = store ? store.getItem(k) : memory.get(k);
    return raw == null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}

export function save(key, value) {
  const k = PREFIX + key, raw = JSON.stringify(value);
  try {
    if (store) store.setItem(k, raw); else memory.set(k, raw);
    return true;
  } catch { return false; }
}

export function clear(key) {
  const k = PREFIX + key;
  try { if (store) store.removeItem(k); else memory.delete(k); } catch { /* fine */ }
}
