// gvb-save.test.mjs — node assets/js/gvb-save.test.mjs
// Plain-Node smoke suite, same shape as the other projects on this site:
// a tiny assert() counter, no framework. Exercises everything that does not
// need a DOM (storage round-trip, versioning, migration, validation,
// envelope serialize/deserialize, autosave throttling).

import {
  createSaveSlot, createAsyncSaveSlot, createNamespace, defaultStorage, memoryStorage,
  asyncify, measureStorage, probeHeadroom, isQuotaError, failureMessage, LOCAL_QUOTA_CHARS
} from "./gvb-save.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) pass++;
  else { fail++; console.error("FAIL: " + msg); }
}

function stubStorage(seed = {}) {
  const mem = new Map(Object.entries(seed));
  return {
    getItem: k => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: k => mem.delete(k),
    _dump: () => Object.fromEntries(mem)
  };
}

const baseOpts = storage => ({
  game: "test-sim",
  key: "test-save",
  version: 2,
  storage,
  defaults: { day: 1, cash: 100, staff: [] },
  validate: s => s && typeof s.day === "number" && Array.isArray(s.staff),
  migrate: (s, from) => {
    if (from < 2) s.upgrades = s.upgrades || [];
    return s;
  }
});

// --- fresh() hands back an independent copy of defaults ---
{
  const slot = createSaveSlot(baseOpts(stubStorage()));
  const a = slot.fresh(), b = slot.fresh();
  a.cash = 999;
  assert(b.cash === 100, "fresh() must deep-copy defaults, not share them");
  assert(slot.fresh().cash === 100, "defaults survive mutation of a fresh copy");
}

// --- defaults may be a factory, for a game whose day one isn't a constant ---
{
  let rolls = 0;
  const slot = createSaveSlot({
    ...baseOpts(stubStorage()),
    defaults: () => ({ day: 1, staff: [], token: ++rolls })
  });
  const a = slot.fresh(), b = slot.fresh();
  assert(a.token === 1 && b.token === 2, "a defaults factory is called per fresh(), not once");
  assert(slot.reset().token === 3, "reset() goes through the factory too");
}

// --- repair runs on every accepted load, whatever the version said ---
{
  // Same version as the slot, so migrate() is skipped — this is the gap repair
  // exists to close. The old per-project loaders ran their fill-ins on every
  // load, and a state can lose a field without the version ever moving.
  const current = JSON.stringify({ day: 6, staff: [], __v: 2 });
  const opts = baseOpts(stubStorage({ "test-save": current }));
  let migrated = 0, repaired = 0;
  opts.migrate = s => { migrated++; return s; };
  opts.repair = s => { repaired++; s.stock = s.stock || { beer: 0 }; return s; };
  const slot = createSaveSlot(opts);
  const back = slot.load();
  assert(migrated === 0, "migrate() stays out of the way at the current version");
  assert(repaired === 1 && back.stock.beer === 0, "repair() ran on a current-version load");

  const viaFile = slot.deserialize(slot.serialize({ day: 2, staff: [] }));
  assert(repaired === 2 && viaFile.stock, "repair() runs on the import path as well");
}

// --- repair only sees states that already passed validate ---
{
  const opts = baseOpts(stubStorage({ "test-save": '{"day":"soon","staff":[]}' }));
  let repaired = 0;
  opts.repair = s => { repaired++; return s; };
  const slot = createSaveSlot(opts);
  assert(slot.load() === null && repaired === 0, "a refused save never reaches repair()");
}

// --- a repair that throws is an unreadable save, not a crash ---
{
  const opts = baseOpts(stubStorage({ "test-save": '{"day":4,"staff":[],"__v":2}' }));
  opts.repair = () => { throw new Error("boom"); };
  assert(createSaveSlot(opts).load() === null, "a throwing repair degrades to null");
}

// --- save / load round-trip ---
{
  const store = stubStorage();
  const slot = createSaveSlot(baseOpts(store));
  const state = slot.fresh();
  state.day = 12;
  state.staff.push({ role: "server" });
  assert(slot.save(state) === true, "save() reports success");
  const back = slot.load();
  assert(back && back.day === 12, "loaded state keeps its day");
  assert(back.staff.length === 1, "loaded state keeps its array contents");
  assert(!("__v" in back), "the version marker is stripped before the game sees it");
}

// --- empty and corrupt storage never throw ---
{
  const slot = createSaveSlot(baseOpts(stubStorage()));
  assert(slot.load() === null, "empty storage loads as null");
}
{
  const slot = createSaveSlot(baseOpts(stubStorage({ "test-save": "{not json" })));
  assert(slot.load() === null, "corrupt JSON loads as null instead of throwing");
}
{
  const slot = createSaveSlot(baseOpts(stubStorage({ "test-save": '{"day":"soon"}' })));
  assert(slot.load() === null, "a save that fails validate() is refused");
}

// --- migration runs when the stored version is behind ---
{
  const old = JSON.stringify({ day: 4, staff: [], __v: 1 });
  const slot = createSaveSlot(baseOpts(stubStorage({ "test-save": old })));
  const back = slot.load();
  assert(back !== null, "a v1 save still loads under v2");
  assert(Array.isArray(back.upgrades), "migrate() filled in the field v1 lacked");
}

// --- a migration that throws is treated as an unreadable save ---
{
  const opts = baseOpts(stubStorage({ "test-save": '{"day":4,"staff":[],"__v":1}' }));
  opts.migrate = () => { throw new Error("boom"); };
  const slot = createSaveSlot(opts);
  assert(slot.load() === null, "a throwing migration degrades to null, not a crash");
}

// --- export envelope ---
{
  const slot = createSaveSlot(baseOpts(stubStorage()));
  const state = slot.fresh();
  state.day = 7;
  const text = slot.serialize(state);
  const env = JSON.parse(text);
  assert(env.format === "gvb-save", "envelope is tagged");
  assert(env.game === "test-sim", "envelope names the game");
  assert(env.version === 2, "envelope carries the schema version");
  assert(typeof env.savedAt === "string", "envelope is timestamped");
  assert(env.state.day === 7, "envelope carries the state");

  const back = slot.deserialize(text);
  assert(back && back.day === 7, "deserialize() round-trips the state");
}

// --- imports are refused when they belong to a different game ---
{
  const mine = createSaveSlot(baseOpts(stubStorage()));
  const other = createSaveSlot({ ...baseOpts(stubStorage()), game: "some-other-sim" });
  const foreign = other.serialize({ day: 3, staff: [] });
  assert(mine.deserialize(foreign) === null, "a save from another game is refused");
}

// --- an older exported file still imports, via the same migration path ---
{
  const slot = createSaveSlot(baseOpts(stubStorage()));
  const oldFile = JSON.stringify({
    format: "gvb-save", game: "test-sim", version: 1,
    savedAt: "2026-01-01T00:00:00.000Z",
    state: { day: 9, staff: [] }
  });
  const back = slot.deserialize(oldFile);
  assert(back && back.day === 9, "a v1 export file imports under v2");
  assert(Array.isArray(back.upgrades), "the export path runs migrate() too");
}

// --- deserialize rejects junk ---
{
  const slot = createSaveSlot(baseOpts(stubStorage()));
  assert(slot.deserialize("hello") === null, "non-JSON text is refused");
  assert(slot.deserialize("[]") === null, "an array is not a save");
  assert(slot.deserialize('{"format":"gvb-save","game":"test-sim","version":2,"state":{"day":"x"}}') === null,
    "an envelope holding invalid state is refused");
}

// --- reset clears storage and hands back a fresh state ---
{
  const store = stubStorage();
  const slot = createSaveSlot(baseOpts(store));
  slot.save({ day: 40, staff: [] });
  const after = slot.reset();
  assert(store.getItem("test-save") === null, "reset() clears the key");
  assert(after.day === 1, "reset() returns a fresh state");
}

// --- a storage that refuses writes fails soft ---
{
  const hostile = {
    getItem: () => null,
    setItem: () => { throw new Error("QuotaExceededError"); },
    removeItem: () => { throw new Error("nope"); }
  };
  const slot = createSaveSlot({ ...baseOpts(hostile) });
  assert(slot.save({ day: 1, staff: [] }) === false, "a full quota returns false, not a throw");
  assert(slot.reset().day === 1, "reset() survives a hostile storage");
}

// --- autosave coalesces writes ---
{
  const store = stubStorage();
  const slot = createSaveSlot(baseOpts(store));
  let day = 1;
  const auto = slot.autosave(() => ({ day, staff: [] }), 10);
  auto.mark(); day = 2;
  auto.mark(); day = 3;
  auto.mark();
  assert(store.getItem("test-save") === null, "autosave does not write on every mark");
  auto.flush();
  assert(JSON.parse(store.getItem("test-save")).day === 3, "flush writes the latest state once");
  auto.stop();
}

// --- defaultStorage() degrades to memory when localStorage is absent ---
{
  const s = defaultStorage();
  assert(typeof s.getItem === "function", "defaultStorage() always returns something usable");
  s.setItem("k", "v");
  assert(s.getItem("k") === "v", "the memory fallback stores and retrieves");
}

// --- fresh() and reset() forward arguments to a defaults factory ---
// Closing Time's day one depends on which brokerage the player picked on the
// start screen, which a zero-argument factory has no way to express.
{
  const slot = createSaveSlot({
    ...baseOpts(stubStorage()),
    defaults: brokerage => ({ day: 1, staff: [], brokerage: brokerage || "indep" })
  });
  assert(slot.fresh("hearthstone").brokerage === "hearthstone",
    "fresh(...args) reaches a defaults factory");
  assert(slot.reset("hearthstone").brokerage === "hearthstone",
    "reset(...args) forwards the same way");
  assert(slot.fresh().brokerage === "indep",
    "existing zero-argument callers are unaffected");
}

// --- clear() erases without rebuilding a fresh state ---
{
  let built = 0;
  const store = stubStorage();
  const slot = createSaveSlot({
    ...baseOpts(store),
    defaults: () => { built++; return { day: 1, staff: [] }; }
  });
  slot.save({ day: 9, staff: [] });
  built = 0;
  assert(slot.clear() === true, "clear() reports true when a key was there to remove");
  assert(store.getItem("test-save") === null, "clear() removes the key");
  assert(built === 0, "clear() never calls the defaults factory");
  assert(slot.clear() === false, "clear() reports false on an already-empty key");
}

// --- load() survives a storage whose getItem itself throws ---
// The gap: a browser blocking storage throws on the property access, and an
// injected storage stub that mimics that (rather than defaultStorage()'s own
// probe) used to reach load() unguarded.
{
  const throwing = {
    getItem: () => { throw new Error("SecurityError"); },
    setItem: () => { throw new Error("SecurityError"); },
    removeItem: () => { throw new Error("SecurityError"); }
  };
  const slot = createSaveSlot({ ...baseOpts(throwing) });
  assert(slot.load() === null, "load() degrades to null when getItem() throws");
}

// --- construction survives `typeof localStorage` itself throwing ---
// localStorage is a declared accessor on `window` in a real browser, not an
// undeclared identifier, so a policy that blocks storage makes the property
// read throw — before defaultStorage()'s own try/catch runs. createSaveSlot()
// must not propagate that; it is exactly the case the memory fallback exists
// to survive.
{
  const desc = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() { throw new Error("SecurityError: blocked"); }
  });
  try {
    let slot;
    let threw = false;
    try { slot = createSaveSlot({ game: "blocked-probe", defaults: { ok: true } }); }
    catch (e) { threw = true; }
    assert(!threw, "createSaveSlot() does not propagate a throwing localStorage getter");
    assert(slot && slot.memoryOnly, "it falls back to the memory-backed store instead");
    assert(slot && slot.save({ ok: false }) === true, "and that store is actually usable");
  } finally {
    if (desc) Object.defineProperty(globalThis, "localStorage", desc);
    else delete globalThis.localStorage;
  }
}

/* ===========================================================================
   v2: quota accounting, namespaces, the async tier. Everything here runs on
   stubs; assets/js/gvb-save.browser.mjs is the same surface against a real
   localStorage quota and a real IndexedDB.
   =========================================================================== */

// A countable stub with a capacity, metered the way browsers meter localStorage:
// key length plus value length, in UTF-16 code units, across every key.
function cappedStorage(cap, seed = {}) {
  const mem = new Map(Object.entries(seed));
  const used = () => Array.from(mem).reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {
    getItem: k => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => {
      const next = used() - (mem.has(k) ? k.length + mem.get(k).length : 0) + k.length + String(v).length;
      if (next > cap) { const e = new Error("The quota has been exceeded."); e.name = "QuotaExceededError"; e.code = 22; throw e; }
      mem.set(k, String(v));
    },
    removeItem: k => mem.delete(k),
    keys: () => Array.from(mem.keys()),
    _used: used
  };
}

// --- isQuotaError knows every spelling, and only those ---
{
  assert(isQuotaError({ name: "QuotaExceededError" }), "Chrome's DOMException name is a quota error");
  assert(isQuotaError({ name: "NS_ERROR_DOM_QUOTA_REACHED", code: 1014 }), "Firefox's is too");
  assert(isQuotaError({ code: 22 }), "the legacy code 22 alone is enough");
  assert(!isQuotaError({ name: "SecurityError", message: "blocked" }), "a blocked store is not a full one");
  assert(!isQuotaError(null) && !isQuotaError(new Error("nope")), "a plain error is not a quota error");
}

// --- usage() measures this key and the whole origin in UTF-16 code units ---
{
  const store = stubStorage({ "someone-else": "x".repeat(50) });
  store.keys = () => Object.keys(store._dump());
  const slot = createSaveSlot(baseOpts(store));
  const before = slot.usage();
  assert(before.present === false && before.chars === 0, "an unsaved slot measures zero and is not present");
  slot.save({ day: 3, staff: [] });
  const u = slot.usage();
  const text = store.getItem("test-save");
  assert(u.chars === "test-save".length + text.length, "chars is key length plus value length, what the browser meters");
  assert(u.bytes === u.chars * 2, "bytes is two per code unit");
  assert(u.origin.counted === true, "a store with keys() is countable");
  assert(u.origin.chars === u.chars + "someone-else".length + 50, "origin counts every key, not just this slot's");
  assert(u.origin.keys[0].key === "someone-else" && u.origin.keys[1].key === "test-save", "the per-key list is largest first");
  assert(u.share === u.origin.chars / LOCAL_QUOTA_CHARS, "share is the origin against the 5 MiB rule of thumb");
  assert(u.tier === "local", "a plain store reads as the local tier");
}

// --- an uncountable stub says so, rather than reporting zero ---
{
  const slot = createSaveSlot(baseOpts(stubStorage()));
  slot.save({ day: 1, staff: [] });
  const u = slot.usage();
  assert(u.chars > 0 && u.origin.counted === false && u.origin.chars === null && u.share === null,
    "no keys() and no key(i): this key is measured, the origin is null, never a made-up zero");
}

// --- save() leaves the reason for a failed write on lastError ---
{
  const store = cappedStorage(200);
  const slot = createSaveSlot(baseOpts(store));
  assert(slot.save({ day: 1, staff: [] }) === true && slot.lastError === null, "a write that fits leaves no error");
  const big = { day: 1, staff: [], pad: "p".repeat(300) };
  assert(slot.save(big) === false, "a write past the cap returns false");
  assert(slot.lastError && slot.lastError.quota === true, "and lastError says it was the quota");
  assert(slot.lastError.chars === "test-save".length + JSON.stringify({ ...big, __v: 2 }).length,
    "lastError.chars is the size of the write that failed");
  assert(slot.load().day === 1 && !slot.load().pad, "the previous save is untouched by the failed one");
  assert(slot.save({ day: 2, staff: [] }) === true && slot.lastError === null, "a later success clears lastError");

  const blocked = createSaveSlot(baseOpts({
    getItem: () => null, setItem: () => { throw new Error("SecurityError: blocked"); }, removeItem: () => {}
  }));
  blocked.save({ day: 1, staff: [] });
  assert(blocked.lastError && blocked.lastError.quota === false, "a blocked store is reported as not-quota");
  assert(/refused|blocked/.test(failureMessage(blocked)), "the bar's line for that names the refusal, not the quota");
  assert(/storage is full/.test(failureMessage(slot.save(big) ? null : slot)), "and for a full store it says full");
}

// --- measureStorage narrows to a prefix; probeHeadroom measures the real remainder ---
{
  const store = cappedStorage(1000, { "np_a": "12345", "np_b": "1", "other": "zzz" });
  const m = measureStorage(store, "np_");
  assert(m.keys.length === 2 && m.chars === ("np_a".length + 5) + ("np_b".length + 1), "a prefix measure counts only its keys");
  assert(m.keys[0].key === "np_a", "largest first under a prefix too");
  const used = store._used();
  const head = probeHeadroom(store);
  assert(head === 1000 - used,
    "probeHeadroom finds the exact remaining characters, key and value together (got " + head + ")");
  assert(store.getItem("__gvb_headroom__") === null, "the probe key is removed afterwards");
  assert(store._used() === used, "and nothing else moved");
  assert(probeHeadroom(memoryStorage()) === null, "a store with no ceiling reports null, not a number");
  assert(probeHeadroom(stubStorage(), { max: 4096 }) === null, "a lenient stub past `max` reports null too");
}

// --- autosave tells a handler when a flush did not stick ---
await (async () => {
  const store = cappedStorage(120);
  const slot = createSaveSlot(baseOpts(store));
  let failed = 0;
  const auto = slot.autosave(() => ({ day: 1, staff: [], pad: "p".repeat(200) }), 10, { onFail: () => failed++ });
  auto.mark();
  auto.flush();
  await Promise.resolve(); await Promise.resolve();
  assert(failed === 1, "onFail fires once for a flush whose save returned false");
  auto.stop();
  const quiet = slot.autosave(() => ({ day: 1, staff: [] }), 10);
  quiet.mark(); quiet.flush(); quiet.stop();
  assert(slot.lastError === null, "a v1 caller with no handler still gets the write and no error");
})();

// --- a namespace is a prefix, and a member's key is the old hand-rolled key byte for byte ---
{
  const store = stubStorage({ "belltobell.furniture": '{"cabinet":1}', "unrelated": "1" });
  store.keys = () => Object.keys(store._dump());
  const ns = createNamespace({ game: "bell-to-bell", prefix: "belltobell." });
  // A namespace built over a stub: the store is shared by every member.
  const ns2 = createNamespace({ game: "bell-to-bell", prefix: "belltobell.", storage: store });
  const chart = ns2.slot("p5.chart", { defaults: { seats: [] }, validate: s => Array.isArray(s.seats) });
  assert(chart.key === "belltobell.p5.chart", "prefix + name is the key (#36: the existing layout fits unchanged)");
  assert(chart.name === "p5.chart" && chart.game === "bell-to-bell", "a member knows its name and its game");
  assert(ns.slot("x").key === "belltobell.x" && createNamespace({ game: "g" }).slot("x").key === "g.x",
    "the default prefix is `<game>.`");
  chart.save({ seats: [1, 2] });
  assert(store.getItem("belltobell.p5.chart") === '{"seats":[1,2],"__v":1}', "a member writes the same bytes a lone slot would");
  assert(ns2.slot("p5.chart") === chart, "a second slot() call hands back the same member");
  let threw = false;
  try { ns2.slot("p5.chart", { version: 2 }); } catch (e) { threw = true; }
  assert(threw, "re-registering a member with options is loud");
  assert(ns2.names().sort().join() === "furniture,p5.chart", "names() lists stored members, registered or not, and nothing outside the prefix");
  assert(ns2.registered().join() === "p5.chart", "registered() lists only what slot() was called for");
  const u = ns2.usage();
  assert(u.counted && u.keys.length === 2 && u.chars === ("belltobell.p5.chart".length + '{"seats":[1,2],"__v":1}'.length) + ("belltobell.furniture".length + '{"cabinet":1}'.length),
    "usage() measures the prefix and only the prefix");
  assert(ns2.snapshot()["p5.chart"].seats.length === 2, "snapshot() loads every registered member");
  assert(ns2.clearAll() === 2, "clearAll() removes every key under the prefix and counts them");
  assert(store.getItem("unrelated") === "1" && store.getItem("belltobell.furniture") === null, "and touches nothing outside it");
}

// --- a bundle: every member in one file, each through its own migrate/validate ---
{
  const store = stubStorage();
  store.keys = () => Object.keys(store._dump());
  const ns = createNamespace({ game: "hall", prefix: "hall.", version: 2, storage: store, migrate: (slots, from) => { if (from < 2) slots.settings = { version: 1, state: { moved: true } }; return slots; } });
  const a = ns.slot("careers", { version: 2, defaults: { list: [] }, validate: s => Array.isArray(s.list), migrate: (s, from) => { if (from < 2) s.list = s.list || []; return s; } });
  const b = ns.slot("settings", { defaults: { moved: false }, validate: s => typeof s.moved === "boolean" });
  const text = ns.serialize({ careers: { list: [1] }, settings: { moved: false } });
  const env = JSON.parse(text);
  assert(env.format === "gvb-save-bundle" && env.game === "hall" && env.version === 2, "the bundle envelope is tagged, named and versioned");
  assert(env.slots.careers.version === 2 && env.slots.settings.version === 1, "each member carries its own version");
  const back = ns.deserialize(text);
  assert(back && back.states.careers.list[0] === 1 && back.states.settings.moved === false, "a bundle round-trips every member");
  assert(back.skipped.length === 0 && back.refused.length === 0, "with nothing skipped or refused");

  const later = JSON.stringify({ format: "gvb-save-bundle", game: "hall", version: 2, slots: {
    careers: { version: 1, state: {} }, settings: { version: 1, state: { moved: "yes" } }, trophies: { version: 1, state: {} } } });
  const r = ns.deserialize(later);
  assert(Array.isArray(r.states.careers.list), "an older member runs its own migrate()");
  assert(r.refused.join() === "settings", "a member that fails its validate() is named in `refused`");
  assert(r.skipped.join() === "trophies", "a member this build has not registered is named in `skipped`, not dropped silently");
  assert(ns.deserialize(JSON.stringify({ format: "gvb-save-bundle", game: "elsewhere", version: 2, slots: {} })) === null, "another game's bundle is refused");
  assert(ns.deserialize(a.serialize({ list: [] })) === null, "a single-slot envelope is not a bundle");
  assert(ns.deserialize("junk") === null, "junk is null");
  const old = ns.deserialize(JSON.stringify({ format: "gvb-save-bundle", game: "hall", version: 1, slots: { careers: { version: 2, state: { list: [] } } } }));
  assert(old && old.states.settings && old.states.settings.moved === true, "a bundle a version behind goes through the namespace's own migrate()");

  const imp = ns.importAll(text);
  assert(imp.stored.sort().join() === "careers,settings", "importAll() writes every accepted member and names what stuck");
  assert(a.load().list[0] === 1 && b.load().moved === false, "and the members read back");

  // A member's own export names its slot, so one member's file cannot land in another.
  const fileA = a.serialize({ list: [9] });
  assert(JSON.parse(fileA).slot === "careers", "a member's envelope carries its slot name");
  // A member with no validate of its own, so the only thing that can refuse
  // this file is the slot name. b would refuse it on validate alone, which
  // is a different guard (#34).
  const c = ns.slot("notes");
  assert(c.deserialize(fileA) === null, "another member refuses it, on the slot name alone");
  assert(a.deserialize(fileA).list[0] === 9, "the right member takes it");
  const v1file = JSON.stringify({ format: "gvb-save", game: "hall", version: 2, state: { list: [3] } });
  assert(a.deserialize(v1file).list[0] === 3, "a v1 envelope with no slot name still imports into a member");
  assert(a.filename().startsWith("hall-careers-save-"), "a member's download name includes the slot");
}

// --- the async slot: the same slot, every call a promise, over an async adapter ---
await (async () => {
  const sync = stubStorage();
  sync.keys = () => Object.keys(sync._dump());
  const slot = createAsyncSaveSlot({ ...baseOpts(asyncify(sync)), fallback: null });
  assert(slot.async === true && slot.tier === "local", "an asyncified plain store reads as the local tier");
  assert((await slot.load()) === null, "empty loads as null");
  assert((await slot.save({ day: 5, staff: [] })) === true, "save resolves true");
  assert(sync.getItem("test-save") === '{"day":5,"staff":[],"__v":2}', "and writes the exact bytes a sync slot would");
  const back = await slot.load();
  assert(back.day === 5 && !("__v" in back), "load resolves the state, marker stripped");
  const u = await slot.usage();
  assert(u.chars === "test-save".length + sync.getItem("test-save").length && u.present, "usage() resolves this key's size");
  assert((await slot.clear()) === true && sync.getItem("test-save") === null, "clear() resolves true and removes the key");
  assert((await slot.reset()).day === 1, "reset() resolves a fresh state");
  const hostile = asyncify(cappedStorage(60));
  const full = createAsyncSaveSlot({ ...baseOpts(hostile), fallback: null });
  assert((await full.save({ day: 1, staff: [], pad: "x".repeat(100) })) === false, "a rejected write resolves false");
  assert(full.lastError && full.lastError.quota === true, "and leaves the quota reason on lastError");
  let failed = 0;
  const auto = full.autosave(() => ({ day: 1, staff: [], pad: "x".repeat(100) }), 5, { onFail: () => failed++ });
  auto.mark(); auto.flush(); auto.stop();
  await new Promise(r => setTimeout(r, 5));
  assert(failed === 1, "autosave's onFail hears an async false too");
})();

// --- promotion: a save sitting in localStorage moves up to the new tier, verbatim, once ---
await (async () => {
  const upper = stubStorage(); upper.keys = () => Object.keys(upper._dump());
  const idbLike = { ...asyncify(upper), tier: "idb" };
  const raw = '{"day":4,"staff":[]}';   // version 0: an unversioned save, the #36 case
  const lower = stubStorage({ "test-save": raw });
  const slot = createAsyncSaveSlot({ ...baseOpts(idbLike), fallback: lower });
  const st = await slot.load();
  assert(st && st.day === 4 && Array.isArray(st.upgrades), "a save found below loads, through migrate() like any other");
  assert(upper.getItem("test-save") === raw, "the string moved up verbatim, not re-encoded");
  assert(lower.getItem("test-save") === null, "and the copy below is gone");
  assert(slot.promoted === true, "the slot says it promoted");
  const again = await slot.load();
  assert(again.day === 4, "the next load reads from the upper tier");
  // Verbatim matters: the upper copy is still version 0, so a later load still migrates it.
  assert(Array.isArray(again.upgrades), "which still runs migrate(), because the marker was not rewritten");

  // Junk below is left where it is, not promoted.
  const junkLower = stubStorage({ "test-save": "{not json" });
  const u2 = stubStorage();
  const s2 = createAsyncSaveSlot({ ...baseOpts({ ...asyncify(u2), tier: "idb" }), fallback: junkLower });
  assert((await s2.load()) === null && junkLower.getItem("test-save") === "{not json" && u2.getItem("test-save") === null,
    "unreadable data below is neither loaded nor moved");

  // A put that fails leaves the copy below, so the next load can try again.
  const stuck = { ...asyncify(cappedStorage(5)), tier: "idb" };
  const lower3 = stubStorage({ "test-save": raw });
  const s3 = createAsyncSaveSlot({ ...baseOpts(stuck), fallback: lower3 });
  const st3 = await s3.load();
  assert(st3 && st3.day === 4, "the save still loads when the upper tier refuses it");
  assert(lower3.getItem("test-save") === raw && s3.promoted === false, "and stays below until a put succeeds");
  assert(s3.lastError && s3.lastError.quota, "with the refusal on lastError");

  // fallback: null never looks below.
  const lower4 = stubStorage({ "test-save": raw });
  const s4 = createAsyncSaveSlot({ ...baseOpts({ ...asyncify(stubStorage()), tier: "idb" }), fallback: null });
  assert((await s4.load()) === null && lower4.getItem("test-save") === raw, "fallback: null ignores what is below");

  // clear() takes the copy below with it, so a reset cannot resurrect an old save.
  const lower5 = stubStorage({ "test-save": raw });
  const s5 = createAsyncSaveSlot({ ...baseOpts({ ...asyncify(stubStorage()), tier: "idb" }), fallback: lower5 });
  assert((await s5.clear()) === true && lower5.getItem("test-save") === null, "clear() removes a copy below as well");
})();

// --- an IndexedDB that exists but will not open drops to the next tier, once ---
await (async () => {
  let calls = 0;
  const dead = {
    async: true, tier: "idb",
    getItem: () => { calls++; return Promise.reject(new Error("InvalidStateError: A mutation operation was attempted on a database that did not allow mutations.")); },
    setItem: () => { calls++; return Promise.reject(new Error("InvalidStateError")); },
    removeItem: () => Promise.reject(new Error("InvalidStateError")),
    keys: () => Promise.reject(new Error("InvalidStateError"))
  };
  const slot = createAsyncSaveSlot({ ...baseOpts(dead) });
  assert(slot.tier === "idb", "it starts on the tier it was given");
  assert((await slot.save({ day: 2, staff: [] })) === true, "a write to a dead IndexedDB still lands somewhere");
  assert(slot.tier === "memory", "under Node that somewhere is memory; in a browser it is localStorage");
  const before = calls;
  assert((await slot.load()).day === 2, "and reads back from there");
  assert(calls === before, "the dead store is never asked again");
})();

// --- an async namespace: members in the upper tier, one bundle, every call awaited ---
await (async () => {
  const upper = stubStorage(); upper.keys = () => Object.keys(upper._dump());
  const ns = createNamespace({ game: "hall", prefix: "hall.", storage: { ...asyncify(upper), tier: "idb" }, async: true });
  const a = ns.slot("careers", { defaults: { list: [] }, validate: s => Array.isArray(s.list) });
  const b = ns.slot("settings", { defaults: { moved: false } });
  assert(a.async === true && ns.tier === "idb", "members of an async namespace are async slots on the namespace's store");
  await a.save({ list: [1, 2] }); await b.save({ moved: true });
  assert((await ns.names()).sort().join() === "careers,settings", "names() resolves the stored members");
  const u = await ns.usage();
  assert(u.counted && u.keys.length === 2 && u.tier === "idb", "usage() resolves a count over the prefix");
  const snap = await ns.snapshot();
  assert(snap.careers.list.length === 2 && snap.settings.moved === true, "snapshot() resolves every member");
  const text = ns.serialize(snap);
  assert((await ns.clearAll()) === 2 && (await a.load()) === null, "clearAll() resolves the count and empties the members");
  const imp = await ns.importAll(text);
  assert(imp.stored.length === 2 && (await a.load()).list[1] === 2, "importAll() resolves after every member is written");
})();

// --- the "Adopted by" comment names every project that actually imports this -
// This exists because the comment went stale twice for the same reason, and
// both were found by hand rather than by anything that runs. Golden Hour
// adopted gvb-save and was missing from the list long enough to become its own
// backlog row (rank 38); fixing that row turned up Faire Weekend, which
// adopted at Stage 22 and was missing too. Nothing was ever going to catch a
// third one.
//
// The map is the maintenance cost, and it is deliberate: a folder name does not
// give you a display name (Projects/Ren-Faire-Claude/ is "Faire Weekend"), so a
// new adopter has to say who it is. Adding an importer without touching this map
// fails with the path that needs a line.
{
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const SITE = path.resolve(HERE, "..", "..");

  const ADOPTERS = [
    ["Projects/fourth-quarter/", "The Fourth Quarter"],
    ["Projects/aphelion/", "Aphelion"],
    ["Projects/Closing Time/", "Closing Time"],
    ["Projects/torchbearer", "Torchbearer"],
    ["Projects/absalom-inheritance/", "The Absalom Inheritance"],
    ["Projects/corner-and-kettle/", "Corner & Kettle"],
    ["Projects/daredevil/", "Daredevil"],
    ["Projects/integer-foundry", "Integer Foundry"],
    ["Projects/the-fracture-cycle", "The Fracture Cycle"],
    ["Tools/name-picker/", "Name Picker"],
    ["Tools/seating-chart/", "Seating Chart Generator"],
    ["Tools/Seating Chart Generator.html", "Seating Chart Generator"],
    ["Projects/Ren-Faire-Claude/", "Faire Weekend"],
    ["Projects/golden-hour-beach/", "Golden Hour"],
  ];

  const SKIP = ["node_modules", "/.git/", "/libs/", "assets/js/gvb-save"];
  const walk = (dir, out = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      const norm = full.replace(/\\/g, "/");
      if (SKIP.some(k => norm.includes(k))) continue;
      if (e.isDirectory()) walk(full, out);
      else if (/\.(js|mjs|html)$/.test(e.name)) out.push(full);
    }
    return out;
  };

  // Castle Conundrum was the fourteenth and is not here any more: it moved to
  // its own repository on 2026-09-15 and took a vendored copy of gvb-save.js
  // with it (#491). Its row in README.md's table and its name in the module
  // header stay, marked as a fork, because the record of what it taught this
  // module is still worth having; neither assertion below objects to a name
  // that is documented without being in this list.
  //
  // An `import ... from ".../gvb-save.js"`, not a mention. Blue Hour's ghost.js
  // carries a comment saying it deliberately does NOT use gvb-save, and
  // play-games.mjs asserts on gvb-save envelopes from the outside; neither is
  // an adopter, and a substring match calls both one.
  const IMPORTS = /\bfrom\s*["'][^"']*assets\/js\/gvb-save\.js["']/;
  const importers = walk(SITE).filter(f => IMPORTS.test(fs.readFileSync(f, "utf8")));

  // Every importer maps to a named adopter.
  const unmapped = importers
    .map(f => path.relative(SITE, f).replace(/\\/g, "/"))
    .filter(r => !ADOPTERS.some(([prefix]) => r.startsWith(prefix)));
  assert(unmapped.length === 0,
    "every file importing gvb-save.js belongs to a named adopter; unmapped: " +
    unmapped.join(", "));

  // Every named adopter really does import it — so the list cannot rot the
  // other way either, with a project that dropped gvb-save still listed.
  const orphans = ADOPTERS
    .filter(([prefix]) => !importers.some(f =>
      path.relative(SITE, f).replace(/\\/g, "/").startsWith(prefix)))
    .map(([, name]) => name);
  assert(orphans.length === 0,
    "every adopter in the map still imports gvb-save.js; stale: " + orphans.join(", "));

  // And the comment at the top of the module names all of them.
  const header = fs.readFileSync(path.join(HERE, "gvb-save.js"), "utf8").slice(0, 4000);
  const missing = ADOPTERS.map(([, name]) => name).filter(n => !header.includes(n));
  assert(missing.length === 0,
    "gvb-save.js's \"Adopted by\" comment names every adopter; missing: " +
    missing.join(", "));

  // The README's table is the longer form of the same list.
  const readme = fs.readFileSync(path.join(HERE, "README.md"), "utf8");
  const undocumented = ADOPTERS.map(([, name]) => name)
    .filter(n => !readme.includes("**" + n + "**"));
  assert(undocumented.length === 0,
    "README.md's \"Who uses it\" table has a row per adopter; missing: " +
    undocumented.join(", "));
}

console.log(`\ngvb-save: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
