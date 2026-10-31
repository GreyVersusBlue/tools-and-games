// What the staff browser keeps on a reader's device, per school:
//
//   sv2staff:<schoolId>:me     who the reader is (a teacher id)
//   sv2staff:<schoolId>:notes  the reader's own notes
//   sv2staff:<schoolId>:day    the day type chosen by hand, when the calendar
//                              does not say (or the file has none)
//   sv2staff:<schoolId>:key    the key the passcode made, so it is asked once
//   sv2staff:<schoolId>:seen   the newest publish time opened here
//   sv2staff:<schoolId>:dayOn  the reader's "Not right?" answers as JSON:
//                              { just, follow }, each null or { date,
//                              dayTypeId, bellsId, at } (SV2-81, SV2-81b); a
//                              follow answer also holds `seenFile`, the
//                              publish time of the file open when it was
//                              given (SV2-81c; the later of that and `seen`
//                              when it was given, SV2-81d)
//   sv2staff:<schoolId>:bells  the bell schedule chosen by hand beside `day`
//                              (SV2-81)
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
  // what a key held when this page first wrote to it
  const before = new Map();
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
    // What `name` held before this page first changed it: the value on
    // opening, which a later write to the key (the shell moves `seen` on as it
    // opens a file) does not take away. The key's own value until it is written.
    earlier(name) {
      return before.has(name) ? before.get(name) : this.get(name);
    },
    set(name, value) {
      if (!before.has(name)) before.set(name, this.get(name));
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
      if (!before.has(name)) before.set(name, this.get(name));
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
