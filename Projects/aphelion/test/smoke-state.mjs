// smoke-state.mjs — node test/smoke-state.mjs
// State shape + the shared save slot (assets/js/gvb-save.js).

import * as S from "../src/state.js";

let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error("FAIL:", name)); };

const mkStore = (seed = {}) => ({
  d: { ...seed },
  setItem(k, v) { this.d[k] = String(v); },
  getItem(k) { return this.d[k] ?? null; },
  removeItem(k) { delete this.d[k]; },
});

// ---- fresh state ----
const store = mkStore();
const slot = S.aphelionSlot(store);
const fresh = slot.fresh();
ok(S.validateState(fresh), "a fresh state passes its own validator");
ok(fresh.day === 1 && fresh.plant.stage === 0, "fresh state starts day 1, seedling stage");

// ---- save / load round-trip ----
ok(slot.save(fresh), "save reports success against a working store");
const loaded = slot.load();
ok(loaded && loaded.day === fresh.day && loaded.plant.water === fresh.plant.water,
  "save/load round-trips");
ok(JSON.parse(store.getItem(S.SAVE_KEY)).__v === S.SAVE_VERSION, "a stored save carries the schema version");
ok(!("__v" in loaded), "the version marker is stripped before the game sees it");

// ---- refuse garbage ----
ok(slot.deserialize("garbage{{") === null, "corrupt JSON refused");
ok(S.aphelionSlot(mkStore({ [S.SAVE_KEY]: '{"hour":8}' })).load() === null,
  "a save missing the basics (no day, no plant, no systems) is refused");
ok(S.aphelionSlot(mkStore({ [S.SAVE_KEY]: '{"day":"soon","plant":{},"systems":{}}' })).load() === null,
  "a day that isn't a number is refused");
ok(S.aphelionSlot(store) === S.aphelionSlot(store), "one slot per storage object");

// ---- an unversioned pre-slot save still loads ----
// The shape state.js's hand-rolled save() used to write, straight to
// localStorage: no __v, no unlockedDiscoveries/scannedPois/repairStreak,
// because those fields didn't ship yet. gvb-save reads the missing stamp as
// version 0; repairState fills the rest, same story as
// Projects/fourth-quarter/js/campaign.js's repairCampaign.
const legacyRaw = JSON.stringify({
  day: 12, hour: 14.5,
  systems: { power: 88, oxygen: 71, hull: 95 },
  plant: { water: 40, stage: 2, harvests: 1 },
  curios: ["curio-a"],
  unlockedLogs: ["log-1"],
});
const legacy = S.aphelionSlot(mkStore({ [S.SAVE_KEY]: legacyRaw })).load();
ok(legacy && legacy.day === 12 && legacy.plant.stage === 2, "an unversioned pre-slot save still loads");
ok(Array.isArray(legacy.unlockedDiscoveries) && Array.isArray(legacy.scannedPois),
  "repair fills in the collections added since");
ok(legacy.repairStreak === 0 && legacy.parts === 0, "repair fills in the counters added since");

// A save missing `plant` entirely (not just fields inside it) fails validate
// rather than reaching repair — tick() dereferences state.plant.water
// unconditionally every frame, so this one has to be a hard refusal, not a
// fill-in.
ok(S.aphelionSlot(mkStore({
  [S.SAVE_KEY]: JSON.stringify({ day: 3, systems: {} }),
})).load() === null, "a save with no plant object at all is refused, not patched");

// ---- export / import: the piece the hand-rolled save never had ----
const file = slot.serialize(fresh);
const env = JSON.parse(file);
ok(env.format === "gvb-save" && env.game === "aphelion" && env.version === S.SAVE_VERSION,
  "an export file names the format, the game and the version");
const imported = slot.deserialize(file);
ok(imported && imported.day === fresh.day, "an export file imports back");
ok(slot.deserialize(JSON.stringify({
  format: "gvb-save", game: "closing-time", version: 1, state: { day: 3, plant: {}, systems: {} },
})) === null, "another game's save file is refused");

// ---- reset ----
const afterReset = S.aphelionSlot(store).reset();
ok(afterReset.day === 1 && store.getItem(S.SAVE_KEY) === null, "reset wipes the key and starts fresh");

// ---- state.js's own save()/load()/resetSave() wrappers, storage injected ----
const wrapStore = mkStore();
Object.assign(S.state, { day: 40, mode: "eva", parts: 7 });
ok(S.save(wrapStore), "save() persists the module-level state");
ok(!("mode" in JSON.parse(wrapStore.getItem(S.SAVE_KEY))), "save() strips the transient mode field");
S.state.day = 1; // perturb before reload to prove load() overwrites it
ok(S.load(wrapStore) && S.state.day === 40, "load() reloads the module-level state");
ok(S.state.mode === "interior", "load() always resets mode to interior, whatever the save says");
S.resetSave(wrapStore);
ok(S.state.day === 1 && wrapStore.getItem(S.SAVE_KEY) === null, "resetSave() wipes storage and the in-memory state");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
