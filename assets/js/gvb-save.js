// gvb-save.js — one save system for every sim on greyversusblue.com.
//
// Generalized from the Fourth Quarter's campaign save: a namespaced key, a
// schema version, a migration hook, and a validator that refuses to load
// garbage instead of crashing the game on boot. Adds the piece nothing had —
// export to a file and import it back, so a save survives a cleared browser.
//
// v2 (2026-09-16) adds three things on top, all additive; a v1 caller sees no
// change. `slot.usage()` and `slot.lastError` say how big a save is and why a
// write failed. `createNamespace()` groups many keys under one prefix with one
// bundle export. `createAsyncSaveSlot()` and `idbStorage()` are the IndexedDB
// tier: the same key and the same bytes, in a store measured in hundreds of
// megabytes rather than five. See README.md, "v2".
//
// ES module, no dependencies. The pure parts (serialize / deserialize /
// normalize) run in plain Node, which is how the smoke test exercises them.
//
//   import { createSaveSlot } from "/assets/js/gvb-save.js";
//
//   const slot = createSaveSlot({
//     game: "fourth-quarter",
//     key: "fq3d-save",
//     version: 2,
//     validate: c => c && typeof c.day === "number" && Array.isArray(c.staff),
//     migrate: (c, from) => { if (from < 2) c.upgrades ??= []; return c; },
//     defaults: { day: 1, staff: [] }
//   });
//
//   let state = slot.load() ?? slot.fresh();
//   slot.save(state);
//
// A module that also runs under Node — a game's own pure logic file with a
// smoke test, which is the case in the first real adopter — should import this
// by RELATIVE path (`../../../assets/js/gvb-save.js`) rather than the site-
// absolute one above. Node can't resolve a leading slash, and the relative form
// works identically in the browser.
//
// Adopted by: The Fourth Quarter, Aphelion, Closing Time, Torchbearer,
// The Absalom Inheritance, Corner & Kettle, Daredevil, Integer Foundry,
// The Fracture Cycle, Name Picker, Seating Chart Generator, Faire Weekend,
// and Golden Hour. Castle Conundrum was the fourteenth until 2026-09-15, when
// it moved to its own repository with a vendored copy of this file; that copy
// is a fork and a fix here will not reach it.
// See assets/js/README.md's "Who uses it" for what each one added.

const ENVELOPE = "gvb-save";
const BUNDLE = "gvb-save-bundle";

/**
 * How much localStorage an origin gets, in UTF-16 code units, before setItem
 * throws. Chrome, Edge and Firefox all stop at 5 MiB counted this way (a
 * character costs two bytes on disk, so it is 10 MB of UTF-8-ish text, or 5
 * MB of "bytes" the way most people count). Safari is the same figure. It is a
 * rule of thumb for `usage().share`, not a promise: `probeHeadroom()` measures
 * the real remainder when the number matters.
 */
export const LOCAL_QUOTA_CHARS = 5 * 1024 * 1024;

/**
 * Every browser spells "storage is full" differently. Chrome throws a DOMException
 * named QuotaExceededError with legacy code 22; Firefox's is NS_ERROR_DOM_QUOTA_REACHED
 * with code 1014; IndexedDB aborts a transaction with the same name. Anything
 * else — SecurityError from a blocked store, a stub that throws a plain Error —
 * is not a quota problem and should not be reported as one.
 */
export function isQuotaError(e) {
  if (!e) return false;
  const name = String(e.name || "");
  const code = Number(e.code);
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    code === 22 || code === 1014 || /quota/i.test(String(e.message || ""));
}

/** Best-effort localStorage. Returns a memory-backed stub in private mode. */
export function defaultStorage() {
  try {
    const t = "__gvb_probe__";
    localStorage.setItem(t, "1");
    localStorage.removeItem(t);
    return localStorage;
  } catch (e) {
    return memoryStorage();
  }
}

/** A Map behind localStorage's three methods, plus `keys()` so usage() can count it. */
export function memoryStorage() {
  const mem = new Map();
  return {
    getItem: k => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: k => mem.delete(k),
    keys: () => Array.from(mem.keys()),
    __memoryOnly: true
  };
}

// `typeof localStorage` is not a safe undeclared-identifier check — it's a
// declared accessor on `window`, so the read itself throws in a browser that
// blocks storage, before defaultStorage()'s own try/catch ever runs. That is
// the exact case the memory fallback exists for, so guard the check too.
function guardedDefault() {
  try { return typeof localStorage !== "undefined" ? defaultStorage() : null; }
  catch (e) { return defaultStorage(); }
}

/**
 * Every key a synchronous store holds, or null when it cannot say. Real
 * localStorage enumerates through `length`/`key(i)`; the memory stub and any
 * test stub that wants counting expose `keys()`. A stub with neither is not
 * wrong, it is just uncountable, and `usage()` says so with nulls rather than
 * a made-up zero.
 */
export function storeKeys(store) {
  if (!store) return null;
  try {
    if (typeof store.keys === "function") return Array.from(store.keys()).map(String);
    if (typeof store.length === "number" && typeof store.key === "function") {
      const out = [];
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k != null) out.push(String(k));
      }
      return out;
    }
  } catch (e) { /* uncountable */ }
  return null;
}

/** UTF-16 code units a key/value pair costs, which is how browsers meter it. */
const cost = (k, v) => String(k).length + (v == null ? 0 : String(v).length);

/**
 * What a whole synchronous store is carrying, optionally narrowed to one prefix.
 * `{ keys: [{key, chars}], chars, bytes, counted }` — `counted` is false when
 * the store cannot enumerate, in which case `keys` is empty and the totals are
 * null rather than zero.
 */
export function measureStorage(store, prefix = "") {
  const names = storeKeys(store);
  if (!names) return { keys: [], chars: null, bytes: null, counted: false };
  const keys = [];
  let chars = 0;
  for (const key of names) {
    if (prefix && !key.startsWith(prefix)) continue;
    let v = null;
    try { v = store.getItem(key); } catch (e) { v = null; }
    const c = cost(key, v);
    keys.push({ key, chars: c });
    chars += c;
  }
  keys.sort((a, b) => b.chars - a.chars);
  return { keys, chars, bytes: chars * 2, counted: true };
}

/**
 * Measure, rather than assume, how many more characters this store will take.
 * Writes a probe key in doubling steps until setItem throws, then bisects, then
 * removes the probe.  Returns the headroom in UTF-16 code units of key plus value, or null for a
 * store that never refused within `max` (the memory stub, a lenient stub).
 * Costs a few dozen writes of up to `max` characters, so it is for a settings
 * screen or a diagnostic, not for every frame.
 */
export function probeHeadroom(store, { max = 64 * 1024 * 1024, key = "__gvb_headroom__" } = {}) {
  if (!store || store.__memoryOnly) return null;
  const fits = n => {
    try { store.setItem(key, "x".repeat(n)); return true; }
    catch (e) { return false; }
  };
  let lo = 0, hi = 1;
  try {
    while (hi <= max && fits(hi)) { lo = hi; hi *= 2; }
    if (hi > max) return null;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (fits(mid)) lo = mid; else hi = mid;
    }
    return lo + key.length;   // value length under this probe key, plus the key: total characters the store will still take
  } finally {
    try { store.removeItem(key); } catch (e) { /* nothing to clean */ }
  }
}

/* ---------------------------------------------------------------------------
   The pure core: everything a slot does that touches no storage at all. Both
   the synchronous slot and the IndexedDB one are this plus a store.
--------------------------------------------------------------------------- */

function makeCore(options) {
  const {
    game,                       // slug, e.g. "closing-time" — goes in the file
    name = null,                // a namespace member's own name; null for a lone slot
    key = `gvb:${game}`,        // storage key
    version = 1,                // bump when the shape changes
    validate = () => true,      // (state) => boolean
    migrate = state => state,   // (state, fromVersion) => state — version drift only
    repair = state => state,    // (state) => state — every accepted load
    defaults = null,            // used by fresh(): a literal, or a factory
  } = options;

  if (!game) throw new Error("createSaveSlot: `game` is required");

  /**
   * Take an untrusted parsed object and return usable state, or null.
   *
   * `migrate` only runs when the stored version differs from the current one.
   * `repair` runs on every state this returns, whatever its version and whichever
   * entry point it came through — localStorage, an imported file, a pasted blob.
   * That distinction matters: a save written by the current build can still be
   * missing a field (a hand-edited localStorage, a write truncated by a quota
   * error), and the fill-in-the-gaps pass that used to live in a project's own
   * `load()` has nowhere else to go. Keep `repair` idempotent and cheap; it is
   * not the place for version-specific reshaping.
   */
  function normalize(raw) {
    if (!raw || typeof raw !== "object") return null;
    // Accept both a bare state blob and a full export envelope.
    const isEnvelope = raw.format === ENVELOPE;
    const from = Number(isEnvelope ? raw.version : raw.__v) || 0;
    let state = isEnvelope ? raw.state : raw;
    if (!state || typeof state !== "object") return null;
    if (isEnvelope && raw.game && game && raw.game !== game) return null;
    // A namespace member's file names its slot; one slot's export must not
    // land in another's. A v1 envelope carries no `slot` and passes as before.
    if (isEnvelope && raw.slot != null && name != null && raw.slot !== name) return null;
    try {
      if (from !== version) state = migrate(state, from);
    } catch (e) {
      return null;
    }
    if (!state || !validate(state)) return null;
    delete state.__v;
    try {
      state = repair(state);
    } catch (e) {
      return null;
    }
    return state && typeof state === "object" ? state : null;
  }

  /** Wrap state in the portable envelope written to disk. */
  function serialize(state, pretty = true) {
    const env = {
      format: ENVELOPE,
      game,
      ...(name != null ? { slot: name } : {}),
      version,
      savedAt: new Date().toISOString(),
      state
    };
    return JSON.stringify(env, null, pretty ? 2 : 0);
  }

  /** Parse an exported file (or a pasted blob) back into state, or null. */
  function deserialize(text) {
    let raw;
    try { raw = JSON.parse(text); } catch (e) { return null; }
    return normalize(raw);
  }

  /**
   * A brand-new state. `defaults` may be a plain object — deep-copied, so a
   * caller can't mutate the template — or a factory function, for a game whose
   * starting state isn't a constant. The Fourth Quarter's `newCampaign()` rolls
   * three random job applicants, so a literal could not describe day one; it
   * passes `defaults: newCampaign`. That's what makes `reset()` usable there
   * instead of every caller having to remember to build a fresh state itself.
   */
  function fresh(...args) {
    if (typeof defaults === "function") return defaults(...args);
    return defaults ? JSON.parse(JSON.stringify(defaults)) : null;
  }

  /** What `save()` writes: the state with the version stamped in. */
  const encode = state => JSON.stringify({ ...state, __v: version });

  function filename() {
    const d = new Date();
    const stamp = [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, "0"),
      String(d.getDate()).padStart(2, "0")
    ].join("-");
    return `${game}${name != null ? "-" + name : ""}-save-${stamp}.json`;
  }

  /** Download the current state as a .json file. */
  function exportToFile(state, want = filename()) {
    return download(serialize(state), want);
  }

  /** Read a File (from an <input type="file">) and resolve with state. */
  function importFromFile(file) {
    return readFile(file).then(text => {
      const state = deserialize(text);
      if (!state) throw new Error("That is not a valid " + game + " save.");
      return state;
    });
  }

  /** Open a file picker and resolve with the imported state. */
  function promptImport() {
    return pickFile().then(importFromFile);
  }

  return {
    game, key, version, name,
    normalize, serialize, deserialize, fresh, encode,
    filename, exportToFile, importFromFile, promptImport
  };
}

/* Browser-only file plumbing, shared by slots and namespaces. */

function download(text, want) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = want;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return want;
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error("No file chosen."));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("That file could not be read."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(file);
  });
}

function pickFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.style.display = "none";
    input.addEventListener("change", () => {
      const f = input.files && input.files[0];
      input.remove();
      f ? resolve(f) : reject(new Error("No file chosen."));
    });
    document.body.appendChild(input);
    input.click();
  });
}

/** What a failed write looks like on `slot.lastError`. */
function describeError(e, chars) {
  return {
    name: e && e.name ? String(e.name) : "Error",
    message: e && e.message ? String(e.message) : String(e),
    quota: isQuotaError(e),
    chars,
    at: Date.now()
  };
}

/** Save no more than once every `ms`, with a flush on page hide. */
function makeAutosave(save, getState, ms = 4000, { onFail = null } = {}) {
  let timer = null, dirty = false;
  const flush = () => {
    if (!dirty) return;
    dirty = false;
    const r = save(getState());
    // Sync slots hand back a boolean, async ones a promise of one; either way
    // a false reaches onFail, and a v1 caller that passed no handler hears
    // nothing, as before.
    if (onFail) Promise.resolve(r).then(ok => { if (ok === false) onFail(); });
  };
  const mark = () => {
    dirty = true;
    if (timer) return;
    timer = setTimeout(() => { timer = null; flush(); }, ms);
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
    window.addEventListener("pagehide", flush);
  }
  return { mark, flush, stop() { if (timer) clearTimeout(timer); timer = null; } };
}

/* ---------------------------------------------------------------------------
   The synchronous slot: localStorage, or the memory stub when that is blocked.
--------------------------------------------------------------------------- */

export function createSaveSlot(options) {
  const core = makeCore(options);
  const { key, version } = core;
  const store = options.storage || guardedDefault();
  let lastError = null;

  function load() {
    if (!store) return null;
    let raw;
    try { raw = store.getItem(key); } catch (e) { return null; }
    if (!raw) return null;
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { return null; }
    return core.normalize(parsed);
  }

  /**
   * Returns true if it stuck. Quota and private-mode failures return false and
   * leave the reason on `lastError` — `{name, message, quota, chars, at}` —
   * so a host can tell "storage is full" from "storage is blocked" and say the
   * right thing. A success clears it.
   */
  function save(state) {
    if (!store) return false;
    const text = core.encode(state);
    try {
      store.setItem(key, text);
      lastError = null;
      return true;
    } catch (e) {
      lastError = describeError(e, cost(key, text));
      return false;
    }
  }

  /** Erase the stored save. Returns true if a key was there to remove. */
  function clear() {
    if (!store) return false;
    let had = false;
    try { had = store.getItem(key) !== null; } catch (e) { return false; }
    try { store.removeItem(key); } catch (e) { return false; }
    return had;
  }

  function reset(...args) {
    clear();
    return core.fresh(...args);
  }

  /**
   * How big this save is and how full the origin's localStorage is, in UTF-16
   * code units, which is what the browser meters. `share` is the origin's total
   * against LOCAL_QUOTA_CHARS; `origin.counted` is false on a store that cannot
   * enumerate, and then `origin.chars` and `share` are null, never a guess.
   */
  function usage() {
    let raw = null;
    try { raw = store ? store.getItem(key) : null; } catch (e) { raw = null; }
    const chars = raw == null ? 0 : cost(key, raw);
    const origin = measureStorage(store);
    return {
      tier: !store ? "none" : store.__memoryOnly ? "memory" : "local",
      key, chars, bytes: chars * 2,
      present: raw != null,
      quotaChars: LOCAL_QUOTA_CHARS,
      share: origin.counted ? origin.chars / LOCAL_QUOTA_CHARS : null,
      origin
    };
  }

  const autosave = (getState, ms, opts) => makeAutosave(save, getState, ms, opts);

  return {
    game: core.game, key, version, name: core.name,
    fresh: core.fresh, load, save, reset, clear, autosave, usage,
    serialize: core.serialize, deserialize: core.deserialize, normalize: core.normalize,
    exportToFile: core.exportToFile, importFromFile: core.importFromFile,
    promptImport: core.promptImport, filename: core.filename,
    get lastError() { return lastError; },
    get memoryOnly() { return !!(store && store.__memoryOnly); },
    get tier() { return !store ? "none" : store.__memoryOnly ? "memory" : "local"; },
    /** For a namespace: the store this slot writes to. */
    get __store() { return store; }
  };
}

/* ---------------------------------------------------------------------------
   The IndexedDB tier.

   localStorage is 5 MiB per origin and synchronous; IndexedDB is metered
   against the disk (Chrome allows an origin a share of free space measured in
   gigabytes, Firefox and Safari hundreds of megabytes) and asynchronous. A
   save that grows past a couple of megabytes belongs here. The trade is that
   every call returns a promise.

   Same key, same bytes. An async slot writes exactly the string a sync slot
   would (`{...state, __v}`), under exactly the same key, in an object store
   instead of localStorage. That is what lets a save move up a tier without
   changing its key (#36): `load()` on an IndexedDB slot that finds nothing
   under its key looks in localStorage, and when the save there is readable
   it moves the string up verbatim and removes the copy — once, read-time,
   the same shape as Bell to Bell's migrateLegacyKeys and decision #59.
--------------------------------------------------------------------------- */

/**
 * An async storage adapter over one IndexedDB object store of string values
 * under string keys. `null` when the browser has no IndexedDB at all. A
 * browser that has the API but refuses to open (Firefox private windows used
 * to) surfaces that as a rejected promise on first use, and
 * createAsyncSaveSlot() falls back on it.
 */
export function idbStorage({ db = "gvb-save", store: storeName = "kv" } = {}) {
  let idb = null;
  try { idb = typeof indexedDB !== "undefined" ? indexedDB : null; } catch (e) { idb = null; }
  if (!idb) return null;

  let opening = null;
  const open = () => {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      let req;
      try { req = idb.open(db, 1); } catch (e) { reject(e); return; }
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(storeName)) d.createObjectStore(storeName);
      };
      req.onsuccess = () => {
        const d = req.result;
        // Another tab upgrading the database asks us to let go; the next call
        // reopens.
        d.onversionchange = () => { d.close(); opening = null; };
        resolve(d);
      };
      req.onerror = () => reject(req.error || new Error("indexedDB.open failed"));
      req.onblocked = () => reject(new Error("indexedDB.open blocked"));
    });
    // A failed open is not sticky: the next call tries again.
    opening.catch(() => { opening = null; });
    return opening;
  };

  const run = (mode, fn) => open().then(d => new Promise((resolve, reject) => {
    let tx;
    try { tx = d.transaction(storeName, mode); } catch (e) { reject(e); return; }
    let out, req = null;
    try { req = fn(tx.objectStore(storeName)); } catch (e) { reject(e); return; }
    if (req) req.onsuccess = () => { out = req.result; };
    const fail = () => reject(tx.error || (req && req.error) || new Error("IndexedDB transaction failed"));
    tx.oncomplete = () => resolve(out);
    tx.onerror = fail;
    tx.onabort = fail;
  }));

  return {
    async: true,
    tier: "idb",
    getItem: k => run("readonly", os => os.get(k)).then(v => (v === undefined ? null : v)),
    setItem: (k, v) => run("readwrite", os => os.put(String(v), k)).then(() => undefined),
    removeItem: k => run("readwrite", os => os.delete(k)).then(() => undefined),
    keys: () => run("readonly", os => os.getAllKeys()).then(ks => (ks || []).map(String)),
    /** Let go of the connection, so a test can delete the database. */
    close: () => (opening ? opening.then(d => d.close(), () => {}).then(() => { opening = null; }) : Promise.resolve())
  };
}

/** A synchronous store behind the async adapter interface. */
export function asyncify(store) {
  if (!store) return null;
  if (store.async) return store;
  const tier = store.__memoryOnly ? "memory" : "local";
  return {
    async: true,
    tier,
    __memoryOnly: !!store.__memoryOnly,
    getItem: k => Promise.resolve().then(() => store.getItem(k)),
    setItem: (k, v) => Promise.resolve().then(() => { store.setItem(k, v); }),
    removeItem: k => Promise.resolve().then(() => { store.removeItem(k); }),
    keys: () => Promise.resolve().then(() => storeKeys(store)),
    close: () => Promise.resolve()
  };
}

/**
 * createSaveSlot's async twin. Same options; every storage call returns a
 * promise. `storage` may be any async adapter (idbStorage(), asyncify(stub)) or
 * a plain sync store, which is wrapped. With no `storage` it takes IndexedDB,
 * and when that is missing or refuses to open, localStorage, and when that is
 * blocked, memory — `slot.tier` says which it ended up on, after the first
 * call resolves.
 *
 * `fallback` is the sync store a save may still be sitting in from before this
 * slot existed: localStorage by default, only when the tier is IndexedDB.
 * Pass `null` to never look below.
 */
export function createAsyncSaveSlot(options) {
  const core = makeCore(options);
  const { key, version } = core;
  let store = options.storage ? asyncify(options.storage) : (idbStorage() || asyncify(guardedDefault() || memoryStorage()));
  let below = options.fallback === undefined ? (store.tier === "idb" ? guardedDefault() : null) : options.fallback;
  if (below && below.__memoryOnly) below = null;   // nothing could be waiting in a store that forgets
  let lastError = null;
  let promoted = false;

  // IndexedDB that exists but will not open — an old Firefox private window, a
  // profile with a corrupt database — is found out on the first call. Drop to
  // localStorage then, once, and stay there for this slot's life.
  async function demoteIfDead(e) {
    if (store.tier !== "idb") return false;
    if (isQuotaError(e)) return false;
    store = asyncify(guardedDefault() || memoryStorage());
    below = null;
    return true;
  }

  async function load() {
    let raw = null, fromBelow = false;
    try { raw = await store.getItem(key); }
    catch (e) {
      if (!(await demoteIfDead(e))) return null;
      try { raw = await store.getItem(key); } catch (e2) { return null; }
    }
    if (raw == null && below) {
      try { raw = below.getItem(key); } catch (e) { raw = null; }
      fromBelow = raw != null;
    }
    if (raw == null) return null;
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { return null; }
    const state = core.normalize(parsed);
    if (state && fromBelow) {
      // Move the string up verbatim — not re-encoded, so a version-0 save is
      // still a version-0 save up there and still comes through migrate() —
      // and only then drop the copy. A failed put leaves the copy where it
      // was and the next load tries again.
      try {
        await store.setItem(key, raw);
        try { below.removeItem(key); } catch (e) { /* the copy lingers; harmless */ }
        promoted = true;
      } catch (e) {
        lastError = describeError(e, cost(key, raw));
      }
    }
    return state;
  }

  async function save(state) {
    const text = core.encode(state);
    try {
      await store.setItem(key, text);
      lastError = null;
      return true;
    } catch (e) {
      lastError = describeError(e, cost(key, text));
      if (await demoteIfDead(e)) return save(state);
      return false;
    }
  }

  async function clear() {
    let had = false;
    try { had = (await store.getItem(key)) != null; } catch (e) { return false; }
    try { await store.removeItem(key); } catch (e) { return false; }
    if (below) { try { if (below.getItem(key) != null) { below.removeItem(key); had = true; } } catch (e) { /* fine */ } }
    return had;
  }

  async function reset(...args) {
    await clear();
    return core.fresh(...args);
  }

  /**
   * This save's size, and — on the IndexedDB tier, where the browser will
   * actually say — `navigator.storage.estimate()`'s usage and quota for the
   * whole origin, in bytes. `share` is usage over quota. On a localStorage
   * fallback it is the sync slot's answer.
   */
  async function usage() {
    let raw = null;
    try { raw = await store.getItem(key); } catch (e) { raw = null; }
    const chars = raw == null ? 0 : cost(key, raw);
    const out = { tier: store.tier, key, chars, bytes: chars * 2, present: raw != null, promoted };
    if (store.tier === "idb") {
      let est = null;
      try {
        if (typeof navigator !== "undefined" && navigator.storage && navigator.storage.estimate) {
          est = await navigator.storage.estimate();
        }
      } catch (e) { est = null; }
      out.origin = est ? { usage: est.usage, quota: est.quota, counted: true } : { usage: null, quota: null, counted: false };
      out.share = est && est.quota ? est.usage / est.quota : null;
    } else {
      const origin = await store.keys().then(ks => ks ? measureStorage({ keys: () => ks, getItem: () => null }) : null, () => null);
      out.quotaChars = LOCAL_QUOTA_CHARS;
      out.origin = origin || { keys: [], chars: null, bytes: null, counted: false };
      out.share = null; // a sync slot on the same store measures this exactly; see createSaveSlot().usage()
    }
    return out;
  }

  const autosave = (getState, ms, opts) => makeAutosave(save, getState, ms, opts);

  return {
    game: core.game, key, version, name: core.name, async: true,
    fresh: core.fresh, load, save, reset, clear, autosave, usage,
    serialize: core.serialize, deserialize: core.deserialize, normalize: core.normalize,
    exportToFile: core.exportToFile, importFromFile: core.importFromFile,
    promptImport: core.promptImport, filename: core.filename,
    get lastError() { return lastError; },
    get promoted() { return promoted; },
    get memoryOnly() { return store.tier === "memory"; },
    get tier() { return store.tier; },
    get __store() { return store; }
  };
}

/* ---------------------------------------------------------------------------
   Namespaces: many keys under one prefix, one bundle file.

   Every multi-key adopter so far spelled its own: Bell to Bell's
   `belltobell.p5.chart`, the Name Picker's thirteen `np_` keys, Hearth's
   `hearth.auto`. A namespace is that convention with the pieces they each
   rebuilt — a per-key slot with its own validate/migrate/repair, a count of
   what the prefix is carrying, a clear-all, and an export that holds every
   member in one envelope. The prefix is the whole key layout, so an existing
   scheme fits without a key changing (#36): `createNamespace({ game:
   "bell-to-bell", prefix: "belltobell." }).slot("p5.chart")` writes
   `belltobell.p5.chart`, byte for byte what the hand-rolled code wrote.
--------------------------------------------------------------------------- */

export function createNamespace(options) {
  const {
    game,
    prefix = `${game}.`,
    version = 1,             // the bundle's version; each member has its own
    storage = null,
    async: wantAsync = false, // true: members are createAsyncSaveSlot()s
    migrate = states => states // (states, fromVersion) => states — bundle-level drift only
  } = options;
  if (!game) throw new Error("createNamespace: `game` is required");

  const store = wantAsync
    ? (storage ? asyncify(storage) : (idbStorage() || asyncify(guardedDefault() || memoryStorage())))
    : (storage || guardedDefault());
  const members = new Map();   // name -> slot

  /**
   * The slot for one member. Registered once; a second call with options is a
   * bug in the caller (two places disagreeing about a member's shape) and is
   * loud about it rather than letting the later one silently win.
   */
  function slot(name, opts = {}) {
    if (typeof name !== "string" || !name) throw new Error("namespace.slot: a member needs a name");
    if (members.has(name)) {
      if (Object.keys(opts).length) throw new Error(`namespace.slot("${name}") is already registered; options go on the first call`);
      return members.get(name);
    }
    const make = wantAsync ? createAsyncSaveSlot : createSaveSlot;
    const s = make({ game, version: 1, ...opts, name, key: prefix + name, storage: store });
    members.set(name, s);
    return s;
  }

  const registered = () => Array.from(members.keys());
  const nameOf = key => key.slice(prefix.length);
  const under = keys => (keys || []).filter(k => k.startsWith(prefix)).map(nameOf);

  /** Member names that have something stored, registered or not. */
  function names() {
    if (wantAsync) return store.keys().then(under, () => registered().filter(() => false));
    const ks = storeKeys(store);
    if (ks) return under(ks);
    // An uncountable store: the best answer is which registered members answer.
    return registered().filter(n => { try { return store.getItem(prefix + n) != null; } catch (e) { return false; } });
  }

  /** What the prefix is carrying — the per-key list is sorted largest first. */
  function usage() {
    if (!wantAsync) {
      const m = measureStorage(store, prefix);
      return { ...m, quotaChars: LOCAL_QUOTA_CHARS, share: m.counted ? m.chars / LOCAL_QUOTA_CHARS : null, tier: store.__memoryOnly ? "memory" : "local" };
    }
    return (async () => {
      let ks = null;
      try { ks = await store.keys(); } catch (e) { ks = null; }
      if (!ks) return { keys: [], chars: null, bytes: null, counted: false, tier: store.tier };
      const keys = [];
      let chars = 0;
      for (const key of ks) {
        if (!key.startsWith(prefix)) continue;
        let v = null;
        try { v = await store.getItem(key); } catch (e) { v = null; }
        const c = cost(key, v);
        keys.push({ key, chars: c });
        chars += c;
      }
      keys.sort((a, b) => b.chars - a.chars);
      return { keys, chars, bytes: chars * 2, counted: true, tier: store.tier };
    })();
  }

  /** Remove every key under the prefix. Returns how many went. */
  function clearAll() {
    if (!wantAsync) {
      const ks = storeKeys(store) || registered().map(n => prefix + n);
      let n = 0;
      for (const k of ks) {
        if (!k.startsWith(prefix)) continue;
        try { if (store.getItem(k) != null) { store.removeItem(k); n++; } } catch (e) { /* skip */ }
      }
      return n;
    }
    return (async () => {
      let ks = null;
      try { ks = await store.keys(); } catch (e) { ks = null; }
      if (!ks) ks = registered().map(n => prefix + n);
      let n = 0;
      for (const k of ks) {
        if (!k.startsWith(prefix)) continue;
        try { if ((await store.getItem(k)) != null) { await store.removeItem(k); n++; } } catch (e) { /* skip */ }
      }
      return n;
    })();
  }

  /** `{ name: state }` for every registered member that loads. */
  function snapshot() {
    if (!wantAsync) {
      const out = {};
      for (const [n, s] of members) { const st = s.load(); if (st) out[n] = st; }
      return out;
    }
    return (async () => {
      const out = {};
      for (const [n, s] of members) { const st = await s.load(); if (st) out[n] = st; }
      return out;
    })();
  }

  /**
   * One file holding many members. `states` is `{ name: state }` — what the
   * game holds in memory, the same way slot.serialize() takes the live state
   * rather than re-reading storage. Each entry carries its member's own version
   * so the import can run that member's migrate().
   */
  function serialize(states, pretty = true) {
    const slots = {};
    for (const [n, state] of Object.entries(states || {})) {
      const s = members.get(n);
      slots[n] = { version: s ? s.version : 1, state };
    }
    const env = { format: BUNDLE, game, version, savedAt: new Date().toISOString(), slots };
    return JSON.stringify(env, null, pretty ? 2 : 0);
  }

  /**
   * Parse a bundle back into `{ states, skipped, refused }`, or null for
   * anything that is not this game's bundle. `states` holds every member that
   * normalized through its own slot; `skipped` names members this build has
   * not registered (a file from a later build, say) and `refused` names
   * registered members whose state failed validate/migrate/repair. Nothing is
   * written: that is importAll().
   */
  function deserialize(text) {
    let raw;
    try { raw = JSON.parse(text); } catch (e) { return null; }
    if (!raw || typeof raw !== "object" || raw.format !== BUNDLE) return null;
    if (raw.game && raw.game !== game) return null;
    let slots = raw.slots;
    if (!slots || typeof slots !== "object") return null;
    const from = Number(raw.version) || 0;
    if (from !== version) {
      try { slots = migrate(slots, from); } catch (e) { return null; }
      if (!slots || typeof slots !== "object") return null;
    }
    const states = {}, skipped = [], refused = [];
    for (const [n, entry] of Object.entries(slots)) {
      const s = members.get(n);
      if (!s) { skipped.push(n); continue; }
      const env = { format: ENVELOPE, game, slot: n, version: Number(entry && entry.version) || 0, state: entry && entry.state };
      const st = s.normalize(env);
      if (st) states[n] = st; else refused.push(n);
    }
    return { states, skipped, refused };
  }

  /** deserialize(), then write every accepted member. Adds `stored`, the names that stuck. */
  function importAll(text) {
    const parsed = deserialize(text);
    if (!parsed) return wantAsync ? Promise.resolve(null) : null;
    if (!wantAsync) {
      parsed.stored = Object.keys(parsed.states).filter(n => members.get(n).save(parsed.states[n]));
      return parsed;
    }
    return (async () => {
      parsed.stored = [];
      for (const n of Object.keys(parsed.states)) if (await members.get(n).save(parsed.states[n])) parsed.stored.push(n);
      return parsed;
    })();
  }

  function filename() {
    const d = new Date();
    const stamp = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
    return `${game}-bundle-${stamp}.json`;
  }

  const exportToFile = (states, want = filename()) => download(serialize(states), want);
  const importFromFile = file => readFile(file).then(text => {
    const r = deserialize(text);
    if (!r) throw new Error("That is not a valid " + game + " save bundle.");
    return r;
  });
  const promptImport = () => pickFile().then(importFromFile);

  return {
    game, prefix, version, async: wantAsync,
    slot, names, registered, usage, clearAll, snapshot,
    serialize, deserialize, importAll,
    filename, exportToFile, importFromFile, promptImport,
    get tier() { return wantAsync ? store.tier : (store.__memoryOnly ? "memory" : "local"); },
    get memoryOnly() { return wantAsync ? store.tier === "memory" : !!store.__memoryOnly; }
  };
}

/* ---------------------------------------------------------------------------
   Optional drop-in UI: buttons that call the slot for you.

     mountSaveBar(document.getElementById("save-bar"), slot, {
       getState: () => campaign,
       setState: c => { campaign = c; redraw(); },
       onMessage: text => toast(text)
     });

   `buttons` picks which of "export" / "import" / "reset" get mounted, in that
   order by default. A host page that already has its own new-game button wants
   `buttons: ["export", "import"]` rather than two controls that wipe the save
   sitting next to each other — which is exactly what the Fourth Quarter needed,
   since its start screen has shipped a "New Game (wipe save)" button since long
   before this module existed.

   Each button carries `data-gvb="export|import|reset"`. Nothing in the module
   reads it; it's there so a driver script can click a specific one without
   depending on button order or label text.

   Styling is deliberately thin. Override with CSS custom properties on any
   ancestor: --gvb-btn-bg, --gvb-btn-fg, --gvb-btn-border, --gvb-btn-radius.

   An async slot works here too: every call the bar makes is awaited.
--------------------------------------------------------------------------- */

let stylesInjected = false;

function injectStyles() {
  if (stylesInjected || typeof document === "undefined") return;
  stylesInjected = true;
  const css = `
.gvb-save-bar{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;font:inherit}
.gvb-save-bar button{
  font:inherit;font-size:.8em;letter-spacing:.06em;cursor:pointer;
  padding:.35em .9em;
  color:var(--gvb-btn-fg,#eee);
  background:var(--gvb-btn-bg,rgba(255,255,255,.08));
  border:1px solid var(--gvb-btn-border,rgba(255,255,255,.22));
  border-radius:var(--gvb-btn-radius,3px);
}
.gvb-save-bar button:hover{filter:brightness(1.18)}
.gvb-save-bar button:focus-visible{outline:2px solid var(--gvb-btn-border,#B08D3E);outline-offset:2px}
.gvb-save-msg{font-size:.78em;opacity:.75;min-height:1em}`;
  const el = document.createElement("style");
  el.textContent = css;
  document.head.appendChild(el);
}

/** The line a save bar prints when a write did not stick. */
export function failureMessage(slot) {
  const e = slot && slot.lastError;
  if (e && e.quota) {
    const mb = (e.chars * 2 / (1024 * 1024)).toFixed(1);
    return `Could not save: this browser's storage is full (this save is ${mb} MB). Export it before you go on.`;
  }
  if (slot && slot.memoryOnly) return "Could not save: this browser blocks storage. Export before you close the tab.";
  return "Could not save: " + (e ? e.message : "storage refused the write") + ". Export before you go on.";
}

export function mountSaveBar(container, slot, handlers = {}) {
  if (!container) return null;
  const {
    getState, setState, onMessage, confirmReset = true,
    buttons = ["export", "import", "reset"],
    filename = null,   // () => string, or a string — export's download name
    labels = {},       // { kind: [label, title] } — override the default wording
  } = handlers;
  injectStyles();

  container.classList.add("gvb-save-bar");
  const msg = document.createElement("span");
  msg.className = "gvb-save-msg";
  msg.setAttribute("aria-live", "polite");

  const say = text => {
    if (onMessage) onMessage(text);
    else { msg.textContent = text; setTimeout(() => { msg.textContent = ""; }, 4000); }
  };

  const button = (kind, label, title, fn) => {
    const override = labels[kind];
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.gvb = kind;
    b.textContent = (override && override[0]) || label;
    b.title = (override && override[1]) || title;
    b.addEventListener("click", fn);
    container.appendChild(b);
    return b;
  };

  const KINDS = {
    export: () => button("export", "Export save", "Download this save as a file", () => {
      const want = typeof filename === "function" ? filename() : filename;
      const name = slot.exportToFile(getState(), want || undefined);
      say("Saved to " + name);
    }),

    // setState runs before the write reaches storage, and can veto it by
    // returning false — a host that rejects an imported state (an id from a
    // pack this browser hasn't loaded, say) should not have already
    // overwritten what was on disk by the time it finds out. And a write that
    // does not stick is said out loud: "Save loaded." over a full store was
    // the one lie this bar used to tell.
    import: () => button("import", "Import save", "Load a save file from your computer", () => {
      slot.promptImport().then(
        state => {
          const accepted = setState ? setState(state) : true;
          if (accepted === false) return;
          Promise.resolve(slot.save(state)).then(ok => say(ok ? "Save loaded." : "Save loaded, but " + failureMessage(slot).charAt(0).toLowerCase() + failureMessage(slot).slice(1)));
        },
        err => say(err.message)
      );
    }),

    reset: () => button("reset", "Start over", "Erase this save and begin again", () => {
      if (confirmReset && !confirm("Erase this save and start over? This cannot be undone.")) return;
      Promise.resolve(slot.reset()).then(state => {
        if (setState) setState(state);
        say("Save erased.");
      });
    }),
  };

  for (const kind of buttons) {
    // Loud on a typo: a silently missing button reads as a broken save bar.
    if (!KINDS[kind]) throw new Error(`mountSaveBar: no such button "${kind}"`);
    KINDS[kind]();
  }

  container.appendChild(msg);
  if (slot.memoryOnly) say("This browser blocks storage — export before you close the tab.");
  return { say };
}

export default {
  createSaveSlot, createAsyncSaveSlot, createNamespace, mountSaveBar,
  defaultStorage, memoryStorage, idbStorage, asyncify,
  measureStorage, probeHeadroom, storeKeys, isQuotaError, failureMessage,
  LOCAL_QUOTA_CHARS
};
