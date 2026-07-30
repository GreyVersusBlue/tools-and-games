// gvb-save.test.mjs — node assets/js/gvb-save.test.mjs
// Plain-Node smoke suite, same shape as the other projects on this site:
// a tiny assert() counter, no framework. Exercises everything that does not
// need a DOM (storage round-trip, versioning, migration, validation,
// envelope serialize/deserialize, autosave throttling).

import { createSaveSlot, defaultStorage } from "./gvb-save.js";

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

console.log(`\ngvb-save: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
