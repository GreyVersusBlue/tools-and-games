// save.js — Torchbearer's slot on the shared save system.
//
// Before session 8 this game hand-rolled all three doors: `localStorage` under
// `torchbearer-save`, a Blob download named `<hero>.torchsave.json`, and a
// `<input type="file">` that JSON.parsed whatever it was handed and passed it
// straight to `finalizeCharacter`. A file with `{"build":{"cls":"nonsense"}}`
// got as far as `cls.perception` before anything noticed.
//
// The key stays `torchbearer-save` (locked decision #36). Old saves carry
// `{"v":1}` rather than gvb-save's `__v`, so `normalize()` reads them as
// version 0 and they come through `migrate` then `repair` like any other.
//
// Imported RELATIVELY so test/smoke.mjs can load this under plain Node —
// a leading slash is not resolvable there (v7 §7).
import { createSaveSlot } from "../../../assets/js/gvb-save.js";

export const SAVE_KEY = "torchbearer-save";
export const SAVE_VERSION = 2;

const num = (v, fallback) => (Number.isFinite(+v) ? +v : fallback);
const obj = v => (v && typeof v === "object" && !Array.isArray(v) ? v : null);

/** The resource block every hero combatant needs to exist. */
export function blankResources() {
  return { slots: { 1: 0, 2: 0 }, focus: 0, font: 0, potions: 0 };
}

/**
 * The three fields `finalizeCharacter` dereferences without a guard, and the
 * three `Builder` writes into. A build missing any of them threw before it
 * could be rejected.
 */
export function repairBuild(build) {
  const b = obj(build) || {};
  b.name = typeof b.name === "string" ? b.name : "";
  b.boosts = obj(b.boosts) || { ancestry: [], bgA: null, bgFree: null, key: null, free: [] };
  b.boosts.ancestry = Array.isArray(b.boosts.ancestry) ? b.boosts.ancestry : [];
  b.boosts.free = Array.isArray(b.boosts.free) ? b.boosts.free : [];
  b.skills = Array.isArray(b.skills) ? b.skills : [];
  b.loreExtra = Array.isArray(b.loreExtra) ? b.loreExtra : [];
  b.extraPicks = Array.isArray(b.extraPicks) ? b.extraPicks : [];
  b.feats = obj(b.feats) || {};
  b.focusChoices = obj(b.focusChoices) || {};
  b.spells = obj(b.spells) || {};
  b.spells.cantrips = Array.isArray(b.spells.cantrips) ? b.spells.cantrips : [];
  b.spells.r1 = Array.isArray(b.spells.r1) ? b.spells.r1 : [];
  b.spells.r2 = Array.isArray(b.spells.r2) ? b.spells.r2 : [];
  b.gear = obj(b.gear) || { weapon: null, weapon2: null, ranged: null, armor: null, shield: false };
  return b;
}

/**
 * The hero's in-combat state. `hp: null` means "unrecorded" — restore to full
 * rather than to NaN.
 *
 * This is the fill-in that `repair` exists for, and Torchbearer had the exact
 * bug the hook was written to catch. `App.loadSave` used to assign
 * `cb.resources = s.hero.resources` wholesale. A save whose resource block
 * predates a field — `potions` is the one that bites, because `gotoScene`
 * does `hero.resources.potions++` on any scene handing out a healing potion —
 * turns that counter into NaN. The Chronicle still prints "Gained: Lesser
 * Healing Potion", the button is gated behind `(cb.resources.potions||0)>0`,
 * and the potion silently never exists. A missing `slots` is louder: the party
 * panel does `cb.resources.slots[1]` and throws on render.
 */
export function repairHero(hero) {
  const h = obj(hero);
  if (!h) return null;
  const r = obj(h.resources) || {};
  const slots = obj(r.slots) || {};
  return {
    hp: Number.isFinite(+h.hp) ? +h.hp : null,
    wounded: num(h.wounded, 0),
    resources: {
      slots: { 1: num(slots[1], 0), 2: num(slots[2], 0) },
      focus: num(r.focus, 0),
      font: num(r.font, 0),
      potions: num(r.potions, 0)
    }
  };
}

/** Runs on every accepted load, from every door (locked decision #37). */
export function repairSnapshot(state) {
  const s = state;
  s.build = repairBuild(s.build);
  s.flags = obj(s.flags) || {};
  s.dailyLuckUsed = !!s.dailyLuckUsed;
  s.advId = typeof s.advId === "string" ? s.advId : null;
  s.sceneId = typeof s.sceneId === "string" ? s.sceneId : null;
  s.hero = repairHero(s.hero);
  s.companions = Array.isArray(s.companions)
    ? s.companions.filter(c => obj(c) && typeof c.id === "string")
        .map(c => ({ id: c.id, hp: Number.isFinite(+c.hp) ? +c.hp : null }))
    : [];
  // The Chronicle is replayed with innerHTML, so it is the one part of a save
  // an imported file could use to inject markup. Nothing here has a session or
  // a credential to steal, but there is no reason to accept a 40 MB blob or a
  // <script> either: cap the length, keep the last 80 entries the writer keeps.
  s.chronicle = Array.isArray(s.chronicle)
    ? s.chronicle.filter(e => obj(e) && typeof e.html === "string")
        .slice(-80)
        .map(e => ({
          html: e.html.length > 4000 ? e.html.slice(0, 4000) : e.html,
          cls: typeof e.cls === "string" ? e.cls : ""
        }))
    : [];
  return s;
}

/**
 * A save has to name an ancestry, a background and a class. Everything else
 * `finalizeCharacter` reads has a default; those three it indexes straight
 * into the Registry and then dereferences.
 */
export function validateSnapshot(state) {
  const s = obj(state);
  if (!s) return false;
  const b = obj(s.build);
  if (!b) return false;
  return ["ancestry", "background", "cls"].every(k => typeof b[k] === "string" && b[k].length > 0);
}

export function createTorchSlot(storage) {
  return createSaveSlot({
    game: "torchbearer",
    key: SAVE_KEY,
    version: SAVE_VERSION,
    validate: validateSnapshot,
    // Version drift only. v1 stamped its own `v: 1` inside the state; gvb-save
    // keeps the stamp in `__v` and strips it, so the old field is dead weight.
    migrate: (s, from) => { if (from < 2) delete s.v; return s; },
    repair: repairSnapshot,
    // No `defaults`: a fresh Torchbearer state is "no hero yet", which the
    // title screen already represents by having nothing to resume. `reset()`
    // returning null is correct here rather than a bug.
    defaults: null,
    storage: storage || null
  });
}
