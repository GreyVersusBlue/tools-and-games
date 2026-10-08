// What the staff browser keeps on a reader's device, per school:
//
//   sv2staff:<schoolId>:me     who the reader is (a teacher id)
//   sv2staff:<schoolId>:notes  the reader's own notes
//   sv2staff:<schoolId>:day    the day type chosen by hand
//   sv2staff:<schoolId>:key    the key the passcode made, so it is asked once
//   sv2staff:<schoolId>:seen   the newest publish time opened here
//
// These names never change. Every read and write goes through this one
// guard. Where the browser gives no storage, or refuses a write (a file
// opened from some mail apps, private browsing, a full device), the value is
// kept in memory for as long as the page is open, and `onFallback` is called
// once so the reader can be told.

export const STORAGE_PREFIX = 'sv2staff:';
export const NOT_KEPT_SENTENCE = 'This browser does not keep settings for files opened this way.';

// openStorage(schoolId, getBackend, onFallback). `getBackend` returns the
// device's storage (it may throw: asking is itself refused in some places).
export function openStorage(schoolId, getBackend, onFallback) {
  const memory = new Map();
  let backend = null;
  let told = false;
  try {
    backend = getBackend();
    if (!backend || typeof backend.getItem !== 'function') backend = null;
  } catch (error) {
    backend = null;
  }
  const fall = () => {
    if (told) return;
    told = true;
    if (typeof onFallback === 'function') onFallback();
  };
  const full = (name) => STORAGE_PREFIX + schoolId + ':' + name;
  return {
    key: full,
    get kept() {
      return backend !== null && !told;
    },
    get(name) {
      if (memory.has(name)) return memory.get(name);
      if (backend === null) return null;
      try {
        const value = backend.getItem(full(name));
        return typeof value === 'string' ? value : null;
      } catch (error) {
        return null;
      }
    },
    set(name, value) {
      const text = String(value);
      if (backend !== null) {
        try {
          backend.setItem(full(name), text);
          if (backend.getItem(full(name)) === text) {
            memory.delete(name);
            return true;
          }
        } catch (error) {
          // kept in memory below
        }
      }
      memory.set(name, text);
      fall();
      return false;
    },
    remove(name) {
      memory.delete(name);
      if (backend === null) return;
      try {
        backend.removeItem(full(name));
      } catch (error) {
        // nothing was kept, so nothing is left
      }
    },
  };
}
